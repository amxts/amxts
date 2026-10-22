// The core's TypeScript under Node, for the tasks the amxts command runs
// (src/cli-api.mjs) and the compile processes (scripts/compile-pool.ts):
// node --import <this file> scripts/run.ts build-wasm.ts. Node strips types
// itself, but not under node_modules, where an installed core lives, and it
// does not add the `.ts` the core's imports leave out: this hook does both.
// Node's compile cache keeps what it compiled - TypeScript's own compiler
// most of all - for the next task.
import { readFileSync } from 'node:fs';
import { enableCompileCache, registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

enableCompileCache();

registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.{1,2}\//.test(specifier)) throw error;
			return next(`${specifier}.ts`, context);
		}
	},
	load(url, context, next) {
		// A file's URL may carry a query: a table read again after it changed.
		const path = url.startsWith('file:') ? fileURLToPath(url) : '';
		if (!path.endsWith('.ts')) return next(url, context);
		const source = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'transform' });
		return { format: 'module', source, shortCircuit: true };
	},
});
