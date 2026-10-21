import { loadPlugin } from '@amxts/core/test-utils';
// server.keep and server.kept on the fake server: what a run keeps is read
// back by the next start of the same plugin, and is gone once it has started.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

test('a reload reads what the last run kept, once its start is over it is gone', async () => {
	const server = await loadPlugin('tests/as/keep.ts');
	expect(server.log).toContain('start 1: no frames, no note, no run');

	const second = await server.reload(server.plugins[0]);
	expect(server.log).toContain('start 2: 1,1,1, привет 1, Alice 3.95');
	expect(server.log).toContain('init sees 1');

	server.serverCommand('keep_late');
	expect(server.log).toContain('later: 0');

	await server.reload(second);
	expect(server.log).toContain('start 3: 2,2,2, привет 2, Alice 3.95');
});
