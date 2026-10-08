import type { PluginNative } from './plugin-natives';
import type { Sources } from './project';
import type { PluginMap } from './source-map';
import type { System } from './system';
import { spawnSync } from 'node:child_process';

// Compiles one plugin: .ts in, .aot out.
//
// Both halves of the project use this one function - `bun run plugins` here,
// and amxts-compile.exe on a server - so that a plugin compiles the same way
// in both places. In particular the `~/` alias, which is ours rather than
// AssemblyScript's and lives in the readFile hook below.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The Binaryen asc itself runs on - the same copy, so the compiler a server
// gets carries one - for the one pass asc does not run: Asyncify.
// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import * as assemblyscript from '../runtime/deps/assemblyscript/dist/assemblyscript.js';
// @ts-ignore - its types are beside it, under a path tsconfig does not map
import binaryen from '../runtime/deps/assemblyscript/node_modules/binaryen/index.js';
import { ascMain } from './asc';
import { ABI_SECTION, abiIdentity } from './build-identity';
import { LEAF_NATIVES } from './leaf-natives';
import { playerFieldsBuild } from './player-fields';
import { includeName, nativeContract, nativesTransform, pawnInclude } from './plugin-natives';
import { ascPath, sourcesFor } from './project';
import { targetTransforms } from './reapi-events';
import { sharedModulesBuild } from './shared-modules';
import { displayName, MAP_SECTION, mapText, pluginMap, withSection } from './source-map';
import { HOST_SYSTEM, TARGET_ABI } from './system';

export interface Plugin {
	/** The .ts to compile. */
	source: string;
	/** The .aot to write. */
	output: string;
	/** What `~/` means: the folder plugins and their libraries live in. */
	root: string;
	wamrc: string;
	signatures: string;
	/**
	 * The system of the server that loads it: the .aot is written in that
	 * system's object format (scripts/system.ts). This machine's by default.
	 */
	system?: System;
	/**
	 * Compiled for a development loop (`amxts dev`): Binaryen's -O1 in place
	 * of asc's full optimisation, and wamrc at -O0 - a few seconds for a small
	 * plugin rather than ten. It does the same, a little slower.
	 */
	quick?: boolean;
}

/** Binaryen's optimisation level: a quick build's, and a full one's - asc's own --optimize. */
const OPTIMIZE = { quick: 1, full: 3 };

/** The size, in Binaryen's nodes, up to which a full build inlines any function (inlineSmall). */
const INLINE_SIZE = 30;

/** The hood's exports every plugin carries; see compilePlugin. */
export const HOOD_EXPORTS = '__amxts_exports.ts';

/**
 * The second entry of a plugin that never waits: the hood has nothing to
 * export, but its globals - Promise, defineModule - are there for any
 * plugin, one that imports nothing included.
 */
export const BASE_EXPORTS = 'import "~/facade";\n';

/**
 * What the module's coroutine scheduler calls, for a plugin that uses
 * Promise or async/await (as/promise.ts, runtime/src/module.cpp). Only such a
 * plugin carries them: exporting them from every plugin would compile the
 * whole scheduler into plugins that never wait for anything.
 */
export const ASYNC_EXPORTS = BASE_EXPORTS + [
	'export function __co_next(): i32 { return __co_next_job(); }',
	'export function __co_done(outcome: i32): void { __co_resumed(outcome); }',
	'export function __co_stack(): usize { return __co_sp(); }',
	'export function __co_stack_set(sp: usize): void { __co_set_sp(sp); }',
	'export function __co_save(id: i32, lo: usize, hi: usize): void { __co_park(id, lo, hi); }',
	'export function __co_saved(id: i32): usize { return __co_parked(id); }',
	'export function __co_restore(id: i32, lo: usize): void { __co_unpark(id, lo); }',
	'',
].join('\n');

/**
 * A transform that moves the imports at the end of a file - the ones the
 * build adds (scripts/auto-imports.ts), after the file's last line - to its
 * top, as ES modules run an imported file before the one that imports it:
 * asc compiles an imported file's top level where the import stands. The
 * imports a file writes itself stay where they are.
 */
export class HoistImports {
	afterParse(parser: any): void {
		for (const source of parser.sources) {
			const statements: any[] = source.statements;
			const last = statements.findLastIndex(statement => statement.kind !== assemblyscript.NodeKind.Import);
			if (last < 0 || last === statements.length - 1) continue;
			source.statements = [...statements.slice(last + 1), ...statements.slice(0, last + 1)];
		}
	}
}

/** The import a coroutine parks in - the one Asyncify unwinds from. */
export const SUSPEND_IMPORT = 'env.co_suspend';

/** The import of a plugin that makes a promise: it is compiled again with ASYNC_EXPORTS. */
const WAKE_IMPORT = 'env.co_wake';

/**
 * The imports that use the plugin's memory they are given only while they
 * run, and keep no address of it: an object whose address goes only to them
 * can be made in its function's frame (makeStackObjects).
 */
const BORROWING_IMPORTS = new Set(['env.ent_vector']);

/**
 * The arguments of Pawn's natives that the module's thunk copies - text in
 * or out, an array - and so keeps no address of, by the native's import:
 * read off runtime/natives.txt, which the server kit has beside its
 * executable. An object whose address goes only there, a field of the
 * options a function reads, is no reason to keep it on the heap.
 */
const COPIED_ARGUMENTS: ReadonlyMap<string, number[]> = (() => {
	const file = [
		process.env.AMXTS_NATIVES,
		join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'runtime/natives.txt'),
		join(dirname(process.execPath), 'natives.txt'),
	].find(each => each && existsSync(each));
	if (!file) return new Map();
	return new Map(readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line) => {
		const [name, , crossing] = line.split(' ');
		if (!crossing || line.startsWith('#') || crossing === 'leaf') return [];
		return [[`env.${name}`, crossing.split(',').flatMap((each, index) => (each === 'v' ? [] : [index]))]];
	}));
})();

/**
 * The imports that never run the plugin's code - the abort, which does not
 * return, and those marked `@leaf` - so a call to one runs no step of the
 * collector: a function whose objects are all made in its frame and that
 * calls nothing else keeps no shadow stack (makeStackObjects).
 */
const QUIET_IMPORTS = new Set(['env.abort', 'env.ent_vector', ...[...LEAF_NATIVES].map(name => `env.${name}`)]);

/**
 * What wamrc keeps for a failed call's stack (scripts/source-map.ts): each
 * function's frame with its index and the offset of the call it is in, or of
 * the trap - a store at each call, a push and a pop at each function. No
 * values: with them WAMR's frames are no longer the small ones. A dev build's
 * alone (`amxts dev`, a quick build): measured, the frames took a fifth to a
 * third of a call-heavy plugin's time, so a full build keeps none, and an
 * error there says its message - and a throw or an abort its place.
 */
const STACK_FLAGS = ['--enable-dump-call-stack', '--call-stack-features=bounds-checks,ip,func-idx,trap-ip'];

/**
 * The map goes into the .aot either way, and so does the ABI the plugin is
 * compiled against, which the module checks before it loads it
 * (scripts/build-identity.ts).
 */
const SECTIONS = `--emit-custom-sections=${MAP_SECTION},${ABI_SECTION}`;

/**
 * The CPU the machine code is for: a Pentium 4's, SSE2. LLVM's i386 left
 * alone does fractions on the x87, where a number made whole - every `%`,
 * every number given where a cell goes - costs several times as much. Every
 * CPU a game server runs on has SSE2.
 */
const CPU = '--cpu=pentium4';

/**
 * Where compilePlugin writes the Pawn include for a plugin's natives: beside
 * the .aot, named after the plugin - or, for a plugin that implements an
 * include (a contract), under that include's own name, so a Pawn plugin's
 * `#include` of it works whatever the module is called.
 */
export function includePath(output: string, natives: PluginNative[] = []): string {
	const contract = nativeContract(natives);
	const name = contract ? basename(contract.file).replace(/\.inc$/, '') : includeName(basename(output).replace(/\.aot$/, ''));
	return resolve(dirname(output), `${name}.inc`);
}

/** What went wrong, or null when the plugin compiled. `natives` gets the plugin's natives. */
export async function compilePlugin(plugin: Plugin, natives: PluginNative[] = []): Promise<string | null> {
	const wasm = plugin.output.replace(/\.aot$/, '.wasm');
	mkdirSync(dirname(plugin.output), { recursive: true });

	const problem = await compileToWasm(plugin, wasm, false, natives);
	if (problem) return problem;
	return compileToMachineCode(plugin, wasm, natives);
}

/**
 * The second half of compilePlugin: wamrc, from `wasm` to the plugin's .aot
 * for its system, with the include of its `natives` beside it. One wasm
 * makes the .aot of either system (scripts/prebuilt.ts makes both).
 */
export function compileToMachineCode(plugin: Plugin, wasm: string, natives: PluginNative[]): string | null {
	// Written beside the .aot and moved over it once it passed: a server that
	// reads the build folder where it is - the Docker one - reloads a plugin
	// the moment its file changes, and must never see half of one; and a
	// plugin that fails keeps the last good build.
	mkdirSync(dirname(plugin.output), { recursive: true });
	const part = `${plugin.output}.part`;
	const wamrc = (level: string[]) => spawnSync(plugin.wamrc, [
		'--target=i386',
		`--target-abi=${TARGET_ABI[plugin.system ?? HOST_SYSTEM]}`,
		`--native-signatures=${plugin.signatures}`,
		...(plugin.quick ? STACK_FLAGS : []),
		SECTIONS,
		CPU,
		...level,
		'-o',
		part,
		wasm,
	], { encoding: 'utf-8' });
	let compile = wamrc(plugin.quick ? ['--opt-level=0'] : []);
	// At -O0 a big function keeps a big stack frame, and for a frame over
	// 4 KB LLVM calls _chkstk on Windows, which the module's loader does not
	// have ("resolve symbol _chkstk failed"): such a plugin - menu-core is
	// one - is compiled again at wamrc's own level. The .aot names the symbol.
	if (plugin.quick && compile.status === 0 && readFileSync(part).includes('_chkstk')) compile = wamrc([]);

	const out = `${compile.stdout}${compile.stderr}`;

	if (compile.status !== 0) {
		rmSync(part, { force: true });
		// A crash says nothing: still a failure, not an empty problem
		return out.trim() || `wamrc stopped (${compile.status ?? compile.signal}) without a word`;
	}

	// A signature that disagrees with its import is not an error to wamrc: it
	// drops that native to the generic path, many times slower than the direct
	// call, and says so only in this warning. That means the API and the module have
	// drifted apart, which is worth refusing rather than running slowly.
	if (/failed to check signature/.test(out)) {
		rmSync(part, { force: true });
		return `a native signature does not match its import - this plugin kit does not belong to this module\n${out}`;
	}

	writeInclude(plugin.output, natives);
	renameSync(part, plugin.output);
	return null;
}

/**
 * The plugin's `export function`s, as a Pawn plugin includes them, beside
 * its .aot. One that exports nothing leaves no include behind, not even a
 * stale one; neither does a contract, whose include has a name of its own.
 */
export function writeInclude(output: string, natives: PluginNative[]): void {
	const include = includePath(output, natives);
	const ownName = includePath(output);
	if (include !== ownName) rmSync(ownName, { force: true });
	if (natives.length) writeFileSync(include, pawnInclude(basename(output).replace(/\.aot$/, ''), natives));
	else rmSync(include, { force: true });
}

/**
 * The first half of compilePlugin: the plugin's .ts to `wasm`, ready for
 * wamrc, with its map (scripts/source-map.ts). Tests run the result as it is;
 * with `names` it keeps its function names, so a test can see what Asyncify
 * instrumented. With `natives`, the plugin's `export function`s become
 * natives, listed there.
 */
export async function compileToWasm(
	plugin: Pick<Plugin, 'source' | 'root' | 'quick'>,
	wasm: string,
	names = false,
	natives?: PluginNative[],
): Promise<string | null> {
	// A quick build leaves the optimising to one Binaryen pass afterwards.
	const flags = [...(plugin.quick ? [] : ['--optimize']), ...(names ? ['--debug'] : []), '--sourceMap'];
	const level = plugin.quick ? OPTIMIZE.quick : null;
	let made = await compileWasm(plugin, BASE_EXPORTS, flags, level, natives);

	// A plugin that makes a promise - an async function, fetch, sleep - has
	// the host drive its jobs, so it is compiled again with the scheduler's
	// exports.
	if (typeof made !== 'string' && importsOf(made.binary).has(WAKE_IMPORT)) {
		if (natives) natives.length = 0;
		made = await compileWasm(plugin, ASYNC_EXPORTS, flags, level, natives);
	}
	if (typeof made === 'string') return made;
	mkdirSync(dirname(resolve(wasm)), { recursive: true });
	writeFileSync(wasm, withSection(withSection(made.binary, MAP_SECTION, mapText(made.map)), ABI_SECTION, abiIdentity()));
	return null;
}

/**
 * The last transform of a compile: Binaryen's work after asc's own, on the
 * module asc is about to write - a quick build's optimisation at `level`,
 * and Asyncify for a plugin whose coroutines can park. It runs there rather
 * than on the written binary so that the source map asc writes beside it is
 * of the code that runs: Binaryen reads a binary without its map. asc has no
 * hook after its optimiser, so this wraps the module's emitBinary, which asc
 * calls once to write the module. `done` gets the functions' names, by wasm
 * index, as they are written.
 *
 * A plugin that makes a promise but was compiled without the scheduler's
 * exports is compiled again (compileToWasm), so nothing is done for it.
 */
export function finishing(hoodExports: string, level: number | null, done: (first: number, names: string[]) => void = () => {}) {
	return {
		afterCompile(module: any) {
			// Read before asc's optimiser, which folds the global away.
			const dataEnd = (binaryen.getExpressionInfo(binaryen.getGlobalInfo(module.getGlobal(DATA_END)).init) as binaryen.ConstInfo).value as number;
			const emit = module.emitBinary.bind(module);
			module.emitBinary = (url?: string) => {
				const imports = new Set(functionsOf(module).map(each => each.imported));
				if (hoodExports === ASYNC_EXPORTS || !imports.has(WAKE_IMPORT)) {
					exportCallGlobals(module);
					if (level === null) {
						inlineSmall(module);
						// A number that only ever holds a whole number within i32 is kept in an i32.
						assemblyscript.keepWholeNumbers(module.ptr);
						makeStackObjects(module, dataEnd);
					}
					if (imports.has(SUSPEND_IMPORT)) asyncify(module, level ?? OPTIMIZE.full);
					else if (level !== null) optimize(module, level);
				}
				const functions = functionsOf(module);
				const first = functions.filter(each => each.imported).length;
				done(first, functions.slice(first).map(each => each.name));
				return emit(url);
			};
		},
	};
}

/**
 * The module's functions in the order of their wasm indexes - Binaryen
 * writes the imported ones first, then the rest, each in its own order -
 * with each one's name, and `module.name` when it is imported.
 */
function functionsOf(module: any): { name: string; imported: string | null }[] {
	const functions = Array.from({ length: module.getNumFunctions() }, (_, i) => binaryen.getFunctionInfo(module.getFunctionByIndex(i)));
	const ordered = [...functions.filter(info => info.module), ...functions.filter(info => !info.module)];
	return ordered.map(info => ({ name: info.name, imported: info.module ? `${info.module}.${info.base}` : null }));
}

/**
 * A full build's small functions inlined where they are called. A function
 * that keeps a shadow-stack frame calls ~stack_check, its guard, and
 * Binaryen does not inline a function that calls another unless it is
 * tiny - so a small function with a frame stayed a call.
 */
function inlineSmall(module: any) {
	const always = binaryen.getAlwaysInlineMaxSize();
	binaryen.setOptimizeLevel(OPTIMIZE.full);
	binaryen.setShrinkLevel(0);
	binaryen.setAlwaysInlineMaxSize(INLINE_SIZE);
	module.runPasses(['inlining-optimizing']);
	binaryen.setAlwaysInlineMaxSize(always);
}

/** Where the plugin's static data ends, and its shadow stack's bottom. */
const DATA_END = '~lib/memory/__data_end';

/**
 * A full build's objects that never leave the function that makes them,
 * made in its frame rather than on the heap - `player.origin.x` and the
 * options literal of `player.showHud(text, { hold: 2 })` allocate nothing -
 * by the compiler's pass over the inlined code, which knows which
 * parameters each function keeps. A function an async function's coroutine
 * may park in keeps its objects on the heap.
 */
function makeStackObjects(module: any, dataEnd: number) {
	const functions = functionsOf(module);
	const named = (imports: Set<string>) => functions.filter(each => each.imported && imports.has(each.imported)).map(each => each.name);
	// An import's name with an argument's index, for one argument.
	const copied = functions.flatMap(each => (COPIED_ARGUMENTS.get(each.imported ?? '') ?? []).map(index => `${each.name}#${index}`));
	assemblyscript.makeStackObjects(module.ptr, [...named(BORROWING_IMPORTS), ...copied], named(new Set([SUSPEND_IMPORT])), dataEnd, named(QUIET_IMPORTS));
}

/**
 * The globals a call of a function value sets, which the module sets too
 * when it calls a listener itself rather than the plugin's walk of the
 * listeners (the module's Handler.via): the closure's variables, how many
 * arguments the call passes, the player an async function started there runs
 * under. Exported under the names the module looks up; one the plugin has
 * not got is not needed.
 */
const CALL_GLOBALS = [
	['~lib/function/__env', '__env'],
	['~argumentsLength', '__argumentsLength'],
	['~lib/~/promise/__co_ambient_player', '__co_ambient_player'],
];

function exportCallGlobals(module: any) {
	for (const [name, exported] of CALL_GLOBALS) {
		if (module.getGlobal(name)) module.addGlobalExport(name, exported);
	}
}

/** Binaryen's optimisation at `level`: what a quick build runs in place of asc's. */
function optimize(module: any, level: number) {
	binaryen.setOptimizeLevel(level);
	binaryen.setShrinkLevel(0);
	module.optimize();
}

/** What asc made of a plugin: the binary, and its map. */
interface Compiled {
	binary: Uint8Array;
	map: PluginMap;
}

/**
 * asc, from the plugin's .ts to a binary and its map, with `hoodExports` as
 * the second entry and `level` a quick build's (finishing). With `natives`,
 * the plugin's `export function`s become its natives and are listed there;
 * without, they stay plain wasm exports - what a test host that calls a
 * fixture's functions by name wants. What went wrong, as text.
 */
async function compileWasm(
	plugin: Pick<Plugin, 'source' | 'root'>,
	hoodExports: string,
	flags: string[],
	level: number | null,
	natives?: PluginNative[],
): Promise<Compiled | string> {
	// --exportTable is not optional: a handler reaches the module as its index
	// in the function table, and without this asc emits no table at all, so
	// every index points at nothing.
	// asc is given the entry relative to the root it is told to read from, so
	// that a plugin in a subfolder and the alias below resolve the same way.
	// A module package's plugin compiles as ~/<name>.ts, a project's plugin as
	// its place under ~/ (scripts/project.ts).
	const sources = sourcesFor(plugin.root);
	if (sources.project.problems.length) return sources.project.problems.join('\n');
	const entry = sources.entry(plugin.source);
	// Player's fields that plugins add, from every file the plugin reaches (scripts/player-fields.ts).
	const playerFields = playerFieldsBuild();
	// The modules it reaches that another plugin owns come as proxies (scripts/shared-modules.ts).
	let shared: Awaited<ReturnType<typeof sharedModulesBuild>>;
	try {
		shared = await sharedModulesBuild(plugin.root, entry);
	} catch (problem) {
		return String((problem as Error).message ?? problem);
	}

	let binary: Uint8Array | null = null;
	let sourceMap = '';
	let functions = { first: 0, names: [] as string[] };
	const { error, stderr } = await ascMain(
		[
			entry,
			// A second entry nobody writes: what the hood exports - the
			// coroutine scheduler's functions, for a plugin that waits (only an
			// entry file's exports reach the wasm).
			HOOD_EXPORTS,
			'--outFile',
			'plugin.wasm',
			'--exportTable',
			...flags,
		],
		{
			readFile(filename: string, baseDir: string): string | null {
				if (filename.replace(/\\/g, '/').endsWith(HOOD_EXPORTS)) return hoodExports;

				// `~/` is the plugins folder: ascPath answers the alias.
				const path = ascPath(plugin.root, filename, baseDir);
				const text = sources.read(path);
				return text === null ? null : shared.read(path, playerFields.read(relative('.', (sources.real(path) ?? path)), text));
			},

			// The binary and its source map, for compileToWasm to write as one.
			writeFile(_: string, contents: string | Uint8Array): void {
				if (typeof contents === 'string') sourceMap = contents;
				else binary = contents;
			},

			listFiles(): string[] {
				return [];
			},

			transforms: [
				HoistImports,
				...(natives ? [nativesTransform(entry, natives, plugin.root)] : []),
				playerFields.transform,
				shared.transform,
				// A project for plain HLDS listens for no event reapi alone delivers.
				...targetTransforms(sources.project.config?.target),
				finishing(hoodExports, level, (first, names) => (functions = { first, names })),
			],
		},
	);

	// An import of a module the config does not list says so first: asc's
	// "not found" after it is only the consequence.
	if (sources.problems.length) return [...sources.problems, stderr.toString()].join('\n').trim();

	// A transform's refusal - a native whose signature cannot cross - is an
	// error with nothing written to stderr.
	if (error || !binary) return stderr.toString() || String(error?.message ?? error);
	// A quick build is a dev build (`amxts dev`): its map names the project's
	// folder, where the module finds the sources to show a failed line. A
	// build to ship names none - the machine's folders are not the server's.
	const root = level === null ? '' : sources.project.dir;
	return { binary, map: pluginMap(sourceMap, file => fileName(sources, plugin.root, file), functions.first, functions.names.map(displayName), root) };
}

/**
 * A file of asc's source map as the plugin's map names it: as the project
 * names it - `plugins/shop.ts`, `node_modules/@amxts/core/as/facade.ts` - or
 * null for AssemblyScript's standard library, whose lines would double the
 * map and mean nothing to an author; its functions keep their names.
 */
function fileName(sources: Sources, root: string, file: string): string | null {
	// asc reads `~/` - the plugins folder - as a library of its own
	const hood = /^~lib\/~\/(.*)$/.exec(file);
	if (!hood && file.startsWith('~lib/')) return null;
	const path = hood ? resolve(root, hood[1]) : ascPath(root, file, '');
	return relative(sources.project.dir, sources.real(path) ?? path).replace(/\\/g, '/');
}

/**
 * Asyncify, so that a coroutine can park in co_suspend and be rewound later.
 *
 * What to instrument is Binaryen's own call graph from that one import: the
 * async function bodies, __await, and whatever calls them directly. Indirect
 * calls are left out (asyncify-ignore-indirect), and that is exact rather
 * than a guess: an async function is always entered by the host - its
 * prologue asks co_spawn to call it - so no `await` is ever reached through
 * a function table, and a listener that is async returns to its caller at its
 * first `await` like any other call. Nothing can be missing from the list,
 * which is the failure that hangs rather than traps. Then the optimiser at
 * `level` - asc's own, or a quick build's lower one - so the rest of the
 * module comes out as it went in.
 */
function asyncify(module: any, level: number) {
	try {
		binaryen.setPassArgument('asyncify-imports', SUSPEND_IMPORT);
		binaryen.setPassArgument('asyncify-ignore-indirect', '1');
		module.runPasses(['asyncify']);
		optimize(module, level);
		if (!module.validate()) throw new Error('Asyncify produced an invalid module');
	} finally {
		binaryen.setPassArgument('asyncify-imports', null);
		binaryen.setPassArgument('asyncify-ignore-indirect', null);
	}
}

/** `module.name` of every function a wasm binary imports. */
export function importsOf(wasm: Uint8Array): Set<string> {
	const names = new Set<string>();
	let at = 8;

	const u32 = () => {
		let result = 0;
		let shift = 0;
		for (;;) {
			const byte = wasm[at++];
			result |= (byte & 0x7F) << shift;
			if ((byte & 0x80) === 0) return result >>> 0;
			shift += 7;
		}
	};
	const text = () => {
		const length = u32();
		const value = new TextDecoder().decode(wasm.subarray(at, at + length));
		at += length;
		return value;
	};

	while (at < wasm.length) {
		const id = wasm[at++];
		const size = u32();
		const end = at + size;
		if (id !== 2) {
			at = end;
			continue;
		}
		for (let count = u32(); count > 0; count--) {
			const name = `${text()}.${text()}`;
			const kind = wasm[at++];
			if (kind === 0) {
				u32();
				names.add(name);
			} else if (kind === 1) {
				at++;
				const flags = u32();
				u32();
				if (flags & 1) u32();
			} else if (kind === 2) {
				const flags = u32();
				u32();
				if (flags & 1) u32();
			} else if (kind === 3) {
				at += 2;
			} else {
				break;
			}
		}
		break;
	}
	return names;
}
