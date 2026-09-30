import { loadPlugin } from '@amxts/core/test-utils';
// Messages to clients as events, on the fake server: tests/as/messages.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/messages.ts';

test('a message is registered once per name, when the server is up, and only its name reaches the plugin', async () => {
	const server = await loadPlugin(PLUGIN);
	const ids = ['TextMsg', 'RoundTime', 'HideWeapon', 'TeamScore', 'ItemPickup'].map(name => server.messageIds.get(name));

	expect([...server.messageHooks.keys()].sort()).toEqual(ids.map(Number).sort());
	expect(server.sendMessage('Money', [800, 1]).prevented).toBe(false);
});

test('TextMsg: the destination is a name, the receiver a player, preventDefault stops it', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	const draw = server.sendMessage('TextMsg', [4, '#Round_Draw'], { player: alice });
	const other = server.sendMessage('TextMsg', [3, '#Game_Commencing']);

	expect(server.log).toContain('text center #Round_Draw to Alice');
	expect(server.log).toContain('text chat #Game_Commencing to everyone');
	expect(draw.prevented).toBe(true);
	expect(other.prevented).toBe(false);
});

test('writing a field writes the argument: a number, flags', async () => {
	const server = await loadPlugin(PLUGIN);

	expect(server.sendMessage('RoundTime', [120], { types: [3] }).args).toEqual([90]);
	// Timer (16) stays, Money (32) is added.
	expect(server.sendMessage('HideWeapon', [16]).args).toEqual([48]);
	expect(server.sendMessage('ItemPickup', ['weapon_knife']).prevented).toBe(true);
	expect(server.sendMessage('ItemPickup', ['item_kevlar']).prevented).toBe(false);
});

test('a message with no fields is read by its arguments', async () => {
	const server = await loadPlugin(PLUGIN);

	server.sendMessage('TeamScore', ['CT', 5], { types: [7, 3] });

	expect(server.log).toContain('score TeamScore CT 5 2 true');
});
