// The tooltips of the hand-written API, in the language the developer reads.
//
//   bun scripts/apply-docs.ts               the core's hood and the project's
//                                           modules, in AMXTS_DOCS_LANG (run by
//                                           `bun run generate` and `amxts prepare`)
//   bun scripts/apply-docs.ts --lang ru     that language, whatever .env says
//   bun scripts/apply-docs.ts --format      the tables rewritten in one form: both
//                                           languages in backticks, laid out alike
//                                           (code-style rule 29)
//   bun scripts/apply-docs.ts --clean <f>   git's clean filter: stdin in English
//                                           to stdout, so a tree written in
//                                           Russian commits - and diffs - as English
//
// The generated API (as/events.ts, hooks.ts, entities.ts) is written in the
// chosen language by its generator. The hood a person wrote - the facade,
// fs, os, vector, the Promise globals, the official modules' API - is code in
// git, with an editor landing in it on go-to-definition; so its words live
// beside it, both languages keyed by the element they describe, and this
// script writes the chosen one into the JSDoc above each element:
//
//   scripts/docs/as/facade.ts        for as/facade.ts            (the core)
//   scripts/docs/src/index.ts        for src/index.ts            (a module)
//
//   export default {
//     'print': { en: 'Prints ...', ru: 'Печатает ...' },
//     'Player.health': { en: '...', ru: '...' },
//   };
//
// A key is the element's path: `print`, `Player`, `Player.health`,
// `game.addEventListener` (a namespace's member), `HudOptions.x`; an
// overloaded function's signatures are `load`, `load#2`, ... in their order.
// A class and an interface of the same members share keys, so an options
// class turned into an interface keeps its words. The text is the comment's
// body without the ` * `: several lines where it has several, the ```ts
// examples the same in both languages. A multi-line template literal is
// written indented, as the code around it; the common indentation is dropped.
//
// The files stay English in git: the repository's .gitattributes names them
// with `filter=amxts-docs`, and this script registers that filter's clean
// command in the repository's .git/config when it applies - git then stores
// what the clean command gives (English) whatever the working tree holds,
// and `git status` is clean in Russian too. English is what the check
// (tests/code-style.test.ts, rule 28) compares with when AMXTS_DOCS_LANG is
// not set.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export type Lang = 'en' | 'ru';
export const LANGS: Lang[] = ['en', 'ru'];

/** One element's words in both languages. */
export interface DocText {
	en: string;
	ru: string;
}

export type DocTable = Record<string, DocText>;

/** The language AMXTS_DOCS_LANG picks: English unless it says "ru". */
export function docsLang(value = process.env.AMXTS_DOCS_LANG): Lang {
	return value === 'ru' ? 'ru' : 'en';
}

// ---------------------------------------------------------------- elements

/** A declaration in a source file, as the tooltips see it. */
export interface Element {
	/** Its path: `Player.health`. */
	key: string;
	/** A plugin author sees it: exported, global, not private, not `_`-named. */
	public: boolean;
	/** The JSDoc block above it, when there is one: where it is and its text. */
	doc: { start: number; end: number; text: string } | null;
	/** Where a new block goes: the start of the line it would take. */
	insertAt: number;
	/** The declaration shares its line with code before it: a new block goes in that line. */
	inline: boolean;
	/** The declaration's indentation. */
	indent: string;
	/** The line (0-based) the declaration starts on. */
	line: number;
}

type Named = ts.Node & { name?: ts.Node };

function nameOf(node: Named): string | null {
	const name = node.name;
	if (!name) return null;
	if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
	if (ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
	return null;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	return (ts.canHaveModifiers(node) ? ts.getModifiers(node) ?? [] : []).some(m => m.kind === kind);
}

/** AssemblyScript's `@global`: a declaration every file sees without an import. */
function isGlobalDecorated(node: ts.Node): boolean {
	const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : [];
	return decorators.some(d => ts.isIdentifier(d.expression) && d.expression.text === 'global');
}

/** The comment's body: `/** a *\/` is "a"; a block's lines lose their ` * `. */
export function docBody(comment: string): string {
	const inner = comment.slice(3, -2);
	const lines = inner.split(/\r?\n/).map((line, i) => (i === 0 ? line.replace(/^\s+/, '') : line.replace(/^\s*\* ?/, '')).replace(/\s+$/, ''));
	while (lines.length && lines[0] === '') lines.shift();
	while (lines.length && lines.at(-1) === '') lines.pop();
	return lines.join('\n').replace(/\*\\\//g, '*/');
}

/** A body as a comment at `indent`, its lines ended by `eol`: one line when it is one line. */
export function renderDoc(text: string, indent: string, eol = '\n'): string {
	const safe = text.replace(/\*\//g, '*\\/');
	if (!safe.includes('\n')) return `/** ${safe} */`;
	return ['/**', ...safe.split('\n').map(line => (line ? `${indent} * ${line}` : `${indent} *`)), `${indent} */`].join(eol);
}

/**
 * Every named declaration in a file - top-level ones, namespaces' members,
 * class and interface members - with its key, whether a plugin author sees
 * it, and its JSDoc block.
 */
export function elements(fileName: string, source: string): Element[] {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	// A file with no import and no export is a script: what it declares is global.
	const script = !file.statements.some(s => ts.isImportDeclaration(s) || ts.isExportDeclaration(s) || ts.isExportAssignment(s) || hasModifier(s, ts.SyntaxKind.ExportKeyword));
	const found: Element[] = [];
	const seen = new Set<string>();

	/** The start of the `// @ts-ignore` lines right above `line`: they speak of the line below them. */
	function aboveTsComments(line: number): number {
		const previous = source.lastIndexOf('\n', line - 2) + 1;
		return line > 0 && /^\s*\/\/\s*@ts-/.test(source.slice(previous, line)) ? aboveTsComments(previous) : line;
	}

	function add(node: ts.Node, key: string, visible: boolean) {
		// A setter after its getter, a second overload: the first one carries the words.
		if (seen.has(key)) return;
		seen.add(key);
		const start = node.getStart(file);
		// The parser's own reading: the last /** */ before it, on its line or above.
		const jsDoc = (node as { jsDoc?: ts.JSDoc[] }).jsDoc?.at(-1);
		const block = jsDoc ? { pos: jsDoc.getStart(file), end: jsDoc.end } : undefined;
		const lineStart = source.lastIndexOf('\n', start - 1) + 1;
		const indent = /^[ \t]*/.exec(source.slice(lineStart, start))![0];
		// `constructor(public player: Player)`: the block goes in the line, before it.
		const inline = /\S/.test(source.slice(lineStart, start));
		const insertAt = inline ? start : aboveTsComments(lineStart);
		found.push({
			key,
			public: visible && !key.split('.').some(part => part.startsWith('_') || part.startsWith('#')),
			doc: block ? { start: block.pos, end: block.end, text: docBody(source.slice(block.pos, block.end)) } : null,
			insertAt,
			inline,
			indent,
			line: file.getLineAndCharacterOfPosition(start).line,
		});
	}

	function members(owner: ts.ClassLikeDeclaration | ts.InterfaceDeclaration | ts.TypeLiteralNode, prefix: string, visible: boolean) {
		for (const member of owner.members) {
			// `constructor(public player: Player)` declares a field.
			if (ts.isConstructorDeclaration(member)) {
				for (const parameter of member.parameters) {
					if (!ts.isParameterPropertyDeclaration(parameter, member) || !ts.isIdentifier(parameter.name)) continue;
					const hidden = hasModifier(parameter, ts.SyntaxKind.PrivateKeyword) || hasModifier(parameter, ts.SyntaxKind.ProtectedKeyword);
					add(parameter, `${prefix}.${parameter.name.text}`, visible && !hidden);
				}
				continue;
			}
			if (ts.isIndexSignatureDeclaration(member) || ts.isClassStaticBlockDeclaration(member)) continue;
			const name = nameOf(member as Named);
			if (!name) continue;
			const hidden = hasModifier(member, ts.SyntaxKind.PrivateKeyword) || hasModifier(member, ts.SyntaxKind.ProtectedKeyword);
			add(member, `${prefix}.${name}`, visible && !hidden);
		}
	}

	/** How many declarations a function of this name has in the list: overloads have several. */
	function overloads(list: readonly ts.Statement[], name: string) {
		return list.filter(each => ts.isFunctionDeclaration(each) && nameOf(each as Named) === name).length;
	}
	const overloadIndex = new Map<string, number>();

	// 'all': everything declared is visible (a script, `declare global`, an
	// ambient namespace); 'exported': what is exported or `@global`; 'none':
	// inside what nobody sees.
	function statements(list: readonly ts.Statement[], prefix: string, mode: 'all' | 'exported' | 'none') {
		for (const statement of list) {
			const visible = mode === 'all' || (mode === 'exported' && (hasModifier(statement, ts.SyntaxKind.ExportKeyword) || isGlobalDecorated(statement)));
			const at = (name: string) => (prefix ? `${prefix}.${name}` : name);

			if (ts.isVariableStatement(statement)) {
				for (const declaration of statement.declarationList.declarations) {
					if (ts.isIdentifier(declaration.name)) add(statement, at(declaration.name.text), visible);
				}
				continue;
			}

			if (ts.isModuleDeclaration(statement)) {
				const body = statement.body && ts.isModuleBlock(statement.body) ? statement.body.statements : [];
				if (statement.flags & ts.NodeFlags.GlobalAugmentation) {
					statements(body, prefix, 'all');
					continue;
				}
				// `declare module "./facade"`: members a file adds to the classes of a
				// file beside it are its own API; the class has its words there.
				if (ts.isStringLiteral(statement.name)) {
					if (!statement.name.text.startsWith('./')) continue;
					for (const each of body) {
						if (ts.isInterfaceDeclaration(each)) members(each, at(each.name.text), true);
					}
					continue;
				}
				const name = statement.name.text;
				add(statement, at(name), visible);
				const ambient = mode === 'all' || hasModifier(statement, ts.SyntaxKind.DeclareKeyword);
				statements(body, at(name), !visible ? 'none' : ambient ? 'all' : 'exported');
				continue;
			}

			const name = nameOf(statement as Named);
			if (!name) continue;
			if (ts.isFunctionDeclaration(statement) && overloads(list, name) > 1) {
				// Each overload signature has words of its own - the editor shows
				// the one a call matches: `load`, `load#2`, ... The implementation
				// under them is not one a caller sees.
				if (statement.body && list.some(other => other !== statement && ts.isFunctionDeclaration(other) && nameOf(other) === name && !other.body)) continue;
				const index = (overloadIndex.get(at(name)) ?? 0) + 1;
				overloadIndex.set(at(name), index);
				add(statement, index === 1 ? at(name) : `${at(name)}#${index}`, visible);
			} else if (ts.isFunctionDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
				add(statement, at(name), visible);
			} else if (ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
				add(statement, at(name), visible);
				members(statement, at(name), visible);
			} else if (ts.isEnumDeclaration(statement)) {
				add(statement, at(name), visible);
				for (const member of statement.members) {
					const memberName = nameOf(member as Named);
					if (memberName) add(member, `${at(name)}.${memberName}`, visible);
				}
			}
		}
	}

	statements(file.statements, '', script ? 'all' : 'exported');
	return found;
}

// ---------------------------------------------------------------- tables

/** A template literal written indented, as the code around it: without that indentation. */
export function dedent(text: string): string {
	const lines = text.replace(/\r\n/g, '\n').split('\n');
	while (lines.length && lines[0].trim() === '') lines.shift();
	while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
	const indents = lines.filter(line => line.trim()).map(line => /^[ \t]*/.exec(line)![0].length);
	const common = indents.length ? Math.min(...indents) : 0;
	return lines.map(line => line.slice(common).replace(/\s+$/, '')).join('\n');
}

/** A docs file's table, every text dedented. */
export async function loadTable(path: string): Promise<DocTable> {
	const module = await import(`${resolve(path).replace(/\\/g, '/')}?t=${Date.now()}`);
	const raw = (module.default ?? {}) as Record<string, Partial<DocText>>;
	const table: DocTable = {};
	for (const [key, text] of Object.entries(raw)) table[key] = { en: dedent(text.en ?? ''), ru: dedent(text.ru ?? '') };
	return table;
}

/** A text as a table writes it: in backticks, on the key's line or indented under it. */
function literal(text: string, multiline: boolean, indent: string): string {
	const escaped = text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
	if (!multiline) return `\`${escaped}\``;
	return `\`\n${escaped.split('\n').map(line => (line ? `${indent}\t${line}` : '')).join('\n')}\n${indent}\``;
}

/**
 * A table as its file, the way code-style rule 29 has it: both
 * languages in backticks and laid out alike - on one line each, or both
 * indented under the key when either has more than one line.
 */
export function formatTable(table: DocTable, header: string[], quote: '\'' | '"'): string {
	const keys = Object.keys(table);
	const quoted = keys.some(key => !/^[A-Z_$][\w$]*$/i.test(key));
	const lines = [...header, 'export default {'];
	for (const key of keys) {
		const { en, ru } = table[key];
		const multiline = en.includes('\n') || ru.includes('\n');
		lines.push(`\t${quoted ? `${quote}${key}${quote}` : key}: {`, `\t\ten: ${literal(en, multiline, '\t\t')},`, `\t\tru: ${literal(ru, multiline, '\t\t')},`, '\t},');
	}
	return [...lines, '};', ''].join('\n');
}

/** Rewrites the tables of `sources` in the form formatTable gives; the ones it changed. */
export async function formatSources(sources: DocSource[]): Promise<string[]> {
	const files = [...new Set(sources.map(source => source.docs).filter(existsSync))];
	const tables = await Promise.all(files.map(loadTable));
	const changed: string[] = [];
	for (const [i, docs] of files.entries()) {
		const before = readFileSync(docs, 'utf8');
		const header = before.split(/\r?\n/).filter((line, i, all) => all.slice(0, i + 1).every(l => l.startsWith('//')));
		const quote = /^\t"/m.test(before) ? '"' : '\'';
		const after = formatTable(tables[i], header, quote);
		if (after !== before) {
			writeFileSync(docs, after);
			changed.push(docs);
		}
	}
	return changed;
}

/** The text in `lang`, English when that one is not written. */
export function pick(text: DocText, lang: Lang): string {
	return text[lang] || text.en;
}

/** Text safe inside a JSDoc comment, on one line. */
export function docText(text: string) {
	return text.replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();
}

/** `source` with the words of `table` in `lang` above every element it names. */
export function applyTable(fileName: string, source: string, table: DocTable, lang: Lang): string {
	const edits: { start: number; end: number; text: string }[] = [];
	// A file checked out with CRLF gets its comments with CRLF too.
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	for (const element of elements(fileName, source)) {
		const entry = table[element.key];
		if (!entry) continue;
		const text = pick(entry, lang);
		if (!text) continue;
		const block = renderDoc(text, element.indent, eol);
		if (element.doc) {
			if (source.slice(element.doc.start, element.doc.end) !== block) edits.push({ start: element.doc.start, end: element.doc.end, text: block });
		} else {
			edits.push({ start: element.insertAt, end: element.insertAt, text: element.inline ? `${block} ` : `${element.indent}${block}${eol}` });
		}
	}
	let out = source;
	for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
	return out;
}

// ---------------------------------------------------------------- packages

/** A source file of the public API and the file its words are in. */
export interface DocSource {
	/** The source, absolute. */
	file: string;
	/** Its words: <package>/scripts/docs/<the source's path in the package>. */
	docs: string;
	/** The package's folder. */
	root: string;
}

/** The core's hand-written API: what `@amxts/core` and the globals give a plugin. */
export const CORE_API = [
	'as/facade.ts',
	'as/promise.ts',
	'as/promise.types.d.ts',
	'as/vector.ts',
	'as/effects.ts',
	'as/fs.ts',
	'as/os.ts',
	'as/amxts.d.ts',
	'as/lib/check.ts',
	'as/modules/http.ts',
];

export function docsFileOf(root: string, file: string): string {
	return join(root, 'scripts', 'docs', relative(root, file).replace(/\.d\.ts$/, '.ts'));
}

/**
 * A module package's API files: its module file and every file that file
 * re-exports (`export * from "./types"`), followed through.
 */
export function moduleApi(moduleFile: string): string[] {
	const files: string[] = [];
	const visit = (file: string) => {
		if (files.includes(file) || !existsSync(file)) return;
		files.push(file);
		const text = readFileSync(file, 'utf8');
		for (const match of text.matchAll(/^export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
			const target = resolve(dirname(file), match[1]);
			visit(existsSync(`${target}.ts`) ? `${target}.ts` : target);
		}
	};
	visit(resolve(moduleFile));
	return files;
}

export function coreSources(core: string): DocSource[] {
	return CORE_API.map(path => join(core, path)).map(file => ({ file, docs: docsFileOf(core, file), root: core }));
}

export function moduleSources(pkg: { dir: string; module: string }): DocSource[] {
	return moduleApi(pkg.module).map(file => ({ file, docs: docsFileOf(pkg.dir, file), root: pkg.dir }));
}

/** Writes `lang` into every source that has a docs file; the ones it changed. */
export async function applySources(sources: DocSource[], lang: Lang): Promise<string[]> {
	const present = sources.filter(source => existsSync(source.docs) && existsSync(source.file));
	const tables = await Promise.all(present.map(source => loadTable(source.docs)));
	const changed: string[] = [];
	for (const [i, source] of present.entries()) {
		const before = readFileSync(source.file, 'utf8');
		const after = applyTable(source.file, before, tables[i], lang);
		if (after !== before) {
			writeFileSync(source.file, after);
			changed.push(source.file);
		}
	}
	return changed;
}

// ---------------------------------------------------------------- git

export const FILTER = 'amxts-docs';

/**
 * Registers the clean filter in `root`'s repository, when `root` is the top
 * of one: .gitattributes names the files, .git/config the command. Whether
 * it is one.
 */
export function registerFilter(root: string): boolean {
	const top = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	if (top.status !== 0 || resolve(top.stdout.trim()) !== resolve(root)) return false;
	const script = fileURLToPath(import.meta.url).replace(/\\/g, '/');
	const command = `bun "${script}" --clean %f`;
	const current = spawnSync('git', ['-C', root, 'config', '--local', `filter.${FILTER}.clean`], { encoding: 'utf8' });
	if (current.stdout.trim() !== command) spawnSync('git', ['-C', root, 'config', '--local', `filter.${FILTER}.clean`, command]);
	return true;
}

/**
 * A rewritten file whose content git sees unchanged - only the language of
 * its comments moved - has its index entry refreshed. `git status` takes a
 * file whose size changed for a modified one without running the filter;
 * `git add` of content equal to the index stores nothing new and records the
 * size. A file with changes of its own is left as it is.
 */
function refreshIndex(root: string, file: string): void {
	const path = relative(root, file);
	const same = spawnSync('git', ['-C', root, 'diff', '--quiet', '--', path]);
	const staged = spawnSync('git', ['-C', root, 'diff', '--quiet', '--cached', '--', path]);
	if (same.status === 0 && staged.status === 0) spawnSync('git', ['-C', root, 'add', '--', path]);
}

/** What the filter does: the file git hands over, in English. */
async function clean(path: string): Promise<void> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	const input = Buffer.concat(chunks).toString('utf8');
	const root = process.cwd();
	const file = resolve(root, path);
	const docs = docsFileOf(root, file);
	process.stdout.write(existsSync(docs) ? applyTable(file, input, await loadTable(docs), 'en') : input);
}

// ---------------------------------------------------------------- command

/**
 * The core's hood and the modules of the project in `dir` - or, in a
 * module's own folder, that module - in `lang`; the line that says so.
 */
export async function applyProject(dir: string, lang: Lang): Promise<string> {
	const { roots, sources } = await projectSources(dir);
	const repositories = roots.filter(registerFilter);
	const changed = await applySources(sources, lang);
	for (const file of changed) {
		const root = repositories.find(each => file.startsWith(each));
		if (root) refreshIndex(root, file);
	}
	return `docs: ${lang}, ${changed.length ? `${changed.length} file(s) rewritten` : 'up to date'}`;
}

/** The core's API files and those of the modules the project in `dir` uses - or of the module `dir` is. */
export async function projectSources(dir: string): Promise<{ roots: string[]; sources: DocSource[] }> {
	const { CORE_DIR, loadProject } = await import('./project');
	const project = loadProject(dir);
	const modules = project.modules.length ? project.modules : project.packages.filter(pkg => pkg.dir === project.dir);
	return { roots: [CORE_DIR, ...modules.map(pkg => pkg.dir)], sources: [...coreSources(CORE_DIR), ...modules.flatMap(moduleSources)] };
}

async function main() {
	const args = process.argv.slice(2);
	const cleanAt = args.indexOf('--clean');
	if (cleanAt >= 0) return clean(args[cleanAt + 1]);

	if (args.includes('--format')) {
		const changed = await formatSources((await projectSources(process.cwd())).sources);
		console.log(changed.length ? changed.map(file => `formatted ${file}`).join('\n') : 'docs: every table is in form');
		return;
	}

	const langAt = args.indexOf('--lang');
	console.log(await applyProject(process.cwd(), langAt >= 0 ? docsLang(args[langAt + 1]) : docsLang()));
}

if (import.meta.main) await main();
