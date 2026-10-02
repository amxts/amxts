// Where a plugin's machine code came from in its TypeScript, carried inside
// the plugin: what the module reads when a call fails, or when a plugin asks
// for `error.stack`, to print the stack as functions, files and lines
// (runtime/src/module.cpp, PrintStack).
//
// asc writes a source map of the wasm it emits: for a wasm, a mapping's
// column is a byte offset into the binary, and WAMR's frames carry the same
// offset - the opcode a frame stopped at (wamrc --enable-dump-call-stack).
// The table goes into the wasm as a custom section, appended after the code
// so no offset moves, and wamrc copies it into the .aot
// (--emit-custom-sections): a plugin carries its map wherever its .aot goes.
//
// The section's text, line by line:
//
//   amxts-map 1
//   root <folder>          the project's folder, absolute, for a dev build:
//                          where the module looks for the files first
//   files <count>          then one file a line, as the project names it
//   functions <first> <count>   the wasm index of the first defined function,
//                          then one name a line, by index; an empty name is
//                          the hood's own frame, which the stack leaves out
//   mappings               then the source map's own mappings, one line
//
// The mappings stay as the source map writes them - base64 VLQ, each segment
// a byte offset and, when the code there has a place, its file, line and
// column - which is as small as the table gets without losing a column.

/** The custom section's name. */
export const MAP_SECTION = 'amxts.map';

/** A place in the TypeScript: 1-based line and column. */
export interface Place {
	file: string;
	line: number;
	column: number;
}

/**
 * One mapping: from its byte offset on, the code is at `place` - null in a
 * file the map leaves out, undefined where the source map gave no place.
 */
interface Mapping {
	offset: number;
	place?: Place | null;
}

/** A plugin's map, read back. */
export interface PluginMap {
	/** The project's folder for a dev build, else empty: the files are relative to it. */
	root: string;
	files: string[];
	first: number;
	functions: string[];
	mappings: string;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Source map mappings, decoded - a wasm's are all on its one line - with no place in a file named null. */
function decode(mappings: string, files: (string | null)[]): Mapping[] {
	const out: Mapping[] = [];
	const state = [0, 0, 0, 0];
	for (const segment of mappings.split(/[,;]/)) {
		if (!segment) continue;
		const fields: number[] = [];
		let value = 0;
		let shift = 0;
		for (const char of segment) {
			const digit = BASE64.indexOf(char);
			value += (digit & 31) << shift;
			if (digit & 32) {
				shift += 5;
				continue;
			}
			fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
			value = 0;
			shift = 0;
		}
		fields.forEach((field, i) => (state[i] += field));
		const file = fields.length >= 4 ? files[state[1]] : undefined;
		out.push({ offset: state[0], place: file ? { file, line: state[2] + 1, column: state[3] + 1 } : (file === null ? null : undefined) });
	}
	return out;
}

/** `mappings` as a source map writes them, and the files they name. */
function encode(mappings: Mapping[]): { files: string[]; mappings: string } {
	const vlq = (number: number) => {
		let value = number < 0 ? (-number << 1) | 1 : number << 1;
		let out = '';
		do {
			const digit = value & 31;
			value >>>= 5;
			out += BASE64[value ? digit | 32 : digit];
		} while (value);
		return out;
	};
	const files: string[] = [];
	const state = [0, 0, 0, 0];
	const segments = mappings.map(({ offset, place }) => {
		const fields = [offset];
		if (place) {
			if (!files.includes(place.file)) files.push(place.file);
			fields.push(files.indexOf(place.file), place.line - 1, place.column - 1);
		}
		return fields.map((field, i) => {
			const delta = field - state[i];
			state[i] = field;
			return vlq(delta);
		}).join('');
	});
	return { files, mappings: segments.join(',') };
}

/**
 * A plugin's map from asc's source map: each file by `name` - null leaves it
 * out, its code then has no place - and `functions`, by wasm index from
 * `first`. Code the source map gives no place - a call the optimiser made
 * anew, as often as not - is where the code before it is: a frame stops at
 * such calls. A mapping that says what the one before it said goes.
 */
export function pluginMap(sourceMap: string, name: (file: string) => string | null, first: number, functions: string[], root = ''): PluginMap {
	const { sources = [], mappings = '' } = sourceMap ? JSON.parse(sourceMap) : {};
	const kept: Mapping[] = [];
	let last = '';
	for (const mapping of decode(mappings, sources.map(name))) {
		if (mapping.place === undefined) continue;
		const key = mapping.place ? `${mapping.place.file}:${mapping.place.line}:${mapping.place.column}` : '';
		if (key === last) continue;
		last = key;
		kept.push(mapping);
	}
	return { root, ...encode(kept), first, functions };
}

/** Where the code at byte `offset` of the wasm came from, or null. */
export function placeOf(map: PluginMap, offset: number): Place | null {
	let found: Place | null = null;
	for (const mapping of decode(map.mappings, map.files)) {
		if (mapping.offset > offset) break;
		found = mapping.place ?? null;
	}
	return found;
}

/**
 * A function's name as a stack shows it, from its name in the wasm; empty
 * for the library's error handling - `__throw`, the errors' constructors,
 * what makes their stack - which a stack leaves out: the frame below is where
 * the error was made.
 */
export function displayName(internal: string): string {
	if (internal.startsWith('~lib/error/')) return '';
	if (/^start:[^~]*$/.test(internal)) return '<top level>';
	const name = internal
		// a function made at the top level, as one made in a function: `onSelect~anonymous|0`
		.replace(/^start:[^~]*~anonymous\|\d+/, '<anonymous>')
		// asc writes a function type's parentheses as %28 and %29
		.replace(/%([\dA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
		// a path in front of a name, the generic arguments' too:
		// `~lib/array/Array<plugins/shop/Item>#push` is `Array<Item>#push`
		.replace(/(?:[\w.~@-]+\/)+/g, '')
		.replace(/~anonymous\|\d+/g, '/<anonymous>')
		.replace(/@\w+$/, '')
		.replace(/#(?:get|set):/, '.');
	return name.endsWith('#constructor') ? `new ${name.slice(0, -'#constructor'.length)}` : name.replace(/#/g, '.');
}

/** The section's text for `map`. */
export function mapText(map: PluginMap): string {
	return [
		'amxts-map 1',
		`root ${map.root}`,
		`files ${map.files.length}`,
		...map.files,
		`functions ${map.first} ${map.functions.length}`,
		...map.functions,
		'mappings',
		map.mappings,
		'',
	].join('\n');
}

/** `wasm` with `text` appended as the custom section `name`. */
export function withSection(wasm: Uint8Array, name: string, text: string): Uint8Array {
	const leb = (value: number) => {
		const bytes: number[] = [];
		do {
			const byte = value & 0x7F;
			value >>>= 7;
			bytes.push(value ? byte | 0x80 : byte);
		} while (value);
		return bytes;
	};
	const encoder = new TextEncoder();
	const nameBytes = encoder.encode(name);
	const content = [...leb(nameBytes.length), ...nameBytes, ...encoder.encode(text)];
	return new Uint8Array([...wasm, 0, ...leb(content.length), ...content]);
}

/** The map a wasm carries, or null. */
export function readMap(wasm: Uint8Array): PluginMap | null {
	let at = 8;
	const u32 = () => {
		let result = 0;
		let shift = 0;
		for (;;) {
			const byte = wasm[at++];
			result |= (byte & 0x7F) << shift;
			if ((byte & 0x80) === 0) return result >>> 0;
			shift += 7;
		}
	};
	while (at < wasm.length) {
		const id = wasm[at++];
		const size = u32();
		const end = at + size;
		if (id === 0) {
			const length = u32();
			const name = new TextDecoder().decode(wasm.subarray(at, at + length));
			if (name === MAP_SECTION) return parseMap(new TextDecoder().decode(wasm.subarray(at + length, end)));
		}
		at = end;
	}
	return null;
}

/** The section's text, read back. */
export function parseMap(text: string): PluginMap {
	const lines = text.split('\n');
	const fileCount = Number(lines[2].split(' ')[1]);
	const files = lines.slice(3, 3 + fileCount);
	const [, first, count] = lines[3 + fileCount].split(' ').map(Number);
	const at = 4 + fileCount;
	return { root: lines[1].slice('root '.length), files, first, functions: lines.slice(at, at + count), mappings: lines[at + count + 1] };
}
