// Which system a server runs, and what a build compiles for: src/system.mjs.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { afterAll, expect, test } from 'bun:test';
import { apiFiles } from '../scripts/system';
import { describeSystem, detectServerSystem, HOST_SYSTEM, parseSystem, serverFolder, serverSystem, TARGET_ABI } from '../src/system.mjs';

const root = join(tmpdir(), 'amxts-system-test');
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** An install with these files, and its addons/amxts - what AMXTS_SERVER points at. */
function install(name: string, files: string[]): string {
	const dir = join(root, name);
	rmSync(dir, { recursive: true, force: true });
	for (const file of files) {
		mkdirSync(join(dir, file, '..'), { recursive: true });
		writeFileSync(join(dir, file), '');
	}
	mkdirSync(join(dir, 'cstrike/addons/amxts'), { recursive: true });
	return join(dir, 'cstrike/addons/amxts');
}

test('the system is read off the server: hlds_linux, hlds.exe, else its modules', () => {
	expect(detectServerSystem(install('linux', ['hlds_linux']))).toEqual({ system: 'linux', reason: 'hlds_linux' });
	expect(detectServerSystem(install('windows', ['hlds.exe']))).toEqual({ system: 'windows', reason: 'hlds.exe' });
	expect(detectServerSystem(install('share', ['cstrike/addons/amxmodx/modules/reapi_amxx_i386.so']))?.system).toBe('linux');
	expect(detectServerSystem(install('share-win', ['cstrike/addons/amxmodx/dlls/amxmodx_mm.dll']))?.system).toBe('windows');
	expect(detectServerSystem(install('empty', []))).toBeNull();
	expect(detectServerSystem('')).toBeNull();
});

test('--os first, then AMXTS_SERVER_OS, then the server, then this machine', () => {
	const linux = install('order', ['hlds_linux']);
	expect(serverSystem(['--os', 'windows'], { AMXTS_SERVER: linux })).toEqual({ system: 'windows', from: 'flag' });
	expect(serverSystem(['--os=linux'], {})).toEqual({ system: 'linux', from: 'flag' });
	expect(serverSystem([], { AMXTS_SERVER_OS: 'Windows', AMXTS_SERVER: linux })).toEqual({ system: 'windows', from: 'env' });
	expect(serverSystem([], { AMXTS_SERVER: linux })).toEqual({ system: 'linux', from: 'server', reason: 'hlds_linux' });
	expect(serverSystem([], {})).toEqual({ system: HOST_SYSTEM, from: 'host' });
	expect(() => serverSystem(['--os', 'mac'], {})).toThrow('windows or linux');
	expect(() => serverSystem([], { AMXTS_SERVER_OS: 'bsd' })).toThrow('windows or linux');
});

test('AMXTS_SERVER is the server\'s addons/amxts, or the hlds folder, cstrike or cstrike/addons above it', () => {
	const amxts = install('folders', ['hlds_linux']);
	const hlds = join(amxts, '..', '..', '..');
	for (const given of [amxts, hlds, join(hlds, 'cstrike'), join(hlds, 'cstrike', 'addons')]) expect(serverFolder(given)).toBe(amxts);
	expect(serverSystem([], { AMXTS_SERVER: hlds })).toEqual({ system: 'linux', from: 'server', reason: 'hlds_linux' });

	// Not there yet: taken as it is, and dev deploys once it is.
	expect(serverFolder(join(root, 'later', 'cstrike', 'addons', 'amxts'))).toBe(join(root, 'later', 'cstrike', 'addons', 'amxts'));
	expect(serverFolder('')).toBe('');

	// There, and no server: one error naming where it looked.
	const stray = join(root, 'stray');
	mkdirSync(stray, { recursive: true });
	const shown = stray.replace(/\\/g, '/');
	expect(() => serverFolder(stray)).toThrow(`AMXTS_SERVER=${shown} is not a server: there is no ${shown}/cstrike/addons`);
});

test('how it is said, and what wamrc is told', () => {
	expect(describeSystem({ system: 'linux', from: 'server', reason: 'hlds_linux' })).toBe('Linux (hlds_linux)');
	expect(describeSystem({ system: 'windows', from: 'flag' })).toBe('Windows (--os)');
	expect(parseSystem('win32')).toBe('windows');
	expect(parseSystem('LINUX')).toBe('linux');
	expect(parseSystem('')).toBeNull();
	// COFF for Windows, ELF for Linux: the loaders take nothing else.
	expect(TARGET_ABI).toEqual({ windows: 'msvc', linux: 'gnu' });
});

test('a server kit carries what the facade references and the promise typings, beside the API', () => {
	const references = [...readFileSync('as/facade.ts', 'utf8').matchAll(/^\/\/\/ <reference path="\.\/(.+)" \/>/gm)].map(match => match[1]);

	expect(references).toEqual(['amxts.d.ts']);
	expect(apiFiles()).toEqual(expect.arrayContaining([...references, 'promise.types.d.ts', 'facade.ts', 'natives.ts']));
});

/** runtime/src/embedded.h read back: each file the module writes out, by its path under addons/amxts. */
function embedded(): Map<string, { text: string; keep: boolean }> {
	const header = readFileSync('runtime/src/embedded.h', 'utf8');
	const unescape = (literal: string) => literal.replace(/\\(.)/g, (_, char: string) => (char === 'n' ? '\n' : char));
	const arrays = new Map([...header.matchAll(/static const char \*const (\w+)\[\] = \{\n([\s\S]*?)\n\};/g)]
		.map(([, name, body]) => [name, [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(([, piece]) => unescape(piece)).join('')]));
	return new Map([...header.matchAll(/\{ "([^"]+)", (\w+), .*, ([01]) \},/g)]
		.map(([, path, name, keep]) => [path, { text: arrays.get(name) ?? '', keep: keep === '1' }]));
}

test('a server start writes the whole API as it is, the editor\'s files and the example', () => {
	const files = embedded();
	const api = readdirSync('as').filter(name => name.endsWith('.ts'));

	for (const file of api) expect({ file, text: files.get(`plugins/${file}`)?.text }).toEqual({ file, text: readFileSync(`as/${file}`, 'utf8').replace(/\r/g, '') });
	expect(files.get('tools/natives.txt')?.text).toBe(readFileSync('runtime/natives.txt', 'utf8').replace(/\r/g, ''));
	expect(files.get('plugins/imports.d.ts')?.text).toContain('export import server = __0.server;');

	// With auto-imports every plugin is a module, and `~/` is the plugins folder.
	const tsconfig = JSON.parse(files.get('plugins/tsconfig.json')?.text ?? '{}');
	expect(tsconfig.compilerOptions?.moduleDetection).toBe('force');
	expect(tsconfig.compilerOptions?.paths['~/*']).toEqual(['./*']);
	// The core's API by the package's name, its files beside the plugins: only the entries it exports.
	expect(tsconfig.compilerOptions?.paths['@amxts/core/natives']).toEqual(['./natives.ts']);
	expect(tsconfig.compilerOptions?.paths['@amxts/core/os']).toEqual(['./os.ts']);
	expect(tsconfig.compilerOptions?.paths['@amxts/core/*']).toBeUndefined();

	expect([...files].filter(([, file]) => file.keep).map(([path]) => path).sort()).toEqual(['plugins.ini', 'plugins/hello.ts']);
});
