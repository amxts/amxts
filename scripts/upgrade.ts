import type { Kind } from './upgrade-names';
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
// =>`, and so does `(player, args) =>` that never reads `args`; one that
// reads the words after the name is listed, to be written by hand with the
// words in the usage. An import of `@amxts/core/http` goes:
// fetch is a global, and what reads its response the old way is listed.
// `Player.all(options)` is `server.players` and a `filter`; a field, a method
// or a game event named in the engine's words has the player's
// (scripts/upgrade-names.ts: `player.account` is `player.money`, the event
// `restartRound` is `newRound`), and one left out of the API is listed, to be
// read with the natives. A flag's name is lowerCamelCase where the code
// says it is one: `player.buttons.includes("Jump")` is `includes("jump")`.
// A game message is heard through its own method, by
// its name in the player's words: `server.addEventListener("message:DeathMsg",
// ...)` is `server.addMessageListener("death", ...)`. What is rewritten no
// longer matches, so a second run changes nothing.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { MESSAGE_NAMES } from './client-messages';
import { CORE_ENTRIES, CORE_PLUGINS, loadProject } from './project';
import { c, log } from './ui';
import { COMMON, EVENTS, HIDDEN, HIDDEN_EVENTS, RENAMED } from './upgrade-names';

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

/** Whether a function reads a parameter after its first: `(player, args) =>` that never reads `args` takes the player alone. */
function readsWords(fn: ts.ArrowFunction | ts.FunctionExpression): boolean {
	const names = new Set(fn.parameters.slice(1).map(param => ts.isIdentifier(param.name) ? param.name.text : ''));
	if (names.has('')) return true;
	const reads = (node: ts.Node): boolean =>
		(ts.isIdentifier(node) && names.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) || ts.forEachChild(node, reads) === true;
	return reads(fn.body);
}

/** The parameter list's text for a handler that took the player as `name`: `{ player }`, or `{ player: name }`. */
function playerBinding(name: string): string {
	return name === 'player' ? '{ player }' : `{ player: ${name} }`;
}

/**
 * A file's command handlers brought to one argument: `(player) =>` becomes
 * `({ player }) =>`, a function passed by its name and taking the player is
 * called from `({ player }) => name(player)`. A handler that reads the words
 * after the name - a second parameter it uses, or a server command's one - is
 * left, with what to write; one that takes nothing, or already one object, is
 * right.
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
			if (!player || readsWords(handler)) {
				left.push({ file, line: lineOf(handler), why: BY_HAND });
				return;
			}
			const param = params[0];
			const end = params[params.length - 1].getEnd();
			const parenthesized = text[param.getStart(source) - 1] === '(' || text.slice(handler.getStart(source), param.getStart(source)).includes('(');
			const binding = playerBinding((param.name as ts.Identifier).text);
			edits.push({ start: param.getStart(source), end, with: parenthesized ? binding : `(${binding})`, from: text.slice(param.getStart(source), end) });
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

const eventClass = (name: string) => `${name[0].toUpperCase()}${name.slice(1)}Event`;
const EVENT_CLASSES = new Map(Object.entries(EVENTS).map(([from, to]) => [eventClass(from), eventClass(to)]));
const HIDDEN_CLASSES = new Map(Object.entries(HIDDEN_EVENTS).map(([name, native]) => [eventClass(name), native]));

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

/** The fields that are a weapon - the ones a player's `items` hold - and the entity classes a `new` or an annotation names. */
const WEAPON_FIELDS = new Set(['activeItem', 'lastItem', 'activeItemSent', 'clientActiveItem']);
const CLASSES = new Set<Kind>(['Player', 'Weapon', 'Entity']);
/** An annotation of one of them, or a list of them: `Player | null`, `Weapon[]`. */
const ONE_TYPE = /^(Player|Weapon|Entity)(?:\s*\|\s*(?:null|undefined))*$/;
const LIST_TYPE = /^(?:(Player|Weapon|Entity)\[\]|Array<(Player|Weapon|Entity)>)$/;

/**
 * A file's declarations by name, as TypeScript binds them: one file alone,
 * no library - enough to tell which `player` a name is, not to type it.
 */
function declarationOf(source: ts.SourceFile): (name: ts.Identifier) => ts.Declaration | undefined {
	const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
	const host = ts.createCompilerHost(options);
	host.getSourceFile = name => name === source.fileName ? source : undefined;
	const checker = ts.createProgram([source.fileName], options, host).getTypeChecker();
	return name => (ts.isShorthandPropertyAssignment(name.parent) ? checker.getShorthandAssignmentValueSymbol(name.parent) : checker.getSymbolAtLocation(name))?.declarations?.[0];
}

/** The old names of fields and methods, renamed or out of the API. */
const OLD_MEMBERS = new Set([...Object.values(RENAMED), ...Object.values(HIDDEN)].flatMap(Object.keys));

/** An old name a file may hold: a field, a method, an event or its class. */
const OLD_NAMES = new RegExp(`\\b(?:Player\\.all|${[
	...OLD_MEMBERS,
	...Object.keys(EVENTS),
	...Object.keys(HIDDEN_EVENTS),
].map(name => name.replace(/^./, first => `[${first}${first.toUpperCase()}]`)).join('|')})\\b`);

/**
 * A file brought to the API's names. `Player.all()` is `server.players`, and
 * its options a `filter` of what each one tested. A field or a method named
 * after the engine's member (`player.account`, `game.numCtWins`,
 * `weapon.inReload`) is the player's word (`money`, `ctWins`, `isReloading`),
 * and a game event's name in `addEventListener` and its class are the new
 * ones. Without a type checker a value is a player, a weapon, an entity or the
 * game where the code says so: `event.player`, `new Weapon(id)`, an
 * annotation, `player.activeItem`, an element of `server.players` or of a
 * player's `items`, `{ player }` taken from an event or a command, a
 * command handler's first parameter, `game`.
 * The rest is listed: an old name on a value the code does not say, options
 * not written out as `true` or a team's name, and a field or an event left out
 * of the API, which the natives reach.
 */
export function upgradeNames(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!OLD_NAMES.test(text)) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const declaration = declarationOf(source);
	const edits: Edit[] = [];
	const left: Left[] = [];
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const replace = (node: ts.Node, to: string) => edits.push({ start: node.getStart(source), end: node.getEnd(), with: to, from: node.getText(source) });
	const leave = (node: ts.Node, why: string) => left.push({ file, line: lineOf(node), why });

	const bare = (node: ts.Expression): ts.Expression => ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) ? bare(node.expression) : node;
	const isPlayerAll = (node: ts.Node): boolean =>
		ts.isPropertyAccessExpression(node) && node.name.text === 'all' && ts.isIdentifier(node.expression) && node.expression.text === 'Player';
	const method = (node: ts.Expression) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) ? node.expression : undefined;

	/** What the elements of a list are: `server.players`, a player's `items`, `Entity.findAll(...)`. */
	const elementsOf = (expr: ts.Expression): Kind | undefined => {
		const node = bare(expr);
		if (ts.isPropertyAccessExpression(node)) {
			if (node.name.text === 'players' && ts.isIdentifier(node.expression) && node.expression.text === 'server') return 'Player';
			return node.name.text === 'items' && kindOf(node.expression) === 'Player' ? 'Weapon' : undefined;
		}
		const call = method(node);
		if (call) {
			if (isPlayerAll(call)) return 'Player';
			if (call.name.text === 'findAll' && ts.isIdentifier(call.expression) && call.expression.text === 'Entity') return 'Entity';
			return SAME_ELEMENTS.has(call.name.text) ? elementsOf(call.expression) : undefined;
		}
		const declared = ts.isIdentifier(node) ? declaration(node) : undefined;
		if (!declared || !ts.isVariableDeclaration(declared)) return undefined;
		if (declared.type) return (declared.type.getText(source).match(LIST_TYPE)?.slice(1).find(Boolean) as Kind | undefined);
		return declared.initializer && elementsOf(declared.initializer);
	};

	/** What a value is, where the code says so. */
	const kindOf = (expr: ts.Expression): Kind | undefined => {
		const node = bare(expr);
		if (ts.isNewExpression(node)) return ts.isIdentifier(node.expression) && CLASSES.has(node.expression.text as Kind) ? node.expression.text as Kind : undefined;
		if (ts.isPropertyAccessExpression(node)) return node.name.text === 'player' ? 'Player' : WEAPON_FIELDS.has(node.name.text) ? 'Weapon' : undefined;
		if (ts.isElementAccessExpression(node)) return elementsOf(node.expression);
		const call = method(node);
		if (call) return ELEMENT_OF.has(call.name.text) ? elementsOf(call.expression) : undefined;
		if (!ts.isIdentifier(node)) return undefined;
		const declared = declaration(node);
		// `game` is the facade's, auto-imported or imported by name.
		if (node.text === 'game' && (!declared || ts.isImportSpecifier(declared))) return 'Game';
		return declared && declaredKind(declared);
	};

	const declaredKind = (declared: ts.Declaration): Kind | undefined => {
		if (ts.isBindingElement(declared)) return (declared.propertyName ?? declared.name).getText(source) === 'player' ? 'Player' : undefined;
		if (!ts.isVariableDeclaration(declared) && !ts.isParameter(declared)) return undefined;
		if (declared.type) return declared.type.getText(source).match(ONE_TYPE)?.[1] as Kind | undefined;
		if (ts.isVariableDeclaration(declared)) {
			if (declared.initializer) return kindOf(declared.initializer);
			const loop = declared.parent.parent;
			return ts.isForOfStatement(loop) ? elementsOf(loop.expression) : undefined;
		}
		// The first parameter of a callback over a list, `.filter(each => ...)`,
		// or of a command's handler that reads the words, `(player, args) =>`.
		const fn = declared.parent;
		const call = fn.parent;
		if (fn.parameters[0] !== declared || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return undefined;
		if (call.expression.name.text === 'addCommand' && call.arguments[1] === fn && call.expression.expression.getText(source) === 'server') return 'Player';
		return ELEMENT_CALLBACKS.has(call.expression.name.text) ? elementsOf(call.expression.expression) : undefined;
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

	/** A field or a method by an old name: the new one where the value is known, else a line for the author. */
	const upgradeMember = (node: ts.PropertyAccessExpression) => {
		const name = node.name.text;
		if (!OLD_MEMBERS.has(name) || node.expression.kind === ts.SyntaxKind.ThisKeyword) return;
		const kind = kindOf(node.expression);
		const renamed = kind && RENAMED[kind][name];
		const hidden = kind && HIDDEN[kind][name];
		if (renamed) replace(node.name, renamed);
		else if (hidden) leave(node, `${name} is not in the API: read it with the natives of @amxts/core/natives, e.g. get_member(id, ${hidden})`);
		if (kind || COMMON.has(name)) return;
		const where = (Object.keys(RENAMED) as Kind[]).filter(each => RENAMED[each][name]);
		if (where.length) leave(node, `${name} is ${where.map(each => `\`${RENAMED[each][name]}\` on ${each === 'Game' ? 'the game' : `a ${each}`}`).join(', ')}: if this is one, write that`);
	};

	/** A game event's name in `addEventListener`: the new one, or a line for one out of the API. */
	const upgradeListener = (call: ts.CallExpression) => {
		const name = call.arguments[0];
		if (!name || !ts.isStringLiteralLike(name)) return;
		const to = EVENTS[name.text];
		if (to) edits.push({ start: name.getStart(source) + 1, end: name.getEnd() - 1, with: to, from: name.text });
		else if (Object.hasOwn(HIDDEN_EVENTS, name.text)) leave(name, `"${name.text}" is not in the API: hook it with @amxts/core/natives, ${HIDDEN_EVENTS[name.text]}`);
	};

	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && isPlayerAll(node.expression)) {
			const to = playersOf(node);
			if (to) replace(node, to);
			else leave(node, 'Player.all is server.players: write its options as a filter, server.players.filter(player => player.isAlive && player.team === "CT")');
			node.arguments.forEach(visit);
			return;
		}
		upgradeNode(node);
		ts.forEachChild(node, visit);
	};

	const upgradeNode = (node: ts.Node) => {
		if (isPlayerAll(node)) {
			leave(node, 'Player.all is server.players, a list read each time');
			return;
		}

		if (ts.isIdentifier(node)) {
			const to = EVENT_CLASSES.get(node.text);
			if (to) replace(node, to);
			else if (HIDDEN_CLASSES.has(node.text)) leave(node, `${node.text} is not in the API: hook its event with @amxts/core/natives, ${HIDDEN_CLASSES.get(node.text)}`);
			return;
		}

		if (ts.isPropertyAccessExpression(node)) {
			upgradeMember(node);
			return;
		}

		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && /^(?:add|remove)EventListener$/.test(node.expression.name.text)) upgradeListener(node);
	};
	visit(source);
	return { ...applyEdits(file, text, source, edits), left };
}

/** The methods a message was listened to with, and the ones it is now. */
const MESSAGE_METHODS: Record<string, string> = { addEventListener: 'addMessageListener', removeEventListener: 'removeMessageListener' };

/**
 * A file's game messages brought to their own methods:
 * `addEventListener("message:DeathMsg", ...)` is
 * `addMessageListener("death", ...)`, and `removeEventListener` likewise. A
 * name the game does not have is listed.
 */
export function upgradeMessages(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!text.includes('message:')) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const edits: Edit[] = [];
	const left: Left[] = [];

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
		const method = MESSAGE_METHODS[node.expression.name.text];
		const name = node.arguments[0];
		if (!method || !name || !ts.isStringLiteralLike(name) || !name.text.startsWith('message:')) return;
		const to = MESSAGE_NAMES[name.text.slice('message:'.length)];
		if (!to) {
			left.push({ file, line: source.getLineAndCharacterOfPosition(name.getStart(source)).line + 1, why: `"${name.text}" is not a message the game has: server.addMessageListener takes one of the names the editor lists` });
			return;
		}
		edits.push({ start: node.expression.name.getStart(source), end: node.expression.name.getEnd(), with: method, from: node.expression.name.text });
		edits.push({ start: name.getStart(source) + 1, end: name.getEnd() - 1, with: to, from: name.text });
	};
	visit(source);
	return { ...applyEdits(file, text, source, edits), left };
}

/** The flag families: a value of one, or a list of them, is a flag's name. */
const FLAG_FAMILIES = ['HideHud', 'Button', 'Effect', 'EntityFlag', 'Damage', 'Access', 'ScoreStatus', 'WeaponState', 'PhysicsFlag', 'FlagName'];
/** The fields that hold flags: `player.hideHud`, `entity.flags`, `event.damageType`. */
const FLAG_FIELDS = new Set(['access', 'buttons', 'oldButtons', 'buttonLast', 'buttonPressed', 'buttonReleased', 'hideHud', 'hideHudSent', 'damageType', 'effects', 'flags', 'physicsFlags', 'weaponState']);
/** The options that take flags: `bot.move({ buttons })`, `server.addCommand(..., { access })`. */
const FLAG_OPTIONS = new Set(['access', 'buttons']);
/** The calls that take flags, by the argument's place: `screen.hideHud(["Money"])`, `cmd(name, handler, "KICK")`. */
const FLAG_ARGUMENTS: Record<string, number> = { hideHud: 0, heal: 1, cmd: 2, cmdWide: 2 };
/** The array methods that take an element or a list of them: `buttons.includes("Jump")`. */
const ELEMENT_ARGUMENTS = new Set(['includes', 'indexOf', 'lastIndexOf', 'push', 'unshift', 'concat']);
const FLAG_TYPE = new RegExp(`\\b(?:${FLAG_FAMILIES.join('|')})\\b`);
const FLAG_WORDS = new RegExp(`\\b(?:${[...new Set([...FLAG_FAMILIES, ...FLAG_FIELDS, ...Object.keys(FLAG_ARGUMENTS)])].join('|')})\\b`);
const COMPARISONS = new Set([
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * A flag's name as the API writes it, lowerCamelCase like every union value:
 * `"Jump"` is `"jump"`, a command's `"LEVEL_A"` is `"levelA"`; null for a
 * name already written so.
 */
function flagName(old: string, constant: boolean): string | null {
	if (constant) return /^[A-Z][A-Z0-9_]*$/.test(old) ? old.toLowerCase().replace(/_([a-z0-9])/g, (_, next: string) => next.toUpperCase()) : null;
	return /^[A-Z][a-z0-9]\w*$/.test(old) ? old[0].toLowerCase() + old.slice(1) : null;
}

/**
 * A file's flag names brought to lowerCamelCase: `player.buttons.includes("Jump")`
 * is `includes("jump")`. A string is a flag's name where the code says so
 * without a type checker: assigned to a flag field (`player.hideHud =
 * ["Money"]`) or an option (`{ buttons: ["Jump"] }`, `{ access: "Kick" }`),
 * given to `includes`, `push` or `concat` of one, to `screen.hideHud`,
 * `heal` or `cmd`, compared with an element of one (`flag != "Bomb"` in its
 * `filter`, a `for of` over it, a `switch`), or held by a name annotated with
 * a family (`const parts: HideHud[] = ["Money"]`, a parameter `button:
 * Button`, and what the file's own function takes there). A name given where a
 * flag goes is followed to the literal it was declared with; one the file
 * does not say - a parameter, an import, a function's result - is listed.
 */
export function upgradeFlags(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!FLAG_WORDS.test(text)) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const declaration = declarationOf(source);
	const edits: Edit[] = [];
	const left: Left[] = [];
	const followed = new Set<ts.Node>();
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

	const callee = (node: ts.CallExpression) => ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : ts.isIdentifier(node.expression) ? node.expression.text : '';

	/** Whether a list holds flags: a flag field, `accessOf`'s rights, a name annotated or declared as one, the same list filtered. */
	const isFlags = (node: ts.Node): boolean => {
		if (ts.isPropertyAccessExpression(node)) return FLAG_FIELDS.has(node.name.text);
		if (ts.isCallExpression(node)) return callee(node) === 'accessOf' || (ts.isPropertyAccessExpression(node.expression) && SAME_ELEMENTS.has(node.expression.name.text) && isFlags(node.expression.expression));
		const declared = ts.isIdentifier(node) ? declaration(node) : undefined;
		return holdsFlags(declared) || (!!declared && ts.isVariableDeclaration(declared) && !!declared.initializer && isFlags(declared.initializer));
	};

	/** Whether a name holds a flag or a list of them: annotated with a family, or an element of a flag field in its callback or its `for of`. */
	const holdsFlags = (declared: ts.Node | undefined): boolean => {
		if (!declared || !(ts.isParameter(declared) || ts.isVariableDeclaration(declared))) return false;
		if (declared.type) return FLAG_TYPE.test(declared.type.getText(source));
		const owner = declared.parent;
		if (ts.isParameter(declared)) {
			const call = owner.parent;
			return ts.isFunctionLike(owner) && owner.parameters[0] === declared && ts.isCallExpression(call) && call.arguments[0] === owner
				&& ts.isPropertyAccessExpression(call.expression) && ELEMENT_CALLBACKS.has(call.expression.name.text) && isFlags(call.expression.expression);
		}
		return ts.isVariableDeclarationList(owner) && ts.isForOfStatement(owner.parent) && isFlags(owner.parent.expression);
	};
	const isFlag = (node: ts.Expression) =>
		(ts.isIdentifier(node) && holdsFlags(declaration(node))) || (ts.isElementAccessExpression(node) && isFlags(node.expression));

	/** A value where flags go: its strings rewritten, a name followed to its literal, what the file does not say listed. */
	const value = (node: ts.Expression, constant = false): void => {
		if (followed.has(node)) return;
		followed.add(node);
		if (ts.isStringLiteralLike(node)) {
			const to = flagName(node.text, constant);
			if (to) edits.push({ start: node.getStart(source) + 1, end: node.getEnd() - 1, with: to, from: node.text });
		} else if (ts.isArrayLiteralExpression(node)) {
			for (const element of node.elements) value(element, constant);
		} else if (ts.isSpreadElement(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
			value(node.expression, constant);
		} else if (ts.isConditionalExpression(node)) {
			value(node.whenTrue, constant);
			value(node.whenFalse, constant);
		} else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && SAME_ELEMENTS.has(node.expression.name.text)) {
			value(node.expression.expression, constant);
			if (node.expression.name.text === 'concat') {
				for (const list of node.arguments) value(list, constant);
			}
		} else if (ts.isIdentifier(node)) {
			const declared = declaration(node);
			if (holdsFlags(declared)) return;
			if (declared && ts.isVariableDeclaration(declared) && declared.initializer) value(declared.initializer, constant);
			else left.push({ file, line: lineOf(node), why: `flag names are lowerCamelCase ("jump", not "Jump"): write the ones \`${node.text}\` holds so` });
		} else if (!isFlags(node) && !isFlag(node)) {
			left.push({ file, line: lineOf(node), why: `flag names are lowerCamelCase ("jump", not "Jump"): write the ones \`${node.getText(source)}\` gives so` });
		}
	};

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		if (ts.isBinaryExpression(node)) {
			const operator = node.operatorToken.kind;
			if (operator === ts.SyntaxKind.EqualsToken && (isFlags(node.left) || isFlag(node.left))) value(node.right);
			if (!COMPARISONS.has(operator)) return;
			if (isFlag(node.left) && ts.isStringLiteralLike(node.right)) value(node.right);
			if (isFlag(node.right) && ts.isStringLiteralLike(node.left)) value(node.left);
		} else if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.initializer && node.type && holdsFlags(node)) {
			value(node.initializer);
		} else if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && FLAG_OPTIONS.has(node.name.text)) {
			value(node.initializer);
		} else if (ts.isShorthandPropertyAssignment(node) && FLAG_OPTIONS.has(node.name.text)) {
			value(node.name);
		} else if (ts.isCaseClause(node) && isFlag(node.parent.parent.expression)) {
			value(node.expression);
		} else if (ts.isCallExpression(node)) {
			const name = callee(node);
			const at = FLAG_ARGUMENTS[name];
			if (at !== undefined && node.arguments[at]) value(node.arguments[at], name.startsWith('cmd'));
			if (ELEMENT_ARGUMENTS.has(name) && ts.isPropertyAccessExpression(node.expression) && isFlags(node.expression.expression) && node.arguments[0]) value(node.arguments[0]);
			const own = ts.isIdentifier(node.expression) ? declaration(node.expression) : undefined;
			const fn = own && ts.isVariableDeclaration(own) ? own.initializer : own;
			if (fn && ts.isFunctionLike(fn)) {
				node.arguments.forEach((argument, i) => {
					if (fn.parameters[i]?.type && holdsFlags(fn.parameters[i])) value(argument);
				});
			}
		}
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
		const names = upgradeNames(name, handlers.text);
		const messages = upgradeMessages(name, names.text);
		const flags = upgradeFlags(name, messages.text);
		left.push(...http.left, ...handlers.left, ...names.left, ...messages.left, ...flags.left);
		if (flags.text === text) continue;
		writeFileSync(file, flags.text);
		changes.push(...http.changes, ...imports.changes, ...handlers.changes, ...names.changes, ...messages.changes, ...flags.changes);
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
