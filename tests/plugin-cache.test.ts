import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// What a build keeps of the plugins it compiled (scripts/plugin-cache.ts): a
// plugin nothing has changed for is put in place again as it was compiled,
// and an edit to a file it imports - or a build of the other kind - compiles
// it again. And a quick build that a Windows server can load.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { compilePlugin } from '../scripts/compile';
import { pluginCache } from '../scripts/plugin-cache';
import { sourcesFor } from '../scripts/project';
import { wamrcPath } from '../scripts/system';

setDefaultTimeout(240_000);

const dir = join(tmpdir(), 'amxts-plugin-cache');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

writeFileSync(join(dir, 'plugin.ts'), [
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
const greet = (text: string) => writeFileSync(join(dir, 'greeting.ts'), `export const GREETING = "${text}";\n`);

const plugin = {
	source: join(dir, 'plugin.ts'),
	output: join(dir, 'dist', 'plugin.aot'),
	root: 'as',
	wamrc: wamrcPath(),
	signatures: 'runtime/natives.txt',
	quick: true,
};

describe.skipIf(!existsSync(plugin.wamrc))('the plugins a build keeps', () => {
	test('one nothing changed for is put in place as it was compiled; an edit to its import compiles it again', async () => {
		const cache = pluginCache(dir);
		greet('hello');
		expect(cache.reuse(plugin)).toBeNull();
		expect(await cache.compile(plugin, [])).toBeNull();
		const compiled = readFileSync(plugin.output);
		expect(readFileSync(join(dir, 'dist', 'plugin.inc'), 'utf8')).toContain('cache_greeting');

		// Gone from the build folder, as after a clean: it comes back from the cache, with its include.
		rmSync(join(dir, 'dist'), { recursive: true });
		expect(cache.reuse(plugin)?.map(native => native.name)).toEqual(['cache_greeting']);
		expect(readFileSync(plugin.output).equals(compiled)).toBe(true);
		expect(existsSync(join(dir, 'dist', 'plugin.inc'))).toBe(true);

		// A full build is kept apart from a quick one.
		expect(cache.reuse({ ...plugin, quick: false })).toBeNull();

		greet('bye');
		expect(cache.reuse(plugin)).toBeNull();
		expect(cache.counts).toEqual({ hits: 1, misses: 1 });
	});

	test('a quick build a Windows server loads: a plugin whose -O0 frames need _chkstk is compiled at the level wamrc picks', async () => {
		const sources = sourcesFor('as');
		const menuCore = sources.project.modules.find(pkg => pkg.name === '@amxts/menu-core')!;
		const output = join(dir, 'dist', 'menu-core.aot');
		expect(await compilePlugin({ ...plugin, source: sources.ownerSource(menuCore), output, system: 'windows' })).toBeNull();
		expect(readFileSync(output).includes('_chkstk')).toBe(false);
	});
});
