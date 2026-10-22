import { gunzipSync, gzipSync } from 'node:zlib';
import { loadPlugin } from '@amxts/core/test-utils';
// Compression on the fake server: tests/as/zlib.ts.
import { expect, test } from 'vitest';

const PLUGIN = 'tests/as/zlib.ts';

// Cyrillic on purpose: text read back as UTF-8.
const GREETING = 'Привет, run';

/** Runs a command and lets its work come back; the lines it logged. */
async function run(server: Awaited<ReturnType<typeof loadPlugin>>, command: string): Promise<string[]> {
	const from = server.logLines.length;
	server.serverCommand(command);
	await server.responses();
	return server.logLines.slice(from);
}

test('gzip, deflate and deflateRaw go both ways, at once and on the worker', async () => {
	const server = await loadPlugin(PLUGIN);

	expect(await run(server, 'zlib_round')).toEqual(['sync true true true', 'async true true true']);
});

test('a gzip made by Node is read, and one made by the plugin is read by Node', async () => {
	const server = await loadPlugin(PLUGIN);
	server.files.set('addons/amxmodx/data/a.gz', new Uint8Array(gzipSync(GREETING)));
	server.files.set('addons/amxmodx/data/run.rec', new TextEncoder().encode('frames '.repeat(100)));

	expect(await run(server, 'zlib_gunzip addons/amxmodx/data/a.gz')).toEqual([`sync ${GREETING}`, `async ${GREETING}`]);
	expect(await run(server, 'zlib_gzip addons/amxmodx/data/run.rec')).toEqual(['written']);
	expect(new TextDecoder().decode(gunzipSync(server.files.get('addons/amxmodx/data/run.rec')!))).toBe('frames '.repeat(100));
});

test('broken data throws at once and rejects on the worker, with zlib\'s words', async () => {
	const server = await loadPlugin(PLUGIN);

	expect(await run(server, 'zlib_broken')).toEqual(['sync incorrect header check', 'async unknown compression method']);
});
