// The build a module and the compiler beside it on a server are of: the
// version and the commit, as a release's manifest names them -
// `0.2.0+1bf291c0ab`, SemVer's build metadata.
//
// `bun run generate` writes it into the module (runtime/src/embedded.h), and
// `bun run serverkit` builds amxts-compile with the one read back from there,
// so the two agree whenever they come from one build. Before it compiles a
// plugin's source, the module asks the compiler for its build
// (`amxts-compile --version`) and refuses one of another: the module writes
// the API a plugin imports, and a compiler of another release reads it with
// another AssemblyScript, which fails with errors that say nothing of why.
//
// A plugin carries an identity of its own: the ABI it was compiled against,
// which the module checks before it loads the plugin (abiIdentity, below).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import pkg from '../package.json';
import * as tracked from './tracked-fs';

/**
 * The version the core builds as: its package.json's, or AMXTS_AS_VERSION's.
 * `bun run publish:local --as 0.2.0` stages the packages as another version
 * than the checkout's; the modules it compiles for them, and a module built
 * for a server that runs their plugins, are of that version only with it set.
 */
export function coreVersion(): string {
	return process.env.AMXTS_AS_VERSION || pkg.version;
}

/** This checkout's build: the version, and the commit when git knows it. */
export function buildIdentity(): string {
	const git = spawnSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf-8' });
	const commit = git.status === 0 ? git.stdout.trim() : '';
	return commit ? `${coreVersion()}+${commit}` : coreVersion();
}

/** A string the generated module carries (`#define <name> "..."`), or null before `bun run generate`. */
function moduleDefine(name: string): string | null {
	const header = './runtime/src/embedded.h';
	if (!existsSync(header)) return null;
	return new RegExp(`^#define ${name} "([^"]*)"$`, 'm').exec(readFileSync(header, 'utf-8'))?.[1] ?? null;
}

/** The build the generated module carries, or null before `bun run generate`. */
export const moduleBuild = () => moduleDefine('AMXTS_BUILD');

/** The ABI the generated module loads plugins of, or null before `bun run generate`. */
export const moduleAbi = () => moduleDefine('AMXTS_ABI');

/** The `--define`s that build amxts-compile as of `build`, stamping plugins with `abi`. */
export function buildDefines(build: string, abi: string): string[] {
	return [`--define=AMXTS_BUILD=${JSON.stringify(build)}`, `--define=AMXTS_ABI=${JSON.stringify(abi)}`];
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

/**
 * The natives table a compile reads: AMXTS_NATIVES, else the core's, else
 * the one beside amxts-compile on a server, which the module wrote there.
 */
export function nativesFile(): string | undefined {
	return [process.env.AMXTS_NATIVES, join(CORE, 'runtime/natives.txt'), join(dirname(process.execPath), 'natives.txt')].find(each => each && existsSync(each));
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

declare const AMXTS_ABI: string;

/**
 * The ground this core compiles plugins on, which the module it builds loads
 * plugins of: `0.3.1+abi.1a2b3c4d`. amxts-compile on a server has the
 * module's own built in; anywhere else it is read off the patches, through
 * the tracked reads, so a cached compile is made again when they change.
 */
export function abiIdentity(): string {
	if (typeof AMXTS_ABI === 'string') return AMXTS_ABI;
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
	const used = [...imports].filter(each => each.startsWith('env.')).map(each => shapes.get(each.slice(4)) ?? each.slice(4));
	return [abiIdentity(), ...used.sort()].join('\n');
}

/**
 * The imports of the line's last release, each with its shape, relative to
 * the core: `bun run abi:lock` writes it when a version is released.
 */
export const ABI_LOCK = 'runtime/abi-lock.txt';

/**
 * The shapes of a released lock (runtime/abi-lock.txt: the version, then
 * every import of it) that a natives table has no longer, or has otherwise,
 * while the two are of one line: a plugin built for that release would be
 * refused by this one's module. Another line owes the lock nothing.
 */
export function shapeChanges(lock: string, natives: string, version = coreVersion()): string[] {
	const [released = '', ...shapes] = tableLines(lock);
	if (releaseLine(released) !== releaseLine(version)) return [];
	const now = new Set(tableLines(natives));
	return shapes.filter(shape => !now.has(shape));
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
