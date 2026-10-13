// The query builder's tables: `table(...)` of @amxts/core/database.
//
//   import { table, int, varchar, double } from "@amxts/core/database";
//
//   export const records = table("records", {
//     id: int().primaryKey().autoincrement(),
//     steamId: varchar(32).notNull(),
//     time: double().notNull(),
//   });
//   type Record = typeof records.$inferSelect;
//   const best = await db.select({ time: records.time }).from(records);
//
// The editor works the row's type out of the columns (as/sql.types.d.ts).
// AssemblyScript has neither mapped types nor reflection, so the build does
// it, reading each file on its way to the compiler (Sources.read), after the
// typed configs and commands:
//
// - each `table(...)` call, its columns a literal of builder chains, becomes
//   classes at the end of the file: the row; the raw row the database's JSON
//   is read into, by the columns' names in the database (a boolean comes as
//   0 or 1, a JSON column as text); what an insert and an update take; and
//   the table, whose fields are its columns and whose methods read rows and
//   lay an insert's or an update's values out, each with whether it was
//   given. The call becomes `new` of the table's class, padded, so the rest
//   of the line keeps its columns, and its lines stay lines;
// - `typeof records.$inferSelect` and `$inferInsert` become the classes'
//   names - imported from the file that has the table, when it is another;
// - `select({ ... })` of columns and aggregates becomes `__selectFields`,
//   with a row class and a reader of its own;
// - the names only the editor has - `table`, the column builders, `unique`
//   and `index` - leave the file's import of the entry.
//
// A column is named in the database in snake case, `steamId` as `steam_id`,
// or by the name its builder is given first, `int("PlayerID")`. What cannot
// be read from the source text stops the build with the place and the fix.
import type { ImportReader } from './typed-configs';
import ts from 'typescript';
import { ShapeError, withGenerated } from './typed-configs';

/** The entry, by its place in the tree, as the files' imports have it once rewritten (scripts/project.ts). */
export const DATABASE_ENTRY = '~/sql';

const NS = '__amxtsSql';

/** What a column holds, by its builder. Must match __INT... in as/sql.ts. */
const KIND = { int: 0, bigint: 1, double: 2, decimal: 3, varchar: 4, text: 5, boolean: 6, datetime: 7, json: 8, binary: 9, varbinary: 10, blob: 11, mediumblob: 12, longblob: 13 } as const;
type Kind = keyof typeof KIND;

/** Must match __NOT_NULL... in as/sql.ts. */
const NOT_NULL = 1;
const PRIMARY_KEY = 2;
const AUTOINCREMENT = 4;
const UNIQUE = 8;
const HAS_DEFAULT = 16;
const AS_TEXT = 32;

const AGGREGATES = new Set(['count', 'sum', 'avg', 'min', 'max']);

/** The entry's names only the editor has: an import of them would not build. */
const EDITOR_ONLY = new Set<string>([...Object.keys(KIND), 'table', 'unique', 'index']);

/** A column: its field in the row, its name in the database, what it holds. */
interface ColumnSpec {
	field: string;
	name: string;
	kind: Kind;
	/** What the row's field holds: `number`, `string`, `boolean`, `Uint8Array` or the JSON's type. */
	type: string;
	length: number;
	scale: number;
	flags: number;
	/** The default as code, `null` when there is none. */
	value: string;
}

interface KeySpec {
	name: string;
	unique: boolean;
	columns: string[];
}

interface TableSpec {
	variable: string;
	name: string;
	exported: boolean;
	columns: ColumnSpec[];
	keys: KeySpec[];
}

interface Edit {
	start: number;
	end: number;
	with: string;
}

export interface TypedTables {
	text: string;
	problems: string[];
}

const fieldOf = (spec: TableSpec, field: string) => spec.columns.find(column => column.field === field);

/** `steamId` as the database names it: `steam_id`. */
export function snakeCase(name: string): string {
	return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/([A-Z])([A-Z][a-z])/g, '$1_$2').toLowerCase();
}

/** `replacement` where `original` was: padded to its length on one line, followed by its line breaks when it had any. */
function inPlaceOf(original: string, replacement: string): string {
	const breaks = original.split('\n').length - 1;
	return breaks ? replacement + '\n'.repeat(breaks) : replacement.padEnd(original.length);
}

const isOptional = (column: ColumnSpec) => !(column.flags & NOT_NULL) || !!(column.flags & (HAS_DEFAULT | AUTOINCREMENT));
const VALUE_UNION = 'string | number | boolean | null';

/** A file's tables, each by its variable: `export const records = table(...)`. */
function tablesOf(file: ts.SourceFile, builders: Map<string, string>): { specs: Map<string, TableSpec>; calls: Map<string, ts.CallExpression> } {
	const specs = new Map<string, TableSpec>();
	const calls = new Map<string, ts.CallExpression>();
	for (const statement of file.statements) {
		if (!ts.isVariableStatement(statement)) continue;
		const exported = !!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
		for (const declaration of statement.declarationList.declarations) {
			const call = declaration.initializer;
			if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || builders.get(call.expression.text) !== 'table') continue;
			if (!ts.isIdentifier(declaration.name)) throw new ShapeError(declaration.name, file, 'a table is a variable of its own: const records = table(...)');
			const variable = declaration.name.text;
			specs.set(variable, tableOf(call, variable, exported, builders, file));
			calls.set(variable, call);
		}
	}
	return { specs, calls };
}

/** The entry's names a file imports, by the name it uses: `{ int: "int", tbl: "table" }`. */
function entryNames(file: ts.SourceFile): Map<string, string> {
	const names = new Map<string, string>();
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== DATABASE_ENTRY) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) names.set(element.name.text, (element.propertyName ?? element.name).text);
	}
	return names;
}

function tableOf(call: ts.CallExpression, variable: string, exported: boolean, builders: Map<string, string>, file: ts.SourceFile): TableSpec {
	const [nameNode, columnsNode, keysNode] = call.arguments;
	if (!nameNode || !ts.isStringLiteralLike(nameNode)) throw new ShapeError(call, file, 'the table\'s name is text written out: table("records", { ... })');
	if (!columnsNode || !ts.isObjectLiteralExpression(columnsNode)) throw new ShapeError(call, file, 'the columns are an object written out: table("records", { id: int().primaryKey(), ... })');
	const columns = columnsNode.properties.map((property) => {
		if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) throw new ShapeError(property, file, 'a column is `name: builder()`, such as `time: double().notNull()`');
		return columnOf(property.initializer, property.name.text, builders, file);
	});
	if (!columns.length) throw new ShapeError(columnsNode, file, 'a table has a column at least');
	const spec: TableSpec = { variable, name: nameNode.text, exported, columns, keys: [] };
	if (keysNode) spec.keys = keysOf(keysNode, spec, builders, file);
	return spec;
}

function columnOf(node: ts.Expression, field: string, builders: Map<string, string>, file: ts.SourceFile): ColumnSpec {
	const fail = (at: ts.Node, message: string) => new ShapeError(at, file, `${field} - ${message}`);
	const modifiers: ts.CallExpression[] = [];
	let base: ts.Expression = node;
	while (ts.isCallExpression(base) && ts.isPropertyAccessExpression(base.expression)) {
		modifiers.unshift(base);
		base = base.expression.expression;
	}
	const kind = ts.isCallExpression(base) && ts.isIdentifier(base.expression) ? builders.get(base.expression.text) : undefined;
	if (!kind || !(kind in KIND) || !ts.isCallExpression(base)) {
		throw fail(node, `a column is a builder of @amxts/core/database and its modifiers: ${Object.keys(KIND).join('(), ')}(), then .notNull(), .primaryKey() ...`);
	}

	const args = [...base.arguments];
	const name = args[0] && ts.isStringLiteralLike(args[0]) ? (args.shift() as ts.StringLiteral).text : snakeCase(field);
	if (!/^[a-z_]\w*$/i.test(name)) throw fail(base, `${name} - a column's name in the database is letters, digits and _`);
	const number = (index: number, what: string, fallback: number | null) => {
		const arg = args[index];
		if (!arg) {
			if (fallback === null) throw fail(base, `${what} is missing: ${kind}(32)`);
			return fallback;
		}
		if (!ts.isNumericLiteral(arg)) throw fail(arg, `${what} is a number written out`);
		return Number(arg.text);
	};
	const column: ColumnSpec = { field, name, kind: kind as Kind, type: 'number', length: 0, scale: 0, flags: 0, value: 'null' };
	switch (kind) {
		case 'varchar':
			column.length = number(0, 'the length', null);
			column.type = 'string';
			break;
		case 'binary':
		case 'varbinary':
			column.length = number(0, 'the length', null);
			column.type = 'Uint8Array';
			break;
		case 'blob':
		case 'mediumblob':
		case 'longblob':
			column.type = 'Uint8Array';
			break;
		case 'decimal':
			column.length = number(0, 'the precision', 10);
			column.scale = number(1, 'the scale', 0);
			break;
		case 'bigint': {
			const options = args[0];
			const mode = options && ts.isObjectLiteralExpression(options)
				? options.properties.find(property => ts.isPropertyAssignment(property) && property.name.getText(file) === 'mode')
				: undefined;
			const value = mode && ts.isPropertyAssignment(mode) && ts.isStringLiteralLike(mode.initializer) ? mode.initializer.text : 'number';
			if (options && !mode) throw fail(options, 'bigint\'s options are { mode: "number" } or { mode: "string" }');
			if (value === 'string') {
				column.type = 'string';
				column.flags |= AS_TEXT;
			}
			break;
		}
		case 'text':
		case 'datetime':
			column.type = 'string';
			break;
		case 'boolean':
			column.type = 'boolean';
			break;
		case 'json': {
			const type = base.typeArguments?.[0];
			if (!type) throw fail(base, 'json says what it holds: json<Settings>()');
			column.type = type.getText(file);
			break;
		}
	}

	for (const modifier of modifiers) {
		const what = (modifier.expression as ts.PropertyAccessExpression).name.text;
		switch (what) {
			case 'notNull':
				column.flags |= NOT_NULL;
				break;
			case 'primaryKey':
				column.flags |= NOT_NULL | PRIMARY_KEY;
				break;
			case 'autoincrement':
				if (kind !== 'int' && kind !== 'bigint') throw fail(modifier, 'autoincrement is of int() and bigint()');
				column.flags |= AUTOINCREMENT;
				break;
			case 'unique':
				column.flags |= UNIQUE;
				break;
			case 'default':
				column.flags |= HAS_DEFAULT;
				column.value = defaultOf(modifier.arguments[0], column, fail);
				break;
			default:
				throw fail(modifier, `.${what}() - a column's modifiers are notNull, primaryKey, autoincrement, unique and default`);
		}
	}
	return column;
}

/** A default as code: a literal of the column's type. */
function defaultOf(node: ts.Expression | undefined, column: ColumnSpec, fail: (at: ts.Node, message: string) => ShapeError): string {
	const wanted = column.kind === 'json'
		? 'nothing - a JSON column has no default'
		: column.type === 'Uint8Array' ? 'null - bytes have no default written out' : `a ${column.type} written out`;
	if (!node) throw fail({ getStart: () => 0 } as unknown as ts.Node, `the default is ${wanted}`);
	const ok = column.kind !== 'json' && (
		(column.type === 'number' && (ts.isNumericLiteral(node) || (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand))))
		|| (column.type === 'string' && ts.isStringLiteralLike(node))
		|| (column.type === 'boolean' && (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword))
		|| node.kind === ts.SyntaxKind.NullKeyword
	);
	if (!ok) throw fail(node, `the default is ${wanted}`);
	return ts.isStringLiteralLike(node) ? JSON.stringify(node.text) : node.getText();
}

/** `(t) => [unique().on(t.steamId, t.map), index().on(t.map)]`. */
function keysOf(node: ts.Expression, spec: TableSpec, builders: Map<string, string>, file: ts.SourceFile): KeySpec[] {
	const how = 'the keys are `(t) => [unique().on(t.steamId, t.map), index().on(t.map)]`';
	if (!ts.isArrowFunction(node) || node.parameters.length !== 1 || !ts.isIdentifier(node.parameters[0].name) || !ts.isArrayLiteralExpression(node.body)) {
		throw new ShapeError(node, file, how);
	}
	const parameter = node.parameters[0].name.text;
	return node.body.elements.map((element) => {
		const on = ts.isCallExpression(element) && ts.isPropertyAccessExpression(element.expression) && element.expression.name.text === 'on' ? element : null;
		const start = on?.expression && ts.isPropertyAccessExpression(on.expression) ? on.expression.expression : null;
		const kind = start && ts.isCallExpression(start) && ts.isIdentifier(start.expression) ? builders.get(start.expression.text) : undefined;
		if (!on || !start || !ts.isCallExpression(start) || (kind !== 'unique' && kind !== 'index')) throw new ShapeError(element, file, how);
		const columns = on.arguments.map((arg) => {
			const column = ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === parameter ? fieldOf(spec, arg.name.text) : undefined;
			if (!column) throw new ShapeError(arg, file, `a key's column is one of the table's: ${parameter}.${spec.columns[0].field}`);
			return column.name;
		});
		if (!columns.length) throw new ShapeError(element, file, 'a key is on a column at least');
		const named = start.arguments[0];
		const name = named && ts.isStringLiteralLike(named) ? named.text : `${spec.name}_${columns.join('_')}_${kind}`;
		return { name, unique: kind === 'unique', columns };
	});
}

// ---------------------------------------------------------------- the code written

/** What the raw row holds of a column, as the database's JSON gives it. */
function rawType(column: ColumnSpec): string {
	if (column.kind === 'boolean') return VALUE_UNION;
	if (column.type === 'Uint8Array') return 'Uint8Array | null';
	return column.type === 'number' ? 'number | null' : 'string | null';
}

/** The row's field of the raw one's: `row.time = raw.time`. */
function readOf(column: ColumnSpec, raw: string): string {
	const from = `${raw}.${column.name}`;
	const nullable = !(column.flags & NOT_NULL);
	if (column.kind === 'boolean') {
		return nullable ? `if (${from} !== null) row.${column.field} = ${NS}.__booleanOf(${from});` : `row.${column.field} = ${NS}.__booleanOf(${from});`;
	}
	if (column.kind === 'json') {
		return nullable ? `row.${column.field} = ${from} === null ? null : JSON.parse<${column.type}>(${from}!);` : `row.${column.field} = JSON.parse<${column.type}>(${from}!);`;
	}
	return `row.${column.field} = ${from}${nullable || column.type === 'number' ? '' : '!'};`;
}

/** A row's field: `time: number = 0`, `bonus: number | null = null`. */
function rowField(field: string, type: string, nullable: boolean, kind: Kind): string {
	if (nullable) return `${field}: ${type} | null = null;`;
	if (type === 'number') return `${field}: number = 0;`;
	if (type === 'string') return `${field}: string = "";`;
	if (type === 'boolean') return `${field}: boolean = false;`;
	if (type === 'Uint8Array') return `${field}: Uint8Array = new Uint8Array(0);`;
	return kind === 'json' ? `${field}!: ${type};` : `${field}: ${type} = 0;`;
}

/** An insert's or an update's field: one it may leave out keeps a mark of that. */
function givenField(column: ColumnSpec, optional: boolean): string {
	if (!optional) return rowField(column.field, column.type, false, column.kind);
	if (column.type === 'number') return `${column.field}?: number | null;`;
	if (column.type === 'string') return `${column.field}: string | null = ${NS}.__notGivenText;`;
	if (column.type === 'boolean') return `${column.field}: ${VALUE_UNION} = ${NS}.__notGivenValue;`;
	return `${column.field}: ${column.type} | null = changetype<${column.type}>(${NS}.__notGivenObject);`;
}

/** Lays a field out: whether it was given, and its value. */
function layOut(column: ColumnSpec, optional: boolean, of: string): string {
	const field = `${of}.${column.field}`;
	const given = !optional ? 'true' : column.type === 'number' ? `${field} !== undefined` : `${NS}.__given(${field})`;
	const value = column.type === 'number'
		? `${NS}.__numberValue(${field})`
		: column.kind === 'json'
			? (optional ? `${field} === null || !${NS}.__given(${field}) ? null : JSON.stringify(${field}!)` : `JSON.stringify(${field})`)
			: field;
	return `given.push(${given}); values.push(${value});`;
}

function tableCode(spec: TableSpec): string {
	const v = spec.variable;
	const exported = spec.exported ? 'export ' : '';
	const row = `__AmxtsRow_${v}`;
	const raw = `__AmxtsRaw_${v}`;
	const insert = `__AmxtsInsert_${v}`;
	const update = `__AmxtsUpdate_${v}`;
	const columns = spec.columns;
	const columnType = (column: ColumnSpec) => `${NS}.Column<${column.kind === 'json' || !(column.flags & NOT_NULL) || column.type !== 'number' ? column.type : 'number'}>`;
	const lines = [
		`${exported}class ${row} {`,
		...columns.map(column => `\t${rowField(column.field, column.type, !(column.flags & NOT_NULL), column.kind)}`),
		`}`,
		`class ${raw} {`,
		...columns.map(column => `\t${column.name}: ${rawType(column)} = null;`),
		`}`,
		`${exported}class ${insert} {`,
		...columns.map(column => `\t${givenField(column, isOptional(column))}`),
		`}`,
		`${exported}class ${update} {`,
		...columns.map(column => `\t${givenField(column, true)}`),
		`}`,
		`class __AmxtsTable_${v} extends ${NS}.Table<${row}, ${insert}, ${update}> {`,
		...columns.map(column => `\t${column.field}: ${columnType(column)} = new ${columnType(column)}(${JSON.stringify(column.name)}, ${KIND[column.kind]}, ${column.flags}, ${column.length}, ${column.scale}, ${column.value});`),
		`\tconstructor() {`,
		`\t\tsuper(${JSON.stringify(spec.name)});`,
		`\t\tthis.__columns = [${columns.map(column => `this.${column.field}`).join(', ')}];`,
		...(spec.keys.length ? [`\t\tthis.__indexes = [${spec.keys.map(key => `new ${NS}.__Index(${JSON.stringify(key.name)}, ${key.unique}, ${JSON.stringify(key.columns)})`).join(', ')}];`] : []),
		`\t}`,
		`\t__read(text: string): ${row}[] {`,
		`\t\tconst raws = JSON.parse<${raw}[]>(text);`,
		`\t\tconst rows = new Array<${row}>();`,
		`\t\tfor (let i = 0; i < raws.length; i++) {`,
		`\t\t\tconst from = raws[i];`,
		`\t\t\tconst row = new ${row}();`,
		...columns.map(column => `\t\t\t${readOf(column, 'from')}`),
		`\t\t\trows.push(row);`,
		`\t\t}`,
		`\t\treturn rows;`,
		`\t}`,
		`\t__insertRow(row: ${insert}, values: (${VALUE_UNION})[], given: bool[]): void {`,
		...columns.map(column => `\t\t${layOut(column, isOptional(column), 'row')}`),
		`\t}`,
		`\t__setRow(row: ${update}, values: (${VALUE_UNION})[], given: bool[]): void {`,
		...columns.map(column => `\t\t${layOut(column, true, 'row')}`),
		`\t}`,
		`}`,
	];
	return lines.join('\n');
}

/** A field of `select({ ... })`: a column of a table, or an aggregate of one. */
interface FieldSpec {
	name: string;
	/** The column it reads, or the aggregate's column. */
	column: ColumnSpec | null;
	aggregate: string | null;
}

/** What a chosen field holds: a column's value, or what its aggregate gives. */
function fieldColumn(field: FieldSpec): ColumnSpec {
	const column = field.column;
	if (field.aggregate === null) return { ...column!, field: field.name, name: field.name };
	const number: ColumnSpec = { field: field.name, name: field.name, kind: 'double', type: 'number', length: 0, scale: 0, flags: 0, value: 'null' };
	if (field.aggregate === 'count') return { ...number, flags: NOT_NULL };
	if ((field.aggregate === 'min' || field.aggregate === 'max') && column) return { ...column, field: field.name, name: field.name, flags: 0 };
	return number;
}

function selectCode(index: number, fields: FieldSpec[]): string {
	const row = `__AmxtsSelect${index}`;
	const raw = `__AmxtsSelectRaw${index}`;
	const columns = fields.map(fieldColumn);
	return [
		`class ${row} {`,
		...columns.map(column => `\t${rowField(column.field, column.type, !(column.flags & NOT_NULL), column.kind)}`),
		`}`,
		`class ${raw} {`,
		...columns.map(column => `\t${column.name}: ${rawType(column)} = null;`),
		`}`,
		`class __AmxtsSelectRead${index} extends ${NS}.__Reader<${row}> {`,
		`\t__read(text: string): ${row}[] {`,
		`\t\tconst raws = JSON.parse<${raw}[]>(text);`,
		`\t\tconst rows = new Array<${row}>();`,
		`\t\tfor (let i = 0; i < raws.length; i++) {`,
		`\t\t\tconst from = raws[i];`,
		`\t\t\tconst row = new ${row}();`,
		...columns.map(column => `\t\t\t${readOf(column, 'from')}`),
		`\t\t\trows.push(row);`,
		`\t\t}`,
		`\t\treturn rows;`,
		`\t}`,
		`}`,
	].join('\n');
}

/**
 * The file with its tables' classes written and its queries' calls
 * rewritten; what could not be read, at its place.
 */
export function typedTables(path: string, display: string, text: string, imports: ImportReader): TypedTables {
	if (!text.includes(DATABASE_ENTRY) && !text.includes('$infer') && !/\.select\(\s*\{/.test(text)) return { text, problems: [] };

	const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
	const builders = entryNames(file);
	const edits: Edit[] = [];
	const code: string[] = [];
	const extraImports: string[] = [];
	const problems: string[] = [];
	const report = (problem: unknown, what: string) => {
		if (!(problem instanceof ShapeError)) throw problem;
		const place = problem.file.getLineAndCharacterOfPosition(problem.node.getStart(problem.file));
		const where = problem.file === file ? display : problem.file.fileName;
		problems.push(`${where}:${place.line + 1}:${place.character + 1}: ${what} - ${problem.message}`);
	};

	// The file's own tables.
	let local = new Map<string, TableSpec>();
	try {
		const { specs, calls } = tablesOf(file, builders);
		local = specs;
		for (const [variable, call] of calls) {
			const start = call.getStart(file);
			edits.push({ start, end: call.end, with: inPlaceOf(text.slice(start, call.end), `new __AmxtsTable_${variable}()`) });
			code.push(tableCode(specs.get(variable)!));
		}
	} catch (problem) {
		report(problem, 'table');
	}

	// A table of another file, by the name this one imports it as: its spec and the import's place.
	const imported = new Map<string, { spec: TableSpec; from: string } | null>();
	const tableNamed = (name: string): { spec: TableSpec; from: string | null } | null => {
		const own = local.get(name);
		if (own) return { spec: own, from: null };
		if (!imported.has(name)) imported.set(name, importedTable(file, name, path, imports));
		return imported.get(name) ?? null;
	};
	const importClass = (from: string, name: string) => {
		const line = `import { ${name} } from "${from}";`;
		if (!extraImports.includes(line)) extraImports.push(line);
	};

	let selects = 0;
	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		try {
			// typeof records.$inferSelect
			if (ts.isTypeQueryNode(node) && ts.isQualifiedName(node.exprName) && ts.isIdentifier(node.exprName.left)) {
				const what = node.exprName.right.text;
				if (what !== '$inferSelect' && what !== '$inferInsert') return;
				const table = tableNamed(node.exprName.left.text);
				if (!table) throw new ShapeError(node, file, `${node.exprName.left.text} is not a table of table(...) this file has or imports`);
				const name = `__Amxts${what === '$inferSelect' ? 'Row' : 'Insert'}_${table.spec.variable}`;
				if (table.from) importClass(table.from, name);
				const start = node.getStart(file);
				edits.push({ start, end: node.end, with: inPlaceOf(text.slice(start, node.end), name) });
				return;
			}
			// db.select({ time: records.time, runs: count() })
			if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== 'select') return;
			const literal = node.arguments[0];
			if (node.arguments.length !== 1 || !ts.isObjectLiteralExpression(literal)) return;
			const fields = literal.properties.map(property => fieldOfSelect(property, tableNamed, builders, file));
			if (fields.every(field => field === null)) return;
			if (fields.some(field => field === null)) throw new ShapeError(literal, file, 'select takes columns of a table and aggregates: { time: records.time, runs: count() }');
			const index = selects++;
			code.push(selectCode(index, fields as FieldSpec[]));
			const values = literal.properties.map(property => (property as ts.PropertyAssignment).initializer.getText(file));
			const start = node.expression.name.getStart(file);
			const call = `__selectFields<__AmxtsSelect${index}>(new __AmxtsSelectRead${index}(), ${JSON.stringify(fields.map(field => field!.name))}, [${values.join(', ')}])`;
			edits.push({ start, end: node.end, with: inPlaceOf(text.slice(start, node.end), call) });
		} catch (problem) {
			report(problem, ts.isTypeQueryNode(node) ? 'typeof' : 'select');
		}
	};
	visit(file);

	// The names only the editor has leave the import of the entry.
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== DATABASE_ENTRY) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		const kept = bindings.elements.filter(element => !EDITOR_ONLY.has((element.propertyName ?? element.name).text));
		if (kept.length === bindings.elements.length) continue;
		const start = bindings.getStart(file);
		edits.push({ start, end: bindings.end, with: inPlaceOf(text.slice(start, bindings.end), `{ ${kept.map(element => element.getText(file)).join(', ')} }`) });
	}

	if (!edits.length) return { text, problems };
	let out = text;
	for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.with + out.slice(edit.end);
	if (!code.length && !extraImports.length) return { text: out, problems };
	const written = ['// GENERATED by scripts/typed-tables.ts: the tables this file has and the columns its queries choose.', ...code].join('\n');
	return { text: withGenerated(path, out, written, [`import * as ${NS} from "${DATABASE_ENTRY}";`, ...extraImports].join('\n')), problems };
}

/** A field of `select({ ... })`, or null when its value is no column or aggregate this file knows. */
function fieldOfSelect(
	property: ts.ObjectLiteralElementLike,
	tableNamed: (name: string) => { spec: TableSpec } | null,
	builders: Map<string, string>,
	file: ts.SourceFile,
): FieldSpec | null {
	if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return null;
	const name = property.name.text;
	const columnAt = (node: ts.Expression): ColumnSpec | null => {
		if (!ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression)) return null;
		const table = tableNamed(node.expression.text);
		const column = table ? fieldOf(table.spec, node.name.text) : undefined;
		return column ?? null;
	};
	const value = property.initializer;
	const column = columnAt(value);
	if (column) return { name, column, aggregate: null };
	if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression)) return null;
	const aggregate = builders.get(value.expression.text);
	if (!aggregate || !AGGREGATES.has(aggregate)) return null;
	const of = value.arguments[0];
	const ofColumn = of ? columnAt(of) : null;
	if (of && !ofColumn) throw new ShapeError(of, file, `${aggregate} is of a column of a table: ${aggregate}(records.time)`);
	if (!of && aggregate !== 'count') throw new ShapeError(value, file, `${aggregate} is of a column: ${aggregate}(records.time)`);
	return { name, column: ofColumn, aggregate };
}

/** The table a file imports by `name`, read from the file it comes from; null when it is none. */
function importedTable(file: ts.SourceFile, name: string, path: string, imports: ImportReader): { spec: TableSpec; from: string } | null {
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		const element = bindings.elements.find(each => each.name.text === name);
		if (!element) continue;
		const from = statement.moduleSpecifier.text;
		const found = imports(path, from);
		if (!found) return null;
		const other = ts.createSourceFile(found.path, found.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
		const spec = tablesOf(other, entryNames(other)).specs.get((element.propertyName ?? element.name).text);
		return spec?.exported ? { spec, from } : null;
	}
	return null;
}
