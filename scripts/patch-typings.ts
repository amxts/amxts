// Makes AssemblyScript's editor typings say what a plugin author expects.
//
//   bun scripts/patch-typings.ts        (run by `bun run generate`, and by `npm install` in the core
//                                        as its `prepare`: a project installing the core never runs it)
//
// An editor reads plugins through node_modules/assemblyscript/std, the
// typings asc ships. There `bool` is `boolean | number`, so every
// `.includes()` - which returns bool - refused to go into a boolean:
// `reloadHeld[id] = player.buttons.includes("reload")` was red in the editor
// and compiled fine. The compiler does not read these typings at all, so
// narrowing the alias changes what the editor says and nothing else.
//
// node_modules is rewritten on every install, which is why this is a script
// and not a patch file: it runs again, and it says so if the line it expects
// has moved.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const typings = 'node_modules/assemblyscript/std/assembly/index.d.ts';
const from = 'declare type bool = boolean | number;';
const to = 'declare type bool = boolean;';

// Not installed yet: npm runs this `prepare` also when the command's checkout
// installs, linking a core whose own install has not happened. Its install
// runs it again.
if (!existsSync(typings)) {
	console.log(`typings: no ${typings} yet - npm install in the core patches them`);
	process.exit(0);
}

let text = readFileSync(typings, 'utf8');

if (text.includes(to)) {
	console.log('typings: bool is already boolean');
} else if (text.includes(from)) {
	text = text.replace(from, to);
	console.log('typings: bool is now boolean for the editor');
} else {
	process.stderr.write(`typings: "${from}" not found in ${typings} - AssemblyScript changed it\n`);
	process.exit(1);
}

// AssemblyScript's own `trace(message, n, ...)` - a debug print to its host,
// which a server has not - is no TypeScript, and the editor read it against
// the facade's `trace` (`trace.line`, `trace.hull`): two globals of one name.
const debugTrace = 'declare function trace(msg: string, n?: i32, a0?: f64, a1?: f64, a2?: f64, a3?: f64, a4?: f64): void;\n';
if (text.includes(debugTrace)) {
	text = text.replace(debugTrace, '');
	console.log('typings: AssemblyScript\'s trace() is left to the facade\'s trace');
}

// find and findLast are in our AssemblyScript (runtime/patches) but not in the
// typings asc ships: `server.players.find(...)` was red and compiled fine. They
// give the element or undefined, as in JavaScript, for any element.
for (const array of ['Array<T>', 'StaticArray<T>']) {
	const anchor = `  findIndex(callbackfn: (value: T, index: i32, array: ${array}) => bool): i32;\n`;
	const added = `  find(callbackfn: (value: T, index: i32, array: ${array}) => bool): T | undefined;\n`
		+ `  findLast(callbackfn: (value: T, index: i32, array: ${array}) => bool): T | undefined;\n`;
	const objectsOnly = added.replaceAll('T | undefined', 'T | null');
	if (text.includes(objectsOnly)) text = text.replace(objectsOnly, added);

	if (text.includes(added)) continue;
	if (!text.includes(anchor)) {
		process.stderr.write(`typings: the ${array} findIndex line was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(anchor, anchor + added);
	console.log(`typings: ${array} has find and findLast for the editor`);
}

// splice inserts, as in JavaScript: `list.splice(at, 0, item)` - our
// AssemblyScript's takes the items (runtime/patches), the shipped typings two
// arguments.
const splice = '  splice(start: i32, deleteCount?: i32): Array<T>;';
const spliceItems = '  splice(start: i32, deleteCount?: i32, ...items: T[]): Array<T>;';
if (!text.includes(spliceItems)) {
	if (!text.includes(splice)) {
		process.stderr.write(`typings: the Array splice line was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(splice, spliceItems);
	console.log('typings: Array splice takes the items to insert for the editor');
}

// Date speaks number, as in JavaScript: our AssemblyScript's Date takes and
// gives f64 milliseconds (runtime/patches), the shipped typings still say i64.
const dateStart = text.indexOf('declare class Date');
const dateEnd = text.indexOf('\n}', dateStart);
if (dateStart < 0 || dateEnd < 0) {
	process.stderr.write(`typings: no Date class in ${typings} - AssemblyScript changed it\n`);
	process.exit(1);
}
const date = text.slice(dateStart, dateEnd);
// `new Date()` is now, and the server's local time has its getters beside
// the UTC ones.
const localGetters = ['getTimezoneOffset', 'getFullYear', 'getMonth', 'getDate', 'getDay', 'getHours', 'getMinutes', 'getSeconds', 'getMilliseconds']
	.map(name => `  ${name}(): i32;\n`)
	.join('');
// Date.UTC takes the year alone, as in JavaScript: the rest default.
let numberDate = date
	.replace(/(\n {4}(?:month|day|hour|minute|second|millisecond)): i32/g, '$1?: i32')
	.replace('  ): i64;', '  ): f64;')
	.replace('static now(): i64;', 'static now(): f64;')
	.replace(/constructor\(value: [fi]64\);/, 'constructor(value?: f64);')
	.replace('getTime(): i64;', 'getTime(): f64;')
	.replace('setTime(value: i64): i64;', 'setTime(value: f64): f64;');
if (!numberDate.includes('getTimezoneOffset')) numberDate = numberDate.replace('  getUTCMilliseconds(): i32;\n', `  getUTCMilliseconds(): i32;\n\n${localGetters}`);
// The local date and time as a language writes them: `en-US` when none is named.
const localeText = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']
	.map(name => `\n  ${name}(locales?: string): string;`)
	.join('');
if (!numberDate.includes('toLocaleString')) numberDate = numberDate.replace('  toTimeString(): string;', `  toTimeString(): string;${localeText}`);
if (numberDate !== date) {
	text = text.slice(0, dateStart) + numberDate + text.slice(dateEnd);
	console.log('typings: Date takes and gives number for the editor');
}

// TypeScript's utility types, which the shipped typings leave out: a module
// types its options in amxts.config.ts as `menus?: Partial<MenuCoreOptions>`
// (as/amxts.d.ts). Only the editor reads them - asc never sees those lines.
// A Record with any string or number for a key may not have the one asked
// for, and the compiler reads a missing one as undefined: its values are
// `T | undefined`, as TypeScript's noUncheckedIndexedAccess types them.
// Keys that are all known (`Record<"red" | "blue", T>`) are all there.
const record = 'declare type Record<K extends keyof any, T> = string extends K ? { [key: string]: T | undefined } : number extends K ? { [key: number]: T | undefined } : { [P in K]: T };';
const plainRecord = 'declare type Record<K extends keyof any, T> = { [P in K]: T };';
if (text.includes(plainRecord)) text = text.replace(plainRecord, record);
const utilities = [
	'/** amxts: TypeScript\'s utility types, for the editor. */',
	'declare type Partial<T> = { [P in keyof T]?: T[P] };',
	'declare type Required<T> = { [P in keyof T]-?: T[P] };',
	'declare type Readonly<T> = { readonly [P in keyof T]: T[P] };',
	'declare type Pick<T, K extends keyof T> = { [P in K]: T[P] };',
	record,
	'',
].join('\n');
if (!text.includes(utilities)) {
	text = `${text.replace(/\n*$/, '\n')}\n${utilities}`;
	console.log('typings: Partial, Required, Readonly, Pick and Record for the editor');
}

// for...of, as TypeScript checks it from ES2015 on: the loop needs
// `[Symbol.iterator]()` on what it walks, and the shipped typings give none -
// without them the editor config would have to target ES5, the one target
// that loops over an array without an iterator, which TypeScript 6 calls
// deprecated and 7 drops. The compiler has no iterators: it lowers the loop to an indexed
// one over `length` and `[]` (runtime/patches), so the iterator is declared
// on exactly what that walks - arrays, typed arrays, strings (map.keys() and
// set.values() are arrays already) - and on nothing else.
const symbolIterator = '  readonly iterator: symbol;';
const uniqueIterator = '  readonly iterator: unique symbol;';
if (!text.includes(uniqueIterator)) {
	// A computed name in a declaration has to be a unique symbol, as in lib.es2015.
	if (!text.includes(symbolIterator)) {
		process.stderr.write(`typings: SymbolConstructor's iterator was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(symbolIterator, uniqueIterator);
}
const iterators = [
	'/** amxts: what for...of walks, for the editor - the compiler lowers the loop itself. */',
	// The arity is lib.es2015's: TypeScript checks it on these global names.
	'interface IteratorResult<T> { done: bool; value: T }',
	'interface Iterator<T, TReturn = any, TNext = any> { next(): IteratorResult<T> }',
	'interface Iterable<T, TReturn = any, TNext = any> { [Symbol.iterator](): Iterator<T, TReturn, TNext> }',
	'interface IterableIterator<T, TReturn = any, TNext = any> extends Iterator<T, TReturn, TNext> { [Symbol.iterator](): IterableIterator<T, TReturn, TNext> }',
	'',
].join('\n');
if (!text.includes(iterators)) {
	text = `${text.replace(/\n*$/, '\n')}\n${iterators}`;
	console.log('typings: Iterator and Iterable for the editor');
}
for (const [owner, index, item] of [
	['declare abstract class TypedArray<T>', '  [key: number]: T;\n', 'T'],
	['declare class Array<T>', '  [key: number]: T;\n', 'T'],
	['declare class StaticArray<T>', '  [key: number]: T;\n', 'T'],
	// String is an interface once String(value) is callable - see below
	[text.includes('declare class String ') ? 'declare class String' : 'interface String', '  [key: i32]: string;\n', 'string'],
]) {
	const start = text.indexOf(`${owner} `);
	const at = text.indexOf(index, start);
	const end = text.indexOf('\n}', start);
	if (start < 0 || at < 0 || at > end) {
		process.stderr.write(`typings: the index signature of ${owner} was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	const iterator = `  [Symbol.iterator](): IterableIterator<${item}>;\n`;
	if (text.slice(start, end).includes(iterator)) continue;
	text = text.slice(0, at + index.length) + iterator + text.slice(at + index.length);
	console.log(`typings: ${owner.replace(/^(declare (abstract )?class|interface) /, '')} has an iterator for for...of in the editor`);
}

// Number is a type alias in the shipped typings, and TypeScript 7 wants the
// global Number an interface or class ("Global type 'Number' must be a class
// or interface type"), without which `(1.5).toString()` loses its methods.
// The same members as an interface, for every TypeScript - and toFixed, which
// our AssemblyScript has (runtime/patches) and the shipped typings do not.
const numberAlias = 'declare type Number = _Float;';
const numberBare = 'interface Number extends _Float {}';
const numberInterface = 'interface Number extends _Float { toFixed(fractionDigits?: number): string }';
if (!text.includes(numberInterface)) {
	const found = [numberAlias, numberBare].find(line => text.includes(line));
	if (!found) {
		process.stderr.write(`typings: "${numberAlias}" not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(found, numberInterface);
	console.log('typings: Number is an interface with toFixed for the editor');
}

// Object.keys, values and entries, which our AssemblyScript has for a Record
// and for an object's fields (runtime/patches) and the shipped typings do not.
const objectIs = '  static is<T>(value1: T, value2: T): bool;\n';
const objectKeys = [
	'  /** The object\'s keys: a Record\'s in the order they were added, an object\'s fields in the order declared. */',
	'  static keys(object: object): string[];',
	'  /** A Record\'s values, in the order their keys were added; an object\'s fields. */',
	'  static values<T>(object: { [key: string]: T | undefined }): T[];',
	'  /** A Record\'s keys and values, as `[key, value]` pairs in the order the keys were added. */',
	'  static entries<T>(object: { [key: string]: T | undefined }): [string, T][];',
	'',
].join('\n');
if (!text.includes(objectKeys)) {
	if (!text.includes(objectIs)) {
		process.stderr.write(`typings: Object.is was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(objectIs, objectIs + objectKeys);
	console.log('typings: Object has keys, values and entries for the editor');
}

// String(value) and Boolean(value), JavaScript's conversions, which our
// AssemblyScript compiles (runtime/patches): the shipped typings declare them
// as classes, which no call signature joins - so each becomes an interface,
// which a function of its name joins, with String's statics in the namespace
// String already has.
const stringStatics = [
	'  static fromCharCode(ls: i32, hs?: i32): string;',
	'  static fromCharCodes(arr: i32[]): string;',
	'  static fromCodePoint(code: i32): string;',
	'  static fromCodePoints(arr: i32[]): string;',
	'  static raw(parts: TemplateStringsArray, ...args: any[]): string;',
];
const stringCallable = 'declare function String(value?: unknown): string;';
const booleanCallable = 'declare function Boolean(value?: unknown): boolean;';
if (!text.includes(stringCallable)) {
	const parts = ['declare class String {', 'declare class Boolean {', ...stringStatics];
	const missing = parts.find(part => !text.includes(`${part}\n`));
	if (missing) {
		process.stderr.write(`typings: "${missing.trim()}" not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	for (const line of stringStatics) text = text.replace(`${line}\n`, '');
	const namespace = ['declare namespace String {', ...stringStatics.map(line => line.replace('static', 'function')), '}'];
	text = text
		.replace('declare class String {', [stringCallable, ...namespace, 'interface String {'].join('\n'))
		.replace('declare class Boolean {', [booleanCallable, 'interface Boolean {'].join('\n'));
	console.log('typings: String(value) and Boolean(value) convert for the editor');
}

// Regular expressions, which our AssemblyScript has (runtime/patches): the
// shipped typings have an empty RegExp. String's methods that take one are
// the RegExp's underneath.
const regExpStub = 'interface RegExp {}';
const regExpTypes = [
	'declare class RegExp {',
	'  constructor(pattern: string, flags?: string);',
	'  readonly source: string;',
	'  readonly flags: string;',
	'  readonly global: boolean;',
	'  readonly ignoreCase: boolean;',
	'  readonly multiline: boolean;',
	'  readonly dotAll: boolean;',
	'  readonly sticky: boolean;',
	'  lastIndex: number;',
	'  test(text: string): boolean;',
	'  exec(text: string): RegExpExecArray | null;',
	'  toString(): string;',
	'}',
	'interface RegExpExecArray extends Array<string> {',
	'  index: number;',
	'  input: string;',
	'}',
	'interface String {',
	'  match(regexp: RegExp): RegExpExecArray | null;',
	'  matchAll(regexp: RegExp): RegExpExecArray[];',
	'  replace(regexp: RegExp, replacement: string | ((match: string, ...groups: string[]) => string)): string;',
	'  replaceAll(regexp: RegExp, replacement: string | ((match: string, ...groups: string[]) => string)): string;',
	'  search(regexp: RegExp): number;',
	'  split(separator: RegExp, limit?: number): string[];',
	'}',
].join('\n');
if (!text.includes(regExpTypes)) {
	if (!text.includes(regExpStub)) {
		process.stderr.write(`typings: "${regExpStub}" not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(regExpStub, regExpTypes);
	console.log('typings: RegExp and the String methods that take one, for the editor');
}

// Number(value), JavaScript's conversion, which our AssemblyScript compiles
// (runtime/patches): the shipped typings' Number is F64's statics, which a
// call signature joins.
const numberStatics = 'declare const Number: typeof F64;';
const numberCallable = 'declare const Number: typeof F64 & ((value?: string | number | boolean | null) => number);';
if (!text.includes(numberCallable)) {
	if (!text.includes(numberStatics)) {
		process.stderr.write(`typings: "${numberStatics}" not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(numberStatics, numberCallable);
	console.log('typings: Number(value) converts for the editor');
}

// A Map's entries and forEach, a Set's forEach, and for...of over both, which
// our AssemblyScript has (runtime/patches): the loop walks a Map's entries
// and a Set's values. A Map is made of its entries and a Set of its values.
for (const [owner, added] of [
	['declare class Map<K,V> {\n', [
		'  /** The entries, `[key, value]`, in the order the keys were added. */',
		'  entries(): [K, V][];',
		'  /** Calls `fn` with each value and key, in the order the keys were added. */',
		'  forEach(fn: (value: V, key: K, map: Map<K, V>) => void): void;',
		'  [Symbol.iterator](): IterableIterator<[K, V]>;',
		'',
	].join('\n')],
	['declare class Set<K> {\n', [
		'  /** Calls `fn` with each value, in the order they were added. */',
		'  forEach(fn: (value: K, value2: K, set: Set<K>) => void): void;',
		'  [Symbol.iterator](): IterableIterator<K>;',
		'',
	].join('\n')],
	['declare class Map<K,V> {\n', '  /** A Map of the `[key, value]` entries, set in their order. */\n  constructor(entries?: [K, V][] | null);\n'],
	['declare class Set<K> {\n', '  /** A Set of the values, added in their order. */\n  constructor(values?: K[] | null);\n'],
]) {
	if (text.includes(added)) continue;
	if (!text.includes(owner)) {
		process.stderr.write(`typings: "${owner.trim()}" was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(owner, owner + added);
	console.log(`typings: ${owner.replace(/^declare class | \{\n$/g, '')} as our AssemblyScript has it, for the editor`);
}

// Math.max and Math.min of any number of values, a spread list too, which our
// AssemblyScript compiles (runtime/patches): `Math.max(...scores)`.
for (const name of ['max', 'min']) {
	const two = `  ${name}(value1: T, value2: T): T; // TODO: rest\n`;
	const rest = `  ${name}(...values: T[]): T;\n`;
	if (text.includes(rest)) continue;
	if (!text.includes(two)) {
		process.stderr.write(`typings: Math.${name} was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(two, rest);
	console.log(`typings: Math.${name} takes any number of values for the editor`);
}

// JSON, which our AssemblyScript's library has (runtime/patches), typed: what
// JSON.parse reads is the T it is given or goes to.
const json = [
	'/** JSON text: `JSON.parse<T>(text)` and `JSON.stringify(value)`. */',
	'declare namespace JSON {',
	'  /**',
	'   * The value JSON text holds, as a T - an object of T\'s fields, an array, a Record, text, a number or a boolean:',
	'   * `JSON.parse<Settings>(text)`, `JSON.parse(text) as Settings`. A SyntaxError where the text is not JSON, a',
	'   * TypeError where it is not a T.',
	'   */',
	'  function parse<T>(text: string): T;',
	'  /** The value as JSON text; `space` indents it - that many spaces, or the text itself. A field left undefined is left out. */',
	'  function stringify(value: unknown, replacer?: null, space?: number | string): string;',
	'}',
	'',
].join('\n');
if (!text.includes(json)) {
	text = `${text.replace(/\n*$/, '\n')}\n${json}`;
	console.log('typings: JSON for the editor');
}

// ReferenceError, which our AssemblyScript's library has (runtime/patches): a
// variable read before its declaration has run throws one.
const typeError = 'declare class TypeError extends Error { }\n';
const referenceError = '/** Class for indicating an error when a variable is read before its declaration has run. */\ndeclare class ReferenceError extends Error { }\n';
if (!text.includes(referenceError)) {
	if (!text.includes(typeError)) {
		process.stderr.write(`typings: TypeError was not found in ${typings} - AssemblyScript changed it\n`);
		process.exit(1);
	}
	text = text.replace(typeError, `${typeError}\n${referenceError}`);
	console.log('typings: ReferenceError for the editor');
}

// The exceptions' state of our AssemblyScript's library (runtime/patches),
// which the hood's coroutines keep (as/promise.ts). A plugin never names it.
const exceptions = [
	'/** @hidden amxts: how many `try` blocks the running code is inside. */',
	'declare let __tryDepth: i32;',
	'/** @hidden amxts: the error on its way to a `catch`. */',
	'declare let __thrown: Error | null;',
	'/** @hidden amxts: what a `catch` takes. */',
	'declare function __catch(): Error;',
	'',
].join('\n');
if (!text.includes(exceptions)) {
	text = `${text.replace(/\n*$/, '\n')}\n${exceptions}`;
	console.log('typings: the library\'s exceptions state for the editor');
}

// The tuple classes of our AssemblyScript's library (runtime/patches): what
// a plugin writes `[string, number]` is one, and the hood's Promise.all fills
// them in (as/promise.ts). A plugin never names them.
const tupleLetters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
const tuples = [
	'/** @hidden amxts: the tuples of the library - a plugin writes `[A, B]`. */',
	'declare abstract class __Tuple { __setRaw(index: i32, ref: usize, bits: u64): void }',
	...[2, 3, 4, 5, 6, 7, 8].map((count) => {
		const letters = tupleLetters.slice(0, count);
		const fields = letters.map((letter, i) => `_${i}: ${letter}`).join('; ');
		return `/** @hidden */ declare class __Tuple${count}<${letters.join(', ')}> extends __Tuple { constructor(${letters.map((letter, i) => `_${i}: ${letter}`).join(', ')}); ${fields}; readonly length: i32 }`;
	}),
	'',
].join('\n');
if (!text.includes(tuples)) {
	text = `${text.replace(/\n*$/, '\n')}\n${tuples}`;
	console.log('typings: the library\'s tuple classes for the editor');
}

// An error's stack in our AssemblyScript's library (runtime/patches): the
// hood gives it the module's frames (as/facade.ts). A plugin never names it.
const errorStack = [
	'/** @hidden amxts: what an error\'s `stack` is made of - the host\'s frames, then their words. */',
	'declare abstract class ErrorStack { abstract frames(): StaticArray<u32>; abstract text(frames: StaticArray<u32>): string }',
	'/** @hidden amxts: the hood\'s ErrorStack. */',
	'declare let __errorStack: ErrorStack | null;',
	'',
].join('\n');
if (!text.includes(errorStack)) {
	text = `${text.replace(/\n*$/, '\n')}\n${errorStack}`;
	console.log('typings: the library\'s error stack for the editor');
}

// The console writes an Error as its stack, as JavaScript's does (runtime/patches).
for (const method of ['log', 'debug', 'info', 'warn', 'error']) {
	const plain = `  export function ${method}(message?: string): void;`;
	if (text.includes(plain)) {
		text = text.replace(plain, `  export function ${method}(message?: string | Error): void;`);
		console.log(`typings: console.${method} takes an Error for the editor`);
	}
}

writeFileSync(typings, text);
