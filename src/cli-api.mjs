// What the amxts command asks of the core: `@amxts/core/cli-api`.
//
// The command is its own package, @amxts/cli. It finds the core a project
// installed and imports this file - never a path inside the core - so the
// core can move its scripts without breaking it.
// Plain JavaScript: the command runs on Node, and so does this file; the
// core's TypeScript runs as a task the command starts.
//
//   const core = await import('@amxts/core/cli-api');
//   core.cliApi              6 - the contract below; the command checks it
//   core.task('build', ['--deploy'])   { runtime: 'node', args: [...] }
//   core.includeSources().reapi        the ReAPI release the API is built from
//   core.serverSystem([], env)         { system: 'linux', from: 'server', reason: 'hlds_linux' }
//   core.release('windows')            where this version's server files are, and where they go
//   core.moduleVersion(file)           '0.2.0': the release a server's module is of
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { manifestName, serverFiles, serverImage, wamrcPath } from './system.mjs';

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
export const cliApi = 6;

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

/** The scripts a task runs, each through scripts/run.ts. */
const SCRIPTS = {
	prepare: 'prepare.ts',
	build: 'build-wasm.ts',
	check: 'check.ts',
	upgrade: 'upgrade.ts',
};

/**
 * @typedef {object} Task
 * @property {'node'} runtime what runs it: the Node the command runs on
 * @property {string[]} args its arguments - Node's flags, then the script; the project is the current folder
 */

/**
 * How to run one of the core's tasks in the current folder:
 *
 * - `prepare` writes .amxts/tsconfig.json;
 * - `build` builds the plugins and the modules (`--deploy`, `--watch`, and
 *   `--docker`: for the Docker server that mounts the project - no deploy,
 *   Linux only, its console shown);
 * - `check` checks a module package before it is published;
 * - `upgrade` rewrites the project's code to this core's API, listing each change;
 *   `--dry-run` writes nothing, `--report <file>` writes `{ changes, left }` there as JSON
 *   and leaves what is left to do by hand to the caller to print;
 * - `typecheck` runs TypeScript over the project, after `prepare`, and says
 *   what TypeScript allows and the build does not (src/typecheck.mjs).
 *
 * A failure is printed by the task itself and ends it with a non-zero code.
 *
 * @param {string} name
 * @param {string[]} [args]
 * @returns {Task} what runs it, and its arguments
 */
export function task(name, args = []) {
	if (name === 'typecheck') {
		return { runtime: 'node', args: [join(coreDir, 'src', 'typecheck.mjs'), ...args] };
	}
	const script = SCRIPTS[name];
	if (!script) throw new Error(`@amxts/core ${version} has no task "${name}"`);
	// On Node, with the hook that loads the core's TypeScript and the
	// project's .env (Node does not read it on its own): V8 runs Binaryen's
	// wasm faster than Bun, in less memory, and a dev that runs for hours
	// keeps less of what its compiles grew.
	return { runtime: 'node', args: ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning', '--import', pathToFileURL(join(coreDir, 'scripts', 'node-ts.mjs')).href, join(coreDir, 'scripts', 'run.ts'), script, ...args] };
}

/**
 * The third-party includes this core's API is generated from, as
 * includes/sources.json pins them, by id: `reapi`, `resemiclip`,
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
 * The system of the server a build compiles for - Windows or Linux - and how
 * that was decided: `--os` in `argv`, AMXTS_SERVER_OS, what the AMXTS_SERVER
 * folder holds (hlds_linux or hlds.exe, else its modules), this machine's.
 * `describeSystem` writes it as the build reports it: "Linux (hlds_linux)".
 */
export { describeSystem, serverSystem } from './system.mjs';

/**
 * This version's GitHub Release, for a server of one system: `url` is where
 * its files are (AMXTS_RELEASE_URL - a URL or a folder - takes another),
 * `manifest` the file there that lists each one's sha256, `files` the ones a
 * server runs and where they go under its game folder (cstrike), the module
 * first; a `tool` only where the server has one. `image` is the server image
 * of this version, for a server in Docker.
 *
 * @param {'windows' | 'linux'} system
 */
export function release(system) {
	return {
		version,
		url: process.env.AMXTS_RELEASE_URL || `https://github.com/amxts/amxts/releases/download/v${version}/`,
		manifest: manifestName(system),
		files: serverFiles(system),
		image: serverImage(version),
	};
}

/**
 * The release a module file is of - `0.2.0`, read from the ABI string the
 * module carries, without loading it - or null when there is no file or it
 * carries none.
 */
export { moduleVersion } from './system.mjs';

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
