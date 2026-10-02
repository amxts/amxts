import { loadPlugin } from '@amxts/core/test-utils';
/**
 * Timers on the fake server's clock: setTimeout, setInterval and clearTimeout
 * in tests/as/showcase.ts, run by `server.advance(ms)` rather than by waiting.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(60_000);

test('a tip every 45 seconds, in turn, to people and not to bots', async () => {
	const server = await loadPlugin('tests/as/showcase.ts');
	const alice = server.join('Alice');
	const bot = server.join('Bot', { bot: true });
	alice.clearMessages();

	server.advance(44_999);
	expect(alice.chat).toBe('');

	server.advance(1);
	expect(alice.chat).toBe('Say /tour to see what this plugin can do');

	server.advance(90_000);
	expect(alice.chat.split('\n')).toEqual([
		'Say /tour to see what this plugin can do',
		'Fall damage here is halved',
		'Say /tour to see what this plugin can do',
	]);
	expect(bot.chat).toBe('');
});

test('the tour takes its effects back when their time is up', async () => {
	const server = await loadPlugin('tests/as/showcase.ts');
	const alice = server.join('Alice');
	alice.say('/tour');

	expect(alice.get('m_iHideHUD')).toBe(32); // HIDEHUD_MONEY
	expect(alice.get('gravity')).toBe(0.5);

	server.advance(3000);
	expect(alice.get('m_iHideHUD')).toBe(0);
	expect(alice.get('gravity')).toBe(0.5);

	server.advance(2000);
	expect(alice.get('renderfx')).toBe(0);
	expect(alice.get('gravity')).toBe(1);
});

test('a cleared timer never runs', async () => {
	const server = await loadPlugin('tests/as/showcase.ts');
	server.join('Alice').say('/tour');

	server.advance(120_000);

	expect(server.commands).not.toContain('echo this never runs');
});

test('a reload removes the timers of the plugin it replaces', async () => {
	const server = await loadPlugin('tests/as/showcase.ts');
	const alice = server.join('Alice');
	const old = server.plugins[0];

	server.unload(old);
	await server.load('tests/as/showcase.ts');
	alice.clearMessages();

	expect(server.tasks.some(task => task.slot.plugin === old)).toBe(false);
	server.advance(45_000);
	expect(alice.chat).toBe('Say /tour to see what this plugin can do');
});
