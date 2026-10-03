// Auto-imports: a plugin uses `Player`, `server` or a module's namespace
// without an import line, and the build adds the import.
//
//   server.addEventListener("init", () => menus.show(player, "MAIN"));
//
// What can be used so is a table of names (autoImports): the facade's public
// exports - everything `@amxts/core` exports but its hood (HOOD) - and what
// each module amxts.config.ts lists gives in its definition:
//
//   export default defineModule({
//     meta: { name: "menu-core" },
//     imports: [{ from: "@amxts/menu-core", as: "menus" }],
//   });
//
// - the module as a namespace, `menus.create(...)` - or one of its exports
// by its own name, `{ from, name: "semiclip" }`: an object whose properties a
// plugin assigns, `semiclip.rule = ...`, which a namespace's cannot be.
//
// Before a plugin's file is compiled (Sources.read in scripts/project.ts),
// withAutoImports reads it with the TypeScript parser and finds the names it
// uses without declaring or importing them - a local of the same name wins,
// in its own scope - and adds an import for each one the table has, on one
// line after the file's last: the lines above keep their numbers, so an
// error points where it did. A name the file does not use is not imported,
// so a module no plugin uses is not compiled into any of them.
//
// asc compiles an imported file where its import statement stands, and ES
// modules run an import before the file that imports it; scripts/compile.ts
// moves every import to the top of its file after parsing (hoistImports),
// so the one at the end runs first too.
//
// `.amxts/imports.d.ts` (scripts/prepare.ts, importsDeclaration) gives the
// editor the same names as globals.
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { existsSync, readFileSync, statSync } from './tracked-fs';

/** One name a plugin can use without importing it. */
export interface AutoImport {
	/** What the plugin writes: `Player`, `semiclip`. */
	name: string;
	/** Where it comes from, as an import line writes it: `@amxts/core`, `@amxts/resemiclip`. */
	from: string;
	/** `import * as semiclip from "..."` rather than `import { Player } from "..."`. */
	namespace: boolean;
}

/**
 * What a module gives in `defineModule({ imports })`: its API as a namespace
 * under `as`, or its export `name` under that name.
 */
export type ModuleImport = { from: string; as: string } | { from: string; name: string };

/** The name a plugin uses what a module gives by. */
export function importedName(each: ModuleImport): string {
	return 'as' in each ? each.as : each.name;
}

export const CORE = '@amxts/core';

/**
 * The facade's exports that are the hood, not the plugin API: what the
 * facade and the generated files are built from - cells, raw handlers and
 * the listener tables - and what a module's natives call through the kit
 * (as/kit.ts). A plugin that needs one imports it by name. Every other
 * export of the facade is auto-imported, a new one included; so is none
 * whose name starts with `_`.
 */
export const HOOD = new Set([
	// Cells and raw handlers.
	'Call CellArray CellBuffer Handler WideHandler NoArgument arg argc argString argText cell cellFloat cells cellsToString cmd cmdWide floatCell handled hook hostIndex nativeFn noOrigin out paint playerIds publicFor putCell readText ret setArg setArgText stringToCells swapTeam text TEXT_MAX',
	// The kit's.
	'caller callingPlugin cellArrayRows cellsText colorTags createCellArray defineModule destroyCellArray menuColors onPluginStop PawnCall PawnFunction pushCellArrayRow request RequestErrorKind RequestOptions RequestResult showMenu textCells',
	// The generated listener and flag tables.
	'addGameListener addServerListener removeGameListener removeServerListener GameAnswerMap GameEventMap ServerEventMap ServerMessageMap protocolMessageNames HookEntry HookEvent EntvarFlags FlagFamily FlagList flagList FlagStore MemberFlags ACCESS BUTTON DAMAGE EFFECT ENTITY_FLAG HIDE_HUD PHYSICS_FLAG WEAPON_STATE',
].flatMap(group => group.split(' ')));

// ---------------------------------------------------------------- the table

/** The names a file exports, following `export *` and `export { ... } from` into the files beside it. */
function exportsOf(file: string, seen = new Set<string>()): string[] {
	if (seen.has(file) || !existsSync(file)) return [];
	seen.add(file);
	const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false);
	return source.statements.flatMap((statement) => {
		if (ts.isExportDeclaration(statement)) {
			const from = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? join(dirname(file), `${statement.moduleSpecifier.text}.ts`) : null;
			if (!statement.exportClause) return from ? exportsOf(from, seen) : [];
			return ts.isNamedExports(statement.exportClause) ? statement.exportClause.elements.map(each => each.name.text) : [];
		}
		const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword);
		if (!exported) return [];
		if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap(each => (ts.isIdentifier(each.name) ? [each.name.text] : []));
		const name = (statement as { name?: ts.Node }).name;
		return name && ts.isIdentifier(name) ? [name.text] : [];
	});
}

let facade: { stamp: string; names: string[] } | null = null;

/** Everything the facade exports, the hood included. */
export function facadeExports(facadeFile: string): string[] {
	// The facade's own files change only in the core's checkout; a stamp of
	// the entry is enough to notice an edit there during `amxts dev`.
	const stamp = existsSync(facadeFile) ? String(statSync(facadeFile).mtimeMs) : 'none';
	if (facade?.stamp !== stamp) facade = { stamp, names: [...new Set(exportsOf(facadeFile))].sort() };
	return facade.names;
}

/** The facade's public exports: what a plugin uses from `@amxts/core` without an import. */
export function coreImports(facadeFile: string): AutoImport[] {
	return facadeExports(facadeFile).filter(name => !name.startsWith('_') && !HOOD.has(name)).map(name => ({ name, from: CORE, namespace: false }));
}

/**
 * The project's table: the facade's names, then each module's. Two sources
 * of one name are a problem, naming both - the plugin could not tell which
 * it gets.
 */
export function importTable(core: AutoImport[], modules: { name: string; imports: ModuleImport[] }[], problems: string[]): Map<string, AutoImport> {
	const table = new Map<string, AutoImport>();
	const give = (entry: AutoImport, by: string) => {
		const taken = table.get(entry.name);
		if (taken) problems.push(`auto-imports: ${entry.name} is given by ${taken.from} and by ${by} - rename one of them (imports in ${by}'s defineModule)`);
		else table.set(entry.name, entry);
	};
	for (const entry of core) give(entry, CORE);
	for (const pkg of modules) {
		for (const each of pkg.imports) give({ name: importedName(each), from: each.from, namespace: 'as' in each }, pkg.name);
	}
	return table;
}

// ---------------------------------------------------------------- a file

/** The names a binding declares: `x`, `{ a, b: c }`, `[d, ...e]`. */
function bound(name: ts.BindingName): string[] {
	if (ts.isIdentifier(name)) return [name.text];
	return name.elements.flatMap(element => (ts.isOmittedExpression(element) ? [] : bound(element.name)));
}

/** What these statements declare in the scope they are in. */
function declaredBy(statements: readonly ts.Statement[]): string[] {
	return statements.flatMap((statement): string[] => {
		if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap(each => bound(each.name));
		if (ts.isImportDeclaration(statement)) {
			const clause = statement.importClause;
			const bindings = clause?.namedBindings;
			return [
				...(clause?.name ? [clause.name.text] : []),
				...(bindings && ts.isNamespaceImport(bindings) ? [bindings.name.text] : []),
				...(bindings && ts.isNamedImports(bindings) ? bindings.elements.map(each => each.name.text) : []),
			];
		}
		if (ts.isImportEqualsDeclaration(statement)) return [statement.name.text];
		if (ts.isModuleDeclaration(statement)) return ts.isIdentifier(statement.name) ? [statement.name.text] : [];
		const name = (statement as { name?: ts.Node }).name;
		return name && ts.isIdentifier(name) ? [name.text] : [];
	});
}

/** The names a node declares for what is inside it: parameters, type parameters, a loop's variable, a function expression's own name. */
function declaredInside(node: ts.Node): string[] {
	const names: string[] = [];
	const typeParameters = (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
	for (const each of typeParameters ?? []) names.push(each.name.text);
	if (ts.isFunctionLike(node)) names.push(...node.parameters.flatMap(parameter => bound(parameter.name)));
	if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) names.push(node.name.text);
	if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) names.push(...declaredBy(node.statements));
	if (ts.isCaseBlock(node)) names.push(...declaredBy(node.clauses.flatMap(clause => clause.statements)));
	if ((ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
		for (const each of node.initializer.declarations) names.push(...bound(each.name));
	}
	if (ts.isCatchClause(node) && node.variableDeclaration) names.push(...bound(node.variableDeclaration.name));
	if (ts.isMappedTypeNode(node)) names.push(node.typeParameter.name.text);
	if (ts.isInferTypeNode(node)) names.push(node.typeParameter.name.text);
	return names;
}

/** Whether an identifier names something in scope, rather than a property, a label or what a declaration declares. */
function isReference(id: ts.Identifier): boolean {
	const parent = id.parent;
	if (ts.isShorthandPropertyAssignment(parent)) return parent.name === id;
	if ((parent as { name?: ts.Node }).name === id) return false;
	if (ts.isQualifiedName(parent)) return parent.left === id;
	if (ts.isBindingElement(parent)) return parent.initializer === id;
	if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
	return !(ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent) || ts.isMetaProperty(parent));
}

/**
 * The names a file uses without declaring them in a scope that reaches the
 * use, and without importing them: what it expects from outside.
 */
export function freeNames(file: ts.SourceFile): Set<string> {
	const free = new Set<string>();
	const visit = (node: ts.Node, scopes: Set<string>[]) => {
		const own = declaredInside(node);
		// `infer U` declares U for the whole conditional type it is in.
		if (ts.isConditionalTypeNode(node)) {
			node.extendsType.forEachChild(function infers(child): void {
				if (ts.isInferTypeNode(child)) own.push(child.typeParameter.name.text);
				child.forEachChild(infers);
			});
		}
		const inner = own.length ? [...scopes, new Set(own)] : scopes;
		if (ts.isIdentifier(node) && isReference(node) && !inner.some(scope => scope.has(node.text))) free.add(node.text);
		node.forEachChild(child => visit(child, inner));
	};
	visit(file, []);
	return free;
}

/**
 * The file with an import line after its last for every name of the table
 * it uses and does not declare - or as it is, when it uses none.
 */
export function withAutoImports(path: string, text: string, table: Map<string, AutoImport>): string {
	if (table.size === 0) return text;
	const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const wanted = [...freeNames(file)].map(name => table.get(name)).filter((entry): entry is AutoImport => entry !== undefined);
	if (wanted.length === 0) return text;

	const named = new Map<string, string[]>();
	const lines: string[] = [];
	for (const entry of wanted.sort((a, b) => a.name.localeCompare(b.name))) {
		if (entry.namespace) lines.push(`import * as ${entry.name} from "${entry.from}";`);
		else named.set(entry.from, [...(named.get(entry.from) ?? []), entry.name]);
	}
	for (const [from, names] of named) lines.unshift(`import { ${names.join(', ')} } from "${from}";`);
	return `${text.replace(/\s*$/, '')}\n${lines.join(' ')}\n`;
}

// ---------------------------------------------------------------- the editor

/**
 * `.amxts/imports.d.ts`: the table as globals, so that the editor completes,
 * checks and goes to the definition of what a plugin uses without an import.
 * An alias, not a copy: a class is its type and its value, a namespace its
 * types too (`menus.Menu`).
 */
export function importsDeclaration(table: AutoImport[]): string {
	const sources = [...new Set(table.map(entry => entry.from))];
	const alias = (from: string) => `__${sources.indexOf(from)}`;
	return [
		'// GENERATED by amxts prepare: what the plugins use without an import - the',
		'// facade\'s API and what the modules in amxts.config.ts give. The build adds',
		'// the imports; this file tells the editor.',
		...sources.map(from => `import * as ${alias(from)} from "${from}";`),
		'',
		'declare global {',
		...table.map(entry => `\texport import ${entry.name} = ${alias(entry.from)}${entry.namespace ? '' : `.${entry.name}`};`),
		'}',
		'',
		'export {};',
		'',
	].join('\n');
}
