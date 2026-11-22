import { FakeServer } from '@amxts/core/test-utils';
// A Cvar with no default, made before the plugin that makes its cvar loads:
// it finds the cvar once it is there.
import { expect, test, vi } from 'vitest';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

test('a Cvar made before its cvar exists finds it once a later plugin makes it', async () => {
	const server = new FakeServer();
	await server.load('tests/as/cvar-early.ts');
	await server.load('tests/as/cvar-maker.ts');
	server.start();
	expect(server.native('late_exists')).toBe(true);
	expect(server.native('late_number')).toBe(5);
	server.native('late_set', 7);
	expect(server.native('maker_number')).toBe(7);
});
