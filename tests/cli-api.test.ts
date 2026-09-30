// What the core offers the amxts command (@amxts/cli, its own repository):
// `@amxts/core/cli-api`, resolved as a project resolves it, and the bin a
// project's package manager links, which starts the command.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
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
	expect(api.cliApi).toBe(3);
	expect(api.coreDir).toBe(CORE);
});

test('the tasks: the build scripts with Bun, the type check with Node', async () => {
	const api = await cliApi();
	for (const [name, script] of [['prepare', 'prepare.ts'], ['build', 'build-wasm.ts'], ['check', 'check.ts']]) {
		const task = api.task(name, ['--deploy']);
		expect(task.runtime).toBe('bun');
		expect(task.args).toEqual([join(CORE, 'scripts', 'run.ts'), script, '--deploy']);
		expect(existsSync(join(CORE, 'scripts', script))).toBe(true);
	}
	const typecheck = api.task('typecheck');
	expect(typecheck.runtime).toBe('node');
	expect(existsSync(typecheck.args[0])).toBe(true);
	expect(typecheck.args.slice(1)).toEqual(['--noEmit', '-p', '.amxts/tsconfig.json']);
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
	expect(Object.keys(sources).sort()).toEqual(['easy_http', 'reapi', 'resemiclip']);
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
