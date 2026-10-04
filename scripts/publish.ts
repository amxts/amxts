// The npm packages of a release: packed from their folders with their `file:`
// links as versions, and published in order.
//
//   bun run publish:npm --dry-run       pack every package into dist-npm/packs, say what each carries
//   bun run publish:npm [--otp <code>]  pack them and publish them to npm, in order
//   bun run publish:npm --only <names>  pack them all, publish the ones named (comma-separated)
//   bun run publish:local [--reset]     pack them and publish them to a local registry (Verdaccio)
//   bun run publish:local --as 0.3.0    the same, the core staged as that version
//   bun run publish:local --stop        stop the local registry
//
// The packages, in order: wamrc for each system, the core, the official
// modules, the command and create-amxts. The core is this folder; the others
// are checked out beside it: ../amxts-cli and ../amxts-modules/<name>. Each
// goes out as its own package.json's version, but wamrc, which is the core's:
// the .aot a project builds must come from the server module's own wamrc. The
// command's CORE_RANGE must take the core's version.
//
// --as <version>, for the local registry only, stages the core and wamrc as
// another version than the checkout has - to try `amxts upgrade` from the
// release before it, with nothing in the repositories changed: their
// package.json's version, every link to the core (`^<version>`), and the
// modules' prebuilt plugins, compiled with AMXTS_AS_VERSION
// (scripts/build-identity.ts) so they carry that version's ABI. A server runs
// them with a module built with AMXTS_AS_VERSION too. The modules keep their
// own versions. When the command's CORE_RANGE does not take --as's version,
// the staged command takes `^<version>`, and the command and create-amxts go
// out as that version too: npm's release of the command stays as it was. The
// releases npm has before each package's version are copied into the local
// registry, where the @amxts packages live alone: a project of the earlier
// release installs there.
//
// A package is packed from a copy in dist-npm/stage/: the files `npm pack`
// takes from its folder, and its package.json with every `file:` link to one
// of these packages as `^<that package's version>`. The folders stay as they
// are, links and all. Besides:
//
// - wamrc: the binary of its system, the release's `wamrc-windows-x64.exe` or
//   `wamrc-linux-x64`, checked against that system's manifest
//   (`amxts-<system>.json`), and WAMR's and LLVM's licenses. The binaries come
//   from --wamrc <folder> (holding them, or `windows/` and `linux/` that do,
//   as dist-release/ does; a relative folder is the core's), else, for npm,
//   from the GitHub Release of v<version> through gh. A dry run and the local
//   registry take the wamrc built from this checkout, as test:release does:
//   dist-release/ when `bun run release` made it, else this system's local
//   build and runtime/build/linux's. It says which it took.
// - the core: the generated API, generated again in English
//   (--skip-generate takes what is there), and the patched AssemblyScript as
//   the build loads it - runtime/deps/assemblyscript with its dist, binaryen
//   and long - and, for the editor and a module's tsconfig, AssemblyScript's
//   typings patched as npm install patches them (scripts/patch-typings.ts),
//   bundled as its node_modules/assemblyscript.
// - a module: its owner plugin compiled for Windows and for Linux, fully
//   optimised, in prebuilt/ with the manifest a build checks it against
//   (scripts/prebuilt.ts) - compiled here, with this system's wamrc of the
//   release, which writes either system's .aot - and in the manifest its
//   surface, which a plugin that uses it compiles against.
// - a package without a LICENSE of its own gets its repository's.
//
// Publishing to npm refuses a folder with uncommitted changes and a wamrc
// built from one, skips a package npm has at its version already, and stops
// at the first failure, saying what went out: run again, it finishes the
// rest. It runs on a maintainer's machine, after the core's Publish workflow
// has made the GitHub Release its wamrc comes from: npm login first; npm asks
// for the one-time password, --otp passes one.
//
// The local registry is Verdaccio 6 from npm (installed into
// dist-npm/verdaccio-tool/), started in the background with no window, on
// localhost:4873; its config, storage and log are in dist-npm/verdaccio/. The
// @amxts packages and create-amxts live there, everything else comes from npm
// through it. --reset empties it first, so the same version can go in again,
// and takes the packages out of Bun's cache, which would install the earlier
// tarball of that version. AMXTS_NPM_DIR moves dist-npm/ and AMXTS_REGISTRY_PORT
// the port: a registry of its own beside this one (bun run test:release).
import type { Manifest } from './release-check';
import type { System } from './system';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { PREBUILT_DIR } from './prebuilt';
import { HOST_SYSTEM, SYSTEMS, wamrcPath } from './system';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NEIGHBOURS = resolve(CORE, '..');
const OUT = process.env.AMXTS_NPM_DIR ?? join(CORE, 'dist-npm');
const STAGE = join(OUT, 'stage');
const PACKS = join(OUT, 'packs');
const VERDACCIO = join(OUT, 'verdaccio');
/** Verdaccio itself, installed once: out of the storage --reset empties. */
const VERDACCIO_TOOL = join(OUT, 'verdaccio-tool');
const LOCAL_PORT = process.env.AMXTS_REGISTRY_PORT ?? '4873';
const LOCAL_REGISTRY = `http://localhost:${LOCAL_PORT}/`;
const REPO = process.env.AMXTS_RELEASE_REPO ?? 'amxts/amxts';
const WINDOWS = process.platform === 'win32';

/** The core checkout's version: wamrc's too. */
const CORE_VERSION = String(readJson(join(CORE, 'package.json')).version);
/** The version the core and wamrc go out as: the checkout's, or --as's. */
const VERSION = option(process.argv, '--as') ?? CORE_VERSION;

interface Package {
	name: string;
	dir: string;
	/** wamrc's package: the system its binary is for */
	wamrc?: System;
	/** The core and wamrc: of the core's version, or --as's. */
	core?: boolean;
	/** The command and create-amxts: of --as's version when the staged CORE_RANGE is. */
	command?: boolean;
}

/** The packages, in the order they go out: each one's dependencies before it. */
const PACKAGES: Package[] = [
	{ name: '@amxts/wamrc-win32-x64', dir: join(CORE, 'packages/wamrc/win32-x64'), wamrc: 'windows', core: true },
	{ name: '@amxts/wamrc-linux-x64', dir: join(CORE, 'packages/wamrc/linux-x64'), wamrc: 'linux', core: true },
	{ name: '@amxts/core', dir: CORE, core: true },
	{ name: '@amxts/config-core', dir: join(NEIGHBOURS, 'amxts-modules/config-core') },
	{ name: '@amxts/menu-core', dir: join(NEIGHBOURS, 'amxts-modules/menu-core') },
	{ name: '@amxts/resemiclip', dir: join(NEIGHBOURS, 'amxts-modules/resemiclip') },
	{ name: '@amxts/ftp', dir: join(NEIGHBOURS, 'amxts-modules/ftp') },
	{ name: '@amxts/cli', dir: join(NEIGHBOURS, 'amxts-cli/packages/cli'), command: true },
	{ name: 'create-amxts', dir: join(NEIGHBOURS, 'amxts-cli/packages/create-amxts'), command: true },
];

const NAMES = new Set(PACKAGES.map(pkg => pkg.name));

/** The release's wamrc of each system, as its assets and manifests name it. */
const WAMRC_ASSET: Record<System, string> = { windows: 'wamrc-windows-x64.exe', linux: 'wamrc-linux-x64' };
const WAMRC_FILE: Record<System, string> = { windows: 'wamrc.exe', linux: 'wamrc' };

/** The patched AssemblyScript as the build loads it, from runtime/deps/assemblyscript. */
const ASSEMBLYSCRIPT_FILES = [
	'package.json',
	'LICENSE',
	'NOTICE',
	'bin/asc.js',
	'dist/asc.js',
	'dist/assemblyscript.js',
	'node_modules/binaryen/package.json',
	'node_modules/binaryen/index.js',
	'node_modules/binaryen/LICENSE',
	'node_modules/long/package.json',
	'node_modules/long/index.js',
	'node_modules/long/LICENSE',
];

/** What the core's package cannot go without: the generated API and the compiler. */
const CORE_NEEDS = ['as/natives.ts', 'as/constants.ts', 'as/hooks.ts', 'runtime/natives.txt', 'amxmodx/base/include/amxmodx.inc'];

class PublishError extends Error {}

function readJson(path: string) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}

/** Runs a program, its output to the terminal or, `quiet`, returned. npm, npx and gh may be .cmd files on Windows. */
function run(file: string, args: string[], options: { cwd?: string; quiet?: boolean; env?: NodeJS.ProcessEnv; allowFail?: boolean } = {}) {
	const result = spawnSync(file, args, {
		cwd: options.cwd ?? CORE,
		env: options.env ?? process.env,
		encoding: 'utf8',
		stdio: options.quiet ? 'pipe' : 'inherit',
		shell: WINDOWS && !/[\\/]/.test(file),
		maxBuffer: 256 * 1024 * 1024,
	});
	if (result.error) throw new PublishError(`${file} did not start: ${result.error.message}`);
	if (result.status !== 0 && !options.allowFail) {
		throw new PublishError(`${file} ${args.join(' ')} failed (exit ${result.status})${options.quiet ? `\n${result.stderr}` : ''}`);
	}
	return { ok: result.status === 0, stdout: result.stdout ?? '' };
}

/**
 * `npm pack --json` in a folder: what it says of the one package - a list of it up to npm 11, an object by its name from npm 12.
 * npm may run the folder's `prepare` all the same, whose lines come before the JSON.
 */
function npmPack(dir: string, args: string[]) {
	const stdout = run('npm', ['pack', '--json', '--ignore-scripts', ...args], { cwd: dir, quiet: true }).stdout;
	const out = JSON.parse(stdout.slice(Math.max(0, stdout.search(/^[[{]/m))));
	return Array.isArray(out) ? out[0] : Object.values(out)[0] as any;
}

function sha256(file: string) {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/**
 * Whether a git checkout has changes to its tracked files. In CI a checkout is
 * the commit it was checked out at: what changes there is `bun run generate`
 * writing the tooltips into the facade's files, which a fresh clone has no
 * clean filter for (scripts/release.ts trusts it the same way).
 */
function dirty(dir: string) {
	if (process.env.GITHUB_ACTIONS === 'true') return false;
	return run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: dir, quiet: true }).stdout.trim() !== '';
}

function warn(text: string) {
	console.log(`  ! ${text}`);
}

// --- what goes in -------------------------------------------------------

/** What the packages go out as. */
interface Plan {
	/** Each package's version as its folder has it. */
	own: Map<string, string>;
	/** Each package's version as it goes out. */
	out: Map<string, string>;
	/** The staged command's CORE_RANGE, when it is not the checkout's. */
	coreRange: string | null;
}

/** Where the command says which cores it takes. */
const CORE_RANGE_FILE = 'src/core.mjs';
const coreRange = (code: string) => code.match(/CORE_RANGE = '([^']+)'/)?.[1];

/** Whether a caret range takes a version: `^0.2.0` takes 0.2.x from 0.2.0 up, `^1.2.0` 1.x from 1.2.0 up. */
function caretTakes(range: string, version: string) {
	const base = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)?.slice(1).map(Number);
	if (!base) return false;
	const [major, minor, patch] = base;
	const upper = major ? `${major + 1}.0.0` : minor ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
	return !before(version, base.join('.')) && before(version, upper);
}

/**
 * Each package's version as it goes out - its own, the core's and wamrc's
 * --as's - and the command's CORE_RANGE, which must take the core's version.
 * With --as beyond it, the staged command takes `^<--as>`, and the command
 * and create-amxts go out as --as's version: npm's release of the command
 * stays the one it was.
 */
function plan(): Plan {
	const own = new Map(PACKAGES.map((pkg) => {
		const { version } = readJson(join(pkg.dir, 'package.json'));
		if (!version) throw new PublishError(`${pkg.name} has no version in ${join(pkg.dir, 'package.json')}`);
		return [pkg.name, String(version)];
	}));
	const astray = PACKAGES.find(pkg => pkg.core && own.get(pkg.name) !== CORE_VERSION);
	if (astray) throw new PublishError(`${astray.name} is ${own.get(astray.name)}, the core ${CORE_VERSION}: wamrc goes out as the core's version`);
	const cli = PACKAGES.find(pkg => pkg.name === '@amxts/cli')!;
	const range = coreRange(readFileSync(join(cli.dir, CORE_RANGE_FILE), 'utf8')) ?? '(none)';
	if (!caretTakes(range, CORE_VERSION)) throw new PublishError(`the command's CORE_RANGE is ${range}, which does not take the core's ${CORE_VERSION}`);
	const restaged = !caretTakes(range, VERSION);
	const out = new Map(PACKAGES.map(pkg => [pkg.name, pkg.core || (pkg.command && restaged) ? VERSION : own.get(pkg.name)!]));
	return { own, out, coreRange: restaged ? `^${VERSION}` : null };
}

/**
 * A package.json as it is published: its version as it goes out, and every
 * `file:` or `link:` spec of one of these packages as `^<that package's
 * version>`. Every other spec of one of them must already be `^<its version>`.
 */
function publishedManifest(manifest: any, { own, out }: Plan) {
	const published = structuredClone(manifest);
	published.version = out.get(manifest.name);
	for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
		for (const [name, spec] of Object.entries<string>(published[field] ?? {})) {
			if (!NAMES.has(name)) {
				if (/^(?:file|link):/.test(spec)) throw new PublishError(`${published.name}: ${field} ${name} is ${spec}, a folder that is not one of the packages`);
				continue;
			}
			if (!/^(?:file|link):/.test(spec) && spec !== `^${own.get(name)}`) throw new PublishError(`${published.name}: ${field} ${name} is ${spec}, not ^${own.get(name)}, its version`);
			published[field][name] = `^${out.get(name)}`;
		}
	}
	return published;
}

/** The release's wamrc binaries: where they are, checked against their manifests. */
function wamrcBinaries(folder: string, strict: boolean): Record<System, string> {
	const found = {} as Record<System, string>;
	for (const system of SYSTEMS) {
		const dir = [folder, join(folder, system)].find(each => existsSync(join(each, WAMRC_ASSET[system])));
		if (!dir) throw new PublishError(`${WAMRC_ASSET[system]} is not in ${folder} or ${join(folder, system)}`);
		const file = join(dir, WAMRC_ASSET[system]);
		const manifestFile = join(dir, `amxts-${system}.json`);
		if (!existsSync(manifestFile)) throw new PublishError(`${manifestFile} is missing: it says which build ${WAMRC_ASSET[system]} is`);
		const manifest = readJson(manifestFile) as Manifest;
		const listed = manifest.files.find(each => each.name === WAMRC_ASSET[system]);
		if (!listed || listed.sha256 !== sha256(file)) throw new PublishError(`${file} is not the one ${manifestFile} lists`);
		const problems = [
			manifest.version !== CORE_VERSION && `it is from ${manifest.version}, the core is ${CORE_VERSION}`,
			manifest.dirty && 'it was built from a working tree with uncommitted changes',
		].filter(Boolean);
		for (const problem of problems) {
			if (strict) throw new PublishError(`${file}: ${problem}`);
			warn(`${WAMRC_ASSET[system]}: ${problem} - fine for a try, not for npm`);
		}
		// gh downloads it without its execute bit; this system's compiles the modules.
		if (system === HOST_SYSTEM && !WINDOWS) chmodSync(file, 0o755);
		found[system] = file;
	}
	return found;
}

/** The folder with the release's wamrc binaries, downloaded from the GitHub Release of the core's version. */
function releaseWamrcFolder(): string {
	const dir = join(OUT, 'release', `v${CORE_VERSION}`);
	mkdirSync(dir, { recursive: true });
	const download = run('gh', ['release', 'download', `v${CORE_VERSION}`, '--repo', REPO, '--pattern', 'wamrc-*', '--pattern', 'amxts-*.json', '--dir', dir, '--clobber'], { quiet: true, allowFail: true });
	if (!download.ok) throw new PublishError(`the GitHub Release v${CORE_VERSION} of ${REPO} gave no wamrc (gh release download failed): release the server files first, or pass --wamrc <folder>`);
	return dir;
}

/**
 * wamrc built from this checkout, for a try: dist-release/ when `bun run
 * release` made it, else this system's local build (`wamrcPath()`) and the
 * Linux one `bun run build:linux` makes. A wamrc of an earlier release does
 * not take this one's flags.
 */
function checkoutWamrc(): Record<System, string> {
	const release = join(CORE, 'dist-release');
	if (existsSync(release)) return wamrcBinaries(release, false);
	const built: Record<System, string> = { windows: join(CORE, 'runtime/deps/wamr/wamr-compiler/build/Release/wamrc.exe'), linux: join(CORE, 'runtime/build/linux/wamrc') };
	built[HOST_SYSTEM] = wamrcPath();
	const missing = Object.values(built).filter(file => !existsSync(file));
	if (missing.length) throw new PublishError(`no dist-release/ and no ${missing.join(', ')}: bun run release makes them all, or pass --wamrc <folder>`);
	return built;
}

/** The wamrc binaries the packages carry: --wamrc's, else the release's for npm and this checkout's for a try. */
function wamrcFor(strict: boolean, folder?: string): Record<System, string> {
	if (folder) return wamrcBinaries(resolve(CORE, folder), strict);
	return strict ? wamrcBinaries(releaseWamrcFolder(), true) : checkoutWamrc();
}

/** Copies a package's files, as `npm pack` takes them from its folder, into its stage. */
function stageFiles(pkg: Package, stage: string) {
	const listing = npmPack(pkg.dir, ['--dry-run']);
	for (const { path } of listing.files as { path: string }[]) {
		mkdirSync(dirname(join(stage, path)), { recursive: true });
		copyFileSync(join(pkg.dir, path), join(stage, path));
	}
	// wamrc is under WAMR's licenses, which stageWamrc() adds.
	if (!pkg.wamrc && !existsSync(join(stage, 'LICENSE'))) {
		const license = join(run('git', ['rev-parse', '--show-toplevel'], { cwd: pkg.dir, quiet: true }).stdout.trim(), 'LICENSE');
		if (!existsSync(license)) throw new PublishError(`${pkg.name} has no LICENSE, and neither has its repository`);
		copyFileSync(license, join(stage, 'LICENSE'));
	}
}

/** The core's additions: the patched AssemblyScript and the editor's typings. */
function stageCore(stage: string, manifest: any) {
	const missing = CORE_NEEDS.filter(file => !existsSync(join(stage, file)));
	if (missing.length) throw new PublishError(`the core's package would miss ${missing.join(', ')}: bun run setup:amxmodx, then bun run generate`);

	const compiler = join(CORE, 'runtime/deps/assemblyscript');
	for (const file of ASSEMBLYSCRIPT_FILES) {
		if (!existsSync(join(compiler, file))) throw new PublishError(`${join(compiler, file)} is missing: build the patched AssemblyScript (CONTRIBUTING.md)`);
		mkdirSync(dirname(join(stage, 'runtime/deps/assemblyscript', file)), { recursive: true });
		copyFileSync(join(compiler, file), join(stage, 'runtime/deps/assemblyscript', file));
	}

	// The typings npm install patched: .amxts/tsconfig.json and a module's
	// tsconfig (as/tsconfig.json) extend assemblyscript/std/assembly.json.
	const typings = join(CORE, 'node_modules/assemblyscript');
	const bundled = join(stage, 'node_modules/assemblyscript');
	for (const path of ['std', 'tsconfig-base.json', 'LICENSE', 'NOTICE']) cpSync(join(typings, path), join(bundled, path), { recursive: true });
	const { dependencies, devDependencies, scripts, bin, ...typingsManifest } = readJson(join(typings, 'package.json'));
	writeJson(join(bundled, 'package.json'), { ...typingsManifest, files: ['std/', 'tsconfig-base.json', 'NOTICE'] });

	manifest.files = [...manifest.files, 'runtime/deps/assemblyscript'];
	// Its scripts are the checkout's: they run what the package does not carry.
	delete manifest.scripts;
	delete manifest.devDependencies?.assemblyscript;
	manifest.dependencies = { ...manifest.dependencies, assemblyscript: typingsManifest.version };
	manifest.bundleDependencies = ['assemblyscript'];
}

/** wamrc's additions: its binary and the licenses it is under. */
function stageWamrc(stage: string, system: System, binary: string) {
	copyFileSync(binary, join(stage, WAMRC_FILE[system]));
	for (const license of ['WAMR-LICENSE', 'LLVM-LICENSE.TXT']) copyFileSync(join(CORE, 'runtime/licenses', license), join(stage, license));
}

interface Pack {
	name: string;
	version: string;
	file: string;
	size: number;
	unpackedSize: number;
	files: { path: string; size: number; mode: number }[];
}

/** A package in its stage: the folder it is packed from, and its package.json as it is published. */
interface Staged {
	name: string;
	dir: string;
	manifest: any;
}

/** The command's addition, with --as beyond its CORE_RANGE: the cores of --as's version. */
function stageCli(stage: string, range: string) {
	const file = join(stage, CORE_RANGE_FILE);
	writeFileSync(file, readFileSync(file, 'utf8').replace(/CORE_RANGE = '[^']+'/, `CORE_RANGE = '${range}'`));
}

/** Copies one package into its stage, with what it gets besides its own files. */
function stage(pkg: Package, wamrc: Record<System, string>, versions: Plan): Staged {
	const dir = join(STAGE, pkg.name.replace('/', '__'));
	const own = readJson(join(pkg.dir, 'package.json'));
	if (pkg.name !== own.name) throw new PublishError(`${pkg.dir} is ${own.name}, not ${pkg.name}`);
	stageFiles(pkg, dir);
	const manifest = publishedManifest(own, versions);
	if (pkg.wamrc) stageWamrc(dir, pkg.wamrc, wamrc[pkg.wamrc]);
	if (pkg.dir === CORE) stageCore(dir, manifest);
	if (pkg.name === '@amxts/cli' && versions.coreRange) stageCli(dir, versions.coreRange);
	writeJson(join(dir, 'package.json'), manifest);
	return { name: pkg.name, dir, manifest };
}

/**
 * The modules compiled into their stages' prebuilt/, for both systems, with
 * the manifest a build checks them against and their surfaces
 * (scripts/prebuilt.ts) - as a project that installed them would compile
 * them: one of its own in the system's temporary folder, outside the
 * checkouts, the staged modules in its node_modules, none of this machine's
 * AMXTS_ settings, and `wamrc` the release's. Either system's wamrc writes
 * either system's .aot. The core compiles them as the version they go out as.
 */
function prebuildModules(modules: Staged[], wamrc: string) {
	const project = join(tmpdir(), 'amxts-prebuilt');
	rmSync(project, { recursive: true, force: true });
	for (const each of modules) cpSync(each.dir, join(project, 'node_modules', each.name), { recursive: true });
	mkdirSync(join(project, 'plugins'));
	writeJson(join(project, 'package.json'), { name: 'amxts-prebuilt', private: true });
	writeFileSync(join(project, 'amxts.config.ts'), `export default defineConfig({ modules: ${JSON.stringify(modules.map(each => each.name))} });\n`);
	const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMXTS_')));
	run(process.execPath, [join(CORE, 'scripts/prebuilt.ts')], { cwd: project, env: { ...env, AMXTS_WAMRC: wamrc, AMXTS_AS_VERSION: VERSION } });
	for (const each of modules) {
		cpSync(join(project, 'node_modules', each.name, PREBUILT_DIR), join(each.dir, PREBUILT_DIR), { recursive: true });
		each.manifest.files = [...each.manifest.files, PREBUILT_DIR];
		writeJson(join(each.dir, 'package.json'), each.manifest);
	}
	rmSync(project, { recursive: true, force: true });
}

/** Packs a staged package into dist-npm/packs. */
function pack(staged: Staged): Pack {
	const packed = npmPack(staged.dir, ['--pack-destination', PACKS]);
	return { name: staged.name, version: staged.manifest.version, file: join(PACKS, packed.filename), size: packed.size, unpackedSize: packed.unpackedSize, files: packed.files };
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** What a tarball carries, by its top folders: `as/ 21 files 2.0 MB`. */
function describe(pack: Pack) {
	const groups = new Map<string, { count: number; size: number }>();
	for (const file of pack.files) {
		const top = file.path.includes('/') ? `${file.path.split('/')[0]}/` : file.path;
		const group = groups.get(top) ?? { count: 0, size: 0 };
		groups.set(top, { count: group.count + 1, size: group.size + file.size });
	}
	console.log(`\n${pack.name}@${pack.version}  ${mb(pack.size)} packed, ${mb(pack.unpackedSize)} unpacked, ${pack.files.length} files  (${pack.file})`);
	for (const [top, { count, size }] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
		console.log(`    ${top.padEnd(28)} ${String(count).padStart(5)} ${count === 1 ? 'file ' : 'files'} ${mb(size).padStart(9)}`);
	}
	for (const file of pack.files.filter(each => each.path.startsWith(`${PREBUILT_DIR}/`))) {
		console.log(`      ${file.path.padEnd(36)} ${`${(file.size / 1024).toFixed(0)} KB`.padStart(9)}`);
	}
}

/** Generates the API afresh, in English, and patches the editor's typings, as a checkout's install does. */
function prepareCore(skipGenerate: boolean) {
	const env = { ...process.env, AMXTS_DOCS_LANG: 'en' };
	if (!skipGenerate) run(process.execPath, ['run', 'generate'], { env });
	run(process.execPath, ['scripts/patch-typings.ts'], { env, quiet: true });
}

/** Stages and packs every package; `strict` is for npm - clean folders and a released wamrc. */
function packAll(options: { strict: boolean; wamrcFolder?: string; skipGenerate: boolean }): Pack[] {
	const unclean = [...new Set(PACKAGES.map(pkg => pkg.dir === CORE || pkg.wamrc ? CORE : pkg.dir))].filter(dirty);
	for (const dir of unclean) {
		if (options.strict) throw new PublishError(`${dir} has uncommitted changes: publish what is committed`);
		warn(`${dir} has uncommitted changes: they go into this pack`);
	}
	const versions = plan();
	const wamrc = wamrcFor(options.strict, options.wamrcFolder);
	for (const system of SYSTEMS) console.log(`wamrc for ${system}: ${wamrc[system]}`);
	prepareCore(options.skipGenerate);
	if (options.strict && dirty(CORE)) throw new PublishError('bun run generate changed the core\'s committed files: commit them in English first');

	rmSync(STAGE, { recursive: true, force: true });
	rmSync(PACKS, { recursive: true, force: true });
	mkdirSync(PACKS, { recursive: true });
	const staged = PACKAGES.map((pkg) => {
		console.log(`staging ${pkg.name}`);
		return stage(pkg, wamrc, versions);
	});
	if (versions.coreRange) console.log(`the command takes the cores of ${versions.coreRange}, and goes out as ${VERSION}`);
	console.log('compiling the modules for Windows and Linux');
	// A library has no plugin of its own to prebuild: plugins compile it in.
	prebuildModules(staged.filter(each => each.manifest.amxts?.module && !each.manifest.amxts.library), wamrc[HOST_SYSTEM]);
	const packs = staged.map(pack);
	packs.forEach(describe);
	const total = packs.reduce((sum, each) => sum + each.size, 0);
	console.log(`\n${packs.length} packages, ${mb(total)} packed, in ${PACKS}`);
	return packs;
}

// --- where it goes ------------------------------------------------------

/** Whether a registry has a package at a version. */
function has(name: string, registry: string, version: string) {
	const found = run('npm', ['view', `${name}@${version}`, 'version', '--registry', registry], { quiet: true, allowFail: true });
	return found.ok && found.stdout.trim() === version;
}

const NPM_REGISTRY = 'https://registry.npmjs.org/';

/** Whether one version comes before another: `0.1.0` before `0.2.0`; a pre-release tag is left out. */
function before(version: string, other: string) {
	const [a, b] = [version, other].map(each => each.split('-')[0].split('.').map(Number));
	return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) < 0;
}

/**
 * With --as, the releases npm has of each package before the version it goes
 * out as, copied into the local registry: the @amxts packages live only
 * there, so a project of the release on npm finds its own packages there too,
 * and `amxts upgrade` moves it on. They go under the tag `earlier`, which
 * leaves `latest` the staged ones'. A module whose version npm has already
 * goes in as staged - its links to --as's core - in place of npm's.
 */
function copyEarlierReleases(packs: Pack[], extra: string[]) {
	const dir = join(OUT, 'earlier');
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	for (const { name, version: staged } of packs) {
		const listed = run('npm', ['view', name, 'versions', '--json', '--registry', NPM_REGISTRY], { quiet: true, allowFail: true });
		if (!listed.ok) continue;
		const versions = [JSON.parse(listed.stdout)].flat().filter((version: string) => before(version, staged) && !has(name, LOCAL_REGISTRY, version));
		for (const version of versions) {
			const packed = npmPack(dir, [`${name}@${version}`, '--pack-destination', dir, '--registry', NPM_REGISTRY]);
			run('npm', ['publish', join(dir, packed.filename), '--tag', 'earlier', '--access', 'public', '--ignore-scripts', '--registry', LOCAL_REGISTRY, ...extra], { quiet: true });
			console.log(`copied ${name}@${version} from npm`);
		}
	}
}

/** Publishes the packs in order; stops at the first failure and says what went out. */
function publishAll(packs: Pack[], registry: string, extra: string[]) {
	const published: string[] = [];
	for (const pack of packs) {
		if (has(pack.name, registry, pack.version)) {
			console.log(`${pack.name}@${pack.version} is in ${registry} already - skipped`);
			continue;
		}
		console.log(`\npublishing ${pack.name}@${pack.version} to ${registry}`);
		const result = run('npm', ['publish', pack.file, '--access', 'public', '--ignore-scripts', '--registry', registry, ...extra], { allowFail: true });
		if (!result.ok) {
			throw new PublishError([
				`publishing ${pack.name} failed.`,
				published.length ? `Published: ${published.join(', ')}` : 'Nothing was published.',
				`Not published: ${packs.slice(packs.indexOf(pack)).map(each => each.name).join(', ')} - run it again once the cause is fixed; what is there is skipped.`,
			].join('\n'));
		}
		published.push(`${pack.name}@${pack.version}`);
	}
	console.log(`\npublished: ${published.join(', ') || 'nothing new'}`);
}

const VERDACCIO_CONFIG = `# The local registry of bun run publish:local: the amxts packages live here,
# everything else comes from npm through it.
storage: ./storage
auth:
  htpasswd:
    file: ./htpasswd
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
    # npm's tarballs pass through, not kept: two installs at once would both store one
    cache: false
packages:
  '@amxts/*':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
  'create-amxts':
    access: $all
    publish: $authenticated
    unpublish: $authenticated
  '**':
    access: $all
    publish: $authenticated
    proxy: npmjs
# the wamrc packages are tens of megabytes
max_body_size: 1000mb
log: { type: stdout, format: pretty, level: warn }
`;

const PID_FILE = join(VERDACCIO, 'verdaccio.pid');

async function registryUp() {
	try {
		return (await fetch(`${LOCAL_REGISTRY}-/ping`, { signal: AbortSignal.timeout(1000) })).ok;
	} catch {
		return false;
	}
}

/** Stops the local registry this script started. */
function stopRegistry() {
	if (!existsSync(PID_FILE)) return false;
	const pid = Number(readFileSync(PID_FILE, 'utf8'));
	// Its process group on Linux, its tree on Windows.
	if (WINDOWS) {
		spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
	} else {
		try {
			process.kill(-pid);
		} catch {}
	}
	rmSync(PID_FILE, { force: true });
	return true;
}

/** Starts the local registry, unless it answers already; `reset` empties its storage first. */
async function startRegistry(reset: boolean) {
	if (reset) {
		stopRegistry();
		rmSync(VERDACCIO, { recursive: true, force: true });
	}
	if (await registryUp()) return;
	mkdirSync(VERDACCIO, { recursive: true });
	writeFileSync(join(VERDACCIO, 'config.yaml'), VERDACCIO_CONFIG);
	const log = openSync(join(VERDACCIO, 'verdaccio.log'), 'a');
	console.log(`starting Verdaccio on ${LOCAL_REGISTRY} (its log: ${join(VERDACCIO, 'verdaccio.log')})`);
	const bin = join(VERDACCIO_TOOL, 'node_modules/verdaccio/bin/verdaccio');
	if (!existsSync(bin)) run('npm', ['install', 'verdaccio@6', '--prefix', VERDACCIO_TOOL, '--no-audit', '--no-fund'], { quiet: true });
	// Node itself, detached and without a shell: on Windows a detached shell has
	// no console, and whatever it starts would open a window of its own.
	const child = spawn('node', [bin, '--config', join(VERDACCIO, 'config.yaml'), '--listen', LOCAL_PORT], {
		cwd: VERDACCIO,
		detached: true,
		stdio: ['ignore', log, log],
		windowsHide: true,
	});
	child.unref();
	writeFileSync(PID_FILE, String(child.pid));
	for (const started = Date.now(); Date.now() - started < 180_000;) {
		if (await registryUp()) return;
		await new Promise(done => setTimeout(done, 1000));
	}
	throw new PublishError(`Verdaccio did not answer on ${LOCAL_REGISTRY} in 3 minutes: see ${join(VERDACCIO, 'verdaccio.log')}`);
}

/** A token for the local registry: its user `amxts`, made on first use, the token kept beside its storage. */
async function localToken(): Promise<string> {
	const saved = join(VERDACCIO, 'token');
	if (existsSync(saved)) return readFileSync(saved, 'utf8').trim();
	const response = await fetch(`${LOCAL_REGISTRY}-/user/org.couchdb.user:amxts`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name: 'amxts', password: 'amxts-local', type: 'user', roles: [] }),
	});
	const body = await response.json() as { token?: string; error?: string };
	if (!body.token) throw new PublishError(`the local registry gave no token: ${body.error ?? response.status} - bun run publish:local --reset starts it afresh`);
	writeFileSync(saved, body.token);
	return body.token;
}

/**
 * Takes the packages out of Bun's cache, which keeps a tarball by its name,
 * version and registry: a version published again would install as it was.
 */
function clearBunCache() {
	const cache = process.env.BUN_INSTALL_CACHE_DIR ?? join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'install', 'cache');
	if (!existsSync(cache)) return;
	const ours = readdirSync(cache).filter(name => name === '@amxts' || name.startsWith('create-amxts'));
	for (const name of ours) rmSync(join(cache, name), { recursive: true, force: true });
	if (ours.length) console.log(`took the packages out of Bun's cache (${cache})`);
}

/**
 * Takes the installs of `npm create amxts` / `npx` out of npm's _npx folder:
 * npx keeps create-amxts and the command it pulls in there, and runs them
 * again whatever the registry now holds - `npm cache clean` leaves them.
 */
function clearNpxCache() {
	const cache = spawnSync('npm', ['config', 'get', 'cache'], { encoding: 'utf8', shell: true }).stdout?.trim();
	const npx = cache ? join(cache, '_npx') : '';
	if (!npx || !existsSync(npx)) return;
	const ours = readdirSync(npx).filter(dir => ['create-amxts', '@amxts'].some(name => existsSync(join(npx, dir, 'node_modules', name))));
	for (const dir of ours) rmSync(join(npx, dir), { recursive: true, force: true });
	if (ours.length) console.log(`took create-amxts out of npx's cache (${npx})`);
}

/** Packs every package and publishes them to the local registry. */
async function publishLocal(options: { reset: boolean; wamrcFolder?: string; skipGenerate: boolean }) {
	const packs = packAll({ strict: false, wamrcFolder: options.wamrcFolder, skipGenerate: options.skipGenerate });
	if (options.reset) {
		clearBunCache();
		clearNpxCache();
	}
	await startRegistry(options.reset);
	const auth = [`--${LOCAL_REGISTRY.replace(/^http:/, '')}:_authToken=${await localToken()}`];
	if (VERSION !== CORE_VERSION) copyEarlierReleases(packs, auth);
	publishAll(packs, LOCAL_REGISTRY, auth);
}

/** The packages --only names, checked; null without it - all of them. */
function onlyNames(names: string | undefined): string[] | null {
	if (!names) return null;
	const wanted = names.split(/[\s,]+/).filter(Boolean);
	const unknown = wanted.filter(name => !NAMES.has(name));
	if (unknown.length) throw new PublishError(`--only ${unknown.join(', ')}: not one of ${[...NAMES].join(', ')}`);
	return wanted;
}

function option(args: string[], name: string) {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
}

async function main(args: string[]) {
	const [command] = args;
	if (VERSION !== CORE_VERSION) {
		if (command !== 'local') throw new PublishError('--as is for the local registry only: npm gets the versions the checkouts have');
		if (!/^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i.test(VERSION)) throw new PublishError(`--as ${VERSION}: a version, such as 0.2.0`);
	}
	const wamrcFolder = option(args, '--wamrc');
	const skipGenerate = args.includes('--skip-generate');
	if (command === 'npm' && args.includes('--dry-run')) {
		packAll({ strict: false, wamrcFolder, skipGenerate });
		console.log('\nA dry run: nothing was published. bun run publish:check tries these packages as a user would.');
	} else if (command === 'npm') {
		if (!run('npm', ['whoami'], { quiet: true, allowFail: true }).ok) throw new PublishError('npm has no user logged in: npm login, then run it again');
		const wanted = onlyNames(option(args, '--only'));
		const packs = packAll({ strict: true, wamrcFolder, skipGenerate }).filter(pack => !wanted || wanted.includes(pack.name));
		const otp = option(args, '--otp');
		publishAll(packs, NPM_REGISTRY, otp ? ['--otp', otp] : []);
	} else if (command === 'local' && args.includes('--stop')) {
		console.log(stopRegistry() ? 'the local registry is stopped' : 'no local registry of this script is running');
	} else if (command === 'local') {
		await publishLocal({ reset: args.includes('--reset'), wamrcFolder, skipGenerate });
		const lines = [
			'',
			`The packages are in the local registry, ${LOCAL_REGISTRY}. Try them as a user, in a folder outside the repositories,`,
			'with every install of that shell going to it:',
			'',
			`  PowerShell:  $env:NPM_CONFIG_REGISTRY = "${LOCAL_REGISTRY}"`,
			`  bash:        export NPM_CONFIG_REGISTRY=${LOCAL_REGISTRY}`,
			'',
			'  npm create amxts@latest my-test        (or: pnpm create amxts@latest my-test, bun x create-amxts@latest my-test)',
			'  cd my-test',
			'  npx amxts dev',
			'',
			'After --reset, clear npm\'s cache of the old packages too (Bun\'s is cleared): npm cache clean --force',
			'Stop the registry: bun run publish:local --stop',
		];
		if (VERSION !== CORE_VERSION) {
			lines.push(
				'',
				`The core is ${VERSION}, the checkout ${CORE_VERSION}: a server loads the modules' plugins with a module built as ${VERSION} -`,
				`AMXTS_AS_VERSION=${VERSION} bun run generate, then build the module; bun run generate and a build again take it back to ${CORE_VERSION}.`,
			);
		}
		console.log(lines.join('\n'));
	} else {
		throw new PublishError('bun run publish:npm [--dry-run] [--otp <code>] [--only <names>] | bun run publish:local [--reset | --stop] [--as <version>]; both take --wamrc <folder> and --skip-generate');
	}
}

try {
	await main(process.argv.slice(2));
} catch (error) {
	process.stderr.write(`\n${error instanceof PublishError ? error.message : (error as Error).stack}\n`);
	process.exit(1);
}
