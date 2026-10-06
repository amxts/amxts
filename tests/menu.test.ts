import { loadPlugin } from '@amxts/core/test-utils';
// `Menu` (as/facade.ts) on the fake server: the page drawn as AMX Mod X draws
// its own, sent with show_menu, and its keys taken as the module takes them
// (menu_open, menuselect): tests/as/quick-menu.ts.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/quick-menu.ts';

/** A page as AMX Mod X draws it: the title, the lines, the blank lines that pad it, then its own items. */
const page = (title: string, lines: string[]) => `\\y${title}\n\\w\n${lines.join('')}`;

describe('a Menu', () => {
	test('an item runs its function with the player, the menu and the data; the menu closes', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_shop', alice.id, 'armor');

		// The title from the data; tags made the game's codes, the numbers in the colour the options gave.
		expect(alice.menu?.text).toBe(page('\\yShop: armor', [
			'\\y1.\\w Armor\n',
			'\\d2. Heal \\d(100 HP)\n\\w',
			'\\d3. Closed\n\\w',
			'\n\n\n\n',
			'\n',
			'\\y0. \\wExit\n',
		]));
		expect(alice.menu?.keys).toEqual([1, 0]);

		expect(alice.command('menuselect 1')).toBe(true);
		expect(server.native('quick_chosen')).toBe('Alice: armor from armor');
		expect(alice.menu).toBeNull();
		expect(server.shownMenus.size).toBe(0);
	});

	test('title, visible and enabled are asked at every show, for that player', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice', { health: 40 });
		const admin = server.join('Admin');

		server.native('quick_shop', admin.id, 'all');
		expect(admin.menu?.text).toContain('\\y3.\\w Admin item');
		// A grey item is not a key of the menu: it does nothing, and the menu stays.
		expect(admin.command('menuselect 2')).toBe(false);
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
		expect(server.shownMenus.size).toBe(2);
	});

	test('pages, Back, More and Exit as AMX Mod X draws them, their texts the options\'', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');

		server.native('quick_show', alice.id, 'maps');
		expect(alice.menu?.text).toBe(page('Maps 1/2', [
			...[1, 2, 3, 4, 5, 6, 7].map(n => `\\r${n}.\\w map ${n}\n`),
			'\n',
			'\\d8. Back\n\\w',
			'\\r9. \\wNext\n',
			'\\r0. \\wClose\n',
		]));
		expect(alice.menu?.keys).toEqual([1, 2, 3, 4, 5, 6, 7, 9, 0]);
		alice.command('menuselect 9');
		expect(alice.menu?.text).toBe(page('Maps 2/2', [
			'\\r1.\\w map 8\n',
			'\\r2.\\w map 9\n',
			'\n\n\n\n\n',
			'\n',
			'\\r8. \\wBack\n',
			'\\d9. Next\n\\w',
			'\\r0. \\wClose\n',
		]));
		alice.command('menuselect 8');
		expect(alice.menu?.text).toStartWith('\\yMaps 1/2');
		alice.command('menuselect 9');
		alice.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('Alice: map 9');

		// Exit closes it and chooses nothing; the client sends the tenth key as 10.
		server.native('quick_show', alice.id, 'maps');
		expect(alice.command('menuselect 10')).toBe(true);
		expect(alice.menu).toBeNull();
		expect(server.native('quick_chosen')).toBe('Alice: map 9');
		expect(server.shownMenus.size).toBe(0);
	});

	test('one page without Back, More and Exit', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'vote');

		expect(alice.menu?.text).toBe(page('Vote', ['\\r1.\\w yes\n', '\\r2.\\w no\n']));
		expect(alice.menu?.keys).toEqual([1, 2]);
		expect(alice.command('menuselect 0')).toBe(false);
		alice.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('Alice: no');
	});

	test('a menu without data takes a function for its title, with no type argument', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'greet');

		expect(alice.menu?.text).toStartWith('\\yHello, Alice\n\\w\n\\r1.\\w Wave');
		alice.command('menuselect 1');
		expect(server.native('quick_chosen')).toBe('Alice: wave');
	});

	test('a menu shown over another takes its keys', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'maps');
		server.native('quick_show', alice.id, 'vote');

		expect(alice.menu?.text).toStartWith('\\yVote');
		alice.command('menuselect 1');
		expect(server.native('quick_chosen')).toBe('Alice: yes');
	});

	test('a Menu over a menu of AMX Mod X\'s own closes it: its handler hears MENU_EXIT', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_raw', alice.id);
		expect(alice.menu?.text).toStartWith('Raw');

		server.native('quick_show', alice.id, 'vote');
		expect(server.native('quick_chosen')).toBe('Alice: raw -3');
		alice.command('menuselect 2');
		expect(server.native('quick_chosen')).toBe('Alice: no');
	});

	test('a menu a reload left open answers nothing', async () => {
		const server = await loadPlugin(PLUGIN);
		const alice = server.join('Alice');
		server.native('quick_show', alice.id, 'maps');

		server.unload(server.plugins[0]);
		await server.load(PLUGIN);
		expect(alice.command('menuselect 1')).toBe(false);
		expect(server.native('quick_chosen')).toBe('');
	});
});
