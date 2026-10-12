// The query builder's types that only the editor reads: `table` and its
// columns, whose row TypeScript works out from what they say, and
// `select({ ... })`, whose row it works out from the columns chosen. The
// build reads the same calls and writes classes for them
// (scripts/typed-tables.ts); asc never compiles a `table(...)` call, and a
// column builder is never a value at run time.
import type { Database, Transaction } from "./database";
import type { __Column, Aggregate, Column, NullableAggregate, SelectBuilder, SelectFieldsBuilder, Table } from "./sql";

/**
 * A column as `table` describes it: the type of its value, whether it holds
 * one always (`notNull`), and whether an insert may leave it out (a default
 * or `autoincrement`).
 */
interface ColumnBuilder<T, NotNull extends boolean = false, Defaulted extends boolean = false> {
	/** The column holds a value always: the row's field is never `null`. */
	// oxlint-disable-next-line typescript/method-signature-style -- a builder's chain, as the editor reads it
	notNull(): ColumnBuilder<T, true, Defaulted>;
	/** The table's primary key, or a column of it: `NOT NULL` too. */
	// oxlint-disable-next-line typescript/method-signature-style -- a builder's chain, as the editor reads it
	primaryKey(): ColumnBuilder<T, true, Defaulted>;
	/** The database numbers new rows itself: an insert may leave the column out. */
	// oxlint-disable-next-line typescript/method-signature-style -- a builder's chain, as the editor reads it
	autoincrement(): ColumnBuilder<T, NotNull, true>;
	/** The value of a row an insert left it out of - of the plugin's code, written into `create`'s statement. */
	// oxlint-disable-next-line typescript/method-signature-style -- a builder's chain, as the editor reads it
	default(value: T): ColumnBuilder<T, NotNull, true>;
	/** No two rows hold the same value. */
	// oxlint-disable-next-line typescript/method-signature-style -- a builder's chain, as the editor reads it
	unique(): ColumnBuilder<T, NotNull, Defaulted>;
	/** @hidden */
	readonly __column: [T, NotNull, Defaulted];
}

/** A key of more than one column, from `table`'s third argument. */
interface TableKey {
	/** @hidden */
	readonly __key: true;
}

/** `unique()` or `index()` before the columns it is on. */
interface KeyBuilder {
	/** The columns of the key, in order. */
	// oxlint-disable-next-line typescript/method-signature-style -- a builder's chain, as the editor reads it
	on(...columns: __Column[]): TableKey;
}

/** The value a column's field has in a row: `null` too, unless `notNull`. */
type ColumnValue<B> = B extends ColumnBuilder<infer T, infer N, boolean> ? (N extends true ? T : T | null) : never;

/** The columns an insert has to give: `notNull` ones without a default. */
type RequiredColumn<C> = { [K in keyof C]: C[K] extends ColumnBuilder<unknown, true, false> ? K : never }[keyof C];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type ColumnsOf<C> = { readonly [K in keyof C]: Column<ColumnValue<C[K]>> };

type InferSelect<C> = { [K in keyof C]: ColumnValue<C[K]> };

type InferInsert<C> = Simplify<{ [K in RequiredColumn<C>]: ColumnValue<C[K]> } & { [K in Exclude<keyof C, RequiredColumn<C>>]?: ColumnValue<C[K]> }>;

type InferUpdate<C> = { [K in keyof C]?: ColumnValue<C[K]> };

/** A field of `select({ ... })`'s row: a column's value, an aggregate's. */
type FieldValue<F> = F extends NullableAggregate<infer T> ? T | null : F extends Aggregate<infer T> ? T : F extends Column<infer T> ? T : never;

type FieldsRow<S> = { [K in keyof S]: FieldValue<S[K]> };

/** What `select` chooses: columns and aggregates by the names its row gives them. */
type Fields = Record<string, Column<any> | Aggregate<any>>;

/** `bigint`'s options: its value a `number` - exact up to 2^53 - or text, every digit kept. */
interface BigintOptions<M extends "number" | "string"> {
	mode: M;
}

declare module "./sql" {
	interface Table<R, I, U> {
		/** The table's row: `type Record = typeof records.$inferSelect`. */
		readonly $inferSelect: R;
		/** The row an insert into the table takes: the `notNull` columns without a default, and the rest optional. */
		readonly $inferInsert: I;
	}

	interface Column<T> {
		/** @hidden */
		readonly __type?: T;
	}

	interface Aggregate<T> {
		/** @hidden */
		readonly __type?: T;
	}

	interface NullableAggregate<T> {
		/** @hidden */
		readonly __nullable: true;
	}

	/**
	 * A table of the database: its name, and its columns by the names the
	 * plugin reads them by. A column is named in the database in snake case
	 * (`steamId` is `steam_id`), or by the name its builder is given first,
	 * `int("PlayerID")`. The third argument gives keys of several columns.
	 *
	 * ```ts
	 * export const records = table("records", {
	 *   id: int().primaryKey().autoincrement(),
	 *   steamId: varchar(32).notNull(),
	 *   map: varchar(64).notNull(),
	 *   time: double().notNull(),
	 * }, (t) => [unique().on(t.steamId, t.map)]);
	 * type Record = typeof records.$inferSelect;
	 * ```
	 */
	export function table<C extends Record<string, ColumnBuilder<any, boolean, boolean>>>(
		name: string,
		columns: C,
		keys?: (table: ColumnsOf<C>) => TableKey[],
	): Table<InferSelect<C>, InferInsert<C>, InferUpdate<C>> & ColumnsOf<C>;

	/** A whole number: `INT`. */
	export function int(name?: string): ColumnBuilder<number>;
	/** A large whole number: `BIGINT` - a `number`, exact up to 2^53, or text with `{ mode: "string" }`. */
	export function bigint(options?: BigintOptions<"number">): ColumnBuilder<number>;
	export function bigint(options: BigintOptions<"string">): ColumnBuilder<string>;
	export function bigint(name: string, options?: BigintOptions<"number">): ColumnBuilder<number>;
	export function bigint(name: string, options: BigintOptions<"string">): ColumnBuilder<string>;
	/** A fraction: `DOUBLE`. */
	export function double(name?: string): ColumnBuilder<number>;
	/** An exact fraction: `DECIMAL(precision, scale)`, read as a `number`. */
	export function decimal(precision?: number, scale?: number): ColumnBuilder<number>;
	export function decimal(name: string, precision?: number, scale?: number): ColumnBuilder<number>;
	/** Text of at most `length` characters: `VARCHAR(length)`. */
	export function varchar(length: number): ColumnBuilder<string>;
	export function varchar(name: string, length: number): ColumnBuilder<string>;
	/** Text of any length: `TEXT`. */
	export function text(name?: string): ColumnBuilder<string>;
	/** `true` or `false`: `BOOLEAN`. */
	export function boolean(name?: string): ColumnBuilder<boolean>;
	/** A date and time as the database writes it, `"2026-10-12 18:30:00"`: `DATETIME`. */
	export function datetime(name?: string): ColumnBuilder<string>;
	/** A value of `T` kept as JSON: `JSON`. */
	export function json<T>(name?: string): ColumnBuilder<T>;

	/** A unique key of several columns, for `table`'s third argument: `unique().on(t.steamId, t.map)`. */
	export function unique(name?: string): KeyBuilder;
	/** An index of several columns, for `table`'s third argument: `index().on(t.map, t.time)`. */
	export function index(name?: string): KeyBuilder;
}

declare module "./database" {
	interface Database {
		/** Starts a query of rows: `db.select().from(records)`, every column. */
		// oxlint-disable-next-line typescript/method-signature-style -- an overload, merged into the class's method
		select(): SelectBuilder;
		/** Starts a query of chosen columns and aggregates, by the names the row gives them: `db.select({ map: records.map, runs: count() })`. */
		// oxlint-disable-next-line typescript/method-signature-style -- an overload, merged into the class's method
		select<S extends Fields>(fields: S): SelectFieldsBuilder<FieldsRow<S>>;
	}

	interface Transaction {
		/** Starts a query of rows: `tx.select().from(records)`, every column. */
		// oxlint-disable-next-line typescript/method-signature-style -- an overload, merged into the class's method
		select(): SelectBuilder;
		/** Starts a query of chosen columns and aggregates, by the names the row gives them. */
		// oxlint-disable-next-line typescript/method-signature-style -- an overload, merged into the class's method
		select<S extends Fields>(fields: S): SelectFieldsBuilder<FieldsRow<S>>;
	}
}
