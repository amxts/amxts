// `amxts upgrade` for menu-core's code API: every function of a menu takes one
// object, the menu's context `{ player, target, row, menu }`, and an item is
// one object with its title in it.
//
//   shop.addItem("Heal", { onSelect: heal })     shop.addItem({ title: "Heal", onSelect: ({ player }) => heal(player) })
//   (player) => player.isAlive                    ({ player }) => player.isAlive
//   (player, target) => new Player(target).name   ({ target }) => target.name
//   (player, target) => `${target}`               ({ row: target }) => `${target}`
//
// A target was a number; in the context `target` is a Player and `row` the
// number it was. A parameter read only as `new Player(target)` becomes the
// context's `target`, one read as a number its `row` - so the code means what
// it meant. A function passed by its name and declared in the file is called
// from an arrow that hands it what it took; one declared elsewhere, a target
// given as a number and `menus.runActions` are listed. Conditions and
// condition filters keep their parameters. What is rewritten takes one object,
// so a second run changes nothing.
import type { Change, Edit, Left } from './upgrade';
import ts from 'typescript';
import { applyEdits } from './upgrade';

/**
 * What each parameter of an old callback was, by its place: `number` is the
 * target as a number (the context's `row`, or `target` where it was only made
 * a Player), `menuName` the menu's name (the context's `menu.name`).
 */
type Role = 'player' | 'target' | 'number' | 'name' | 'menuName';

const ITEM: Role[] = ['player', 'number'];
const OPEN: Role[] = ['player'];
const NAMED: Role[] = ['player', 'number', 'name'];
const RESTRICTION: Role[] = ['player', 'name', 'number'];
const ACTION_CHECK: Role[] = ['player', 'menuName', 'name'];
const FILTER: Role[] = ['target', 'player'];
const SOURCE: Role[] = ['player', 'menuName'];

/** The module's functions that take a callback: where it is among the arguments, and what it took. */
const MODULE_CALLBACKS: Record<string, { at: number; roles: Role[] }> = {
	addAction: { at: 1, roles: NAMED },
	addPlaceholder: { at: 1, roles: NAMED },
	addRestriction: { at: 1, roles: RESTRICTION },
	addActionCheck: { at: 2, roles: ACTION_CHECK },
	setListSource: { at: 1, roles: SOURCE },
};
/** A menu's methods whose last argument is a callback, and what it took. */
const MENU_CALLBACKS: Record<string, Role[]> = { addFilter: FILTER, addPlaceholder: NAMED, setListSource: SOURCE };
/** An item's fields that are text or a test of the menu's context. */
const ITEM_FIELDS = new Set(['title', 'onSelect', 'visible', 'enabled', 'message']);
/** The module's functions that give a menu. */
const GIVE_MENU = new Set(['create', 'find', 'register', 'menuAt', 'activeMenu']);
const MENU_CORE = new Set(['@amxts/menu-core', '~/modules/menu-core']);

/** The context's field a role is read from, and the value it hands a function that took that role. */
const ARGUMENT: Record<Role, { key: string; value: string }> = {
	player: { key: 'player', value: 'player' },
	target: { key: 'target', value: 'target' },
	number: { key: 'row', value: 'row' },
	name: { key: 'name', value: 'name' },
	menuName: { key: 'menu', value: 'menu.name' },
};

const isFunction = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(node) || ts.isFunctionExpression(node);

/** A file's menus brought to the context: the rewritten text, each change, and what is left to do by hand. */
export function upgradeMenus(file: string, text: string): { text: string; changes: Change[]; left: Left[] } {
	if (!text.includes('menu') && !text.includes('addItem')) return { text, changes: [], left: [] };
	const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
	const edits: Edit[] = [];
	const left: Left[] = [];
	const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
	const slice = (node: ts.Node) => text.slice(node.getStart(source), node.getEnd());

	// The names the module goes by here: `menus`, a namespace import, and its functions imported by name.
	const namespaces = new Set(['menus']);
	const imported = new Map<string, string>();
	for (const statement of source.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !MENU_CORE.has(statement.moduleSpecifier.text)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const each of bindings.elements) imported.set(each.name.text, (each.propertyName ?? each.name).text);
	}

	/** The module's function a call names - `menus.create`, or `create` imported by name - or null. */
	const moduleCall = (call: ts.CallExpression): string | null => {
		const callee = call.expression;
		if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text)) return callee.name.text;
		return ts.isIdentifier(callee) ? imported.get(callee.text) ?? null : null;
	};

	// The variables, parameters and functions a name may be, by name: enough to
	// tell a menu and a function of the file's own.
	const declared = new Map<string, ts.Node>();
	const collect = (node: ts.Node) => {
		if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node) || ts.isParameter(node)) && node.name && ts.isIdentifier(node.name) && !declared.has(node.name.text)) declared.set(node.name.text, node);
		ts.forEachChild(node, collect);
	};
	collect(source);

	const unwrap = (node: ts.Expression): ts.Expression => (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ? unwrap(node.expression) : node);

	/** Whether an expression is a menu of menu-core: one the module gave, or a name of its `Menu` type. */
	const isMenu = (node: ts.Expression): boolean => {
		const bare = unwrap(node);
		if (ts.isCallExpression(bare)) return GIVE_MENU.has(moduleCall(bare) ?? '');
		if (!ts.isIdentifier(bare)) return false;
		const declaration = declared.get(bare.text);
		if (!declaration || !(ts.isVariableDeclaration(declaration) || ts.isParameter(declaration))) return false;
		const type = declaration.type?.getText(source) ?? '';
		if ([...namespaces].some(ns => type.startsWith(`${ns}.Menu`)) || imported.get(type.replace(/\s*\|.*$/, '')) === 'Menu') return true;
		return !!declaration.initializer && isMenu(declaration.initializer);
	};

	/** The function a name is in this file, with its parameters; null for one declared elsewhere, or a value. */
	const functionNamed = (name: string): ts.SignatureDeclaration | null => {
		const declaration = declared.get(name);
		if (!declaration) return null;
		if (ts.isFunctionDeclaration(declaration)) return declaration;
		if (ts.isVariableDeclaration(declaration) && declaration.initializer && isFunction(declaration.initializer)) return declaration.initializer;
		return null;
	};

	/** Whether a function already takes the context: one object, or a parameter of a context's type. */
	const takesContext = (fn: ts.SignatureDeclaration) => {
		const first = fn.parameters[0];
		return !first || !ts.isIdentifier(first.name) || /Context\b/.test(first.type?.getText(source) ?? '');
	};

	/** The reads of a parameter in a function's body, and those that only make it a Player: `new Player(target)`. */
	const readsOf = (fn: ts.ArrowFunction | ts.FunctionExpression, name: string) => {
		const reads: ts.Identifier[] = [];
		const visit = (node: ts.Node) => {
			if (ts.isIdentifier(node) && node.text === name && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && !(ts.isPropertyAssignment(node.parent) && node.parent.name === node)) reads.push(node);
			ts.forEachChild(node, visit);
		};
		visit(fn.body);
		const asPlayer = reads.map(read => read.parent).filter((parent): parent is ts.NewExpression =>
			ts.isNewExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'Player' && parent.arguments?.length === 1);
		return { reads, asPlayer };
	};

	/**
	 * The edits that bring a callback - written in place, or passed by its
	 * name - to the context. A `text` may be a string: a name the file gives
	 * a value is one, and so is one it does not declare.
	 */
	const callbackEdits = (node: ts.Expression, roles: Role[], text = false): Edit[] => {
		if (isFunction(node)) return inlineEdits(node, roles);
		if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return [];
		const name = slice(node);
		const fn = ts.isIdentifier(node) ? functionNamed(node.text) : null;
		if (!fn && (text || (ts.isIdentifier(node) && declared.has(node.text)))) return [];

		if (!fn) {
			const first = ARGUMENT[roles[0]];
			left.push({ file, line: lineOf(node), why: `${name} is declared elsewhere: a function of the menu takes one object now - if it takes (${roles.join(', ')}), pass ({ ${first.key} }) => ${name}(${first.value}) and so on` });
			return [];
		}

		if (fn.parameters.length === 0 || takesContext(fn)) return [];
		const taken = roles.slice(0, fn.parameters.length).map(role => ARGUMENT[role]);
		const keys = [...new Set(taken.map(each => each.key))];
		const wrapper = `({ ${keys.join(', ')} }) => ${name}(${taken.map(each => each.value).join(', ')})`;
		return [{ start: node.getStart(source), end: node.getEnd(), with: wrapper, from: name }];
	};

	/** A function written in place: its parameters become one object, the context's fields by the names it read them by. */
	const inlineEdits = (fn: ts.ArrowFunction | ts.FunctionExpression, roles: Role[]): Edit[] => {
		const params = fn.parameters;
		if (params.length === 0 || !params.every(param => ts.isIdentifier(param.name))) return [];
		const edits: Edit[] = [];
		const fields: string[] = [];

		params.slice(0, roles.length).forEach((param, at) => {
			const name = (param.name as ts.Identifier).text;
			const { reads, asPlayer } = readsOf(fn, name);
			if (reads.length === 0) return;
			let key = ARGUMENT[roles[at]].key;

			// A target read only as `new Player(target)` is the context's Player.
			if (roles[at] === 'number' && asPlayer.length === reads.length) {
				key = 'target';
				for (const made of asPlayer) edits.push({ start: made.getStart(source), end: made.getEnd(), with: name, from: slice(made) });
			}

			if (roles[at] === 'menuName') left.push({ file, line: lineOf(param), why: `${name} was the menu's name: the context's menu is the menu itself - read menu.name` });
			fields.push(key === name ? key : `${key}: ${name}`);
		});

		const first = params[0];
		const end = params[params.length - 1].getEnd();
		const parenthesized = text.slice(fn.getStart(source), first.getStart(source)).includes('(');
		const binding = fields.length ? `{ ${fields.join(', ')} }` : '';
		const replaced = parenthesized ? binding : `(${binding})`;
		edits.push({ start: first.getStart(source), end, with: replaced, from: text.slice(first.getStart(source), end) });
		return edits;
	};

	/** The text a node becomes with edits inside it made. */
	const rewritten = (node: ts.Node, inside: Edit[]) => {
		const start = node.getStart(source);
		let out = slice(node);
		for (const edit of [...inside].sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start - start) + edit.with + out.slice(edit.end - start);
		return out;
	};

	/** The fields of an item's object literal - text and tests of the context - brought to it. */
	const itemEdits = (item: ts.ObjectLiteralExpression, fields: Set<string>, roles: (field: string) => Role[]): Edit[] => item.properties.flatMap((property) => {
		if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || !fields.has(property.name.text)) return [];
		const value = property.initializer;
		const field = property.name.text;
		if (field !== 'enabled' || !ts.isArrayLiteralExpression(value)) return callbackEdits(value, roles(field), field === 'title' || field === 'message');
		// A list of requirements: each `{ when, message }` is an item's test and text.
		return value.elements.filter(ts.isObjectLiteralExpression).flatMap(requirement => itemEdits(requirement, new Set(['when', 'message']), () => ITEM));
	});

	/** `addItem(text, options)` - or `addFixedItem(slot, text, options)` - as one object with the title in it. */
	const addItemEdits = (call: ts.CallExpression, at: number): Edit[] => {
		const [label, options] = [call.arguments[at], call.arguments[at + 1]];
		if (!label) return [];
		if (ts.isObjectLiteralExpression(label) && !options) return itemEdits(label, ITEM_FIELDS, () => ITEM);

		const title = rewritten(label, callbackEdits(label, ITEM, true));
		if (!options) return [{ start: label.getStart(source), end: label.getEnd(), with: `{ title: ${title} }`, from: slice(label) }];
		if (!ts.isObjectLiteralExpression(options)) return [{ start: label.getStart(source), end: options.getEnd(), with: `{ title: ${title}, ...${slice(options)} }`, from: `${slice(label)}, ${slice(options)}` }];

		const brace = options.getStart(source) + 1;
		const first = options.properties[0];
		const multiline = first && text.slice(brace, first.getStart(source)).includes('\n');
		const indent = multiline ? text.slice(brace, first.getStart(source)).replace(/^[^\n]*\n/, '') : '';
		const opening = !first ? `{ title: ${title} ` : multiline ? `{\n${indent}title: ${title},` : `{ title: ${title},`;
		return [
			{ start: label.getStart(source), end: brace, with: opening, from: `${slice(label)}, {` },
			...itemEdits(options, ITEM_FIELDS, () => ITEM),
		];
	};

	/** `show(player, { target: player.id })`: the target is the player himself. */
	const showEdits = (options: ts.Expression | undefined): Edit[] => {
		if (!options || !ts.isObjectLiteralExpression(options)) return [];
		return options.properties.flatMap((property) => {
			if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name) || property.name.text !== 'target') return [];
			const value = property.initializer;
			if (ts.isPropertyAccessExpression(value) && value.name.text === 'id') return [{ start: value.getStart(source), end: value.getEnd(), with: slice(value.expression), from: slice(value) }];
			if (ts.isNumericLiteral(value)) left.push({ file, line: lineOf(value), why: 'show\'s target is a player now: pass the Player, not its number' });
			return [];
		});
	};

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		if (!ts.isCallExpression(node)) return;
		const callee = node.expression;
		const args = node.arguments;
		const fn = moduleCall(node);

		if (fn === 'create' && args[1] && ts.isObjectLiteralExpression(args[1])) edits.push(...itemEdits(args[1], new Set(['title', 'activeWhen']), field => (field === 'activeWhen' ? OPEN : ITEM)));
		else if (fn === 'show') edits.push(...showEdits(args[2]));
		else if (fn === 'runActions') left.push({ file, line: lineOf(node), why: 'runActions is a method of the menu now: menu.runActions(player, line, target), the target a Player' });
		else if (fn && MODULE_CALLBACKS[fn] && args[MODULE_CALLBACKS[fn].at]) edits.push(...callbackEdits(args[MODULE_CALLBACKS[fn].at], MODULE_CALLBACKS[fn].roles));
		if (fn || !ts.isPropertyAccessExpression(callee)) return;

		const method = callee.name.text;
		const menu = isMenu(callee.expression);
		const oldItem = (at: number) => args[at] && (ts.isStringLiteralLike(args[at]) || ts.isTemplateExpression(args[at]) || isFunction(args[at]));

		if (method === 'addItem' && (menu || oldItem(0))) edits.push(...addItemEdits(node, 0));
		else if (method === 'addFixedItem' && (menu || oldItem(1))) edits.push(...addItemEdits(node, 1));
		else if (menu && method === 'show') edits.push(...showEdits(args[1]));
		else if (menu && MENU_CALLBACKS[method] && args.length >= 1) edits.push(...callbackEdits(args[method === 'addPlaceholder' ? 1 : 0], MENU_CALLBACKS[method]));
	};
	visit(source);
	return { ...applyEdits(file, text, source, edits), left };
}
