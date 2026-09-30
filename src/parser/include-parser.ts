// src/parser/include-parser.ts
import type {
	Constant,
	EnumDeclaration,
	EnumMember,
	ForwardDeclaration,
	NativeFunction,
	Parameter,
	ParsedInclude,
} from '../types';

/**
 * Evaluates a Pawn constant expression, or gives up.
 *
 * Only integer arithmetic a macro expansion leaves behind — `(1024 * 1)`,
 * `1<<3`, `BIT(2)|BIT(3)`. Division is deliberately excluded: Pawn's `/` on
 * cells is not JavaScript's, and a wrong number here is worse than none.
 * Anything with an unresolved identifier in it returns undefined, which stops
 * the enum's auto-increment rather than letting it invent a value.
 */
export function evalInt(expr: string): number | undefined {
	if (!/^[\d\s+\-*()<>|&^~]+$/.test(expr)) return undefined;

	try {
		// Only digits and operators got this far: a constant expression, not code.
		// oxlint-disable-next-line no-new-func
		const value = new Function(`return (${expr});`)();
		return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Pawn's increment clause, `enum E (<<= 1)`: how a member's value gives the next one's. */
const ENUM_STEP: Record<string, (value: number, by: number) => number> = {
	'+': (value, by) => value + by,
	'*': (value, by) => value * by,
	'<<': (value, by) => value << by,
};

/** `a, b(c, d), e[1]` as `a`, `b(c, d)`, `e[1]`: commas inside brackets do not split. */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	for (const char of text) {
		if (char === '(' || char === '[' || char === '{') {
			depth++;
		} else if (char === ')' || char === ']' || char === '}') {
			depth--;
		} else if (char === ',' && depth === 0) {
			if (current.trim()) parts.push(current.trim());
			current = '';
			continue;
		}
		current += char;
	}
	if (current.trim()) parts.push(current.trim());
	return parts;
}

export interface Macro {
	params: string[];
	body: string;
}

export class IncludeParser {
	private lines: string[];
	private currentLine = 0;
	private macros: Map<string, Macro>;

	constructor(content: string, macros = new Map<string, Macro>()) {
		this.lines = content.split('\n');
		this.macros = macros;
		IncludeParser.collectMacrosFrom(content, this.macros);
	}

	/**
	 * Function-like defines: `#define BIT(%0) (1<<(%0))`.
	 * The table is shared across includes because BEGIN_FUNC_REGION is declared
	 * in reapi.inc but used in reapi_gamedll_const.inc.
	 */
	static collectMacrosFrom(content: string, into: Map<string, Macro>): Map<string, Macro> {
		for (const line of content.split('\n')) {
			const match = line.trim().match(/^#define\s+(\w+)\(([^)]*)\)\s+(\S.*)$/);
			if (!match) continue;

			const [, name, params, body] = match;
			into.set(name, {
				params: params.split(',').map(p => p.trim()).filter(Boolean),
				body: body.trim(),
			});
		}
		return into;
	}

	/** Expands macro calls; nested calls resolve on a later round. */
	private expand(text: string): string {
		let result = text;

		// ponytail: a fixed number of rounds instead of real recursion — these
		// includes never nest more than a couple of levels deep.
		for (let round = 0; round < 4; round++) {
			let changed = false;

			for (const [name, macro] of this.macros) {
				const start = result.indexOf(`${name}(`);
				if (start < 0) continue;

				const args = this.readArgs(result, start + name.length);
				if (!args) continue;

				let body = macro.body;
				macro.params.forEach((param, i) => {
					body = body.split(param).join(args.values[i] ?? '');
				});

				result = result.slice(0, start) + body + result.slice(args.end);
				changed = true;
			}

			if (!changed) break;
		}

		return result;
	}

	/** Reads a balanced `(a, b)` starting at `open`, splitting on top-level commas. */
	private readArgs(text: string, open: number): { values: string[]; end: number } | null {
		if (text[open] !== '(') return null;

		const values: string[] = [];
		let current = '';
		let depth = 0;

		for (let i = open; i < text.length; i++) {
			const char = text[i];

			if (char === '(') {
				depth++;
				if (depth === 1) continue;
			} else if (char === ')') {
				depth--;
				if (depth === 0) {
					values.push(current.trim());
					return { values, end: i + 1 };
				}
			} else if (char === ',' && depth === 1) {
				values.push(current.trim());
				current = '';
				continue;
			}

			current += char;
		}

		return null;
	}

	parse(): ParsedInclude {
		const result: ParsedInclude = {
			natives: [],
			forwards: [],
			constants: [],
			enums: [],
		};

		let currentDocs: string | undefined;

		for (let i = 0; i < this.lines.length; i++) {
			const line = this.lines[i].trim();

			// Extract documentation
			if (line.startsWith('/**')) {
				currentDocs = this.extractDocs(i);
				// Skip to end of comment
				while (i < this.lines.length && !this.lines[i].includes('*/')) {
					i++;
				}
				continue;
			}

			if (line.startsWith('native ')) {
				const native = this.parseNative(line, currentDocs);
				if (native) result.natives.push(native);
				currentDocs = undefined;
			} else if (line.startsWith('forward ')) {
				const forward = this.parseForward(line, currentDocs);
				if (forward) result.forwards.push(forward);
				currentDocs = undefined;
			} else if (/^#define\s/.test(line)) {
				const constant = this.parseDefine(line, currentDocs);
				if (constant) result.constants.push(constant);
				currentDocs = undefined;
			} else if (/^enum\b/.test(line)) {
				// Named and anonymous alike.
				const enumDecl = this.parseEnum(i, currentDocs);
				if (enumDecl && enumDecl.members.length > 0) {
					result.enums.push(enumDecl);
					i = Math.max(i, this.currentLine); // Skip parsed lines, never back
				}
				currentDocs = undefined;
			}
		}

		return result;
	}

	private extractDocs(startLine: number): string {
		const docs: string[] = [];
		let i = startLine;

		while (i < this.lines.length) {
			const line = this.lines[i].trim();
			if (line.endsWith('*/')) {
				// Include last line content before */
				const content = line
					.replace(/\*\/$/, '')
					.replace(/^\*/, '')
					.trim();
				if (content) docs.push(content);
				break;
			}

			const content = line
				.replace(/^\/\*\*/, '')
				.replace(/^\*/, '')
				.trim();

			if (content) docs.push(content);
			i++;
		}

		return docs.join('\n');
	}

	private parseNative(line: string, docs?: string): NativeFunction | null {
		// native functionName(params) or native Type:functionName(params)
		const match = line.match(/native\s+(?:(\w+):)?(\w+)\s*\((.*?)\)/);
		if (!match) return null;

		const [, returnType, name, paramsStr] = match;
		const params = this.parseParameters(paramsStr);

		return {
			name,
			params,
			returnType: returnType || 'any',
			docs,
		};
	}

	private parseForward(line: string, docs?: string): ForwardDeclaration | null {
		// forward functionName(params)
		const match = line.match(/forward\s+(\w+)\s*\((.*?)\)/);
		if (!match) return null;

		const [, name, paramsStr] = match;
		const params = this.parseParameters(paramsStr);

		return {
			name,
			params,
			returnType: 'void',
			docs,
		};
	}

	private parseParameters(paramsStr: string): Parameter[] {
		if (!paramsStr.trim()) return [];

		const params: Parameter[] = [];
		const parts = this.splitParameters(paramsStr);

		for (const part of parts) {
			const param = this.parseParameter(part.trim());
			if (param) params.push(param);
		}

		return params;
	}

	private splitParameters(str: string): string[] {
		const params: string[] = [];
		let current = '';
		let bracketDepth = 0;
		let braceDepth = 0;

		for (const char of str) {
			if (char === '[') {
				bracketDepth++;
			} else if (char === ']') {
				bracketDepth--;
			} else if (char === '{') {
				braceDepth++;
			} else if (char === '}') {
				braceDepth--;
			} else if (char === ',' && bracketDepth === 0 && braceDepth === 0) {
				if (current.trim()) {
					params.push(current.trim());
				}
				current = '';
				continue;
			}
			current += char;
		}

		if (current.trim()) {
			params.push(current.trim());
		}
		return params;
	}

	private parseParameter(str: string): Parameter | null {
		if (!str) return null;

		let isConst = false;
		let isRef = false;
		let isArray = false;
		let isRest = false;
		let type = 'any';
		let name = '';
		let defaultValue: string | undefined;
		let arraySize: string | undefined;

		// Check for rest parameters (...)
		if (str.includes('...')) {
			isRest = true;
			str = str.replace('...', '');
		}

		// Remove const
		str = str.replace(/^const\s+/, () => {
			isConst = true;
			return '';
		});

		// Remove &
		str = str.replace(/^&/, () => {
			isRef = true;
			return '';
		});

		// Extract default value (including array defaults like {255, 255, 250, 0})
		const equals = str.indexOf('=');
		if (equals > 0 && equals < str.length - 1) {
			defaultValue = str.slice(equals + 1).trim();
			str = str.slice(0, equals).trim();
		}

		// Extract array. Pawn allows more than one trailing dimension (e.g.
		// sorting.inc's `array[][]`), so every bracket group is stripped, not
		// just the last one — otherwise the leftover `[]` ends up in the name.
		// A 2D array argument is not interchangeable with a 1D one at the call
		// site (amxxpc rejects it with "array dimensions do not match"), so the
		// count is kept, not just whether it is an array at all.
		let dimensions = 0;
		for (let group = str.match(/\[([^[\]]*)\]$/); group && group.index! > 0; group = str.match(/\[([^[\]]*)\]$/)) {
			str = str.slice(0, group.index).trim();
			arraySize = group[1] || arraySize;
			isArray = true;
			dimensions++;
		}

		// Extract type
		// Pawn allows a multi-tag: {Float,_}:value — take the first real tag,
		// `_` stands for "any untagged".
		const multiTagMatch = str.match(/^\{([^}]*)\}:(.+)$/);
		const typeMatch = str.match(/^(\w+):(.+)$/);

		if (multiTagMatch) {
			const tags = multiTagMatch[1].split(',').map(t => t.trim()).filter(t => t && t !== '_');
			type = tags[0] || 'any';
			name = multiTagMatch[2].trim();
		} else if (typeMatch) {
			type = typeMatch[1];
			name = typeMatch[2].trim();
		} else {
			name = str.trim();
		}

		// Handle rest parameters
		if (isRest) {
			name = 'args';
			isArray = true;
		}

		return {
			name,
			type,
			isArray,
			isRef,
			isConst,
			defaultValue,
			arraySize,
			isRest,
			dimensions: isArray ? dimensions : undefined,
		};
	}

	private parseDefine(line: string, docs?: string): Constant | null {
		const match = line.match(/#define\s+(\w+)\s+(.+)/);
		if (!match) return null;

		const [, name, value] = match;
		return { name, value: this.expand(value.trim()), docs };
	}

	private parseEnum(startLine: number, docs?: string): EnumDeclaration | null {
		const firstLine = this.lines[startLine].trim();

		// "enum Name", "enum Name (<<= 1)", "enum" or "enum {".
		const enumName = firstLine.match(/^enum\s+(\w+)/)?.[1];
		// Without a clause Pawn counts `+= 1`; AMX Mod X's flag enums double, `(<<= 1)`.
		const [, op = '+', by = '1'] = firstLine.match(/\((\+|\*|<<)=([^)]+)\)/) ?? [];
		const step = ENUM_STEP[op];
		const stepBy = evalInt(by);

		// The opening brace: on the enum's own line or a later one.
		let i = startLine;
		while (i < this.lines.length && !this.lines[i].includes('{')) i++;
		if (i >= this.lines.length) {
			this.currentLine = startLine;
			return null;
		}

		const members: EnumMember[] = [];
		let currentMemberDocs: string | undefined;
		let lastValue: number | undefined = 0;

		// Members follow the brace on its line too - all of them in a one-line
		// enum, `enum E { A = 0, B, C };` - and end at the closing brace,
		// wherever it is. A line that is only `};` is one case of that.
		let text = this.lines[i].slice(this.lines[i].indexOf('{') + 1);

		while (true) {
			const line = text.trim();

			if (line.startsWith('/**')) {
				// A doc comment is the next member's.
				currentMemberDocs = this.extractDocs(i);
				while (i < this.lines.length && !this.lines[i].includes('*/')) i++;
			} else if (line.startsWith('/*') && line.endsWith('*/')) {
				currentMemberDocs = line.replace(/^\/\*/, '').replace(/\*\/$/, '').trim();
			} else if (line.startsWith('/*') && !line.includes('*/')) {
				while (i < this.lines.length && !this.lines[i].includes('*/')) i++;
			} else {
				const uncommented = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '');
				// A comment after a member that runs on to later lines - ns_const.inc's
				// `NSGame_Unknown, /**< Can find the gameplay entity, but can't` - ends
				// the line's code, and its lines are no members.
				const open = uncommented.indexOf('/*');
				const code = open < 0 ? uncommented : uncommented.slice(0, open);
				const close = code.indexOf('}');

				for (const part of splitTopLevel(close < 0 ? code : code.slice(0, close))) {
					const member = this.parseEnumMember(part, currentMemberDocs, lastValue);
					if (!member) continue;
					members.push(member);
					// An explicit value re-anchors the count. It is an expression as
					// often as it is a literal — reapi opens every hookchain region
					// with BEGIN_FUNC_REGION(gamedll), which expands to (1024 * 1) —
					// and the members after it continue 1025, 1026... Counting from
					// zero there made hook() register an unrelated hookchain.
					if (member.value) lastValue = evalInt(member.value);
					lastValue = lastValue === undefined || stepBy === undefined ? undefined : step(lastValue, stepBy);
					currentMemberDocs = undefined;
				}

				if (close >= 0) {
					this.currentLine = i;
					return { name: enumName, members, docs };
				}

				if (open >= 0) {
					i++;
					while (i < this.lines.length && !this.lines[i].includes('*/')) i++;
				}
			}

			i++;
			if (i >= this.lines.length) break;
			text = this.lines[i];
		}

		// No closing brace before the end of the file: not an enum to read.
		this.currentLine = startLine;
		return null;
	}

	/** One member as splitTopLevel() cut it from a line without its comments: `NAME` or `NAME = value`. */
	private parseEnumMember(part: string, docs?: string, autoValue?: number): EnumMember | null {
		const match = part.match(/^(\w+)(?:\s*=\s*(.+))?/);
		if (!match) return null;

		const [, name, value] = match;

		// Use provided value, or auto-increment value, or undefined
		const explicit = value?.trim();
		const finalValue = explicit
			? this.expand(explicit)
			: (autoValue !== undefined ? autoValue.toString() : undefined);

		return { name, value: finalValue, docs };
	}
}
