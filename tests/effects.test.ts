import { loadPlugin } from '@amxts/core/test-utils';
// Temporary effects and the files they draw, on the fake server: tests/as/effects.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/effects.ts';

/** The temporary effects the plugin sent, in order. */
function sent(server: Awaited<ReturnType<typeof loadPlugin>>) {
	return server.userMessages.filter(m => m.name === 'SVC_TEMPENTITY');
}

test('precache: a file asked for at the top level is precached as the map loads, one in the event at once', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fx_indexes');

	expect(server.precached).toEqual(['sprites/shockwave.spr', 'models/glassgibs.mdl', 'sprites/laserbeam.spr']);
	expect(server.log).toContain('in the event 3');
	expect(server.log).toContain('indexes 1 2 sprites/shockwave.spr');
});

test('precache: after the map has loaded, a precached file is found again, one not precached is said in the console', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fx_late');

	expect(server.log).toContain('"sprites/late.spr" is not precached');
	expect(server.log).toContain('again 1');
	expect(server.log).not.toContain('"sprites/shockwave.spr" is not precached');
	expect(server.precached).not.toContain('sprites/late.spr');
});

test('beamCylinder near a point: the message\'s bytes, seconds as tenths, the colour from hex', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	alice.origin = [10, 20, 30];

	alice.command('fx_cylinder');

	expect(sent(server)).toEqual([{
		name: 'SVC_TEMPENTITY',
		player: 0,
		dest: 4,
		origin: [10, 20, 30],
		args: [21, 10, 20, 30, 10, 20, 415, 1, 0, 0, 4, 60, 0, 0, 150, 255, 200, 0],
	}]);
});

test('beamFollow to one player: unreliable, the short colour, the default alpha', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fx_follow');

	expect(sent(server)).toEqual([{ name: 'SVC_TEMPENTITY', player: alice.id, dest: 8, origin: [0, 0, 0], args: [22, alice.id, 1, 10, 5, 0, 153, 255, 255] }]);
});

test('explosion, light, breakModel: flags from booleans and names, sizes and times converted', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	for (const command of ['fx_explosion', 'fx_light', 'fx_break']) alice.command(command);

	const [explosion, light, glass] = sent(server);
	expect(explosion.dest).toBe(0);
	expect(explosion.args).toEqual([3, 1, 2, 3, 1, 30, 15, 4 | 8]);
	expect(light.args).toEqual([27, 0, 0, 0, 20, 255, 255, 255, 25, 0]);
	expect(server.log).toContain('"red" is not a colour');
	expect(glass.args.slice(-6)).toEqual([50, 0, 2, 8, 20, 1 | 0x10]);
});

test('an effect whose sprite is not precached is not sent, and says so', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fx_missing');

	expect(sent(server)).toEqual([]);
	expect(server.log).toContain('effects: "sprites/never.spr" is not precached');
});

test('an engine message other than an effect is recorded by its SVC_ name', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fx_movevars');

	expect(server.userMessages).toEqual([{ name: 'SVC_NEWMOVEVARS', player: alice.id, dest: 1, origin: [0, 0, 0], args: [1] }]);
});
