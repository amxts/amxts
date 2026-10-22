import { loadPlugin } from '@amxts/core/test-utils';
// The game's temporary effects heard, on the fake server: tests/as/temp-entity.ts.
import { expect, test } from 'vitest';

const PLUGIN = 'tests/as/temp-entity.ts';
const TE_DECAL = 104;
const TE_SPARKS = 9;

test('tempEntity: a spray\'s decal is heard with the spray can as its source, and kept from a player who hides others', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	const carol = server.join('Carol');
	bob.command('hide');
	const can = server.createEntity('spray_can');
	can.set('var_owner', alice.id);

	const sent = server.sendTempEntity([TE_DECAL, 10.5, 20.5, 30.5, 7], { source: can });

	expect(server.log).toContain(`heard ${TE_DECAL} 10.5 from ${alice.id}, owner ${alice.id}`);
	expect(sent.players).toEqual([alice.id, carol.id]);
});

test('tempEntity: one a player\'s command makes is his, and an effect the listener leaves alone reaches everyone', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	bob.command('hide');

	const sent = server.sendTempEntity([TE_SPARKS, 1.5, 2.5, 3.5], { source: alice });

	expect(server.log).toContain(`heard ${TE_SPARKS} 1.5 from ${alice.id}, owner 0`);
	expect(sent.players).toEqual([alice.id, bob.id]);
});

test('tempEntity: with no source the listener hears null, and an effect to one player reaches him alone', async () => {
	const server = await loadPlugin(PLUGIN);
	server.join('Alice');
	const bob = server.join('Bob');

	const sent = server.sendTempEntity([TE_DECAL, 1.5, 2.5, 3.5, 7], { player: bob });

	expect(server.log).toContain(`heard ${TE_DECAL} 1.5 from 0, owner 0`);
	expect(sent.players).toEqual([bob.id]);
});
