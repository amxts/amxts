/**
 * The build a module is of: the version and the commit.
 *
 * And the ABI a plugin is compiled against: the version and a hash of the
 * ground, then the shape of every import it uses, written into the plugin,
 * which the module checks before it loads it - by the line, the hash and its
 * imports, so a plugin of one patch loads on another's module that has what
 * it uses.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import pkg from '../package.json';
import { ABI_LOCK, ABI_SECTION, abiIdentity, abiLine, buildIdentity, importShapes, pluginAbi, releaseLine, shapeChanges } from '../scripts/build-identity';
import { compilePlugin } from '../scripts/compile';
import { readSection } from '../scripts/source-map';
import { moduleAbiOf, wamrcPath } from '../scripts/system';
import { compileWasmFile } from '../src/testing/compile';
import { cacheCounts, cacheOn } from '../src/testing/compile-cache';

setDefaultTimeout(300_000);

const out = join(tmpdir(), 'amxts-build-identity');
mkdirSync(out, { recursive: true });

test('a build is the version and the commit', () => {
	const commit = spawnSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
	expect(buildIdentity()).toBe(`${pkg.version}+${commit}`);
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

test('a module file is read for its ABI: test:server builds one again whose line or hash is not the checkout\'s', () => {
	const file = join(out, 'amxts_amxx.dll');
	writeFileSync(file, Buffer.concat([Buffer.from([0x4D, 0x5A, 0, 0xFF]), Buffer.from('0.2.0+1290ba0540\0'), Buffer.from('0.2.0-rc.1+abi.254ad446\0')]));
	const abi = moduleAbiOf(file)!;
	expect(abi).toBe('0.2.0-rc.1+abi.254ad446');
	expect(abiLine(abi)).toBe(abiLine('0.2.3+abi.254ad446'));
	expect(abiLine(abi)).not.toBe(abiLine('0.3.0+abi.254ad446'));
	expect(abiLine(abi)).not.toBe(abiLine('0.2.0+abi.0f303e8b'));
	expect(moduleAbiOf(join(out, 'missing.dll'))).toBeNull();
});

test('an import is its line of the natives table: its name, its types, how its arguments cross', () => {
	const shapes = importShapes();
	expect(shapes.get('abort')).toBe('abort (iiii)');
	expect(shapes.get('add')).toStartWith('add (iiii)i ');
	expect(pluginAbi(['env.add', 'env.abort'])).toBe([abiIdentity(), shapes.get('abort'), shapes.get('add')].join('\n'));
});

test('within a line a released import keeps its shape, and is not taken away', () => {
	const lock = ['# a comment', '0.3.0', 'add (iiii)i s', 'ent_get (ii)i', ''].join('\n');
	const natives = ['# GENERATED', 'add (iiii)i s', 'ent_get (ii)i', 'ent_get2 (iii)i', ''].join('\n');
	expect(shapeChanges(lock, natives, '0.3.2')).toEqual([]);
	expect(shapeChanges(lock, natives.replace('add (iiii)i s', 'add (iiii)i s leaf'), '0.3.2')).toEqual(['add (iiii)i s']);
	expect(shapeChanges(lock, natives.replace('ent_get (ii)i\n', ''), '0.3.2')).toEqual(['ent_get (ii)i']);
	// Another line owes the lock nothing.
	expect(shapeChanges(lock, '', '0.4.0')).toEqual([]);

	// The core's own table keeps the lock of its line.
	if (existsSync(ABI_LOCK)) expect(shapeChanges(readFileSync(ABI_LOCK, 'utf8'), readFileSync('runtime/natives.txt', 'utf8'))).toEqual([]);
});

test('a plugin carries the ABI it is compiled against, into its .aot', async () => {
	const wasm = join(out, 'abi.wasm');
	expect(await compileWasmFile({ source: 'tests/as/player-api.ts', root: 'as' }, wasm)).toBeNull();
	const [identity, ...imports] = readSection(new Uint8Array(readFileSync(wasm)), ABI_SECTION)!.split('\n');
	expect(identity).toBe(abiIdentity());
	// The imports it uses, each as the natives table has it.
	const shapes = importShapes();
	expect(imports).toContain(shapes.get('ent_get')!);
	expect(imports.every(shape => shapes.get(shape.split(' ', 1)[0]) === shape)).toBe(true);
	expect(imports.length).toBeLessThan(shapes.size / 4);

	const wamrc = wamrcPath();
	if (!existsSync(wamrc)) return;
	const aot = join(out, 'abi.aot');
	const plugin = { source: 'tests/as/player-api.ts', output: aot, root: 'as', wamrc, signatures: 'runtime/natives.txt', quick: true };
	expect(await compilePlugin(plugin)).toBeNull();
	expect(readFileSync(aot).includes(`${ABI_SECTION}\0${abiIdentity()}\n`)).toBe(true);
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
