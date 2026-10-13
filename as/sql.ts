/// <reference path="./sql.types.d.ts" />
// The query builder: tables a plugin describes with `table(...)`, and the
// queries over them on a Database or a Transaction - SQL a dialect writes,
// every value a `?`.
//
//   import { table, int, varchar, double, eq, asc } from "@amxts/core/database";
//
//   export const records = table("records", {
//     id: int().primaryKey().autoincrement(),
//     map: varchar(64).notNull(),
//     time: double().notNull(),
//   });
//   const top = await db.select().from(records).where(eq(records.map, server.map)).orderBy(asc(records.time)).limit(10);
//
// `table` and the column builders are the editor's (sql.types.d.ts), where
// the row's type is worked out from the columns. The build reads each
// `table(...)` call and writes its classes in its place - the row, what an
// insert and an update take, and the table with its columns, which reads
// rows and lays values out without reflection (scripts/typed-tables.ts). So
// this file has what that code and the queries need, and no `table`.
//
// A query is sent when it is awaited: the compiler awaits its `__promise()`
// (Resolver.awaitableOf), and `then` is there for the editor and for
// `.then(...)`. One left unawaited is never sent.

import { DatabaseError, DatabaseQueries, DatabaseValue, ExecuteResult } from "./database";

// What a column holds, and how. Must match KIND and FLAG in scripts/typed-tables.ts.
/** @hidden */ export const __INT: i32 = 0;
/** @hidden */ export const __BIGINT: i32 = 1;
/** @hidden */ export const __DOUBLE: i32 = 2;
/** @hidden */ export const __DECIMAL: i32 = 3;
/** @hidden */ export const __VARCHAR: i32 = 4;
/** @hidden */ export const __TEXT: i32 = 5;
/** @hidden */ export const __BOOLEAN: i32 = 6;
/** @hidden */ export const __DATETIME: i32 = 7;
/** @hidden */ export const __JSON: i32 = 8;
/** @hidden */ export const __BINARY: i32 = 9;
/** @hidden */ export const __VARBINARY: i32 = 10;
/** @hidden */ export const __BLOB: i32 = 11;
/** @hidden */ export const __MEDIUMBLOB: i32 = 12;
/** @hidden */ export const __LONGBLOB: i32 = 13;
/** @hidden */ export const __NOT_NULL: i32 = 1;
/** @hidden */ export const __PRIMARY_KEY: i32 = 2;
/** @hidden */ export const __AUTOINCREMENT: i32 = 4;
/** @hidden */ export const __UNIQUE: i32 = 8;
/** @hidden */ export const __HAS_DEFAULT: i32 = 16;
/** @hidden a `bigint({ mode: "string" })`: selected as text, so no digit is lost. */
export const __AS_TEXT: i32 = 32;

// ---------------------------------------------------------------- SQL text

/** @hidden Something that writes itself into a statement: a column, a condition, an order. */
export abstract class __Sql {
	abstract __write(sql: __SqlWriter): void;
}

/** @hidden A statement as it is written: its text in parts, and the values of its `?`. */
export class __SqlWriter {
	parts: string[] = [];
	params: DatabaseValue[] = [];

	constructor(public dialect: SqlDialect) {}

	text(text: string): void {
		this.parts.push(text);
	}

	name(name: string): void {
		this.parts.push(this.dialect.quote(name));
	}

	value(value: DatabaseValue): void {
		this.params.push(value);
		this.parts.push(this.dialect.placeholder(this.params.length));
	}

	list(items: __Sql[], separator: string = ", "): void {
		for (let i = 0; i < items.length; i++) {
			if (i > 0) this.text(separator);
			items[i].__write(this);
		}
	}

	get sql(): string {
		return this.parts.join("");
	}
}

/** @hidden A value of a statement: a `?`. */
class __Param extends __Sql {
	constructor(public value: DatabaseValue) {
		super();
	}

	__write(sql: __SqlWriter): void {
		sql.value(this.value);
	}
}

/** @hidden A boolean column's value as the database gives it: a boolean, MySQL's 0 or 1, or text that says one. */
export function __booleanOf(value: DatabaseValue): bool {
	const kind = typeof value;
	if (kind == "string") return (value as string) == "1" || (value as string) == "true";
	return kind == "boolean" ? value as boolean : (value as number) != 0;
}

// The marks of a field an insert or an update leaves out, where null is a
// value to write: text, a boolean (held as a value), an object.
// @ts-ignore: decorator, and the runtime's allocator, which the editor's typings leave out
@lazy const __notGivenText: string = changetype<string>(__new(2, idof<string>()));
// @ts-ignore: decorator
@lazy const __notGivenValue: DatabaseValue = NaN;
// @ts-ignore: decorator
@lazy const __notGivenObject: __NotGiven = new __NotGiven();

export { __notGivenObject, __notGivenText, __notGivenValue };

/** @hidden the mark of an object left out. */
export class __NotGiven {}

/** @hidden whether an insert's or an update's field was given: it holds no mark of being left out. */
export function __given<T>(value: T): bool {
	const at = changetype<usize>(value);
	return at != changetype<usize>(__notGivenText) && at != changetype<usize>(__notGivenValue) && at != changetype<usize>(__notGivenObject);
}

/** @hidden A number as a value: its null and undefined are SQL's NULL. */
export function __numberValue(value: f64): DatabaseValue {
	// The NaNs of `number | undefined` and `number | null` (Compiler.makeNullNumber)
	if ((reinterpret<u64>(value) | 1) == 0x7FFD000000000001) return null;
	return value;
}

/** @hidden What a condition compares a column with: another column, or a value - JSON's text for an object, bytes as they are. */
function __operand<V>(value: V): __Sql {
	if (isFloat<V>()) return new __Param(__numberValue(<f64>value));
	// @ts-ignore: text or a boolean, boxed where the value goes
	if (isString<V>() || isBoolean<V>()) return new __Param(value);
	if (isReference<V>()) {
		// @ts-ignore: bytes, boxed where the value goes
		if (idof<V>() == idof<Uint8Array>()) return new __Param(value);
		if (value instanceof __Sql) return changetype<__Sql>(value);
		return new __Param(JSON.stringify(value));
	}
	return new __Param(<f64>value);
}

// ---------------------------------------------------------------- columns

/** @hidden A column whatever it holds: what tables, targets and orders take. */
export abstract class __Column extends __Sql {
	constructor(
		public __name: string,
		public __kind: i32,
		public __flags: i32,
		public __length: i32 = 0,
		public __scale: i32 = 0,
		public __default: DatabaseValue = null,
	) {
		super();
	}

	__write(sql: __SqlWriter): void {
		sql.name(this.__name);
	}

	/** @hidden as a select list has it: a `bigint` kept as text is cast to text. */
	__select(sql: __SqlWriter): void {
		if (!(this.__flags & __AS_TEXT)) {
			this.__write(sql);
			return;
		}
		sql.dialect.castText(sql, this);
		sql.text(" AS ");
		sql.name(this.__name);
	}
}

/** A column of a table - `records.time` - which queries compare, order and select by. */
export class Column<T> extends __Column {}

/** A value a query works out of a column: `count()`, `sum(records.time)`. */
export class Aggregate<T> extends __Sql {
	constructor(public __function: string, public __of: __Column | null) {
		super();
	}

	__write(sql: __SqlWriter): void {
		sql.text(`${this.__function}(`);
		const column = this.__of;
		if (column) column.__write(sql);
		else sql.text("*");
		sql.text(")");
	}
}

/** An aggregate that is `null` when no row is there to work it out of: `sum`, `avg`, `min`, `max`. */
export class NullableAggregate<T> extends Aggregate<T> {}

/** The number of rows - or, of a column, of the rows that hold a value in it. */
export function count(column: __Column | null = null): Aggregate<number> {
	return new Aggregate<number>("COUNT", column);
}

/** The sum of a column's values; `null` when there are none. */
export function sum<T>(column: Column<T>): NullableAggregate<number> {
	return new NullableAggregate<number>("SUM", column);
}

/** The average of a column's values; `null` when there are none. */
export function avg<T>(column: Column<T>): NullableAggregate<number> {
	return new NullableAggregate<number>("AVG", column);
}

/** The least of a column's values; `null` when there are none. */
export function min<T>(column: Column<T>): NullableAggregate<T> {
	return new NullableAggregate<T>("MIN", column);
}

/** The greatest of a column's values; `null` when there are none. */
export function max<T>(column: Column<T>): NullableAggregate<T> {
	return new NullableAggregate<T>("MAX", column);
}

/** A composite key of a table, made by the third argument of `table`: a unique one or a plain index. */
export class __Index {
	constructor(public name: string, public unique: bool, public columns: string[]) {}
}

/** @hidden What reads a query's rows: a table, or the build's reader of a choice of columns. */
export abstract class __Reader<R> {
	abstract __read(text: string): R[];
}

/**
 * A table `table(...)` describes: its columns are its fields, `records.time`.
 * `typeof records.$inferSelect` is its row, `typeof records.$inferInsert`
 * what an insert takes.
 */
export abstract class Table<R, I, U> extends __Reader<R> {
	/** @hidden */ __columns: __Column[] = [];
	/** @hidden */ __indexes: __Index[] = [];

	constructor(public __name: string) {
		super();
	}

	/** @hidden lays an insert's row out: each column's value, and whether it was given. */
	abstract __insertRow(row: I, values: DatabaseValue[], given: bool[]): void;

	/** @hidden lays an update's values out likewise. */
	abstract __setRow(set: U, values: DatabaseValue[], given: bool[]): void;
}

// ---------------------------------------------------------------- conditions

/** A condition of `where`: `eq(records.map, server.map)`, `and(...)`. */
export abstract class Condition extends __Sql {}

class __Compare extends Condition {
	constructor(public left: __Sql, public operator: string, public right: __Sql) {
		super();
	}

	__write(sql: __SqlWriter): void {
		this.left.__write(sql);
		sql.text(` ${this.operator} `);
		this.right.__write(sql);
	}
}

class __Logic extends Condition {
	constructor(public operator: string, public conditions: Condition[]) {
		super();
	}

	__write(sql: __SqlWriter): void {
		const conditions = this.conditions;
		if (conditions.length == 0) {
			sql.text(this.operator == "AND" ? "1 = 1" : "1 = 0");
			return;
		}
		sql.text("(");
		sql.list(changetype<__Sql[]>(conditions), ` ${this.operator} `);
		sql.text(")");
	}
}

class __Not extends Condition {
	constructor(public condition: Condition) {
		super();
	}

	__write(sql: __SqlWriter): void {
		sql.text("NOT (");
		this.condition.__write(sql);
		sql.text(")");
	}
}

class __IsNull extends Condition {
	constructor(public column: __Column, public negated: bool) {
		super();
	}

	__write(sql: __SqlWriter): void {
		this.column.__write(sql);
		sql.text(this.negated ? " IS NOT NULL" : " IS NULL");
	}
}

class __In extends Condition {
	constructor(public column: __Column, public values: __Sql[]) {
		super();
	}

	__write(sql: __SqlWriter): void {
		// An empty list holds nothing, which SQL's `IN ()` cannot say.
		if (this.values.length == 0) {
			sql.text("1 = 0");
			return;
		}
		this.column.__write(sql);
		sql.text(" IN (");
		sql.list(this.values);
		sql.text(")");
	}
}

class __Between extends Condition {
	constructor(public column: __Column, public low: __Sql, public high: __Sql) {
		super();
	}

	__write(sql: __SqlWriter): void {
		this.column.__write(sql);
		sql.text(" BETWEEN ");
		this.low.__write(sql);
		sql.text(" AND ");
		this.high.__write(sql);
	}
}

/** The column equals the value, or the other column. */
export function eq<T, V extends T | Column<T>>(column: Column<T>, value: V): Condition {
	return new __Compare(column, "=", __operand<V>(value));
}

/** The column does not equal the value, or the other column. */
export function ne<T, V extends T | Column<T>>(column: Column<T>, value: V): Condition {
	return new __Compare(column, "<>", __operand<V>(value));
}

/** The column is greater than the value, or the other column. */
export function gt<T, V extends T | Column<T>>(column: Column<T>, value: V): Condition {
	return new __Compare(column, ">", __operand<V>(value));
}

/** The column is greater than or equal to the value, or the other column. */
export function gte<T, V extends T | Column<T>>(column: Column<T>, value: V): Condition {
	return new __Compare(column, ">=", __operand<V>(value));
}

/** The column is less than the value, or the other column. */
export function lt<T, V extends T | Column<T>>(column: Column<T>, value: V): Condition {
	return new __Compare(column, "<", __operand<V>(value));
}

/** The column is less than or equal to the value, or the other column. */
export function lte<T, V extends T | Column<T>>(column: Column<T>, value: V): Condition {
	return new __Compare(column, "<=", __operand<V>(value));
}

/** The text column matches `pattern`, SQL's `LIKE`: `%` any text, `_` one character. */
export function like<T>(column: Column<T>, pattern: string): Condition {
	return new __Compare(column, "LIKE", new __Param(pattern));
}

/** The column's value is one of `values`; never, when there are none. */
export function inArray<T>(column: Column<T>, values: T[]): Condition {
	const operands = new Array<__Sql>();
	for (let i = 0; i < values.length; i++) operands.push(__operand<T>(values[i]));
	return new __In(column, operands);
}

/** The column's value is between `low` and `high`, both included. */
export function between<T>(column: Column<T>, low: T, high: T): Condition {
	return new __Between(column, __operand<T>(low), __operand<T>(high));
}

/** The column holds no value: SQL's `NULL`. */
export function isNull<T>(column: Column<T>): Condition {
	return new __IsNull(column, false);
}

/** The column holds a value. */
export function isNotNull<T>(column: Column<T>): Condition {
	return new __IsNull(column, true);
}

/** Every condition holds; with none, any row does. */
export function and(...conditions: Condition[]): Condition {
	return new __Logic("AND", conditions);
}

/** One of the conditions holds; with none, no row does. */
export function or(...conditions: Condition[]): Condition {
	return new __Logic("OR", conditions);
}

/** The condition does not hold. */
export function not(condition: Condition): Condition {
	return new __Not(condition);
}

/** An order of `orderBy`: by a column or an aggregate, up or down. */
export class Order extends __Sql {
	constructor(public __by: __Sql, public __descending: bool) {
		super();
	}

	__write(sql: __SqlWriter): void {
		this.__by.__write(sql);
		sql.text(this.__descending ? " DESC" : " ASC");
	}
}

/** Smallest first. */
export function asc(by: __Sql): Order {
	return new Order(by, false);
}

/** Greatest first. */
export function desc(by: __Sql): Order {
	return new Order(by, true);
}

// ---------------------------------------------------------------- dialects

/**
 * A database's way of writing SQL: the names, the `?`, the upsert, the
 * column types of `create`. A provider's connection names its dialect; the builder
 * hands the parts of a statement to it, so the same query is written for
 * any database. This class writes standard SQL; a dialect overrides what
 * its database writes otherwise, and what it cannot do it refuses with
 * `unsupported`.
 */
export abstract class SqlDialect {
	/** The database's name, for a message, e.g. `"mysql"`. */
	abstract get name(): string;

	/** A table's or a column's name as the statement has it, e.g. `"name"`. */
	quote(name: string): string {
		return `"${name.replaceAll("\"", "\"\"")}"`;
	}

	/** The mark of the `index`-th value (from 1): `?`. */
	placeholder(index: number): string {
		return "?";
	}

	/** A column selected as text: `CAST(column AS TEXT)`. */
	castText(sql: __SqlWriter, column: __Column): void {
		sql.text("CAST(");
		column.__write(sql);
		sql.text(" AS TEXT)");
	}

	/** `LIMIT` and `OFFSET`; NaN for one not given. */
	limit(sql: __SqlWriter, limit: f64, offset: f64): void {
		if (!isNaN(limit)) {
			sql.text(" LIMIT ");
			sql.value(limit);
		}
		if (!isNaN(offset)) {
			sql.text(" OFFSET ");
			sql.value(offset);
		}
	}

	/** An insert without a single column given. */
	insertDefaults(sql: __SqlWriter): void {
		sql.text(" DEFAULT VALUES");
	}

	/** A value an insert of several rows leaves to the column's default. */
	defaultValue(sql: __SqlWriter): void {
		sql.text("DEFAULT");
	}

	/** After `INSERT ... VALUES ...`: on a row whose `target` is taken already, change `set` instead - or, with none, do nothing. */
	onConflict(sql: __SqlWriter, target: __Column[], set: __Sql[] | null): void {
		sql.text(" ON CONFLICT (");
		sql.list(changetype<__Sql[]>(target));
		if (set) {
			sql.text(") DO UPDATE SET ");
			sql.list(set);
		} else {
			sql.text(") DO NOTHING");
		}
	}

	/** After an insert: what makes `insertId` - nothing where the server gives it. */
	returningId(sql: __SqlWriter, key: __Column | null): void {}

	/** A column's type in `CREATE TABLE`: `VARCHAR(32)`. */
	columnType(column: __Column): string {
		throw this.unsupported("column types", "create the table with db.execute");
	}

	/** `CREATE TABLE IF NOT EXISTS` of the table, and then any statement its indexes need. */
	createTable<R, I, U>(table: Table<R, I, U>): string[] {
		const sql = new __SqlWriter(this);
		sql.text("CREATE TABLE IF NOT EXISTS ");
		sql.name(table.__name);
		sql.text(" (");
		const columns = table.__columns;
		const keys = new Array<__Sql>();
		for (let i = 0; i < columns.length; i++) {
			const column = columns[i];
			if (i > 0) sql.text(", ");
			this.columnDefinition(sql, column);
			if (column.__flags & __PRIMARY_KEY) keys.push(column);
		}
		if (keys.length > 0) {
			sql.text(", PRIMARY KEY (");
			sql.list(keys);
			sql.text(")");
		}
		const indexes = table.__indexes;
		const inside = this.indexesInside(sql, indexes);
		sql.text(")");
		const statements = [sql.sql];
		if (!inside) {
			for (let i = 0; i < indexes.length; i++) statements.push(this.index(table.__name, indexes[i]));
		}
		return statements;
	}

	/** A column of `CREATE TABLE`: its name, type, `NOT NULL`, default and `UNIQUE`. */
	columnDefinition(sql: __SqlWriter, column: __Column): void {
		sql.name(column.__name);
		sql.text(` ${this.columnType(column)}`);
		const flags = column.__flags;
		if (flags & __NOT_NULL) sql.text(" NOT NULL");
		if (flags & __HAS_DEFAULT) sql.text(` DEFAULT ${this.literal(column.__default)}`);
		if (flags & __UNIQUE) sql.text(" UNIQUE");
	}

	/** Writes the composite keys inside `CREATE TABLE`, where the database takes them there; false leaves each to a `CREATE INDEX`. */
	indexesInside(sql: __SqlWriter, indexes: __Index[]): bool {
		return false;
	}

	/** `CREATE INDEX` of a composite key. */
	index(table: string, index: __Index): string {
		const sql = new __SqlWriter(this);
		sql.text(index.unique ? "CREATE UNIQUE INDEX IF NOT EXISTS " : "CREATE INDEX IF NOT EXISTS ");
		sql.name(index.name);
		sql.text(" ON ");
		sql.name(table);
		sql.text(" (");
		for (let i = 0; i < index.columns.length; i++) {
			if (i > 0) sql.text(", ");
			sql.name(index.columns[i]);
		}
		sql.text(")");
		return sql.sql;
	}

	/** A default of `create`, written into the statement - a value of the plugin's code, never one a player typed. */
	literal(value: DatabaseValue): string {
		if (value === null) return "NULL";
		const kind = typeof value;
		if (kind == "string") return `'${(value as string).replaceAll("'", "''")}'`;
		if (kind == "boolean") return (value as boolean) ? "TRUE" : "FALSE";
		return `${value as number}`;
	}

	/** The error of something this dialect's database cannot do: `mysql has no ...: write ... instead`. */
	unsupported(what: string, instead: string): DatabaseError {
		return new DatabaseError(`${this.name} has no ${what}: ${instead}`);
	}
}

/** MySQL's and MariaDB's SQL. */
class __MysqlDialect extends SqlDialect {
	get name(): string {
		return "mysql";
	}

	quote(name: string): string {
		return `\`${name.replaceAll("`", "``")}\``;
	}

	castText(sql: __SqlWriter, column: __Column): void {
		sql.text("CAST(");
		column.__write(sql);
		sql.text(" AS CHAR)");
	}

	limit(sql: __SqlWriter, limit: f64, offset: f64): void {
		// MySQL has no OFFSET without a LIMIT: its manual's largest one
		if (isNaN(limit) && !isNaN(offset)) {
			sql.text(" LIMIT 18446744073709551615");
			sql.text(" OFFSET ");
			sql.value(offset);
			return;
		}
		super.limit(sql, limit, offset);
	}

	insertDefaults(sql: __SqlWriter): void {
		sql.text(" () VALUES ()");
	}

	onConflict(sql: __SqlWriter, target: __Column[], set: __Sql[] | null): void {
		// MySQL finds the taken key itself; nothing to do is the key set to itself
		sql.text(" ON DUPLICATE KEY UPDATE ");
		if (set) {
			sql.list(set);
			return;
		}
		target[0].__write(sql);
		sql.text(" = ");
		target[0].__write(sql);
	}

	columnType(column: __Column): string {
		const auto = column.__flags & __AUTOINCREMENT ? " AUTO_INCREMENT" : "";
		switch (column.__kind) {
			case __INT: return `INT${auto}`;
			case __BIGINT: return `BIGINT${auto}`;
			case __DOUBLE: return "DOUBLE";
			case __DECIMAL: return `DECIMAL(${column.__length}, ${column.__scale})`;
			case __VARCHAR: return `VARCHAR(${column.__length})`;
			case __TEXT: return "TEXT";
			case __BOOLEAN: return "BOOLEAN";
			case __DATETIME: return "DATETIME";
			case __BINARY: return `BINARY(${column.__length})`;
			case __VARBINARY: return `VARBINARY(${column.__length})`;
			case __BLOB: return "BLOB";
			case __MEDIUMBLOB: return "MEDIUMBLOB";
			case __LONGBLOB: return "LONGBLOB";
		}
		return "JSON";
	}

	indexesInside(sql: __SqlWriter, indexes: __Index[]): bool {
		for (let i = 0; i < indexes.length; i++) {
			const index = indexes[i];
			sql.text(index.unique ? ", UNIQUE KEY " : ", KEY ");
			sql.name(index.name);
			sql.text(" (");
			for (let j = 0; j < index.columns.length; j++) {
				if (j > 0) sql.text(", ");
				sql.name(index.columns[j]);
			}
			sql.text(")");
		}
		return true;
	}

	literal(value: DatabaseValue): string {
		const text = super.literal(value);
		// MySQL reads a backslash in text as an escape
		return typeof value == "string" ? text.replaceAll("\\", "\\\\") : text;
	}
}

// @ts-ignore: decorator
@lazy const __mysql: SqlDialect = new __MysqlDialect();

export {
	/** The dialect of MySQL and MariaDB, the module's own client. */
	__mysql as mysql,
};

// ---------------------------------------------------------------- queries

/** @hidden `column = ?` of an update's SET or an upsert's. */
class __Assign extends __Sql {
	constructor(public column: __Column, public value: DatabaseValue) {
		super();
	}

	__write(sql: __SqlWriter): void {
		this.column.__write(sql);
		sql.text(" = ");
		sql.value(this.value);
	}
}

/** @hidden The columns an update's values give, each `column = ?`. */
function __assignments<R, I, U>(table: Table<R, I, U>, set: U): __Sql[] {
	const values = new Array<DatabaseValue>();
	const given = new Array<bool>();
	table.__setRow(set, values, given);
	const assignments = new Array<__Sql>();
	const columns = table.__columns;
	for (let i = 0; i < columns.length; i++) {
		if (given[i]) assignments.push(new __Assign(columns[i], values[i]));
	}
	return assignments;
}

/** The start of a query of rows: `db.select().from(records)`. */
export class SelectBuilder {
	constructor(private __queries: DatabaseQueries) {}

	/** The table whose rows the query reads, every column of them. */
	from<R, I, U>(table: Table<R, I, U>): SelectQuery<R> {
		return new SelectQuery<R>(this.__queries, table, table.__name, changetype<__Sql[]>(table.__columns), null);
	}
}

/** The start of a query of chosen columns: `db.select({ time: records.time }).from(records)`. */
export class SelectFieldsBuilder<S> {
	constructor(private __queries: DatabaseQueries, private __reader: __Reader<S>, private __names: string[], private __fields: __Sql[]) {}

	/** The table whose rows the query reads. */
	from<R, I, U>(table: Table<R, I, U>): SelectQuery<S> {
		return new SelectQuery<S>(this.__queries, this.__reader, table.__name, this.__fields, this.__names);
	}
}

/** A query of rows, sent when it is awaited: `await db.select().from(records).where(...)`. */
export class SelectQuery<R> {
	private __where: Condition | null = null;
	private __groupBy: __Sql[] = [];
	private __orderBy: __Sql[] = [];
	private __limit: f64 = NaN;
	private __offset: f64 = NaN;

	constructor(
		private __queries: DatabaseQueries,
		private __reader: __Reader<R>,
		private __table: string,
		private __fields: __Sql[],
		private __names: string[] | null,
	) {}

	/** Only the rows the condition holds for. */
	where(condition: Condition): SelectQuery<R> {
		this.__where = condition;
		return this;
	}

	/** One row for each value of these columns, which aggregates are worked out over. */
	groupBy(...by: __Sql[]): SelectQuery<R> {
		this.__groupBy = by;
		return this;
	}

	/** The rows in this order: by a column - smallest first - or `asc(...)` and `desc(...)`. */
	orderBy(...by: __Sql[]): SelectQuery<R> {
		this.__orderBy = by;
		return this;
	}

	/** At most this many rows. */
	limit(count: number): SelectQuery<R> {
		this.__limit = count;
		return this;
	}

	/** Leaves out this many rows first. */
	offset(count: number): SelectQuery<R> {
		this.__offset = count;
		return this;
	}

	/** @hidden what `await` awaits: the query sent. */
	__promise(): Promise<R[]> {
		return this.__send();
	}

	private async __send(): Promise<R[]> {
		const queries = this.__queries;
		const dialect = queries.dialect;
		const sql = new __SqlWriter(dialect);
		sql.text("SELECT ");
		const fields = this.__fields;
		const names = this.__names;
		for (let i = 0; i < fields.length; i++) {
			if (i > 0) sql.text(", ");
			if (names) {
				fields[i].__write(sql);
				sql.text(" AS ");
				sql.name(names[i]);
			} else {
				changetype<__Column>(fields[i]).__select(sql);
			}
		}
		sql.text(" FROM ");
		sql.name(this.__table);
		const where = this.__where;
		if (where) {
			sql.text(" WHERE ");
			where.__write(sql);
		}
		if (this.__groupBy.length > 0) {
			sql.text(" GROUP BY ");
			sql.list(this.__groupBy);
		}
		if (this.__orderBy.length > 0) {
			sql.text(" ORDER BY ");
			sql.list(this.__orderBy);
		}
		dialect.limit(sql, this.__limit, this.__offset);
		return this.__reader.__read(await queries.query(sql.sql, sql.params));
	}

	/** Sends the query and calls `onFulfilled` with its rows. */
	then<U = void>(onFulfilled: (rows: R[]) => U, onRejected: ((reason: Error) => U) | null = null): Promise<U> {
		return this.__promise().then<U>(onFulfilled, onRejected);
	}

	/** Sends the query; `onRejected` is called if it fails. */
	catch<U = void>(onRejected: (reason: Error) => U): Promise<R[]> {
		return this.__promise().catch<U>(onRejected);
	}
}

/** The start of an insert: `db.insert(records).values({ ... })`. */
export class InsertBuilder<R, I, U> {
	constructor(private __queries: DatabaseQueries, private __table: Table<R, I, U>) {}

	/** The row to insert, or the rows. */
	values(rows: I | I[]): InsertQuery<R, I, U> {
		// @ts-ignore: `I | I[]` is held as the list
		return new InsertQuery<R, I, U>(this.__queries, this.__table, rows);
	}
}

/** The key whose taken value is a conflict: a column with a unique or primary key, or the columns of one. */
export interface ConflictTarget {
	/** The column, or the columns, of the unique key. */
	target: __Column | __Column[];
}

/** The change an insert makes instead on a row whose key is taken. */
export interface ConflictUpdate<U> {
	/** The column, or the columns, of the unique key. */
	target: __Column | __Column[];
	/** The columns to change on the row there, and their values. */
	set: U;
}

/** An insert, sent when it is awaited; gives `{ insertId, affectedRows }`. */
export class InsertQuery<R, I, U> {
	private __target: __Column[] | null = null;
	private __set: __Sql[] | null = null;

	constructor(private __queries: DatabaseQueries, private __table: Table<R, I, U>, private __rows: I[]) {}

	/** Leaves a row out when its key is taken already. */
	onConflictDoNothing(config: ConflictTarget): InsertQuery<R, I, U> {
		// @ts-ignore: `T | T[]` is held as the list
		this.__target = config.target;
		this.__set = null;
		return this;
	}

	/** Changes `set` on the row there instead when the row's key is taken already. */
	onConflictDoUpdate(config: ConflictUpdate<U>): InsertQuery<R, I, U> {
		// @ts-ignore: `T | T[]` is held as the list
		this.__target = config.target;
		this.__set = __assignments<R, I, U>(this.__table, config.set);
		return this;
	}

	/** @hidden what `await` awaits: the insert sent. */
	__promise(): Promise<ExecuteResult> {
		return this.__send();
	}

	private async __send(): Promise<ExecuteResult> {
		const queries = this.__queries;
		const dialect = queries.dialect;
		const table = this.__table;
		const columns = table.__columns;
		const rows = this.__rows;
		if (rows.length == 0) throw new DatabaseError(`an insert into ${table.__name} without a row`);
		const set = this.__set;
		if (set && set.length == 0) throw new DatabaseError(`an upsert into ${table.__name} that sets no column`);

		// Each row laid out by the table; a column goes in when any row gives it.
		const values = new Array<DatabaseValue[]>();
		const given = new Array<bool[]>();
		const used = new Array<bool>(columns.length);
		for (let r = 0; r < rows.length; r++) {
			const rowValues = new Array<DatabaseValue>();
			const rowGiven = new Array<bool>();
			table.__insertRow(rows[r], rowValues, rowGiven);
			for (let c = 0; c < columns.length; c++) used[c] = used[c] || rowGiven[c];
			values.push(rowValues);
			given.push(rowGiven);
		}

		const sql = new __SqlWriter(dialect);
		sql.text("INSERT INTO ");
		sql.name(table.__name);
		const written = new Array<__Sql>();
		for (let c = 0; c < columns.length; c++) {
			if (used[c]) written.push(columns[c]);
		}
		if (written.length == 0) {
			dialect.insertDefaults(sql);
		} else {
			sql.text(" (");
			sql.list(written);
			sql.text(") VALUES ");
			for (let r = 0; r < rows.length; r++) {
				sql.text(r > 0 ? ", (" : "(");
				let first = true;
				for (let c = 0; c < columns.length; c++) {
					if (!used[c]) continue;
					if (!first) sql.text(", ");
					first = false;
					if (given[r][c]) sql.value(values[r][c]);
					else dialect.defaultValue(sql);
				}
				sql.text(")");
			}
		}
		const target = this.__target;
		if (target) dialect.onConflict(sql, target, set);
		let key: __Column | null = null;
		for (let c = 0; c < columns.length; c++) {
			if (columns[c].__flags & __AUTOINCREMENT) key = columns[c];
		}
		dialect.returningId(sql, key);
		return await queries.execute(sql.sql, sql.params);
	}

	/** Sends the insert and calls `onFulfilled` with what it did. */
	then<V = void>(onFulfilled: (result: ExecuteResult) => V, onRejected: ((reason: Error) => V) | null = null): Promise<V> {
		return this.__promise().then<V>(onFulfilled, onRejected);
	}

	/** Sends the insert; `onRejected` is called if it fails. */
	catch<V = void>(onRejected: (reason: Error) => V): Promise<ExecuteResult> {
		return this.__promise().catch<V>(onRejected);
	}
}

/** The start of an update: `db.update(records).set({ ... })`. */
export class UpdateBuilder<R, I, U> {
	constructor(private __queries: DatabaseQueries, private __table: Table<R, I, U>) {}

	/** The columns to change, and their values. */
	set(values: U): ChangeQuery {
		return new ChangeQuery(this.__queries, this.__table.__name, __assignments<R, I, U>(this.__table, values));
	}
}

/** An update or a delete, sent when it is awaited; gives `{ insertId, affectedRows }`. */
export class ChangeQuery {
	private __where: Condition | null = null;

	/** `set` null: a delete. */
	constructor(private __queries: DatabaseQueries, private __table: string, private __set: __Sql[] | null) {}

	/** Only the rows the condition holds for; without it, every row. */
	where(condition: Condition): ChangeQuery {
		this.__where = condition;
		return this;
	}

	/** @hidden what `await` awaits: the statement sent. */
	__promise(): Promise<ExecuteResult> {
		return this.__send();
	}

	private async __send(): Promise<ExecuteResult> {
		const queries = this.__queries;
		const sql = new __SqlWriter(queries.dialect);
		const set = this.__set;
		if (set) {
			if (set.length == 0) throw new DatabaseError(`an update of ${this.__table} that sets no column`);
			sql.text("UPDATE ");
			sql.name(this.__table);
			sql.text(" SET ");
			sql.list(set);
		} else {
			sql.text("DELETE FROM ");
			sql.name(this.__table);
		}
		const where = this.__where;
		if (where) {
			sql.text(" WHERE ");
			where.__write(sql);
		}
		return await queries.execute(sql.sql, sql.params);
	}

	/** Sends the statement and calls `onFulfilled` with what it did. */
	then<V = void>(onFulfilled: (result: ExecuteResult) => V, onRejected: ((reason: Error) => V) | null = null): Promise<V> {
		return this.__promise().then<V>(onFulfilled, onRejected);
	}

	/** Sends the statement; `onRejected` is called if it fails. */
	catch<V = void>(onRejected: (reason: Error) => V): Promise<ExecuteResult> {
		return this.__promise().catch<V>(onRejected);
	}
}
