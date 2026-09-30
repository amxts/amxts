import { loadPlugin } from '@amxts/core/test-utils';
// Entity fields that hold one value of an engine enum take and give names
// (scripts/generate-entities.ts, ENUM_FIELDS); on the fake server the field
// keeps the number the engine would, so both ends are checked.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const FIXTURE = 'tests/as/entity-enums.ts';

test('a name is written as the engine number, and read back as the name', async () => {
	const server = await loadPlugin(FIXTURE);
	const alice = server.join('Alice');
	// Somebody to watch: a spectator mode is switched as the game does, and
	// with nobody the game switches to roaming.
	server.join('Bob');
	alice.command('enum_write');

	// kRenderTransAdd, kRenderFxGlowShell, MOVETYPE_NOCLIP, SOLID_TRIGGER, DEAD_RESPAWNABLE.
	expect(alice.get('var_rendermode')).toBe(5);
	expect(alice.get('var_renderfx')).toBe(19);
	expect(alice.get('var_movetype')).toBe(8);
	expect(alice.get('var_solid')).toBe(1);
	expect(alice.get('var_deadflag')).toBe(3);
	// DAMAGE_AIM is 2.0: pev->takedamage is a float.
	expect(alice.get('var_takedamage')).toBe(2);
	// CONTENTS_LAVA, ARMOR_VESTHELM, OBS_IN_EYE in iuser1, OBS_CHASE_FREE, DONT_BLEED, Menu_BuyRifle.
	expect(alice.get('var_watertype')).toBe(-5);
	expect(alice.get('m_iKevlar')).toBe(2);
	expect(alice.get('var_iuser1')).toBe(4);
	expect(alice.get('m_iObserverLastMode')).toBe(2);
	expect(alice.get('m_bloodColor')).toBe(-1);
	expect(alice.get('m_iMenu')).toBe(6);
	// MODEL_CT_GIGN, IGNOREMSG_TEAM.
	expect(alice.get('m_iModelName')).toBe(6);
	expect(alice.get('m_iIgnoreGlobalChat')).toBe(2);

	alice.command('enum_read');
	expect(server.log).toContain('read additive glowShell noclip trigger aim respawnable');
	// waterLevel was never written: 0 is "none".
	expect(server.log).toContain('read lava none vestHelmet inEye chaseFree none buyRifle gign all');
});

test('a number no name stands for reads as "unknown", and writing "unknown" leaves it', async () => {
	const server = await loadPlugin(FIXTURE);
	const alice = server.join('Alice');
	alice.set('var_rendermode', 9);
	alice.set('var_takedamage', 0.5);
	alice.set('var_movetype', 1);

	alice.command('enum_read');
	expect(server.log).toContain('read unknown none unknown none unknown alive');

	alice.command('enum_unknown');
	expect(alice.get('var_rendermode')).toBe(9);
	expect(alice.get('var_takedamage')).toBe(0.5);
});

test('masks are lists of names; weapons keep the suit bit', async () => {
	const server = await loadPlugin(FIXTURE);
	const alice = server.join('Alice');
	// The suit (bit 31) and the knife (WEAPON_KNIFE = 29).
	alice.set('var_weapons', (1 << 31) | (1 << 29));
	alice.command('enum_masks');

	expect(server.log).toContain('weapons knife');
	// The knife and the USP (16), and still the suit.
	expect(alice.get('var_weapons')).toBe((1 << 31) | (1 << 29) | (1 << 16));
	// PFLAG_ONLADDER | PFLAG_DUCKING, then push writes PFLAG_USING.
	expect(alice.get('m_afPhysicsFlags')).toBe(1 | 8 | 16);
	expect(server.log).toContain('physics OnLadder,Ducking,Using');
});
