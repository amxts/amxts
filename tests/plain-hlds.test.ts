import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { constant, loadPlugin, setup } from '@amxts/core/test-utils';
// A server without reapi - plain HLDS: the hood picks the backend once, and a
// plugin reads the same. A player's game events go through Ham Sandwich, a
// weapon's with no class through every weapon's; an event of ReGameDLL's own
// through the stock hook that hears it (scripts/hlds-events.ts), with what
// it cannot give said once, or, where nothing hears it, one line in the
// console and no listener; fields are read in memory; a team's score and a
// round's end are done as the game does them. A project for plain HLDS does
// not build a listener for an event nothing there hears. tests/as/plain-hlds.ts.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { FIELDS_NOT_HEARD, HEARD, HEARD_FIELDS, NOT_HEARD } from '../scripts/hlds-events';
import { setProjectDir } from '../scripts/project';
import { reapiEvents, unheardEvents } from '../scripts/reapi-events';

setDefaultTimeout(240_000);

const PLUGIN = 'tests/as/plain-hlds.ts';
const PLAIN = { modules: ['cstrike', 'fun', 'hamsandwich', 'engine', 'fakemeta', 'nvault'] };

test('without reapi a player\'s event is Ham Sandwich\'s on "player", a weapon\'s every weapon\'s', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const hooked = [...server.hams.keys()];

	expect(hooked).toContain(`${constant('Ham_TakeDamage')}:player:pre`);
	expect(hooked).toContain(`${constant('Ham_Player_Jump')}:player:pre`);
	expect(hooked.filter(key => key.startsWith(`${constant('Ham_Item_CanDeploy')}:weapon_`))).toHaveLength(29);
	expect(server.hookchains.size).toBe(0);

	const alice = server.join('Alice');
	server.fireHam('takeDamage', alice, [0, 0, 30.0, 2]);
	server.fireHam('jump', alice);
	expect(server.log).toContain(`hurt ${alice.id} 30`);
	expect(server.log).toContain(`jump ${alice.id}`);
});

test('an event nothing on plain HLDS hears says so once, and is not listened for', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const said = server.logLines.filter(line => line.includes('needs ReAPI'));
	expect(said).toEqual(['warning: flPlayerFallDamage needs ReAPI, which this server does not have: its listeners are never called']);
});

test('without reapi a player spawns through Ham Sandwich\'s Spawn, after the game: preventDefault() is said once', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const alice = server.join('Alice');
	server.fireHam('spawn', alice);
	server.fireHam('spawn', alice);
	expect(server.logLines.filter(line => line === `spawned ${alice.id}`)).toHaveLength(2);
	const said = server.logLines.filter(line => line.includes('playerSpawn is heard'));
	expect(said).toEqual(['warning: playerSpawn is heard on this server without ReAPI, where the game does not take a listener\'s preventDefault(), answer or change of a field']);

	// One who only joined spawns dead: no round's spawn.
	alice.alive = false;
	server.fireHam('spawn', alice);
	expect(server.logLines.filter(line => line === `spawned ${alice.id}`)).toHaveLength(2);
});

test('without reapi a new round is the HLTV message before the respawn, and the decals\' reset at its time after', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const decals = server.precached.indexOf('events/decal_reset.sc') + 1;
	expect(decals).toBeGreaterThan(0);
	const playback = (id: number) => server.fire('pfn_playbackevent', 0, 0, id, 0, [0, 0, 0], [0, 0, 0], 0, 0, 0, 0, 0, 0);

	server.sendMessage('HLTV', [0, 0]);
	playback(decals + 1);
	expect(server.logLines.filter(line => line.startsWith('new round'))).toEqual(['new round']);
	playback(decals);
	expect(server.logLines.filter(line => line.startsWith('new round'))).toEqual(['new round', 'new round, respawned']);
	expect(server.logLines.filter(line => line === 'map cleaned up')).toHaveLength(1);

	// HLTV of another kind is no new round.
	server.sendMessage('HLTV', [1, 0]);
	expect(server.logLines.filter(line => line === 'new round')).toHaveLength(1);
});

test('without reapi the map\'s first round is the game\'s restart, not the plugins\' start', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	server.rules.set(constant('m_bFreezePeriod'), 1);
	server.fire('plugin_cfg');
	expect(server.logLines.filter(line => line === 'new round')).toEqual([]);
	server.sendMessage('HLTV', [0, 0]);
	expect(server.logLines.filter(line => line === 'new round')).toEqual(['new round']);
});

test('without reapi a round ended as the freeze time ends is heard once', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	server.serverCommand('end_at_start');
	server.gameLog('World triggered "Round_Start"');
	expect(server.logLines.filter(line => line.startsWith('round'))).toEqual(['round start', 'round CT ctsWin 4', 'round CT ctsWin 4']);
});

test('without reapi a round\'s end is its log line, with the winner and the reason from the message before it', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	server.gameLog('World triggered "Round_Start"');
	server.sendMessage('TextMsg', [4, '#Target_Bombed']);
	server.sendMessage('SendAudio', [0, '%!MRAD_terwin', 100]);
	server.gameLog('Team "TERRORIST" triggered "Target_Bombed" (CT "0") (T "1")');
	server.gameLog('World triggered "Round_End"');
	expect(server.logLines.filter(line => line.startsWith('round'))).toEqual(['round start', 'round TERRORIST targetBomb 5', 'round TERRORIST targetBomb 5']);
});

test('without reapi game.endRound with dispatch tells the roundEnd listeners, as the game tells its own', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	server.serverCommand('end_told');
	expect(server.logLines.filter(line => line.startsWith('round '))).toEqual(['round CT ctsWin 4', 'round CT ctsWin 4']);
});

test('without reapi money is the Money message, by how much it moved', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	// He comes with none, and the game gives him the starting money.
	const alice = server.join('Alice');
	server.sendMessage('Money', [800, 1], { player: alice });
	server.sendMessage('Money', [800, 1], { player: alice });
	server.sendMessage('Money', [500, 1], { player: alice });
	expect(server.logLines.filter(line => line.startsWith('money'))).toEqual([`money ${alice.id} 800`, `money ${alice.id} -300`]);
});

test('without reapi a team\'s pick is the player\'s command, which preventDefault() stops', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const alice = server.join('Alice');
	expect(alice.command('jointeam 6')).toBe(true);
	expect(alice.command('jointeam 2')).toBe(false);
	expect(server.log).not.toContain('chooseTeam is heard');
});

test('without reapi a purchase is asked through cstrike: answering true forbids it', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const alice = server.join('Alice');
	expect(server.fire('CS_OnBuyAttempt', alice.id, constant('CSI_AWP'))).toBe(1);
	expect(server.fire('CS_OnBuyAttempt', alice.id, constant('CSI_AK47'))).toBe(0);
});

test('without reapi a defuse is the game\'s log line, with the player it names', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const alice = server.join('Alice <the> Great');
	server.gameLog(`"${alice.name}<${alice.userid}><STEAM_0:0:1><CT>" triggered "Defused_The_Bomb"`);
	expect(server.log).toContain(`defused ${alice.id} true`);
});

test('without reapi the game rules\' fields of ReGameDLL\'s own are read from what the server has', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	server.setCvar('mp_timelimit', 0);
	server.serverCommand('time_limit');
	expect(server.log).toContain(`time limit 0 0 Counter-Strike ${server.maxPlayers}`);
	expect(Number(server.cvar('mp_timelimit'))).toBe(10);
});

test('with reapi a player\'s event is reapi\'s chain', async () => {
	const server = await loadPlugin(PLUGIN);
	expect(server.hookchains.get('take_damage')?.pre.length).toBe(1);
	expect(server.hookchains.get('round_end')?.post.length).toBe(1);
	expect([...server.hams.keys()]).toEqual([]);
	expect(server.log).not.toContain('needs ReAPI');
});

test.each([['with reapi', {}], ['without', PLAIN]])('fields read where the game keeps them, %s', async (_, options) => {
	const server = await loadPlugin(PLUGIN, options);
	const alice = server.join('Alice');
	alice.origin = [1, 2, 64];
	alice.say('/fields');
	expect(server.log).toContain('fields 1234 0.5 amxts 64');
	expect(alice.get('m_iAccount')).toBe(1234);
	expect(alice.get('var_gravity')).toBe(0.5);
});

test('without reapi a team\'s score is the members and the TeamScore message', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	server.serverCommand('scores');
	expect(server.log).toContain('scores 3 0');
	expect(server.rules.get(constant('m_iNumCTWins'))).toBe(3);
	const sent = server.userMessages.filter(message => message.name === 'TeamScore').map(message => message.args);
	expect(sent).toEqual([['CT', 3], ['TERRORIST', 0]]);
});

test('without reapi a round ends as the game ends it: the winner, the round ending, the message and the sound', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const alice = server.join('Alice');
	server.serverCommand('end');
	expect(server.log).toContain('ended TERRORIST true');
	expect(server.roundEnds).toEqual([]);
	expect(server.rules.get(constant('m_iRoundWinStatus'))).toBe(2);
	expect(alice.center).toContain('#Terrorists_Win');
	expect(server.sounds).toContainEqual({ entity: 0, sample: '%!MRAD_terwin' });
	expect(server.log).not.toContain('round TERRORIST');
});

test('the events reapi alone delivers are ReGameDLL\'s and ReHLDS\'s own', () => {
	const events = reapiEvents();
	for (const event of ['roundEnd', 'playerSpawn', 'addAccount']) expect(events.has(event)).toBe(true);
	// Ham Sandwich has these too: a player's through it on plain HLDS.
	for (const event of ['takeDamage', 'jump', 'spawn', 'think', 'canDeploy']) expect(events.has(event)).toBe(false);
});

test('each of them is heard on plain HLDS, fully or with its gaps, or is not, with the reason', () => {
	const classified = [...Object.keys(HEARD), ...Object.keys(NOT_HEARD)].sort();
	expect(classified).toEqual([...reapiEvents()].sort());
	// A B event's gaps are said on its tooltip and its page, in both languages; an A event has none.
	const said = Object.entries(HEARD).filter(([, heard]) => (heard.class === 'B') !== Boolean(heard.gaps?.en && heard.gaps.ru));
	expect(said).toEqual([]);
	expect([...unheardEvents()].sort()).toEqual(Object.keys(NOT_HEARD).sort());
	for (const event of ['playerSpawn', 'roundEnd', 'restartRound', 'onRoundFreezeEnd', 'addAccount', 'plantBomb']) expect(HEARD[event]?.class).toBe('B');
	for (const event of ['flPlayerFallDamage', 'move', 'canHavePlayerItem']) expect(NOT_HEARD[event]).toBeString();
});

test('the game events page lists what plain HLDS does not give of each, in both languages', () => {
	const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
	for (const [lang, heading] of [['en', '## A server without ReAPI'], ['ru', '## Сервер без ReAPI']] as const) {
		const page = readFileSync(`docs/${lang}/2.core/02.hooks.md`, 'utf8');
		const section = page.slice(page.indexOf(heading), page.indexOf('\n## ', page.indexOf(heading) + 1));
		const rows = [...section.matchAll(/^\| `(\w+)` \| (.+) \|$/gm)].map(([, event, text]) => `${event}: ${text}`);
		const gaps = Object.entries(HEARD).filter(([, heard]) => heard.class === 'B').map(([event, heard]) => `${event}: ${sentence(heard.gaps![lang])}`);
		expect(rows).toEqual(gaps.sort());
	}
});

test('so is each game rules field of ReGameDLL\'s own', () => {
	const own = ['gameDesc', 'timeLimit', 'gameStartTime', 'teamBalanced', 'neededPlayers', 'skipShowMenu', 'escapeRatio', 'maxPlayers', 'updateInterval', 'msgPlayerVoiceMask', 'msgRequestState'];
	expect([...Object.keys(HEARD_FIELDS), ...Object.keys(FIELDS_NOT_HEARD)].sort()).toEqual(own.sort());
});

const made: string[] = [];
let projects = 0;

afterEach(() => {
	setProjectDir(process.cwd());
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project folder with these files, the same one every run so the compile cache knows it again. */
function project(files: Record<string, string>) {
	const dir = join(tmpdir(), 'amxts-plain-hlds', String(projects++));
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

test('a project for plain HLDS does not build a listener for an event nothing there hears', async () => {
	const dir = project({
		'amxts.config.ts': 'export default defineConfig({ target: "hlds" });\n',
		'plugins/rounds.ts': [
			'game.addEventListener("takeDamage", (event) => console.log(`${event.damage}`));',
			'game.addEventListener("roundEnd", (event) => console.log(event.winner));',
			'game.addEventListener("flPlayerFallDamage", (event) => event.result / 2, true);',
			'',
		].join('\n'),
	});

	const failed = await setup({ rootDir: dir }).then(() => '', (error: Error) => error.message);
	expect(failed).toMatch(/rounds\.ts:3: "flPlayerFallDamage" needs ReAPI, and amxts\.config\.ts's target is "hlds" - nothing on plain HLDS hears it/);
	// takeDamage is Ham Sandwich's there, roundEnd the game's log line: both build.
	expect(failed).not.toContain('takeDamage');
	expect(failed).not.toContain('roundEnd');
});

test('the same listener builds for ReHLDS', async () => {
	const dir = project({
		'amxts.config.ts': 'export default defineConfig({ target: "rehlds" });\n',
		'plugins/rounds.ts': 'game.addEventListener("roundEnd", (event) => console.log(event.winner));\n',
	});
	const server = await setup({ rootDir: dir });
	expect(server.hookchains.get('round_end')?.pre.length).toBe(1);
});
