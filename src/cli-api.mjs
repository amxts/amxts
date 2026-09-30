// What the amxts command asks of the core: `@amxts/core/cli-api`.
//
// The command is its own package, @amxts/cli. It finds the core a project
// installed and imports this file - never a path inside the core - so the
// core can move its scripts without breaking it.
// Plain JavaScript: the command runs on Node, and so does this file; what
// compiles runs on Bun, as a task the command starts.
//
//   const core = await import('@amxts/core/cli-api');
//   core.cliApi              3 - the contract below; the command checks it
//   core.task('build', ['--deploy'])   { runtime: 'bun', args: [...] }
//   core.includeSources().reapi        the ReAPI release the API is built from
//   core.bunBinary()                   the Bun the tasks run on, installed with the core
//   core.serverSystem([], env)         { system: 'linux', from: 'server', reason: 'hlds_linux' }
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { wamrcPath } from './system.mjs';

/** The core's folder: the package this file ships in. */
export const coreDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(readFileSync(join(coreDir, 'package.json'), 'utf8'));

/** The core's version. */
export const version = String(pkg.version);

/**
 * The version of this contract. It goes up when a task, an export or what one
 * returns changes in a way an older command would misread; the command says
 * which of the two to update when they differ.
 */
export const cliApi = 3;

/** Whether the core runs from a checkout (a .git folder beside it) rather than from npm. */
export const fromSource = existsSync(join(coreDir, '.git'));

const require = createRequire(import.meta.url);

/**
 * The official modules this core is developed with, from folders on this
 * machine: its package.json's `file:` links, by package name. Until the
 * modules are on npm, `--local` takes them from here.
 *
 * @returns {Record<string, string>} the package's name and its folder
 */
export function localModules() {
	const deps = { ...pkg.dependencies, ...pkg.devDependencies };
	const found = {};
	for (const [name, spec] of Object.entries(deps)) {
		if (typeof spec !== 'string' || !spec.startsWith('file:') || !name.startsWith('@amxts/')) continue;
		const dir = resolve(coreDir, spec.slice(5));
		if (existsSync(join(dir, 'package.json')) && JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).amxts?.module) found[name] = dir;
	}
	return found;
}

/** The scripts a task runs, each with Bun through scripts/run.ts. */
const SCRIPTS = {
	prepare: 'prepare.ts',
	build: 'build-wasm.ts',
	check: 'check.ts',
};

/**
 * @typedef {object} Task
 * @property {'bun' | 'node'} runtime what runs it
 * @property {string[]} args its arguments, the script first; the project is the current folder
 */

/**
 * How to run one of the core's tasks in the current folder:
 *
 * - `prepare` writes .amxts/tsconfig.json;
 * - `build` builds the plugins and the modules (`--deploy`, `--watch`, and
 *   `--docker`: for the Docker server that mounts the project - no deploy,
 *   Linux only, its console shown);
 * - `check` checks a module package before it is published;
 * - `typecheck` runs TypeScript over the project, after `prepare`.
 *
 * A failure is printed by the task itself and ends it with a non-zero code.
 *
 * @param {string} name
 * @param {string[]} [args]
 * @returns {Task} what runs it, and its arguments
 */
export function task(name, args = []) {
	if (name === 'typecheck') {
		return { runtime: 'node', args: [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', '.amxts/tsconfig.json', ...args] };
	}
	const script = SCRIPTS[name];
	if (!script) throw new Error(`@amxts/core ${version} has no task "${name}"`);
	return { runtime: 'bun', args: [join(coreDir, 'scripts', 'run.ts'), script, ...args] };
}

/**
 * The third-party includes this core's API is generated from, as
 * includes/sources.json pins them, by id: `reapi`, `easy_http`, `resemiclip`,
 * each `{ name, version, license, home, url, sha256, include? }` - `url` gives
 * a file whose sha256 is `sha256`; for a .zip, `include` is the folder in it
 * whose .inc files are the includes. The command fetches ReAPI's for a
 * project without a server by these.
 *
 * @returns {Record<string, { name: string, version: string, license: string, home: string, url: string, sha256: string, include?: string }>} the sources
 */
export function includeSources() {
	return JSON.parse(readFileSync(join(coreDir, 'includes', 'sources.json'), 'utf8'));
}

/**
 * The Bun a `bun` task runs on: the binary of the `bun` package the core
 * depends on, so a project needs no Bun of its own. It is looked for in the
 * platform package (`@oven/bun-<os>-<arch>`), which every package manager
 * installs as an optional dependency without running a script, then where
 * `bun`'s own postinstall puts it (`bun/bin/bun.exe`, a placeholder until
 * then). Null when neither is there - the command then takes a Bun on PATH.
 *
 * @returns {string | null} the binary's path
 */
export function bunBinary() {
	let bunDir;
	try {
		bunDir = dirname(require.resolve('bun/package.json'));
	} catch {
		return null;
	}
	const from = createRequire(join(bunDir, 'package.json'));
	const os = process.platform === 'win32' ? 'windows' : process.platform;
	const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
	// On musl (Alpine) only the -musl build runs; a package manager that does
	// not read `libc` may have installed the glibc one beside it.
	const musl = process.platform === 'linux' && !process.report?.getReport?.().header?.glibcVersionRuntime;
	const exe = process.platform === 'win32' ? 'bun.exe' : 'bun';
	try {
		const binary = join(dirname(from.resolve(`@oven/bun-${os}-${arch}${musl ? '-musl' : ''}/package.json`)), 'bin', exe);
		if (existsSync(binary)) return binary;
	} catch {}
	// The placeholder is a few hundred bytes; the binary is tens of megabytes.
	const placed = join(bunDir, 'bin', 'bun.exe');
	return existsSync(placed) && statSync(placed).size > 1_000_000 ? placed : null;
}

/**
 * The system of the server a build compiles for - Windows or Linux - and how
 * that was decided: `--os` in `argv`, AMXTS_SERVER_OS, what the AMXTS_SERVER
 * folder holds (hlds_linux or hlds.exe, else its modules), this machine's.
 * `describeSystem` writes it as the build reports it: "Linux (hlds_linux)".
 */
export { describeSystem, serverSystem } from './system.mjs';

/** The TypeScript the core builds with: the command reads amxts.config.ts with its parser. */
export function typescript() {
	return require('typescript');
}

/**
 * The patched compilers the build runs: the version each patch is for, and
 * whether its build is there.
 */
export function toolchain() {
	const patches = existsSync(join(coreDir, 'runtime', 'patches')) ? readdirSync(join(coreDir, 'runtime', 'patches')) : [];
	const patched = name => patches.map(file => file.match(new RegExp(`^${name}-(.+)-amxts\\.patch$`))?.[1]).find(Boolean) ?? null;
	return {
		assemblyscript: {
			version: patched('assemblyscript'),
			built: existsSync(process.env.AMXTS_ASC ?? join(coreDir, 'runtime/deps/assemblyscript/bin/asc.js')),
		},
		wamr: {
			version: patched('wamr'),
			wamrc: existsSync(wamrcPath()),
		},
	};
}
