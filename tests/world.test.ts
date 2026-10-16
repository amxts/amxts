import { loadPlugin } from '@amxts/core/test-utils';
// Traces, a player's aim and sight, and angles on the fake server: tests/as/world.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/world.ts';

test('angles turn into directions and back as the engine turns them', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('world_angles');

	// Yaw 90 looks along y; a pitch of 45 looks down; the angles of (1, 1, -1) look back along it.
	expect(alice.console).toBe('0,1,0 0.71,0,-0.71 35.26,45,0 0,0,0 0,-1,0 0,0,1');
});

test('a trace stops at the first wall across it and tells what it hit', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	server.walls.push({ x: 100 });

	alice.command('world_trace');

	expect(alice.console).toBe('0.5 100,0,0 -1,0,0 0 true false true solid empty');
	expect(server.engineCalls).toContain(`TraceLine 0,0,0 200,0,0 1 ${alice.id}`);
});

test('a player\'s aim is what his view meets; he sees what is ahead and not behind a wall', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	alice.origin = [0, 0, 0];
	alice.set('var_view_ofs', [0, 0, 0]);
	alice.set('var_v_angle', [0, 0, 0]);
	bob.origin = [300, 0, 0];
	server.walls.push({ x: 300, entity: bob.id, hitGroup: 1 });

	alice.command('world_aim');

	// Bob is ahead and the trace meets him; a point behind Alice is out of her view.
	expect(alice.console).toBe(`${bob.id} head 300,0,0 true false true`);
});

test('a player sees through a camera, and through his own eyes again', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('world_view');

	expect(alice.console).toBe('true true');
	expect(server.engineCalls.filter(call => call.startsWith('SetView')).at(-1)).toBe(`SetView ${alice.id} ${alice.id}`);
});

test('a model put on a player is his until it is reset; hitboxes need the model precached', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('world_model');

	expect(alice.console).toBe('vip urban');
	expect(server.engineCalls.filter(call => call.startsWith('Model'))).toEqual([`Model ${alice.id} vip 0`, `Model ${alice.id} santa 0`, `Model ${alice.id} - 0`]);
	expect(server.log).toContain('player.setModel("santa", { hitboxes: true }): precache "models/player/santa/santa.mdl" first');
});

test('entityState: a listener of a class changes what one player is sent, and hides it from another', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	const marker = server.createEntity('myplugin_marker');
	const other = server.createEntity('info_target');

	const sent = [1, 2, 3, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 128, 1, 10, 0];
	const toAlice = server.sendState(alice, marker, sent);
	const toBob = server.sendState(bob, marker);
	const untouched = server.sendState(alice, other, sent);

	// renderFx 19 is kRenderFxGlowShell; the origin moved up by 10; the
	// animation's fields after body and skin, ducking (usehull) last.
	expect(toAlice).toEqual({ hidden: false, state: [1, 2, 13, 0, 0, 0, 0, 255, 255, 0, 0, 19, 0, 0, 0, 0, 5, 6, 64, 0, 10.5, 1] });
	expect(toBob.hidden).toBe(true);
	expect(untouched).toEqual({ hidden: false, state: sent });
});

test('clientData: a listener changes what one player\'s client is sent of him', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');

	// Velocity, punch angle, view offset, origin, then flags: 512 is FL_ONGROUND, 16384 FL_DUCKING.
	const sent = [0, 90, 0, 250, 250, 0, 0, 2, 0, 0, 0, 0, 17, 100, 200, 300, 512];
	expect(server.sendClientData(bob, sent)).toEqual([0, 45, 0, 125, 0, 0, 0, 3, 0, 0, 0, 0, 12, 100, 200, 310, 512 | 16384]);
	expect(server.sendClientData(alice, sent)).toEqual(sent);
});

test('a weapon\'s viewBody is its body until it is set back to 0', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	alice.set('m_pActiveItem', alice.give('weapon_knife').id);

	alice.command('world_view_body');

	expect(alice.console).toBe('3 3 0 0');
});

test('dropToFloor asks the engine to drop the entity', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('world_drop');

	expect(alice.console).toBe('true');
	expect(server.engineCalls).toContain(`DropToFloor ${alice.id}`);
});
