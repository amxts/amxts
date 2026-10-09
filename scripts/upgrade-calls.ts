import type { Change, Edit, Left } from './upgrade';
// The calls `amxts upgrade` brings up to date (scripts/upgrade.ts): the ones
// whose shape changed, not their name.
//
// - `print(player, text)` is `player.print(text)`, `print(0, text)` is
//   `server.print(text)`, and `print({ id, variant }, text)` is the same with
//   the variant last - `0` for everyone was Pawn's, and the object said what
//   the variant says. Once no call of the free print is left, its import goes. A player's id is read off his Player:
//   `print(player.id, ...)` is `player.print(...)`; another number is listed.
// - `removeAllItems(true)` is `removeAllItems({ suit: true })`: a bare
//   boolean nobody reads.
// - `Storage.get` gives `undefined` for a key that is not there, as `Map.get`
//   does: a comparison of its value with `null` compares with `undefined`,
//   and a `| null` it was annotated with is `| undefined`.
// - `give` takes any text: the cast to `ItemName` goes, and its import when
//   nothing else names the type.
// - A test's `server.vault(name)` is `server.storage(name)`: a Storage is not nVault.
// - An entity's `viewModel` and `weaponModel` are the model's file, text: a
//   `0` written or compared is `""`, another number is listed.
// - `cmd()` and `cmdWide()` take no `info`: the fourth argument goes.
// - Listed: a listener of the server events `pause`, `unpause` and `modules`,
//   which are gone; reapi's `DisableHookChain` and `EnableHookChain`, where a
//   `hook()` handle goes to `unhook`; `cells("text")` given to a call, where
//   a raw native takes a const string as it is.
import ts from 'typescript';
import { applyEdits } from './upgrade';

/** The words a file must have for a pass to look at it. */
const CALL_WORDS = /\bprint\s*\(|\bremoveAllItems\s*\(|\bStorage\b|\bgive\s*\(|\.vault\s*\(|\.(?:view|weapon)Model\b|\bcmd(?:Wide)?\s*\(|HookChain\s*\(|\bcells\s*\(|["'](?:pause|unpause|modules)["']/;

/** The server events AMX Mod X raises for a Pawn plugin about itself alone. */
const GONE_EVENTS = new Set(['pause', 'unpause', 'modules']);

/** The fields that held a number of the engine's strings and hold the model's file. */
const MODELS = new Set(['viewModel', 'weaponModel']);

/** What `x.print(` takes as it is; anything else is wrapped in parens. */
const PLAIN = new Set([
	ts.SyntaxKind.Identifier,
	ts.SyntaxKind.PropertyAccessExpression,
	ts.SyntaxKind.ElementAccessExpression,
	ts.SyntaxKind.CallExpression,
	ts.SyntaxKind.NonNullExpression,
	ts.SyntaxKind.ParenthesizedExpression,
	ts.SyntaxKind.ThisKeyword,
]);

const NULL_COMPARISONS = new Set([
	ts.SyntaxKind.EqualsEqualsToken,
	ts.SyntaxKind.EqualsEqualsEqualsToken,
	ts.SyntaxKind.ExclamationEqualsToken,
	ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/** A file's calls brought to their new shapes; what upgrade cannot rewrite safely is listed. */
export function upgradeCalls(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!CALL_WORDS.test(text)) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const edits: Edit[] = [];
	const left: Left[] = [];
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const textOf = (node: ts.Node) => node.getText(source);
	const replace = (node: ts.Node, to: string) => edits.push({ start: node.getStart(source), end: node.getEnd(), with: to, from: textOf(node) });
	// The names the rewrites took out of the code - the free print, the casts
	// give no longer needs - and how many times each.
	const gone = new Map<string, number>();
	const went = (name: string) => gone.set(name, (gone.get(name) ?? 0) + 1);

	// The names a Storage is held by, and the names that hold what its get gave.
	const storages = new Set<string>();
	const stored = new Set<string>();
	const isStorageGet = (node: ts.Node): boolean => {
		const call = ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) ? node.expression : node;
		return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === 'get'
			&& ts.isIdentifier(call.expression.expression) && storages.has(call.expression.expression.text);
	};
	const collect = (node: ts.Node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
			const init = node.initializer;
			if (ts.isNewExpression(init) && ts.isIdentifier(init.expression) && init.expression.text === 'Storage') storages.add(node.name.text);
		}
		ts.forEachChild(node, collect);
	};
	collect(source);
	const collectStored = (node: ts.Node) => {
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isStorageGet(node.initializer)) {
			stored.add(node.name.text);
			if (node.type && /\|\s*null\b/.test(textOf(node.type))) replace(node.type, textOf(node.type).replace(/\|\s*null\b/, '| undefined'));
		}
		ts.forEachChild(node, collectStored);
	};
	collectStored(source);

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);

		// `player.viewModel = 0`, `weapon.weaponModel == 0`
		if (ts.isBinaryExpression(node) && ts.isPropertyAccessExpression(node.left) && MODELS.has(node.left.name.text) && ts.isNumericLiteral(node.right)) {
			if (node.right.text === '0') replace(node.right, '""');
			else left.push({ file, line: lineOf(node), why: `${node.left.name.text} is the model's file now, text: "models/v_knife.mdl"` });
			return;
		}

		// `x == null`, where x is a Storage's get or a name that holds one.
		if (ts.isBinaryExpression(node) && NULL_COMPARISONS.has(node.operatorToken.kind)) {
			const sides = [node.left, node.right];
			const nullSide = sides.find(side => side.kind === ts.SyntaxKind.NullKeyword);
			const other = sides.find(side => side !== nullSide);
			if (nullSide && other && (isStorageGet(other) || (ts.isIdentifier(other) && stored.has(other.text)))) replace(nullSide, 'undefined');
			return;
		}
		if (!ts.isCallExpression(node)) return;
		const callee = node.expression;
		const args = node.arguments;

		// cmd(name, handler, flag, info) and cmdWide - no info.
		if (ts.isIdentifier(callee) && (callee.text === 'cmd' || callee.text === 'cmdWide') && args.length === 4) {
			edits.push({ start: args[2].getEnd(), end: args[3].getEnd(), with: '', from: text.slice(args[2].getEnd(), args[3].getEnd()) });
			return;
		}
		if (ts.isIdentifier(callee) && (callee.text === 'DisableHookChain' || callee.text === 'EnableHookChain')) {
			left.push({ file, line: lineOf(node), why: 'a hook() handle is the module\'s: take the hook off with unhook(handle), and hook() again to put it back' });
			return;
		}
		if (ts.isIdentifier(callee) && callee.text === 'cells' && args.length === 1 && ts.isStringLiteral(args[0]) && ts.isCallExpression(node.parent)) {
			left.push({ file, line: lineOf(node), why: `a raw native takes a const string as it is: ${textOf(args[0])}, not ${textOf(node)}` });
			return;
		}
		if (ts.isPropertyAccessExpression(callee) && /^(?:add|remove)EventListener$/.test(callee.name.text) && args[0] && ts.isStringLiteral(args[0]) && GONE_EVENTS.has(args[0].text)) {
			left.push({ file, line: lineOf(node), why: `the server event "${args[0].text}" is gone: AMX Mod X raises it for a Pawn plugin about itself alone - remove the listener` });
			return;
		}

		// print(player, ...), print(0, ...) and print({ id, variant }, text)
		// Only the callee and the first argument are rewritten, so a change
		// inside the text (a Storage's get) is kept.
		if (ts.isIdentifier(callee) && callee.text === 'print' && args.length >= 2) {
			let to = args[0];
			let place = '';
			const head = (to: string) => edits.push({ start: callee.getStart(source), end: args[1].getStart(source), with: to, from: text.slice(callee.getStart(source), args[1].getStart(source)) });
			if (ts.isObjectLiteralExpression(to)) {
				const { properties } = to;
				const field = (name: string) => properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name);
				const id = field('id');
				const variant = field('variant');
				if (!id || args.length > 2 || properties.some(p => p !== id && p !== variant)) {
					left.push({ file, line: lineOf(node), why: 'print takes a player now, and the place as its second argument: player.print(text, "center"); everyone is server.print(text, "center")' });
					return;
				}
				if (variant) place = `, ${textOf(variant.initializer)}`;
				to = id.initializer;
			}
			// A player's id names the player it is read off.
			if (ts.isPropertyAccessExpression(to) && to.name.text === 'id') to = to.expression;
			if (ts.isNumericLiteral(to) && to.text !== '0') {
				left.push({ file, line: lineOf(node), why: 'print takes a player now: `player.print(text)`' });
				return;
			}

			if (ts.isNumericLiteral(to)) head('server.print(');
			else head(`${PLAIN.has(to.kind) ? textOf(to) : `(${textOf(to)})`}.print(`);
			went('print');
			if (place) edits.push({ start: args[1].getEnd(), end: args[1].getEnd(), with: place, from: '' });
			return;
		}
		if (!ts.isPropertyAccessExpression(callee)) return;

		// removeAllItems(true) - the suit too.
		if (callee.name.text === 'removeAllItems' && args.length === 1) {
			const suit = args[0];
			if (suit.kind === ts.SyntaxKind.FalseKeyword) replace(node, `${textOf(callee)}()`);
			else if (!ts.isObjectLiteralExpression(suit)) replace(suit, suit.kind === ts.SyntaxKind.TrueKeyword ? '{ suit: true }' : `{ suit: ${textOf(suit)} }`);
			return;
		}

		// A test's server.vault(name)
		if (callee.name.text === 'vault' && ts.isIdentifier(callee.expression) && callee.expression.text === 'server') {
			replace(callee.name, 'storage');
			return;
		}

		// give(<ItemName>name), give(name as ItemName)
		if (callee.name.text === 'give' && args.length >= 1) {
			const item = args[0];
			const cast = ts.isTypeAssertionExpression(item) || ts.isAsExpression(item) ? item : undefined;
			if (cast && /^(?:ItemName|WeaponName)$/.test(textOf(cast.type))) {
				replace(item, textOf(cast.expression));
				went(textOf(cast.type));
			}
		}
	};
	visit(source);
	for (const [name, count] of gone) dropImport(name, count);
	return { ...applyEdits(file, text, source, edits), left };

	/** The core's import of a name the file used only where the rewrites took it out. */
	function dropImport(name: string, count: number) {
		let named = 0;
		const countNames = (node: ts.Node) => {
			if (ts.isIdentifier(node) && node.text === name && !ts.isImportSpecifier(node.parent)) named++;
			ts.forEachChild(node, countNames);
		};
		countNames(source);
		if (named > count) return;
		for (const statement of source.statements) {
			const core = ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && /^(?:@amxts\/core|~\/)/.test(statement.moduleSpecifier.text);
			const bindings = core ? statement.importClause?.namedBindings : undefined;
			if (!bindings || !ts.isNamedImports(bindings)) continue;
			const at = bindings.elements.findIndex(element => element.name.text === name);
			if (at < 0) continue;
			const { elements } = bindings;
			const alone = elements.length === 1 && !statement.importClause!.name;
			const start = alone ? statement.getStart(source) : at > 0 ? elements[at - 1].getEnd() : elements[at].getStart(source);
			const end = alone ? statement.getEnd() + (text[statement.getEnd()] === '\r' ? 2 : text[statement.getEnd()] === '\n' ? 1 : 0) : at > 0 ? elements[at].getEnd() : elements[at + 1].getStart(source);
			edits.push({ start, end, with: '', from: text.slice(start, end).trim() });
		}
	}
}
