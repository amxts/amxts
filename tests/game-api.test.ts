import { loadPlugin } from '@amxts/core/test-utils';
// The game on the fake server: tests/as/game-api.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { constant } from '../src/testing/tables';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/game-api.ts';

test('the game rules are fields of game, each written as what it holds', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	server.rules.set(constant('m_bFreezePeriod'), 1);

	alice.command('game_rules');

	expect(alice.console).toBe('true 0 none -> false 3 2 TERRORIST 12.5');
	// WINSTATUS_TERRORISTS is 2.
	expect(server.rules.get(constant('m_iRoundWinStatus'))).toBe(2);
	expect(server.rules.get(constant('m_iNumCTWins'))).toBe(3);
});

test('a team score written is on the scoreboard at once, the other side kept', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	server.rules.set(constant('m_iNumTerroristWins'), 4);

	alice.command('game_rules');

	const scores = server.userMessages.filter(m => m.name === 'TeamScore').map(m => m.args.join(' '));
	// ctWins = 3, then terroristWins = 2: each sends both sides.
	expect(scores).toEqual(['CT 3', 'TERRORIST 4', 'CT 3', 'TERRORIST 2']);
});

test('restartRound and checkWinConditions run the game rules\' own functions, at once', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('game_restart');

	expect(server.rulesRuns).toEqual(['restartRound', 'checkWinConditions']);
});

test('touch: only the classes a listener asked for reach it, toucher and touched in their places', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	const box = server.createEntity('myplugin_box');
	const door = server.createEntity('func_door');

	const answers = [server.touch(alice, bob), server.touch(bob, box), server.touch(alice, door)];

	expect(server.log).toContain(`players ${alice.id} -> ${bob.id}`);
	expect(server.log).toContain('box touched by a player');
	expect(server.log).not.toContain('door');
	// preventDefault blocks the touch: PLUGIN_HANDLED.
	expect(answers).toEqual([0, 1, 0]);
	// One register_touch per pair of classes, in register_touch's order.
	expect(server.touches.map(t => `${t.touched}<-${t.toucher}`)).toEqual(['player<-player', 'myplugin_box<-*']);
});

test('a post listener is still added with true', async () => {
	const server = await loadPlugin(PLUGIN);

	expect(server.hookchains.get('take_damage')?.post.length).toBe(1);
	expect(server.hookchains.get('take_damage')?.pre.length ?? 0).toBe(0);
});
