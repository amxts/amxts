import { loadPlugin } from '@amxts/core/test-utils';
// player.screen on the fake server: each call is one user message to that
// player, with seconds turned into the message's fixed point.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

test('fade: seconds are 1/4096 s, and the options are its flags', async () => {
	const server = await loadPlugin('tests/as/screen.ts');
	const alice = server.join('Alice');
	alice.command('scr_fade');
	alice.command('scr_black');

	expect(server.userMessages).toEqual([
		// 0.5 s, no hold, FFADE_IN; r g b a.
		{ name: 'ScreenFade', player: alice.id, args: [2048, 0, 0, 200, 0, 0, 100] },
		// 1/16 s = 1 << 8, 1 s = 1 << 12; FFADE_OUT | MODULATE | STAYOUT.
		{ name: 'ScreenFade', player: alice.id, args: [256, 4096, 7, 0, 0, 0, 255] },
	]);
});

test('shake: amplitude and duration in 1/4096, frequency in 1/256', async () => {
	const server = await loadPlugin('tests/as/screen.ts');
	const alice = server.join('Alice');
	alice.command('scr_shake');

	expect(server.userMessages).toEqual([{ name: 'ScreenShake', player: alice.id, args: [8 << 12, 1 << 12, 5 << 8] }]);
});

test('statusIcon: its state as StatusIcon counts it; a hidden one carries no colour', async () => {
	const server = await loadPlugin('tests/as/screen.ts');
	const alice = server.join('Alice');
	alice.command('scr_icon');

	expect(server.userMessages).toEqual([
		{ name: 'StatusIcon', player: alice.id, args: [2, 'dmg_cold', 0, 200, 255] },
		{ name: 'StatusIcon', player: alice.id, args: [0, 'dmg_cold'] },
	]);
});

test('the HUD the game draws: round clock, hidden parts, crosshair, flashlight', async () => {
	const server = await loadPlugin('tests/as/screen.ts');
	const alice = server.join('Alice');
	alice.command('scr_hud');

	expect(server.userMessages).toEqual([
		{ name: 'RoundTime', player: alice.id, args: [90] },
		// HIDEHUD_MONEY (32) | HIDEHUD_TIMER (16).
		{ name: 'HideWeapon', player: alice.id, args: [48] },
		{ name: 'Crosshair', player: alice.id, args: [0] },
		{ name: 'Flashlight', player: alice.id, args: [0, 100] },
	]);
});

test('progressBar: whole seconds, and 0 hides it', async () => {
	const server = await loadPlugin('tests/as/screen.ts');
	const alice = server.join('Alice');
	alice.command('scr_bar');

	expect(server.userMessages).toEqual([
		{ name: 'BarTime', player: alice.id, args: [5] },
		{ name: 'BarTime', player: alice.id, args: [0] },
	]);
});
