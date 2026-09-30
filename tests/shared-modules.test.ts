import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeServer } from '@amxts/core/test-utils';
import { installMenus } from '@amxts/menu-core/testing';
// Modules with one instance on the server (scripts/shared-modules.ts): two
// plugins write the plain import, and what one of them sets up in
// ~/modules/menu-core or ~/modules/config-core the other sees - because
// both call the instance the owner plugin runs.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { analyzeModule, proxySource, serveSource } from '../scripts/shared-modules';

setDefaultTimeout(240_000);

const CONFIGS = 'addons/amxmodx/configs';

async function boot(plugins: string[]) {
	const server = new FakeServer({ files: { [`${CONFIGS}/shared/on-disk.ini`]: '[DISK]\nNAME = диск\n' } });
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
		expect(menus.screen(alice)!.text).toContain('Лавка');
		expect(menus.screen(alice)!.text).toContain('\\y[1]\\w Привет (40)');
		menus.press(alice, 1);
		expect(server.native('shared_chosen')).toBe('GREET Alice');

		expect(server.native('shared_show', bob.id)).toBe(true);
		expect(menus.screen(bob)!.text).toContain('\\d[1] Привет (100)');
		menus.press(bob, 2);
		expect(server.native('shared_chosen')).toBe('нож Bob');
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
		server.native('shared_retitle', 'Базар');
		const alice = server.join('Alice');
		server.native('shared_show', alice.id);
		expect(menus.screen(alice)!.text).toStartWith('Базар');
	});

	test('its methods run there too: an item from the other plugin, whose functions are called back', async () => {
		const { server, menus } = await boot(BOTH);
		expect(server.native('shared_add', 'Щит')).toBe(true);
		const alice = server.join('Alice');
		const bob = server.join('Bob');

		expect(server.native('shared_open', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toContain('\\y[3]\\w Щит для Alice');
		menus.press(alice, 3);
		expect(server.native('shared_picked')).toBe('Щит Alice');

		server.native('shared_open', bob.id);
		expect(menus.screen(bob)!.text).not.toContain('Щит'); // visible says no to Bob
	});

	test('a config one plugin writes, the other reads; the base folder is one for both', async () => {
		const { server } = await boot(BOTH);
		expect(server.native('shared_config')).toBe('значение|диск');
	});

	test('without the owner running, a call fails in the log and answers nothing', async () => {
		const { server } = await boot(['tests/as/shared-viewer.ts']);
		const alice = server.join('Alice');
		expect(server.native('shared_show', alice.id)).toBe(false);
		expect(server.native('shared_menu')).toBe('нет меню');
		expect(server.log).toContain('~/modules/menu-core: no plugin runs it - is menu-core.aot in plugins.ini?');
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
