import type { Plugin } from '../scripts/compile';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Several plugins compiled at once (scripts/compile-pool.ts): as many as the
// memory budget and the CPUs allow, in worker processes - to the same bytes
// as one at a time in the build's own process.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { compileAll, compileSlots, inSlots } from '../scripts/compile-pool';
import { pluginCache } from '../scripts/plugin-cache';
import { wamrcPath } from '../scripts/system';

setDefaultTimeout(240_000);

describe('how many compiles run at once', () => {
	const GB = 1024;
	test('as many as the memory budget holds - 3 GB unless AMXTS_BUILD_MEMORY says otherwise - at most one per CPU, at least one', () => {
		expect(compileSlots({}, 8)).toBe(2);
		expect(compileSlots({ AMXTS_BUILD_MEMORY: String(8 * GB) }, 8)).toBe(6);
		expect(compileSlots({ AMXTS_BUILD_MEMORY: String(8 * GB) }, 4)).toBe(4);
		expect(compileSlots({ AMXTS_BUILD_MEMORY: '512' }, 8)).toBe(1);
		expect(compileSlots({ AMXTS_BUILD_MEMORY: 'lots' }, 8)).toBe(2);
	});

	test('AMXTS_BUILD_JOBS says it outright', () => {
		expect(compileSlots({ AMXTS_BUILD_JOBS: '5' }, 2)).toBe(5);
		expect(compileSlots({ AMXTS_BUILD_JOBS: '1', AMXTS_BUILD_MEMORY: String(64 * GB) }, 16)).toBe(1);
		expect(compileSlots({ AMXTS_BUILD_JOBS: '0' }, 8)).toBe(2);
	});
});

describe('slots', () => {
	const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

	test('no more at once than there are slots; the items start in order and come back in it', async () => {
		let now = 0;
		let most = 0;
		const started: number[] = [];
		const slotsUsed = new Set<number>();
		const results = await inSlots([30, 5, 20, 5, 10], 2, async (ms, slot, index) => {
			started.push(index);
			slotsUsed.add(slot);
			most = Math.max(most, ++now);
			await wait(ms);
			now--;
			return ms * 2;
		});
		expect(most).toBe(2);
		expect(started).toEqual([0, 1, 2, 3, 4]);
		expect([...slotsUsed].sort()).toEqual([0, 1]);
		expect(results).toEqual([60, 10, 40, 10, 20]);
	});

	test('fewer items than slots use as many slots as items', async () => {
		const slotsUsed = new Set<number>();
		await inSlots(['a'], 4, async (_, slot) => slotsUsed.add(slot));
		expect([...slotsUsed]).toEqual([0]);
	});
});

// A folder of this run's own: another checkout's tests may run at the same time.
const dir = mkdtempSync(join(tmpdir(), 'amxts-compile-pool-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const PLUGINS: Record<string, string> = {
	greeter: [
		'import { plugin } from "@amxts/core";',
		'plugin({ name: "greeter", version: "1.0.0", author: "", description: "" });',
		'export function pool_greeting(name: string) {',
		'\treturn `Hello, ${name}`;',
		'}',
		'',
	].join('\n'),
	// A plugin that waits goes through Asyncify too.
	waiter: [
		'import { plugin, server, sleep } from "@amxts/core";',
		'plugin({ name: "waiter", version: "1.0.0", author: "", description: "" });',
		'server.addCommand("wait", async ({ player }) => {',
		'\tawait sleep(1);',
		'\tconsole.log(`${player.name} waited`);',
		'});',
		'',
	].join('\n'),
	broken: 'const x: number = "text";\n',
};
for (const [name, text] of Object.entries(PLUGINS)) writeFileSync(join(dir, `${name}.ts`), text);

/** The plugins by name, compiled into `out`. */
function plugins(names: string[], out: string): Plugin[] {
	return names.map(name => ({
		source: join(dir, `${name}.ts`),
		output: join(dir, out, `${name}.aot`),
		root: 'as',
		wamrc: wamrcPath(),
		signatures: 'runtime/natives.txt',
		quick: true,
	}));
}

/** compileAll with AMXTS_BUILD_JOBS at `jobs`, and no plugin cache; which plugins started. */
async function compileWith(jobs: number, list: Plugin[]) {
	const before = process.env.AMXTS_BUILD_JOBS;
	process.env.AMXTS_BUILD_JOBS = String(jobs);
	const started: number[] = [];
	try {
		const here = pluginCache(null);
		const compiled = await compileAll(list, { dir: null, includes: [], here: (plugin, natives) => here.compile(plugin, natives), started: index => started.push(index), finished() {} });
		return { compiled, started };
	} finally {
		if (before === undefined) delete process.env.AMXTS_BUILD_JOBS;
		else process.env.AMXTS_BUILD_JOBS = before;
	}
}

describe.skipIf(!existsSync(wamrcPath()))('plugins compiled at once', () => {
	test('in worker processes, to the same bytes as one at a time in this process', async () => {
		const names = ['greeter', 'waiter'];
		const serial = await compileWith(1, plugins(names, 'serial'));
		const parallel = await compileWith(2, plugins(names, 'parallel'));
		expect(serial.compiled.map(each => each?.problem)).toEqual([null, null]);
		expect(parallel.compiled).toEqual(serial.compiled);
		expect(serial.compiled[0]!.natives.map(native => native.name)).toEqual(['pool_greeting']);
		for (const name of names) {
			for (const file of [`${name}.wasm`, `${name}.aot`]) {
				expect(readFileSync(join(dir, 'parallel', file)).equals(readFileSync(join(dir, 'serial', file)))).toBe(true);
			}
		}
	});

	test('after a failure no other compile starts', async () => {
		const { compiled, started } = await compileWith(1, plugins(['broken', 'greeter'], 'failing'));
		expect(compiled[0]!.problem).toContain('Type \'~lib/string/String\' is not assignable');
		expect(compiled[1]).toBeNull();
		expect(started).toEqual([0]);
	});
});
