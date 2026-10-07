// Runs the plugin API's server checks on a real HLDS, with nobody in the game.
//
//   bun run test:server            build, run every suite, stop, clean up
//   bun run test:server --keep     leave the test server running afterwards
//   bun run test:server --stop     stop a server left by --keep and clean up
//   bun run test:server --linux    the same suites on a Linux server, in Docker
//   bun run test:server --plain    the same on Linux without ReHLDS, ReGameDLL, ReAPI
//   bun run test:server --linux --amxx 1.9.0-git5303   on another AMX Mod X build
//   bun run test:server --linux --sanitize   the module under AddressSanitizer and UBSan
//   bun run test:server --full     the suites compiled fully, as `amxts build` does
//   bun run test:server --only cvar,player   only these suites
//   bun run test:server --no-reapi   the server without ReAPI: ReHLDS and ReGameDLL alone
//   bun run test:server --build-only   build the suites, start no server
//   bun run test:server --prebuilt     run the suites --build-only left, building nothing
//
// It runs the suites of the project in the current folder, as the build does
// (scripts/project.ts): the core's own in tests/server, a project's in
// test/server (`bun node_modules/@amxts/core/scripts/test-server.ts` there).
// Beside the suites the server loads the modules amxts.config.ts lists, as
// their owners, and the project's own plugins - the plugins its suites check.
//
// The suites are <suites>/*.ts (amxts plugins) and <suites>/*.sma
// (Pawn plugins). Each registers a server command `amxts_test_<name>`, which
// this sends over rcon; its checks log `[<name>] ok ...` / `[<name>] FAIL ...`
// and end with `[<name>] N ok, M failed` - as `Checks` from @amxts/core/check does.
// `<name>` is the command's tail with `_` written `-`: amxts_test_config_core
// logs as [config-core]. A line `// @log <text>` in a suite is text the
// server's console must show while that suite runs, as it is - how a check
// sees what reached the console, and how an error line a suite causes on
// purpose is told from a real one. A line `// @log-dev <text>` is one for a
// quick run alone: what only a dev build's stack frames show. A plugin
// with a line `// @unlisted` lies in plugins/ but not in the plugin list, for
// a suite to start with amxts_load.
//
// The module under test is runtime/build's (AMXTS_TEST_MODULE names another).
// One that would refuse the run's plugins - built before the version's line
// or the hood moved on - is built again first, with a line saying so
// (freshModule), and so is one older than a file of runtime/src or
// runtime/CMakeLists.txt.
//
// The suites compile as `amxts dev` compiles them, about twice as fast - but
// perf.ts, which measures speed, and every suite in CI or with --full, which
// compile as `amxts build` does. A compile is kept in the project's plugin
// cache (scripts/plugin-cache.ts) and taken again while nothing it read has
// changed: a second run, or one after a change to the module's C++ alone,
// compiles nothing.
//
// --build-only builds the suites into the build folder and stops; --prebuilt
// takes them from there as they are and builds nothing, the module included:
// CI builds them once and runs them on every server.
//
// --only <suite>[,<suite>...] builds, loads and checks only the files that
// hold those suites, beside the plugins every run loads and the files that
// hold no suite (exports.ts, which a Pawn suite includes). A suite that reads
// what an earlier one left (data-read after data-write) needs it named too.
//
// The plugins compile several at once, as a build compiles them
// (scripts/compile-pool.ts): AMXTS_BUILD_JOBS or AMXTS_BUILD_MEMORY says how
// many.
//
// It never touches the server that owns the install, which may be running
// with people on it:
//
// - A second hlds from the same install, on its own port (27016, or
//   AMXTS_TEST_PORT / --port), bound to 127.0.0.1, with a random rcon password
//   and a server.cfg of its own (`+servercfgfile`).
// - AMX Mod X reads its paths from core.ini when it attaches, which is after
//   the command line has run, so a `+localinfo amxx_plugins` alone is undone.
//   `+localinfo amxx_cfg` points it at a core.ini of the test's, and that one
//   moves the plugin list, the plugins, the modules, the configs and the logs
//   into the test folder. The modules are copies, with amxts_amxx.dll from
//   runtime/build: the one being tested, while the server's own stays loaded
//   and locked where it is.
// - The amxts module takes its list from `+localinfo amxts_plugins` (module.cpp),
//   and with a list of its own it does not lay out addons/amxts either.
// - hlds writes -condebug's qconsole.log into its working folder, where the
//   running server writes its own. So the test server works from a folder of
//   its own - amxts-test beside hlds.exe - holding junctions to cstrike, valve
//   and platform: hlds finds the game where it expects it, and the log it
//   writes is the test's. Started from any other folder, hlds stops at a
//   modal "couldn't load gfx.wad".
// - It is stopped by its process id, never by name.
//
// Everything the test writes is under cstrike/addons/amxts/test and amxts-test,
// and both are removed at the end unless --keep is given.
//
// With --linux the server is a container of the amxts-hlds image
// (docker/hlds/Dockerfile, built on first use): the same suites, compiled for
// Linux, with runtime/build/linux's module (bun run build:linux). Nothing is
// shared with it - the project's game files (PROJECT_GAME_FOLDERS), then the
// test's folder and the module are copied into the container before it
// starts, its console is `docker logs`, and it is
// removed at the end. AMXTS_SERVER is not needed; the map is de_dust2.
// --amxx <build> runs it on another AMX Mod X: the image amxts-hlds:<build>,
// built from docker/hlds with that build's packages - one listed, with their
// sha256, in docker/hlds/amxmodx.sha256.
// --plain is --linux on the amxts-hlds-plain image (docker/hlds-plain):
// Valve's HLDS with metamod-p and AMX Mod X's stock modules, no reapi. Its
// container, its build folder and its port (27017) are its own, so it runs
// beside a --linux one.
// --sanitize is --linux with the module of `bun run build:linux --sanitize`:
// hlds starts with the sanitizers' runtime preloaded (hlds_linux itself is not
// built with it), and a sanitizer's report in the console fails the run.
// A Linux server starts with core dumps on: when it exits on its own, the
// report says how and prints its core dump's backtrace (scripts/core-dumps.ts),
// kept with the console in last-run.
import type { Plugin } from './compile';
import { spawnSync } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { ABI_SECTION, abiIdentity, abiLine, releaseLine } from './build-identity';
import { compileAll } from './compile-pool';
import { coreDumpArgs, crashReport } from './core-dumps';
import { includeDirs } from './includes';
import { pluginCache } from './plugin-cache';
import { CORE_DIR, CORE_PLUGINS, loadProject, PROJECT_GAME_FOLDERS, projectPlugins, sourcesFor } from './project';
import { amxxpcPath, MODULE_FILE, moduleAbiOf, modulePath, serverFolder, wamrcPath } from './system';
import { testProgress } from './test-progress';

// See build-wasm.ts: asc brings a console without error().
function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const stopOnly = args.includes('--stop');
const plain = args.includes('--plain');
const sanitize = args.includes('--sanitize');
const linux = plain || sanitize || args.includes('--linux');
/** Whether the server runs without ReAPI: ReHLDS and ReGameDLL still there, the module hooking their chains itself. */
const noReapi = args.includes('--no-reapi');
const buildOnly = args.includes('--build-only');
const prebuilt = args.includes('--prebuilt');
/** Whether the suites compile as `amxts dev` compiles them: locally, unless --full says otherwise. */
const quick = !args.includes('--full') && !process.env.CI;
/** The suites that compile fully either way: the speed check measures the full build. */
const FULL = new Set(['perf.ts']);
const portArg = args.indexOf('--port');
const onlyArg = args.indexOf('--only');
const amxxArg = args.indexOf('--amxx');
/** The AMX Mod X build --amxx names; none for the image's own. */
const AMXX = amxxArg >= 0 ? args[amxxArg + 1] ?? '' : '';
/** The suites --only names; none for every suite. */
const ONLY = onlyArg >= 0 ? (args[onlyArg + 1] ?? '').split(',').map(name => name.trim()).filter(Boolean) : [];
const PORT = Number(portArg >= 0 ? args[portArg + 1] : process.env.AMXTS_TEST_PORT ?? (plain ? 27017 : 27016));
const MAP = process.env.AMXTS_TEST_MAP ?? (linux ? 'de_dust2' : 'c21_kitty');

// The builds docker/hlds can take: amxmodx-<build>-base-linux.tar.gz in its
// list of sha256.
if (amxxArg >= 0) {
	const builds = [...readFileSync(join(CORE_DIR, 'docker/hlds/amxmodx.sha256'), 'utf-8').matchAll(/amxmodx-(\S+)-base-linux\.tar\.gz$/gm)].map(m => m[1]);
	const problem = !linux || plain
		? '--amxx picks the AMX Mod X of the --linux server'
		: builds.includes(AMXX) ? '' : `--amxx: ${AMXX || 'no build'} is not in docker/hlds/amxmodx.sha256 (${builds.join(', ')})`;
	if (problem) {
		fail(problem);
		process.exit(1);
	}
}

// The server's addons/amxts, or a folder above it (src/system.mjs).
let amxtsDir = '';
try {
	amxtsDir = serverFolder(process.env.AMXTS_SERVER ?? '');
} catch (error) {
	fail((error as Error).message);
	process.exit(1);
}
if (!amxtsDir && !linux) {
	fail('AMXTS_SERVER is not set: point it at the amxts folder of the server install, as for bun run dev.');
	process.exit(1);
}

// AMXTS_SERVER is <hlds>/<game>/addons/amxts.
const gameDir = resolve(amxtsDir, '..', '..');
const hldsDir = dirname(gameDir);
const game = basename(gameDir);
const hlds = join(hldsDir, 'hlds.exe');

// The test folder as the game sees it - localinfo paths are relative to the
// game folder - and as this script does.
const TEST = 'addons/amxts/test';

const project = loadProject(process.cwd());
if (project.problems.length) {
	fail(project.problems.join('\n'));
	process.exit(1);
}

// The core's own suites are in tests/server, a project's in test/server.
const suitesDir = ['test/server', 'tests/server'].map(dir => join(project.dir, dir)).find(dir => existsSync(dir)) ?? join(project.dir, 'test/server');
// A Linux .aot is another file than a Windows one (scripts/system.ts).
const buildDir = join(project.outDir, plain ? 'test-server-plain' : linux ? 'test-server-linux' : 'test-server');

// Where the test's folder is made. On Windows: in the install, beside the
// server's own. For Linux: in the build folder, as addons/amxts/test of a
// tree copied into the container's game folder.
const rootDir = linux ? join(buildDir, 'stage') : join(hldsDir, 'amxts-test');
const testDir = linux ? join(rootDir, 'amxts', 'test') : join(gameDir, TEST);
const pidFile = join(rootDir, 'hlds.pid');
// Where the Linux server's core dump goes, mounted at /cores (scripts/core-dumps.ts).
const coresDir = join(rootDir, 'cores');
// What says a folder is this script's to delete.
const MARKER = '.amxts-test';

const amxxpc = amxxpcPath();
const wamrc = wamrcPath();
const signatures = process.env.AMXTS_NATIVES ?? join(CORE_DIR, 'runtime/natives.txt');
// AMXTS_TEST_MODULE: another build of the module, e.g. one made beside a running test.
const sanitizedDir = join(CORE_DIR, 'runtime/build/linux-sanitize');
const moduleDll = process.env.AMXTS_TEST_MODULE ?? (sanitize ? join(sanitizedDir, MODULE_FILE.linux) : modulePath(linux ? 'linux' : 'windows'));

// Plugins a suite needs beside the suites themselves: the modules
// amxts.config.ts lists, as their owners, in load order, then the project's
// own plugins.
const modulesSources = sourcesFor(CORE_PLUGINS);
const EXTRA_PLUGINS = [...project.modules.map(pkg => modulesSources.ownerSource(pkg)), ...projectPlugins(project)];

// What modules read from the configs folder, which the test server has moved:
// copies of the server's.
const CONFIGS_READ = ['hamdata.ini'];

// The core's network suite (tests/server/fetch.ts) talks to a web server of
// the runner's own, tests/http-server.ts, started when the suite is there: on
// this machine's loopback, or for a container on the address Docker gives
// this machine there, host.docker.internal (Docker Desktop forwards it to the
// loopback; on Linux it is the bridge, so every interface listens).
let web: { http: string; https: string; stop: () => void } | null = null;

/** Where the runner's servers listen and what a suite calls them, for startTestHttp, startTestFtp and startTestSftp. */
const HOST_ADDRESSES: [string, string] = !linux ? ['127.0.0.1', '127.0.0.1'] : [process.platform === 'win32' ? '127.0.0.1' : '0.0.0.0', 'host.docker.internal'];

async function startWeb(suites: Suite[]): Promise<void> {
	await startFtp(suites);
	const file = join(CORE_DIR, 'tests/http-server.ts');
	if (!suites.some(suite => suite.name === 'fetch') || !existsSync(file)) return;
	const { startTestHttp } = await import(file);
	web = startTestHttp(...HOST_ADDRESSES);
}

// The kit's request suite (tests/server/net-request.ts) talks to an FTP and
// an SFTP server of the runner's own, tests/ftp-servers.ts, on this machine's
// loopback, or for a container on host.docker.internal as the web server;
// its SSH key goes into the test's configs folder. curl opens FTP's passive
// connections to the control connection's host, so no address is announced.
let ftpServers: { ftp: { url: string; stop: () => Promise<void> }; sftp: { url: string; hostKey: string; privateKey: string; stop: () => Promise<void> } } | null = null;

async function startFtp(suites: Suite[]): Promise<void> {
	const file = join(CORE_DIR, 'tests/ftp-servers.ts');
	if (!suites.some(suite => suite.name === 'net-request') || !existsSync(file)) return;
	const { startTestFtp, startTestSftp } = await import(file);
	const [ftp, sftp] = await Promise.all([startTestFtp(false, ...HOST_ADDRESSES), startTestSftp(...HOST_ADDRESSES)]);
	ftpServers = { ftp, sftp };
}

// What a suite is given after its command.
const SUITE_ARGS: Record<string, () => string> = {
	'time': () => String(Date.now()),
	// Whether the plugins keep their stack frames: a dev build's do.
	'errors': () => (quick ? 'dev' : ''),
	// Quoted: the engine's console splits a word at a colon.
	'fetch': () => (web ? `"${web.http}" "${web.https}"` : ''),
	'net-request': () => (ftpServers ? `"${ftpServers.ftp.url}" "${ftpServers.sftp.url}" "${ftpServers.sftp.hostKey}"` : ''),
};

const START_TIMEOUT = 90_000;
// A suite that plays a round (round-order) waits for bots, the round on and the
// next one: up to 20 seconds on a slow runner, so the limit is above that.
const SUITE_TIMEOUT = 30_000;
const BOT_TIMEOUT = 30_000;

// Console lines that mean a plugin did not load or something crashed - a
// failed call says "[amxts] <plugin>: <SomeError>: ...".
const ERROR_LINE = /failed to load|resolve symbol|exception|\[amxts\] [^:\s]+: \w*Error:|run time error|plugin file open error|bad load|unhandled promise rejection|assertion failed|did not compile|cannot create exec env|init failed/i;

interface Suite {
	/** The tag its lines carry: [cvar], [config-core]. */
	name: string;
	command: string;
	/** Text the console has to show while it runs. */
	expectedLog: string[];
}

interface SuiteResult {
	suite: Suite;
	passed: number;
	failed: number;
	lines: string[];
	/** Why it has no total: it timed out, or the server went away. */
	problem: string | null;
	/** Everything the server printed while it ran - its rcon reply first. */
	output: string[];
}

// ---------------------------------------------------------------- process

// The Linux server: one container, named after its port.
const IMAGE_DIR = plain ? 'docker/hlds-plain' : 'docker/hlds';
const IMAGE = process.env.AMXTS_TEST_IMAGE ?? (plain ? 'amxts-hlds-plain' : AMXX ? `amxts-hlds:${AMXX}` : 'amxts-hlds');
const CONTAINER = `amxts-test-${plain ? 'plain-' : ''}${PORT}`;
const CONTAINER_GAME = '/hlds/cstrike';

function docker(argv: string[]) {
	return spawnSync('docker', argv, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
}

function containerExists(): boolean {
	return docker(['container', 'inspect', CONTAINER]).status === 0;
}

function containerRunning(): boolean {
	return (docker(['container', 'inspect', '-f', '{{.State.Running}}', CONTAINER]).stdout ?? '').trim() === 'true';
}

// --sanitize: the runtimes the sanitized module links against go beside
// hlds_linux (on LD_LIBRARY_PATH), and ASan's is preloaded - it has to come
// before every other library - with build.sh's libnodeepbind.so after it.
// Leaks are not looked for (LeakSanitizer has no i386), nor new[] freed with
// free (AMX Mod X frees a plugin's file so), and a report goes to the console
// uncoloured, where report() finds it.
const SANITIZER_LIBS = sanitize ? ['libasan.so.4', 'libubsan.so.0', 'libnodeepbind.so'] : [];
const SANITIZER_OPTIONS = {
	LD_PRELOAD: '/hlds/libasan.so.4:/hlds/libnodeepbind.so',
	ASAN_OPTIONS: 'detect_leaks=0:alloc_dealloc_mismatch=0:abort_on_error=1:symbolize=1:color=never',
	UBSAN_OPTIONS: 'print_stacktrace=1:symbolize=1:color=never',
};
const SANITIZER_ENV = sanitize ? Object.entries(SANITIZER_OPTIONS).flatMap(([name, value]) => ['-e', `${name}=${value}`]) : [];

/**
 * The image from docker/hlds (docker/hlds-plain): SteamCMD and the releases,
 * a few minutes the first time, the cache's answer after that - so a changed
 * Dockerfile is built again. An image named by AMXTS_TEST_IMAGE is taken as
 * it is. --amxx builds it with that AMX Mod X.
 */
function ensureImage(): void {
	const present = docker(['image', 'inspect', IMAGE]).status === 0;
	if (present && process.env.AMXTS_TEST_IMAGE) return;
	if (!present) console.log(`building the ${IMAGE} image (${IMAGE_DIR}) - a few minutes, once`);
	const amxx = AMXX ? ['--build-arg', `AMXX=${AMXX}`] : [];
	const built = spawnSync('docker', ['build', '--load', '--quiet', ...amxx, '-t', IMAGE, join(CORE_DIR, IMAGE_DIR)], { stdio: ['ignore', 'ignore', 'inherit'] });
	if (built.status !== 0) throw new Error(`docker build of ${IMAGE} failed`);
}

/**
 * Creates the container with the server's command line, copies the test's
 * folder and the module under test into it, and starts it. The rcon port is
 * published on 127.0.0.1 only. hlds is not process 1 (`--init`): the kernel
 * ignores a signal process 1 sends itself, so an abort - ASan's, after its
 * report - would leave the server hanging rather than gone.
 */
function startContainer(argv: string[]): number {
	ensureImage();
	if (containerExists()) docker(['rm', '-f', CONTAINER]);
	const created = docker(['create', '--name', CONTAINER, '--init', '-t', '-p', `127.0.0.1:${PORT}:27015/udp`, '--add-host', 'host.docker.internal:host-gateway', ...coreDumpArgs(coresDir), ...SANITIZER_ENV, IMAGE, ...argv]);
	if (created.status !== 0) throw new Error(`docker create failed: ${created.stderr.trim()}`);

	// The configs a module reads, from the image: Linux offsets, not Windows'.
	for (const file of CONFIGS_READ) {
		docker(['cp', `${CONTAINER}:${CONTAINER_GAME}/addons/amxmodx/configs/${file}`, join(testDir, 'amxx', 'configs', file)]);
	}
	// The project's own game files - the models and sounds its plugins precache,
	// its dictionaries - where the game reads them, as the amxts-server image
	// lays a project out. Without them a precache stops the server.
	const projectFiles = PROJECT_GAME_FOLDERS
		.filter(([dir]) => existsSync(join(project.dir, dir)))
		.map(([dir, to]) => [`${join(project.dir, dir)}/.`, `${CONTAINER}:${CONTAINER_GAME}/${to}`]);
	// The modules the project names in its configs/modules.ini load beside the
	// image's, as the amxts-server image adds them.
	const modulesIni = join(testDir, 'modules.ini');
	docker(['cp', `${CONTAINER}:${CONTAINER_GAME}/addons/amxmodx/configs/modules.ini`, modulesIni]);
	const projectModules = join(project.dir, 'configs', 'modules.ini');
	if (existsSync(projectModules)) {
		const lines = readFileSync(modulesIni, 'utf-8').split(/\r?\n/);
		const added = readFileSync(projectModules, 'utf-8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith(';') && !lines.includes(line));
		writeFileSync(modulesIni, [...lines, ...added].join('\n'));
	}
	if (noReapi) writeFileSync(modulesIni, withoutReapi(readFileSync(modulesIni, 'utf-8')));
	// The project's files first: a modules.ini or a stale amxts module it
	// carries in addons/ is overwritten by the merged list and the module under test.
	for (const [from, to] of [
		...projectFiles,
		[modulesIni, `${CONTAINER}:${CONTAINER_GAME}/addons/amxmodx/configs/modules.ini`],
		[join(rootDir, 'amxts'), `${CONTAINER}:${CONTAINER_GAME}/addons/amxts`],
		[moduleDll, `${CONTAINER}:${CONTAINER_GAME}/addons/amxmodx/modules/${MODULE_FILE.linux}`],
		...SANITIZER_LIBS.map(file => [join(sanitizedDir, file), `${CONTAINER}:/hlds/${file}`]),
	]) {
		const copied = docker(['cp', from, to]);
		if (copied.status !== 0) throw new Error(`docker cp ${from} failed: ${copied.stderr.trim()}`);
	}
	const started = docker(['start', CONTAINER]);
	if (started.status !== 0) throw new Error(`docker start failed: ${started.stderr.trim()}`);
	return 1;
}

function powershell(script: string, env: Record<string, string> = {}) {
	return spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
		encoding: 'utf-8',
		env: { ...process.env, ...env },
	});
}

/** hlds processes with their command lines. */
function hldsProcesses(): { pid: number; commandLine: string }[] {
	const out = powershell(
		'Get-CimInstance Win32_Process -Filter "Name=\'hlds.exe\'" | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
	).stdout ?? '';
	return out.split(/\r?\n/).filter(Boolean).map((line) => {
		const [pid, ...rest] = line.split('\t');
		return { pid: Number(pid), commandLine: rest.join('\t') };
	});
}

/** Whether this pid is a test server: hlds with the test's plugin list. */
function isTestServer(pid: number): boolean {
	if (linux) return containerExists();
	return hldsProcesses().some(p => p.pid === pid && p.commandLine.includes(`${TEST}/plugins.ini`));
}

function isAlive(pid: number): boolean {
	if (linux) return containerRunning();
	return hldsProcesses().some(p => p.pid === pid);
}

/** Stops one process by its id - never every hlds.exe. */
function stopProcess(pid: number): void {
	if (linux) {
		docker(['stop', '-t', '2', CONTAINER]);
		return;
	}
	spawnSync('taskkill', ['/PID', String(pid), '/F'], { encoding: 'utf-8' });
}

/**
 * Starts hlds the way scripts/server.ps1 does - its console hidden the moment
 * it appears, since nothing at creation time can stop the engine's
 * AllocConsole - and returns its pid.
 */
function startHidden(argv: string[]): number {
	const script = [
		'$ErrorActionPreference = \'Stop\'',
		'$arguments = $env:AMXTS_TEST_ARGS | ConvertFrom-Json',
		'$process = Start-Process -FilePath $env:AMXTS_TEST_HLDS -ArgumentList $arguments -WorkingDirectory $env:AMXTS_TEST_ROOT -PassThru',
		'Add-Type -Namespace AmxtsTest -Name Win -MemberDefinition \'[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);\'',
		'$appeared = (Get-Date).AddSeconds(20)',
		'while ($process.MainWindowHandle -eq [IntPtr]::Zero -and -not $process.HasExited -and (Get-Date) -lt $appeared) { Start-Sleep -Milliseconds 20; $process.Refresh() }',
		'if ($process.MainWindowHandle -ne [IntPtr]::Zero) { [AmxtsTest.Win]::ShowWindow($process.MainWindowHandle, 0) | Out-Null }',
		'Write-Output $process.Id',
	].join('\n');

	const result = powershell(script, {
		AMXTS_TEST_ARGS: JSON.stringify(argv),
		AMXTS_TEST_HLDS: hlds,
		AMXTS_TEST_ROOT: rootDir,
	});
	const pid = Number((result.stdout ?? '').trim().split(/\r?\n/).pop());
	if (!pid) throw new Error(`hlds did not start: ${(result.stderr ?? '').trim()}`);
	return pid;
}

// ---------------------------------------------------------------- rcon

/** One connectionless packet to the test server, and what comes back until it goes quiet. */
function ask(message: string, wait: number): Promise<string | null> {
	return new Promise((done) => {
		const socket = createSocket('udp4');
		let reply: string | null = null;
		let finished = false;

		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			socket.close();
			done(reply);
		};
		let timer = setTimeout(finish, wait);

		socket.on('message', (packet) => {
			reply = (reply ?? '') + packet.subarray(4).toString('utf-8').replace(/^l/, '').replace(/\0+$/, '');
			clearTimeout(timer);
			timer = setTimeout(finish, 200);
		});
		socket.on('error', finish);
		socket.send(Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(`${message}\n`, 'utf-8')]), PORT, '127.0.0.1');
	});
}

async function rcon(password: string, command: string): Promise<string | null> {
	// A server busy with a long frame - YaPB building a map's visibility table
	// on its first load - lets a challenge go unanswered, and the command
	// would never be sent: it is asked again.
	let challenge: string | undefined;
	for (let attempt = 0; attempt < 5 && !challenge; attempt++) {
		challenge = (await ask('challenge rcon', 1000))?.match(/challenge rcon (\d+)/)?.[1];
	}
	if (!challenge) return null;
	return ask(`rcon ${challenge} "${password}" ${command}`, 3000);
}

/** Whether a UDP port can be bound here - no server holds it. */
function portIsFree(port: number): Promise<boolean> {
	return new Promise((done) => {
		const socket = createSocket('udp4');
		socket.once('error', () => done(false));
		socket.bind(port, () => socket.close(() => done(true)));
	});
}

// ---------------------------------------------------------------- the log

/** The test server's console, from -condebug, a line a line. */
function consoleLines(): string[] {
	if (linux) {
		const logs = docker(['logs', CONTAINER]);
		return `${logs.stdout ?? ''}${logs.stderr ?? ''}`.replace(/\0/g, ' ').split(/\r?\n/);
	}
	const log = join(rootDir, 'qconsole.log');
	if (!existsSync(log)) return [];
	// The engine writes stray NULs into it.
	return readFileSync(log, 'utf-8').replace(/\0/g, ' ').split(/\r?\n/);
}

/** AMX Mod X's own logs of the test server: where a Pawn run time error goes. */
function amxxLogLines(): string[] {
	const dir = join(testDir, 'amxx', 'logs');
	// The container's, copied out over the ones staged.
	if (linux && containerExists()) {
		rmSync(dir, { recursive: true, force: true });
		docker(['cp', `${CONTAINER}:${CONTAINER_GAME}/${TEST}/amxx/logs`, dir]);
	}
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap(file => readFileSync(join(dir, file), 'utf-8').split(/\r?\n/).map(line => `${file}: ${line}`));
}

const wait = (ms: number) => new Promise(done => setTimeout(done, ms));

/** Polls until `ready` answers or the time is up; null when it is. */
async function until<T>(ms: number, ready: () => T | null | Promise<T | null>, alive: () => boolean): Promise<T | null> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const value = await ready();
		if (value !== null) return value;
		if (!alive()) return null;
		await wait(250);
	}
	return null;
}

// ---------------------------------------------------------------- suites

/** The suites to run and the files to build: with --only, those holding its suites and the ones holding none. */
function discoverSuites(): { suites: Suite[]; plugins: string[]; pawn: string[]; unlisted: string[]; unknown: string[] } {
	const files = readdirSync(suitesDir).filter(f => f.endsWith('.ts') || f.endsWith('.sma')).sort();
	const suites: Suite[] = [];
	const chosen: string[] = [];
	const names: string[] = [];
	const unlisted: string[] = [];

	for (const file of files) {
		const source = readFileSync(join(suitesDir, file), 'utf-8');
		// `@log-dev`: what a dev build's stack frames alone show (--quick).
		const expectedLog = [...source.matchAll(/^\/\/ @log(-dev)? (.+)$/gm)].filter(m => quick || !m[1]).map(m => m[2].trim());
		const own = [...source.matchAll(/(?:addServerCommand(?:<\w+>)?|register_srvcmd)\(\s*["']amxts_test_(\w+)[\s"']/g)]
			.map(([, tail]) => ({ name: tail.replace(/_/g, '-'), command: `amxts_test_${tail}`, expectedLog }));
		const wanted = own.filter(suite => ONLY.length === 0 || ONLY.includes(suite.name));
		if (own.length === 0 || wanted.length > 0) chosen.push(join(suitesDir, file));
		if (/^\/\/ @unlisted$/m.test(source)) unlisted.push(file.replace(/\.ts$/, '.aot'));
		// The speed check's ratios are the plain module's: under --sanitize its
		// plugin loads (perf-pawn.sma calls it) but it runs only when --only names it.
		suites.push(...wanted.filter(suite => !(sanitize && suite.name === 'perf' && ONLY.length === 0)));
		names.push(...own.map(suite => suite.name));
	}

	// A Pawn file that includes a suite's natives (perf-pawn.sma's <perf>)
	// is built with that suite only: the include is written by its build.
	const left = (file: string) => file.endsWith('.sma')
		&& [...readFileSync(file, 'utf-8').matchAll(/^#include <(\w+)>/gm)].some(([, name]) => files.includes(`${name}.ts`) && !chosen.includes(join(suitesDir, `${name}.ts`)));
	return {
		suites,
		plugins: chosen.filter(f => f.endsWith('.ts')),
		pawn: chosen.filter(f => f.endsWith('.sma') && !left(f)),
		unlisted,
		unknown: ONLY.filter(name => !names.includes(name)),
	};
}

/** Where a Pawn suite is built. */
const amxxOf = (source: string) => join(buildDir, basename(source).replace(/\.sma$/, '.amxx'));

async function build(plugins: string[], pawn: string[]): Promise<string[] | null> {
	mkdirSync(buildDir, { recursive: true });
	const sources = [...EXTRA_PLUGINS, ...plugins];
	// A module package's natives build as the module's owner: menu-core.aot.
	const names = sources.map(source => basename(modulesSources.entry(source)).replace(/\.ts$/, ''));
	const twice = names.findIndex((name, index) => names.indexOf(name) !== index);
	if (twice >= 0) {
		fail(`${sources[twice]}: a plugin named ${names[twice]} is already built - rename the suite`);
		return null;
	}

	const system = linux ? 'linux' : 'windows';
	const all = sources.map((source, index): Plugin => ({ source, output: join(buildDir, `${names[index]}.aot`), root: CORE_PLUGINS, wamrc, signatures, system, quick: quick && !FULL.has(basename(source)) }));
	if (prebuilt) {
		const missing = [...all.map(plugin => plugin.output), ...pawn.map(amxxOf)].filter(file => !existsSync(file));
		if (missing.length) fail(`--prebuilt: not built - ${missing.join(', ')}`);
		return missing.length ? null : names.map(name => `${name}.aot`);
	}

	// What an earlier run compiled from the same files is taken as it is.
	const cache = pluginCache(project.dir);
	const fresh = all.filter(plugin => !cache.reuse(plugin));
	const compiled = await compileAll(fresh, { dir: project.dir, includes: [], here: (plugin, natives) => cache.compile(plugin, natives), low: true });
	const failed = compiled.findIndex(each => each?.problem);
	if (failed >= 0) {
		fail(`${fresh[failed].source} does not compile:\n${compiled[failed]!.problem!.trim()}`);
		return null;
	}
	if (fresh.length < all.length) console.log(`${all.length - fresh.length} of ${all.length} plugins unchanged since the last build`);

	// A Pawn suite includes what the TypeScript ones export, from beside them,
	// the folders a build looks in (the project's includes/, its server's, the
	// core's and AMX Mod X's), and the module's own natives from
	// runtime/host/amxts.inc.
	const dirs = [buildDir, ...includeDirs(project.dir).filter(dir => existsSync(dir)), join(CORE_DIR, 'runtime/host')];
	for (const source of pawn) {
		const output = amxxOf(source);
		// From its own folder: on Linux amxxpc loads amxxpc32.so from the current one.
		const result = spawnSync(amxxpc, [source, ...[...new Set(dirs)].map(dir => `-i${dir}`), `-o${output}`], { encoding: 'utf-8', cwd: dirname(amxxpc) });
		if (result.status !== 0 || !existsSync(output)) {
			fail(`${source} does not compile:\n${(result.stdout ?? '').trim()}`);
			return null;
		}
	}
	return names.map(name => `${name}.aot`);
}

// ---------------------------------------------------------------- staging

/** A folder of this script's, emptied - never one it did not make. */
function freshDir(dir: string): void {
	if (existsSync(dir) && !existsSync(join(dir, MARKER))) {
		throw new Error(`${dir} exists and is not the test's (no ${MARKER} in it) - move it away first`);
	}
	removeOwnDir(dir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, MARKER), 'Made by scripts/test-server.ts; removed when the test ends.\n');
}

/**
 * Removes a folder of this script's. The junctions in amxts-test go first, one
 * by one, as links: rmdir on a junction removes the link and leaves the
 * folder it points at alone - and a recursive delete must never follow one
 * into the real cstrike.
 */
function removeOwnDir(dir: string): void {
	if (!existsSync(dir)) return;
	if (!existsSync(join(dir, MARKER))) throw new Error(`refusing to delete ${dir}: not the test's`);

	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (lstatSync(path).isSymbolicLink()) spawnSync('cmd', ['/c', 'rmdir', path]);
	}
	for (const entry of readdirSync(dir)) {
		if (lstatSync(join(dir, entry)).isSymbolicLink()) throw new Error(`could not remove the junction ${join(dir, entry)}`);
	}

	for (let attempt = 0; ; attempt++) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch (error) {
			// hlds lets go of its files a moment after it is stopped.
			if (attempt >= 20) throw error;
			spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 250']);
		}
	}
}

/** A modules.ini without its `reapi` line, for --no-reapi. */
function withoutReapi(modules: string): string {
	return modules.split(/\r?\n/).filter(line => line.trim().toLowerCase() !== 'reapi').join('\n');
}

/**
 * core.ini of the server, with every folder AMX Mod X writes to moved into the
 * test's. The Linux container is the test's own, so its modules stay where
 * they are - its modules.ini names amxts_amxx, and the module under test is
 * copied over the image's place for it - and AMX Mod X's defaults stand in
 * for the rest.
 */
function testCoreIni(): string {
	const moved: Record<string, string> = {
		amxx_logs: `${TEST}/amxx/logs`,
		amxx_configsdir: `${TEST}/amxx/configs`,
		...(linux ? {} : { amxx_modules: `${TEST}/amxx/modules.ini` }),
		amxx_plugins: `${TEST}/amxx/plugins.ini`,
		amxx_pluginsdir: `${TEST}/amxx/plugins`,
		...(linux ? {} : { amxx_modulesdir: `${TEST}/amxx/modules` }),
		amxx_vault: `${TEST}/amxx/vault.ini`,
	};
	const original = linux ? '' : join(gameDir, 'addons/amxmodx/configs/core.ini');
	const lines = (original && existsSync(original) ? readFileSync(original, 'utf-8') : '').split(/\r?\n/).filter(line => !Object.hasOwn(moved, line.trim().split(/\s+/)[0]));
	return `${[
		'; core.ini of the test server - scripts/test-server.ts. The server\'s own, with',
		'; everything AMX Mod X writes to moved into addons/amxts/test.',
		...Object.entries(moved).map(([key, value]) => `${key} ${value}`),
		...lines,
	].join('\n')}\n`;
}

// ---------------------------------------------------------------- the module

/** Whether the module under test loads the plugins this checkout builds: its ABI's line and hash are the checkout's. */
function moduleFits(): boolean {
	const abi = moduleAbiOf(moduleDll);
	return abi !== null && abiLine(abi) === abiLine(abiIdentity());
}

/** Whether a file the module is built from - runtime/src, runtime/CMakeLists.txt - changed after it was built. */
function moduleStale(): boolean {
	const src = join(CORE_DIR, 'runtime/src');
	if (!existsSync(src)) return false;
	const built = statSync(moduleDll).mtimeMs;
	return [join(CORE_DIR, 'runtime/CMakeLists.txt'), ...readdirSync(src).map(file => join(src, file))].some(file => statSync(file).mtimeMs > built);
}

/**
 * The module under test, built again when it would refuse every plugin of
 * the run - built before the version's line or the hood moved on - with a
 * line saying so: `bun run generate`, then cmake's build in runtime/build,
 * or `bun run build:linux`; and, without generating, when its sources
 * changed after it was built. One given with AMXTS_TEST_MODULE, or of a core
 * that is no checkout, is not built here: the run stops and says what to run.
 */
function freshModule(): boolean {
	const ours = !process.env.AMXTS_TEST_MODULE && existsSync(join(CORE_DIR, linux ? 'docker/build' : 'runtime/build/CMakeCache.txt'));
	const fits = moduleFits();
	if (fits && !(ours && moduleStale())) return true;
	const was = fits ? `${moduleDll} is older than its sources` : `${moduleDll} is of ${moduleAbiOf(moduleDll) ?? 'no amxts ABI'}, the checkout builds plugins of ${abiIdentity()}`;
	const steps = [...(fits ? [] : [['bun', 'run', 'generate']]), linux ? ['bun', 'run', 'build:linux', ...(sanitize ? ['--sanitize'] : [])] : ['cmake', '--build', 'runtime/build', '--config', 'Release']];
	const commands = steps.map(step => step.join(' ')).join(' && ');
	if (!ours) {
		fail(`${was} - build it again: ${commands}`);
		return false;
	}
	console.log(`${was} - building it again: ${commands}`);
	for (const [program, ...args] of steps) {
		const run = spawnSync(program === 'bun' ? process.execPath : program, args, { cwd: CORE_DIR, encoding: 'utf-8' });
		if (run.status !== 0) {
			const said = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n');
			fail(`${[program, ...args].join(' ')} failed${run.error ? `: ${run.error.message}` : ''}\n${said}`);
			return false;
		}
	}
	if (moduleFits()) return true;
	fail(`${moduleDll} is of ${moduleAbiOf(moduleDll) ?? 'no amxts ABI'} after it was built again, the checkout builds plugins of ${abiIdentity()}`);
	return false;
}

// ---------------------------------------------------------------- another ABI

/** A plugin the module has to refuse, and the line it says so with. */
interface Refused {
	file: string;
	line: string;
}

/**
 * The first plugin built, three times more: stamped with an ABI of another
 * line, with one of its line but another hood's hash, and with none, as one
 * built before plugins carried it. The module refuses each with one line and
 * loads the plugins listed after them as usual (scripts/build-identity.ts).
 * The first plugin itself is stamped with another patch of its line, which
 * the module loads: its suites run as any other's. The ABI is changed in
 * place, keeping its length, so the section keeps its size.
 */
function refusedCopies(built: string[]): Refused[] {
	const abi = abiIdentity();
	const aot = readFileSync(join(buildDir, built[0]));
	const at = aot.indexOf(`${ABI_SECTION}\0${abi}`);
	if (at < 0) throw new Error(`${built[0]} carries no ${ABI_SECTION} section of ${abi}`);
	const plus = abi.indexOf('+');
	const [version, hash] = [abi.slice(0, plus), abi.slice(plus)];
	const line = releaseLine(version);
	const stamp = (file: string, section: string) => {
		const bytes = Buffer.from(aot);
		bytes.write(section, at, 'latin1');
		writeFileSync(join(buildDir, file), bytes);
	};
	const otherLine = `${version.replace(/\d/g, '9')}${hash}`;
	const otherHood = `${version}+abi.${'9'.repeat(hash.length - '+abi.'.length)}`;
	const copies = [
		{ file: 'other-line.aot', abi: otherLine, by: `amxts ${releaseLine(otherLine)}`, ours: line },
		{ file: 'other-hood.aot', abi: otherHood, by: `amxts ${otherHood}`, ours: abi },
		{ file: 'no-abi.aot', abi: null, by: 'an older amxts', ours: line },
	];
	const refused = copies.map((copy) => {
		stamp(copy.file, copy.abi ? `${ABI_SECTION}\0${copy.abi}` : `amxts.xyz\0${abi}`);
		return { file: copy.file, line: `[amxts] ${copy.file} was built for ${copy.by}, this is ${copy.ours} - build it again` };
	});
	const otherPatch = abi.replace(/^(\d+\.\d+\.)(\d)/, (_, head: string, digit: string) => `${head}${digit === '9' ? '8' : '9'}`);
	stamp(built[0], `${ABI_SECTION}\0${otherPatch}`);
	return refused;
}

function stage(built: string[], refused: Refused[], unlisted: string[], pawn: string[], password: string): void {
	if (linux) {
		freshDir(rootDir);
		mkdirSync(testDir, { recursive: true });
	} else {
		freshDir(testDir);
		freshDir(rootDir);
	}

	// amxts: the plugins, the refused ones first, and the list of all but the unlisted.
	const files = [...refused.map(copy => copy.file), ...built];
	mkdirSync(join(testDir, 'plugins'));
	for (const file of files) copyFileSync(join(buildDir, file), join(testDir, 'plugins', file));
	const listed = files.filter(file => !unlisted.includes(file));
	writeFileSync(join(testDir, 'plugins.ini'), `${listed.join('\n')}\n`);

	// AMX Mod X: the Pawn suites, the modules with the amxts module under
	// test, and the configs a suite reads.
	const amxx = join(testDir, 'amxx');
	const serverAmxx = join(gameDir, 'addons/amxmodx');
	for (const dir of ['plugins', 'modules', 'configs', 'logs']) mkdirSync(join(amxx, dir), { recursive: true });

	// This run's Pawn suites, not whatever an older run left in the build folder.
	for (const file of pawn) copyFileSync(join(buildDir, file), join(amxx, 'plugins', file));
	writeFileSync(join(amxx, 'plugins.ini'), `${pawn.join('\n')}\n`);

	// The container's modules and configs come from its image (startContainer).
	if (!linux) {
		for (const file of readdirSync(join(serverAmxx, 'modules'))) {
			const name = file.toLowerCase();
			if (name !== 'amxts_amxx.dll' && !(noReapi && name.startsWith('reapi'))) copyFileSync(join(serverAmxx, 'modules', file), join(amxx, 'modules', file));
		}
		copyFileSync(moduleDll, join(amxx, 'modules', 'amxts_amxx.dll'));
		const modules = readFileSync(join(serverAmxx, 'configs', 'modules.ini'), 'utf-8');
		writeFileSync(join(amxx, 'modules.ini'), noReapi ? withoutReapi(modules) : modules);
		for (const file of CONFIGS_READ) {
			const from = join(serverAmxx, 'configs', file);
			if (existsSync(from)) copyFileSync(from, join(amxx, 'configs', file));
		}
	}
	writeFileSync(join(amxx, 'core.ini'), testCoreIni());
	if (existsSync(join(suitesDir, 'fixtures'))) cpSync(join(suitesDir, 'fixtures'), join(amxx, 'configs'), { recursive: true });
	if (ftpServers) writeFileSync(join(amxx, 'configs', 'net-request-key.pem'), ftpServers.sftp.privateKey);

	mkdirSync(join(testDir, 'logs'));
	writeFileSync(join(testDir, 'server.cfg'), [
		'// server.cfg of the test server - scripts/test-server.ts',
		'hostname "amxts test server"',
		`rcon_password "${password}"`,
		'sv_password ""',
		'sv_lan 1',
		'mp_timelimit 0',
		'mp_freezetime 0',
		`sv_logsdir "${TEST}/logs"`,
		'log on',
		'',
	].join('\n'));

	if (linux) return;

	// The working folder: the game through junctions, and the log hlds writes.
	for (const dir of [game, 'valve', 'platform']) {
		if (!existsSync(join(hldsDir, dir))) continue;
		const made = spawnSync('cmd', ['/c', 'mklink', '/J', join(rootDir, dir), join(hldsDir, dir)], { encoding: 'utf-8' });
		if (made.status !== 0) throw new Error(`could not link ${dir}: ${made.stderr || made.stdout}`);
	}
	for (const file of ['steam_appid.txt']) {
		if (existsSync(join(hldsDir, file))) copyFileSync(join(hldsDir, file), join(rootDir, file));
	}
}

function cleanUp(): void {
	if (linux) {
		if (containerExists()) docker(['rm', '-f', CONTAINER]);
		removeOwnDir(rootDir);
		return;
	}
	removeOwnDir(rootDir);
	removeOwnDir(testDir);
}

/** A server left by --keep, or by a run that was interrupted. */
function stopLeftover(): void {
	if (linux) {
		if (containerExists()) {
			console.log(`removing the test container left running (${CONTAINER})`);
			docker(['rm', '-f', CONTAINER]);
		}
		return;
	}
	if (!existsSync(pidFile)) return;
	const pid = Number(readFileSync(pidFile, 'utf-8').trim());
	if (pid && isTestServer(pid)) {
		console.log(`stopping the test server left running (pid ${pid})`);
		stopProcess(pid);
	}
}

// ---------------------------------------------------------------- the run

/** Lines around each error, for the report; the ones a suite expects are left out. */
function errorsIn(lines: string[], expected: string[]): string[] {
	const found: string[] = [];
	lines.forEach((line, at) => {
		if (!ERROR_LINE.test(line) || expected.some(text => line.includes(text))) return;
		const context = lines.slice(Math.max(0, at - 2), at + 3).map((one, i) => `${i === Math.min(2, at) ? '>' : ' '} ${one}`);
		found.push(context.join('\n'));
	});
	return found;
}

async function runSuite(suite: Suite, password: string, alive: () => boolean): Promise<SuiteResult> {
	const from = consoleLines().length;
	const extra = SUITE_ARGS[suite.name]?.() ?? '';
	const tag = `[${suite.name}]`;

	// What the command prints while it runs goes back to rcon rather than to
	// the console - the engine redirects it - so the reply is the first part
	// of the suite's output, and the console after it the rest: what an async
	// suite prints later, and what the server says on its own.
	const answer = await rcon(password, `${suite.command}${extra ? ` ${extra}` : ''}`);
	const reply = (answer ?? '').split(/\r?\n/);
	// hlds_linux also prints what it redirects to its own output, the
	// container's console: a line the reply has is taken from the console once.
	const output = () => {
		const echoed = new Map<string, number>();
		for (const line of reply) echoed.set(line.trimEnd(), (echoed.get(line.trimEnd()) ?? 0) + 1);
		const rest = consoleLines().slice(from).filter((line) => {
			const left = echoed.get(line.trimEnd()) ?? 0;
			if (left === 0) return true;
			echoed.set(line.trimEnd(), left - 1);
			return false;
		});
		return [...reply, ...rest];
	};

	// console.log's lines come as `[amxts] [cvar] ...`, server_print's as `[cvar] ...`.
	const escaped = tag.replace(/[[\]-]/g, '\\$&');
	const total = new RegExp(`(?:^|\\] )${escaped} (\\d+) ok, (\\d+) failed`);
	const done = await until(SUITE_TIMEOUT, () => output().find(line => total.test(line)) ?? null, alive);
	const since = output();
	const lines = since
		.map(line => line.replace(/^\[amxts\] /, ''))
		.filter(line => line.startsWith(`${tag} ok`) || line.startsWith(`${tag} FAIL`));

	let passed = lines.filter(line => line.startsWith(`${tag} ok`)).length;
	let failed = lines.length - passed;

	// What the console had to show, looked for as written in the suite.
	for (const text of suite.expectedLog) {
		const seen = since.some(line => line.includes(text));
		if (seen) passed++;
		else failed++;
		lines.push(`${tag} ${seen ? 'ok  ' : 'FAIL'} the console shows "${text}"`);
	}

	// A suite that timed out says whether its command was answered at all:
	// without a reply, what it printed while the command ran is lost.
	const unanswered = answer === null ? ', and rcon did not answer its command' : '';
	const problem = done ? null : alive() ? `no "${tag} N ok, M failed" in ${SUITE_TIMEOUT / 1000}s${unanswered}` : 'the server went away';
	return { suite, passed, failed: failed + (problem ? 1 : 0), lines, problem, output: since };
}

/** Keeps the console and any crash dump of a failed run where they can be read. */
function keepEvidence(): string {
	const dir = resolve(buildDir, 'last-run');
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	for (const file of existsSync(rootDir) ? readdirSync(rootDir) : []) {
		if (file === 'qconsole.log' || file.endsWith('.mdmp')) copyFileSync(join(rootDir, file), join(dir, file));
	}
	if (linux) {
		writeFileSync(join(dir, 'console.log'), consoleLines().join('\n'));
		amxxLogLines();
		if (existsSync(coresDir)) cpSync(coresDir, join(dir, 'cores'), { recursive: true });
	}
	const logs = join(testDir, 'amxx', 'logs');
	if (existsSync(logs)) cpSync(logs, join(dir, 'amxx-logs'), { recursive: true });
	return dir;
}

async function main(): Promise<number> {
	if (stopOnly) {
		stopLeftover();
		await wait(1000);
		cleanUp();
		console.log('test server stopped, its folders removed');
		return 0;
	}

	// --prebuilt compiles nothing, --build-only starts nothing.
	for (const needed of [...(linux || buildOnly ? [] : [hlds]), moduleDll, ...(prebuilt ? [] : [amxxpc, wamrc]), signatures]) {
		if (!existsSync(needed)) {
			fail(`missing ${needed}${needed === moduleDll && linux ? ` - bun run build:linux${sanitize ? ' --sanitize' : ''} builds it` : ''}`);
			return 1;
		}
	}
	if (!prebuilt && !freshModule()) return 1;
	if (!buildOnly) {
		if (linux && docker(['version']).status !== 0) {
			fail('--linux runs the server in Docker, and docker does not answer - is it installed and running?');
			return 1;
		}

		stopLeftover();

		// The port has to be nobody's: not the server's, not anyone else's.
		const taken = linux ? undefined : hldsProcesses().find(p => new RegExp(`\\+port\\s+${PORT}\\b`).test(p.commandLine));
		if (taken || !(await portIsFree(PORT))) {
			fail(`port ${PORT} is in use${taken ? ` by hlds pid ${taken.pid}` : ''} - pass --port or set AMXTS_TEST_PORT`);
			return 1;
		}
	}

	const started = performance.now();
	const { suites, plugins, pawn, unlisted, unknown } = discoverSuites();
	if (unknown.length) {
		fail(`--only: no suite ${unknown.join(', ')} in ${suitesDir}`);
		return 1;
	}
	const progress = testProgress('test-server', suites.map(suite => suite.name));
	progress.phase(prebuilt ? 'taking the built suites' : 'building the suites');
	const built = await build(plugins, pawn);
	if (!built) return 1;
	console.log(`${prebuilt ? 'took' : 'built'} ${built.length} plugins and ${pawn.length} Pawn suite(s) (${((performance.now() - started) / 1000).toFixed(1)}s)`);
	if (buildOnly) return 0;
	await startWeb(suites);

	const password = `amxts-${Math.random().toString(36).slice(2, 12)}`;
	const refused = refusedCopies(built);
	stage(built, refused, unlisted, pawn.map(file => basename(file).replace(/\.sma$/, '.amxx')), password);

	// In the container hlds listens on 27015 of its own network, which Docker
	// publishes as 127.0.0.1:PORT; its console is the container's output.
	const argv = [
		'-console',
		'-game',
		linux ? 'cstrike' : game,
		'+ip',
		linux ? '0.0.0.0' : '127.0.0.1',
		'+port',
		linux ? '27015' : String(PORT),
		'-noipx',
		'+sv_lan',
		'1',
		'-insecure',
		...(linux ? [] : ['-condebug']),
		'+maxplayers',
		'6',
		'+localinfo',
		'amxx_cfg',
		`${TEST}/amxx/core.ini`,
		'+localinfo',
		'amxts_plugins',
		`${TEST}/plugins.ini`,
		'+servercfgfile',
		`${TEST}/server.cfg`,
		'+map',
		MAP,
	];

	progress.phase('starting the server');
	const pid = linux ? startContainer(argv) : startHidden(argv);
	if (!linux) writeFileSync(pidFile, `${pid}\n`);
	console.log(`test server: ${linux ? `container ${CONTAINER} (${IMAGE})` : `hlds pid ${pid}`} on 127.0.0.1:${PORT}, ${MAP}`);

	let serverGone = false;
	const alive = () => {
		if (serverGone) return false;
		serverGone = !isAlive(pid);
		return !serverGone;
	};

	const results: SuiteResult[] = [];
	const problems: string[] = [];

	try {
		// Up: it answers rcon once the map has loaded and the plugins have started.
		const up = await until(START_TIMEOUT, async () => (await ask('challenge rcon', 500)) ?? null, alive);
		if (!up) {
			problems.push(alive() ? `the server did not answer in ${START_TIMEOUT / 1000}s` : 'the server exited while starting');
			return report(results, problems);
		}

		// The first thing to know: whether it is loading the test's plugins
		// and nothing else. If not, it stops here before anything runs. AMX
		// Mod X runs the Pawn suites alone; the module loads its natives'
		// image, not a plugin, and says so once a map (`amxx plugins` of AMX
		// Mod X 1.10 cuts a file name to 11 characters; 1.9 lists it whole).
		const listed = await rcon(password, 'amxx plugins') ?? '';
		const running = [...listed.matchAll(/(\S+\.amxx)\s+running/g)].map(m => m[1]);
		const expected = new Set(pawn.map(f => basename(f).replace(/\.sma$/, '.amxx')));
		const strangers = running.filter(file => !expected.has(file));
		const lines = consoleLines();
		const images = lines.filter(line => line.includes('[amxts] natives\' image:')).length;
		const ownList = lines.some(line => line.includes('[amxts] plugin list') && line.replace(/\\/g, '/').includes(`${TEST}/plugins.ini`));
		const isolation = ([
			[strangers.length > 0, `AMX Mod X runs ${strangers.join(', ')}`],
			[images !== 1, images ? `the natives' image loaded ${images} times on the first map` : 'the amxts module did not load its natives\' image'],
			[!ownList, 'the amxts module did not take the test\'s plugin list (is runtime/build the new module?)'],
		] as const).find(([failed]) => failed);
		if (isolation) {
			problems.push(`isolation failed - ${isolation[1]}`);
			return report(results, problems);
		}

		for (const file of built.filter(file => !unlisted.includes(file))) {
			if (!consoleLines().some(line => line.includes(`[amxts] loaded ${file}`))) problems.push(`${file} did not load`);
		}
		for (const copy of refused) {
			const lines = consoleLines();
			if (!lines.some(line => line.includes(copy.line))) problems.push(`${copy.file} was not refused with "${copy.line}"`);
			if (lines.some(line => line.includes(`[amxts] loaded ${copy.file}`))) problems.push(`${copy.file} of another ABI loaded`);
		}

		// A player for the suites that need one: YaPB's.
		progress.phase('waiting for a bot');
		let bots = await botCount(password);
		if (bots === 0) await rcon(password, 'yb add');
		bots = await until(BOT_TIMEOUT, async () => ((await botCount(password)) > 0 ? 1 : null), alive) ?? 0;
		if (!bots) problems.push('no bot joined: the suites that need a player will fail');

		for (const suite of suites) {
			if (!alive()) break;
			progress.start(suite.name);
			const result = await runSuite(suite, password, alive);
			results.push(result);
			for (const line of [...result.lines.filter(one => one.includes(' FAIL ')), ...(result.problem ? [`[${suite.name}] ${result.problem}`] : [])]) progress.fail(line);
			progress.end(suite.name, result.failed === 0, `${result.passed} ok${result.failed ? `, ${result.failed} failed` : ''}`);
		}
		progress.finish();

		if (!alive()) problems.push('the server exited during the run (a crash? see the log below)');
		return report(results, problems);
	} finally {
		web?.stop();
		await Promise.all([ftpServers?.ftp.stop(), ftpServers?.sftp.stop()]);
		if (keep && isAlive(pid)) {
			console.log(`\nleft running: ${linux ? `container ${CONTAINER}` : `pid ${pid}`}, 127.0.0.1:${PORT}, rcon_password "${password}"`);
			console.log(`its console: ${linux ? `docker logs ${CONTAINER}` : join(rootDir, 'qconsole.log')}`);
			console.log(`stop it and remove its folders with: bun run test:server --stop${plain ? ' --plain' : linux ? ' --linux' : ''}`);
		} else {
			if (isAlive(pid)) stopProcess(pid);
			await until(10_000, () => (isAlive(pid) ? null : true), () => true);
			const failed = problems.length > 0 || results.some(result => result.failed > 0);
			if (failed) console.log(`the console and any crash dump: ${keepEvidence()}`);
			cleanUp();
		}
	}
}

/** YaPB bots on the server, from `status`. */
async function botCount(password: string): Promise<number> {
	const status = await rcon(password, 'status') ?? '';
	return status.split('\n').filter(line => /^#\s*\d+\s+"/.test(line) && /\bBOT\b/.test(line)).length;
}

/** A sanitizer's reports in the console (--sanitize), each from its first line to its SUMMARY: the stack names the file and line. */
function sanitizerReports(lines: string[]): string[] {
	return lines.flatMap((line, at) => {
		if (!/ERROR: AddressSanitizer|: runtime error: /.test(line)) return [];
		const end = lines.findIndex((one, i) => i > at && /SUMMARY: \w+Sanitizer/.test(one));
		return [lines.slice(at, end < 0 ? at + 40 : end + 1).join('\n')];
	});
}

function report(results: SuiteResult[], problems: string[]): number {
	const expected = results.flatMap(result => result.suite.expectedLog);
	const replies = results.flatMap(result => result.output);
	const errors = errorsIn([...consoleLines(), ...replies, ...amxxLogLines()], expected);
	const sanitized = sanitizerReports(consoleLines());

	console.log('');
	for (const result of results) {
		const status = result.failed === 0 ? 'ok  ' : 'FAIL';
		const counts = `${result.passed} ok${result.failed ? `, ${result.failed} failed` : ''}`;
		console.log(`${status} ${result.suite.name.padEnd(18)} ${counts}${result.problem ? ` - ${result.problem}` : ''}`);
		for (const line of result.lines.filter(one => one.includes(' FAIL '))) console.log(`       ${line}`);
		// The lines of a suite that timed out - its rcon reply, then the
		// console - tell a command that never ran from one that stopped.
		if (result.problem?.startsWith('no ')) {
			const own = result.output.filter(line => line.includes(`[${result.suite.name}]`));
			console.log(own.length ? '       what it printed:' : '       it printed nothing');
			for (const line of own) console.log(`         ${line}`);
		}
	}

	for (const problem of problems) console.log(`FAIL ${problem}`);

	// hlds writes a dump into its working folder when it crashes.
	const dumps = existsSync(rootDir) ? readdirSync(rootDir).filter(file => file.endsWith('.mdmp')) : [];
	for (const dump of dumps) problems.push(`hlds crashed: ${dump}`);
	for (const dump of dumps) console.log(`FAIL hlds crashed: ${dump}`);

	if (errors.length > 0) {
		console.log(`\nerrors in the server's console (${errors.length}):`);
		for (const error of errors) console.log(`${error}\n`);
	}

	if (sanitized.length > 0) {
		console.log(`\nsanitizer reports (${sanitized.length}):`);
		for (const one of sanitized) console.log(`${one}\n`);
	}

	if (problems.some(problem => /exited|went away/.test(problem)) || results.some(result => result.problem === 'the server went away')) {
		console.log('\nthe last lines of the console:');
		for (const line of consoleLines().filter(Boolean).slice(-30)) console.log(`  ${line}`);
		// How it stopped, and where: its exit code and the core dump's backtrace.
		if (linux) {
			console.log('\nhow it stopped:');
			for (const line of crashReport(CONTAINER, coresDir)) console.log(`  ${line}`);
		}
	}

	const passed = results.reduce((sum, result) => sum + result.passed, 0);
	const failed = results.reduce((sum, result) => sum + result.failed, 0) + problems.length + errors.length + sanitized.length;
	console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} checks passed in ${results.length} suites${failed ? `, ${failed} failures` : ''}`);
	return failed === 0 ? 0 : 1;
}

process.exit(await main().catch((error) => {
	fail(String(error?.stack ?? error));
	return 1;
}));
