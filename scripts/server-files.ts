// A server's addons/amxts: what the module writes out on every start
// (runtime/src/embedded.h, made by scripts/generate-embedded.ts) and what a
// server kit carries (scripts/pack-server.ts). One list, so the two cannot
// differ.
//
// The API a plugin compiled on the server imports lives beside the plugins,
// where `~/` points there: every file at the top of as/ and the extensions in
// as/modules. With it go the editor's files - tsconfig.json and imports.d.ts -
// and the signature table wamrc reads. They all belong to one build of the
// module, so a start writes them over; plugins.ini and the example are the
// author's, written only while missing.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreImports, importsDeclaration } from './auto-imports';
import { CORE_ENTRIES } from './project';
import { apiFiles } from './system';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));

export interface ServerFile {
	/** Under addons/amxts. */
	path: string;
	text: string;
	/** The author's: written only while missing. */
	keep: boolean;
}

/**
 * The editor's settings for the plugins folder. AssemblyScript's standard
 * library beside it (`.assemblyscript/`, which a server kit carries with the
 * compiler) gives the types; `~/` is the folder itself, and `@amxts/core`
 * and its entries are the core's files in it.
 * Written out rather than extending assemblyscript/std/assembly.json, as the
 * core's own does: that path only resolves where node_modules is.
 */
export function serverTsconfig(): string {
	return `${JSON.stringify({
		compilerOptions: {
			// as/tsconfig.json's: `for (const x of list)` checks against the
			// iterator the copied (patched) typings give arrays and strings; the
			// compiler lowers the loop itself.
			target: 'es2015',
			module: 'commonjs',
			noLib: true,
			allowJs: false,
			strict: true,
			noImplicitReturns: true,
			experimentalDecorators: true,
			typeRoots: ['./.assemblyscript/types'],
			types: ['assembly'],
			// Every file is a module, a plugin without an import line too: what it
			// declares is its own, not a global another plugin collides with.
			moduleDetection: 'force',
			paths: {
				'*': ['./.assemblyscript/assembly/*'],
				'~/*': ['./*'],
				...Object.fromEntries(Object.entries(CORE_ENTRIES).map(([name, file]) => [name, [`./${file}`]])),
			},
		},
		include: ['./**/*.ts'],
		exclude: ['.assemblyscript'],
	}, null, '\t')}\n`;
}

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => relative(dir, join(entry.parentPath, entry.name)).replace(/\\/g, '/'));
}

/** What goes into addons/amxts, in the order it is written. */
export function serverFiles(): ServerFile[] {
	const read = (path: string) => readFileSync(join(CORE, path), 'utf8');
	const own = (path: string, text: string): ServerFile => ({ path, text, keep: false });
	return [
		...apiFiles().map(file => own(`plugins/${file}`, read(`as/${file}`))),
		...filesUnder(join(CORE, 'as/modules')).map(file => own(`plugins/modules/${file}`, read(`as/modules/${file}`))),
		// What a plugin uses without an import, as globals for the editor: the
		// compiler adds the imports (scripts/auto-imports.ts).
		own('plugins/imports.d.ts', importsDeclaration(coreImports(join(CORE, 'as/facade.ts')))),
		own('plugins/tsconfig.json', serverTsconfig()),
		own('tools/natives.txt', read('runtime/natives.txt')),
		{ path: 'plugins/hello.ts', text: read('runtime/host/hello.ts'), keep: true },
		{
			path: 'plugins.ini',
			text: [
				'; One plugin per line, as a file in plugins/.',
				'; A .ts is compiled by the server; a .aot is loaded as it is.',
				'hello.ts',
				'',
			].join('\n'),
			keep: true,
		},
	];
}
