import type { NativeFunction, Parameter } from '../src/types';
// Generates the three faces of the native table, from one parse of includes/*.inc:
//
//   as/natives.ts           what a plugin imports
//   runtime/src/natives.h   the thunks the module registers
//   runtime/natives.txt     the signatures wamrc reads
//
// All three come from here on purpose. A signature the compiler believes and
// the host does not is only caught when it disagrees about arity; `$` and `*`
// would pass every check and miscompile in silence, so the table is all-i and
// the three files can only be wrong together.
//
// The ABI is Pawn's own: a native takes cells and returns a cell. A float is a
// cell holding its bit pattern, and an array is a pointer into the plugin's
// memory that the thunk copies into the AMX heap before the call and back
// afterwards. Copying both ways means the generator never has to guess
// whether a native reads an array or fills it — the question that the JS
// wrapper generator has a page of heuristics for. Text is the exception: a
// `const` string is the plugin's own string, which the thunk writes into the
// heap as UTF-8 in one pass, and the text a typed wrapper asks a native for
// comes back as UTF-8 bytes up to its end - the wrapper's buffer is empty, so
// nothing goes in.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IncludeParser } from '../src/parser/include-parser';
import { listIncludes, parseOrder, readInclude, resolveTransitive } from './includes';
import { evaluate } from './pawn-value';

const includesDir = './includes';

// The frame in runtime/src/module.cpp holds 32 cells: one for the argument
// count and 31 arguments. Nothing in the includes comes close.
const MAX_PARAMS = 31;

// How many cells to copy for an array whose size the declaration does not give
// and that has no length parameter beside it - at most: a buffer at the end of
// the plugin's memory is copied as far as the memory goes (Frame::fits in
// runtime/src/module.cpp).
const DEFAULT_CELLS = 128;

// AssemblyScript keeps these for itself. A native named like one gets an
// underscore in the plugin-facing declaration; the name wamrc and the module
// see is unchanged, because @external carries it.
const RESERVED = new Set([
	// Type names this port gives a meaning: float.inc's `float(value)` would
	// otherwise shadow the `float` type throughout as/natives.ts.
	'float',
	'number',
	'boolean',
	'string',
	'abstract',
	'as',
	'async',
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'declare',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'from',
	'function',
	'get',
	'if',
	'implements',
	'import',
	'in',
	'instanceof',
	'interface',
	'is',
	'let',
	'module',
	'namespace',
	'new',
	'null',
	'of',
	'package',
	'private',
	'protected',
	'public',
	'readonly',
	'return',
	'set',
	'static',
	'super',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'type',
	'typeof',
	'var',
	'void',
	'while',
	'with',
	'yield',
]);

/** A parameter the thunk has to copy: an array, or a `&x` output cell. */
function isBuffer(p: Parameter): boolean {
	return Boolean(p.isArray || p.isRef);
}

/**
 * A `const name[]` with no size: a string going in, and nothing coming back.
 *
 * These cannot use the length heuristic below, because the argument after them
 * is usually not a length - `register_concmd(const cmd[], const function[],
 * flags, ...)` would read `flags` as the size of the callback's name, and -1
 * cells is an empty string. They do not need one either: a Pawn string ends at
 * its zero cell, which the module scans for. `const` is also what says the
 * native cannot write to it, so there is nothing to copy back - and copying
 * back a guessed length is how a plugin's memory gets overwritten past the end
 * of the buffer it passed.
 */
function isInputString(p: Parameter, next: Parameter | undefined): boolean {
	return Boolean(p.isConst && p.isArray && !p.isRef && !p.arraySize) && !isLength(next);
}

/**
 * Whether the parameter after a buffer is that buffer's length.
 *
 * Told by its name, because nothing else distinguishes `get_user_name(index,
 * name[], len)` from `register_concmd(cmd[], function[], flags, ...)` - and
 * reading `flags` as a length gave an empty string, while reading nothing as a
 * length turned `ArrayPushArray(which, input[], size)` into a string and its
 * data into whatever lay before the first zero cell.
 */
function isLength(p: Parameter | undefined): boolean {
	if (!p || isBuffer(p) || p.isRest) return false;

	// `maxlen`, `len`, `iLen` - and a name that ends in its unit, `OutputSize`,
	// which LookupLangKey uses and which was read as no length at all: the
	// thunk then copied a fixed 128 cells whatever the plugin passed.
	return /^(?:i|sz|n|the)?_?(?:max)?_?(?:len|size|cells|chars|count|num)/i.test(p.name)
		|| /[a-z](?:Size|Len|Length)$/.test(p.name);
}

/**
 * How many cells a buffer parameter spans.
 *
 * The size in the declaration is the truth: a number, or a name or an
 * expression the includes define (`players[MAX_PLAYERS]`), resolved as the
 * constants are. Otherwise AMX Mod X's own convention holds: the parameter
 * after the array is its length, and the plugin passes it, so the thunk reads
 * it at runtime — `A(n)` below is that argument. `&x` is one cell. Else it is
 * a guess, DEFAULT_CELLS at most, and the generator lists it.
 */
function cellCount(native: NativeFunction, index: number): string {
	const p = native.params[index];
	if (p.isRef && !p.isArray) return '1';

	const size = p.arraySize ? evaluate(p.arraySize, known) : null;
	if (size !== null && size > 0) return String(size);

	if (isLength(native.params[index + 1])) return `a${index + 1}`;

	// A guess: the thunk counts it once, `n<index>`, for the copy in and the copy back.
	return `n${index}`;
}

/** How many cells each buffer of a native spans; '' for any other parameter, and for a string going in. */
function bufferCells(native: NativeFunction): string[] {
	return native.params.map((p, i) => isBuffer(p) && !isInputString(p, native.params[i + 1]) ? cellCount(native, i) : '');
}

/**
 * The text buffers a native fills that come back as the typed wrapper's
 * result: the wrapper's own buffer, empty, so the thunk copies nothing in
 * and only the text, up to its end, back.
 */
function outputTexts(native: NativeFunction): Set<number> {
	const kinds = kindsOf(native) ?? [];
	return new Set(kinds.flatMap((k, i) => (k.kind === 'output' ? [i] : [])));
}

/**
 * How the module's thunk passes a native's arguments, as its line of
 * runtime/natives.txt ends: a string going in `s` (the plugin's own string),
 * text the native fills `t` (its length is the next argument, and it comes
 * back as UTF-8 bytes up to its end), a buffer `[` with the cells it spans
 * and `>` when it comes back, a cell `v` - nothing for a native of cells
 * alone. wamrc reads a line's first two words; the plugins' ABI hashes the
 * whole line (scripts/build-identity.ts), so a parameter that turns from a
 * cell into a buffer, or stops coming back, is another ABI, though the wasm
 * signature stays the same.
 */
function crossing(native: NativeFunction): string {
	if (!native.params.some(isBuffer)) return '';
	const cells = bufferCells(native);
	const texts = outputTexts(native);
	return ` ${native.params.map((p, i) => !isBuffer(p) ? 'v' : !cells[i] ? 's' : texts.has(i) ? 't' : `[${cells[i]}${p.isConst ? '' : '>'}`).join(',')}`;
}

function asName(name: string): string {
	return RESERVED.has(name) ? `${name}_` : name;
}

const orderFile = join(includesDir, 'order.txt');
const { includes, denied } = existsSync(orderFile)
	? parseOrder(readFileSync(orderFile, 'utf-8'))
	: { includes: listIncludes(), denied: new Set<string>() };

// Denied too: a deny marker says its natives must not reach the host table,
// not that the file is uninteresting. Its constants and its forwards are free
// - nothing links against a number - and leaving them out means a plugin
// cannot name a constant the include exists to define.
const parseNames = resolveTransitive(includes.concat(Array.from(denied)));
const macros = new Map();
for (const name of parseNames) {
	IncludeParser.collectMacrosFrom(readInclude(name), macros);
}

/**
 * `#define get_member get_member_s` - a native the include renames itself.
 *
 * reapi does this to both member accessors unless MEMBER_UNSAFE is defined,
 * and the host plugin is compiled by the same amxxpc reading the same header,
 * so what lands in its table is `get_member_s`. A plugin still writes
 * `get_member`, as Pawn code does, so the declaration keeps that name and only
 * the name the module looks up in the table is the renamed one.
 *
 * Found the hard way: the module said "not in the host plugin table" and the
 * table looked right, because the rename happens after the table was written.
 */
const aliases = new Map<string, string>();

for (const name of parseNames) {
	for (const line of readInclude(name).split('\n')) {
		const alias = line.trim().match(/^#define\s+(\w+)\s+(\w+)\s*$/);
		if (alias) aliases.set(alias[1], alias[2]);
	}
}

/**
 * The name the module asks the host plugin table for.
 *
 * Only a rename onto another native counts: `#define MAX_PLAYERS 32` has the
 * same shape and means nothing here.
 */
function lookupName(name: string): string {
	const alias = aliases.get(name);
	return alias && alias !== name && declaredNatives.has(alias) ? alias : name;
}

const natives: NativeFunction[] = [];
const declaredNatives = new Set<string>();

/**
 * Pawn has no namespaces: an enum's members are global constants like any
 * other, so both end up in one list. An enum stays grouped because its members
 * count from each other - a member with no value of its own is the one before
 * it plus one.
 */
interface Member { name: string; value?: string; docs?: string }
type Item = { kind: 'constant'; member: Member } | { kind: 'enum'; members: Member[] };

const values: Item[] = [];

for (const name of parseNames) {
	const parsed = new IncludeParser(readInclude(name), macros).parse();

	if (!denied.has(name)) natives.push(...parsed.natives);
	// Every name a #define could legitimately point at, denied ones included.
	for (const native of parsed.natives) declaredNatives.add(native.name);

	for (const constant of parsed.constants)
		values.push({ kind: 'constant', member: constant });

	for (const declaration of parsed.enums)
		values.push({ kind: 'enum', members: declaration.members });
}

const seen = new Map<string, NativeFunction>();
const variadic: NativeFunction[] = [];
const skipped: string[] = [];

for (const native of natives) {
	const first = seen.get(native.name);

	if (first) {
		// Two includes declaring one name with different arities would have us
		// tell wamrc something the host cannot honour.
		if (first.params.length !== native.params.length)
			skipped.push(`${native.name}: declared twice with different arities`);
		continue;
	}

	// WebAssembly has no variadic import, so these cannot have a signature and
	// cannot be called directly. They go through the dispatcher instead: the
	// plugin describes each argument, the module lays out the AMX frame. See
	// amxts_call in runtime/src/module.cpp.
	if (native.params.some(p => p.isRest)) {
		variadic.push(native);
		continue;
	}

	if (native.params.length > MAX_PARAMS) {
		skipped.push(`${native.name}: ${native.params.length} parameters`);
		continue;
	}

	seen.set(native.name, native);
}

const chosen = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));

// The id a plugin passes to the dispatcher is this array's index, so the order
// is part of the interface between as/natives.ts and runtime/src/natives.h.
// Both are written below, from this one list.
const dispatched = Array.from(new Map(variadic.map(n => [n.name, n])).values())
	.sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------- as/constants.ts
//
// Resolved before the thunks are written: an array's size can name one (cellCount).

/** A string constant, which a few of them are. */
function stringValue(raw: string): string | null {
	const text = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/, '').trim();
	return /^".*"$/.test(text) ? text : null;
}

const nativeNames = new Set(chosen.map(n => n.name));
const known = new Map<string, number>();
const constantLines: string[] = [];
let skippedConstants = 0;

function emit(member: Member, value: number | string): void {
	if (member.docs) constantLines.push(`/** ${member.docs.split('\n')[0]} */`);
	constantLines.push(typeof value === 'number'
		? `export const ${member.name}: i32 = ${value};`
		: `export const ${member.name}: string = ${value};`);
}

function taken(name: string): boolean {
	return known.has(name) || nativeNames.has(name) || RESERVED.has(name);
}

/**
 * Items are emitted in as many passes as it takes.
 *
 * One constant refers to another across includes, and the includes are not
 * parsed in dependency order: reapi's hookchain ids are
 * `MAX_REGION_RANGE * ht_player`, and both of those names live in a file
 * parsed after the one that uses them. Going round again until a pass resolves
 * nothing new costs three or four passes.
 */
let pending = values;

while (pending.length) {
	const left: Item[] = [];
	let emitted = 0;

	for (const item of pending) {
		if (item.kind === 'constant') {
			const member = item.member;
			if (taken(member.name)) continue;

			const text = stringValue(member.value!);
			if (text !== null) {
				emit(member, text);
				known.set(member.name, 0);
				emitted++;
				continue;
			}

			const value = evaluate(member.value!, known);
			if (value === null) {
				left.push(item);
				continue;
			}

			emit(member, value);
			known.set(member.name, value);
			emitted++;
			continue;
		}

		// An enum: its members count from each other, so the first one that
		// cannot be resolved stops the counting. Pawn's own auto-increment
		// works the same way, and reapi opens every hookchain region with a
		// computed member - counting past one of those from zero is what made
		// the JavaScript generator register unrelated hookchains.
		let auto: number | null = 0;
		let stuck = false;

		for (const member of item.members) {
			if (taken(member.name)) {
				if (known.has(member.name)) auto = known.get(member.name)! + 1;
				continue;
			}

			const value: number | null = member.value !== undefined
				? evaluate(member.value, known)
				: auto;

			if (value === null) {
				// A name it needs may still be waiting on another include.
				if (member.value !== undefined && /[A-Z_]/i.test(member.value)) stuck = true;
				auto = null;
				continue;
			}

			emit(member, value);
			known.set(member.name, value);
			auto = value + 1;
			emitted++;
		}

		if (stuck) left.push(item);
	}

	if (!emitted) break;
	pending = left;
}

for (const item of pending)
	skippedConstants += item.kind === 'constant' ? 1 : item.members.length;

// ------------------------------------------------------------------ as/natives.ts

// ------------------------------------------------------------------ typed natives
//
// What a plugin calls is not the raw import but a wrapper with the types the
// include declares: `rg_round_end(5.0, WINSTATUS_TERRORISTS, ROUND_TERRORISTS_WIN)`
// rather than cells and addresses. A Float: is a number, a bool: is a boolean,
// a string is a string, a buffer the native fills comes back as the result,
// and a default in the include is a default here. Every conversion happens in
// the wrapper, and --optimize inlines it, so the plugin pays for none of it.
//
// A native whose shape this cannot read with confidence - a `&reference`, an
// `any:` array, two buffers to fill - keeps its raw form under its own name,
// and the facade wraps it by hand where a plugin needs it.

/** `#define NAME 1.0` and its like, for a default that names one. */
const defineValues = new Map<string, string>();

for (const name of parseNames) {
	for (const line of readInclude(name).split('\n')) {
		const define = line.trim().match(/^#define\s+(\w+)\s+(-?\d+(?:\.\d+)?)\s*(?:\/\/.*|\/\*.*\*\/\s*)?$/);
		if (define) defineValues.set(define[1], define[2]);
	}
}

for (const item of values) {
	if (item.kind === 'constant') {
		const value = item.member.value?.trim() ?? '';
		if (/^-?\d+(?:\.\d+)?$/.test(value)) defineValues.set(item.member.name, value);
		continue;
	}

	// An enum member without a value of its own is the one before it plus one,
	// starting from zero - which is how ROUND_NONE comes to be a default here.
	let next = 0;
	for (const member of item.members) {
		const value = member.value?.trim();
		if (value !== undefined && value !== '') {
			if (!/^-?\d+$/.test(value)) break;
			next = Number(value);
		}
		defineValues.set(member.name, String(next));
		next++;
	}
}

type Kind
	= | { kind: 'number' }
		| { kind: 'float' }
		| { kind: 'bool' }
		| { kind: 'string' }
		| { kind: 'floats'; back: boolean }
		| { kind: 'ints'; back: boolean }
		| { kind: 'output' } // a text buffer the native fills; comes back as the result
		| { kind: 'length' } // the output's length, which the wrapper supplies
		| { kind: 'ref' }; // a number passed by address, not read back

/**
 * A parameter's tag, with no tag at all read as ''.
 *
 * The include parser writes an untagged parameter as `any`, so `name[]` and
 * `any:data[]` arrive looking the same. Both are taken as untagged here; the
 * numeric `any:` arrays live in the Array and Trie natives, which the name
 * check in kindsOf keeps out of the text treatment.
 */
function tagOf(p: Parameter): string {
	const tag = (p.type || '').replace(/:$/, '');
	return tag === 'any' || tag === '_' ? '' : tag;
}

/** How each parameter crosses, or null when the native keeps its raw form. */
function kindsOf(n: NativeFunction): Kind[] | null {
	const kinds: Kind[] = [];
	let outputs = 0;

	for (let i = 0; i < n.params.length; i++) {
		const p = n.params[i];
		const next = n.params[i + 1];
		const tag = tagOf(p);

		// A `&x` that is not an array is a number handed over by address - the
		// language of a player id in LookupLangKey. The wrapper passes it in a
		// cell of its own; what the native may write back there is not
		// returned, so a native that answers through a reference keeps its
		// raw form below and the facade wraps it.
		if (p.isRef && p.isArray) return null;
		if (p.isRef) {
			if (/^(?:num|count|len|size|found|written|ret|result|out|value)/i.test(p.name)) return null;
			kinds.push({ kind: 'ref' });
			continue;
		}

		if (!p.isArray) {
			kinds.push(tag === 'Float' ? { kind: 'float' } : tag === 'bool' ? { kind: 'bool' } : { kind: 'number' });
			continue;
		}

		if (tag === 'Float') {
			kinds.push({ kind: 'floats', back: !p.isConst });
			continue;
		}

		if (tag && tag !== '_') return null; // any:, Array:, an enum array...

		if (isInputString(p, next) || (!p.isConst && !p.arraySize && /^".*"$/.test(p.defaultValue ?? ''))) {
			kinds.push({ kind: 'string' });
			continue;
		}

		if (p.arraySize) {
			kinds.push({ kind: 'ints', back: !p.isConst });
			continue;
		}

		// An unsized, untagged, writable array with its length beside it is text
		// the native fills - unless the native is about arrays, where the same
		// shape is a row of numbers.
		// ArrayGetString is the one Array native whose buffer is text; the rest
		// fill rows of numbers, which is what the name guard is for.
		if (!p.isConst && isLength(next) && (!/array/i.test(n.name) || n.name === 'ArrayGetString')) {
			outputs++;
			kinds.push({ kind: 'output' }, { kind: 'length' });
			i++;
			continue;
		}

		return null;
	}

	return outputs > 1 ? null : kinds;
}

function tsType(kind: Kind): string {
	switch (kind.kind) {
		case 'float': return 'number';
		case 'bool': return 'boolean';
		case 'string': return 'string';
		case 'floats': return 'number[]';
		case 'ints': return 'number[]';
		default: return 'number';
	}
}

/** The include's default, written so the wrapper can take it - or null. */
function defaultOf(p: Parameter, kind: Kind): string | null {
	const raw = (p.defaultValue ?? '').trim();
	if (!raw) return null;

	if (kind.kind === 'string') return /^".*"$/.test(raw) ? raw : null;

	if (kind.kind === 'floats' || kind.kind === 'ints') {
		const list = raw.match(/^\{(.*)\}$/);
		if (!list) return null;
		const items = list[1].split(',').map(s => s.trim());
		if (!items.every(s => /^-?\d+(?:\.\d+)?$/.test(s))) return null;
		return `[${items.map(s => (kind.kind === 'floats' && !s.includes('.') ? `${s}.0` : s)).join(', ')}]`;
	}

	if (kind.kind === 'bool') return raw === 'true' || raw === 'false' ? raw : null;

	let value = /^-?\d+(?:\.\d+)?$/.test(raw) ? raw : defineValues.get(raw) ?? null;
	if (value === null) return null;

	if (kind.kind === 'float' && !value.includes('.')) value += '.0';
	if (kind.kind === 'number' && value.includes('.')) return null;
	return value;
}

const OUTPUT_CELLS = 256;

function typedWrapper(n: NativeFunction, kinds: Kind[]): string {
	const name = asName(n.name);
	const returnTag = tagOf({ name: '', type: n.returnType } as Parameter);
	const hasOutput = kinds.some(k => k.kind === 'output');

	// Defaults only count from the end: a parameter without one ends the run.
	const defaults: (string | null)[] = kinds.map(() => null);
	for (let i = kinds.length - 1; i >= 0; i--) {
		if (kinds[i].kind === 'output' || kinds[i].kind === 'length') continue;
		const value = defaultOf(n.params[i], kinds[i]);
		if (value === null) break;
		defaults[i] = value;
	}

	const signature: string[] = [];
	const setup: string[] = [];
	const args: string[] = [];
	const after: string[] = [];

	// The include's own names, so an editor shows `tmDelay, st, event` rather
	// than positions - made safe for this language and kept apart from the
	// wrapper's own locals, which all start with two underscores.
	const used = new Set<string>();
	const argNames = n.params.map((p, i) => {
		let base = RESERVED.has(p.name) || !/^[A-Z_$][\w$]*$/i.test(p.name) ? `${p.name}_` : p.name;
		if (!/^[A-Z_$][\w$]*$/i.test(base)) base = `arg${i}`;
		while (used.has(base)) base += '_';
		used.add(base);
		return base;
	});

	kinds.forEach((kind, i) => {
		const arg = argNames[i];

		if (kind.kind === 'output') {
			args.push('__textOut()');
			return;
		}

		if (kind.kind === 'length') {
			args.push(String(OUTPUT_CELLS - 1));
			return;
		}

		const def = defaults[i];
		signature.push(`${arg}: ${tsType(kind)}${def !== null ? ` = ${def}` : ''}`);

		switch (kind.kind) {
			case 'float':
				args.push(`__cellOf(${arg})`);
				break;
			case 'bool':
				args.push(`${arg} ? 1 : 0`);
				break;
			case 'ref':
				setup.push(`	const __b${i} = __intCells([${arg}]);`);
				args.push(`changetype<i32>(__b${i})`);
				break;
			case 'string':
				// A `const` string crosses as the plugin's own: the thunk reads it.
				if (isInputString(n.params[i], n.params[i + 1])) {
					args.push(`changetype<i32>(${arg})`);
					break;
				}
				setup.push(`\tconst __b${i} = __textCells(${arg});`);
				args.push(`changetype<i32>(__b${i})`);
				break;
			case 'floats':
				setup.push(`\tconst __b${i} = __floatCells(${arg});`);
				args.push(`changetype<i32>(__b${i})`);
				if (kind.back) after.push(`\t__floatsBack(__b${i}, ${arg});`);
				break;
			case 'ints':
				setup.push(`\tconst __b${i} = __intCells(${arg});`);
				args.push(`changetype<i32>(__b${i})`);
				if (kind.back) after.push(`\t__intsBack(__b${i}, ${arg});`);
				break;
			default: args.push(arg);
		}
	});

	let returns = 'number';
	let result = '__r';
	if (hasOutput) {
		returns = 'string';
		result = '__textBack()';
	} else if (returnTag === 'Float') {
		returns = 'number';
		result = '__floatOf(__r)';
	} else if (returnTag === 'bool') {
		returns = 'boolean';
		result = '__r != 0';
	}

	const doc = `/** ${n.name}(${n.params.map(p => `${p.isConst ? 'const ' : ''}${p.type ? `${p.type}:` : ''}${p.name}${p.isArray ? '[]' : ''}`).join(', ')}) */`;

	return [
		`// @ts-ignore: decorator`,
		`@external("env", "${n.name}")`,
		`declare function __raw_${n.name}(${n.params.map((_, i) => `a${i}: i32`).join(', ')}): i32;`,
		'',
		doc,
		`export function ${name}(${signature.join(', ')}): ${returns} {`,
		...setup,
		`\tconst __r = __raw_${n.name}(${args.join(', ')});`,
		...after,
		`\treturn ${result};`,
		`}`,
	].join('\n');
}

let typedCount = 0;

const asLines = chosen.map((n) => {
	const kinds = kindsOf(n);

	if (kinds) {
		typedCount++;
		return typedWrapper(n, kinds);
	}

	// A string going in is the plugin's own string, here as in a typed wrapper.
	const cells = bufferCells(n);
	const passed = n.params.map((p, i) => (!isBuffer(p) ? '' : cells[i] ? 'pointer' : 'string'));
	const params = n.params.map((p, i) => `a${i}: ${passed[i] === 'string' ? 'string' : 'i32'}`).join(', ');
	const doc = n.params.length
		? `\t/** ${n.params.map((p, i) => (passed[i] ? `${p.name}: ${passed[i]}` : p.name)).join(', ')} */\n`
		: '';

	// The @ts-ignore is AssemblyScript's own idiom: TypeScript allows a
	// decorator on a class only, so an editor would mark every one of these as
	// an error. asc is what reads them.
	return `${doc}// @ts-ignore: decorator\n@external("env", "${n.name}")\nexport declare function ${asName(n.name)}(${params}): i32;`;
});

/** What every typed wrapper leans on; private to this file. */
const typedHelpers = `
function __cellOf(value: f64): i32 {
	return reinterpret<i32>(<f32>value);
}

function __floatOf(cell: i32): f64 {
	return <f64>reinterpret<f32>(cell);
}

// A buffer is held in a local by the wrapper for as long as the native runs:
// only its address crosses, and an address alone does not keep it alive.
//
// Text crosses as UTF-8, a byte a cell: AMX Mod X reads the low byte of each
// cell (get_amxstring), and what a native writes back is bytes the same way.
// A cell per UTF-16 unit sent a Cyrillic word as "@0" and read Cyrillic back as mojibake.
// A \`const\` string is not made into cells here: the module reads the
// plugin's string itself. This is for a writable one with a default.
function __textCells(text: string): StaticArray<i32> {
	const bytes = Uint8Array.wrap(String.UTF8.encode(text));
	const cells = new StaticArray<i32>(bytes.length + 1);
	for (let i = 0; i < bytes.length; i++) unchecked(cells[i] = <i32>unchecked(bytes[i]));
	return cells;
}

// Text a native fills comes back here, as UTF-8 bytes up to its end and a
// zero byte. One buffer serves every wrapper: it is read as soon as the
// native returns, before anything else can run.
const __text = new StaticArray<u8>(${OUTPUT_CELLS});

/** The buffer, empty: a call that does not reach its native reads "". */
function __textOut(): i32 {
	unchecked(__text[0] = 0);
	return changetype<i32>(__text);
}

function __textBack(): string {
	return __textAt(changetype<usize>(__text), ${OUTPUT_CELLS});
}

/**
 * @hidden The UTF-8 text a native wrote at \`at\`, up to its zero byte and at
 * most \`max\` bytes. Measured first: the decoder takes room for all \`max\`
 * bytes otherwise, and a short name made the collector's work of a long one.
 */
export function __textAt(at: usize, max: i32): string {
	let length = 0;
	while (length < max && load<u8>(at + length) != 0) length++;
	return String.UTF8.decodeUnsafe(at, length);
}

function __floatCells(values: f64[]): StaticArray<i32> {
	const cells = new StaticArray<i32>(values.length);
	for (let i = 0; i < values.length; i++) unchecked(cells[i] = __cellOf(values[i]));
	return cells;
}

function __floatsBack(cells: StaticArray<i32>, values: f64[]): void {
	for (let i = 0; i < values.length; i++) values[i] = __floatOf(unchecked(cells[i]));
}

// A plugin's numbers are JavaScript numbers (f64); a Pawn cell is an i32.
// Whole values cross exactly both ways.
function __intCells(values: f64[]): StaticArray<i32> {
	const cells = new StaticArray<i32>(values.length);
	for (let i = 0; i < values.length; i++) unchecked(cells[i] = <i32>values[i]);
	return cells;
}

function __intsBack(cells: StaticArray<i32>, values: f64[]): void {
	for (let i = 0; i < values.length; i++) values[i] = <f64>unchecked(cells[i]);
}
`;

/**
 * A variadic native as a function: `ExecuteForward(handle, a, b)`,
 * `show_hudmessage(id, text)` - or null when its fixed part is a shape this
 * cannot read, and the facade wraps it by hand.
 *
 * Underneath it is a Call. A `...` tail is passed by address in Pawn, so each
 * trailing number goes by reference. A format string followed by `...` is
 * taken as the finished text and sent as "%s" with it - a plugin formats with
 * a template string, and a `%` in a player's name stays a `%`. A `&ret` in the
 * fixed part is handed a cell of its own and not asked for.
 */
function variadicWrapper(n: NativeFunction, id: string): string | null {
	const fixed = n.params.filter(p => !p.isRest);
	const rest = n.params.find(p => p.isRest)!;
	const last = fixed[fixed.length - 1];
	// log_amx calls its format `string`, the one variadic native that does.
	const formats = Boolean(last && isInputString(last, undefined) && /fmt|format|message|msg|text|^string$/i.test(last.name));

	const used = new Set<string>();
	const safe = (name: string, i: number) => {
		let base = RESERVED.has(name) || !/^[A-Z_$][\w$]*$/i.test(name) ? `${name}_` : name;
		if (!/^[A-Z_$][\w$]*$/i.test(base)) base = `arg${i}`;
		while (used.has(base)) base += '_';
		used.add(base);
		return base;
	};

	const kindOf = (p: Parameter): Kind => {
		const tag = tagOf(p);
		if (p.isArray) return { kind: 'string' };
		return tag === 'Float' ? { kind: 'float' } : tag === 'bool' ? { kind: 'bool' } : { kind: 'number' };
	};

	// Defaults only count from the end, and the tail comes after them all.
	const defaults = fixed.map(() => null as string | null);
	for (let i = fixed.length - 1; i >= 0; i--) {
		const p = fixed[i];
		if (p.isRef || (formats && i === fixed.length - 1)) continue;
		const value = defaultOf(p, kindOf(p));
		if (value === null) break;
		defaults[i] = value;
	}

	const signature: string[] = [];
	const pushes: string[] = [];
	const names: string[] = [];

	for (let i = 0; i < fixed.length; i++) {
		const p = fixed[i];
		const tag = tagOf(p);

		if (p.isRef && !p.isArray) {
			pushes.push('.ref(0)');
			continue;
		}

		const name = safe(p.name, i);
		names[i] = name;
		const def = defaults[i] !== null ? ` = ${defaults[i]}` : '';

		if (formats && i === fixed.length - 1) {
			signature.push(`${name}: string`);
			pushes.push(`.str("%s").str(${name})`);
			continue;
		}

		if (p.isArray) {
			if (!isInputString(p, undefined) || (tag && tag !== '_')) return null;
			signature.push(`${name}: string${def}`);
			pushes.push(`.str(${name})`);
			continue;
		}

		if (tag === 'Float') {
			signature.push(`${name}: number${def}`);
			pushes.push(`.float(${name})`);
		} else if (tag === 'bool') {
			signature.push(`${name}: boolean${def}`);
			pushes.push(`.num(${name} ? 1 : 0)`);
		} else {
			signature.push(`${name}: number${def}`);
			pushes.push(`.num(${name})`);
		}
	}

	const returnTag = tagOf({ name: '', type: n.returnType } as Parameter);
	const doc = `/** ${n.name}(${n.params.map(p => p.isRest ? '...' : `${p.isConst ? 'const ' : ''}${p.isRef ? '&' : ''}${p.type ? `${p.type}:` : ''}${p.name}${p.isArray ? '[]' : ''}`).join(', ')}) */`;
	const call = `new Call(${id})${pushes.join('')}`;
	const asBool = (result: string) => returnTag === 'bool' ? `${result} != 0` : result;

	if (formats) {
		const result = returnTag === 'Float' ? `__floatOf(${call}.run())` : asBool(`${call}.run()`);
		return `${doc}\nexport function ${asName(n.name)}(${signature.join(', ')}) {\n\treturn ${result};\n}`;
	}

	// The tail: each argument a type of its own, so text, a vector and a
	// number go side by side (the facade's __callTail sends each by its type).
	// A number is a whole one unless the float table says Float.
	const types = TAIL.map((_, i) => `T${i + 1}`);
	const args = TAIL.map((_, i) => safe(`a${i + 1}`, fixed.length + i));
	signature.push(...args.map((arg, i) => `${arg}: ${types[i]} = __noArgument<${types[i]}>()`));
	const table = floatTables.has(n.name) || floatRanges.has(n.name);
	const selector = names[floatSelector.get(n.name) ?? fixed.length - 1] ?? '';
	const resultFloat = returnTag === 'Float' ? ` | ${TAIL_FLOAT_RESULT}` : '';
	const floats = table && selector
		? `__${floatOwner(n.name)}_floats(<i32>${selector})${resultFloat}`
		: `${tagOf(rest) === 'Float' ? (1 << TAIL.length) - 1 : 0}${resultFloat}`;
	const generics = `<${types.map(type => `${type} = NoArgument`).join(', ')}>`;
	const result = asBool(`__callTail<${types.join(', ')}>(${call}, ${floats}, ${args.join(', ')})`);

	return `${doc}\nexport function ${asName(n.name)}${generics}(${signature.join(', ')}) {\n\treturn ${result};\n}`;
}

// ---------------------------------------------------------------- a tail's Floats
//
// A plugin's number does not say whether it is whole or fractional, and an
// `any:...` tail does not either: engfunc(EngFunc_RunPlayerMove, ...) reads
// its third argument as a Float, EngFunc_ModelFrames its first as a whole
// number. fakemeta_const.inc writes the engine's C signature beside every
// EngFunc_ and DLLFunc_ constant,
//
//     EngFunc_WalkMove,    // int  )    (edict_t *ent, float yaw, float dist, int iMode);
//
// and fakemeta reads each `float` parameter there as a Float, in that order
// after the constant. So each of these natives gets a table: the constant to
// the bits of its Float arguments. A function whose C result is a float hands
// it back as one - by the result when it takes nothing (EngFunc_Time), by one
// more argument otherwise (EngFunc_VecToYaw).
//
// Ham Sandwich's comments give ExecuteHam's arguments for each function, and
// TraceResult's members their types, the same way.
//
// pev, set_pev and global_get take a field and keep its kinds in ranges of
// the field's enum, between markers: a field inside pev_float_start and
// pev_float_end is a Float, read or written through the first argument after it.

/** How many arguments a `...` tail takes in a wrapper: EngFunc_PlaybackEvent's twelve. */
const TAIL = Array.from({ length: 12 });

/** The facade's TAIL_FLOAT_RESULT: the result is a Float. */
const TAIL_FLOAT_RESULT = 1 << 16;

/** The natives with a float table, to the table: a constant to its Float bits. */
const floatTables = new Map<string, Map<string, number>>();

/** The fixed argument a native's float table goes by, when it is not the last: its index. */
const floatSelector = new Map<string, number>();

{
	const text = readInclude('fakemeta_const');
	for (const [native, prefix] of [['engfunc', 'EngFunc_'], ['dllfunc', 'DLLFunc_|MetaFunc_']]) {
		const table = new Map<string, number>();
		for (const [, name, returns, list] of text.matchAll(new RegExp(`^\\s*((?:${prefix})\\w+),?\\s*//\\s*([^)]*)\\)\\s*\\(([^)]*)\\)`, 'gm'))) {
			const params = list.trim() === 'void' ? [] : list.split(',').map(p => p.trim()).filter(Boolean);
			let bits = params.reduce((sum, p, i) => /^(?:const\s+)?(?:\/\*\w+\*\/)?float\s+\w+$/.test(p) ? sum | (1 << i) : sum, 0);
			if (returns.trim() === 'float') bits |= params.length ? 1 << params.length : TAIL_FLOAT_RESULT;
			if (bits) table.set(name, bits);
		}
		floatTables.set(native, table);
	}

	// The members of a trace, a client's data, an entity's state and a
	// command say their type: `TR_flFraction, // float`.
	const members = { TR: ['get_tr', 'set_tr', 'get_tr2', 'set_tr2'], CD: ['get_cd', 'set_cd'], ES: ['get_es', 'set_es'], UC: ['get_uc', 'set_uc'] };
	for (const [prefix, natives] of Object.entries(members)) {
		const table = new Map([...text.matchAll(new RegExp(`^\\s*(${prefix}_\\w+),?\\s*//\\s*float\\s*$`, 'gm'))].map(([, name]) => [name, 1]));
		for (const native of natives) floatTables.set(native, table);
	}
	floatTables.set('forward_return', new Map([['FMV_FLOAT', 1]]));

	// Ham Sandwich writes each function's call above it:
	//     Execute params:	ExecuteHam(Ham_TakeDamage, this, idinflictor, idattacker, Float:damage, damagebits);
	const hams = new Map<string, number>();
	for (const [, name, list] of readInclude('ham_const').matchAll(/Execute params:\s*ExecuteHam\((Ham_\w+),\s*this(?:,([^)]*))?\)/g)) {
		const params = (list ?? '').split(',').map(p => p.trim()).filter(Boolean);
		const bits = params.reduce((sum, p, i) => /^Float:\w+$/.test(p) ? sum | (1 << i) : sum, 0);
		if (bits && !hams.has(name)) hams.set(name, bits);
	}
	for (const native of ['ExecuteHam', 'ExecuteHamB']) {
		floatTables.set(native, hams);
		floatSelector.set(native, 0);
	}
}

/** The natives whose field's kind is a range of its enum: the markers around its Floats. */
const PEV_FLOATS = ['pev_float_start', 'pev_float_end'];
const floatRanges = new Map([
	['pev', PEV_FLOATS],
	['set_pev', PEV_FLOATS],
	['global_get', ['glb_start_float', 'glb_end_float']],
]);

/** The native whose float function a native calls: the first of those that share its table. */
function floatOwner(native: string): string {
	const shape = floatTables.get(native) ?? floatRanges.get(native);
	return [...floatTables, ...floatRanges].find(([, other]) => other === shape)?.[0] ?? native;
}

/** The float table of a native as a function of one of its fixed arguments: a switch over its constants, or a range. */
function floatFunction(native: string): string {
	const range = floatRanges.get(native);
	const cases = [...floatTables.get(native) ?? []].map(([name, bits]) => `\t\tcase ${name}:\n\t\t\treturn ${bits};`);
	const body = range
		? `\treturn selector > ${range[0]} && selector < ${range[1]} ? 1 : 0;`
		: `\tswitch (selector) {\n${cases.join('\n')}\n\t}\n\treturn 0;`;
	const sharing = [...floatTables.keys(), ...floatRanges.keys()].filter(other => floatOwner(other) === native);
	return `/** Which arguments of the tail of ${sharing.join(', ')} are Floats, by its ${floatSelector.has(native) ? 'first' : 'last'} fixed argument: bit i the tail's argument i, ${TAIL_FLOAT_RESULT} the result. */
export function __${native}_floats(selector: i32): i32 {
${body}
}`;
}

// ---------------------------------------------------------------- field natives
//
// reapi reaches the game's data through pairs of variadic natives -
// get_entvar/set_entvar, get_member/set_member, get_member_game, get_pmove,
// get_ucmd... - one native for fields of every type: a whole number comes back
// as the result, a Float as the bits of one, a vector and text through the
// `...` tail. Which one a field is, reapi writes above every enum member:
//
//     * Get params:       Float:get_entvar(index, EntVars:var);
//     * Set params:       set_entvar(index, EntVars:var, Float:value);
//
// So each pair gets a table of its fields' kinds, and its wrapper reads and
// writes a field as what it is: `get_entvar(id, var_gravity)` is 0.5 rather
// than the bits of 0.5, `get_member<string>(id, m_szTeamName)` the team's
// name, `set_entvar(id, var_origin, [0, 0, 64])` a vector (the facade's
// __getField and __setField). The kinds are the facade's FIELD_* numbers.

const FIELD_FLOAT = 1;
const FIELD_VECTOR = 2;
const FIELD_STRING = 3;
/** Added to a kind when the field is an array member, which takes an element's index. */
const FIELD_ELEMENT = 4;

/** Every field native with a table: the get native's name to its fields' kinds, whole numbers left out. */
const fieldTables = new Map<string, Map<string, number>>();
/** A set native, or a renamed native, to the get native whose table it shares. */
const fieldTableOf = new Map<string, string>();

/** The kind a Get params line says: its result's tag and what follows the field. */
function fieldKind(tag: string | undefined, tail: string[]): number {
	const element = tail.some(p => /\belement\b/.test(p)) ? FIELD_ELEMENT : 0;
	if (tail.some(p => /^Float:\w+\[3\]$/.test(p))) return FIELD_VECTOR + element;
	if (tail.some(p => p.endsWith('[]'))) return FIELD_STRING + element;
	return (tag === 'Float' ? FIELD_FLOAT : 0) + element;
}

const variadicByName = new Map(variadic.map(n => [n.name, n]));

for (const name of parseNames) {
	const text = readInclude(name);
	for (const m of text.matchAll(/\/\*((?:(?!\*\/)[\s\S])*?Get params:(?:(?!\*\/)[\s\S])*?)\*\/\s*(\w+)/g)) {
		const [, comment, member] = m;
		const get = comment.match(/Get params:\s*(?:(\w+):)?(\w+)\(([^)]*)\);/);
		// get_* and set_* only: rg_get_iteminfo and GetMessageData document
		// their own shapes in the same words, and take arguments these do not.
		const native = get && get[2].startsWith('get_') ? variadicByName.get(get[2]) : undefined;
		if (!get || !native) continue;

		const fixed = native.params.filter(p => !p.isRest).length;
		if (fixed === 0) continue;
		const tail = get[3].split(',').map(p => p.trim()).filter(Boolean).slice(fixed);
		let table = fieldTables.get(native.name);
		if (!table) fieldTables.set(native.name, table = new Map());
		const kind = fieldKind(get[1], tail);
		if (kind) table.set(member, kind);

		const set = comment.match(/Set params:\s*(\w+)\(/);
		if (set && set[1].startsWith('set_') && variadicByName.has(set[1])) fieldTableOf.set(set[1], native.name);
	}
}

// reapi's `#define get_member get_member_s`: the renamed natives share the table.
for (const [from, to] of aliases) {
	const table = fieldTables.has(from) ? from : fieldTableOf.get(from);
	if (table && variadicByName.has(to)) fieldTableOf.set(to, table);
}

/** The get native whose table a field native reads its kinds from; null for any other native. */
function fieldTable(name: string): string | null {
	return fieldTables.has(name) ? name : fieldTableOf.get(name) ?? null;
}

/** The kind function of a table: a switch over the fields that are not whole numbers. */
function kindFunction(native: string, kinds: Map<string, number>): string {
	const byKind = new Map<number, string[]>();
	for (const [member, kind] of kinds) byKind.set(kind, [...(byKind.get(kind) ?? []), member]);
	const cases = [...byKind].sort(([a], [b]) => a - b).map(([kind, members]) =>
		`${members.map(m => `\t\tcase ${m}:`).join('\n')}\n\t\t\treturn ${kind};`);
	const body = cases.length ? `\tswitch (field) {\n${cases.join('\n')}\n\t}\n\treturn 0;` : '\treturn 0;';
	return `/** What a field of ${native} holds: 0 a whole number, 1 a Float, 2 a vector, 3 text; 4 more for an array member. */
export function __${native}_kind(field: i32): i32 {
${body}
}`;
}

/** The members every table names, for the import from ./constants. */
const fieldMembers = [...new Set([...fieldTables.values()].flatMap(kinds => [...kinds.keys()]))].sort();

/**
 * A field native as a function: the fixed part as the include declares it,
 * the field last among it, then the value (a set native) and an element's
 * index. The result or the value is T - `number` unless the field is a
 * vector or text: `get_member<string>(id, m_szTeamName)`.
 */
function fieldWrapper(n: NativeFunction, id: string, table: string): string {
	const fixed = n.params.filter(p => !p.isRest);
	const names = fixed.map((p, i) => (RESERVED.has(p.name) || !/^[A-Z_$][\w$]*$/i.test(p.name) ? `${p.name}_` : p.name) || `arg${i}`);
	const field = names[names.length - 1];
	const pushes = names.map(name => `.num(${name})`).join('');
	const setter = n.name.startsWith('set_');
	const doc = `/** ${n.name}(${n.params.map(p => p.isRest ? '...' : `${p.isConst ? 'const ' : ''}${p.type ? `${p.type}:` : ''}${p.name}`).join(', ')}) */`;
	const signature = [...names.map(name => `${name}: number`), ...(setter ? ['value: T'] : []), 'element: number = 0'].join(', ');
	const call = `new Call(${id})${pushes}, __${table}_kind(<i32>${field})`;
	return setter
		? `${doc}\nexport function ${asName(n.name)}<T = number>(${signature}): number {\n\treturn __setField<T>(${call}, value, element, "${n.name}");\n}`
		: `${doc}\nexport function ${asName(n.name)}<T = number>(${signature}): T {\n\treturn __getField<T>(${call}, element, "${n.name}");\n}`;
}

let variadicTyped = 0;
const dispatchLines = dispatched.map((n, i) => {
	const fixed = n.params.filter(p => !p.isRest).map(p => p.name).join(', ');
	const id = `NATIVE_${asName(n.name)}`;
	const table = fieldTable(n.name);
	const wrapper = table ? fieldWrapper(n, id, table) : variadicWrapper(n, id);
	if (wrapper) variadicTyped++;
	return `/** ${n.name}(${fixed}${fixed ? ', ' : ''}...) - the dispatcher's id for it */\nexport const ${id}: i32 = ${i};${
		wrapper ? `\n\n${wrapper}` : ''}`;
});

// Written once the constants are known (below): the field tables import theirs.
function writeNatives(): void {
	// A member no constant resolved for would be an import of nothing.
	for (const kinds of fieldTables.values()) {
		for (const member of kinds.keys()) {
			if (!known.has(member)) kinds.delete(member);
		}
	}
	for (const table of floatTables.values()) {
		for (const name of table.keys()) {
			if (!known.has(name)) table.delete(name);
		}
	}
	const floatNames = [...[...floatTables.values()].flatMap(table => [...table.keys()]), ...[...floatRanges.values()].flat()];
	const members = [...new Set([...fieldMembers, ...floatNames])].filter(member => known.has(member)).sort();

	writeFileSync(
		'./as/natives.ts',
		`// GENERATED by scripts/generate-wasm-api.ts — do not edit
// Source: includes/*.inc
//
// Every native, with the types its include declares: a Float: is a number, a
// bool: is a boolean, a string is a string, and a buffer the native fills
// comes back as its result. Underneath, Pawn still sees cells - a float as its
// bit pattern, a string as UTF-8 a byte a cell, which the module writes into
// the AMX heap straight from this plugin's string - and each wrapper does
// what is left of the conversion so a plugin never has to.
//
// A native whose shape cannot be read with confidence keeps its raw form,
// cells and addresses, under its own name.
${typedHelpers}
${asLines.join('\n\n')}

// ---------------------------------------------------------------- variadic
//
// A native with a \`...\` tail has no wasm signature - an import's arity is
// fixed - so it cannot be declared above. What it gets instead is an id for
// the dispatcher, which takes the arguments as cells the plugin lays out
// itself. Each one whose shape can be read is also a function here, a Call
// from as/facade.ts underneath; the rest are \`new Call(NATIVE_x)\` in the facade.

import { Call, NoArgument, __callTail, __getField, __noArgument, __setField } from "./facade";
import {
${chunkNames(members)}
} from "./constants";

${[...fieldTables].map(([native, kinds]) => kindFunction(native, kinds)).join('\n\n')}

${[...floatTables.keys(), ...floatRanges.keys()].filter(native => floatOwner(native) === native).map(floatFunction).join('\n\n')}

${dispatchLines.join('\n\n')}
`,
	);
}

/** Names for an import list, a few to a line. */
function chunkNames(names: string[]): string {
	const lines: string[] = [];
	for (let i = 0; i < names.length; i += 6) lines.push(`\t${names.slice(i, i + 6).join(', ')},`);
	return lines.join('\n');
}

// ------------------------------------------------------------- runtime/src/natives.h

const thunks = chosen.map((n) => {
	const params = n.params.map((p, i) => `int32_t a${i}`).join(', ');
	const sig = n.params.length ? `wasm_exec_env_t env, ${params}` : 'wasm_exec_env_t env';
	const body: string[] = [];

	// Each thunk resolves its own native once per map rather than looking the
	// name up in a map of strings on every call. Measured: a thousand calls
	// went from 57 microseconds to what a direct call costs.
	body.push(`\tstatic Cached cached = { { NULL, 0 }, 0 };`);
	const counts = bufferCells(n);
	const texts = outputTexts(n);

	// The frame takes room in the AMX heap for a buffer and gives it back
	// after the call; a native of plain cells has nothing to copy.
	if (n.params.some(isBuffer)) body.push(`\tFrame f(env);`);
	body.push(`\tArgs p(${n.params.length});`);

	n.params.forEach((p, i) => {
		if (isBuffer(p) && !counts[i]) {
			body.push(`\tp[${i + 1}] = f.inText(a${i});`);
		} else if (texts.has(i)) {
			body.push(`\tp[${i + 1}] = f.outText(a${i}, a${i + 1});`, `\tif (!p[${i + 1}])\n\t\treturn 0;`);
		} else if (counts[i]) {
			if (counts[i] === `n${i}`) body.push(`\tint32_t n${i} = f.fits(a${i}, ${DEFAULT_CELLS});`);
			// A buffer that does not cross is never handed to the native as
			// address 0, the host's data: see Frame::in.
			body.push(`\tp[${i + 1}] = f.in(a${i}, ${counts[i]});`, `\tif (!p[${i + 1}])\n\t\treturn 0;`);
		} else if (counts[i - 1] === `a${i}`) {
			// A buffer is copied only as far as crosses, so its native is told that far.
			body.push(`\tp[${i + 1}] = a${i} > MAX_CROSSING_CELLS ? MAX_CROSSING_CELLS : a${i};`);
		} else {
			body.push(`\tp[${i + 1}] = a${i};`);
		}
	});

	body.push(`\tcell r = CallCached(cached, "${lookupName(n.name)}", p);`);

	n.params.forEach((p, i) => {
		// Nothing comes back out of a const parameter, whatever its shape.
		if (texts.has(i))
			body.push(`\tf.backText(a${i}, a${i + 1}, p[${i + 1}]);`);
		else if (counts[i] && !p.isConst)
			body.push(`\tf.out(a${i}, ${counts[i]}, p[${i + 1}]);`);
	});

	body.push(`\treturn (int32_t)r;`);

	return `static int32_t w_${n.name}(${sig})\n{\n${body.join('\n')}\n}`;
});

const table = chosen.map(n =>
	`\t{ "${n.name}", (void *)w_${n.name}, "(${'i'.repeat(n.params.length)})i", NULL },`,
);

writeFileSync(
	'./runtime/src/natives.h',
	`// GENERATED by scripts/generate-wasm-api.ts — do not edit
// Source: includes/*.inc
//
// One thunk per native, so that wamrc can emit a direct call to it: an import
// whose signature the compiler knows is far cheaper than one it has to reach
// through aot_invoke_native. Frame and Args come from module.cpp, which is
// the only file that includes this one.
//
// A buffer parameter is copied into the AMX heap before the call and back
// afterwards, both ways regardless of direction, because the plugin owns the
// memory on its side and copying twice is cheaper than being wrong about
// which way a native reads it. A buffer that cannot be copied - no room, no
// such memory, a negative length - answers 0 without calling the native, and
// one longer than MAX_CROSSING_CELLS is copied, and told to its native, only
// that far - as amxts_call does. A string going in is read from the plugin's
// string (Frame::inText), and text a typed wrapper asks for comes back only
// up to its end (Frame::outText, Frame::backText).

${thunks.join('\n\n')}

static NativeSymbol g_generatedNatives[] = {
${table.join('\n')}
};

// Variadic natives, in the order as/natives.ts numbers them. amxts_call takes
// one of these ids, because a \`...\` tail has no wasm signature to import.
static const char *g_dispatchedNatives[] = {
${dispatched.map(n => `\t"${lookupName(n.name)}",`).join('\n')}
};
`,
);

writeNatives();

/**
 * `RG_CSGameRules_RestartRound` is `"restart_round"`.
 *
 * reapi names a hookchain after the class and the method it hooks. The class
 * is noise at the call site nine times in ten - `hook("restart_round", ...)`
 * says what it does - so it is dropped, and put back only where two chains
 * would otherwise claim one name: `CBasePlayer::Spawn` and
 * `CBaseAnimating::Spawn` become `player_spawn` and `base_animating_spawn`.
 */
function snake(text: string): string {
	return text
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
		.toLowerCase();
}

function hookNames(prefix: string): Map<string, string> {
	const byShort = new Map<string, string[]>();

	for (const name of known.keys()) {
		if (!name.startsWith(prefix)) continue;

		const bare = name.slice(prefix.length);
		const parts = bare.split('_');
		const short = snake(parts.length > 1 ? parts.slice(1).join('_') : parts[0]);

		if (!byShort.has(short)) byShort.set(short, []);
		byShort.get(short)!.push(name);
	}

	const names = new Map<string, string>();

	for (const [short, constants] of byShort) {
		for (const constant of constants) {
			if (constants.length === 1) {
				names.set(short, constant);
				continue;
			}

			// Two chains want this name, so each keeps its class - with the
			// C that reapi puts in front of every class name dropped, because
			// it is Hungarian notation from a decade ago and says nothing.
			const parts = constant.slice(prefix.length).split('_');
			const owner = snake(parts[0].replace(/^C(?=[A-Z])/, ''));
			names.set(`${owner}_${short}`, constant);
		}
	}

	return names;
}

const hooks = new Map<string, string>();
for (const prefix of ['RG_', 'RH_']) {
	for (const [short, constant] of hookNames(prefix)) {
		if (!hooks.has(short)) hooks.set(short, constant);
	}
}

/**
 * The admin flags, under one name.
 *
 * Every ADMIN_* the includes declare, so the list cannot fall behind by being
 * hand-picked: `Flag.kick` is `ADMIN_KICK`, and `ADMIN_LEVEL_A` is
 * `Flag.levelA`. The constants keep their own names too.
 */
const flagLines: string[] = [];
const flagNames: string[] = [];
const flagCases: string[] = [];

for (const [name, value] of known) {
	if (!name.startsWith('ADMIN_')) continue;

	const short = name.slice(6).toLowerCase().replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
	flagLines.push(`\texport const ${short}: i32 = ${value};`);
	flagNames.push(`\t| "${short}"`);
	flagCases.push(`\t\tcase "${short}": return ${value};`);
}

writeFileSync(
	'./as/constants.ts',
	`// GENERATED by scripts/generate-wasm-api.ts - do not edit
// Source: includes/*.inc
//
// Every constant and enum member the includes declare, flattened, because Pawn
// has no namespaces: its enum members are global constants and plugins use
// them by their own names. Values are computed here rather than passed through
// as expressions, so a hookchain id reads as the number the module will
// resolve.

${constantLines.join('\n')}

export namespace Flag {
${flagLines.join('\n')}
}

/**
 * Every name a command's flag argument accepts.
 *
 * A union of string literals, so an editor completes it and a misspelling
 * fails the build. AssemblyScript needs runtime/patches for that; the numbers
 * above are the same flags for anything that wants one.
 */
export type FlagName =
${flagNames.join('\n')};

/** The bit a flag name stands for. */
export function flagOf(name: string): i32 {
	switch (name) {
${flagCases.join('\n')}
	}

	return 0;
}

/**
 * Every reapi hookchain, by a name an editor can complete.
 *
 * The numbers are reapi's own, computed from its includes, and they move
 * between releases - take the includes from the release your server runs.
 */
export type HookName =
${Array.from(hooks.keys()).sort().map(n => `\t| "${n}"`).join('\n')};

// -1 rather than 0 for a name that is not here: reapi numbers its chains
// from zero, so "start_sound" is legitimately 0 and a 0 standing for "no
// such hook" would refuse it.
export function hookIdOf(name: string): i32 {
	switch (name) {
${Array.from(hooks.entries()).sort().map(([short, constant]) => `\t\tcase "${short}": return ${known.get(constant)};`).join('\n')}
	}

	return -1;
}

`,
);

// ------------------------------------------------------------ runtime/natives.txt

/**
 * The bridge natives, read out of the module that registers them.
 *
 * These are not in includes/*.inc - they are this project's own, declared by
 * hand in module.cpp's g_wasmNatives. They were kept in a file beside it until
 * that file fell behind: `task` gained an argument, the table still said three,
 * and wamrc refused the plugin rather than compiling a call that would have
 * read one cell of nothing. Taking them from the source of truth means the two
 * cannot disagree again.
 */
const bridge = (() => {
	const source = readFileSync('./runtime/src/module.cpp', 'utf-8');
	const table = source.slice(source.indexOf('static NativeSymbol g_wasmNatives[]'));
	// The table takes the entity fields' natives from fields.h, by its macro:
	// left out, every field read went through WAMR's generic call.
	const fields = readFileSync('./runtime/src/fields.h', 'utf-8');
	const fieldNatives = fields.slice(fields.indexOf('#define FIELD_NATIVES'));
	const entries = table.slice(0, table.indexOf('};')).replace('FIELD_NATIVES', fieldNatives.slice(0, fieldNatives.search(/\n\s*\n/)));

	return Array.from(
		entries.matchAll(/\{\s*"([^"]+)",\s*\(void \*\)\w+,\s*"(\([^)]*\)\w?)"/g),
		m => `${m[1]} ${m[2]}`,
	);
})();

writeFileSync(
	'./runtime/natives.txt',
	[
		'# GENERATED by scripts/generate-wasm-api.ts — do not edit',
		'# Source: includes/*.inc, plus the bridge natives module.cpp registers.',
		'# Pass to wamrc as --native-signatures=<this file>, which reads the name and the',
		'# signature; what follows is how the module passes the arguments, for the ABI.',
		...bridge,
		...chosen.map(n => `${n.name} (${'i'.repeat(n.params.length)})i${crossing(n)}`),
		'',
	].join('\n'),
);

console.log(`${chosen.length} natives (${typedCount} typed), ${dispatched.length} variadic through the dispatcher (${variadicTyped} typed) (${skipped.length} skipped), ${known.size} constants (${skippedConstants} skipped), ${hooks.size} hookchains`);
for (const reason of skipped.slice(0, 5)) console.log(`  ${reason}`);
if (skipped.length > 5) console.log(`  ... and ${skipped.length - 5} more`);

// A buffer whose size neither the include nor a length beside it gives.
const guessed = chosen.filter(n => bufferCells(n).some((cells, i) => cells === `n${i}`)).map(n => n.name);
console.log(`${guessed.length} natives copy a guessed size, ${DEFAULT_CELLS} cells at most: ${guessed.join(', ')}`);
