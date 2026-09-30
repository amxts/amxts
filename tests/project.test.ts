import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FakeServer, setup } from '@amxts/core/test-utils';
import { installMenus } from '@amxts/menu-core/testing';
// A project (scripts/project.ts): amxts.config.ts lists module packages, a
// module declares itself with defineModule, and plugins import it by its
// package name. What is checked here is what the build promises - a module
// whose requirement is not listed is an error naming it, the options are the
// defaults with the config over them, setup runs once and in the owner, and a
// plugin that writes "@amxts/menu-core" gets the module.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { loadProject, mergeOptions, moduleSource, pluginList, PROJECT_GAME_FOLDERS, readDefinition, setProjectDir } from '../scripts/project';

setDefaultTimeout(240_000);

const HERE = process.cwd();
const made: string[] = [];

afterEach(() => {
	setProjectDir(HERE);
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let projects = 0;

/**
 * A project folder with these files; the plugins go under plugins/. The same
 * folder every run, so the compile cache knows it again.
 */
function project(files: Record<string, string>) {
	const dir = join(tmpdir(), 'amxts-project', String(projects++));
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	made.push(dir);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

/** A local module package under modules/<name>: package.json with the amxts field, and its src/index.ts. */
function module(name: string, index: string, natives?: string) {
	const amxts: Record<string, string> = { module: 'src/index.ts' };
	if (natives) amxts.natives = 'src/natives.ts';
	return {
		[`modules/${name}/package.json`]: JSON.stringify({ name: `@test/${name}`, version: '1.2.3', description: `the ${name} module`, amxts }),
		[`modules/${name}/src/index.ts`]: index,
		...(natives ? { [`modules/${name}/src/natives.ts`]: natives } : {}),
	};
}

const GREETER = [
	'import { server } from "~/facade";',
	'',
	'export interface GreeterOptions {',
	'\tgreeting: string;',
	'\ttimes: number;',
	'\tloud: boolean;',
	'}',
	'',
	'export default defineModule<GreeterOptions>({',
	'\tmeta: { name: "greeter", configKey: "greeter" },',
	'\tdefaults: { greeting: "Hello", times: 1, loud: false },',
	'\tsetup(options) {',
	'\t\tgreeting = options.loud ? options.greeting.toUpperCase() : options.greeting;',
	'\t\tconsole.log(`greeter setup: ${options.greeting} x${options.times}`);',
	'\t},',
	'});',
	'',
	'declare module "@amxts/core" {',
	'\tinterface ModuleOptions {',
	'\t\tgreeter?: Partial<GreeterOptions>;',
	'\t}',
	'}',
	'',
	'let greeting = "";',
	'',
	'export function greet(name: string) {',
	'\treturn `${greeting}, ${name} (${server.maxPlayers})`;',
	'}',
	'',
].join('\n');

const SHOUTER = [
	'import * as greeter from "@test/greeter";',
	'',
	'export default defineModule({',
	'\tmeta: { name: "shouter" },',
	'\trequires: ["@test/greeter"],',
	'});',
	'',
	'export function shout(name: string) {',
	'\treturn `${greeter.greet(name)}!`;',
	'}',
	'',
].join('\n');

/** A plugin that greets through the module, as a native a test can call. */
function greeting(native: string) {
	return `import * as greeter from "@test/greeter";\n\nexport function ${native}(name: string) {\n\treturn greeter.greet(name);\n}\n`;
}

describe('amxts.config.ts', () => {
	test('a module the config does not list comes along with the one that requires it', async () => {
		const dir = project({
			...module('greeter', GREETER),
			...module('shouter', SHOUTER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/shouter"] });\n',
			'plugins/a.ts': 'import * as shouter from "@test/shouter";\n\nexport function a_shout(name: string) {\n\treturn shouter.shout(name);\n}\n',
		});

		const loaded = loadProject(dir);
		expect(loaded.problems).toEqual([]);
		expect(loaded.modules.map(pkg => pkg.name)).toEqual(['@test/greeter', '@test/shouter']);

		setProjectDir(dir);
		const server = new FakeServer();
		for (const pkg of loaded.modules) await server.load(pkg.name);
		await server.load(join(dir, 'plugins/a.ts'));
	});

	test('a required module that is not installed is a build error naming it', () => {
		const dir = project({
			...module('shouter', SHOUTER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/shouter"] });\n',
		});

		expect(loadProject(dir).problems).toEqual(['amxts.config.ts: @test/shouter requires @test/greeter, which is not installed - npm install @test/greeter']);
	});

	test('a module that is not installed, a key no module takes and an option a module does not have are errors', () => {
		const dir = project({
			...module('greeter', GREETER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter", "@test/nowhere"], greeter: { greting: "Hi" }, shouter: {} });\n',
		});

		expect(loadProject(dir).problems).toEqual([
			'amxts.config.ts: module "@test/nowhere" is not installed - no package of that name with an "amxts" field in modules/ or node_modules',
			'amxts.config.ts: shouter - no module in modules takes it (its defineModule has no configKey "shouter")',
			'amxts.config.ts: greeter.greting - @test/greeter has no such option (greeting, times, loud)',
		]);
	});

	test('target is the project\'s own key: "rehlds" or "hlds"', () => {
		const dir = project({ 'amxts.config.ts': 'export default defineConfig({ modules: [], target: "hlds" });\n' });
		expect(loadProject(dir).problems).toEqual([]);

		const wrong = project({ 'amxts.config.ts': 'export default defineConfig({ modules: [], target: "rehds" });\n' });
		expect(() => loadProject(wrong)).toThrow('target is "rehlds" (ReHLDS, ReGameDLL and ReAPI) or "hlds" (plain HLDS), not "rehds"');
	});

	test('modules load after what they require, whatever order the config lists them in', () => {
		const dir = project({
			...module('greeter', GREETER),
			...module('shouter', SHOUTER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/shouter", "@test/greeter"] });\n',
		});

		const loaded = loadProject(dir);
		expect(loaded.problems).toEqual([]);
		expect(loaded.modules.map(pkg => pkg.name)).toEqual(['@test/greeter', '@test/shouter']);
		expect(pluginList(loaded, ['a.aot'])).toEqual(['greeter.aot', 'shouter.aot', 'a.aot']);
	});
});

describe('options', () => {
	test('the defaults, with the config over them: objects key by key, anything else replaced', () => {
		expect(mergeOptions(
			{ greeting: 'Hello', times: 1, colors: { hud: [255, 0, 0], chat: 'green' }, words: ['a', 'b'] },
			{ times: 3, colors: { chat: 'red' }, words: ['c'] },
		)).toEqual({ greeting: 'Hello', times: 3, colors: { hud: [255, 0, 0], chat: 'red' }, words: ['c'] });
	});

	test('defineModule is read from the source; setup becomes a function the module\'s last line calls', () => {
		const definition = readDefinition('greeter.ts', GREETER)!;
		expect(definition).toEqual({
			name: 'greeter',
			configKey: 'greeter',
			requires: [],
			defaults: { greeting: 'Hello', times: 1, loud: false },
			imports: [],
			optionsType: 'GreeterOptions',
			hasSetup: true,
		});

		const source = moduleSource('greeter.ts', GREETER, { greeting: 'Привет', times: 2, loud: false });
		expect(source).not.toContain('defineModule');
		expect(source).not.toContain('declare module');
		expect(source).toContain('function __amxts_setup(options: GreeterOptions): void {');
		expect(source.trimEnd().split('\n').at(-1)).toBe('__amxts_setup({ greeting: "Привет", times: 2, loud: false });');
		// Every line stays where it was: an error points at the module's own line.
		expect(source.split('\n').indexOf('let greeting = "";')).toBe(GREETER.split('\n').indexOf('let greeting = "";'));
	});

	test('a setup that takes no options is called without them', () => {
		const source = moduleSource('quiet.ts', 'export default defineModule({\n\tmeta: { name: "quiet" },\n\tsetup() {\n\t\tstarted = true;\n\t},\n});\n\nlet started = false;\n', {});
		expect(source).toContain('function __amxts_setup(): void {');
		expect(source.trimEnd().split('\n').at(-1)).toBe('__amxts_setup();');
	});

	test('a definition that is not literals says what it wants', () => {
		expect(() => readDefinition('bad.ts', 'const x = 1;\nexport default defineModule<{ a: number }>({ meta: { name: "bad" }, defaults: { a: x } });\n'))
			.toThrow('bad.ts: defineModule defaults.a: a literal goes here');
	});
});

describe('setup and the owner', () => {
	test('setup runs once, in the owner, with the merged options; every plugin calls that instance', async () => {
		const dir = project({
			...module('greeter', GREETER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter"], greeter: { greeting: "Привет", loud: true } });\n',
			'plugins/a.ts': greeting('a_greet'),
			'plugins/b.ts': greeting('b_greet'),
		});
		setProjectDir(dir);

		const server = new FakeServer();
		// The module has no natives: the build generates its owner.
		await server.load('@test/greeter');
		await server.load(join(dir, 'plugins/a.ts'));
		await server.load(join(dir, 'plugins/b.ts'));
		server.start();

		expect(server.log.split('\n').filter(line => line.includes('greeter setup'))).toEqual(['greeter setup: Привет x1']);
		expect(server.native('a_greet', 'Alice')).toBe('ПРИВЕТ, Alice (32)');
		expect(server.native('b_greet', 'Bob')).toBe('ПРИВЕТ, Bob (32)');
	});

	test('a plugin that imports a package the config does not list is told to add it', async () => {
		const dir = project({
			...module('greeter', GREETER),
			'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
			'plugins/a.ts': greeting('a_greet'),
		});
		setProjectDir(dir);

		const server = new FakeServer();
		await expect(server.load(join(dir, 'plugins/a.ts'))).rejects.toThrow('plugins/a.ts: imports @test/greeter, which amxts.config.ts does not list - add it to modules');
	});
});

describe('a contract', () => {
	test('"contract": true checks the natives against the package\'s include, which the natives need not name', async () => {
		const natives = 'import { plugin } from "~/facade";\n\nplugin({ name: "Tagger", version: "1.0.0", author: "", description: "" });\n\nexport function tagger_tag(id: number) {\n\treturn id + 1;\n}\n';
		const dir = project({
			'modules/tagger/package.json': JSON.stringify({ name: '@test/tagger', version: '1.0.0', amxts: { module: 'src/index.ts', natives: 'src/natives.ts', include: 'include/tagger.inc', contract: true } }),
			'modules/tagger/src/index.ts': 'export function nothing() {\n\treturn 0;\n}\n',
			'modules/tagger/src/natives.ts': natives,
			'modules/tagger/include/tagger.inc': '#if defined _tagger_included\n\t#endinput\n#endif\n#define _tagger_included\n\nnative tagger_tag(id);\nnative tagger_untag(id);\n',
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/tagger"] });\n',
		});
		setProjectDir(dir);

		const server = new FakeServer();
		await expect(server.load('@test/tagger')).rejects.toThrow('tagger.inc declares tagger_untag, and the plugin does not export it');
	});
});

/** A module whose test kit answers a native the fake server does not: the time a player has played. */
const TIMER = {
	'modules/timer/package.json': JSON.stringify({ name: '@test/timer', version: '1.0.0', amxts: { module: 'src/index.ts', testing: 'testing.ts' } }),
	'modules/timer/src/index.ts': [
		'import { Player } from "~/facade";',
		'import { get_user_time } from "~/natives";',
		'',
		'export default defineModule({ meta: { name: "timer" } });',
		'',
		'export function played(player: Player) {',
		'\treturn get_user_time(player.id);',
		'}',
		'',
	].join('\n'),
	// A kit is the default export of a file for the test runner; defineTestKit only gives it its type.
	'modules/timer/testing.ts': [
		'export default {',
		'\tinstall(server: any) {',
		'\t\tserver.defineNative("get_user_time", () => 42);',
		'\t\treturn "the timer kit";',
		'\t},',
		'};',
		'',
	].join('\n'),
};

/** A plugin's file name, or a module package's name, as the server loaded it. */
function loaded(server: FakeServer) {
	return server.plugins.map(plugin => (plugin.source.startsWith('@') ? plugin.source : plugin.source.replace(/^.*[\\/]/, '')));
}

describe('test-utils: setup() and test kits', () => {
	test('the modules in load order, each with its test kit, then the plugins, then the map', async () => {
		const dir = project({
			...TIMER,
			...module('greeter', GREETER),
			...module('shouter', SHOUTER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/shouter", "@test/timer"], greeter: { greeting: "Hi" } });\n',
			'plugins/a.ts': [
				'import { Player } from "~/facade";',
				'import * as timer from "@test/timer";',
				'import * as shouter from "@test/shouter";',
				'',
				'export function a_played(id: number) {',
				'\tconst player = new Player(id);',
				'\treturn timer.played(player);',
				'}',
				'',
				'export function a_shout(name: string) {',
				'\treturn shouter.shout(name);',
				'}',
				'',
			].join('\n'),
			'plugins/b.ts': 'export function b_here() {\n\treturn true;\n}\n',
		});

		const server = await setup({ rootDir: dir, maxPlayers: 10 });
		expect(loaded(server)).toEqual(['@test/greeter', '@test/shouter', '@test/timer', 'a.ts', 'b.ts']);
		expect(server.kits.get('@test/timer')).toBe('the timer kit');
		expect(server.log).toContain('greeter setup: Hi x1');

		const alice = server.join('Alice');
		expect(server.native('a_played', alice.id)).toBe(42);
		expect(server.native('a_shout', 'Bob')).toBe('Hi, Bob (10)!');
	});

	test('some of the plugins, by name; a module\'s own folder, without a config, is the module alone', async () => {
		const dir = project({
			...module('greeter', GREETER),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/greeter"] });\n',
			'plugins/a.ts': greeting('a_greet'),
			'plugins/b.ts': greeting('b_greet'),
		});

		const some = await setup({ rootDir: dir, plugins: ['b'] });
		expect(loaded(some)).toEqual(['@test/greeter', 'b.ts']);
		expect(some.native('b_greet', 'Alice')).toBe('Hello, Alice (32)');
		await expect(setup({ rootDir: dir, plugins: ['c'] })).rejects.toThrow('setup: no plugin c.ts in the project\'s plugins (a.ts, b.ts)');

		const alone = await setup({ rootDir: join(dir, 'modules/greeter') });
		expect(loaded(alone)).toEqual(['@test/greeter']);
	});

	test('a module package loaded by name brings its test kit along', async () => {
		const dir = project({
			...TIMER,
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/timer"] });\n',
		});
		setProjectDir(dir);

		const server = new FakeServer();
		await server.load('@test/timer');
		expect(server.kits.get('@test/timer')).toBe('the timer kit');
	});
});

describe('the official modules by package name', () => {
	test('a plugin importing "@amxts/menu-core" gets the module that the menu-core plugin runs', async () => {
		const server = new FakeServer();
		const menus = installMenus(server);
		await server.load('@amxts/config-core');
		await server.load('@amxts/menu-core');
		await server.load('tests/as/menu-by-name.ts');
		server.start();

		const alice = server.join('Alice');
		expect(server.native('by_name_show', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toContain('По имени пакета');
	});
});

test('the test server lays the game folders of a project out as the amxts-server image does', () => {
	const image = readFileSync('docker/server/start.sh', 'utf8').match(/for dir in ([\w ]+); do/)![1].split(' ');

	expect(PROJECT_GAME_FOLDERS).toEqual(expect.arrayContaining(image.map(dir => [dir, dir])));
	expect(PROJECT_GAME_FOLDERS).toEqual(expect.arrayContaining([['addons', 'addons'], ['data', 'addons/amxmodx/data']]));
});
