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

test('the log event hears every line, whole and in its parts', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	server.gameLog('World triggered "Round_Draw" (CT "3")');
	alice.command('game_logged');

	expect(alice.console).toBe('World triggered "Round_Draw" (CT "3") | World triggered,Round_Draw,CT "3"');
});

test('swapTeams swaps the sides and their scores; balanceTeams moves the last to come from the bigger side', async () => {
	const server = await loadPlugin(PLUGIN);
	const players = ['A', 'B', 'C', 'D'].map(name => server.join(name));
	players[0].team = 'TERRORIST';
	for (const each of players.slice(1)) each.team = 'CT';

	players[0].command('game_sides');

	expect(players[0].console).toBe('1 3 Infinity');
	// After the swap: A a counter-terrorist, B, C and D terrorists; one of them, the last to come, back.
	expect(players.map(each => each.team)).toEqual(['CT', 'TERRORIST', 'TERRORIST', 'CT']);
});

test('server.plugins lists this plugin, running; stop, reload and loadPlugin are asked for the next frame', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('game_plugins');

	expect(alice.console).toBe('typescript true');
	expect(server.pluginActions).toEqual(['reload game-api.ts', 'stop game-api.ts', 'start other.aot']);
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

test('the server tells its game and versions, goes to a map it has, sets the light and prints to everyone', async () => {
	const server = await loadPlugin(PLUGIN);
	server.createCvar('amxmodx_version', '1.10.0.5467');
	const alice = server.join('Alice');
	const bob = server.join('Bob');

	alice.command('game_server');

	expect(alice.console).toBe('cstrike 0.3.0 1.10.0.5467 3.14 5.28 true false false true m b');
	expect(server.engineCalls).toContain('ChangeLevel cs_office');
	expect(server.engineCalls).toContain('LightStyle 0 b');
	expect(bob.chat).toContain('Round 3');
	expect(bob.center).toContain('Go!');
});

test('lang.languages lists the languages of the plugin\'s dictionaries, or of one, not every one AMX Mod X knows', async () => {
	const server = await loadPlugin(PLUGIN, { files: {
		'addons/amxmodx/data/lang/myplugin.txt': '[en]\nHELLO = Hello\n\n[RU]\nHELLO = Привет\n',
		'addons/amxmodx/data/lang/other.txt': '[de]\nHELLO = Hallo\n',
	} });
	const alice = server.join('Alice');

	alice.command('game_languages');

	expect(alice.console).toBe('en,ru de 0');
});
