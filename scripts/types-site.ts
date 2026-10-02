// The types the documentation's examples import, as plain .d.ts, for the
// site's hovers on code (Twoslash): `~/facade` (and `@amxts/core`), the
// official modules by package name, `~/modules/<name>` and the testing library.
//
//   bun run types:site                ->  dist-docs-types/en/  (English)
//   bun run types:site -- --lang ru   ->  dist-docs-types/ru/  (Russian, for /ru pages)
//
// dist-docs-types/<lang>/
//   as-types.d.ts       the AssemblyScript types the hood's own declarations
//                       mention (i32, usize, bool...), as number and boolean
//   amxts/              what `~/*` resolves to: the facade, the generated
//                       natives, constants and hooks, lib/ and modules/;
//                       amxts.d.ts has the globals defineModule and defineConfig,
//                       imports.d.ts what an example uses without an import
//   packages/<name>/    what `@amxts/<name>` resolves to: index.d.ts of the
//                       modules amxts.config.ts lists and of every official
//                       module checked out beside the core (../amxts-modules/*),
//                       whose READMEs the site shows, and under <sub>/ what
//                       their package.json "exports" has besides "." -
//                       `@amxts/menu-core/testing` is packages/menu-core/testing/
//   root/src/testing/   the testing library (`loadPlugin`), with the build
//                       scripts' types it refers to under root/scripts/
//
// The tooltips are in the language asked for, whatever .env says: the
// hand-written API's from scripts/docs/as/ and the modules' scripts/docs/src/
// (scripts/apply-docs.ts writes them into the emitted .d.ts), the generated
// API's by generating it in that language for the emit and back after.
//
// Generated; the site copies the folder (its `bun run docs:types`) and
// maps `~/*` and `@amxts/core/*` to amxts/* (`@amxts/core/kit` is
// amxts/kit.d.ts), `@amxts/core` to amxts/facade.d.ts, `@amxts/core/test-utils`
// to root/src/testing/index.d.ts and `@amxts/<name>` to
// packages/<name>/index.d.ts.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { applyTable, docsLang, loadTable } from './apply-docs';
import { coreImports, importsDeclaration, importTable } from './auto-imports';
import { loadProject, readPackage } from './project';

const langAt = process.argv.indexOf('--lang');
const lang = docsLang(langAt >= 0 ? process.argv[langAt + 1] : 'en');
const out = join('dist-docs-types', lang);
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

// The files in as/ that are the hood rather than a plugin (scripts/project.ts
// has the same list, NOT_PLUGINS): anything else there would be a plugin,
// not API.
const HOOD = new Set(['facade', 'kit', 'promise', 'vector', 'effects', 'fs', 'os', 'natives', 'constants', 'events', 'entities', 'flags', 'hooks', 'remote']);
const API_FOLDERS = new Set(['lib', 'modules']);

function emit(project: string, outDir: string, rootDir?: string) {
	const root = rootDir ? ['--rootDir', rootDir] : [];
	const run = spawnSync(process.execPath, [tsc, '-p', project, '--declaration', '--emitDeclarationOnly', '--noEmit', 'false', '--outDir', outDir, ...root], { encoding: 'utf8' });
	// Type errors elsewhere in a project do not stop the declarations; a
	// missing output does.
	if (!existsSync(outDir)) throw new Error(`tsc wrote nothing for ${project}:\n${run.stdout}${run.stderr}`);
}

/** The generators whose output carries tooltips, run in `language`. */
function generate(language: string) {
	for (const script of ['generate-host.ts', 'generate-entities.ts', 'generate-hooks.ts']) {
		const run = spawnSync(process.execPath, [join('scripts', script)], { encoding: 'utf8', env: { ...process.env, AMXTS_DOCS_LANG: language } });
		if (run.status !== 0) throw new Error(`${script} failed:\n${run.stdout}${run.stderr}`);
	}
}

/** Every .d.ts under `dir`, relative to it. */
function declarations(dir: string, prefix = ''): string[] {
	return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
		? declarations(dir, join(prefix, entry.name))
		: entry.name.endsWith('.d.ts') ? [join(prefix, entry.name)] : []);
}

/** The words of `docsRoot` (a package's scripts/docs/<its source folder>) written into the .d.ts under `dir`. */
async function translate(dir: string, docsRoot: string) {
	for (const file of declarations(dir)) {
		const docs = join(docsRoot, file.replace(/\.d\.ts$/, '.ts'));
		if (!existsSync(docs)) continue;
		const path = join(dir, file);
		writeFileSync(path, applyTable(path, readFileSync(path, 'utf8'), await loadTable(docs), lang));
	}
}

// The modules amxts.config.ts lists, and every official one checked out
// beside the core: the docs and the modules' READMEs use them all.
const above = dirname(process.cwd());
const official = join(above, 'amxts-modules');
const modules = [...new Map([
	...loadProject().modules,
	...(existsSync(official) ? readdirSync(official).map(name => readPackage(join(official, name))) : []).filter(pkg => pkg !== null),
].map(pkg => [pkg.name, pkg])).values()];

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const regenerate = docsLang() !== lang;
if (regenerate) generate(lang);
try {
	await emitAll();
} finally {
	if (regenerate) generate(docsLang());
}

async function emitAll() {
	// as/tsconfig.json with every module in it, so the declarations come out
	// under the folder holding the core and the modules' repositories.
	const as = JSON.parse(readFileSync('as/tsconfig.json', 'utf8'));
	const paths: Record<string, string[]> = Object.fromEntries(Object.entries(as.compilerOptions.paths as Record<string, string[]>).map(([name, [path]]) => [name, [resolve('as', path)]]));
	for (const pkg of modules) paths[pkg.name] = [pkg.module];
	const project = join(out, 'tsconfig.site.json');
	writeFileSync(project, JSON.stringify({
		extends: resolve('as/tsconfig.json'),
		compilerOptions: { paths },
		include: [...(as.include as string[]).map(path => resolve('as', path)), ...modules.map(pkg => pkg.module)],
	}));
	emit(project, join(out, 'emitted'), above);
	rmSync(project);
	renameSync(join(out, 'emitted', relative(above, 'as')), join(out, 'amxts'));
	for (const pkg of modules) {
		cpSync(join(out, 'emitted', relative(above, pkg.dir), 'src'), join(out, 'packages', pkg.name.replace(/^@amxts\//, '')), { recursive: true });
	}
	rmSync(join(out, 'emitted'), { recursive: true, force: true });
	for (const entry of readdirSync(join(out, 'amxts'), { withFileTypes: true })) {
		const name = entry.name.replace(/\.d\.ts$/, '');
		const keep = entry.isDirectory() ? API_FOLDERS.has(entry.name) : HOOD.has(name) || entry.name === 'promise.types.d.ts';
		if (!keep) rmSync(join(out, 'amxts', entry.name), { recursive: true, force: true });
	}

	// A hand-written .d.ts in as/ is an input to tsc, not an output: copied as it is.
	copyFileSync('as/promise.types.d.ts', join(out, 'amxts', 'promise.types.d.ts'));
	copyFileSync('as/amxts.d.ts', join(out, 'amxts', 'amxts.d.ts'));
	// The facade's defineModule is typed by the globals there (AmxtsModule):
	// whatever imports the facade gets them, as the editor does from as/.
	const facade = join(out, 'amxts', 'facade.d.ts');
	writeFileSync(facade, `/// <reference path="./amxts.d.ts" />\n${readFileSync(facade, 'utf8')}`);
	// What an example uses without an import, as a project's .amxts/imports.d.ts has it.
	const problems: string[] = [];
	const table = importTable(coreImports(resolve('as/facade.ts')), modules.map(pkg => ({ name: pkg.name, imports: pkg.definition.imports })), problems);
	if (problems.length) throw new Error(problems.join('\n'));
	writeFileSync(join(out, 'amxts', 'imports.d.ts'), importsDeclaration([...table.values()]));

	emit('tsconfig.json', join(out, 'root'));
	for (const entry of readdirSync(join(out, 'root'))) {
		if (entry !== 'src' && entry !== 'scripts') rmSync(join(out, 'root', entry), { recursive: true, force: true });
	}

	writeFileSync(join(out, 'as-types.d.ts'), [
		'// The AssemblyScript types the hood\'s declarations mention. A plugin writes',
		'// number and boolean; these only make the declarations readable to tsc.',
		'type i8 = number;',
		'type i16 = number;',
		'type i32 = number;',
		'type i64 = number;',
		'type isize = number;',
		'type u8 = number;',
		'type u16 = number;',
		'type u32 = number;',
		'type u64 = number;',
		'type usize = number;',
		'type f32 = number;',
		'type f64 = number;',
		'type bool = boolean;',
		'type StaticArray<T> = T[];',
		'',
		// console.log and the rest, as AssemblyScript's std declares them.
		/declare namespace console \{[\s\S]*?\n\}/.exec(readFileSync('runtime/deps/assemblyscript/std/assembly/index.d.ts', 'utf8'))![0],
	].join('\n'));

	await translate(join(out, 'amxts'), join('scripts', 'docs', 'as'));
	for (const pkg of modules) await translate(join(out, 'packages', pkg.name.replace(/^@amxts\//, '')), join(pkg.dir, 'scripts', 'docs', 'src'));
	await emitExports();
}

/**
 * What a module's package.json "exports" has besides "." - menu-core's
 * `"./testing": "./testing/index.ts"` - at packages/<name>/<sub>/index.d.ts,
 * so `@amxts/menu-core/testing` resolves as `@amxts/<name>` does. These are
 * files for the test runner, not the plugin tree: they import
 * `@amxts/core/test-utils` and the modules by name, and keep those imports.
 */
async function emitExports() {
	const entries = modules.flatMap((pkg) => {
		const exports = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8')).exports ?? {};
		return Object.entries(exports as Record<string, unknown>)
			.filter((entry): entry is [string, string] => entry[0] !== '.' && entry[0] !== './package.json' && typeof entry[1] === 'string' && entry[1].endsWith('.ts') && !entry[0].includes('*'))
			.map(([sub, target]) => ({ pkg, sub: sub.replace(/^\.\//, ''), target: resolve(pkg.dir, target) }));
	});
	if (!entries.length) return;

	const emitted = join(out, 'emitted');
	const project = join(out, 'tsconfig.exports.json');
	const paths: Record<string, string[]> = { '@amxts/core/test-utils': [resolve('src/testing/index.ts')], '@amxts/core': [resolve('as/facade.ts')] };
	for (const pkg of modules) paths[pkg.name] = [pkg.module];
	writeFileSync(project, JSON.stringify({
		compilerOptions: { target: 'ES2022', lib: ['ES2022'], module: 'ESNext', moduleResolution: 'bundler', types: ['node'], typeRoots: [resolve('node_modules/@types')], skipLibCheck: true, noEmit: true, paths },
		files: entries.map(entry => entry.target),
	}));
	try {
		emit(project, emitted, above);
	} finally {
		rmSync(project, { force: true });
	}
	for (const { pkg, sub, target } of entries) {
		const file = join(emitted, relative(above, target)).replace(/\.ts$/, '.d.ts');
		if (!existsSync(file)) throw new Error(`${pkg.name}: no declarations for "./${sub}" (${relative(pkg.dir, target)})`);
		const into = join(out, 'packages', pkg.short, sub);
		// Its folder, for what it imports beside it; an index.ts is the entry already.
		cpSync(dirname(file), into, { recursive: true });
		const name = file.slice(dirname(file).length + 1);
		if (name !== 'index.d.ts') writeFileSync(join(into, 'index.d.ts'), `export * from "./${name.replace(/\.d\.ts$/, '')}";\n`);
		await translate(into, join(pkg.dir, 'scripts', 'docs', relative(pkg.dir, dirname(target))));
	}
	rmSync(emitted, { recursive: true, force: true });
}

console.log(`${out} (${lang}): amxts/ (~/facade, ~/kit, ~/modules/*), packages/ (@amxts/*, @amxts/*/<export>), root/src/testing, as-types.d.ts`);
