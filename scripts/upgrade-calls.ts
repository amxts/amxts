import type { Change, Edit, Left } from './upgrade';
// The calls `amxts upgrade` brings up to date (scripts/upgrade.ts): the ones
// whose shape changed, not their name.
//
// - `print(0, text)` is `server.print(text)`, and `print({ id, variant },
//   text)` is `print(id, text, variant)` - `0` for everyone was Pawn's, and
//   the object said what the third argument says.
// - `removeAllItems(true)` is `removeAllItems({ suit: true })`: a bare
//   boolean nobody reads.
// - `Storage.get` gives `undefined` for a key that is not there, as `Map.get`
//   does: a comparison of its value with `null` compares with `undefined`,
//   and a `| null` it was annotated with is `| undefined`.
// - `give` takes any text: the cast to `ItemName` goes.
// - A test's `server.vault(name)` is `server.storage(name)`: a Storage is not nVault.
import ts from 'typescript';
import { applyEdits } from './upgrade';

/** The words a file must have for a pass to look at it. */
const CALL_WORDS = /\bprint\s*\(|\bremoveAllItems\s*\(|\bStorage\b|\bgive\s*\(|\.vault\s*\(/;

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

		// print(0, ...) and print({ id, variant }, text)
		// Only the callee and the first argument are rewritten, so a change
		// inside the text (a Storage's get) is kept.
		if (ts.isIdentifier(callee) && callee.text === 'print' && args.length >= 2) {
			const to = args[0];
			const everyone = (node: ts.Expression) => ts.isNumericLiteral(node) && node.text === '0';
			const head = (to: string) => edits.push({ start: callee.getStart(source), end: args[1].getStart(source), with: to, from: text.slice(callee.getStart(source), args[1].getStart(source)) });
			if (everyone(to)) {
				head('server.print(');
				return;
			}
			if (!ts.isObjectLiteralExpression(to)) return;
			const field = (name: string) => to.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name);
			const id = field('id');
			const variant = field('variant');
			if (!id || args.length > 2 || to.properties.some(p => p !== id && p !== variant)) {
				left.push({ file, line: lineOf(node), why: 'print takes a player and the place as its third argument: print(player, text, "center"); everyone is server.print(text, "center")' });
				return;
			}
			head(everyone(id.initializer) ? 'server.print(' : `print(${textOf(id.initializer)}, `);
			if (variant) edits.push({ start: args[1].getEnd(), end: args[1].getEnd(), with: `, ${textOf(variant.initializer)}`, from: '' });
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
			if (cast && /^(?:ItemName|WeaponName)$/.test(textOf(cast.type))) replace(item, textOf(cast.expression));
		}
	};
	visit(source);
	return { ...applyEdits(file, text, source, edits), left };
}
