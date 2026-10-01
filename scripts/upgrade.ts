// `amxts upgrade`: a project's code brought to the API of the core it has
// installed.
//
//   npx amxts upgrade        rewrites the files, and lists every change
//
// An import of the core's API by `~/` - `~/natives`, `~/fs`, `~/facade` -
// becomes one by the package's name (`@amxts/core/natives`, `@amxts/core`),
// and an import of a module package by its place in the build's tree
// (`~/modules/menu-core`) one by its name: `~/` is the project's own files.
// The specifiers are found with the TypeScript parser - imports, exports,
// `import()` and `declare module` - so a string or a comment that looks like
// one is left alone, and only the text between the quotes changes. What is
// rewritten no longer matches, so a second run changes nothing.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { CORE_ENTRIES, CORE_PLUGINS, loadProject } from './project';
import { c, log } from './ui';

/** The old spelling of a specifier and the new one. */
export type Renames = Map<string, string>;

/** One rewritten specifier: where, and from what to what. */
export interface Change {
	file: string;
	line: number;
	from: string;
	to: string;
}

/** The facade's own files, whose exports it gives as its own. */
const FACADE_PARTS = ['entities', 'events', 'flags', 'hooks', 'vector', 'effects'];

/**
 * What `~/<place>` meant and is now written: the core's entries, the files
 * the facade exports, the modules the project lists. A place the project's
 * plugins folder has a file at is its own, and stays.
 */
export function renamesFor(modules: { name: string; short: string }[], own: (place: string) => boolean = () => false): Renames {
	const renames: Renames = new Map();
	const add = (place: string, to: string) => {
		if (!own(`${place}.ts`)) renames.set(`~/${place}`, to);
	};
	for (const [name, file] of Object.entries(CORE_ENTRIES)) add(file.replace(/\.ts$/, ''), name);
	for (const part of FACADE_PARTS) add(part, '@amxts/core');
	for (const pkg of modules) add(`modules/${pkg.short}`, pkg.name);
	return renames;
}

/** A specifier's new spelling, or null: a package's file by its path inside the package too. */
export function renamed(spec: string, renames: Renames): string | null {
	const exact = renames.get(spec);
	if (exact) return exact;
	const pkg = spec.match(/^(~\/modules\/[^/]+)\/(.+)$/);
	const to = pkg && renames.get(pkg[1]);
	return to && to !== '@amxts/core' && !to.startsWith('@amxts/core/') ? `${to}/${pkg[2]}` : null;
}

/** The module specifiers of a file: imports, exports, `import()` and `declare module`. */
export function specifiers(source: ts.SourceFile): ts.StringLiteral[] {
	const found: ts.StringLiteral[] = [];
	const visit = (node: ts.Node) => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier);
		else if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name)) found.push(node.name);
		else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) found.push(node.arguments[0]);
		else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) found.push(node.argument.literal);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return found;
}

/** A file's text with its specifiers renamed, and what changed. */
export function upgradeText(file: string, text: string, renames: Renames): { text: string; changes: Change[] } {
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const changes = specifiers(source)
		.map((literal) => {
			const to = renamed(literal.text, renames);
			return to ? { literal, to } : null;
		})
		.filter(each => each !== null);
	let out = text;
	// From the end, so every earlier position stays where it was.
	for (const { literal, to } of [...changes].reverse()) out = `${out.slice(0, literal.getStart(source) + 1)}${to}${out.slice(literal.getEnd() - 1)}`;
	return {
		text: out,
		changes: changes.map(({ literal, to }) => ({ file, line: source.getLineAndCharacterOfPosition(literal.getStart(source)).line + 1, from: literal.text, to })),
	};
}

/** Folders that are not the project's code: what is installed, built or generated. */
const SKIP = new Set(['node_modules', 'dist', '.amxts', '.git']);

/** The project's TypeScript files: its plugins, its tests and fixtures, a module's sources. */
function codeFiles(dir: string, skip: Set<string>): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return SKIP.has(entry.name) || skip.has(path) || entry.name.startsWith('.') ? [] : codeFiles(path, skip);
		return /\.(?:ts|mts|cts)$/.test(entry.name) ? [path] : [];
	});
}

/** Rewrites the project in `dir`; every change, in the order of the files. */
export function upgradeProject(dir: string): Change[] {
	const project = loadProject(dir);
	const ownFolder = resolve(project.pluginsDir) !== resolve(CORE_PLUGINS);
	const renames = renamesFor(project.modules, place => ownFolder && existsSync(join(project.pluginsDir, place)));
	const changes: Change[] = [];
	for (const file of codeFiles(project.dir, new Set([project.outDir]))) {
		const text = readFileSync(file, 'utf8');
		if (!text.includes('~/')) continue;
		const upgraded = upgradeText(relative(project.dir, file).replace(/\\/g, '/'), text, renames);
		if (!upgraded.changes.length) continue;
		writeFileSync(file, upgraded.text);
		changes.push(...upgraded.changes);
	}
	return changes;
}

// Run as a task (scripts/run.ts names it in argv) or by itself.
if (import.meta.main || resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
	const changes = upgradeProject(process.cwd());
	for (const change of changes) console.log(`  ${c.dim(`${change.file}:${change.line}`)}  ${change.from} ${c.dim('→')} ${change.to}`);
	const files = new Set(changes.map(change => change.file)).size;
	if (changes.length) log.success(`upgraded ${changes.length} import(s) in ${files} file(s)`);
	else log.success('nothing to upgrade: the code already uses this core\'s API');
}
