/**
 * The build a module and the compiler beside it on a server are of: the
 * module carries it, amxts-compile is built as the same one, and
 * `amxts-compile --version` says it - what the module asks before it compiles
 * a plugin's source, refusing a compiler of another build.
 *
 * And the ABI a plugin is compiled against: the version and a hash of the
 * hood's imports, natives table and patches, written into the plugin, which
 * the module checks before it loads it - by the line and the hash, so a
 * plugin of one patch loads on another's module.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import pkg from '../package.json';
import { ABI_SECTION, abiIdentity, abiLine, buildDefines, buildIdentity, importsOf, releaseLine } from '../scripts/build-identity';
import { compilePlugin } from '../scripts/compile';
import { readSection } from '../scripts/source-map';
import { wamrcPath } from '../scripts/system';
import { compileWasmFile } from '../src/testing/compile';
import { cacheCounts, cacheOn } from '../src/testing/compile-cache';

setDefaultTimeout(300_000);

const out = join(tmpdir(), 'amxts-build-identity');
mkdirSync(out, { recursive: true });

test('a build is the version and the commit', () => {
	const commit = spawnSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
	expect(buildIdentity()).toBe(`${pkg.version}+${commit}`);
});

test('the compiler says the build it is built as', () => {
	const version = (...define: string[]) =>
		spawnSync(process.execPath, [...define, 'scripts/compile-one.ts', '--version'], { encoding: 'utf-8' }).stdout;

	expect(version(...buildDefines('0.2.0+1bf291c0ab', '0.2.0+abi.1a2b3c4d'))).toBe('0.2.0+1bf291c0ab\n');
	expect(version()).toBe('unknown\n');
});

test('the ABI is the version and a hash, the same on every call', () => {
	const [version, hash] = abiIdentity().split('+abi.');
	expect(version).toBe(pkg.version);
	expect(hash).toMatch(/^[0-9a-f]{8}$/);
	expect(abiIdentity()).toBe(abiIdentity());
});

test('AMXTS_AS_VERSION builds as another version: the same commit and the same hash', () => {
	const build = buildIdentity();
	const abi = abiIdentity();
	process.env.AMXTS_AS_VERSION = '9.8.7';
	try {
		expect(buildIdentity()).toBe(build.replace(pkg.version, '9.8.7'));
		expect(abiIdentity()).toBe(abi.replace(pkg.version, '9.8.7'));
	} finally {
		delete process.env.AMXTS_AS_VERSION;
	}
});

test('the module compares the line and the hash, not the patch', () => {
	expect(releaseLine('0.3.1')).toBe('0.3');
	expect(releaseLine('0.3.0-rc.1')).toBe('0.3');
	expect(releaseLine('1.12.4')).toBe('1.12');
	expect(abiLine('0.3.1+abi.1a2b3c4d')).toBe('0.3+abi.1a2b3c4d');
	expect(abiLine('0.3.0+abi.1a2b3c4d')).toBe(abiLine('0.3.2+abi.1a2b3c4d'));
	expect(abiLine('0.3.0+abi.1a2b3c4d')).not.toBe(abiLine('0.4.0+abi.1a2b3c4d'));
	expect(abiLine('0.3.0+abi.1a2b3c4d')).not.toBe(abiLine('0.3.0+abi.99999999'));
	expect(abiLine('')).toBe('');
});

test('an import is its name and its types: a parameter renamed is the same ABI', () => {
	const code = [
		'@external("env", "ent_get")         declare function _entGet(id: i32, offset: i32): i32;',
		'@external("env", "co_suspend")',
		'declare function suspend(): void;',
		'@external("env", "net_close") export declare function netClose(request: i32);',
	].join('\n');

	expect(importsOf(code)).toEqual(['ent_get(i32,i32)i32', 'co_suspend()void', 'net_close(i32)void']);
	expect(importsOf(code.replace('offset: i32', 'at: i32'))).toEqual(importsOf(code));
	expect(importsOf(code.replace('offset: i32', 'offset: f64'))).not.toEqual(importsOf(code));
});

test('a plugin carries the ABI it is compiled against, into its .aot', async () => {
	const wasm = join(out, 'abi.wasm');
	expect(await compileWasmFile({ source: 'tests/as/player-api.ts', root: 'as' }, wasm)).toBeNull();
	expect(readSection(new Uint8Array(readFileSync(wasm)), ABI_SECTION)).toBe(abiIdentity());

	const wamrc = wamrcPath();
	if (!existsSync(wamrc)) return;
	const aot = join(out, 'abi.aot');
	const plugin = { source: 'tests/as/player-api.ts', output: aot, root: 'as', wamrc, signatures: 'runtime/natives.txt', quick: true };
	expect(await compilePlugin(plugin)).toBeNull();
	expect(readFileSync(aot).includes(`${ABI_SECTION}\0${abiIdentity()}`)).toBe(true);
});

/** The ABI section of `source` compiled as `version`, and whether the compile came from the cache. */
async function compiledAs(version: string, source: string): Promise<{ abi: string | null; cached: boolean }> {
	const wasm = join(out, 'version.wasm');
	const was = process.env.AMXTS_AS_VERSION;
	const hits = cacheCounts.hits;
	try {
		process.env.AMXTS_AS_VERSION = version;
		expect(await compileWasmFile({ source, root: 'as' }, wasm)).toBeNull();
		return { abi: readSection(new Uint8Array(readFileSync(wasm)), ABI_SECTION), cached: cacheCounts.hits > hits };
	} finally {
		if (was === undefined) delete process.env.AMXTS_AS_VERSION;
		else process.env.AMXTS_AS_VERSION = was;
	}
}

test('a plugin of one patch is taken from the cache for another of its line, and another line compiles again', async () => {
	const source = 'tests/as/timer-keeper.ts';
	const first = await compiledAs('0.9.1', source);
	const patch = await compiledAs('0.9.2', source);
	// Whichever patch made it, it carries the ABI the module of 0.9.2 loads.
	expect(abiLine(patch.abi!)).toBe(abiLine(first.abi!));
	expect(patch.abi).toMatch(/^0\.9\.[12]\+abi\./);
	if (cacheOn) expect(patch.cached).toBe(true);

	// Another line is refused by the module, so it is not the cached one.
	const minor = await compiledAs('0.10.0', source);
	expect(minor.abi).toStartWith('0.10.0+abi.');
	expect(abiLine(minor.abi!)).not.toBe(abiLine(patch.abi!));
});
