import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FakeServer, setup } from '@amxts/core/test-utils';
// Auto-imports (scripts/auto-imports.ts): a plugin uses the facade's API and
// what its project's modules give without an import line, and the build adds
// the imports it needs - only those, so a module no plugin uses is compiled
// into none of them and left off the server.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import ts from 'typescript';
import { coreImports, facadeExports, freeNames, HOOD, importsDeclaration, withAutoImports } from '../scripts/auto-imports';
import { CORE_PLUGINS, loadProject, modulesInUse, setProjectDir, sourcesFor } from '../scripts/project';

setDefaultTimeout(240_000);

const HERE = process.cwd();
const made: string[] = [];

afterEach(() => {
	setProjectDir(HERE);
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let projects = 0;

/** A project folder with these files, the same one every run so the compile cache knows it again. */
function project(files: Record<string, string>) {
	const dir = join(tmpdir(), 'amxts-auto-imports', String(projects++));
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

/** A module package under modules/<name> that gives itself as `as`. */
function module(name: string, as: string | null, body: string) {
	const imports = as ? `, imports: [{ from: "@test/${name}", as: "${as}" }]` : '';
	return {
		[`modules/${name}/package.json`]: JSON.stringify({ name: `@test/${name}`, version: '1.0.0', amxts: { module: 'src/index.ts' } }),
		[`modules/${name}/src/index.ts`]: `import { Player } from "@amxts/core";\n\nexport default defineModule({ meta: { name: "${name}" }${imports} });\n\n${body}`,
	};
}

const GREETER = module('greeter', 'greeter', 'export function greet(player: Player) {\n\treturn `Hello, ${player.name}`;\n}\n');
const COUNTER = module('counter', 'counter', 'let count = 0;\n\nexport function next(player: Player) {\n\treturn `${player.name} ${++count}`;\n}\n');

/** A plugin that greets through the module when a player says /hi, with no import line. */
const WELCOME = 'server.addCommand("/hi", ({ player }) => player.print(greeter.greet(player)));\n';

const table = (entries: { name: string; from: string; namespace?: boolean }[]) => new Map(entries.map(entry => [entry.name, { namespace: false, ...entry }]));
const free = (code: string) => [...freeNames(ts.createSourceFile('a.ts', code, ts.ScriptTarget.Latest, true))].sort();

describe('what a file uses without declaring it', () => {
	test('a name declared in a scope that reaches the use is the file\'s own', () => {
		expect(free([
			'import { Cvar } from "@amxts/core";',
			'const limit = new Cvar("mp_limitteams");',
			'function show(player: Player, { text = fallback }: Options) {',
			'\tconst server = "local";',
			'\tplayer.print(`${text} ${server}`);',
			'}',
			'server.addCommand("/show", show);',
			'const shape = { lang: 1, game };',
			'shape.lang = player.team;',
		].join('\n'))).toEqual(['Options', 'Player', 'fallback', 'game', 'player', 'server']);
	});

	test('types, generics, classes and loops declare their names inside', () => {
		expect(free([
			'class Box<T> { value: T | null = null; constructor(readonly owner: Entity) {} }',
			'type Picked<K> = K extends Array<infer U> ? U : Team;',
			'for (const each of server.players) each.health = 100;',
			'try { risky(); } catch (error) { console.log(error); }',
			'declare module "@amxts/core" { interface Player { ghost: boolean } }',
		].join('\n'))).toEqual(['Array', 'Entity', 'Team', 'console', 'risky', 'server']);
	});

	test('the imports go after the last line, so every line keeps its number', () => {
		const code = 'server.addCommand("/hp", (player: Player) => player.print("hi"));\n\n\n';
		const out = withAutoImports('a.ts', code, table([
			{ name: 'server', from: '@amxts/core' },
			{ name: 'Player', from: '@amxts/core' },
			{ name: 'game', from: '@amxts/core' },
			{ name: 'greeter', from: '@test/greeter', namespace: true },
		]));
		expect(out.split('\n')).toEqual([
			'server.addCommand("/hp", (player: Player) => player.print("hi"));',
			'import { Player, server } from "@amxts/core";',
			'',
		]);
		expect(withAutoImports('a.ts', 'const x = 1;\n', table([{ name: 'server', from: '@amxts/core' }]))).toBe('const x = 1;\n');
	});
});

describe('the table', () => {
	test('the facade\'s API, not its hood', () => {
		const names = coreImports(join(CORE_PLUGINS, 'facade.ts')).map(entry => entry.name);
		expect(names).toEqual(expect.arrayContaining(['Player', 'server', 'game', 'lang', 'effects', 'Cvar', 'Forward', 'Storage', 'sleep', 'setTimeout', 'TakeDamageEvent', 'HideHud', 'Vector', 'Entity']));
		for (const hood of ['Call', 'CellBuffer', 'floatCell', 'publicFor', 'PawnFunction', 'addGameListener', 'HIDE_HUD', '__native']) expect(names).not.toContain(hood);
		// No natives and no constants: a plugin that goes below the facade says so with an import.
		for (const raw of ['get_user_health', 'var_origin']) expect(names).not.toContain(raw);
	});

	test('every name the hood keeps back is one the facade exports', () => {
		const exported = facadeExports(join(CORE_PLUGINS, 'facade.ts'));
		expect([...HOOD].filter(name => !exported.includes(name))).toEqual([]);
	});

	test('two sources of one name are a problem naming both', () => {
		const dir = project({
			...GREETER,
			...module('other', 'greeter', 'export function hello() {\n\treturn 1;\n}\n'),
			...module('server', 'server', 'export function up() {\n\treturn 1;\n}\n'),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter", "@test/other", "@test/server"] });\n',
		});
		expect(loadProject(dir).problems).toEqual([
			'auto-imports: greeter is given by @test/greeter and by @test/other - rename one of them (imports in @test/other\'s defineModule)',
			'auto-imports: server is given by @amxts/core and by @test/server - rename one of them (imports in @test/server\'s defineModule)',
		]);
	});

	test('a module gives its own API, not another package\'s', () => {
		const dir = project({
			'modules/thief/package.json': JSON.stringify({ name: '@test/thief', version: '1.0.0', amxts: { module: 'src/index.ts' } }),
			'modules/thief/src/index.ts': 'export default defineModule({ meta: { name: "thief" }, imports: [{ from: "@amxts/menu-core", as: "menus" }] });\n',
			'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		});
		expect(() => loadProject(dir)).toThrow('@test/thief: defineModule\'s imports give menus from "@amxts/menu-core" - a module gives its own API, from "@test/thief"');
	});

	test('what a module gives is a namespace under `as` or an export under its `name`, one of them', () => {
		const dir = project({
			'modules/both/package.json': JSON.stringify({ name: '@test/both', version: '1.0.0', amxts: { module: 'src/index.ts' } }),
			'modules/both/src/index.ts': 'export default defineModule({ meta: { name: "both" }, imports: [{ from: "@test/both", as: "both", name: "one" }] });\n',
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/both"] });\n',
		});
		expect(() => loadProject(dir)).toThrow('imports: a list of { from, as } or { from, name }');
	});

	test('the editor gets the table as globals', () => {
		expect(importsDeclaration([
			{ name: 'Player', from: '@amxts/core', namespace: false },
			{ name: 'greeter', from: '@test/greeter', namespace: true },
		])).toContain([
			'import * as __0 from "@amxts/core";',
			'import * as __1 from "@test/greeter";',
			'',
			'declare global {',
			'\texport import Player = __0.Player;',
			'\texport import greeter = __1;',
			'}',
		].join('\n'));
	});
});

describe('a project', () => {
	test('a plugin uses the facade and a module without an import line; the module no plugin uses is left out', async () => {
		const dir = project({
			...GREETER,
			...COUNTER,
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter", "@test/counter"] });\n',
			'plugins/welcome.ts': WELCOME,
		});
		setProjectDir(dir);

		const loaded = loadProject(dir);
		expect(loaded.problems).toEqual([]);
		expect(modulesInUse(sourcesFor(CORE_PLUGINS), [join(dir, 'plugins/welcome.ts')]).map(pkg => pkg.name)).toEqual(['@test/greeter']);

		const server = await setup({ rootDir: dir });
		expect(server.plugins.map(plugin => (plugin.source.startsWith('@') ? plugin.source : plugin.source.replace(/^.*[\\/]/, '')))).toEqual(['@test/greeter', 'welcome.ts']);
		const alice = server.join('Alice');
		alice.say('/hi');
		expect(alice.chat).toContain('Hello, Alice');
	});

	test('a module gives one export by its own name: an object whose property a plugin assigns', async () => {
		const dir = project({
			'modules/tally/package.json': JSON.stringify({ name: '@test/tally', version: '1.0.0', amxts: { module: 'src/index.ts' } }),
			'modules/tally/src/index.ts': [
				'export default defineModule({ meta: { name: "tally" }, imports: [{ from: "@test/tally", name: "tally" }] });',
				'',
				'let total = 0;',
				'',
				'export class Tally {',
				'\tget total() {',
				'\t\treturn total;',
				'\t}',
				'',
				'\tset total(value: number) {',
				'\t\ttotal = value;',
				'\t}',
				'}',
				'',
				'export const tally = new Tally();',
				'',
			].join('\n'),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/tally"] });\n',
			'plugins/scores.ts': 'server.addCommand("/add", ({ player }) => {\n\ttally.total = tally.total + 5;\n\tplayer.print(`total ${tally.total}`);\n});\n',
		});
		const server = await setup({ rootDir: dir });
		const alice = server.join('Alice');
		alice.say('/add');
		alice.say('/add');
		expect(alice.chat).toContain('total 10');
	});

	test('pawn keeps a module no plugin uses, for the Pawn plugins that call its natives', () => {
		const dir = project({
			...GREETER,
			...COUNTER,
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter", "@test/counter"], pawn: ["@test/counter"] });\n',
			'plugins/welcome.ts': WELCOME,
		});
		setProjectDir(dir);
		expect(modulesInUse(sourcesFor(CORE_PLUGINS), [join(dir, 'plugins/welcome.ts')]).map(pkg => pkg.name)).toEqual(['@test/greeter', '@test/counter']);
	});

	test('an explicit import works as it always has, and a local of the same name wins', async () => {
		const dir = project({
			...GREETER,
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter"] });\n',
			'plugins/welcome.ts': [
				'import { server } from "@amxts/core";',
				'import * as greeter from "@test/greeter";',
				'',
				'server.addCommand("/hi", ({ player }) => {',
				'\tconst lang = "local";',
				'\tplayer.print(`${greeter.greet(player)} (${lang})`);',
				'});',
				'',
			].join('\n'),
		});
		const server = await setup({ rootDir: dir });
		const alice = server.join('Alice');
		alice.say('/hi');
		expect(alice.chat).toContain('Hello, Alice (local)');
	});

	test('imports: { autoImport: false } - the plugin imports what it uses', async () => {
		const dir = project({
			...GREETER,
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter"], imports: { autoImport: false } });\n',
			'plugins/welcome.ts': WELCOME,
		});
		setProjectDir(dir);
		expect(loadProject(dir).autoImports).toEqual([]);
		await expect(new FakeServer().load(join(dir, 'plugins/welcome.ts'))).rejects.toThrow(/Cannot find name 'server'/);
	});
});
