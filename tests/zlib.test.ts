import { gunzipSync, gzipSync } from 'node:zlib';
import { loadPlugin } from '@amxts/core/test-utils';
// Compression on the fake server: tests/as/zlib.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/zlib.ts';

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
	server.files.set('addons/amxmodx/data/a.gz', new Uint8Array(gzipSync('Привет, run')));
	server.files.set('addons/amxmodx/data/run.rec', new TextEncoder().encode('frames '.repeat(100)));

	expect(await run(server, 'zlib_gunzip addons/amxmodx/data/a.gz')).toEqual(['sync Привет, run', 'async Привет, run']);
	expect(await run(server, 'zlib_gzip addons/amxmodx/data/run.rec')).toEqual(['written']);
	expect(new TextDecoder().decode(gunzipSync(server.files.get('addons/amxmodx/data/run.rec')!))).toBe('frames '.repeat(100));
});

test('broken data throws at once and rejects on the worker, with zlib\'s words', async () => {
	const server = await loadPlugin(PLUGIN);

	expect(await run(server, 'zlib_broken')).toEqual(['sync incorrect header check', 'async unknown compression method']);
});
