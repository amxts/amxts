import type { NativeCall } from '../src/testing/natives';
import { loadPlugin } from '@amxts/core/test-utils';
/**
 * The fake server's own core, on a small fixture plugin (tests/as/counter.ts):
 * cvars, a console command, an exported native, and the error a native it
 * does not implement stops the test with.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { NATIVES } from '../src/testing/natives';

setDefaultTimeout(60_000);

const COUNTER = 'tests/as/counter.ts';

test('the map starts as on a real server: the plugins are loaded, then the configs run', async () => {
	const server = await loadPlugin(COUNTER, { cvars: { counter_step: '3' } });

	expect(server.log).toContain('plugins loaded\nconfigs executed, step 3');
});

test('a reload: the plugin hears "end", and the new one the map\'s start, as on a running map', async () => {
	const server = await loadPlugin(COUNTER, { cvars: { counter_step: '3' } });
	server.join('Admin').command('counter_add 2');

	await server.reload(server.plugins[0]);

	expect(server.log.split('\n').slice(-3)).toEqual(['end, total 6', 'plugins loaded', 'configs executed, step 3']);
});

test('a cvar is made with its default, and its listener hears a change', async () => {
	const server = await loadPlugin(COUNTER);
	expect(server.cvar('counter_step')).toBe('1');

	server.setCvar('counter_step', 5);

	expect(server.log).toContain('step 1 -> 5');
});

test('a console command gets its arguments, and reads the cvar', async () => {
	const server = await loadPlugin(COUNTER, { cvars: { counter_step: '3' } });
	const admin = server.join('Admin');

	expect(admin.command('counter_add 2')).toBe(true);
	expect(admin.console).toBe('Counter: 6');
	expect(server.callNative('counter_total')).toBe(6);
});

test('a command nobody registered is left to the game', async () => {
	const server = await loadPlugin(COUNTER);

	expect(server.join('Admin').command('nothing_here')).toBe(false);
});

test('a server command gets its arguments', async () => {
	const server = await loadPlugin(COUNTER);

	expect(server.serverCommand('counter_reset 7')).toBe(true);
	expect(server.log).toContain('reset to 7');
	expect(server.serverCommand('nothing_here')).toBe(false);
});

test('a search in a sphere finds the entities within its radius', async () => {
	const server = await loadPlugin(COUNTER);
	const admin = server.join('Admin', { origin: [0, 0, 0] });
	server.createEntity('info_target').origin = [60, 0, 0];
	server.createEntity('info_target').origin = [0, 150, 0];

	admin.command('counter_near');

	expect(admin.console).toBe('near: 1');
});

test('health set to nothing is the game\'s kill, which a dead player is past', async () => {
	const server = await loadPlugin(COUNTER);
	const admin = server.join('Admin');
	const call = { server } as NativeCall;

	NATIVES.set_user_health(call, [admin.id, 0]);
	NATIVES.set_user_health(call, [admin.id, 0]);

	expect(admin.alive).toBe(false);
	expect(admin.deaths).toBe(1);
	expect(admin.frags).toBe(-1);
});

test('a native the fake does not simulate is named, with what the test can do', async () => {
	const server = await loadPlugin(COUNTER);

	expect(() => server.join('Admin').command('counter_time')).toThrow(
		'the plugin called the native "get_user_time", which the fake server does not simulate: answer it in the test with server.defineNative("get_user_time"',
	);
});
