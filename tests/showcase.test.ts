import { loadPlugin } from '@amxts/core/test-utils';
/**
 * tests/as/showcase.ts on the fake server: the plugin as it is written, its events and
 * its /tour command. See docs/en/7.testing/01.index.md.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';

// The first test compiles the plugin, which takes a few seconds.
setDefaultTimeout(60_000);

describe('the showcase greets', () => {
	test('a player who joins, and tells the other plugins through its forward', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const alice = server.join('Alice', { team: 'CT' });

		expect(alice.chat).toBe('Welcome to de_dust2, Alice! Visit #1.');
		expect(server.forwards).toEqual([{ name: 'showcase_on_greeted', args: ['Alice', 1] }]);
		// Its own subscriber heard it too.
		expect(server.log).toContain('Alice came back for visit 1');
	});

	test('a player who comes back by the count it kept', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		server.storage('showcase_visits').set('STEAM_0:0:42', '6');

		const alice = server.join('Alice', { steamId: 'STEAM_0:0:42' });

		expect(alice.chat).toContain('Visit #7.');
		expect(server.storage('showcase_visits').get('STEAM_0:0:42')).toBe('7');
	});

	test('a player whose key is not ASCII by the count kept under it', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		// Cyrillic on purpose: a vault key beyond ASCII.
		server.storage('showcase_visits').set('ключ', '6');

		// Cyrillic on purpose: a vault key beyond ASCII.
		const alice = server.join('Alice', { steamId: 'ключ' });

		expect(alice.chat).toContain('Visit #7.');
	});

	test('nobody who is a bot', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const bot = server.join('Bot', { bot: true });

		expect(bot.chat).toBe('');
		expect(server.forwards).toEqual([]);
	});

	test('and logs who left, and why', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		server.join('Alice').disconnect({ dropped: true, reason: 'Kicked' });

		expect(server.log).toContain('Alice left (Kicked)');
	});
});

describe('/tour', () => {
	test('walks a living player through the API', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const alice = server.join('Alice', { team: 'CT', health: 100 });
		server.join('Bot', { bot: true, team: 'TERRORIST' });
		alice.clearMessages();

		expect(alice.say('/tour')).toBe(true);

		expect(alice.chat).toContain('Alice: 100 HP, 0 armor, team CT');
		expect(alice.chat).toContain('1 living people, 1 counter-terrorists');
		expect(alice.chat).toContain('In hand: knife, carrying 2 items');
		expect(alice.chat).toContain('de_dust2, 32 slots, reapi loaded');
		expect(alice.center).toBe('Tour complete!');

		// What it did to him.
		expect(alice.items.map(weapon => weapon.kind)).toEqual(['weapon_knife', 'weapon_flashbang']);
		expect(alice.ammo.get('weapon_flashbang')).toBe(2);
		expect(alice.get('gravity')).toBe(0.5);
		expect(alice.get('renderfx')).toBe(19); // kRenderFxGlowShell
		expect(alice.get('rendercolor')).toEqual([0, 160, 255]);
	});

	test('is not repeated in chat', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const alice = server.join('Alice');
		const bob = server.join('Bob');

		alice.say('/tour');
		bob.say('hello');

		expect(bob.chat).not.toContain('Alice: /tour');
		expect(alice.chat).toContain('Bob: hello');
	});

	test('asks a dead player to come back alive', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const alice = server.join('Alice', { alive: false });
		alice.clearMessages();

		alice.say('/tour');

		expect(alice.chat).toBe('Come back alive - the tour happens to you.');
	});
});
