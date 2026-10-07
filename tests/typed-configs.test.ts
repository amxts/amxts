import { resolve } from 'node:path';
/**
 * Typed configs (scripts/typed-configs.ts): `configs.load(name, defaults)`
 * of @amxts/config-core made into code for the object's shape. The shapes and
 * the build's refusals are checked here on the transform itself; the module's
 * own tests (config-core's test/typed.test.ts) read and write real files
 * through it. One plugin is compiled with the module in it, as the module's
 * own code has it - no proxy between the generated code and ConfigNode.
 */
// @ts-ignore - bun:test types not available during type checking
import { beforeAll, describe, expect, test } from 'bun:test';
import { ascMain } from '../scripts/asc';
import { playerFieldsBuild } from '../scripts/player-fields';
import { ascPath, sourcesFor } from '../scripts/project';
import { typedConfigs } from '../scripts/typed-configs';
import { stressed } from '../src/testing/compile';

declare const WebAssembly: any;

const MODULE = '~/modules/config-core';

/** The transform over files held here: `plugin.ts` is the one transformed, the rest are what it imports. */
function transform(plugin: string, others: Record<string, string> = {}) {
	return typedConfigs('/p/plugin.ts', 'plugin.ts', plugin, (from, spec) => {
		const name = resolve('/p', spec.replace(/^\.\//, '')).replace(/\\/g, '/').replace(/^[A-Z]:/, '');
		const file = Object.keys(others).find(each => `/p/${each}` === `${name}.ts` || `/p/${each}` === name);
		return file ? { path: `/p/${file}`, text: others[file] } : null;
	});
}

const HEAD = `import * as configs from "${MODULE}";\n`;

describe('the calls', () => {
	test('a load with defaults becomes the generated function, written after the last line of the file', () => {
		const { text, problems } = transform(`${HEAD}const settings = configs.load("s", { chat: { prefix: "[HNS]" } });\nconst x = 1;\n`);
		expect(problems).toEqual([]);
		const lines = text.split('\n');
		expect(lines[1]).toBe('const settings = __amxtsConfigLoad0("s", { chat: { prefix: "[HNS]" } });');
		expect(lines[2]).toBe('const x = 1;');
		expect(text).toContain('interface __AmxtsConfig0 { chat: { prefix: string } }');
		expect(text).toContain('function __amxtsConfigLoad0(name: string, defaults: __AmxtsConfig0) {');
		expect(text).toContain('import * as __amxtsConfigs from "~/modules/config-core/src/typed";');
	});

	test('with a type argument the function takes that type, padded so the line keeps its columns; save() with one argument is the typed one', () => {
		const { text, problems } = transform(`${HEAD}interface Settings { motd?: string; mode: "a" | "b" }\nconst s = configs.load<Settings>("s", { mode: "a" });\nconfigs.save(s);\n`);
		expect(problems).toEqual([]);
		expect(text.split('\n')[2]).toBe('const s = __amxtsConfigLoad0    ("s", { mode: "a" });');
		expect(text.split('\n')[3]).toBe('__amxtsConfigs.save(s);');
		expect(text).toContain('function __amxtsConfigLoad0(name: string, defaults: Settings) {');
		expect(text).toContain('.is(node1, "name", ["a","b"])');
	});

	test('a load without defaults, a save of two arguments and a file without the module stay as they are', () => {
		const ini = `${HEAD}const c = configs.load("s");\nconfigs.save(c, "s");\n`;
		expect(transform(ini).text).toBe(ini);
		const other = 'import * as configs from "./configs";\nconst s = configs.load("s", {});\n';
		expect(transform(other).text).toBe(other);
	});

	test('a list of lists - rows of values - is read a row at a time, and written a row at a time', () => {
		const { text, problems } = transform(`${HEAD}type Side = "ct" | "tt";\ninterface S { rows: string[][]; sides?: Side[][] }\nconst s = configs.load<S>("s", { rows: [["a", "b"]] });\nconst t = configs.load("t", { numbers: [[1, 2]] });\n`);
		expect(problems).toEqual([]);
		expect(text).toContain('value.rows = rows1.map<string[]>(row => __amxtsConfigs.asTexts(row));');
		expect(text).toContain('.map<("ct" | "tt")[]>(row => __amxtsConfigs.asNames(row, ["ct","tt"]));');
		expect(text).toContain('numbers: defaults.numbers.map<number[]>(row => row.slice(0))');
		expect(text).toContain('__amxtsConfigs.resizeLists(root, `rows`, value.rows.length);');
		expect(text).toContain('__amxtsConfigs.putTexts(root, `rows[${index');
		expect(text).toContain('__amxtsConfigs.putNumbers(root, `numbers[${index');
	});

	test('named imports, renamed ones included', () => {
		const { text } = transform(`import { load as read, save } from "${MODULE}";\nconst s = read("s", { a: 1 });\nsave(s);\n`);
		expect(text.split('\n')[1]).toBe('const s = __amxtsConfigLoad0("s", { a: 1 });');
		expect(text.split('\n')[2]).toBe('__amxtsConfigs.save(s);');
	});

	test('a type from another file: imported by name, through a namespace, passed on by export *', () => {
		const types = 'export interface Chat { prefix: string }\nexport type Mode = "x" | "y";\n';
		const others = { 'types.ts': types, 'index.ts': 'export * from "./types";\n' };
		const named = transform(`${HEAD}import { Chat } from "./types";\ninterface S { chat: Chat }\nconst s = configs.load<S>("s", { chat: { prefix: "" } });\n`, others);
		expect(named.problems).toEqual([]);
		const namespaced = transform(`${HEAD}import * as t from "./index";\nconst s = configs.load<t.Chat>("s", { prefix: "" });\n`, others);
		expect(namespaced.problems).toEqual([]);
		expect(namespaced.text).toContain('if (__amxtsConfigs.is(node0, "text")) value.prefix = __amxtsConfigs.asText(node0);');
	});

	test('the defaults as a variable take its declared type', () => {
		const { text, problems } = transform(`${HEAD}interface S { a: number }\nfunction f() {\n\tconst d: S = { a: 1 };\n\treturn configs.load("s", d);\n}\n`);
		expect(problems).toEqual([]);
		expect(text).toContain('function __amxtsConfigLoad0(name: string, defaults: S) {');
	});
});

describe('what the build refuses, with the place and the fix', () => {
	const refused = (source: string) => transform(`${HEAD}${source}`).problems;

	test('an empty list in the defaults, and a value whose type is not seen', () => {
		expect(refused('const s = configs.load("s", { maps: [] });\n')).toEqual([
			'plugin.ts:2:37: configs.load - [] - an empty list says nothing of its items; give the type: configs.load<Settings>(...), or write the list with an item',
		]);
		expect(refused('const s = configs.load("s", { prefix: PREFIX });\n')).toEqual([
			'plugin.ts:2:39: configs.load - PREFIX - its type is not seen from the value; give the type: configs.load<Settings>(...)',
		]);
		expect(refused('const s = configs.load("s", defaults);\n')).toEqual([
			'plugin.ts:2:29: configs.load - defaults - its type is not seen here; give it a type, or the call one: configs.load<Settings>(...)',
		]);
	});

	test('types a config cannot have', () => {
		expect(refused('interface S { n: number | string }\nconst s = configs.load<S>("s", { n: 1 });\n')).toEqual([
			'plugin.ts:2:18: configs.load - number | string - a union is of string literals only, "a" | "b"; for "not set" write the field with ?',
		]);
		expect(refused('interface S { f(): void }\nconst s = configs.load<S>("s", {});\n')).toEqual([
			'plugin.ts:2:15: configs.load - f(): void - an object of a config has fields only, each with its type',
		]);
		expect(refused('interface B { a: string }\ninterface S extends B { b: string }\nconst s = configs.load<S>("s", { a: "", b: "" });\n')).toEqual([
			'plugin.ts:4:24: configs.load - S - an interface that is generic or extends another cannot be a config\'s; write its fields out',
		]);
		expect(refused('interface S { m: string[][][] }\nconst s = configs.load<S>("s", { m: [] });\n')).toEqual([
			'plugin.ts:2:18: configs.load - string[][][] - a list holds text, numbers, booleans, names, objects or lists of values - not Maps, or lists of lists or of objects',
		]);
		expect(refused('interface I { a: string }\ninterface S { m: I[][] }\nconst s = configs.load<S>("s", { m: [] });\n')).toEqual([
			'plugin.ts:3:18: configs.load - I[][] - a list holds text, numbers, booleans, names, objects or lists of values - not Maps, or lists of lists or of objects',
		]);
		expect(refused('const s = configs.load<Unknown>("s", {});\n')).toEqual([
			'plugin.ts:2:24: configs.load - Unknown - not declared in this file or imported into it; a config\'s type is an interface or a type alias',
		]);
		expect(refused('const s = configs.load<string>("s", "x");\n')).toEqual([
			'plugin.ts:2:11: configs.load - a config is an object: configs.load(name, { ... })',
		]);
	});
});

describe('with the module in the same plugin', () => {
	const root = resolve('as');
	const playerFields = playerFieldsBuild();
	let exports: any;

	beforeAll(async () => {
		let binary: Uint8Array | undefined;
		const sources = sourcesFor(root);
		const { error, stderr } = await ascMain(stressed(['../tests/as/typed-config.ts', '--outFile', 'typed.wasm', '--exportRuntime']), {
			readFile(filename: string, baseDir: string): string | null {
				const path = ascPath(root, filename, baseDir);
				const text = sources.read(path);
				return text === null ? null : playerFields.read(path, text);
			},
			writeFile(_: string, contents: string | Uint8Array) {
				if (typeof contents !== 'string') binary = contents;
			},
			listFiles: () => [],
			transforms: [playerFields.transform],
		});
		if (error) throw new Error(stderr.toString());
		expect(sources.problems).toEqual([]);

		const module = new WebAssembly.Module(binary!);
		// Every native answers 0: no file opens, so the defaults are what is read and save() fails.
		const imports: Record<string, Record<string, () => number>> = {};
		for (const { module: name, name: fn } of WebAssembly.Module.imports(module)) (imports[name] ??= {})[fn] = () => 0;
		exports = new WebAssembly.Instance(module, imports).exports;
	});

	test('the defaults come back, typed; the object is changed and saved through the real ConfigNode', () => {
		const pointer = exports.typedDefaults();
		const length = new Uint32Array(exports.memory.buffer)[(pointer - 4) >>> 2] >>> 1;
		const text = String.fromCharCode(...new Uint16Array(exports.memory.buffer, pointer, length));
		expect(text).toBe('[T]|true|4|a|x,y|r,1;s,2|false');
	});
});
