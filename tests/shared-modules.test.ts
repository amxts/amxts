import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeServer, setup } from '@amxts/core/test-utils';
import { installMenus } from '@amxts/menu-core/testing';
// Modules with one instance on the server (scripts/shared-modules.ts): two
// plugins write the plain import, and what one of them sets up in
// ~/modules/menu-core or ~/modules/config-core the other sees - because
// both call the instance the owner plugin runs.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { setProjectDir } from '../scripts/project';
import { analyzeModule, proxySource, serveSource } from '../scripts/shared-modules';

setDefaultTimeout(240_000);

const CONFIGS = 'addons/amxmodx/configs';

async function boot(plugins: string[]) {
	const server = new FakeServer({ files: { [`${CONFIGS}/shared/on-disk.ini`]: '[DISK]\nNAME = disk\n' } });
	const menus = installMenus(server);
	for (const plugin of plugins) await server.load(plugin);
	server.start();
	return { server, menus };
}

const OWNERS = ['@amxts/config-core', '@amxts/menu-core'];
const BOTH = [...OWNERS, 'tests/as/shared-shop.ts', 'tests/as/shared-viewer.ts'];

describe('one instance, two plugins', () => {
	test('a menu one plugin makes, the other shows; its requirement, placeholder and actions are called back', async () => {
		const { server, menus } = await boot(BOTH);
		const alice = server.join('Alice', { health: 40 });
		const bob = server.join('Bob');

		expect(server.native('shared_show', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toContain('Shop');
		expect(menus.screen(alice)!.text).toContain('\\y[1]\\w Hello (40)');
		menus.press(alice, 1);
		expect(server.native('shared_chosen')).toBe('GREET Alice');

		expect(server.native('shared_show', bob.id)).toBe(true);
		expect(menus.screen(bob)!.text).toContain('\\d[1] Hello (100)');
		menus.press(bob, 2);
		expect(server.native('shared_chosen')).toBe('knife Bob');
	});

	test('preventDefault() in the other plugin stops the menu', async () => {
		const { server, menus } = await boot(BOTH);
		const carol = server.join('Carol');
		expect(server.native('shared_show', carol.id)).toBe(false);
		expect(menus.screen(carol)).toBe(null);
	});

	test('the menu object is the owner\'s: its fields are read and written there', async () => {
		const { server, menus } = await boot(BOTH);
		expect(server.native('shared_menu')).toBe('items|SHARED_SHOP');
		server.native('shared_retitle', 'Bazaar');
		const alice = server.join('Alice');
		server.native('shared_show', alice.id);
		expect(menus.screen(alice)!.text).toStartWith('Bazaar');
	});

	test('its methods run there too: an item from the other plugin, whose functions are called back', async () => {
		const { server, menus } = await boot(BOTH);
		expect(server.native('shared_add', 'Shield')).toBe(true);
		const alice = server.join('Alice');
		const bob = server.join('Bob');

		expect(server.native('shared_open', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toContain('\\y[3]\\w Shield for Alice');
		menus.press(alice, 3);
		expect(server.native('shared_picked')).toBe('Shield Alice');

		server.native('shared_open', bob.id);
		expect(menus.screen(bob)!.text).not.toContain('Shield'); // visible says no to Bob
	});

	test('a config one plugin writes, the other reads; the base folder is one for both', async () => {
		const { server } = await boot(BOTH);
		expect(server.native('shared_config')).toBe('value|disk');
	});

	test('without the owner running, a call fails in the log and answers nothing', async () => {
		const { server } = await boot(['tests/as/shared-viewer.ts']);
		const alice = server.join('Alice');
		expect(server.native('shared_show', alice.id)).toBe(false);
		expect(server.native('shared_menu')).toBe('no menu');
		expect(server.log).toContain('menu-core: no plugin runs it - is menu-core.aot in plugins.ini?');
	});
});

describe('a plugin that stops', () => {
	const HELLO = 'tests/as/shared-hello.ts';

	test('its menu goes, closed on the next frame for whoever looks at it; loaded again, it makes the menu once and is called back itself', async () => {
		const { server, menus } = await boot([...OWNERS, HELLO]);
		const alice = server.join('Alice', { health: 81 });

		expect(server.native('shared_hello_show', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toContain('Wave');
		server.unload(server.plugins.find(plugin => plugin.source === HELLO)!);
		server.advance(100);
		expect(menus.screen(alice)).toBe(null);

		await server.load(HELLO);
		expect(server.native('shared_hello_show', alice.id)).toBe(true);
		const text = menus.screen(alice)!.text;
		expect(text).toContain('\\y[1]\\w Wave');
		expect(text).toContain('\\y[2]\\w Heal (81 HP)');
		expect(text).not.toContain('[3]');
		expect(text.split('Wave').length).toBe(2);

		menus.press(alice, 1);
		expect(server.native('shared_hello_waves')).toBe(1);
		expect(server.log).not.toContain('called back a function of a plugin that was unloaded');
	});

	test('what it added to another plugin\'s menu goes, and that menu stays', async () => {
		const { server, menus } = await boot(BOTH);
		expect(server.native('shared_add', 'Shield')).toBe(true);
		const alice = server.join('Alice');
		expect(server.native('shared_open', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toContain('Shield for Alice');

		server.unload(server.plugins.find(plugin => plugin.source === 'tests/as/shared-viewer.ts')!);
		const text = menus.screen(alice)!.text;
		expect(text).toContain('Knife');
		expect(text).not.toContain('Shield');
	});

	test('a module that keeps its function hears it stop; the function answers nothing, said once in the log', async () => {
		const root = join(tmpdir(), 'amxts-shared-stop');
		rmSync(root, { recursive: true, force: true });
		const files: Record<string, string> = {
			'package.json': JSON.stringify({ name: 'stop-project', private: true }),
			'amxts.config.ts': 'export default defineConfig({ modules: ["@test/keeper"] });\n',
			'modules/keeper/package.json': JSON.stringify({ name: '@test/keeper', version: '1.0.0', amxts: { module: 'src/index.ts' } }),
			'modules/keeper/src/index.ts': [
				'import { callingPlugin, onPluginStop } from "@amxts/core/kit";',
				'',
				'export default defineModule({ meta: { name: "keeper" }, imports: [{ from: "@test/keeper", as: "keeper" }], setup() {',
				'\tonPluginStop((plugin) => stops.push(plugin));',
				'} });',
				'',
				'let kept: (() => number) | null = null;',
				'let keptFrom = 0;',
				'const stops: number[] = [];',
				'',
				'export function keep(fn: () => number) {',
				'\tkept = fn;',
				'\tkeptFrom = callingPlugin();',
				'}',
				'',
				'export function ask() {',
				'\tconst fn = kept;',
				'\treturn fn != null ? fn() : -1;',
				'}',
				'',
				'export function giver() {',
				'\treturn keptFrom;',
				'}',
				'',
				'export function stopped() {',
				'\treturn stops.join(",");',
				'}',
				'',
			].join('\n'),
			'plugins/giver.ts': 'keeper.keep(() => 7);\n',
			'plugins/asker.ts': [
				'export function test_ask() {',
				'\treturn keeper.ask();',
				'}',
				'',
				'export function test_giver() {',
				'\treturn keeper.giver();',
				'}',
				'',
				'export function test_stopped() {',
				'\treturn keeper.stopped();',
				'}',
				'',
			].join('\n'),
		};
		for (const [path, text] of Object.entries(files)) {
			mkdirSync(join(root, path, '..'), { recursive: true });
			writeFileSync(join(root, path), text);
		}

		try {
			const server = await setup({ rootDir: root });
			expect(server.native('test_ask')).toBe(7);
			const giver = server.plugins.find(plugin => plugin.source.endsWith('giver.ts'))!;
			expect(server.native('test_giver')).toBe(giver.run);

			server.unload(giver);
			expect(server.native('test_stopped')).toBe(`${giver.run}`);
			expect(server.native('test_ask')).toBe(0);
			expect(server.native('test_ask')).toBe(0);
			expect(server.log.split('\n').filter(line => line.includes('called back a function of a plugin that was unloaded or reloaded since'))).toHaveLength(1);
		} finally {
			setProjectDir(process.cwd());
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('what cannot cross', () => {
	/** A plugins folder with one module and the plugin that owns it. */
	function folder(module: string) {
		const root = mkdtempSync(join(tmpdir(), 'amxts-shared-'));
		mkdirSync(join(root, 'modules'));
		writeFileSync(join(root, 'modules', 'bad.ts'), module);
		writeFileSync(join(root, 'bad.ts'), 'import * as bad from "~/modules/bad";\n');
		return root;
	}

	test('a parameter of a type that cannot cross stops the build, naming the function and the parameter', async () => {
		const root = folder('export function remember(counts: Map<string, number>) {\n\treturn counts.size;\n}\n');
		try {
			await expect(analyzeModule(root, 'bad')).rejects.toThrow('~/modules/bad: export function remember - parameter "counts": Map from the standard library cannot cross');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a default the other plugin cannot evaluate, and a variable, are refused', async () => {
		const root = folder('let base = 5;\nexport let count = 0;\nexport function add(value: number = base) {\n\treturn value;\n}\n');
		try {
			const refused = analyzeModule(root, 'bad');
			await expect(refused).rejects.toThrow('export function add - parameter "value": its default is computed');
			await expect(refused).rejects.toThrow('export count: a variable is not shared');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('an object the module exports', () => {
	test('is a handle numbered when the owner starts; its accessors are read and written there, its setter run there', async () => {
		const root = mkdtempSync(join(tmpdir(), 'amxts-shared-'));
		mkdirSync(join(root, 'modules'));
		writeFileSync(join(root, 'modules', 'tally.ts'), [
			'let total = 0;',
			'export class Tally {',
			'\tget total() {',
			'\t\treturn total;',
			'\t}',
			'\tset total(value: number) {',
			'\t\ttotal = value;',
			'\t}',
			'\tget twice() {',
			'\t\treturn total * 2;',
			'\t}',
			'\tadd(value: number) {',
			'\t\ttotal += value;',
			'\t}',
			'}',
			'export const tally = new Tally();',
			'',
		].join('\n'));
		writeFileSync(join(root, 'tally.ts'), 'import { tally } from "~/modules/tally";\n');
		try {
			const analysis = await analyzeModule(root, 'tally');
			expect(analysis.objects.map(object => `${object.name}: ${object.cls.name}`)).toEqual(['tally: Tally']);
			const handle = analysis.handles.find(one => one.name === 'Tally')!;
			expect(handle.fields.map(field => `${field.name}${field.readonly ? ' (readonly)' : ''}`)).toEqual(['total', 'twice (readonly)']);
			expect(handle.calls.map(call => call.name)).toEqual(['add']);

			expect(proxySource(analysis)).toContain('export const tally = new Tally(1);');
			expect(proxySource(analysis)).toContain('set total(value: f64) {');
			expect(proxySource(analysis)).not.toContain('set twice(');
			expect(serveSource(analysis)).toContain('__handles.id(changetype<usize>(__m.tally));');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('a module\'s surface', () => {
	test('is kept on disk in the project: another process takes it from there while the module is the same', () => {
		const project = mkdtempSync(join(tmpdir(), 'amxts-surface-'));
		const root = join(project, 'plugins');
		mkdirSync(join(project, 'node_modules'));
		mkdirSync(join(root, 'modules'), { recursive: true });
		const module = (text: string) => writeFileSync(join(root, 'modules', 'tally.ts'), `export function add(value: number) {\n\treturn value + ${text};\n}\n`);
		module('1');
		writeFileSync(join(root, 'tally.ts'), 'import * as tally from "~/modules/tally";\n');
		// A process of its own each time: what it took from the disk, and what it made.
		const script = [
			`import { keptSurfaces, moduleSurface } from ${JSON.stringify(join(process.cwd(), 'scripts/shared-modules.ts'))};`,
			`const surface = await moduleSurface(${JSON.stringify(root)}, 'tally');`,
			'console.log(JSON.stringify({ counts: keptSurfaces().counts, proxy: surface.proxy.includes("export function add(value: number): f64") }));',
		].join('\n');
		const run = () => JSON.parse(spawnSync(process.execPath, ['-e', script], { cwd: project, encoding: 'utf8' }).stdout);
		try {
			expect(run()).toEqual({ counts: { hits: 0, misses: 1 }, proxy: true });
			expect(run()).toEqual({ counts: { hits: 1, misses: 0 }, proxy: true });
			module('2');
			expect(run()).toEqual({ counts: { hits: 0, misses: 1 }, proxy: true });
		} finally {
			rmSync(project, { recursive: true, force: true });
		}
	});
});
