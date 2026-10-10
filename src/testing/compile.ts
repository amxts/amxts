import type { NativesBeside, PluginNative } from '../../scripts/plugin-natives';
// A plugin compiled for a test: the same AssemblyScript, the same facade and
// the same flags as scripts/compile.ts, stopping at the .wasm - bun runs that
// directly, so wamrc and its .aot are not needed.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { ascMain } from '../../scripts/asc';
import { ASYNC_EXPORTS, BASE_EXPORTS, compileToWasm, finishing, HoistImports, HOOD_EXPORTS, importsOf } from '../../scripts/compile';
import { playerFieldsBuild } from '../../scripts/player-fields';
import { nativesBeside, nativesTransform, setNativesBeside } from '../../scripts/plugin-natives';
import { ascPath, CONFIG_FILE, currentProjectDir, sourcesFor } from '../../scripts/project';
import { targetTransforms } from '../../scripts/reapi-events';
import { envBuild } from '../../scripts/server-env';
import { sharedModulesBuild } from '../../scripts/shared-modules';
import { existsSync, hashOf } from '../../scripts/tracked-fs';
import { cached } from './compile-cache';
import { PLUGINS_ROOT } from './tables';

declare const WebAssembly: any;

/** A compiled plugin, and the natives its `export function`s became. */
export interface Compiled {
	module: any;
	natives: PluginNative[];
	/** The binary, for a plugin that awaits: the scheduler reads its function table. */
	binary: Uint8Array;
	/** Whether it carries the coroutine scheduler's exports (as/promise.ts). */
	async: boolean;
	/** Its env() calls as the section amxts.env writes them, a line a name (scripts/server-env.ts). */
	env: string[];
}

const compiled = new Map<string, Promise<Compiled>>();

/** Forgets what this run compiled, so that the next compile() asks the disk cache again. */
export function forgetCompiled() {
	compiled.clear();
}

/**
 * The plugin at `source` as a WebAssembly.Module, compiled once per test run.
 *
 * One flag differs from the server build: `--exportStart`. On the server WAMR
 * runs a plugin's top level while it instantiates, and its natives can read
 * the plugin's memory while that happens. A JavaScript import cannot - the
 * instance, and the memory with it, exists only once instantiation is over -
 * so the top level is exported as `_start` and the fake calls it straight
 * afterwards. The order of everything is the same.
 */
export function compile(source: string): Promise<Compiled> {
	const path = moduleOwner(source) ?? resolve(source);
	// A module's owner is ~/<name>.ts in every project, with the options that
	// project's amxts.config.ts merges into it: the project and its config are
	// part of what was compiled.
	const config = join(currentProjectDir(), CONFIG_FILE);
	const key = [path, currentProjectDir(), existsSync(config) ? statSync(config).mtimeMs : 'none'].join('\0');
	let module = compiled.get(key);

	if (!module) {
		module = build(path);
		compiled.set(key, module);
	}

	return module;
}

/**
 * A module package by name - "@amxts/menu-core" - is its owner plugin: its
 * natives, or the one the build generates for a module without them.
 */
function moduleOwner(source: string): string | null {
	if (!/^@?[\w.-]+(?:\/[\w.-]+)?$/.test(source) || source.endsWith('.ts')) return null;
	const sources = sourcesFor(PLUGINS_ROOT);
	const pkg = sources.project.modules.find(each => each.name === source);
	if (pkg?.library) throw new Error(`${source} is a library: it runs inside the plugins that import it - load one of them`);
	return pkg ? sources.ownerSource(pkg) : null;
}

/** A compile as the disk cache keeps it: no WebAssembly.Module, and an error as its text. */
type Built = (Omit<Compiled, 'module'> & { beside: NativesBeside }) | { error: string };

/**
 * `AMXTS_GC_STRESS=1` in the environment: every plugin and snippet a test
 * compiles runs a step of the collector on every allocation
 * (`ASC_GC_STRESS`), so a value a function holds without a shadow-stack
 * slot is freed at once and its test fails. Part of the cache's key.
 */
const GC_STRESS = process.env.AMXTS_GC_STRESS ? ['--use', 'ASC_GC_STRESS=1'] : [];

/** `args` with GC_STRESS, unless they ask for it themselves. */
export function stressed(args: string[]): string[] {
	return args.includes('ASC_GC_STRESS=1') ? args : [...args, ...GC_STRESS];
}

/** A failure worth keeping on disk is the compiler's; a file that could not be opened is not. */
const PASSING = /\b(?:EBUSY|EPERM|EACCES|EMFILE|ENFILE|EAGAIN)\b/;

function lasting(built: Built): boolean {
	return !('error' in built) || !PASSING.test(built.error);
}

/**
 * The plugin compiled - or taken from the disk cache (./compile-cache.ts),
 * when an earlier run compiled it from the same files.
 */
async function build(path: string): Promise<Compiled> {
	const built = await cached<Built>(['plugin', process.cwd(), path, PLUGINS_ROOT, GC_STRESS], async () => {
		try {
			const fresh = await buildFresh(path);
			return { ...fresh, beside: nativesBeside(fresh.natives) };
		} catch (problem) {
			return { error: String((problem as Error).message ?? problem) };
		}
	}, lasting);
	if ('error' in built) throw new Error(built.error);
	const { beside, ...compiled } = built;
	setNativesBeside(compiled.natives, beside);
	return { ...compiled, module: new WebAssembly.Module(compiled.binary) };
}

/**
 * A plugin that makes a promise is compiled again with the scheduler's
 * exports, and run through Asyncify when it can park, as scripts/compile.ts
 * builds it for a server - so an async function parks and resumes here as it
 * does there.
 */
async function buildFresh(path: string): Promise<Omit<Compiled, 'module'>> {
	const first = await buildWith(path, BASE_EXPORTS);
	if (!importsOf(first.binary).has('env.co_wake')) return first;

	const second = await buildWith(path, ASYNC_EXPORTS);
	return { ...second, async: true };
}

async function buildWith(path: string, hoodExports: string): Promise<Omit<Compiled, 'module'>> {
	const sources = sourcesFor(PLUGINS_ROOT);
	if (!existsSync(path) && !sources.exists(path)) throw new Error(`no plugin at ${path}`);

	// A module package's plugin compiles as ~/<name>.ts (scripts/project.ts).
	if (sources.project.problems.length) throw new Error(sources.project.problems.join('\n'));
	const entry = sources.entry(path);
	let binary: Uint8Array | undefined;
	const natives: PluginNative[] = [];
	const playerFields = playerFieldsBuild();
	const env = envBuild();
	// scripts/compile.ts's shared modules: a proxy for one another plugin owns.
	const shared = await sharedModulesBuild(PLUGINS_ROOT, entry);

	const { error, stderr } = await ascMain(
		stressed([entry, HOOD_EXPORTS, '--outFile', 'plugin.wasm', '--optimize', '--exportTable', '--exportStart', '_start']),
		{
			// scripts/compile.ts's readFile: the `~/` alias, the hood's exports and the fields plugins add to Player.
			readFile(filename: string, baseDir: string): string | null {
				if (filename.replace(/\\/g, '/').endsWith(HOOD_EXPORTS)) return hoodExports;

				const file = ascPath(PLUGINS_ROOT, filename, baseDir);
				const text = sources.read(file);
				if (text === null) return null;
				const shown = relative('.', (sources.real(file) ?? file));
				env.read(shown, text);
				return shared.read(file, playerFields.read(shown, text));
			},
			// Only the binary is wanted; nothing is written to disk.
			writeFile(_: string, contents: string | Uint8Array) {
				if (typeof contents !== 'string') binary = contents;
			},
			listFiles: () => [],
			transforms: [HoistImports, nativesTransform(entry, natives, PLUGINS_ROOT), playerFields.transform, shared.transform, ...targetTransforms(sources.project.config?.target), finishing(hoodExports, null)],
		},
	);

	if (sources.problems.length) throw new Error(sources.problems.join('\n'));
	if (env.problems.length) throw new Error(env.problems.join('\n'));

	if (error || !binary) {
		throw new Error(`${relative(process.cwd(), path)} does not compile:\n${stderr.toString() || String(error?.message ?? error)}`);
	}

	return { natives, binary, async: false, env: env.entries() };
}

/**
 * scripts/compile.ts's compileToWasm - the server build's first half - with
 * the disk cache in front: the problem it reports, or null and `wasm` written.
 */
export async function compileWasmFile(plugin: { source: string; root: string }, wasm: string, names = false): Promise<string | null> {
	const made = await cached<{ problem: string } | { binary: Uint8Array }>(
		['wasm', process.cwd(), resolve(plugin.source), resolve(plugin.root), resolve(wasm), names],
		async () => {
			const problem = await compileToWasm(plugin, wasm, names);
			return problem === null ? { binary: new Uint8Array(readFileSync(wasm)) } : { problem };
		},
		made => !('problem' in made) || !PASSING.test(made.problem),
	);
	if ('problem' in made) return made.problem;
	writeFileSync(wasm, made.binary);
	return null;
}

/** What asc made of sources held in memory: the binary and the text files it wrote, or what it printed. */
export interface SourcesCompiled {
	error: string | null;
	binary: Uint8Array | null;
	/** Text outputs by the name asc was given: `--textFile probe.wat`. */
	text: Record<string, string>;
}

/**
 * asc - the patched one, as the build runs it - on `sources` alone, a test's
 * snippet of the compiler at work, with the disk cache in front. Nothing is
 * read from disk, so the sources and `args` are the whole key. `finished`
 * adds what a full build does after asc's optimiser (finishing).
 */
export async function compileSources(args: string[], sources: Record<string, string>, finished = false): Promise<SourcesCompiled> {
	return cached<SourcesCompiled>(['sources', stressed(args), sources, finished], async () => {
		let binary: Uint8Array | null = null;
		const text: Record<string, string> = {};
		const { error, stderr } = await ascMain(stressed(args), {
			readFile: (name: string) => sources[name] ?? null,
			writeFile(name: string, contents: string | Uint8Array) {
				if (typeof contents === 'string') text[name] = contents;
				else binary = contents;
			},
			listFiles: () => [],
			transforms: finished ? [finishing(BASE_EXPORTS, null)] : [],
		});
		return error ? { error: stderr.toString(), binary: null, text } : { error: null, binary, text };
	});
}

/**
 * wamrc from `wasm` to `aot`, with the disk cache in front - keyed by the
 * binary, wamrc itself and its arguments: its exit status and what it printed.
 */
export async function compileAot(wamrc: string, args: string[], wasm: string, aot: string): Promise<{ status: number | null; output: string }> {
	const made = await cached<{ status: number | null; output: string; aot?: Uint8Array }>(
		['aot', hashOf(readFileSync(wasm)), hashOf(readFileSync(wamrc)), args],
		async () => {
			const run = spawnSync(wamrc, [...args, '-o', aot, wasm], { encoding: 'utf-8' });
			const output = `${run.stdout}${run.stderr}`;
			return run.status === 0 ? { status: 0, output, aot: new Uint8Array(readFileSync(aot)) } : { status: run.status, output };
		},
		made => made.status === 0,
	);
	if (made.aot) writeFileSync(aot, made.aot);
	return { status: made.status, output: made.output };
}
