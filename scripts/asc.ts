// asc - the patched AssemblyScript compiler (runtime/patches explains what it
// carries and why) - as every build here runs it.
// @ts-ignore - bun's own module
import { fullGC } from 'bun:jsc';
// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import asc from '../runtime/deps/assemblyscript/dist/asc.js';

/**
 * asc.main, and nothing of the compile kept alive after it.
 *
 * asc hands a transform its compile by writing the program onto the transform
 * class's prototype, where it stays until that class's next compile: a class
 * that lives on - a module's own, a test file's - would keep the whole
 * program, a few hundred MB for a plugin. Each compile is given subclasses of
 * its own, which go with it. The program is then garbage JavaScriptCore does
 * not collect soon on its own, and one process compiling plugin after plugin
 * - a build, the test suite from an empty cache - piles it up past 3 GB; a
 * full collection after each compile keeps one program's worth.
 */
export async function ascMain(args: string[], options: Record<string, any>): Promise<{ error: Error | null; stdout: any; stderr: any }> {
	const transforms = options.transforms?.map((transform: any) => (typeof transform === 'function' ? class extends transform {} : transform));
	try {
		return await asc.main(args, { ...options, transforms });
	} finally {
		fullGC();
	}
}
