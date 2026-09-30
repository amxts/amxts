import { loadPlugin } from '@amxts/core/test-utils';
// What an entity does, on the fake server: tests/as/entity-api.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

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
	expect(server.sounds).toEqual([{ entity: alice.id, sample: 'myplugin/hit.wav' }]);
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
