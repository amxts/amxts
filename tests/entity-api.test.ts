import { loadPlugin } from '@amxts/core/test-utils';
// What an entity does, on the fake server: tests/as/entity-api.ts.
import { expect, test } from 'vitest';

const PLUGIN = 'tests/as/entity-api.ts';

test('exists: an entity in the world and a player on the server; not 0, not one that is gone', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const box = server.createEntity('info_target');

	for (const id of [box.id, alice.id, 0]) alice.command(`ent_exists ${id}`);
	server.entities.delete(box.id);
	alice.command(`ent_exists ${box.id}`);

	expect(alice.console.split('\n')).toEqual(['true', 'true', 'false', 'false']);
});

test('precache: while the map loads, each file its index; emitSound plays from the entity', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('ent_sound');

	expect(server.log).toContain('precached 1 2 3 4');
	expect(server.precached).toEqual(['myplugin/hit.wav', 'models/myplugin/box.mdl', 'sprites/myplugin.spr', 'myplugin/readme.txt']);
	expect(server.sounds).toEqual([{ entity: alice.id, sample: 'myplugin/hit.wav' }, { entity: alice.id, sample: 'myplugin/hit.wav', to: alice.id }]);
});

test('startSound: recipients choose the players a sound plays to', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const hidden = server.join('Hidden');

	server.fireHook('startSound', [0, alice.id, 4, 'player/pl_step1.wav', 255, 0.8, 0, 100]);
	expect(server.soundTo).toBeNull();
	server.fireHook('startSound', [0, hidden.id, 4, 'player/pl_step1.wav', 255, 0.8, 0, 100]);
	expect(server.soundTo).toEqual([alice.id]);
});

test('model sets the model as the game does; setSize the box, and refuses one inside out', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('ent_box');

	expect(alice.console).toBe('models/myplugin/box.mdl 2 -16,-8,0 16,8,40 32,16,40');
	expect(server.log).toContain('setSize: mins [0, 0, 50] above maxs [1, 1, 40]');
});

test('every entity has health; a player\'s is his own, and his fov is the game\'s zoom with the entvar beside it', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('ent_health');

	// The Player through an Entity variable still answers as a player.
	expect(alice.console).toBe('50.5 75 75 110');
	expect(alice.get('m_iFOV')).toBe(110);
	expect(alice.get('var_fov')).toBe(110);
});
