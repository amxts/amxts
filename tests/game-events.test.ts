import { loadPlugin } from '@amxts/core/test-utils';
/**
 * The showcase's hookchain listeners, fired on the fake server: an answer
 * returned from a listener, and preventDefault().
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(60_000);

const DMG_BULLET = 2;

describe('takeDamage', () => {
	test('is blocked for a glowing player, with preventDefault', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const victim = server.join('Alice', { team: 'CT' });
		const attacker = server.join('Bob', { team: 'TERRORIST' });
		victim.set('renderfx', 19); // kRenderFxGlowShell

		const hit = server.fireHook('takeDamage', [victim.id, 0, attacker.id, 30.0, DMG_BULLET], { result: 1 });

		expect(hit.prevented).toBe(true);
		expect(hit.result).toBe(0);
	});

	test('goes ahead for anyone else', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const victim = server.join('Alice', { team: 'CT' });
		const attacker = server.join('Bob', { team: 'TERRORIST' });

		const hit = server.fireHook('takeDamage', [victim.id, 0, attacker.id, 30.0, DMG_BULLET], { result: 1 });

		expect(hit.prevented).toBe(false);
		expect(hit.result).toBe(1);
	});
});

test('a fall hurts half as much: the post listener returns the new answer', async () => {
	const server = await loadPlugin('tests/as/showcase.ts');
	const player = server.join('Alice');

	const fall = server.fireHook('flPlayerFallDamage', [player.id], { result: 40.0 });

	expect(fall.prevented).toBe(false);
	expect(fall.result).toBe(20);
});

describe('canPlayerHearPlayer answers with what the listener returns', () => {
	test('true within a team', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const alice = server.join('Alice', { team: 'CT' });
		const carl = server.join('Carl', { team: 'CT' });

		const heard = server.fireHook('canPlayerHearPlayer', [alice.id, carl.id], { result: false });

		// An answer from a pre listener stops the game from deciding.
		expect(heard.prevented).toBe(true);
		expect(heard.result).toBe(true);
	});

	test('false across teams, even where the game would say true', async () => {
		const server = await loadPlugin('tests/as/showcase.ts');
		const alice = server.join('Alice', { team: 'CT' });
		const bob = server.join('Bob', { team: 'TERRORIST' });

		expect(server.fireHook('canPlayerHearPlayer', [alice.id, bob.id], { result: true }).result).toBe(false);
	});
});

describe('enum and flag arguments are names', () => {
	// WinStatus: WINSTATUS_TERRORISTS 2; ScenarioEventEndRound: ROUND_TARGET_SAVED 12,
	// ROUND_TERRORISTS_WIN 9; VGUIMenu: VGUI_Menu_Class_CT 27; KillRarity:
	// HEADSHOT 0x1, NOSCOPE 0x4, and 0x800, a bit the include does not name.
	test('roundEnd: winner and reason read as names, and a written name goes back as its number', async () => {
		const server = await loadPlugin('tests/as/hook-names.ts');
		const ended = server.fireHook('roundEnd', [2, 12, 5.0], { result: true });

		expect(server.log).toContain('roundEnd TERRORIST targetSaved 5');
		expect(ended.args.slice(0, 2)).toEqual([2, 9]);
	});

	test('a number the include does not name reads as "unknown", and is left as it came', async () => {
		const server = await loadPlugin('tests/as/hook-names.ts');
		const ended = server.fireHook('roundEnd', [0, 77, 3.0], { result: true });

		expect(server.log).toContain('roundEnd none unknown 3');
		// "none" is written as draw (3); the reason nobody touched stays 77.
		expect(ended.args.slice(0, 2)).toEqual([3, 77]);
	});

	test('showVguiMenu: the menu by name', async () => {
		const server = await loadPlugin('tests/as/hook-names.ts');
		const player = server.join('Alice');
		server.fireHook('showVguiMenu', [player.id, 27, 0, '']);

		expect(server.log).toContain('menu classCT');
	});

	// HitBoxGroup: HITGROUP_HEAD 1, HITGROUP_CHEST 2; ItemID: ITEM_AWP 18, ITEM_DEFUSEKIT 32;
	// ItemRestType: ITEM_TYPE_BUYING 0.
	test('pain: the body part by name, written back as its number', async () => {
		const server = await loadPlugin('tests/as/hook-names.ts');
		const player = server.join('Alice');
		const pained = server.fireHook('pain', [player.id, 1, 0]);

		expect(server.log).toContain('pain head');
		expect(pained.args[1]).toBe(2);
	});

	test('hasRestrictItem: the item by its kind', async () => {
		const server = await loadPlugin('tests/as/hook-names.ts');
		const player = server.join('Alice');

		expect(server.fireHook('hasRestrictItem', [player.id, 18, 0], { result: false }).result).toBe(true);
		expect(server.fireHook('hasRestrictItem', [player.id, 32, 0], { result: false }).result).toBe(false);
		expect(server.log).toContain('restrict awp buying');
		expect(server.log).toContain('restrict defusekit buying');
	});

	test('sendDeathMessage: flags are arrays of names; unnamed bits survive a write', async () => {
		const server = await loadPlugin('tests/as/hook-names.ts');
		const killer = server.join('Alice');
		const victim = server.join('Bob');
		const sent = server.fireHook('sendDeathMessage', [killer.id, victim.id, 0, 0, 'ak47', 0x1 | 0x4, 0x1 | 0x4 | 0x800]);

		expect(server.log).toContain('death Position,KillRarity / Headshot,NoScope');
		expect(sent.args[6]).toBe(0x4 | 0x800);
	});
});
