import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugin } from '@amxts/core/test-utils';
// The testing library's compile cache (src/testing/compile-cache.ts): a hit is
// the fresh compile byte for byte, and an edit to a file the plugin imports -
// not only to the plugin itself - makes it compile again.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { recordReads, readdirSync as trackedReaddir, unchanged } from '../scripts/tracked-fs';
import { compileWasmFile, forgetCompiled } from '../src/testing/compile';
import { cacheCounts, cacheOn } from '../src/testing/compile-cache';

setDefaultTimeout(240_000);

const dir = join(tmpdir(), 'amxts-compile-cache');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// A word of this run's own, so the first compile is always a miss.
const word = `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const plugin = join(dir, 'plugin.ts');
const greeting = join(dir, 'greeting.ts');
writeFileSync(plugin, [
	'import { plugin } from "@amxts/core";',
	'import { GREETING } from "./greeting";',
	'',
	'plugin({ name: "cache-probe", version: "1.0.0", author: "", description: "" });',
	'',
	'export function cache_greeting() {',
	'\treturn GREETING;',
	'}',
	'',
].join('\n'));
const greet = (text: string) => writeFileSync(greeting, `export const GREETING = "${text}";\n`);

/** Hits and misses since `run` started. */
async function counting(run: () => Promise<unknown>) {
	const before = { ...cacheCounts };
	await run();
	return { hits: cacheCounts.hits - before.hits, misses: cacheCounts.misses - before.misses };
}

describe.skipIf(!cacheOn)('the compile cache', () => {
	test('a hit is the fresh compile byte for byte', async () => {
		const wasm = join(dir, 'plugin.wasm');
		greet(`hello ${word}`);

		// A miss: compileToWasm itself, with nothing cached in the way.
		expect(await counting(() => compileWasmFile({ source: plugin, root: 'as' }, wasm))).toEqual({ hits: 0, misses: 1 });
		const fresh = readFileSync(wasm);

		rmSync(wasm);
		expect(await counting(() => compileWasmFile({ source: plugin, root: 'as' }, wasm))).toEqual({ hits: 1, misses: 0 });
		expect(readFileSync(wasm).equals(fresh)).toBe(true);
	});

	test('a plugin a test loads: its natives come back from the disk, and an edit to its import is seen', async () => {
		/** The plugin loaded past this run's own memory of it, and what it answers. */
		async function load() {
			forgetCompiled();
			const server = await loadPlugin(plugin);
			return server.native('cache_greeting');
		}

		greet(`hello again ${word}`);
		expect(await counting(load)).toEqual({ hits: 0, misses: 1 });
		expect(await load()).toBe(`hello again ${word}`);

		expect(await counting(load)).toEqual({ hits: 1, misses: 0 });

		greet(`bye again ${word}`);
		expect(await counting(load)).toEqual({ hits: 0, misses: 1 });
		expect(await load()).toBe(`bye again ${word}`);
	});
});

test('a folder read keeps its entry while only hidden names come into it, as node_modules/.cache does', async () => {
	const folder = join(dir, 'listing');
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, 'a.ts'), '');
	const { reads } = await recordReads(async () => trackedReaddir(folder));
	mkdirSync(join(folder, '.cache'));
	expect(unchanged(reads)).toBe(true);
	writeFileSync(join(folder, 'b.ts'), '');
	expect(unchanged(reads)).toBe(false);
});
