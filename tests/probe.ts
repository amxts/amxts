// A snippet of plain AssemblyScript compiled on its own, without the facade,
// and instantiated: for the tests of what the compiler makes of TypeScript.
import { rmSync, writeFileSync } from 'node:fs';
import { hashOf } from '../scripts/tracked-fs';
import { compileSources } from '../src/testing/compile';

declare const WebAssembly: any;

export interface Probe {
	/** What asc said when the snippet did not compile; empty when it did. */
	error: string;
	/** The instance's exports; null when it did not compile. */
	exports: any;
	/** An AssemblyScript string in the probe's memory: its length in bytes is the word before it. */
	string: (pointer: number) => string;
}

/**
 * Compiles `probe.ts`, with the other files it imports, and instantiates it
 * with `env`'s functions besides abort; `finished` as a full build finishes it.
 */
export async function probe(files: Record<string, string>, flags: string[] = [], env: Record<string, (...args: number[]) => unknown> = {}, finished = false): Promise<Probe> {
	const { error, binary } = await compileSources(['probe.ts', '--outFile', 'probe.wasm', ...flags], files, finished);
	if (error) return { error, exports: null, string: () => '' };

	const exports = new WebAssembly.Instance(new WebAssembly.Module(binary!), { env: { abort() {}, ...env } }).exports;
	const string = (pointer: number) => {
		const bytes = new Uint32Array(exports.memory.buffer, pointer - 4, 1)[0];
		return String.fromCharCode(...new Uint16Array(exports.memory.buffer, pointer, bytes >>> 1));
	};
	return { error: '', exports, string };
}

/**
 * A plugin from `code` in tests/as, with the include `PROBE_INC` names in it
 * beside it; both removed after. Named by `kind` and what they hold, so the
 * compile cache knows them on the next run.
 */
export async function pluginProbe<T>(kind: string, code: string, include: string, run: (file: string) => Promise<T>): Promise<T> {
	const name = `.${kind}-probe-${hashOf(code + include).slice(0, 12)}`;
	const file = `tests/as/${name}.ts`;
	writeFileSync(file, code.replace('PROBE_INC', `${name}.inc`));
	writeFileSync(`tests/as/${name}.inc`, include);
	try {
		return await run(file);
	} finally {
		rmSync(file, { force: true });
		rmSync(`tests/as/${name}.inc`, { force: true });
	}
}
