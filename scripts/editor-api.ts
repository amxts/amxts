import type { Lang } from './apply-docs';
import type { Project } from './project';
// What an editor reads of the core and the project's modules, with the
// tooltips in the language AMXTS_DOCS_LANG picks: .amxts/api/ in the project,
// written by `amxts prepare`.
//
// The installed packages are never written to. A package manager may link
// them from a store every project on the machine shares (pnpm, bun), a
// reinstall puts them back, and the build compiles them as they are. They
// carry English, so English needs no copy: the editor reads the packages.
// Another language gets a copy of what the editor reads - the core's as/ and
// the files each module's module file reaches - with the words written in
// (scripts/apply-docs.ts), and .amxts/tsconfig.json points `@amxts/core`, its
// entries and the modules' names at it. The core is copied whole, not only
// the files with words: the facade and what it imports are one program, and
// a copy that imported an original would give the editor two Players.
//
//   .amxts/api/core/facade.ts         the core's as/, the words in the language
//   .amxts/api/menu-core/src/...      a module's files
//   .amxts/api/stamp.json             what they were made from: the copy is
//                                     written again only when that changes
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { applyTable, docsFileOf, loadTable } from './apply-docs';
import { CORE_DIR, CORE_ENTRIES, CORE_PLUGINS } from './project';

/** What .amxts/tsconfig.json takes from the copy. */
export interface EditorApi {
	/** Module names and the copied files they are, absolute. */
	paths: Record<string, string>;
	/** The copied core's folder, whose `.d.ts` files declare the globals. */
	core: string;
	/** Whether the copy was written now rather than found up to date. */
	written: boolean;
}

/** A tree of files to copy: from its folder on disk to its folder in the copy, with its package's folder for the words. */
interface Tree {
	root: string;
	from: string;
	to: string;
	files: string[];
}

function filesUnder(dir: string): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
		.map(entry => join(entry.parentPath, entry.name));
}

/** The files `file` reaches by relative imports inside `dir`, itself first. */
function reached(file: string, dir: string, seen: string[] = []): string[] {
	if (seen.includes(file) || !existsSync(file) || relative(dir, file).startsWith('..')) return seen;
	seen.push(file);
	for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*(?:\(\s*)?["'](\.{1,2}\/[^"']+)["']/g)) {
		const target = resolve(dirname(file), spec);
		const found = [target, `${target}.ts`, join(target, 'index.ts')].find(each => existsSync(each) && statSync(each).isFile());
		if (found) reached(found, dir, seen);
	}
	return seen;
}

/**
 * Writes the editor's copy of the API for `lang` under `dir`, or removes it
 * for English; what the tsconfig maps to it, null for none.
 */
export async function editorApi(project: Project, lang: Lang, dir: string): Promise<EditorApi | null> {
	if (lang === 'en') {
		rmSync(dir, { recursive: true, force: true });
		return null;
	}

	const core = join(dir, 'core');
	const trees: Tree[] = [
		{ root: CORE_DIR, from: CORE_PLUGINS, to: core, files: filesUnder(CORE_PLUGINS) },
		...project.modules.map(pkg => ({ root: pkg.dir, from: pkg.dir, to: join(dir, pkg.short), files: reached(pkg.module, pkg.dir) })),
	];
	const paths: Record<string, string> = Object.fromEntries(Object.entries(CORE_ENTRIES).map(([name, file]) => [name, join(core, file)]));
	for (const pkg of project.modules) paths[pkg.name] = join(dir, pkg.short, relative(pkg.dir, pkg.module));

	// What the copy is made of, by size and time: a new version, a module
	// added or a local file saved writes it again.
	const inputs = trees.flatMap(tree => tree.files.flatMap(file => [file, docsFileOf(tree.root, file)]).filter(existsSync));
	const stamp = JSON.stringify({ lang, inputs: inputs.map((file) => {
		const stat = statSync(file);
		return [file, stat.size, stat.mtimeMs];
	}) });
	const stampFile = join(dir, 'stamp.json');
	if (existsSync(stampFile) && readFileSync(stampFile, 'utf8') === stamp) return { paths, core, written: false };

	rmSync(dir, { recursive: true, force: true });
	const copies = trees.flatMap(tree => tree.files.map(file => ({ file, docs: docsFileOf(tree.root, file), to: join(tree.to, relative(tree.from, file)) })));
	const tables = await Promise.all(copies.map(copy => (existsSync(copy.docs) ? loadTable(copy.docs) : null)));
	for (const [i, copy] of copies.entries()) {
		const text = readFileSync(copy.file, 'utf8');
		mkdirSync(dirname(copy.to), { recursive: true });
		writeFileSync(copy.to, tables[i] ? applyTable(copy.file, text, tables[i], lang) : text);
	}
	writeFileSync(stampFile, stamp);
	return { paths, core, written: true };
}
