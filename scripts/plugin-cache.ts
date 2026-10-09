import type { Plugin } from './compile';
import type { NativesBeside, PluginNative } from './plugin-natives';
// The plugins a build compiled, kept in the project - node_modules/.cache/amxts/build -
// and put in place again while nothing they were compiled from has changed
// (scripts/compile-cache.ts): a `dev` that starts again, or a `build` after
// it, compiles only what is new. A quick build and a full one, and a build for
// each system, are kept apart.
//
// The .aot the build folder has is written only when it is not the kept one
// already: a server that reads the folder where it is reloads a plugin whose
// file changes.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compilePlugin, writeInclude } from './compile';
import { codeIdentity, diskCache } from './compile-cache';
import { nativesBeside, setNativesBeside } from './plugin-natives';
import { HOST_SYSTEM } from './system';
import { hashOf } from './tracked-fs';

/** A plugin as the cache keeps it: its .aot, and the natives its include is written from. */
interface Kept {
	aot: Uint8Array;
	natives: PluginNative[];
	beside: NativesBeside;
}

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The plugin cache of the project in `dir`; with null, nothing is kept.
 * `ownIncludes`: the includes the build writes - its plugins' - by name.
 */
export function pluginCache(dir: string | null, ownIncludes: string[] = []) {
	const cache = diskCache(dir && join(dir, 'node_modules', '.cache', 'amxts', 'build'), () => codeIdentity([join(HERE, 'compile.ts'), join(HERE, 'plugin-cache.ts')]), ownIncludes);
	// wamrc and the signatures it reads are not files the compile reads itself.
	const tools = new Map<string, string>();
	const hashed = (file: string) => {
		if (!tools.has(file)) tools.set(file, hashOf(readFileSync(file)));
		return tools.get(file);
	};
	const partsOf = (plugin: Plugin) => [
		'aot',
		resolve(plugin.source),
		resolve(plugin.root),
		resolve(plugin.output),
		plugin.system ?? HOST_SYSTEM,
		Boolean(plugin.quick),
		Boolean(plugin.light),
		hashed(plugin.wamrc),
		hashed(plugin.signatures),
	];

	return {
		counts: cache.counts,

		/** The plugin as an earlier build kept it, put in place; its natives. Null when there is none to take. */
		reuse(plugin: Plugin): PluginNative[] | null {
			const kept = cache.find<Kept>(partsOf(plugin));
			return kept && take(plugin, kept);
		},

		take,

		/** compilePlugin, and what it made kept: what went wrong, or null. `natives` gets the plugin's natives. */
		async compile(plugin: Plugin, natives: PluginNative[]): Promise<string | null> {
			const made = await cache.make<Kept | { problem: string }>(partsOf(plugin), async () => {
				const problem = await compilePlugin(plugin, natives);
				return problem === null ? { aot: new Uint8Array(readFileSync(plugin.output)), natives, beside: nativesBeside(natives) } : { problem };
			}, made => !('problem' in made));
			return 'problem' in made ? made.problem : null;
		},
	};
}

/**
 * A plugin compiled before - kept by a build, or come with its module
 * (scripts/prebuilt.ts) - put in place as the plugin, with its include; its natives.
 */
function take(plugin: Plugin, kept: Kept): PluginNative[] {
	setNativesBeside(kept.natives, kept.beside);
	place(plugin.output, kept.aot);
	writeInclude(plugin.output, kept.natives);
	return kept.natives;
}

/** The .aot into the build folder, unless it is there already - beside it first, then over it. */
function place(output: string, aot: Uint8Array) {
	if (existsSync(output) && hashOf(readFileSync(output)) === hashOf(aot)) return;
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(`${output}.part`, aot);
	renameSync(`${output}.part`, output);
}
