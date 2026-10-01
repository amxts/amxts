import { FakeServer } from '@amxts/core/test-utils';
import { installMenus } from '@amxts/menu-core/testing';
// Menu Core as the core builds and runs it, on the fake server: its owner
// plugin, its natives called the way a Pawn plugin calls them, and
// TypeScript plugins that use it - through the module's API, which runs in
// the owner, and through the mc_* natives. What Menu Core itself does with a
// menu file is tested in its own repository.
//
// The Pawn plugins here are fake ones (Menu Core's test kit,
// @amxts/menu-core/testing): their publics are JavaScript, called through
// callfunc the way AMX Mod X calls them.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = '@amxts/menu-core';
/** menu-core reads menu.ini through @amxts/config-core, which the config-core plugin runs. */
const CONFIG_PLUGIN = '@amxts/config-core';
const CONFIGS = 'addons/amxmodx/configs';

/** A server with config-core, menu-core (and `plugins` after them), and these files in configs/. */
async function boot(files: Record<string, string> = {}, plugins: string[] = []) {
	const inConfigs = Object.fromEntries(Object.entries(files).map(([path, text]) => [`${CONFIGS}/${path}`, text]));
	const server = new FakeServer({ files: inConfigs });
	const menus = installMenus(server);
	for (const plugin of [CONFIG_PLUGIN, PLUGIN, ...plugins]) await server.load(plugin);
	server.start();
	return { server, menus };
}

describe('the config', () => {
	test('a section without TITLE or without items is not a menu', async () => {
		const { menus } = await boot({ 'menu.ini': '[NO_TITLE]\nITEMS = {\n\t"A"\n}\n[EMPTY]\nTITLE = T\n' });
		const plugin = menus.pawnPlugin('a.amxx', {});
		expect(plugin.native('mc_register_menu', 'NO_TITLE')).toBe(-1);
		expect(plugin.native('mc_register_menu', 'EMPTY')).toBe(-1);
	});
});

describe('text', () => {
	test('a menu over 500 bytes reaches the player whole', async () => {
		const { server, menus } = await boot();
		const plugin = menus.pawnPlugin('a.amxx', {});
		const title = 'Очень длинное меню для проверки';
		plugin.native('mc_create_menu', 'LONG', title);
		for (let i = 1; i <= 7; i++) plugin.native('mc_add_menu_item', 'LONG', `Пункт номер ${i} - довольно длинное название`);
		const alice = server.join('Alice');
		plugin.native('mc_show_menu', alice.id, 'LONG');

		const text = menus.screen(alice)!.text;
		expect(new TextEncoder().encode(text).length).toBeGreaterThan(500);
		expect(text.startsWith(`${title}\n\n\\y[1]\\w Пункт номер 1`)).toBe(true);
		expect(text).toContain('\\y[7]\\w Пункт номер 7 - довольно длинное название\n');
		expect(text.endsWith('\\y[0]\\w Exit')).toBe(true);
		expect(menus.screen(alice)!.title).toBe('LONG');
	});

	test('%name%, %target% and %time%', async () => {
		const { server, menus } = await boot();
		const plugin = menus.pawnPlugin('a.amxx', {});
		plugin.native('mc_create_menu', 'TARGET', 'About %target%, %time% s');
		plugin.native('mc_add_menu_item', 'TARGET', 'Kick %s');
		const alice = server.join('Alice');
		const bob = server.join('Bob');
		plugin.native('mc_show_menu', alice.id, 'TARGET', 10, bob.id);
		const text = menus.screen(alice)!.text;
		expect(text.startsWith('About Bob, 10 s\n\n')).toBe(true);
		expect(text).toContain('\\y[1]\\w Kick %s'); // an items menu fills its items for no target
	});
});

describe('TypeScript plugins', () => {
	test('a menu object: a title, items and a message that are functions of the player; items shown, greyed out and chosen by functions', async () => {
		const { server, menus } = await boot({}, ['tests/as/menu-api.ts']);
		const alice = server.join('Alice', { health: 40 });
		expect(server.native('menu_api_open', alice.id)).toBe(true);
		expect(menus.screen(alice)!.text).toBe('Магазин для Alice\n\n\\y[1]\\w Лечение (40 HP)\n\\y[2]\\w Только раненым\n\\y[3]\\w Выбор\n\n\\y[4]\\w Выход\n\n\n\n\n\\y[0]\\w Exit');

		menus.press(alice, 1);
		expect(alice.health).toBe(100);
		expect(server.native('menu_api_healed')).toBe(1);
		// enabled says no: greyed out, with its message; visible says no: gone, and the rest move up.
		expect(menus.screen(alice)!.text).toBe('Магазин для Alice\n\n\\d[1] Лечение (100 HP)\\y здоров: 100\n\\y[2]\\w Выбор\n\n\\y[3]\\w Выход\n\n\n\n\n\n\\y[0]\\w Exit');

		menus.press(alice, 2);
		expect(server.native('menu_api_choice')).toBe('Alice:PICK');
		menus.press(alice, 3);
		expect(menus.screen(alice)).toBe(null);
	});

	test('a menu from a dictionary keeps its colours, in the reader\'s language', async () => {
		const dictionary = String.raw`[en]
MYPLUGIN_TITLE = \yModes
MYPLUGIN_ON = \d[\yOn\d]
MYPLUGIN_SCORED = ^4%s^1 scored ^3%d
[ru]
MYPLUGIN_ON = \d[\yВкл\d]
`;
		const server = new FakeServer({ files: { 'addons/amxmodx/data/lang/myplugin.txt': dictionary } });
		const menus = installMenus(server);
		for (const plugin of [CONFIG_PLUGIN, PLUGIN, 'tests/as/menu-lang.ts']) await server.load(plugin);
		server.start();
		const alice = server.join('Alice');
		const boris = server.join('Boris');
		boris.info.set('lang', 'ru');

		server.native('menu_lang_open', alice.id);
		expect(menus.screen(alice)!.text.startsWith(`${String.raw`\yModes`}\n\n${String.raw`\y[1]\w DM \d[\yOn\d]`}\n`)).toBe(true);
		// Boris reads Russian; the title only English has comes in English.
		server.native('menu_lang_open', boris.id);
		expect(menus.screen(boris)!.text.startsWith(`${String.raw`\yModes`}\n\n${String.raw`\y[1]\w DM \d[\yВкл\d]`}\n`)).toBe(true);

		server.native('menu_lang_tell', alice.id);
		expect(alice.chat).toBe('Alice scored 3');
	});

	test('through the mc_* natives: publicFor answers, setArgText fills a placeholder', async () => {
		const { server, menus } = await boot({}, ['tests/as/menu-consumer.ts']);
		const alice = server.join('Alice');
		expect(menus.pawnPlugin('a.amxx', {}).native('mc_show_menu', alice.id, 'TS_MENU')).toBe(1);
		expect(menus.screen(alice)!.text).toContain('\\y[1]\\w Значение: сорок два');
		menus.press(alice, 1);
		expect(server.native('ts_chosen')).toBe('TS_ACTION');
	});
});
