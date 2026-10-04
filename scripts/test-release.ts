// The published packages end to end, before a release: all nine published
// to an empty local registry by publish.ts's local mode, a project made from
// them with `npx create-amxts` - menu-core picked, so config-core comes as its
// requirement, and no server - type-checked, built and tested, and its build
// run on the server image of the release's Linux kit, in Docker.
//
//   bun run test:release [--wamrc <folder>] [--image <name>] [--skip-generate] [--keep]
//
// Nothing stale reaches it: the registry's storage, npm's and Bun's caches,
// npm's user config and global folder, HOME and the temporary folder are this
// run's own, in one folder of the system's temporary folder, and the registry
// listens on a free port - a registry of `bun run publish:local` is left as it
// is. The release's
// files are dist-release/ (or --wamrc): both systems' wamrc for the packages,
// and the Linux server kit the image is built with - `bun run release:linux
// --no-upload` makes it. --image takes an image built already (CI builds it
// with a cache).
//
// Whatever happens, the registry, the container and the folder are removed at
// the end; --keep leaves the folder.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { HOST_SYSTEM } from './system';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VERSION = String(JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).version);
/** create-amxts goes out as its own version, beside the core in ../amxts-cli. */
const CREATE_VERSION = String(JSON.parse(readFileSync(join(CORE, '../amxts-cli/packages/create-amxts/package.json'), 'utf8')).version);
const WINDOWS = process.platform === 'win32';
const args = process.argv.slice(2);

function option(name: string) {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
}

const RELEASE = resolve(option('--wamrc') ?? join(CORE, 'dist-release'));
const KIT = join(RELEASE, 'linux', 'amxts-server-linux-x64.tar.gz');
const IMAGE = option('--image');
const OWN_IMAGE = 'amxts-release-test';
/** The modules the project gets: menu-core, picked, and config-core, which it requires. */
const MODULES = ['menu-core', 'config-core'];
/** The plugins its build makes: the starter's own and the modules' owners. */
const PLUGINS = ['hello', ...MODULES];

/** How long the server may take to load the plugins. */
const START_TIMEOUT = 180_000;
/** Console lines that mean a plugin did not load or something crashed. */
const ERROR_LINE = /failed to load|resolve symbol|exception|\[amxts\] [^:\s]+: \w*Error:|run time error|plugin file open error|bad load|did not compile|cannot create exec env|init failed|did not load the host plugin/i;

class CheckError extends Error {}

const root = realpathSync(mkdtempSync(join(tmpdir(), 'amxts-release-test-')));
const work = join(root, 'work');
const project = join(work, 'my-server');
const container = basename(root).toLowerCase();
const timings: [string, number][] = [];

function freePort(): Promise<string> {
	return new Promise((done, reject) => {
		const server = createServer().once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as { port: number };
			server.close(() => done(String(port)));
		});
	});
}

const port = await freePort();
const registry = `http://localhost:${port}/`;

// What this run keeps to itself: the caches, npm's user config and global
// folder, HOME, the temporary folder. publish.ts gets the caches and the
// temporary folder (it clears the caches on --reset and compiles the modules
// in a project there), and its own dist-npm/ and port.
const temp = join(root, 'tmp');
const home = join(root, 'home');
for (const dir of [work, temp, home]) mkdirSync(dir, { recursive: true });
const caches = {
	npm_config_cache: join(root, 'npm-cache'),
	BUN_INSTALL_CACHE_DIR: join(root, 'bun-cache'),
	TMPDIR: temp,
	TMP: temp,
	TEMP: temp,
};
const publishEnv = { ...process.env, ...caches, AMXTS_NPM_DIR: join(root, 'dist-npm'), AMXTS_REGISTRY_PORT: port };
// The user's shell, without this checkout's settings - AMXTS_*, and the npm_*
// that `bun run` sets - and with the registry.
const userEnv: NodeJS.ProcessEnv = {
	...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:amxts_|npm_)/i.test(name))),
	...caches,
	HOME: home,
	USERPROFILE: home,
	npm_config_userconfig: join(home, '.npmrc'),
	// npx runs a package installed globally when its version fits - a create-amxts
	// linked from a checkout (`npm link`) - rather than the registry's.
	npm_config_prefix: join(root, 'npm-global'),
	NPM_CONFIG_REGISTRY: registry,
	// npx asks before it installs create-amxts: nobody is there to answer.
	npm_config_yes: 'true',
};

/** Runs a step, its output to the terminal; a failed one ends the run. */
function step(title: string, cwd: string, file: string, argv: string[], env: NodeJS.ProcessEnv) {
	console.log(`\n== ${title}\n   ${[file, ...argv].join(' ')}`);
	const started = performance.now();
	const result = spawnSync(file, argv, { cwd, env, stdio: 'inherit', shell: WINDOWS && !/[\\/]/.test(file) });
	timings.push([title, performance.now() - started]);
	if (result.status !== 0) throw new CheckError(`${title} (exit ${result.status ?? result.error?.message})`);
}

function docker(argv: string[]) {
	return spawnSync('docker', argv, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

/** Every file under node_modules but the build's cache, by its size, time and link. */
function snapshot(dir: string): Map<string, string> {
	const files = new Map<string, string>();
	for (const path of readdirSync(dir, { recursive: true }) as string[]) {
		if (/^\.cache(?:[\\/]|$)/.test(path)) continue;
		const full = join(dir, path);
		const link = lstatSync(full);
		if (link.isDirectory()) continue;
		files.set(path, link.isSymbolicLink() ? `-> ${readlinkSync(full)}` : `${link.size} ${statSync(full).mtimeMs}`);
	}
	return files;
}

function changes(before: Map<string, string>, after: Map<string, string>): string[] {
	const paths = new Set([...before.keys(), ...after.keys()]);
	return [...paths].filter(path => before.get(path) !== after.get(path)).map(path => (!after.has(path) ? `- ${path}` : !before.has(path) ? `+ ${path}` : `~ ${path}`));
}

/** The plugins a build wrote, each the module's own .aot where it is a module's. */
function buildProblems(system: string): (string | false)[] {
	const dist = join(project, 'dist');
	return [
		...PLUGINS.map(name => !existsSync(join(dist, `${name}.aot`)) && `no dist/${name}.aot`),
		...MODULES.map((name) => {
			const prebuilt = join(project, 'node_modules/@amxts', name, 'prebuilt', system, `${name}.aot`);
			const built = join(dist, `${name}.aot`);
			return !(existsSync(prebuilt) && existsSync(built) && readFileSync(prebuilt).equals(readFileSync(built))) && `dist/${name}.aot (${system}) is not the one @amxts/${name} came with: it was compiled again`;
		}),
	];
}

function fail(problems: (string | false)[]) {
	const found = problems.filter(Boolean);
	if (found.length) throw new CheckError(found.join('\n  '));
}

/** The image of the release's Linux kit, docker/server, as Publish builds it. */
function serverImage(): string {
	if (IMAGE) return IMAGE;
	if (!existsSync(KIT)) throw new CheckError(`${KIT} is missing: bun run release:linux --no-upload makes it`);
	const kit = join(root, 'kit');
	mkdirSync(kit);
	// Windows' own tar reads a .tar.gz; a GNU tar earlier on PATH takes C: for a host.
	const tar = WINDOWS ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar';
	step('the release\'s Linux server kit', root, tar, ['-xzf', KIT, '-C', kit], process.env);
	// SteamCMD and the releases: a few minutes the first time, Docker's cache after.
	step('the server image', CORE, 'docker', ['build', '--load', '--quiet', '-t', OWN_IMAGE, '--build-context', `kit=${kit}`, join(CORE, 'docker/server')], process.env);
	return OWN_IMAGE;
}

/** The server's console. */
function consoleLines(): string[] {
	const logs = docker(['logs', container]);
	return `${logs.stdout ?? ''}${logs.stderr ?? ''}`.replace(/\0/g, ' ').split(/\r?\n/);
}

/** A file of the server's game folder, or null. */
function serverFile(path: string): string | null {
	const read = docker(['exec', container, 'cat', `/hlds/cstrike/${path}`]);
	return read.status === 0 ? read.stdout : null;
}

const meaningful = (text: string | null) => (text ?? '').split(/\r?\n/).map(line => line.trim()).filter(line => line && !/^[;#/]/.test(line));

/**
 * The build on the server image, the project mounted at /project as `amxts
 * dev --docker` has it: the module loads, writes its host plugin out itself,
 * and loads the project's plugins and the modules' owners.
 */
async function runServer(image: string) {
	console.log(`\n== the server: ${image}, container ${container}`);
	const started = performance.now();
	const run = docker(['run', '-d', '--name', container, '-v', `${project}:/project`, image, '+mp_timelimit', '0']);
	if (run.status !== 0) throw new CheckError(`docker run failed: ${run.stderr.trim()}`);
	const loaded = (lines: string[]) => PLUGINS.every(name => lines.some(line => line.includes(`[amxts] loaded ${name}.aot`)));
	const running = () => docker(['container', 'inspect', '-f', '{{.State.Running}}', container]).stdout.trim() === 'true';
	for (const deadline = Date.now() + START_TIMEOUT; Date.now() < deadline && running() && !loaded(consoleLines());) {
		await new Promise(done => setTimeout(done, 1000));
	}
	// What a plugin says right after it loads, errors included.
	await new Promise(done => setTimeout(done, 3000));
	const lines = consoleLines();
	timings.push(['the server', performance.now() - started]);
	console.log(lines.filter(line => /amxts|error|fail/i.test(line)).map(line => `   | ${line}`).join('\n'));

	const modules = meaningful(serverFile('addons/amxmodx/configs/modules.ini'));
	const amxxPlugins = meaningful(serverFile('addons/amxmodx/configs/plugins.ini'));
	const hostList = meaningful(serverFile('addons/amxmodx/configs/plugins-amxts.ini'));
	const hosts = lines.filter(line => line.includes('[amxts] host native table')).length;
	const errors = lines.filter(line => ERROR_LINE.test(line));
	fail([
		!running() && 'the server exited',
		modules.filter(line => line === 'amxts_amxx').length !== 1 && `modules.ini should name amxts_amxx once: ${modules.join(', ')}`,
		amxxPlugins.some(line => line.includes('amxts_host')) && 'AMX Mod X\'s plugins.ini names the host plugin: the module loads it itself',
		!hostList.some(line => line.startsWith('amxts_host.amxx')) && 'the module did not write plugins-amxts.ini with its host plugin',
		serverFile('addons/amxmodx/plugins/amxts_host.amxx') === null && 'the module did not write amxts_host.amxx',
		hosts !== 1 && (hosts ? `the host plugin attached ${hosts} times` : 'the host plugin did not attach'),
		!lines.some(line => line.includes('[amxts] plugin list') && line.includes('addons/amxts/project/plugins.ini')) && 'the module did not take the project\'s plugin list',
		...PLUGINS.map(name => !lines.some(line => line.includes(`[amxts] loaded ${name}.aot`)) && `${name}.aot did not load`),
		errors.length > 0 && `errors in the console:\n    ${errors.join('\n    ')}`,
	]);
}

let cleaned = false;
/** Removes what this run made: the container, the registry, the folder. */
function cleanUp() {
	if (cleaned) return;
	cleaned = true;
	if (docker(['container', 'inspect', container]).status === 0) docker(['rm', '-f', container]);
	spawnSync(process.execPath, [join(CORE, 'scripts/publish.ts'), 'local', '--stop'], { cwd: CORE, env: publishEnv, stdio: 'ignore' });
	if (args.includes('--keep')) {
		console.log(`the folder stays: ${root}`);
		return;
	}
	// The registry lets go of its storage a moment after it is stopped.
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			rmSync(root, { recursive: true, force: true });
			return;
		} catch {
			spawnSync(process.execPath, ['-e', 'await Bun.sleep(500)']);
		}
	}
	console.log(`could not remove ${root}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		cleanUp();
		process.exit(130);
	});
}

async function main() {
	console.log(`the run's folder: ${root}\nthe registry: ${registry}`);
	if (docker(['version']).status !== 0) throw new CheckError('the server runs in Docker, and docker does not answer');
	const passOn = ['--wamrc', RELEASE, ...(args.includes('--skip-generate') ? ['--skip-generate'] : [])];

	// The server's image first: a missing kit stops the run before the packing.
	const image = serverImage();

	// 1. The nine packages, into an empty registry of this run's.
	step('the packages, into an empty local registry', CORE, process.execPath, [join(CORE, 'scripts/publish.ts'), 'local', '--reset', ...passOn], publishEnv);

	// 2. A project, as a user makes one: no server, menu-core.
	step('npx create-amxts', work, 'npx', [`create-amxts@${CREATE_VERSION}`, 'my-server', '--yes', '--pm', 'npm', '--modules', 'menu-core', '--no-git'], userEnv);
	const core = realpathSync(join(project, 'node_modules/@amxts/core'));
	const config = readFileSync(join(project, 'amxts.config.ts'), 'utf8');
	const wamrc = join(project, 'node_modules', `@amxts/wamrc-${process.platform}-${process.arch}`, WINDOWS ? 'wamrc.exe' : 'wamrc');
	fail([
		!core.startsWith(root) && `@amxts/core is ${core}, outside the project`,
		existsSync(join(core, '.git')) && '@amxts/core is a checkout',
		readJson(join(core, 'package.json')).version !== VERSION && `@amxts/core is not ${VERSION}`,
		!existsSync(wamrc) && `no ${wamrc}`,
		!existsSync(join(core, 'node_modules/assemblyscript/std/assembly.json')) && 'no bundled assemblyscript typings in @amxts/core',
		...MODULES.map(name => !config.includes(`@amxts/${name}`) && `amxts.config.ts does not list @amxts/${name}`),
		...MODULES.map(name => !existsSync(join(project, 'node_modules/@amxts', name, 'package.json')) && `@amxts/${name} is not installed`),
	]);
	const installed = snapshot(join(project, 'node_modules'));

	// 3. What a user runs next. The build first: what it analysed is its own.
	step('amxts typecheck', project, 'npx', ['amxts', 'typecheck'], userEnv);
	step('amxts build', project, 'npx', ['amxts', 'build'], userEnv);
	const analysis = join(project, 'node_modules/.cache/amxts/analysis');
	const analysed = existsSync(analysis) ? readdirSync(analysis).length : 0;
	fail([
		...buildProblems(HOST_SYSTEM),
		analysed > 0 && `the build analysed ${analysed} module(s) rather than take the surfaces they came with`,
	]);
	step('amxts test', project, 'npx', ['amxts', 'test'], userEnv);

	// 4. Its build on the Linux server.
	if (HOST_SYSTEM !== 'linux') {
		step('amxts build --os linux', project, 'npx', ['amxts', 'build', '--os', 'linux'], userEnv);
		fail(buildProblems('linux'));
	}
	fail([
		!existsSync(join(project, '.amxts/tsconfig.json')) && 'no .amxts/tsconfig.json',
		...changes(installed, snapshot(join(project, 'node_modules'))).slice(0, 20).map(change => `node_modules changed: ${change}`),
	]);
	await runServer(image);
}

function readJson(path: string) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

const started = performance.now();
let code = 0;
try {
	await main();
} catch (error) {
	process.stderr.write(`\nthe release test failed: ${error instanceof CheckError ? error.message : (error as Error).stack}\n`);
	code = 1;
} finally {
	cleanUp();
}
console.log('\n');
for (const [title, ms] of timings) console.log(`${(ms / 1000).toFixed(0).padStart(5)}s  ${title}`);
console.log(`${((performance.now() - started) / 1000).toFixed(0).padStart(5)}s  in all`);
console.log(code ? '\nFAIL' : `\nPASS: the packages of ${VERSION}, from npx create-amxts to the server`);
process.exit(code);
