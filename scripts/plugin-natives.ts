import type { ForwardDeclaration, NativeFunction, Parameter } from '../src/types';
// A plugin's own natives: every `export function` of its entry file becomes an
// AMX Mod X native under the same name, with its real types.
//
//   export function cfg_get_value(file: string, key: string) { return ...; }
//   // native cfg_get_value(const file[], const key[], out[], len);
//
// Two pieces, both run from scripts/compile.ts (and src/testing/compile.ts):
//
// - an AssemblyScript transform. After parsing it reads the entry file's
//   exported functions and adds a hidden entry beside it with one wrapper per
//   function: the wrapper reads the Pawn caller's arguments through the
//   facade's __native* helpers, calls the function and hands the result back,
//   and registers itself under the function's name. After compiling it reads
//   the result types the compiler inferred - a native's return type is not
//   written, like any other function's.
// - pawnInclude(), the `.inc` a Pawn plugin includes to call them.
//
// Nothing here changes the compiler: the wrappers are ordinary AssemblyScript
// against the facade, and a plugin that exports nothing gets nothing.
//
// A plugin that implements an existing Pawn include says so -
// `plugin({ ..., include: "myplugin.inc" })` - and that include is the
// contract: its declarations say how every argument crosses (a `Float:`, a
// tag, an out-buffer before the other parameters, a `&ref`, an `any:...`
// tail), so the TypeScript function keeps plain TypeScript types. See
// contractPlan() and docs/en/6.pawn/01.natives.md.
import { basename, dirname, resolve } from 'node:path';
// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import * as asc from '../runtime/deps/assemblyscript/dist/assemblyscript.js';
import { IncludeParser } from '../src/parser/include-parser';
import { listIncludes, readInclude } from './includes';
import { sourcesFor } from './project';
import { existsSync, readFileSync } from './tracked-fs';

/**
 * How one argument crosses from Pawn. `tag` is a cell under one of the
 * plugin's own exported enums - `section: ConfigSection` is
 * `ConfigSection:section` in the include. `player` is a player id read as a
 * Player: a cell that is not a player slot (1 to maxPlayers) never reaches
 * the function - the native answers its result's default (0, false, "")
 * instead. `player?` is `Player | null`, where 0 - the server, everyone -
 * is null.
 */
export type ParamKind = 'string' | 'int' | 'float' | 'bool' | 'ints' | 'floats' | 'vector' | 'tag' | 'player' | 'player?' | 'team';

/**
 * How the result goes back. `string?` is `string | null`: a bool, and the
 * text in `out[]`. `tag` is a cell under an exported enum; `array` is a
 * facade CellArray - an AMX Mod X `Array:` handle the caller destroys, or
 * Invalid_Array for null.
 */
export type ResultKind = 'void' | 'int' | 'float' | 'bool' | 'string' | 'string?' | 'ints' | 'floats' | 'tag' | 'array';

export interface NativeParam {
	name: string;
	kind: ParamKind;
	/** The Pawn default, when the TypeScript one is a literal Pawn can write. */
	pawnDefault: string | null;
	/** The enum a `tag` parameter is typed with. */
	tag?: string;
}

export interface PluginNative {
	name: string;
	params: NativeParam[];
	result: ResultKind;
	/** The enum a `tag` result is typed with. */
	resultTag?: string;
	/** The function's own `/** ... *\/` comment, for the include. */
	doc: string;
	/**
	 * For a native the plugin's include declares: the Pawn arguments in order,
	 * as that declaration lays them out (see contractPlan).
	 */
	layout?: PawnSlot[];
	/** Its declaration's return tag: `Float`, `bool`, another tag or `any`. */
	pawnResult?: string;
	/** The declaration itself, for the include the build writes. */
	declaration?: NativeFunction;
}

/**
 * What a native writes back through an argument: text into `x[], len`, cells
 * into `x[], size`, one cell through `&x` (`Float:&x` - a float).
 */
export type OutputKind = 'string' | 'ints' | 'floats' | 'ref' | 'float-ref';

/** An `export enum` of the entry file: a Pawn enum in the include, and a tag. */
export interface PluginEnum {
	name: string;
	members: { name: string; value: number }[];
	doc: string;
}

// The enums of a compile, beside its natives: filled by the transform, read
// by pawnInclude() - both are handed the same natives array.
const ENUMS = new WeakMap<PluginNative[], PluginEnum[]>();

/** The `export enum`s that came with these natives. */
export function nativeEnums(natives: PluginNative[]): PluginEnum[] {
	return ENUMS.get(natives) ?? [];
}

/** The hidden entry the wrappers live in, beside the plugin's entry file. */
const WRAPPERS = '__amxts_natives.ts';

// The arguments the module reads from a Pawn call of a plugin's native: the
// rest would be lost. Must match MAX_NATIVE_ARGS in runtime/src/module.cpp.
const MAX_NATIVE_ARGS = 64;

/** The Pawn include a plugin implements: its text, and its natives by name. */
export interface Contract {
	/** The name the plugin gave: "myplugin.inc". */
	file: string;
	text: string;
	natives: Map<string, NativeFunction>;
}

// The contract of a compile, beside its natives - read by pawnInclude().
const CONTRACTS = new WeakMap<PluginNative[], Contract>();
// The author the plugin names in plugin({ author }), for its include's header.
const AUTHORS = new WeakMap<PluginNative[], string>();

/** The include these natives implement, when the plugin named one. */
export function nativeContract(natives: PluginNative[]): Contract | undefined {
	return CONTRACTS.get(natives);
}

/** What a compile keeps beside its natives, as data: for a cache to store with them. */
export interface NativesBeside {
	enums: PluginEnum[];
	contract: { file: string; text: string } | null;
	author: string | null;
}

export function nativesBeside(natives: PluginNative[]): NativesBeside {
	const contract = CONTRACTS.get(natives);
	return { enums: nativeEnums(natives), contract: contract ? { file: contract.file, text: contract.text } : null, author: AUTHORS.get(natives) ?? null };
}

/** Natives read back from a cache get their enums and contract beside them again. */
export function setNativesBeside(natives: PluginNative[], beside: NativesBeside) {
	ENUMS.set(natives, beside.enums);
	if (beside.contract) CONTRACTS.set(natives, contractOf(beside.contract.file, beside.contract.text));
	if (beside.author) AUTHORS.set(natives, beside.author);
}

function contractOf(file: string, text: string): Contract {
	return { file, text, natives: new Map(new IncludeParser(text).parse().natives.map(native => [native.name, native])) };
}

/** The text fields of `plugin({ ... })` at the top of the entry file: `include`, `author`, ... */
function pluginInfo(source: any): Record<string, string> {
	const info: Record<string, string> = {};
	for (const statement of source.statements) {
		const call = statement.kind === asc.NodeKind.Expression ? statement.expression : null;
		if (!call || call.kind !== asc.NodeKind.Call || call.expression.kind !== asc.NodeKind.Identifier) continue;
		if (call.expression.text !== 'plugin' || call.args.length !== 1) continue;
		const fields = call.args[0];
		if (fields.kind !== asc.NodeKind.Literal || fields.literalKind !== asc.LiteralKind.Object) continue;
		fields.names.forEach((key: any, i: number) => {
			const value = fields.values[i];
			if (value.kind === asc.NodeKind.Literal && value.literalKind === asc.LiteralKind.String) info[key.text] = value.value;
		});
	}
	return info;
}

/**
 * `plugin({ ..., include: "myplugin.inc" })` at the top of the entry file:
 * the include is looked for beside the plugin, in the plugins folder, in the
 * project's includes/ and in the core's - where the includes of the Pawn
 * plugins it stands in for already are.
 */
function readContract(source: any, entry: string, root: string, problems: string[]): Contract | null {
	const file = pluginInfo(source).include ?? null;
	// A module package that says `"contract": true` has its include as the
	// contract, whether or not its natives name it in plugin({ include }).
	const sources = sourcesFor(root);
	const contract = sources.contractOf(entry);
	if (!file && contract) {
		return contractOf(basename(contract), readFileSync(contract, 'utf-8'));
	}
	if (!file) return null;

	const base = resolve(root);
	const candidates = [resolve(base, dirname(entry), file), ...sources.includeCandidates(entry, file), resolve(base, '..', 'includes', file)];
	const path = candidates.find(existsSync);
	if (!path) {
		problems.push(`${source.normalizedPath}: include "${file}" is not beside the plugin, in its package, in ${base} or in an includes/ folder`);
		return null;
	}

	return contractOf(file, readFileSync(path, 'utf-8'));
}

/** Exports that are not natives: the module's own hook, and the hood's names. */
function isNative(name: string): boolean {
	return name !== 'init' && !name.startsWith('__');
}

/** `number`, `Float`, `string | null`, `Float[]` - a type node as a name. */
function typeName(node: any): { name: string; args: any[]; nullable: boolean } | null {
	if (!node || node.kind !== asc.NodeKind.NamedType) return null;
	return { name: node.name.identifier.text, args: node.typeArguments ?? [], nullable: node.isNullable };
}

function paramKind(node: any, tags: Set<string> = new Set()): ParamKind | null {
	const type = typeName(node);
	if (type?.name === 'Player') return type.nullable ? 'player?' : 'player';
	if (!type || type.nullable) return null;
	if (tags.has(type.name)) return 'tag';
	if (type.name === 'string') return 'string';
	if (type.name === 'number') return 'int';
	if (type.name === 'Float') return 'float';
	if (type.name === 'boolean' || type.name === 'bool') return 'bool';
	if (type.name === 'Vector') return 'vector';
	if (type.name === 'Array' && type.args.length === 1) {
		const element = typeName(type.args[0]);
		if (element?.name === 'number' && !element.nullable) return 'ints';
		if (element?.name === 'Float' && !element.nullable) return 'floats';
	}
	return null;
}

/** A written result type, or null when it is not one a native can have. */
function resultKind(node: any, tags: Set<string> = new Set()): ResultKind | null {
	const type = typeName(node);
	if (!type) return null;
	if (type.name === 'void') return 'void';
	if (type.name === 'string') return type.nullable ? 'string?' : 'string';
	if (type.name === 'CellArray') return 'array';
	if (type.nullable) return null;
	const kind = paramKind(node, tags);
	// A Player or a Team as a written result is left as the kind it is.
	return (kind === 'vector' ? 'floats' : kind) as ResultKind | null;
}

/** The result type the compiler settled on, for a function whose type is not written. */
function inferredKind(type: any): ResultKind | null {
	const text = String(type.toString());
	if (text === 'void') return 'void';
	if (text === 'bool') return 'bool';
	if (/^[iu](?:8|16|32|64)$|^f(?:32|64)$|^[iu]size$/.test(text)) return 'int';
	if (/(?:^|\/)String(?: \| null)?$/.test(text)) return text.endsWith('| null') ? 'string?' : 'string';
	if (/(?:^|\/)Array<f64>$/.test(text)) return 'ints';
	if (/(?:^|\/)CellArray(?: \| null)?$/.test(text)) return 'array';
	return null;
}

/** TeamName by number: TEAM_UNASSIGNED 0, TERRORIST 1, CT 2, SPECTATOR 3 - as the facade's TEAM_NAMES. */
const TEAM_NAMES = ['UNASSIGNED', 'TERRORIST', 'CT', 'SPECTATOR'];

/**
 * `errorKey?: string`: a string Pawn passes, "" when the caller passed
 * nothing, so the parameter is a string all the same - null only in the
 * TypeScript that calls the function itself.
 */
function isOptionalString(parameter: any): boolean {
	const type = typeName(parameter.type);
	return type?.name === 'string' && type.nullable && parameter.initializer?.kind === asc.NodeKind.Null;
}

function pawnDefault(kind: ParamKind, initializer: any): string | null {
	if (!initializer) return null;
	const text = String(asc.ASTBuilder.build(initializer)).trim();

	if (kind === 'player?' && text === 'null') return '0';
	if (kind === 'string' && initializer.kind === asc.NodeKind.Null) return '""';
	if (kind === 'team' && initializer.kind === asc.NodeKind.Literal && TEAM_NAMES.includes(initializer.value)) return String(TEAM_NAMES.indexOf(initializer.value));
	if ((kind === 'int' || kind === 'tag') && /^-?\d+$/.test(text)) return text;
	if (kind === 'float' && /^-?\d+(?:\.\d+)?$/.test(text)) return text.includes('.') ? text : `${text}.0`;
	if (kind === 'bool' && /^(?:true|false)$/.test(text)) return text;
	if (kind === 'string' && initializer.kind === asc.NodeKind.Literal && typeof initializer.value === 'string') {
		// Pawn's escape character is ^, not \.
		const value = initializer.value.replace(/\^/g, '^^').replace(/"/g, '^"').replace(/\n/g, '^n').replace(/\t/g, '^t');
		return `"${value}"`;
	}
	return null;
}

function docOf(text: string, start: number): string {
	// The comment that ends right before the declaration, and only that one.
	const before = text.slice(0, start);
	const end = before.search(/\*\/\s*(?:export\s+)?$/);
	if (end < 0) return '';
	const open = before.lastIndexOf('/**', end);
	return open < 0 ? '' : before.slice(open, end + 2);
}

/**
 * Where a parameter's cells start: an array takes two (the array and its
 * size, as Pawn passes it), everything else one.
 *
 * A string or array result adds two more - `out[], len` - and they go where
 * Pawn puts them: before the first parameter with a default, so that the
 * optional arguments stay last (`value[], len, index = 0`), or at the end
 * when there is none. `out` is that place and `split` how many parameters
 * come before it. The cells after it are two further on only when the buffer
 * is there, and the wrapper learns that from how many cells the caller
 * passed: for a result type that is not written, whether it is a string is
 * known only once the compile is over, after the wrappers are written.
 */
function indexes(params: NativeParam[]): { at: number[]; out: number; split: number; cells: number } {
	const at: number[] = [];
	let next = 0;
	let out = -1;
	let split = params.length;
	params.forEach((param, i) => {
		if (out < 0 && param.pawnDefault !== null) {
			out = next;
			split = i;
		}
		at.push(next);
		next += param.kind === 'ints' || param.kind === 'floats' ? 2 : 1;
	});
	return { at, out: out < 0 ? next : out, split, cells: next };
}

/**
 * A Pawn call's arguments in order: each parameter, and the result's buffer.
 * A contract native also has `output`s - the arguments it writes through, in
 * order - and parameters that come from the `any:...` tail (`byRef`: Pawn
 * passes the tail by address), or a `format` tail the string before it is
 * formatted with.
 */
export type PawnSlot
	= | { param: NativeParam; index: number; byRef?: boolean }
		| { out: true }
		| { output: OutputKind }
		| { format: true };

/** How many arguments a Pawn call of the native passes: an array or an out-buffer is two, itself and its size. */
function pawnArgCount(native: PluginNative): number {
	if (native.declaration) return native.declaration.params.length;
	return pawnLayout(native).reduce((count, slot) =>
		count + ('out' in slot || ('param' in slot && (slot.param.kind === 'ints' || slot.param.kind === 'floats')) ? 2 : 1), 0);
}

/** The order a Pawn plugin passes a native's arguments in - see indexes(). */
export function pawnLayout(native: PluginNative): PawnSlot[] {
	if (native.layout) return native.layout;
	const buffer = ['string', 'string?', 'ints', 'floats'].includes(native.result);
	const { split } = indexes(native.params);
	const slots: PawnSlot[] = native.params.map((param, index) => ({ param, index }));
	if (buffer) slots.splice(split, 0, { out: true });
	return slots;
}

const READERS: Record<ParamKind, string> = {
	'string': '__nativeString',
	'int': '__nativeInt',
	'float': '__nativeFloat',
	'bool': '__nativeBool',
	'ints': '__nativeInts',
	'floats': '__nativeFloats',
	'vector': '__nativeVector',
	'tag': '__nativeCell',
	'player': '__nativePlayer',
	'player?': '__nativePlayer',
	'team': '__nativeTeam',
};

/** How the wrapper reads a parameter at `at`: a Player that passed its check is not null. */
function readOf(kind: ParamKind, at: string): string {
	return kind === 'player' ? `__nativePlayer(${at})!` : `${READERS[kind]}(${at})`;
}

/**
 * The check a wrapper makes before it calls the function, when a parameter
 * is a Player or a Team: every such cell a player slot (or 0 where null is
 * taken), a TeamName number 0 to 3.
 */
function playerCheck(params: NativeParam[], at: (i: number) => string): string | null {
	const checks = params.flatMap((param, i) =>
		param.kind === 'player' || param.kind === 'player?'
			? [`!__nativeTarget(${at(i)}, ${param.kind === 'player?'})`]
			: param.kind === 'team' ? [`!__nativeIsTeam(${at(i)})`] : []);
	return checks.length ? checks.join(' || ') : null;
}

/**
 * A contract native's arguments, as its Pawn declaration lays them out, and
 * how the wrapper reads each TypeScript parameter from them.
 *
 * The TypeScript parameters take the declaration's inputs in order: a
 * `Float:` is read as a float, `bool:` as a boolean, any other tag as a cell,
 * `const x[]` as text (or, for a `number[]` parameter, an array and the size
 * after it), `const Float:x[3]` as a Vector. What the native writes through -
 * `x[]` with the length after it, `&x` - is an output, filled from the
 * function's result. An `any:...` tail is either the TypeScript parameters
 * left over (text, or a number Pawn passes by address), or, when there are
 * none and the tail follows a string, that string formatted with it the way
 * format() does - `%L` included.
 */
interface ContractPlan {
	layout: PawnSlot[];
	params: NativeParam[];
	/** How the wrapper reads each TypeScript parameter. */
	reads: string[];
	/** Each output: its cell, and what is written there. */
	outputs: { at: number; kind: OutputKind }[];
	/** Each parameter's first cell, for the Player check. */
	starts: number[];
}

/** A TypeScript default as the wrapper writes it, or null when it is not a literal. */
function literalDefault(initializer: any): string | null {
	if (!initializer) return null;
	if (initializer.kind !== asc.NodeKind.Literal && initializer.kind !== asc.NodeKind.UnaryPrefix
		&& initializer.kind !== asc.NodeKind.True && initializer.kind !== asc.NodeKind.False) {
		return null;
	}
	return String(asc.ASTBuilder.build(initializer)).trim();
}

function contractPlan(declaration: NativeFunction, parameters: any[], where: string, problems: string[]): ContractPlan | null {
	const pawn = declaration.params;
	const layout: PawnSlot[] = [];
	const params: NativeParam[] = [];
	const reads: string[] = [];
	const outputs: { at: number; kind: OutputKind }[] = [];
	const starts: number[] = [];
	let at = 0;
	let next = 0;
	let lastString = -1;

	const isLength = (param: Parameter | undefined) => param !== undefined && !param.isArray && !param.isRef && !param.isRest;

	for (let i = 0; i < pawn.length; i++) {
		const param = pawn[i];

		if (param.isRest) {
			if (next < parameters.length) {
				// The tail is the TypeScript parameters that are left: Pawn passes
				// each by address, so a number is read through it.
				for (; next < parameters.length; next++, at++) {
					const node = parameters[next];
					const type = typeName(node.type)?.name;
					const kind: ParamKind | null = type === 'string' ? 'string' : type === 'number' ? 'int' : type === 'boolean' ? 'bool' : null;
					if (!kind) {
						problems.push(`${where} - parameter "${node.name.text}": the any:... tail takes string, number or boolean`);
						return null;
					}
					const fallback = literalDefault(node.initializer) ?? (kind === 'string' ? '""' : kind === 'bool' ? 'false' : '0');
					const read = kind === 'string' ? `__nativeString(${at})` : kind === 'bool' ? `__nativeRef(${at}) != 0` : `__nativeRef(${at})`;
					reads.push(`(__nativeCount() > ${at} ? ${read} : ${fallback})`);
					params.push({ name: node.name.text, kind, pawnDefault: pawnDefault(kind, node.initializer) });
					starts.push(at);
					layout.push({ param: params[params.length - 1], index: next, byRef: true });
				}
			} else if (lastString >= 0 && lastString === reads.length - 1) {
				// Nothing takes the tail: the string before it is a format, and
				// the function gets it formatted.
				reads[lastString] = reads[lastString].replace('__nativeString(', '__nativeFormat(');
				layout.push({ format: true });
			}
			break;
		}

		if (param.isRef) {
			const kind: OutputKind = param.type === 'Float' ? 'float-ref' : 'ref';
			outputs.push({ at, kind });
			layout.push({ output: kind });
			at++;
			continue;
		}

		if (param.isArray && !param.isConst) {
			if (!isLength(pawn[i + 1])) {
				problems.push(`${where} - ${param.name}[]: an output array needs its length right after it`);
				return null;
			}
			const kind: OutputKind = param.type === 'Float' ? 'floats' : 'string';
			outputs.push({ at, kind });
			layout.push({ output: kind });
			at += 2;
			i++;
			continue;
		}

		const node = parameters[next];
		if (!node) {
			problems.push(`${where} - takes ${next} parameters, and the include declares more: ${param.name} has none to go to`);
			return null;
		}
		const type = typeName(node.type);
		const tsName = type?.name ?? '';
		const element = type?.name === 'Array' && type.args.length === 1 ? typeName(type.args[0])?.name : undefined;

		let kind: ParamKind;
		let cells = 1;
		if (param.isArray && param.type === 'Float' && param.arraySize === '3') {
			kind = 'vector';
		} else if (param.isArray && element === 'number') {
			if (!isLength(pawn[i + 1])) {
				problems.push(`${where} - ${param.name}[]: an array needs its size right after it`);
				return null;
			}
			kind = param.type === 'Float' ? 'floats' : 'ints';
			cells = 2;
			i++;
		} else if (param.isArray && tsName === 'string') {
			kind = 'string';
		} else if (param.isArray) {
			problems.push(`${where} - parameter "${node.name.text}": ${param.name}[] is text (string) or an array (number[])`);
			return null;
		} else if (tsName === 'Player') {
			kind = type!.nullable ? 'player?' : 'player';
		} else if (tsName === 'Team') {
			// A team crosses as its TeamName number - the Forward's mapping.
			if (param.type !== 'TeamName') {
				problems.push(`${where} - parameter "${node.name.text}": a Team is a TeamName number, and the include declares ${param.type !== 'any' ? `${param.type}:` : ''}${param.name}`);
				return null;
			}
			kind = 'team';
		} else if (param.type === 'Float') {
			kind = 'float';
		} else if (param.type === 'bool' || tsName === 'boolean') {
			kind = 'bool';
		} else if (tsName === 'number') {
			kind = 'int';
		} else {
			kind = 'tag';
		}

		if (kind === 'string') lastString = reads.length;
		reads.push(readOf(kind, String(at)));
		params.push({ name: node.name.text, kind, pawnDefault: pawnDefault(kind, node.initializer), tag: kind === 'tag' ? tsName : undefined });
		starts.push(at);
		layout.push({ param: params[params.length - 1], index: next });
		next++;
		at += cells;
	}

	if (next < parameters.length) {
		problems.push(`${where} - parameter "${parameters[next].name.text}": the include declares no argument for it`);
		return null;
	}
	return { layout, params, reads, outputs, starts };
}

/**
 * The names of the object a native with several outputs returns, in order -
 * off the first object literal in its body. They fill the outputs in order:
 * `{ name, langKey, pointer }` for `szName[], iNameLen, szLangKey[], iLangLen, &iCvarPtr`.
 */
function objectFields(body: any): string[] | null {
	const seen = new Set<any>();
	const walk = (node: any): string[] | null => {
		if (!node || typeof node !== 'object' || seen.has(node)) return null;
		seen.add(node);
		if (node.kind === asc.NodeKind.Literal && node.literalKind === asc.LiteralKind.Object) {
			return node.names.map((n: any) => n.text);
		}
		for (const key of Object.keys(node)) {
			if (key === 'range' || key === 'parent') continue;
			const value = node[key];
			if (Array.isArray(value)) {
				for (const item of value) {
					const found = walk(item);
					if (found) return found;
				}
			} else if (value && typeof value === 'object' && typeof value.kind === 'number') {
				const found = walk(value);
				if (found) return found;
			}
		}
		return null;
	};
	return walk(body);
}

/** What the wrapper of a contract native is made from. */
interface ContractWrapper {
	plan: ContractPlan;
	/** The result object's fields, for a native with several outputs. */
	fields: string[] | null;
	/** Whether the function returns anything at all. */
	returnsValue: boolean;
}

/** The body of a contract native's wrapper: read, call, write back. */
function contractBody(call: string, native: PluginNative, plan: ContractPlan, fields: string[] | null, returnsValue: boolean): string {
	const outputs = plan.outputs;
	if (!returnsValue) return `${call};`;
	if (outputs.length === 0 && native.pawnResult === 'Array') {
		// An `Array:` handle: a list becomes one; an object, an Array of its fields' Arrays.
		if (!fields) return `__nativeResult(__nativePawnArray(${call}));`;
		const each = fields.map(field => `__nativePawnArray(__r!.${field})`).join(', ');
		return [`const __r = ${call};`, 'if (changetype<usize>(__r) == 0) {', '\t\t__nativeResult(0);', '\t\treturn;', '\t}', `__nativeResult(__nativePawnHandles([${each}]));`].join('\n\t');
	}
	if (outputs.length === 0) {
		return native.pawnResult === 'Float' ? `__nativeReturnFloat(${call});` : `__nativeResult(${call});`;
	}

	const single = outputs.length === 1 ? outputs[0] : null;
	if (single && single.kind === 'string') return `__nativeReturn(${call}, ${single.at});`;
	if (single && single.kind === 'floats') return `__nativeReturnFloats(${call}, ${single.at});`;

	// Several outputs, or one through a reference: an object, or null.
	const lines = [`const __r = ${call};`, 'if (changetype<usize>(__r) == 0) {', '\t\t__nativeResult(0);', '\t\treturn;', '\t}'];
	outputs.forEach((output, i) => {
		const field = fields![i];
		const write = output.kind === 'float-ref' || output.kind === 'floats' ? '__nativeOutFloat' : '__nativeOut';
		lines.push(`${write}(__r!.${field}, ${output.at});`);
	});
	lines.push('__nativeResult(1);');
	return lines.join('\n\t');
}

/**
 * What a contract native answers when a Player argument is not a player: the
 * result's default - "" in a single out[] (and 0, its length), 0 otherwise,
 * which Pawn reads as false, 0.0 or null (outputs left alone).
 */
function contractDefault(plan: ContractPlan): string {
	const single = plan.outputs.length === 1 ? plan.outputs[0] : null;
	return single && single.kind === 'string' ? `__nativeReturn("", ${single.at});` : '__nativeResult(0);';
}

/** The hidden entry: one wrapper per native, each registered under its name. */
function wrappersSource(entry: string, natives: PluginNative[], declared: Map<string, ResultKind | null>,	plans: Map<string, ContractWrapper> = new Map()): string {
	const base = entry.replace(/\\/g, '/').split('/').pop()!.replace(/\.ts$/, '');
	const helpers = new Set(['__native', '__nativeCall', '__nativeReturn', '__nativeReturnFloat', '__nativeReturnFloats', '__nativeReturnArray']);
	const lines: string[] = [];

	natives.forEach((native, n) => {
		const contract = plans.get(native.name);
		if (contract) {
			for (const read of contract.plan.reads) {
				for (const m of read.matchAll(/__native\w+/g)) helpers.add(m[0]);
			}
			const check = playerCheck(contract.plan.params, i => String(contract.plan.starts[i]));
			// A native that takes a player and returns nothing still answers
			// whether it ran: 1, and 0 when the id was no player - what the Pawn
			// plugins' natives do (a set_collision_exception), and a caller
			// that ignores the answer loses nothing.
			let body = contractBody(`__n${n}(${contract.plan.reads.join(', ')})`, native, contract.plan, contract.fields, contract.returnsValue);
			if (check && !contract.returnsValue) body += '\n\t__nativeResult(1);';
			const guard = check ? `if (${check}) {\n\t\t${contractDefault(contract.plan)}\n\t\treturn;\n\t}\n\t` : '';
			for (const m of (guard + body).matchAll(/__native\w+/g)) helpers.add(m[0]);
			lines.push(`function __amxts_native${n}(): void {\n\t__nativeCall();\n\t${guard}${body}\n}\n__native("${native.name}", __amxts_native${n});`);
			return;
		}

		const { at, out, split, cells } = indexes(native.params);
		// Past the buffer's place a cell is two further on when the caller
		// passed a buffer: `__s` is 2 then, and 0 otherwise.
		const shifted = split < native.params.length;
		if (shifted) helpers.add('__nativeShift');
		const args = native.params.map((param, i) => {
			helpers.add(READERS[param.kind]);
			return readOf(param.kind, `${at[i]}${i >= split ? ' + __s' : ''}`);
		}).join(', ');
		const call = `__n${n}(${args})`;
		const result = declared.get(native.name);
		const check = playerCheck(native.params, i => `${at[i]}${i >= split ? ' + __s' : ''}`);
		if (check) helpers.add('__nativeTarget').add('__nativeSkip');
		const guard = check ? `if (${check}) {\n\t\t__nativeSkip(${out}, ${cells});\n\t\treturn;\n\t}\n\t` : '';

		const body = result === 'void'
			? `${call};`
			: result === 'float'
				? `__nativeReturnFloat(${call});`
				: result === 'floats'
					? `__nativeReturnFloats(${call}, ${out});`
					: result === 'array'
						? `__nativeReturnArray(${call});`
						: `__nativeReturn(${call}, ${out});`;
		const shift = shifted ? `const __s = __nativeShift(${cells});\n\t` : '';

		lines.push(`function __amxts_native${n}(): void {\n\t__nativeCall();\n\t${shift}${guard}${body}\n}\n__native("${native.name}", __amxts_native${n});`);
	});

	return [
		'// GENERATED by scripts/plugin-natives.ts: the natives this plugin exports.',
		`import { ${[...helpers].join(', ')} } from "~/facade";`,
		`import { ${natives.map((native, n) => `${native.name} as __n${n}`).join(', ')} } from "./${base}";`,
		'',
		...lines,
		'',
	].join('\n');
}

/**
 * The transform for one compile. `found` is filled with the plugin's natives
 * once the compile is over; an unsupported signature stops the compile with
 * a message naming the function and the parameter.
 */
export function nativesTransform(entry: string, found: PluginNative[], root: string = 'as'): any {
	const wanted = entry.replace(/\\/g, '/').replace(/\.ts$/, '');
	let source: any = null;
	const declared = new Map<string, ResultKind | null>();
	const enums: PluginEnum[] = [];
	ENUMS.set(found, enums);

	return class {
		afterParse(parser: any): void {
			source = parser.sources.find((s: any) =>
				s.sourceKind === asc.SourceKind.UserEntry && s.normalizedPath.replace(/\.ts$/, '') === wanted) ?? null;
			if (!source) return;

			const problems: string[] = [];
			const contract = readContract(source, entry, root, problems);
			const author = pluginInfo(source).author;
			if (author) AUTHORS.set(found, author);
			const plans = new Map<string, ContractWrapper>();

			// An exported enum is a Pawn enum: its name is the tag a parameter or
			// a result typed with it carries, its members the constants.
			for (const statement of source.statements) {
				if (statement.kind !== asc.NodeKind.EnumDeclaration) continue;
				if (!(statement.flags & asc.CommonFlags.Export)) continue;
				const members: { name: string; value: number }[] = [];
				let next = 0;
				for (const member of statement.values) {
					const text = member.initializer ? String(asc.ASTBuilder.build(member.initializer)).trim() : String(next);
					if (!/^-?\d+$/.test(text)) {
						problems.push(`${source.normalizedPath}: export enum ${statement.name.text} - ${member.name.text} = ${text}: a Pawn enum takes whole-number literals`);
						continue;
					}
					members.push({ name: member.name.text, value: Number(text) });
					next = Number(text) + 1;
				}
				enums.push({ name: statement.name.text, members, doc: docOf(source.text, statement.range.start) });
			}
			const tags = new Set(enums.map(e => e.name));
			const tagOf = (node: any) => {
				const type = typeName(node);
				return type && tags.has(type.name) ? type.name : undefined;
			};

			for (const statement of source.statements) {
				if (statement.kind !== asc.NodeKind.FunctionDeclaration) continue;
				if (!(statement.flags & asc.CommonFlags.Export) || (statement.flags & asc.CommonFlags.Ambient)) continue;

				const name: string = statement.name.text;
				if (!isNative(name)) continue;
				const where = `${source.normalizedPath}: export function ${name}`;

				if (statement.typeParameters?.length) {
					problems.push(`${where} - a native cannot be generic`);
					continue;
				}
				if (name.length > 31) problems.push(`${where} - Pawn names are at most 31 characters`);

				const declaration = contract?.natives.get(name);
				if (declaration) {
					const plan = contractPlan(declaration, statement.signature.parameters, where, problems);
					if (!plan) continue;
					const arrayResult = declaration.returnType === 'Array' && plan.outputs.length === 0;
					const several = plan.outputs.length > 1 || plan.outputs.some(o => o.kind === 'ref' || o.kind === 'float-ref');
					const fields = several || arrayResult ? objectFields(statement.body) : null;
					if (several && (!fields || fields.length !== plan.outputs.length)) {
						problems.push(`${where} - ${declaration.name} writes ${plan.outputs.length} arguments: return an object literal with a field for each, in order, or null`);
						continue;
					}
					const writtenType = typeName(statement.signature.returnType)?.name ?? '';
					const written = writtenType !== '' && writtenType !== 'void';
					plans.set(name, { plan, fields, returnsValue: written || statement.signature.inferFrom?.length > 0 });

					// The result as Pawn reads it: the declaration's tag says float
					// or bool; an object is true, null false; the rest is inferred.
					const pawnResult = declaration.returnType;
					const result: ResultKind | null = arrayResult ? 'array' : fields ? 'bool' : pawnResult === 'Float' ? 'float' : null;
					declared.set(name, result);
					found.push({
						name,
						params: plan.params,
						result: result ?? 'void',
						doc: docOf(source.text, statement.range.start),
						layout: plan.layout,
						pawnResult,
						declaration,
					});
					continue;
				}

				const params: NativeParam[] = [];
				for (const parameter of statement.signature.parameters) {
					const paramName: string = parameter.name.text;
					const kind = isOptionalString(parameter) ? 'string' : paramKind(parameter.type, tags);
					if (parameter.parameterKind === asc.ParameterKind.Rest || !kind) {
						const written = parameter.type ? String(asc.ASTBuilder.build(parameter.type)) : '?';
						problems.push(`${where} - parameter "${paramName}: ${written}": a native takes string, number, Float, boolean, number[], Float[], Vector, Player or an exported enum`);
						continue;
					}
					params.push({ name: paramName, kind, pawnDefault: pawnDefault(kind, parameter.initializer), tag: tagOf(parameter.type) });
				}

				// A written type is the result; an omitted one is `void` unless the
				// body returns a value, and then the compiler says which type.
				const returnType = statement.signature.returnType;
				const omitted = typeName(returnType)?.name === '';
				const result = !omitted
					? resultKind(returnType, tags)
					: statement.signature.inferFrom?.length
						? null
						: 'void';
				if (!omitted && !result) {
					problems.push(`${where} - result ${String(asc.ASTBuilder.build(returnType))}: a native returns string, string | null, number, Float, boolean, number[], Float[], CellArray or an exported enum`);
				}
				declared.set(name, result);

				const resultTag = result === 'tag' ? tagOf(returnType) : undefined;
				found.push({ name, params, result: result ?? 'void', resultTag, doc: docOf(source.text, statement.range.start) });
			}

			// The include is a promise to the Pawn plugins compiled against it:
			// every native it declares has to be there.
			if (contract) {
				for (const declaredName of contract.natives.keys()) {
					if (!found.some(native => native.name === declaredName)) {
						problems.push(`${source.normalizedPath}: ${contract.file} declares ${declaredName}, and the plugin does not export it`);
					}
				}
				CONTRACTS.set(found, contract);
			}

			crossForwards(parser.sources, contract, problems);

			if (problems.length) throw new Error(problems.join('\n'));
			if (found.length === 0) return;

			const dir = source.normalizedPath.includes('/') ? source.normalizedPath.replace(/\/[^/]*$/, '/') : '';
			parser.parseFile(wrappersSource(source.normalizedPath, found, declared, plans), `${dir}${WRAPPERS}`, true);
		}

		afterCompile(): void {
			if (!source) return;
			const program = (this as any).program;
			const problems: string[] = [];

			for (const native of found) {
				if (declared.get(native.name)) continue;
				const instance = program.instancesByName.get(`${source.internalPath}/${native.name}`);
				const kind = instance?.signature ? inferredKind(instance.signature.returnType) : null;
				if (!kind) {
					const text = instance?.signature ? String(instance.signature.returnType.toString()) : 'unknown';
					problems.push(`${source.normalizedPath}: export function ${native.name} - result ${text}: a native returns string, string | null, number, Float, boolean, number[], Float[], CellArray or an exported enum`);
					continue;
				}
				native.result = kind;
			}

			// Counted once every result is known: a string result adds an out-buffer.
			for (const native of found) {
				const count = pawnArgCount(native);
				if (count > MAX_NATIVE_ARGS) {
					problems.push(`${source.normalizedPath}: export function ${native.name} - Pawn passes it ${count} arguments, and a native takes at most ${MAX_NATIVE_ARGS}: pass an array or split it`);
				}
			}

			if (problems.length) throw new Error(problems.join('\n'));
		}
	};
}

// A Forward's arguments, as its Pawn declaration has them.
//
//   export const playerJoinedTeam = new Forward<Player, Team>("myplugin_on_player_joined_team");
//   // forward myplugin_on_player_joined_team(id, TeamName:iTeam);
//
// `Team` is a string in compiled code, so without the declaration the facade
// could only send Pawn the text "CT". The build finds the forward in the
// plugin's include contract or in any include it knows, and tells the Forward
// how each argument crosses: an extra constructor argument, one letter per
// argument - `t` a team as its TeamName number, `w` a round's winner as its
// WinStatus number, `f` a number as a Float, `F` an array as Floats, `_` as
// the type says. A forward no include declares crosses as its types say, a
// `Float` and a `Float[]` as Floats. A string where Pawn has a cell, an array
// where it has a cell, a Team for a forward no include declares, and a count
// that does not match are build errors: the value would otherwise reach Pawn
// in silence.

/** Every forward the includes declare, by name; read once. */
let knownForwards: Map<string, ForwardDeclaration> | null = null;

function includeForwards(): Map<string, ForwardDeclaration> {
	if (knownForwards) return knownForwards;
	knownForwards = new Map();
	for (const name of listIncludes()) {
		let text: string;
		try {
			text = readInclude(name);
		} catch {
			continue;
		}
		for (const forward of new IncludeParser(text).parse().forwards) {
			if (!knownForwards.has(forward.name)) knownForwards.set(forward.name, forward);
		}
	}
	return knownForwards;
}

/** A file of the plugin, as opposed to AssemblyScript's library and the hood. */
function isPluginFile(source: any): boolean {
	const path: string = source.internalPath;
	if (!path.startsWith('~lib/')) return true;
	if (!path.startsWith('~lib/~/')) return false;
	return !['facade', 'natives', 'constants', 'events', 'entities', 'hooks', 'flags'].includes(path.slice(7));
}

/** A Forward's arrays, as writtenType names them. */
const ARRAY_TYPES = new Set(['number[]', 'Float[]', 'Vector']);

/** A Forward's type argument by name: `Player`, `string`, `number[]`, `Float[]`. */
function writtenType(node: any): string {
	const type = typeName(node);
	if (type?.name === 'Array' && type.args.length === 1) return `${typeName(type.args[0])?.name ?? '?'}[]`;
	return type?.name ?? '?';
}

/** Every `new Forward<...>(...)` under a node. */
function forwardsIn(node: any, found: any[], seen: Set<any> = new Set()): any[] {
	if (!node || typeof node !== 'object' || seen.has(node)) return found;
	seen.add(node);
	if (Array.isArray(node)) {
		for (const item of node) forwardsIn(item, found, seen);
		return found;
	}
	if (node.kind === asc.NodeKind.New && node.typeName?.identifier?.text === 'Forward') found.push(node);
	for (const key of Object.keys(node)) {
		if (key === 'range' || key === 'source' || key === 'parent') continue;
		const value = node[key];
		if (value && typeof value === 'object') forwardsIn(value, found, seen);
	}
	return found;
}

function crossForwards(sources: any[], contract: Contract | null, problems: string[]): void {
	const plugin = sources.filter(isPluginFile);

	// A type alias for a string - `type GameMode = "normal" | ... | (string & {})` -
	// is a string as it crosses, whatever its name says.
	const stringAliases = new Set<string>(['string']);
	for (const source of plugin) {
		for (const statement of source.statements) {
			if (statement.kind === asc.NodeKind.TypeDeclaration && typeName(statement.type)?.name === 'string') {
				stringAliases.add(statement.name.text);
			}
		}
	}
	stringAliases.delete('Team');

	const contractForwards = contract ? new IncludeParser(contract.text).parse().forwards : [];
	for (const source of plugin) {
		for (const node of forwardsIn(source.statements, [])) {
			const written: string[] = (node.typeArguments ?? []).map(writtenType);
			const first = node.args[0];
			const name = first && first.kind === asc.NodeKind.Literal && first.literalKind === asc.LiteralKind.String ? first.value as string : null;
			const where = `${source.normalizedPath}: new Forward<${written.join(', ')}>(${name ? `"${name}"` : '...'})`;

			const declaration = name ? contractForwards.find(f => f.name === name) ?? includeForwards().get(name) : undefined;
			if (!declaration) {
				if (written.includes('Team') || written.includes('RoundWinner')) {
					problems.push(`${where} - no include declares ${name ?? 'this forward'}, so nothing says Pawn wants a number: a Team or a RoundWinner would go as text; declare the forward in an include`);
				}
				// Without a declaration the types say it: a Float, and a Float[], as Floats.
				const crossing = written.map(type => type === 'Float' ? 'f' : type === 'Float[]' ? 'F' : '_').join('');
				if (/[^_]/.test(crossing) && node.args.length === 1) {
					node.args.push(asc.Node.createStringLiteralExpression(crossing, node.range));
				}
				continue;
			}

			if (written.length !== declaration.params.length) {
				problems.push(`${where} - the include declares ${declaration.name} with ${declaration.params.length} argument(s)`);
				continue;
			}

			let crossing = '';
			declaration.params.forEach((param, i) => {
				const type = written[i];
				// Float:pos[3] is numbers, not text.
				const text = param.isArray === true && param.type !== 'Float';
				const pawn = `${param.type !== 'any' ? `${param.type}:` : ''}${param.name}${param.isArray ? '[]' : ''}`;
				if (ARRAY_TYPES.has(type)) {
					if (!param.isArray) {
						problems.push(`${where} - argument ${i + 1} is ${pawn} in the include, a cell: a ${type} would go as an array`);
					} else if (type === 'Vector' && param.type !== 'Float') {
						problems.push(`${where} - argument ${i + 1} is ${pawn} in the include: a Vector is three Floats, Float:${param.name}[3]`);
					} else if (!param.type || param.type === 'any') {
						// The host's public takes an untagged array as text (generate-host.ts, kindOf).
						problems.push(`${where} - argument ${i + 1} is ${pawn} in the include, without a tag: Pawn passes it as text, and a ${type} would arrive empty; tag it, Float:${param.name}[]`);
					} else {
						crossing += param.type === 'Float' ? 'F' : '_';
					}
				} else if (type === 'Team' && !text) {
					crossing += 't';
				} else if (type === 'RoundWinner' && param.type === 'WinStatus') {
					crossing += 'w';
				} else if (type === 'RoundWinner') {
					problems.push(`${where} - argument ${i + 1} is ${pawn} in the include: a RoundWinner crosses only as a WinStatus`);
				} else if (stringAliases.has(type) && !text) {
					problems.push(`${where} - argument ${i + 1} is ${pawn} in the include, a cell: a ${type} would go as text${param.type === 'TeamName' ? '; write Team' : '; send its number'}`);
				} else if (text && !stringAliases.has(type)) {
					problems.push(`${where} - argument ${i + 1} is ${pawn} in the include: text, not a ${type}`);
				} else if ((type === 'number' || type === 'Float') && param.type === 'Float') {
					crossing += 'f';
				} else {
					crossing += '_';
				}
			});

			if (/[^_]/.test(crossing) && node.args.length === 1) {
				node.args.push(asc.Node.createStringLiteralExpression(crossing, node.range));
			}
		}
	}
}

// Pawn's own words, which a parameter cannot be called.
const PAWN_RESERVED = new Set([
	'assert',
	'break',
	'case',
	'char',
	'const',
	'continue',
	'default',
	'defined',
	'do',
	'else',
	'enum',
	'exit',
	'for',
	'forward',
	'goto',
	'if',
	'native',
	'new',
	'operator',
	'public',
	'return',
	'sizeof',
	'sleep',
	'state',
	'static',
	'stock',
	'switch',
	'tagof',
	'while',
	'decl',
]);

/** A plugin's name as a Pawn identifier: `api-natives` is `api_natives`. */
export function includeName(plugin: string): string {
	return plugin.replace(/\W/g, '_');
}

/** The `native` line of one of them, with its comment. */
export function pawnNative(native: PluginNative): string {
	const used = new Set<string>();
	const name = (wanted: string) => {
		let n = PAWN_RESERVED.has(wanted) ? `${wanted}_` : wanted;
		while (used.has(n)) n += '_';
		used.add(n);
		return n;
	};
	// The parameters keep their own names: a named argument (`.index = 1`)
	// is written with them, so the buffer's `out` is the one to give way.
	// `player: Player` is `id` in Pawn, the name every AMX Mod X include
	// gives a player - and the one the include had before it took a Player.
	// A parameter the function ignores (`_isCritical`) is still the one Pawn
	// passes, under its own name.
	const own = native.params.map(param =>
		name(param.name === 'player' && (param.kind === 'player' || param.kind === 'player?') ? 'id' : param.name.replace(/^_\B/, '')));

	const result = native.result;
	const params: string[] = [];
	for (const slot of pawnLayout(native)) {
		if ('out' in slot) {
			if (result === 'string' || result === 'string?') params.push(`${name('out')}[]`, name('len'));
			if (result === 'ints') params.push(`${name('out')}[]`, name('size'));
			if (result === 'floats') params.push(`Float:${name('out')}[]`, name('size'));
			continue;
		}
		if (!('param' in slot)) continue;
		const param = slot.param;
		const n = own[slot.index];
		const fallback = param.pawnDefault === null ? '' : ` = ${param.pawnDefault}`;
		if (param.kind === 'string') params.push(`const ${n}[]${fallback}`);
		else if (param.kind === 'int' || param.kind === 'player' || param.kind === 'player?') params.push(`${n}${fallback}`);
		else if (param.kind === 'tag') params.push(`${param.tag}:${n}${fallback}`);
		else if (param.kind === 'float') params.push(`Float:${n}${fallback}`);
		else if (param.kind === 'bool') params.push(`bool:${n}${fallback}`);
		else if (param.kind === 'vector') params.push(`const Float:${n}[3]`);
		else params.push(`const ${param.kind === 'floats' ? 'Float:' : ''}${n}[]`, name(`${param.name}_size`));
	}

	const tag = result === 'float'
		? 'Float:'
		: result === 'bool' || result === 'string?'
			? 'bool:'
			: result === 'tag'
				? `${native.resultTag}:`
				: result === 'array'
					? 'Array:'
					: '';
	const line = `native ${tag}${native.name}(${params.join(', ')});`;
	return native.doc ? `${native.doc.replace(/^[ \t]+/gm, ' ').replace(/^ \/\*\*/, '/**')}\n${line}` : line;
}

/** An `export enum` as Pawn writes it, with its comment. */
export function pawnEnum(declared: PluginEnum): string {
	const members = declared.members.map(m => `\t${m.name} = ${m.value}`).join(',\n');
	const text = `enum ${declared.name} {\n${members}\n}`;
	return declared.doc ? `${declared.doc.replace(/^[ \t]+/gm, ' ').replace(/^ \/\*\*/, '/**')}\n${text}` : text;
}

/** The include a Pawn plugin writes `#include <name>` for. */
export function pawnInclude(plugin: string, natives: PluginNative[]): string {
	// A plugin that implements an include hands out that include, as it is:
	// what the Pawn plugins were compiled against. Natives it adds of its own
	// follow, declared from their TypeScript types.
	const contract = nativeContract(natives);
	if (contract) {
		const extra = natives.filter(native => !native.declaration);
		if (extra.length === 0) return contract.text;
		return `${contract.text.trimEnd()}\n\n/* Added by the TypeScript plugin that implements this include. */\n\n${extra.map(pawnNative).join('\n\n')}\n`;
	}

	const guard = `_${includeName(plugin)}_included`;
	const enums = nativeEnums(natives);
	return [
		'/*',
		` * ${plugin} - natives`,
		// A */ in the name would end the comment: *\/ does not.
		...(AUTHORS.has(natives) ? [` * Author: ${AUTHORS.get(natives)!.replaceAll('*/', '*\\/')}`] : []),
		' *',
		` * Generated by amxts from ${plugin}.ts. Do not edit it: change the plugin`,
		' * and build it again.',
		' *',
		' * A string result is written into out[], len being its size (charsmax).',
		' * The native returns the string\'s length - or, when there may be no',
		' * string, bool: whether there was one. An array result goes into out[],',
		' * size being its size, and the native returns how many cells it wrote.',
		' */',
		'',
		`#if defined ${guard}`,
		'\t#endinput',
		'#endif',
		`#define ${guard}`,
		'',
		...enums.map(declared => `${pawnEnum(declared)}\n`),
		natives.map(pawnNative).join('\n\n'),
		'',
	].join('\n');
}
