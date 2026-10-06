/**
 * A plugin's tests on the fake server run under Node with Vitest as under
 * `bun test`: the fixture plugin (tests/as/counter.ts) is compiled and loaded
 * with no Bun in the process.
 */
import { loadPlugin } from '@amxts/core/test-utils';
import { expect, test } from 'vitest';

const COUNTER = 'tests/as/counter.ts';

test('the plugin loads, and its cvar and command work', async () => {
	const server = await loadPlugin(COUNTER, { cvars: { counter_step: '3' } });
	const admin = server.join('Admin');

	expect(server.log).toContain('plugins loaded\nconfigs executed, step 3');
	expect(admin.command('counter_add 2')).toBe(true);
	expect(admin.console).toBe('Counter: 6');
	expect(server.callNative('counter_total')).toBe(6);
});
