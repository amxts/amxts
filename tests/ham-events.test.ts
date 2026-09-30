import { constant, loadPlugin } from '@amxts/core/test-utils';
// Game events Ham Sandwich delivers, and an entity's actions, on the fake
// server: tests/as/ham-events.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/ham-events.ts';

test('a listener for a class is one Ham Sandwich hook of that class, registered when the server is up', async () => {
	const server = await loadPlugin(PLUGIN);
	const hooked = [...server.hams.keys()].sort();

	expect(hooked).toEqual([
		`${constant('Ham_CS_Player_IsBot')}:player:pre`,
		`${constant('Ham_Item_Deploy')}:weapon_c4:pre`,
		`${constant('Ham_TakeDamage')}:func_breakable:pre`,
		`${constant('Ham_TeamId')}:func_door:pre`,
		`${constant('Ham_Use')}:func_button:pre`,
		`${constant('Ham_Weapon_PrimaryAttack')}:weapon_knife:pre`,
		`${constant('Ham_Weapon_SecondaryAttack')}:weapon_knife:post`,
	].sort());
	// takeDamage with no class is the player's, reapi's chain.
	expect(server.hookchains.get('take_damage')?.pre.length).toBe(1);
	// An event about one class of entity, listened for with none, is refused.
	expect(server.log).toContain('think is about one class of entity');
});

test('primaryAttack: the weapon is a Weapon, its secondaryAttack() runs the listeners, preventDefault blocks', async () => {
	const server = await loadPlugin(PLUGIN);
	const knife = server.createEntity('weapon_knife');

	const fired = server.fireHam('primaryAttack', knife);

	expect(server.log).toContain(`slash ${knife.id}`);
	expect(server.hamCalls).toEqual([{ fn: constant('Ham_Weapon_SecondaryAttack'), entity: knife.id, args: [], hooks: true }]);
	expect(server.log).toContain(`stab ${knife.id}`);
	expect(fired.prevented).toBe(true);
});

test('an action with { hooks: false } runs the game\'s function alone', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const knife = server.createEntity('weapon_knife');

	alice.command(`ham_stab ${knife.id}`);

	expect(server.hamCalls).toEqual([{ fn: constant('Ham_Weapon_SecondaryAttack'), entity: knife.id, args: [], hooks: false }]);
	expect(server.log).not.toContain('stab');
});

test('takeDamage on another class: the entity, a writable damage and an answer, through Ham Sandwich', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const box = server.createEntity('func_breakable');

	const fired = server.fireHam('takeDamage', box, [0, alice.id, 30.0, 2], { result: 1 });

	expect(server.log).toContain(`box ${box.id} 30`);
	expect(fired.args[3]).toBe(5);
	expect(fired.prevented).toBe(true);
	expect(fired.result).toBe(0);
	// The player's is reapi's.
	server.fireHook('takeDamage', [alice.id, 0, 0, 10.0, 0]);
	expect(server.log).toContain(`player ${alice.id}`);
	expect(server.log).not.toContain(`box ${alice.id}`);
});

test('answers of every kind: a boolean, text, and a player\'s event with no class', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const alice2 = server.createEntity('weapon_c4');
	const door = server.createEntity('func_door');

	expect(server.fireHam('deploy', alice2).result).toBe(0);
	expect(server.fireHam('teamId', door).result).toBe('blue');
	expect(server.fireHam('isBot', alice).result).toBe(1);
});

test('use: the type is a name, and writing it writes the argument', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const button = server.createEntity('func_button');

	const fired = server.fireHam('use', button, [alice.id, alice.id, 1, 0.5]);

	expect(server.log).toContain('use on 0.5');
	expect(fired.args[3]).toBe(0);
});

test('an action answers with the game\'s function\'s result', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const c4 = server.createEntity('weapon_c4');

	alice.command(`ham_deploy ${c4.id}`);

	expect(server.log).toContain('deployed false');
	expect(server.hamCalls.at(-1)).toEqual({ fn: constant('Ham_Item_Deploy'), entity: c4.id, args: [], hooks: true });
});
