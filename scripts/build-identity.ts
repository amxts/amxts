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
// What a plugin and the module have to agree on: the imports the hood
// declares (`@external("env", ...)` in as/, by name and by the types they
// take and give) and the natives table wamrc compiles direct calls against
// (runtime/natives.txt). A plugin of another ABI calls an import the module
// does not have, or has with another signature, and the server crashes; so
// the module loads no plugin whose ABI is not its own.
//
// It is the version and a hash of those - `0.2.0+abi.1a2b3c4d`. Not the
// commit: a module from a release and the plugins built with the core from
// npm, or a module package's prebuilt plugin, are of one release but not
// built from one checkout. The version tells releases apart; the hash, builds
// of one version whose imports differ. The same release rebuilt is the same
// ABI, and a change that is only the facade's own code needs no rebuilt
// plugins.

/**
 * Raised by hand when the module and the facade change how they talk without
 * an import changing its name or its types: what a cell of an event means,
 * an export the module calls.
 */
const ABI_REVISION = 1;

/** The custom section of a plugin that holds its ABI: wamrc copies it into the .aot. */
export const ABI_SECTION = 'amxts.abi';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// One import: `@external("env", "ent_get") declare function _entGet(id: i32, offset: i32): i32;`.
const IMPORT = /@external\("env",\s*"([^"]+)"\)\s*(?:export\s+)?declare\s+function\s+\w+\s*\(([^)]*)\)\s*(?::([^;]+))?;/g;

/** The imports a file of the hood declares: `ent_get(i32,i32)i32`, the parameters' names left out. */
export function importsOf(code: string): string[] {
	return [...code.matchAll(IMPORT)].map(([, name, params, result]) => {
		const types = params.split(',').map(param => param.slice(param.indexOf(':') + 1).trim()).filter(Boolean);
		return `${name}(${types.join(',')})${result?.trim() ?? 'void'}`;
	});
}

declare const AMXTS_ABI: string;

/**
 * The ABI this core compiles plugins for, which the module it builds loads.
 * amxts-compile on a server has the module's own built in; anywhere else it
 * is read off the hood's files, through the tracked reads, so a cached
 * compile is made again when they change.
 */
export function abiIdentity(): string {
	if (typeof AMXTS_ABI === 'string') return AMXTS_ABI;
	const plugins = join(CORE, 'as');
	const imports = tracked.readdirSync(plugins).filter(file => file.endsWith('.ts')).flatMap(file => importsOf(tracked.readFileSync(join(plugins, file), 'utf8')));
	const natives = tracked.readFileSync(join(CORE, 'runtime/natives.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
	const hash = createHash('sha256').update([`revision ${ABI_REVISION}`, ...imports.sort(), ...natives.sort()].join('\n')).digest('hex');
	return `${coreVersion()}+abi.${hash.slice(0, 8)}`;
}
