// What the core offers the amxts command (@amxts/cli, its own repository):
// `@amxts/core/cli-api`, resolved as a project resolves it, and the bin a
// project's package manager links, which starts the command.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';

const require = createRequire(import.meta.url);
const CORE = dirname(require.resolve('@amxts/core/package.json'));

async function cliApi() {
	return import(pathToFileURL(require.resolve('@amxts/core/cli-api')).href);
}

test('the cli-api: the core\'s version, the contract\'s, where the core is', async () => {
	const api = await cliApi();
	expect(api.version).toBe(require('@amxts/core/package.json').version);
	expect(api.cliApi).toBe(5);
	expect(api.coreDir).toBe(CORE);
});

test('the tasks: the build scripts with Bun, the type check with Node', async () => {
	const api = await cliApi();
	for (const [name, script] of [['prepare', 'prepare.ts'], ['build', 'build-wasm.ts'], ['check', 'check.ts'], ['upgrade', 'upgrade.ts']]) {
		const task = api.task(name, ['--deploy']);
		expect(task.runtime).toBe('bun');
		expect(task.args).toEqual([join(CORE, 'scripts', 'run.ts'), script, '--deploy']);
		expect(existsSync(join(CORE, 'scripts', script))).toBe(true);
	}
	const typecheck = api.task('typecheck');
	expect(typecheck.runtime).toBe('node');
	expect(existsSync(typecheck.args[0])).toBe(true);
	expect(typecheck.args).toEqual([join(CORE, 'src', 'typecheck.mjs')]);
	expect(() => api.task('deploy')).toThrow('has no task "deploy"');
});

test('the official modules from this machine, TypeScript, the compilers', async () => {
	const api = await cliApi();
	expect(Object.keys(api.localModules()).sort()).toEqual(['@amxts/config-core', '@amxts/menu-core']);
	expect(api.typescript().createSourceFile).toBeFunction();
	const tools = api.toolchain();
	expect(tools.assemblyscript.version).toBe('0.28.20');
	expect(tools.wamr.version).toBe('2.4.5');
});

test('the includes the API is generated from: pinned releases with a sha256', async () => {
	const api = await cliApi();
	const sources = api.includeSources();
	expect(Object.keys(sources).sort()).toEqual(['reapi', 'resemiclip']);
	for (const source of Object.values<{ url: string; sha256: string; version: string }>(sources)) {
		expect(source.url).toStartWith('https://');
		expect(source.url).toContain(source.version);
		expect(source.sha256).toMatch(/^[0-9a-f]{64}$/);
	}
	expect(sources.reapi.include).toBe('addons/amxmodx/scripting/include/');
});

test('the Bun the tasks run on: the one installed with the core', async () => {
	const api = await cliApi();
	const binary = api.bunBinary();
	expect(binary).toBeString();
	const run = spawnSync(binary, ['--version'], { encoding: 'utf8' });
	expect(run.status).toBe(0);
	expect(run.stdout.trim()).toBe(require('bun/package.json').version);
});

test('the core\'s bin starts @amxts/cli', () => {
	const run = spawnSync(process.platform === 'win32' ? 'node.exe' : 'node', [join(CORE, 'bin', 'amxts.mjs'), '--version'], { encoding: 'utf8' });
	expect(run.status).toBe(0);
	expect(run.stdout.trim()).toBe(require('@amxts/cli/package.json').version);
});

test('the server\'s system: what a build compiles for, as `amxts info` shows it', async () => {
	const api = await cliApi();
	expect(api.serverSystem(['--os', 'linux'], {})).toEqual({ system: 'linux', from: 'flag' });
	expect(api.describeSystem(api.serverSystem(['--os', 'windows'], {}))).toBe('Windows (--os)');
});

test('the release a server takes: its files, where they go, and the image', async () => {
	const api = await cliApi();
	const release = api.release('windows');
	expect(release.url).toBe(process.env.AMXTS_RELEASE_URL || `https://github.com/amxts/amxts/releases/download/v${api.version}/`);
	expect(release.manifest).toBe('amxts-windows.json');
	expect(release.image).toBe(`ghcr.io/amxts/server:${api.version}`);
	// A server runs the module alone: it loads plugins built elsewhere.
	expect(release.files).toEqual([{ asset: 'amxts_amxx.dll', path: 'addons/amxmodx/modules/amxts_amxx.dll', tool: false }]);
	expect(api.release('linux').files.map((file: { asset: string }) => file.asset)).toEqual(['amxts_amxx_i386.so']);
});

test('the release a module is of, read from the ABI string it carries', async () => {
	const api = await cliApi();
	const dir = mkdtempSync(join(tmpdir(), 'amxts-module-'));
	try {
		const file = join(dir, 'amxts_amxx.dll');
		writeFileSync(file, Buffer.concat([Buffer.from([0x4D, 0x5A, 0, 0xFF]), Buffer.from('0.1.0+1290ba0540\0'), Buffer.from('0.2.0-rc.1+abi.254ad446\0')]));
		expect(api.moduleVersion(file)).toBe('0.2.0-rc.1');
		writeFileSync(file, 'no amxts here');
		expect(api.moduleVersion(file)).toBeNull();
		expect(api.moduleVersion(join(dir, 'missing.dll'))).toBeNull();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
