import type { PluginNative } from './plugin-natives';
import type { System } from './system';
import { spawnSync } from 'node:child_process';

// Compiles one plugin: .ts in, .aot out.
//
// Both halves of the project use this one function - `bun run plugins` here,
// and amxts-compile.exe on a server - so that a plugin compiles the same way
// in both places. In particular the `~/` alias, which is ours rather than
// AssemblyScript's and lives in the readFile hook below.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
// The Binaryen asc itself runs on - the same copy, so the compiler a server
// gets carries one - for the one pass asc does not run: Asyncify.
// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import * as assemblyscript from '../runtime/deps/assemblyscript/dist/assemblyscript.js';
// @ts-ignore - its types are beside it, under a path tsconfig does not map
import binaryen from '../runtime/deps/assemblyscript/node_modules/binaryen/index.js';
import { ascMain } from './asc';
import { playerFieldsBuild } from './player-fields';
import { includeName, nativeContract, nativesTransform, pawnInclude } from './plugin-natives';
import { ascPath, sourcesFor } from './project';
import { sharedModulesBuild } from './shared-modules';
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

	// Written beside the .aot and moved over it once it passed: a server that
	// reads the build folder where it is - the Docker one - reloads a plugin
	// the moment its file changes, and must never see half of one; and a
	// plugin that fails keeps the last good build.
	const part = `${plugin.output}.part`;
	const compile = spawnSync(plugin.wamrc, [
		'--target=i386',
		`--target-abi=${TARGET_ABI[plugin.system ?? HOST_SYSTEM]}`,
		`--native-signatures=${plugin.signatures}`,
		...(plugin.quick ? ['--opt-level=0'] : []),
		'-o',
		part,
		wasm,
	], { encoding: 'utf-8' });

	const out = `${compile.stdout}${compile.stderr}`;

	if (compile.status !== 0) {
		rmSync(part, { force: true });
		return out;
	}

	// A signature that disagrees with its import is not an error to wamrc: it
	// drops that native to the generic path, 28 ns a call instead of 2, and
	// says so only in this warning. That means the API and the module have
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
 * wamrc. Tests run the result as it is; with `names` it keeps its function
 * names, so a test can see what Asyncify instrumented. With `natives`, the
 * plugin's `export function`s become natives, listed there.
 */
export async function compileToWasm(
	plugin: Pick<Plugin, 'source' | 'root' | 'quick'>,
	wasm: string,
	names = false,
	natives?: PluginNative[],
): Promise<string | null> {
	// A quick build leaves the optimising to one Binaryen pass afterwards.
	const flags = [...(plugin.quick ? [] : ['--optimize']), ...(names ? ['--debug'] : [])];
	const level = plugin.quick ? OPTIMIZE.quick : OPTIMIZE.full;
	let problem = await compileWasm(plugin, wasm, BASE_EXPORTS, flags, natives);
	if (problem) return problem;

	// A plugin that makes a promise - an async function, fetch, sleep - has
	// the host drive its jobs, so it is compiled again with the scheduler's
	// exports. Only then, and only when a coroutine can park, does Asyncify
	// run: a plugin without either is the same wasm it always was.
	if (importsOf(readFileSync(wasm)).has('env.co_wake')) {
		if (natives) natives.length = 0;
		problem = await compileWasm(plugin, wasm, ASYNC_EXPORTS, flags, natives);
		if (problem) return problem;
	}
	const binary = readFileSync(wasm);
	if (importsOf(binary).has(SUSPEND_IMPORT)) writeFileSync(wasm, asyncify(binary, names, level));
	else if (plugin.quick) writeFileSync(wasm, optimized(binary, level));
	return null;
}

/** Binaryen's optimisation at `level`: what a quick build runs in place of asc's. */
function optimized(wasm: Uint8Array, level: number): Uint8Array {
	const module = binaryen.readBinary(wasm);
	try {
		module.setFeatures(binaryen.Features.All);
		binaryen.setOptimizeLevel(level);
		binaryen.setShrinkLevel(0);
		module.optimize();
		return module.emitBinary();
	} finally {
		module.dispose();
	}
}

/**
 * asc, from the plugin's .ts to `wasm`, with `hoodExports` as the second entry.
 * With `natives`, the plugin's `export function`s become its natives and are
 * listed there; without, they stay plain wasm exports - what a test host that
 * calls a fixture's functions by name wants.
 */
async function compileWasm(
	plugin: Pick<Plugin, 'source' | 'root'>,
	wasm: string,
	hoodExports: string,
	flags: string[],
	natives?: PluginNative[],
): Promise<string | null> {
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

	const { error, stderr } = await ascMain(
		[
			entry,
			// A second entry nobody writes: what the hood exports - the
			// coroutine scheduler's functions, for a plugin that waits (only an
			// entry file's exports reach the wasm).
			HOOD_EXPORTS,
			'--outFile',
			wasm,
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

			writeFile(filename: string, contents: string | Uint8Array): void {
				// The name asc passes back is the one it was given in --outFile,
				// so it is already where the caller wants it.
				const path = resolve(filename);
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, contents);
			},

			listFiles(): string[] {
				return [];
			},

			transforms: natives
				? [HoistImports, nativesTransform(entry, natives, plugin.root), playerFields.transform, shared.transform]
				: [HoistImports, playerFields.transform, shared.transform],
		},
	);

	// An import of a module the config does not list says so first: asc's
	// "not found" after it is only the consequence.
	if (sources.problems.length) return [...sources.problems, stderr.toString()].join('\n').trim();

	// A transform's refusal - a native whose signature cannot cross - is an
	// error with nothing written to stderr.
	return error ? (stderr.toString() || String(error.message ?? error)) : null;
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
 * which is the failure that hangs rather than traps.
 */
export function asyncify(wasm: Uint8Array, names = false, level = OPTIMIZE.full): Uint8Array {
	const module = binaryen.readBinary(wasm);
	try {
		module.setFeatures(binaryen.Features.All);
		binaryen.setPassArgument('asyncify-imports', SUSPEND_IMPORT);
		binaryen.setPassArgument('asyncify-ignore-indirect', '1');
		// asc's own --optimize levels (a quick build's lower one), so the rest
		// of the module comes out as it went in.
		binaryen.setOptimizeLevel(level);
		binaryen.setShrinkLevel(0);
		binaryen.setDebugInfo(names);
		module.runPasses(['asyncify']);
		module.optimize();
		if (!module.validate()) throw new Error('Asyncify produced an invalid module');
		return module.emitBinary();
	} finally {
		binaryen.setPassArgument('asyncify-imports', null);
		binaryen.setPassArgument('asyncify-ignore-indirect', null);
		binaryen.setDebugInfo(false);
		module.dispose();
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
