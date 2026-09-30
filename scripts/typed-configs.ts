// Typed configs: `configs.load(name, defaults)` of @amxts/config-core.
//
//   import * as configs from "@amxts/config-core";
//
//   const settings = configs.load("settings", { chat: { prefix: "[HNS]" }, round: { time: 2.5 } });
//   const other = configs.load<Settings>("other", { ... });
//   settings.round.time = 3;
//   configs.save(settings);
//
// The editor types this with a plain generic signature,
// `load<T>(name: string, defaults: T): T`. AssemblyScript has no reflection:
// a generic function cannot walk the fields of the object it is given. So the
// build does it, reading each file on its way to the compiler (Sources.read):
//
// - it finds the calls of `load` with defaults and of `save` with one
//   argument, through the file's imports of the module;
// - it works out the object's shape - from the type argument, the interface
//   or type alias it names (in this file, or imported), or from the defaults'
//   object literal when there is no type - and writes, at the end of the file,
//   a function for that call: it copies the defaults, reads the file into the
//   copy through the module's tree (ConfigNode), with the checks, and
//   remembers how to write the object back (config-core's src/typed.ts);
// - it puts that function's name in place of `configs.load<...>` - padded, so
//   the rest of the line keeps its columns - and `save` becomes the typed
//   one, which finds the file by the object.
//
// The generated code only calls the public ConfigNode, so it is the same in
// the plugin that owns the module and in any other, where the module is a
// proxy. The shapes are read from the source text - a syntax tree, no type
// checker - so a shape is what is written: a literal's values, or types
// spelled out. What cannot be read that way stops the build with the place
// and the fix.
import ts from 'typescript';

/** The module, by its place in the tree, as the files' imports have it once rewritten (scripts/project.ts). */
export const CONFIG_MODULE = '~/modules/config-core';

/** What the generated code calls: config-core's src/typed.ts. */
const HELPERS = `${CONFIG_MODULE}/src/typed`;
const NS = '__amxtsConfigs';

type Scalar = 'text' | 'number' | 'boolean';

/**
 * What a config value is. `written` is its type as the file writes it, where
 * the file names one (`value as Limits`): the generated interface says the
 * same, so the value is of that type there too.
 */
export type Shape = Kinds & { written?: string };

type Kinds
	= | { kind: Scalar }
		| { kind: 'name'; names: string[] }
		| { kind: 'list'; of: Shape }
		| { kind: 'object'; fields: Field[] }
		| { kind: 'map'; of: Shape };

export interface Field {
	name: string;
	shape: Shape;
	optional: boolean;
}

type ObjectShape = Extract<Shape, { kind: 'object' }>;

/** How the transform reaches other files: an import in `from` resolved, with the text the build reads there. */
export type ImportReader = (from: string, spec: string) => { path: string; text: string } | null;

/** A shape that cannot be read, at a node of the file it is in. */
class ShapeError extends Error {
	constructor(readonly node: ts.Node, readonly file: ts.SourceFile, message: string) {
		super(message);
	}
}

const WHAT = 'a config value is text, a number, true or false, a union of string literals, a list of them, of lists of them or of objects, an object of them, or a Map<string, ...> of text, numbers or booleans';

/** A list's items may be lists of these: rows of values. */
const ROW_KINDS = ['text', 'number', 'boolean', 'name'];

/** Whether a list may hold items of this shape: anything but a Map, and a list only of values. */
function listable(of: Shape): boolean {
	if (of.kind === 'map') return false;
	return of.kind !== 'list' || ROW_KINDS.includes(of.of.kind);
}

const NOT_LISTABLE = 'a list holds text, numbers, booleans, names, objects or lists of values - not Maps, or lists of lists or of objects';

// ---------------------------------------------------------------- reading shapes

interface Context {
	path: string;
	file: ts.SourceFile;
}

class Shapes {
	private files = new Map<string, ts.SourceFile>();

	constructor(private imports: ImportReader) {}

	parsed(path: string, text: string): ts.SourceFile {
		const key = `${path}\0${text}`;
		let file = this.files.get(key);
		if (!file) {
			file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
			this.files.set(key, file);
		}
		return file;
	}

	/** A type as written in a file. */
	ofType(node: ts.TypeNode, at: Context, seen: string[] = []): Shape {
		const fail = (message: string) => new ShapeError(node, at.file, message);

		if (node.kind === ts.SyntaxKind.StringKeyword) return { kind: 'text' };
		if (node.kind === ts.SyntaxKind.NumberKeyword) return { kind: 'number' };
		if (node.kind === ts.SyntaxKind.BooleanKeyword) return { kind: 'boolean' };
		if (ts.isParenthesizedTypeNode(node)) return this.ofType(node.type, at, seen);
		if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) return this.ofType(node.type, at, seen);
		if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) return { kind: 'name', names: [node.literal.text] };

		if (ts.isUnionTypeNode(node)) {
			const names = node.types.map((each) => {
				const shape = this.ofType(each, at, seen);
				if (shape.kind !== 'name') throw fail(`${node.getText(at.file)} - a union is of string literals only, "a" | "b"; for "not set" write the field with ?`);
				return shape.names;
			});
			return { kind: 'name', names: names.flat() };
		}

		if (ts.isArrayTypeNode(node)) return this.list(node.elementType, at, seen, fail);
		if (ts.isTypeLiteralNode(node)) return this.members(node.members, at, seen);

		if (ts.isTypeReferenceNode(node)) {
			const name = node.typeName.getText(at.file);
			const args = node.typeArguments ?? [];
			if ((name === 'Array' || name === 'ReadonlyArray') && args.length === 1) return this.list(args[0], at, seen, fail);

			if (name === 'Map' && args.length === 2) {
				if (args[0].kind !== ts.SyntaxKind.StringKeyword) throw fail(`${node.getText(at.file)} - a Map's keys are string`);
				const of = this.ofType(args[1], at, seen);
				if (of.kind === 'list' || of.kind === 'object' || of.kind === 'map') throw fail(`${node.getText(at.file)} - a Map holds text, numbers, booleans or names; for objects write a list of them`);
				return { kind: 'map', of };
			}

			if (args.length) throw fail(`${node.getText(at.file)} - a generic type cannot be a config's; write the type out`);
			return this.named(node.typeName, at, seen);
		}

		throw fail(`${node.getText(at.file)} - ${WHAT}`);
	}

	private list(element: ts.TypeNode, at: Context, seen: string[], fail: (message: string) => Error): Shape {
		const of = this.ofType(element, at, seen);
		if (!listable(of)) throw fail(`${element.getText(at.file)}[] - ${NOT_LISTABLE}`);
		return { kind: 'list', of };
	}

	private members(members: ts.NodeArray<ts.TypeElement>, at: Context, seen: string[]): ObjectShape {
		const fields: Field[] = [];
		for (const member of members) {
			if (!ts.isPropertySignature(member) || !member.type) {
				throw new ShapeError(member, at.file, `${member.getText(at.file).trim()} - an object of a config has fields only, each with its type`);
			}
			if (!ts.isIdentifier(member.name)) {
				throw new ShapeError(member, at.file, `${member.name.getText(at.file)} - a field of a config is named with a word, not a string`);
			}
			fields.push({ name: member.name.text, shape: this.ofType(member.type, at, seen), optional: !!member.questionToken });
		}
		return { kind: 'object', fields };
	}

	/** A type by its name: declared in the file, imported by name, or reached through a namespace import. */
	private named(name: ts.EntityName, at: Context, seen: string[]): Shape {
		const found = this.declaration(name, at);
		if (!found) throw new ShapeError(name, at.file, `${name.getText(at.file)} - not declared in this file or imported into it; a config's type is an interface or a type alias`);
		const key = `${found.at.path}#${found.node.name.text}`;
		if (seen.includes(key)) throw new ShapeError(name, at.file, `${name.getText(at.file)} - a config's type cannot contain itself`);
		const inside = [...seen, key];

		if (ts.isTypeAliasDeclaration(found.node)) {
			if (found.node.typeParameters?.length) throw new ShapeError(name, at.file, `${name.getText(at.file)} - a generic type cannot be a config's; write the type out`);
			return this.ofType(found.node.type, found.at, inside);
		}

		const declaration = found.node;
		if (declaration.typeParameters?.length || declaration.heritageClauses?.length) {
			throw new ShapeError(name, at.file, `${name.getText(at.file)} - an interface that is generic or extends another cannot be a config's; write its fields out`);
		}
		return this.members(declaration.members, found.at, inside);
	}

	private declaration(name: ts.EntityName, at: Context): { node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration; at: Context } | null {
		if (ts.isQualifiedName(name)) {
			if (!ts.isIdentifier(name.left)) return null;
			const namespace = this.importOf(name.left.text, at);
			if (!namespace || namespace.kind !== 'namespace') return null;
			return this.exported(name.right.text, namespace.at, []);
		}

		const local = this.local(name.text, at);
		if (local) return local;
		const imported = this.importOf(name.text, at);
		if (!imported || imported.kind !== 'named') return null;
		return this.exported(imported.name, imported.at, []);
	}

	private local(name: string, at: Context) {
		for (const statement of at.file.statements) {
			if ((ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name.text === name) return { node: statement, at };
		}
		return null;
	}

	/** What a local name is imported as: a name of another file, or that whole file. */
	private importOf(local: string, at: Context): { kind: 'named'; name: string; at: Context } | { kind: 'namespace'; at: Context } | null {
		for (const statement of at.file.statements) {
			if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
			const bindings = statement.importClause?.namedBindings;
			if (!bindings) continue;
			const spec = statement.moduleSpecifier.text;

			if (ts.isNamespaceImport(bindings) && bindings.name.text === local) {
				const file = this.open(at, spec);
				return file ? { kind: 'namespace', at: file } : null;
			}

			if (!ts.isNamedImports(bindings)) continue;
			const element = bindings.elements.find(each => each.name.text === local);
			if (!element) continue;
			const file = this.open(at, spec);
			return file ? { kind: 'named', name: (element.propertyName ?? element.name).text, at: file } : null;
		}
		return null;
	}

	/** A name a file exports: declared there, or passed on from another file. */
	private exported(name: string, at: Context, visited: string[]): { node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration; at: Context } | null {
		if (visited.includes(at.path)) return null;
		const local = this.local(name, at);
		if (local) return local;

		for (const statement of at.file.statements) {
			if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
			const clause = statement.exportClause;
			let wanted = name;

			if (clause && ts.isNamedExports(clause)) {
				const element = clause.elements.find(each => each.name.text === name);
				if (!element) continue;
				wanted = (element.propertyName ?? element.name).text;
			} else if (clause) {
				continue;
			}

			const file = this.open(at, statement.moduleSpecifier.text);
			const found = file ? this.exported(wanted, file, [...visited, at.path]) : null;
			if (found) return found;
		}

		const alias = this.importOf(name, at);
		return alias && alias.kind === 'named' ? this.exported(alias.name, alias.at, [...visited, at.path]) : null;
	}

	private open(at: Context, spec: string): Context | null {
		const found = this.imports(at.path, spec);
		return found ? { path: found.path, file: this.parsed(found.path, found.text) } : null;
	}

	/** The defaults' value, when no type is given: what it visibly is. */
	ofValue(node: ts.Expression, at: Context): Shape {
		const fail = (message: string) => new ShapeError(node, at.file, message);

		if (ts.isParenthesizedExpression(node)) return this.ofValue(node.expression, at);
		if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return { ...this.ofType(node.type, at), written: node.type.getText(at.file) };
		if (ts.isSatisfiesExpression(node)) return this.ofValue(node.expression, at);
		if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return { kind: 'text' };
		if (ts.isNumericLiteral(node)) return { kind: 'number' };
		if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return { kind: 'number' };
		if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { kind: 'boolean' };

		if (ts.isObjectLiteralExpression(node)) {
			const fields: Field[] = [];
			for (const property of node.properties) {
				if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) {
					throw new ShapeError(property, at.file, `${property.getText(at.file)} - a field of the defaults is \`name: value\`; for anything else give the type: configs.load<Settings>(...)`);
				}
				fields.push({ name: property.name.text, shape: this.ofValue(property.initializer, at), optional: false });
			}
			return { kind: 'object', fields };
		}

		if (ts.isArrayLiteralExpression(node)) {
			if (node.elements.length === 0) throw fail(`[] - an empty list says nothing of its items; give the type: configs.load<Settings>(...), or write the list with an item`);
			const items = node.elements.map(each => this.ofValue(each, at));
			const first = items[0];
			if (!listable(first)) throw fail(`${node.getText(at.file)} - ${NOT_LISTABLE}`);
			if (items.some(each => describe(each) !== describe(first))) throw fail(`${node.getText(at.file)} - the items are not of one kind; give the type: configs.load<Settings>(...)`);
			return { kind: 'list', of: first };
		}

		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'Map' && node.typeArguments?.length === 2) {
			if (node.typeArguments[0].kind !== ts.SyntaxKind.StringKeyword) throw fail(`${node.getText(at.file)} - a Map's keys are string`);
			const of = this.ofType(node.typeArguments[1], at);
			if (of.kind === 'list' || of.kind === 'object' || of.kind === 'map') throw fail(`${node.getText(at.file)} - a Map holds text, numbers, booleans or names; for objects write a list of them`);
			return { kind: 'map', of };
		}

		throw fail(`${node.getText(at.file)} - its type is not seen from the value; give the type: configs.load<Settings>(...)`);
	}
}

/** A shape as one line: equal shapes, equal lines. */
export function describe(shape: Shape): string {
	if (shape.written) return shape.written;
	switch (shape.kind) {
		case 'name': return shape.names.map(each => JSON.stringify(each)).join(' | ');
		case 'list': return shape.of.kind === 'name' ? `(${describe(shape.of)})[]` : `${describe(shape.of)}[]`;
		case 'map': return `Map<string, ${describe(shape.of)}>`;
		case 'object': return `{ ${shape.fields.map(f => `${f.name}${f.optional ? '?' : ''}: ${describe(f.shape)}`).join('; ')} }`;
		case 'text': return 'string';
		default: return shape.kind;
	}
}

// ---------------------------------------------------------------- the code

/** One load's function: copies the defaults, reads the file into the copy, remembers how to write it back. */
class LoadWriter {
	private lines: string[] = [];
	private count = 0;

	constructor(private readonly shape: ObjectShape) {}

	private temp(prefix: string) {
		return `${prefix}${this.count++}`;
	}

	private emit(depth: number, line: string) {
		this.lines.push(`${'\t'.repeat(depth)}${line}`);
	}

	function(name: string, type: string): string {
		const shape = this.shape;
		const ini = iniMisfits(shape);
		this.emit(1, `const root = ${NS}.open(name, ${JSON.stringify(ini.outside)}, ${JSON.stringify(ini.objectLists)});`);
		this.emit(1, `const value: ${type} = ${literalOf(shape, 'defaults')};`);
		this.copyRest(shape, 'defaults', 'value', 1);
		this.emit(1, `const top = ${NS}.objectOf(root, ${JSON.stringify(shape.fields.map(f => f.name))});`);
		this.emit(1, 'if (top != null) {');
		this.read(shape, 'top', 'value', 2);
		this.emit(1, '}');
		this.emit(1, `${NS}.track(value, root, () => {`);
		this.write(shape, 'value', '', 2);
		this.emit(1, '});');
		this.emit(1, 'return value;');
		return [`function ${name}(name: string, defaults: ${type}) {`, ...this.lines, '}'].join('\n');
	}

	/** What a copy's literal leaves out: optional fields, lists of objects, Maps. */
	private copyRest(shape: ObjectShape, source: string, target: string, depth: number) {
		for (const field of shape.fields) {
			const from = `${source}.${field.name}`;
			const to = `${target}.${field.name}`;

			if (field.optional) {
				this.emit(depth, `if (${from} !== undefined) {`);
				this.copyValue(field.shape, present(field.shape, from), to, depth + 1, true);
				this.emit(depth, '}');
				continue;
			}

			this.copyValue(field.shape, from, to, depth, false);
		}
	}

	/** Copies what the literal did not: all of it, for an optional field. */
	private copyValue(shape: Shape, from: string, to: string, depth: number, whole: boolean) {
		const target = whole ? present(shape, to) : to;
		if (whole && (shape.kind !== 'list' || shape.of.kind !== 'object') && shape.kind !== 'map') this.emit(depth, `${to} = ${copyOf(shape, from)};`);
		if (shape.kind === 'object') this.copyRest(shape, from, target, depth);

		if (shape.kind === 'list' && shape.of.kind === 'object') {
			const item = this.temp('item');
			const made = this.temp('made');
			if (whole) this.emit(depth, `${to} = [];`);
			this.emit(depth, `for (const ${item} of ${from}) {`);
			this.emit(depth + 1, `${target}.push(${literalOf(shape.of, item)});`);
			this.emit(depth + 1, `const ${made} = ${target}[${target}.length - 1];`);
			this.copyRest(shape.of, item, made, depth + 1);
			this.emit(depth, '}');
		}

		if (shape.kind === 'map') {
			const key = this.temp('key');
			if (whole) this.emit(depth, `${to} = new Map<string, ${typeOf(shape.of)}>();`);
			this.emit(depth, `for (const ${key} of ${from}.keys()) ${target}.set(${key}, ${from}.get(${key}));`);
		}
	}

	/** Reads an object's fields from `node` - an object, checked - into `target`. */
	private read(shape: ObjectShape, node: string, target: string, depth: number) {
		for (const field of shape.fields) {
			const value = this.temp('node');
			const to = `${target}.${field.name}`;
			this.emit(depth, `const ${value} = ${NS}.member(${node}, ${JSON.stringify(field.name)});`);
			this.readValue(field.shape, value, to, field.optional, depth);
		}
	}

	private readValue(shape: Shape, value: string, to: string, optional: boolean, depth: number) {
		switch (shape.kind) {
			case 'text':
			case 'number':
			case 'boolean':
				this.emit(depth, `if (${NS}.is(${value}, "${shape.kind}")) ${to} = ${NS}.${converter(shape.kind)}(${value});`);
				return;
			case 'name':
				this.emit(depth, `if (${NS}.is(${value}, "name", ${JSON.stringify(shape.names)})) ${to} = ${NS}.asText(${value});`);
				return;
			case 'list':
				this.readList(shape.of, value, to, optional, depth);
				return;
			case 'map':
				this.readMap(shape, value, to, optional, depth);
				return;
			case 'object': {
				const node = this.temp('object');
				this.emit(depth, `const ${node} = ${NS}.objectOf(${value}, ${JSON.stringify(shape.fields.map(f => f.name))});`);
				this.emit(depth, `if (${node} != null) {`);

				if (optional) {
					this.emit(depth + 1, `if (${to} === undefined) {`);
					this.emit(depth + 2, `${to} = ${zeroOf(shape)};`);
					this.emit(depth + 2, `${NS}.need(${node}, ${JSON.stringify(required(shape))});`);
					this.emit(depth + 1, '}');
				}

				this.read(shape, node, optional ? present(shape, to) : to, depth + 1);
				this.emit(depth, '}');
			}
		}
	}

	private readList(of: Shape, value: string, to: string, optional: boolean, depth: number) {
		if (of.kind === 'list') {
			const rows = this.temp('rows');
			this.emit(depth, `const ${rows} = ${NS}.lists(${value});`);
			this.emit(depth, `if (${rows} != null) ${to} = ${rows}.map<${typeOf(of)}>(row => ${rowReader(of.of)});`);
			return;
		}

		if (of.kind === 'name') {
			this.emit(depth, `if (${NS}.is(${value}, "names")) ${to} = ${NS}.asNames(${value}, ${JSON.stringify(of.names)});`);
			return;
		}

		if (of.kind !== 'object') {
			this.emit(depth, `if (${NS}.is(${value}, "${of.kind}s")) ${to} = ${NS}.${converter(of.kind)}s(${value});`);
			return;
		}

		const items = this.temp('items');
		const item = this.temp('item');
		const made = this.temp('made');
		const list = optional ? `${to}!` : to;
		this.emit(depth, `const ${items} = ${NS}.items(${value});`);
		this.emit(depth, `if (${items} != null) {`);
		this.emit(depth + 1, `${to} = [];`);
		this.emit(depth + 1, `for (const ${item} of ${items}) {`);
		this.emit(depth + 2, `${NS}.objectOf(${item}, ${JSON.stringify(of.fields.map(f => f.name))});`);
		this.emit(depth + 2, `${NS}.need(${item}, ${JSON.stringify(required(of))});`);
		this.emit(depth + 2, `${list}.push(${zeroOf(of)});`);
		this.emit(depth + 2, `const ${made} = ${list}[${list}.length - 1];`);
		this.read(of, item, made, depth + 2);
		this.emit(depth + 1, '}');
		this.emit(depth, '}');
	}

	private readMap(shape: Extract<Shape, { kind: 'map' }>, value: string, to: string, optional: boolean, depth: number) {
		const entries = this.temp('entries');
		const entry = this.temp('entry');
		const map = optional ? `${to}!` : to;
		const kind = shape.of.kind === 'name' ? 'name' : shape.of.kind;
		const read = converter(shape.of.kind === 'name' ? 'text' : shape.of.kind);
		const names = shape.of.kind === 'name' ? `, ${JSON.stringify(shape.of.names)}` : '';
		this.emit(depth, `const ${entries} = ${NS}.entries(${value});`);
		this.emit(depth, `if (${entries} != null) {`);
		this.emit(depth + 1, `${to} = new Map<string, ${typeOf(shape.of)}>();`);
		this.emit(depth + 1, `for (const ${entry} of ${entries}) {`);
		this.emit(depth + 2, `if (${NS}.is(${entry}, "${kind}"${names})) ${map}.set(${entry}.key, ${NS}.${read}(${entry}));`);
		this.emit(depth + 1, '}');
		this.emit(depth, '}');
	}

	/** Writes an object's fields into the file's tree, at `path` - a template literal's text. */
	private write(shape: ObjectShape, source: string, path: string, depth: number) {
		for (const field of shape.fields) {
			const from = `${source}.${field.name}`;
			const at = path ? `${path}.${field.name}` : field.name;

			if (field.optional) {
				this.emit(depth, `if (${from} !== undefined) {`);
				this.writeValue(field.shape, present(field.shape, from), at, depth + 1);
				this.emit(depth, '} else {');
				this.emit(depth + 1, `root.remove(\`${at}\`);`);
				this.emit(depth, '}');
				continue;
			}

			this.writeValue(field.shape, from, at, depth);
		}
	}

	private writeValue(shape: Shape, from: string, at: string, depth: number) {
		const path = `\`${at}\``;
		switch (shape.kind) {
			case 'text':
			case 'name':
				this.emit(depth, `${NS}.putText(root, ${path}, ${from});`);
				return;
			case 'number':
			case 'boolean':
				this.emit(depth, `${NS}.${writer(shape.kind)}(root, ${path}, ${from});`);
				return;
			case 'object':
				this.write(shape, from, at, depth);
				return;
			case 'map': {
				const key = this.temp('key');
				this.emit(depth, `${NS}.keep(root, ${path}, ${from}.keys());`);
				this.emit(depth, `for (const ${key} of ${from}.keys()) ${NS}.${writer(shape.of.kind)}(root, \`${at}.\${${key}}\`, ${from}.get(${key}));`);
				return;
			}
			case 'list':
				this.writeList(shape.of, from, at, depth);
		}
	}

	private writeList(of: Shape, from: string, at: string, depth: number) {
		const path = `\`${at}\``;
		if (of.kind === 'text' || of.kind === 'name' || of.kind === 'number' || of.kind === 'boolean') {
			this.emit(depth, `${NS}.${writer(of.kind)}s(root, ${path}, ${from});`);
			return;
		}
		if (of.kind === 'list') {
			const index = this.temp('index');
			const row = this.temp('row');
			this.emit(depth, `${NS}.resizeLists(root, ${path}, ${from}.length);`);
			this.emit(depth, `let ${index} = 0;`);
			this.emit(depth, `for (const ${row} of ${from}) {`);
			this.emit(depth + 1, `${NS}.${writer(of.of.kind)}s(root, \`${at}[\${${index}}]\`, ${row});`);
			this.emit(depth + 1, `${index}++;`);
			this.emit(depth, '}');
			return;
		}

		if (of.kind !== 'object') return;

		// An INI file has no list of objects: it keeps what it has.
		const index = this.temp('index');
		const item = this.temp('item');
		this.emit(depth, 'if (root.format != "ini") {');
		this.emit(depth + 1, `${NS}.resize(root, ${path}, ${from}.length);`);
		this.emit(depth + 1, `let ${index} = 0;`);
		this.emit(depth + 1, `for (const ${item} of ${from}) {`);
		this.write(of, item, `${at}[\${${index}}]`, depth + 2);
		this.emit(depth + 2, `${index}++;`);
		this.emit(depth + 1, '}');
		this.emit(depth, '}');
	}
}

/** The type as AssemblyScript reads it; an object type in place is a class of its own there (Parser.parseTypeLiteral). */
export function typeOf(shape: Shape): string {
	return describe(shape);
}

/** The helper that reads a value as this kind: asText, asNumber, asBoolean. */
function converter(kind: string): string {
	return `as${kind[0].toUpperCase()}${kind.slice(1)}`;
}

/** A row of a list of lists read as its values: asTexts(row), asNames(row, [...]). */
function rowReader(of: Shape): string {
	if (of.kind === 'name') return `${NS}.asNames(row, ${JSON.stringify(of.names)})`;
	return `${NS}.${converter(of.kind)}s(row)`;
}

/** The helper that writes a value of this kind where it changed: putText, putNumber, putBoolean. */
function writer(kind: string): string {
	return kind === 'name' ? 'putText' : `put${kind[0].toUpperCase()}${kind.slice(1)}`;
}

/** An optional field known to be there: an object's, a string's or a list's `!`; a number and a boolean are values. */
function present(shape: Shape, from: string): string {
	return shape.kind === 'number' || shape.kind === 'boolean' ? from : `${from}!`;
}

function required(shape: ObjectShape): string[] {
	return shape.fields.filter(f => !f.optional).map(f => f.name);
}

/** A copy of a value, as an expression: a list of objects and a Map are filled after it. */
function copyOf(shape: Shape, from: string): string {
	switch (shape.kind) {
		case 'object': return literalOf(shape, from);
		case 'list':
			if (shape.of.kind === 'object') return '[]';
			return shape.of.kind === 'list' ? `${from}.map<${typeOf(shape.of)}>(row => row.slice(0))` : `${from}.slice(0)`;
		case 'map': return `new Map<string, ${typeOf(shape.of)}>()`;
		default: return from;
	}
}

/** An object literal copying the required fields of `from`. */
function literalOf(shape: ObjectShape, from: string): string {
	const fields = shape.fields.filter(f => !f.optional).map(f => `${f.name}: ${copyOf(f.shape, `${from}.${f.name}`)}`);
	return fields.length ? `{ ${fields.join(', ')} }` : '{}';
}

/** An object made from the file: each required field empty, the optional ones left out. */
function zeroOf(shape: Shape): string {
	switch (shape.kind) {
		case 'text': return '""';
		case 'number': return '0';
		case 'boolean': return 'false';
		case 'name': return JSON.stringify(shape.names[0]);
		case 'list': return '[]';
		case 'map': return `new Map<string, ${typeOf(shape.of)}>()`;
		case 'object': {
			const fields = shape.fields.filter(f => !f.optional).map(f => `${f.name}: ${zeroOf(f.shape)}`);
			return fields.length ? `{ ${fields.join(', ')} }` : '{}';
		}
	}
}

/**
 * What an INI file has no place for: the values at the top that are not
 * objects - an INI file holds [sections] of values - and lists of objects.
 */
export function iniMisfits(shape: ObjectShape): { outside: string[]; objectLists: string[] } {
	const outside: string[] = [];
	const objectLists: string[] = [];
	const walk = (object: ObjectShape, path: string) => {
		for (const field of object.fields) {
			const at = path ? `${path}.${field.name}` : field.name;
			if (field.shape.kind === 'list' && field.shape.of.kind === 'object') objectLists.push(at);
			else if (!path && field.shape.kind !== 'object' && field.shape.kind !== 'map') outside.push(at);
			else if (field.shape.kind === 'object') walk(field.shape, at);
		}
	};
	walk(shape, '');
	return { outside, objectLists };
}

// ---------------------------------------------------------------- one file

export interface TypedConfigs {
	/** The file as the compiler reads it: the calls replaced, the functions after its last line. */
	text: string;
	/** What stopped a call: `file:line:column: ...`. */
	problems: string[];
}

/**
 * The typed calls of one file made into generated code. `path` is the file's
 * place in the tree, `display` how a message names it, `imports` how a type
 * imported from another file is found.
 */
export function typedConfigs(path: string, display: string, text: string, imports: ImportReader): TypedConfigs {
	if (!text.includes(CONFIG_MODULE)) return { text, problems: [] };

	const shapes = new Shapes(imports);
	const file = shapes.parsed(path, text);
	const namespaces = new Set<string>();
	const loads = new Set<string>();
	const saves = new Set<string>();

	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== CONFIG_MODULE) continue;
		const bindings = statement.importClause?.namedBindings;
		if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			const imported = (element.propertyName ?? element.name).text;
			if (imported === 'load') loads.add(element.name.text);
			if (imported === 'save') saves.add(element.name.text);
		}
	}
	if (!namespaces.size && !loads.size && !saves.size) return { text, problems: [] };

	const isCall = (callee: ts.Expression, name: string, locals: Set<string>) =>
		(ts.isIdentifier(callee) && locals.has(callee.text))
		|| (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) && callee.name.text === name);

	const edits: { start: number; end: number; with: string }[] = [];
	const functions: string[] = [];
	const problems: string[] = [];
	const at: Context = { path, file };

	const replace = (call: ts.CallExpression, name: string) => {
		const start = call.expression.getStart(file);
		const end = call.arguments.pos - 1;
		edits.push({ start, end, with: name.padEnd(end - start) });
	};

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		if (!ts.isCallExpression(node)) return;

		if (isCall(node.expression, 'save', saves) && node.arguments.length === 1 && !node.typeArguments) {
			replace(node, `${NS}.save`);
			return;
		}

		const typed = node.typeArguments?.length || node.arguments.length >= 2;
		if (!isCall(node.expression, 'load', loads) || !typed) return;

		try {
			const { shape, type, declaration } = shapeOfCall(node, shapes, at, functions.length);
			if (shape.kind !== 'object') throw new ShapeError(node, file, `a config is an object: configs.load(name, { ... })`);
			const name = `__amxtsConfigLoad${functions.length}`;
			if (declaration) functions.push(declaration);
			functions.push(new LoadWriter(shape).function(name, type));
			replace(node, name);
		} catch (problem) {
			if (!(problem instanceof ShapeError)) throw problem;
			const place = problem.file.getLineAndCharacterOfPosition(problem.node.getStart(problem.file));
			const where = problem.file === file ? display : problem.file.fileName;
			problems.push(`${where}:${place.line + 1}:${place.character + 1}: configs.load - ${problem.message}`);
		}
	};
	visit(file);

	if (!edits.length) return { text, problems };

	let out = text;
	for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.with + out.slice(edit.end);

	// After the last line, so every line above keeps its number.
	const generated = [
		'',
		`// GENERATED by scripts/typed-configs.ts: the typed configs this file loads.`,
		`import * as ${NS} from "${HELPERS}";`,
		...functions,
		'',
	].join('\n');
	return { text: `${out}\n${generated}`, problems };
}

/** A load's shape and the type its function takes: the type argument, the defaults' declared type, or one made from the literal. */
function shapeOfCall(call: ts.CallExpression, shapes: Shapes, at: Context, index: number): { shape: Shape; type: string; declaration: string | null } {
	const typeArgument = call.typeArguments?.[0];
	if (typeArgument) return { shape: shapes.ofType(typeArgument, at), type: typeArgument.getText(at.file), declaration: null };

	const defaults = call.arguments[1];
	if (!defaults) throw new ShapeError(call, at.file, 'the defaults are missing: configs.load(name, { ... })');

	// A variable or a parameter with a declared type: `const defaults: Settings = { ... }`.
	if (ts.isIdentifier(defaults)) {
		const declared = declaredType(defaults, at.file);
		if (!declared) throw new ShapeError(defaults, at.file, `${defaults.text} - its type is not seen here; give it a type, or the call one: configs.load<Settings>(...)`);
		return { shape: shapes.ofType(declared, at), type: declared.getText(at.file), declaration: null };
	}

	const shape = shapes.ofValue(defaults, at);
	if (shape.kind !== 'object') return { shape, type: '', declaration: null };
	const name = `__AmxtsConfig${index}`;
	return { shape, type: name, declaration: `interface ${name} ${typeOf(shape)}` };
}

/** The declared type of the variable or parameter a name means where it is used: the nearest one around it. */
function declaredType(use: ts.Identifier, file: ts.SourceFile): ts.TypeNode | null {
	for (let scope: ts.Node | undefined = use.parent; scope; scope = scope.parent) {
		if (ts.isFunctionLike(scope)) {
			const parameter = scope.parameters.find(each => ts.isIdentifier(each.name) && each.name.text === use.text);
			if (parameter) return parameter.type ?? null;
		}
		if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
		for (const statement of scope.statements) {
			if (!ts.isVariableStatement(statement) || statement.getStart(file) > use.getStart(file)) continue;
			const found = statement.declarationList.declarations.find(each => ts.isIdentifier(each.name) && each.name.text === use.text);
			if (found) return found.type ?? null;
		}
	}
	return null;
}
