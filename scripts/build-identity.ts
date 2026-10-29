// The build a module is of: the version and the commit, as a release's
// manifest names them - `0.2.0+1bf291c0ab`, SemVer's build metadata.
// `npm run generate` writes it into the module (runtime/src/embedded.h).
//
// A plugin carries an identity of its own: the ABI it was compiled against,
// which the module checks before it loads the plugin (abiIdentity, below).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { moduleAbiOf } from '../src/system.mjs';
import * as tracked from './tracked-fs';

/**
 * The version the core builds as: its package.json's, or AMXTS_AS_VERSION's.
 * `npm run publish:local -- --as 0.2.0` stages the packages as another version
 * than the checkout's; the modules it compiles for them, and a module built
 * for a server that runs their plugins, are of that version only with it set.
 */
export function coreVersion(): string {
	// Through the tracked reads: a compile cached before a version bump
	// carries the old version in its ABI, so it is made again.
	return process.env.AMXTS_AS_VERSION || (JSON.parse(tracked.readFileSync(join(CORE, 'package.json'), 'utf8')) as { version: string }).version;
}

/** This checkout's build: the version, and the commit when git knows it. */
export function buildIdentity(): string {
	const git = spawnSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf-8' });
	const commit = git.status === 0 ? git.stdout.trim() : '';
	return commit ? `${coreVersion()}+${commit}` : coreVersion();
}

// ---------------------------------------------------------------- the ABI
//
// What a plugin and the module have to agree on, in two parts.
//
// The ground: the machine code's - the WAMR patch, which both wamrc and the
// module's runtime are built with, and the versions of WAMR and
// AssemblyScript the patches are for (AssemblyScript lays out the strings the
// module reads) - and ABI_REVISION. It is the version and a hash of those,
// `0.3.1+abi.1a2b3c4d`, which the module carries as its own (AMXTS_ABI).
//
// The imports: every function the plugin imports, each with its shape - its
// line of the natives table (runtime/natives.txt), which holds every import
// the module has, the hood's own and Pawn's natives alike: the types wamrc
// compiles a direct call with, how the module's thunk passes the arguments,
// and `leaf`. A plugin carries the ground's identity, then the shape of each
// import it uses (pluginAbi), and the module loads it when the line and the
// ground are its own and it has every import with the same shape. So a
// plugin built by any patch of a line loads on any patch's module that has
// what it uses, and a module package's prebuilt plugin serves the whole line:
// a patch adds imports, and only what uses them needs it. An import keeps
// its shape for the line (shapeChanges): a change of shape is a new import.
//
// The full version stays in the identity to be read: the release a module
// is of (src/system.mjs), what a refusal names. Not the commit: a module from
// a release and the plugins built with the core from npm, or a module
// package's prebuilt plugin, are of one release but not built from one
// checkout. Not the facade's code: it is compiled into each plugin, which
// carries its own, so plugins of two patches talk only through the imports -
// and, between a module and the plugins that use it, through the module's
// surface, whose own hash the module checks when a plugin first calls it
// (scripts/shared-modules.ts).

/**
 * Raised by hand when the module and the facade change how they talk without
 * an import's shape or the patches changing: what a cell of an event means,
 * an export the module calls, how a value crosses between plugins
 * (as/remote.ts), what names a plugin in a shared module's call (2: its run,
 * not its index). A patch release must not raise it.
 */
const ABI_REVISION = 2;

/** The custom section of a plugin that holds its ABI: wamrc copies it into the .aot. */
export const ABI_SECTION = 'amxts.abi';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The natives table a compile reads: AMXTS_NATIVES, else the core's. */
export function nativesFile(): string | undefined {
	return [process.env.AMXTS_NATIVES, join(CORE, 'runtime/natives.txt')].find(each => each && existsSync(each));
}

/** A natives table's lines, but its comments: `add (iiii)i [a1>,v,s,v leaf`. */
const tableLines = (text: string) => text.split(/\r?\n/).filter(line => line && !line.startsWith('#'));

/** The name of an import's shape: `add` of `add (iiii)i [a1>,v,s,v leaf`. */
export const importName = (shape: string) => shape.split(' ', 1)[0];

/** Every import there is, by name, with its shape. */
export function importShapes(): Map<string, string> {
	const file = nativesFile();
	const lines = file ? tableLines(tracked.readFileSync(file, 'utf8')) : [];
	return new Map(lines.map(line => [importName(line), line]));
}

/**
 * The ground this core compiles plugins on, which the module it builds loads
 * plugins of: `0.3.1+abi.1a2b3c4d`. It is read off the patches, through the
 * tracked reads, so a cached compile is made again when they change.
 */
export function abiIdentity(): string {
	// A patch by its name, which carries the upstream version; WAMR's by its content too.
	const dir = join(CORE, 'runtime/patches');
	const patches = tracked.readdirSync(dir).filter(file => file.endsWith('.patch')).map(file => (file.startsWith('wamr-') ? `${file}\n${tracked.readFileSync(join(dir, file), 'utf8')}` : file));
	const hash = createHash('sha256').update([`revision ${ABI_REVISION}`, ...patches.sort()].join('\n')).digest('hex');
	return `${coreVersion()}+abi.${hash.slice(0, 8)}`;
}

/**
 * The ABI section of a plugin that imports `imports` (`env.add`, as a wasm
 * names them): the identity, then the shape of each import, a line each.
 */
export function pluginAbi(imports: Iterable<string>): string {
	const shapes = importShapes();
	const used = [...imports].filter(each => each.startsWith('env.')).map(each => each.slice(4));
	// A table older than the facade lacks its new imports: a plugin carrying
	// a bare name is refused by every module, so the build stops here.
	const missing = used.filter(name => !shapes.has(name));
	if (missing.length > 0) throw new Error(`the natives table has no ${missing.join(', ')}: it is older than the core's code - run npm run generate`);
	return [abiIdentity(), ...used.map(name => shapes.get(name)!).sort()].join('\n');
}

/**
 * The imports of the line's last release, each with its shape, relative to
 * the core: `npm run abi:lock` writes it when a version is released.
 */
export const ABI_LOCK = 'runtime/abi-lock.txt';

/**
 * The shapes of a released lock (runtime/abi-lock.txt: the version, then
 * every import of it) that a natives table has no longer, or has otherwise,
 * while the two are of one line: a plugin built for that release would be
 * refused by this one's module. Another line owes the lock nothing.
 */
export function shapeChanges(lock: string, natives: string, version = coreVersion()): string[] {
	const [released = '', ...shapes] = lockShapes(lock);
	if (releaseLine(released) !== releaseLine(version)) return [];
	const now = new Set(tableLines(natives));
	return shapes.filter(shape => !now.has(shape));
}

/** A lock's id of a variadic native: `call 49 log_amx`. */
const CALL = /^call (\d+) (\w+)$/;

/** A lock's version and shapes, without its `call` lines. */
const lockShapes = (lock: string) => tableLines(lock).filter(line => !CALL.test(line));

/**
 * The dispatcher's ids as/natives.ts gives, the natives by id: `log_amx` at
 * 49 of `export const NATIVE_log_amx: i32 = 49;`. A plugin passes the id to
 * the dispatcher (the import `call`) to reach a variadic native.
 */
export function dispatcherIds(natives: string): string[] {
	const ids: string[] = [];
	for (const [, name, id] of natives.matchAll(/^export const NATIVE_(\w+): i32 = (\d+);\r?$/gm)) ids[Number(id)] = name;
	return ids;
}

/**
 * The dispatcher's ids of a released lock, the natives by id, while the lock
 * and `version` are of one line; none for another line, which may renumber.
 */
export function lockedCalls(lock: string, version = coreVersion()): string[] {
	if (releaseLine(lockShapes(lock)[0] ?? '') !== releaseLine(version)) return [];
	const calls: string[] = [];
	for (const [, id, name] of tableLines(lock).map(line => CALL.exec(line)).filter(call => call != null)) calls[Number(id)] = name;
	return calls;
}

/**
 * The ids of a released lock that `ids` (dispatcherIds) gives to another
 * native, or to none: a plugin built for that release would call the wrong
 * native, in silence. A new variadic native takes an id after the locked ones.
 */
export function callChanges(lock: string, ids: string[], version = coreVersion()): string[] {
	return lockedCalls(lock, version).flatMap((name, id) => (ids[id] === name ? [] : [`call ${id} ${name}`]));
}

/** The line of a version, `major.minor`: `0.3` of `0.3.1` and of `0.3.0-rc.1`. */
export function releaseLine(version: string): string {
	return version.split('.', 2).join('.');
}

/**
 * What the module compares of an identity: its line and its ground's hash,
 * `0.3+abi.1a2b3c4d` of `0.3.1+abi.1a2b3c4d`. The modules of two identities
 * with one abiLine load each other's plugins, of the imports they both have.
 */
export function abiLine(abi: string): string {
	const at = abi.indexOf('+');
	return at < 0 ? abi : `${releaseLine(abi.slice(0, at))}${abi.slice(at)}`;
}

/**
 * The imports of a plugin's ABI section that a released lock has not with
 * that shape, and the release: a core newer than it made them - a checkout
 * past the release - and a server of that release refuses the plugin.
 */
export function unlockedImports(abi: string, lock: string): { release: string; imports: string[] } {
	const [release = '', ...shapes] = lockShapes(lock);
	const locked = new Set(shapes);
	return { release, imports: abi.split('\n').slice(1).filter(shape => !locked.has(shape)).map(importName) };
}

/** What a module file loads plugins of: its ABI and its imports, each with its shape. */
export interface ModuleAbi {
	abi: string;
	shapes: Map<string, string>;
}

/** A line of the natives table: `add (iiii)i [a1>,v,s,v leaf`. */
const SHAPE = /^[A-Z_$][\w$.]* \([iF]*\)[iF]?(?: .*)?$/i;

/**
 * What a module file loads, read off the file as moduleAbiOf reads its ABI:
 * the natives table it carries (g_nativesTable, runtime/src/embedded.h) is
 * strings of whole lines, so its shapes are the strings' lines of that form.
 * Null when the file carries no ABI.
 */
export function moduleAbi(file: string): ModuleAbi | null {
	const abi = moduleAbiOf(file);
	if (!abi) return null;
	const lines = readFileSync(file, 'latin1').split(/[\0\n]/).filter(line => SHAPE.test(line));
	return { abi, shapes: new Map(lines.map(line => [importName(line), line])) };
}

/**
 * Why a module refuses a plugin whose ABI section is `abi`, as its AbiFits
 * decides - another line or ground, an import it has not or has of another
 * shape - or null when it loads it.
 */
export function refusal(abi: string, module: ModuleAbi): string | null {
	const [identity = '', ...used] = abi.split('\n');
	if (!identity) return 'it carries no ABI: built by an older amxts';
	if (abiLine(identity) !== abiLine(module.abi)) return `built for amxts ${identity}, the module is ${module.abi}`;
	const missing = used.filter(shape => !module.shapes.has(importName(shape))).map(importName);
	const other = used.filter(shape => module.shapes.get(importName(shape)) !== shape).map(importName).filter(name => !missing.includes(name));
	const why = [missing.length && `the module has no ${missing.join(', ')}`, other.length && `it was built for another shape of ${other.join(', ')}`].filter(Boolean);
	return why.length ? why.join('; ') : null;
}
