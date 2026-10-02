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
// one is left alone, and only the text between the quotes changes. A
// command's handler takes one object: `(player) =>` becomes `({ player })
// =>`; one that reads the words after the name is listed, to be written by
// hand with the words in the usage. An import of `@amxts/core/http` goes:
// fetch is a global, and what reads its response the old way is listed.
// `Player.all(options)` is `server.players` and a `filter`, `player.account`
// `player.money`, and the events `addAccount`, `restartRound` and
// `onRoundFreezeEnd` are `addMoney`, `newRound` and `roundStart`. What is
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
const FACADE_PARTS = ['entities', 'events', 'flags', 'hooks', 'vector', 'effects', 'fetch'];

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

/** A command handler upgrade cannot rewrite itself: where, and what to do. */
export interface Left {
	file: string;
	line: number;
	why: string;
}

/** Where fetch was imported from before it was a global. */
const HTTP = new Set(['@amxts/core/http', '~/modules/http']);

const HTTP_BY_HAND = 'fetch is a global now, as in the browser: the body is `await response.text()` (or `response.json<T>()`), headers an object `{ name: value }`, and useFetch<T>(url) reads JSON in one call';

/**
 * A file's imports of fetch from `@amxts/core/http` taken out, each with its
 * line: fetch, Response and RequestInit are globals. What reads a response's
 * `text` as a field is the author's to change, so every file that had the
 * import is listed.
 */
export function dropHttpImports(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!text.includes('http')) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const found = source.statements.filter((statement): statement is ts.ImportDeclaration =>
		ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && HTTP.has(statement.moduleSpecifier.text));
	let out = text;
	for (const statement of [...found].reverse()) {
		const end = statement.getEnd();
		const next = out.startsWith('\r\n', end) ? end + 2 : out.startsWith('\n', end) ? end + 1 : end;
		out = out.slice(0, statement.getStart(source)) + out.slice(next);
	}
	const lineOf = (statement: ts.Node) => source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1;
	return {
		text: out,
		changes: found.map(statement => ({ file, line: lineOf(statement), from: (statement.moduleSpecifier as ts.StringLiteral).text, to: 'fetch, a global' })),
		left: found.slice(0, 1).map(statement => ({ file, line: lineOf(statement), why: HTTP_BY_HAND })),
	};
}

const BY_HAND = 'it reads the words after the name: write them in the usage, "/give <amount>", and take them by name, ({ player, amount })';

/** The parameter list's text for a handler that took the player as `name`: `{ player }`, or `{ player: name }`. */
function playerBinding(name: string): string {
	return name === 'player' ? '{ player }' : `{ player: ${name} }`;
}

/**
 * A file's command handlers brought to one argument: `(player) =>` becomes
 * `({ player }) =>`, a function passed by its name and taking the player is
 * called from `({ player }) => name(player)`. A handler that reads the words
 * after the name - a second parameter, or a server command's one - is left,
 * with what to write; one that takes nothing, or already one object, is right.
 */
export function upgradeHandlers(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!text.includes('addCommand') && !text.includes('addServerCommand')) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const edits: Edit[] = [];
	const left: Left[] = [];
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const declared = new Map(source.statements.filter(ts.isFunctionDeclaration).filter(fn => fn.name).map(fn => [fn.name!.text, fn]));

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
		const method = node.expression.name.text;
		if ((method !== 'addCommand' && method !== 'addServerCommand') || !ts.isIdentifier(node.expression.expression) || node.expression.expression.text !== 'server') return;
		const handler = node.arguments[1];
		if (!handler) return;
		const player = method === 'addCommand';

		if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) {
			const params = handler.parameters;
			if (params.length === 0 || !ts.isIdentifier(params[0].name)) return;
			if (!player || params.length > 1) {
				left.push({ file, line: lineOf(handler), why: BY_HAND });
				return;
			}
			const param = params[0];
			const parenthesized = text[param.getStart(source) - 1] === '(' || text.slice(handler.getStart(source), param.getStart(source)).includes('(');
			const binding = playerBinding((param.name as ts.Identifier).text);
			edits.push({ start: param.getStart(source), end: param.getEnd(), with: parenthesized ? binding : `(${binding})`, from: param.getText(source) });
			return;
		}

		if (ts.isIdentifier(handler) || ts.isPropertyAccessExpression(handler)) {
			const fn = ts.isIdentifier(handler) ? declared.get(handler.text) : undefined;
			if (!fn) {
				left.push({ file, line: lineOf(handler), why: `${handler.getText(source)} is declared elsewhere: if it takes the player, pass ({ player }) => ${handler.getText(source)}(player)` });
				return;
			}
			if (fn.parameters.length === 0) return;
			if (!player || fn.parameters.length > 1 || !ts.isIdentifier(fn.parameters[0].name)) {
				left.push({ file, line: lineOf(handler), why: BY_HAND });
				return;
			}
			edits.push({ start: handler.getStart(source), end: handler.getEnd(), with: `({ player }) => ${handler.getText(source)}(player)`, from: handler.getText(source) });
		}
	};
	visit(source);
	return { ...applyEdits(file, text, source, edits), left };
}

/** A piece of a file's text to replace: where, with what, and what it was. */
interface Edit {
	start: number;
	end: number;
	with: string;
	from: string;
}

/** The text with its edits made - from the end, so every earlier position stays where it was - and each as a change. */
function applyEdits(file: string, text: string, source: ts.SourceFile, edits: Edit[]): { text: string; changes: Change[] } {
	let out = text;
	for (const edit of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.with + out.slice(edit.end);
	return {
		text: out,
		changes: edits.map(edit => ({ file, line: source.getLineAndCharacterOfPosition(edit.start).line + 1, from: edit.from, to: edit.with })),
	};
}

/** Game events named after ReGameDLL's functions, by the player's words for them; each event's class follows its name. */
const EVENT_NAMES = new Map([
	['addAccount', 'addMoney'],
	['restartRound', 'newRound'],
	['onRoundFreezeEnd', 'roundStart'],
]);
const eventClass = (name: string) => `${name[0].toUpperCase()}${name.slice(1)}Event`;
const EVENT_CLASSES = new Map([...EVENT_NAMES].map(([from, to]) => [eventClass(from), eventClass(to)]));

/** `Player.all`'s options, each as the test of a player it was, for the value `true`; `false` narrowed nothing. */
const PLAYER_TESTS: Record<string, string> = {
	alive: 'player.isAlive',
	dead: '!player.isAlive',
	bots: 'player.isBot',
	humans: '!player.isBot',
};

/** The array methods whose callback takes the array's element first. */
const ELEMENT_CALLBACKS = new Set(['filter', 'find', 'findLast', 'forEach', 'map', 'some', 'every', 'flatMap']);
/** The array methods that give an element, and the ones that give an array of the same elements. */
const ELEMENT_OF = new Set(['find', 'findLast', 'at', 'pop', 'shift']);
const SAME_ELEMENTS = new Set(['filter', 'slice', 'concat', 'sort', 'reverse', 'toSorted', 'toReversed']);

/** A type annotation that says a player, or a list of players. */
const PLAYER_TYPE = /^Player(?:\s*\|\s*(?:null|undefined))*$/;
const PLAYERS_TYPE = /^(?:Player\[\]|Array<Player>)$/;

const ACCOUNT_BY_HAND = 'the player\'s money is `money`: if this is a Player, write `.money`';

/**
 * A file's declarations by name, as TypeScript binds them: one file alone,
 * no library - enough to tell which `player` a name is, not to type it.
 */
function declarationOf(source: ts.SourceFile): (name: ts.Identifier) => ts.Declaration | undefined {
	const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
	const host = ts.createCompilerHost(options);
	host.getSourceFile = name => name === source.fileName ? source : undefined;
	const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
	return name => checker.getSymbolAtLocation(name)?.declarations?.[0];
}

/**
 * A file brought to the API's names for players: `Player.all()` is
 * `server.players`, and its options a `filter` of what each one tested;
 * `player.account` is `player.money`; the events `addAccount`,
 * `restartRound` and `onRoundFreezeEnd` - their names in
 * `addEventListener`, and their classes - are `addMoney`, `newRound` and
 * `roundStart`. Without a type checker a receiver is a player where the code
 * says so: `event.player`, `new Player(id)`, a `Player` annotation, an element
 * of the players, `{ player }` taken from an event or a command. Any other
 * `.account`, and options not written out as `true` or a team's name, are
 * listed.
 */
export function upgradePlayers(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!/Player\.all|\.account\b|addAccount|AddAccount|estartRound|nRoundFreezeEnd/.test(text)) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const declaration = declarationOf(source);
	const edits: Edit[] = [];
	const left: Left[] = [];
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const replace = (node: ts.Node, to: string) => edits.push({ start: node.getStart(source), end: node.getEnd(), with: to, from: node.getText(source) });

	const bare = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) ? bare(node.expression) : node;
	const isPlayerAll = (node: ts.Node): node is ts.PropertyAccessExpression =>
		ts.isPropertyAccessExpression(node) && node.name.text === 'all' && ts.isIdentifier(node.expression) && node.expression.text === 'Player';
	const method = (node: ts.Expression) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression : undefined;

	const isPlayers = (expr: ts.Expression): boolean => {
		const node = bare(expr);
		if (ts.isPropertyAccessExpression(node)) return node.name.text === 'players' && ts.isIdentifier(node.expression) && node.expression.text === 'server';
		const call = method(node);
		if (call) return isPlayerAll(call) || (SAME_ELEMENTS.has(call.name.text) && isPlayers(call.expression));
		const declared = ts.isIdentifier(node) ? declaration(node) : undefined;
		if (!declared || !ts.isVariableDeclaration(declared)) return false;
		return declared.type ? PLAYERS_TYPE.test(declared.type.getText(source)) : !!declared.initializer && isPlayers(declared.initializer);
	};

	const isPlayer = (expr: ts.Expression): boolean => {
		const node = bare(expr);
		if (ts.isNewExpression(node)) return ts.isIdentifier(node.expression) && node.expression.text === 'Player';
		if (ts.isPropertyAccessExpression(node)) return node.name.text === 'player';
		if (ts.isElementAccessExpression(node)) return isPlayers(node.expression);
		const call = method(node);
		if (call) return ELEMENT_OF.has(call.name.text) && isPlayers(call.expression);
		const declared = ts.isIdentifier(node) ? declaration(node) : undefined;
		return !!declared && declaredPlayer(declared);
	};

	const declaredPlayer = (declared: ts.Declaration): boolean => {
		if (ts.isBindingElement(declared)) return (declared.propertyName ?? declared.name).getText(source) === 'player';
		if (!ts.isVariableDeclaration(declared) && !ts.isParameter(declared)) return false;
		if (declared.type) return PLAYER_TYPE.test(declared.type.getText(source));
		if (ts.isVariableDeclaration(declared)) {
			if (declared.initializer) return isPlayer(declared.initializer);
			const loop = declared.parent.parent;
			return ts.isForOfStatement(loop) && isPlayers(loop.expression);
		}
		// The first parameter of a callback over the players: `.filter(each => ...)`.
		const fn = declared.parent;
		const call = fn.parent;
		return fn.parameters[0] === declared && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
			&& ELEMENT_CALLBACKS.has(call.expression.name.text) && isPlayers(call.expression.expression);
	};

	/** `Player.all(options)` as `server.players`, or null when its options are not written out. */
	const playersOf = (call: ts.CallExpression): string | null => {
		const options = call.arguments[0];
		if (!options) return 'server.players';
		if (call.arguments.length > 1 || !ts.isObjectLiteralExpression(options)) return null;
		const tests: string[] = [];
		for (const option of options.properties) {
			if (!ts.isPropertyAssignment(option) || !ts.isIdentifier(option.name)) return null;
			const name = option.name.text;
			const value = option.initializer;
			if (name === 'team' && ts.isStringLiteral(value)) tests.push(`player.team === ${value.getText(source)}`);
			else if (PLAYER_TESTS[name] && value.kind === ts.SyntaxKind.TrueKeyword) tests.push(PLAYER_TESTS[name]);
			else if (!PLAYER_TESTS[name] || value.kind !== ts.SyntaxKind.FalseKeyword) return null;
		}
		return tests.length ? `server.players.filter(player => ${tests.join(' && ')})` : 'server.players';
	};

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && isPlayerAll(node.expression)) {
			const to = playersOf(node);
			if (to) replace(node, to);
			else left.push({ file, line: lineOf(node), why: 'Player.all is server.players: write its options as a filter, server.players.filter(player => player.isAlive && player.team === "CT")' });
			node.arguments.forEach(visit);
			return;
		}
		upgradeNode(node);
		ts.forEachChild(node, visit);
	};

	const upgradeNode = (node: ts.Node) => {
		if (isPlayerAll(node)) {
			left.push({ file, line: lineOf(node), why: 'Player.all is server.players, a list read each time' });
			return;
		}

		if (ts.isIdentifier(node) && EVENT_CLASSES.has(node.text)) {
			replace(node, EVENT_CLASSES.get(node.text)!);
			return;
		}

		if (ts.isPropertyAccessExpression(node) && node.name.text === 'account' && node.expression.kind !== ts.SyntaxKind.ThisKeyword) {
			if (isPlayer(node.expression)) replace(node.name, 'money');
			else left.push({ file, line: lineOf(node), why: ACCOUNT_BY_HAND });
			return;
		}

		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || !/^(?:add|remove)EventListener$/.test(node.expression.name.text)) return;
		const name = node.arguments[0];
		const to = name && ts.isStringLiteralLike(name) ? EVENT_NAMES.get(name.text) : undefined;
		if (to) edits.push({ start: name.getStart(source) + 1, end: name.getEnd() - 1, with: to, from: name.text });
	};
	visit(source);
	return { ...applyEdits(file, text, source, edits), left };
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

/** Rewrites the project in `dir`: every change, in the order of the files, and what is left to do by hand. */
export function upgradeProject(dir: string): { changes: Change[]; left: Left[] } {
	const project = loadProject(dir);
	const ownFolder = resolve(project.pluginsDir) !== resolve(CORE_PLUGINS);
	const renames = renamesFor(project.modules, place => ownFolder && existsSync(join(project.pluginsDir, place)));
	const changes: Change[] = [];
	const left: Left[] = [];
	for (const file of codeFiles(project.dir, new Set([project.outDir]))) {
		const text = readFileSync(file, 'utf8');
		const name = relative(project.dir, file).replace(/\\/g, '/');
		const http = dropHttpImports(name, text);
		const imports = http.text.includes('~/') ? upgradeText(name, http.text, renames) : { text: http.text, changes: [] };
		const handlers = upgradeHandlers(name, imports.text);
		const players = upgradePlayers(name, handlers.text);
		left.push(...http.left, ...handlers.left, ...players.left);
		if (players.text === text) continue;
		writeFileSync(file, players.text);
		changes.push(...http.changes, ...imports.changes, ...handlers.changes, ...players.changes);
	}
	return { changes, left };
}

// Run as a task (scripts/run.ts names it in argv) or by itself.
if (import.meta.main || resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
	const { changes, left } = upgradeProject(process.cwd());
	for (const change of changes) console.log(`  ${c.dim(`${change.file}:${change.line}`)}  ${change.from} ${c.dim('→')} ${change.to}`);
	const files = new Set(changes.map(change => change.file)).size;
	if (changes.length) log.success(`upgraded ${changes.length} place(s) in ${files} file(s)`);
	else if (!left.length) log.success('nothing to upgrade: the code already uses this core\'s API');
	for (const each of left) log.warn(`${each.file}:${each.line}  ${each.why}`);
}
