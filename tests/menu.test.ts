import { loadPlugin } from '@amxts/core/test-utils';
// `Menu` (as/facade.ts) over AMX Mod X's menus, on the fake server's
// menu_create, menu_display and menuselect: tests/as/quick-menu.ts.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/quick-menu.ts';

describe('a Menu', () => {
	test('an item runs its function with the player, the menu and the data; the menu closes and is destroyed', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_shop', alice.id, 'armor');

		// The title from the data; tags made the game's codes, the numbers in the colour the options gave.
		expect(alice.menu?.text).toBe('\\yShop: armor\n\n\\y1.\\w Armor\n\\d2. Heal \\d(100 HP)\n\\d3. Closed\n\n\\y0.\\w Exit');
		expect(server.menus.size).toBe(1);

		expect(alice.command('menuselect 1')).toBe(true);
		expect(server.native('quick_chosen')).toBe('Alice: armor from armor');
		expect(alice.menu).toBeNull();
		expect(server.menus.size).toBe(0);
	});

	test('title, visible and enabled are asked at every show, for that player', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice', { health: 40 });
		const admin = server.join('Admin');

		server.native('quick_shop', admin.id, 'all');
		expect(admin.menu?.text).toContain('\\y3.\\w Admin item');
		// A grey item does nothing, and the menu stays.
		admin.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('');
		expect(admin.menu?.text).toContain('\\d2. Heal \\d(100 HP)');
		admin.command('menuselect 4');
		expect(server.native('quick_chosen')).toBe('');

		server.native('quick_shop', alice.id, 'all');
		expect(alice.menu?.text).not.toContain('Admin item');
		expect(alice.menu?.text).toContain('\\y2.\\w Heal \\d(40 HP)');
		// The item shows the menu again, from its context: now healed.
		alice.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('Alice: healed');
		expect(alice.health).toBe(100);
		expect(alice.menu?.text).toContain('\\d2. Heal \\d(100 HP)');
		expect(server.menus.size).toBe(2);
	});

	test('pages, Back, More and Exit are AMX Mod X\'s, their texts the options\'', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');

		server.native('quick_show', alice.id, 'maps');
		expect(alice.menu?.text).toBe(['Maps 1/2', '', ...[1, 2, 3, 4, 5, 6, 7].map(n => `\\r${n}.\\w map ${n}`), '', '\\r9.\\w Next', '\\r0.\\w Close'].join('\n'));
		alice.command('menuselect 9');
		expect(alice.menu?.text).toBe(['Maps 2/2', '', '\\r1.\\w map 8', '\\r2.\\w map 9', '', '\\r8.\\w Back', '\\r0.\\w Close'].join('\n'));
		alice.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('Alice: map 9');

		// Exit closes it, chooses nothing and destroys it.
		server.native('quick_show', alice.id, 'maps');
		alice.command('menuselect 0');
		expect(alice.menu).toBeNull();
		expect(server.native('quick_chosen')).toBe('Alice: map 9');
		expect(server.menus.size).toBe(0);
	});

	test('one page without Back, More and Exit', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'vote');

		expect(alice.menu?.text).toBe('Vote\n\n\\r1.\\w yes\n\\r2.\\w no');
		expect(alice.menu?.keys).toEqual([1, 2]);
		expect(alice.command('menuselect 0')).toBe(false);
		alice.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('Alice: no');
	});

	test('a menu shown over another closes it, and its AMX Mod X menu goes', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'maps');
		server.native('quick_show', alice.id, 'vote');

		expect(alice.menu?.text).toStartWith('Vote');
		expect(server.menus.size).toBe(1);
	});

	test('a menu a reload left open is destroyed when it answers', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'maps');

		server.unload(server.plugins[0]);
		await server.load(PLUGIN);
		alice.command('menuselect 1');
		expect(server.native('quick_chosen')).toBe('');
		expect(server.menus.size).toBe(0);
	});
});
