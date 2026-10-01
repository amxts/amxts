import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { constant, loadPlugin, setup } from '@amxts/core/test-utils';
// A server without reapi - plain HLDS: the hood picks the backend once, and a
// plugin reads the same. A player's game events go through Ham Sandwich, a
// weapon's with no class through every weapon's; an event of ReGameDLL's own
// is one line in the console and no listener; fields are read in memory; a
// team's score and a round's end are done as the game does them. A project
// for plain HLDS does not build a listener for an event reapi alone delivers.
// tests/as/plain-hlds.ts.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { setProjectDir } from '../scripts/project';
import { reapiEvents } from '../scripts/reapi-events';

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

test('an event of ReGameDLL\'s own says so once, and is not listened for', async () => {
	const server = await loadPlugin(PLUGIN, PLAIN);
	const said = server.logLines.filter(line => line.includes('roundEnd needs ReAPI'));
	expect(said).toEqual(['warning: roundEnd needs ReAPI, which this server does not have: its listeners are never called']);
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

test('a project for plain HLDS does not build a listener for an event reapi alone delivers', async () => {
	const dir = project({
		'amxts.config.ts': 'export default defineConfig({ target: "hlds" });\n',
		'plugins/rounds.ts': [
			'game.addEventListener("takeDamage", (event) => console.log(`${event.damage}`));',
			'',
			'game.addEventListener("roundEnd", (event) => console.log(event.winner));',
			'',
		].join('\n'),
	});

	const failed = await setup({ rootDir: dir }).then(() => '', (error: Error) => error.message);
	expect(failed).toMatch(/rounds\.ts:3: "roundEnd" needs ReAPI, and amxts\.config\.ts's target is "hlds"/);
	expect(failed).not.toContain('takeDamage');
});

test('the same listener builds for ReHLDS', async () => {
	const dir = project({
		'amxts.config.ts': 'export default defineConfig({ target: "rehlds" });\n',
		'plugins/rounds.ts': 'game.addEventListener("roundEnd", (event) => console.log(event.winner));\n',
	});
	const server = await setup({ rootDir: dir });
	expect(server.hookchains.get('round_end')?.pre.length).toBe(1);
});
