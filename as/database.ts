// Database: SQL from a plugin, with the game never waiting on it. The address
// picks the provider by its scheme: `mysql://` is the module's own MySQL
// client (runtime/src/database.h), a thread a connection, whose queries come
// back on a server frame, where __dbDone settles their promises. Another
// provider - a library of its own, or a plugin - registers its scheme with
// Database.register, and is used the same way.
//
//   const db = new Database(env("MYPLUGIN_DB", ""));
//   const top = await db.query<Record>("SELECT name, time FROM records WHERE map = ?", [server.map]);
//   const { insertId } = await db.execute("INSERT INTO records (name, time) VALUES (?, ?)", [player.name, time]);
//
// A provider gives rows as JSON text - a method of an interface cannot be
// generic over the row's type - and Database reads them into `T` with
// JSON.parse, as useFetch reads a response.
//
// The facade exports all of it, so a plugin uses these names without an
// import, as globals.

import "./promise";

// @ts-ignore: decorator
@external("env", "db_open") declare function _open(url: usize, length: i32): i32;
// @ts-ignore: decorator
@external("env", "db_query") declare function _query(pool: i32, tx: i32, kind: i32, sql: usize, sqlLength: i32, params: usize, paramsLength: i32, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "db_status") declare function _status(id: i32): i32;
// @ts-ignore: decorator
@external("env", "db_text") declare function _text(id: i32, what: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "db_close") declare function _close(id: i32): void;

// What a query is, and what db_text reads. Must match DB_* in runtime/src/database.h.
const KIND_QUERY: i32 = 0;
const KIND_EXECUTE: i32 = 1;
const KIND_BEGIN: i32 = 2;
const KIND_COMMIT: i32 = 3;
const KIND_ROLLBACK: i32 = 4;
const TEXT_RESULT: i32 = 0;
const TEXT_STATE: i32 = 1;

/** A value of a query's `?`: text, a number, a boolean or `null`. */
export type DatabaseValue = string | number | boolean | null;

/** The outcome of `execute`: the id the row it inserted got, and how many rows it changed. */
export interface ExecuteResult {
	/** The `AUTO_INCREMENT` id of the row inserted; `0` when there was none. */
	insertId: number;
	/** The number of rows the statement inserted, changed or deleted - for `UPDATE`, the rows it matched. */
	affectedRows: number;
}

/** Why a query failed: the database's message, with its error code and SQLSTATE when the server refused it. */
export class DatabaseError extends Error {
	/** The server's error number, such as `1062` for a duplicate key; `0` when the query did not reach the server. */
	code: number;
	/** The error's SQLSTATE, such as `"23000"`; `""` when the query did not reach the server. */
	sqlState: string;

	constructor(message: string, code: number = 0, sqlState: string = "") {
		super(message);
		this.name = "DatabaseError";
		this.code = code;
		this.sqlState = sqlState;
	}
}

/** The side a query runs on: a connection, or a transaction of one. Rows are JSON text, an array of objects. */
export interface DatabaseQueries {
	/** Runs a statement that reads rows; gives them as JSON text, `[{"name":"a"}]`. */
	query(sql: string, params: DatabaseValue[]): Promise<string>;
	/** Runs a statement that changes rows; gives `{ insertId, affectedRows }`. */
	execute(sql: string, params: DatabaseValue[]): Promise<ExecuteResult>;
}

/** A transaction a provider began: its queries, and how it ends. */
export interface DatabaseTransaction extends DatabaseQueries {
	/** Keeps what the transaction changed. */
	commit(): Promise<void>;
	/** Undoes what the transaction changed. */
	rollback(): Promise<void>;
}

/**
 * A connection a provider gives for an address: what `Database` runs on.
 * Its queries run in the order they are given.
 */
export interface DatabaseConnection extends DatabaseQueries {
	/** Begins a transaction; rejects when the database has none. */
	begin(): Promise<DatabaseTransaction>;
	/** Lets the connection go. */
	close(): void;
}

/** What `query` and `execute` are for both a database and a transaction. */
abstract class __Queries {
	/** @hidden */
	abstract get __queries(): DatabaseQueries;

	/**
	 * Runs a statement that reads rows and gives them as `T`, an interface of
	 * the columns. A column `T` does not name is skipped; a field the row lacks
	 * keeps its default, or is a `TypeError` when it has none. The values of
	 * the statement's `?` are `params`, in order.
	 */
	async query<T>(sql: string, params: DatabaseValue[] = []): Promise<T[]> {
		return JSON.parse<T[]>(await this.__queries.query(sql, params));
	}

	/** Runs a statement that changes rows - `INSERT`, `UPDATE`, `DELETE` - with the values of its `?`. */
	execute(sql: string, params: DatabaseValue[] = []): Promise<ExecuteResult> {
		return this.__queries.execute(sql, params);
	}
}

/** The queries of a transaction: `db.transaction(async (tx) => { await tx.execute(...); })`. */
export class Transaction extends __Queries {
	constructor(private __transaction: DatabaseTransaction) {
		super();
	}

	/** @hidden */
	get __queries(): DatabaseQueries {
		return this.__transaction;
	}
}

/**
 * A database at an address - `mysql://user:password@host:3306/database` -
 * that a plugin sends SQL to. The queries run in the background, in the order
 * sent; each promise settles on a later server frame.
 *
 * ```ts
 * const db = new Database(env("MYPLUGIN_DB", ""));
 * const top = await db.query<Record>("SELECT name, time FROM records WHERE map = ? ORDER BY time LIMIT 10", [server.map]);
 * ```
 */
export class Database extends __Queries {
	private __connection: DatabaseConnection;

	constructor(url: string) {
		super();
		const scheme = __schemeOf(url);
		const connect = __providers.has(scheme) ? __providers.get(scheme) : null;
		this.__connection = connect ? connect(url) : new __NoProvider(scheme);
	}

	/** @hidden */
	get __queries(): DatabaseQueries {
		return this.__connection;
	}

	/**
	 * Runs `fn` in a transaction: what it sends through `tx` is committed when
	 * it returns, and rolled back when it throws - the error goes on to the
	 * caller. A transaction has a connection of its own while it runs.
	 */
	async transaction<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
		const begun = await this.__connection.begin();
		try {
			const result = await fn(new Transaction(begun));
			await begun.commit();
			return result as R;   // the editor types an awaited R as __PromiseValue<R>
		} catch (error) {
			try {
				await begun.rollback();
			} catch (ignored) {
				// The transaction ended already: a COMMIT that failed rolled it back.
			}
			throw error;
		}
	}

	/** Lets the connection go; the provider decides what that means (the module keeps MySQL's for the next map). */
	close(): void {
		this.__connection.close();
	}

	/**
	 * Makes `scheme` (`"sqlite"`) an address a database can have: `connect`
	 * gives the connection for an address of it. A provider's library calls it
	 * when it is imported.
	 */
	static register(scheme: string, connect: (url: string) => DatabaseConnection): void {
		__providers.set(scheme.toLowerCase(), connect);
	}
}

/** The scheme of an address, `mysql` of `mysql://...`, in lower case; `""` without one. */
function __schemeOf(url: string): string {
	const end = url.indexOf("://");
	return end > 0 ? url.substring(0, end).toLowerCase() : "";
}

// @ts-ignore: decorator
@lazy const __providers = __builtInProviders();

/** The providers before any library registers one: the module's MySQL. */
function __builtInProviders(): Map<string, (url: string) => DatabaseConnection> {
	const providers = new Map<string, (url: string) => DatabaseConnection>();
	providers.set("mysql", (url: string): DatabaseConnection => new __MysqlConnection(url));
	return providers;
}

/** The connection of an address whose scheme no provider has: every query fails, saying so. */
class __NoProvider implements DatabaseConnection {
	constructor(public scheme: string) {}

	error(): DatabaseError {
		const known = __providers.keys().join(", ");
		return new DatabaseError(this.scheme.length > 0
			? `no database provider for ${this.scheme}://; there are: ${known}`
			: `the database address has no scheme, such as mysql://`);
	}

	query(sql: string, params: DatabaseValue[]): Promise<string> {
		return Promise.reject<string>(this.error());
	}

	execute(sql: string, params: DatabaseValue[]): Promise<ExecuteResult> {
		return Promise.reject<ExecuteResult>(this.error());
	}

	begin(): Promise<DatabaseTransaction> {
		return Promise.reject<DatabaseTransaction>(this.error());
	}

	close(): void {}
}

// ---------------------------------------------------------------- MySQL

// @ts-ignore: decorator
@lazy const __pending = new Map<i32, Promise<string>>();

/** Sends a query to the module: its promise settles with the result text on the frame it ends. */
function __send(pool: i32, tx: i32, kind: i32, sql: string, params: DatabaseValue[]): Promise<string> {
	if (pool == 0) {
		return Promise.reject<string>(new DatabaseError("the database address is not mysql://user:password@host:port/database, with ?ssl-mode=... at most"));
	}
	const text = String.UTF8.encode(sql);
	const values = String.UTF8.encode(params.length > 0 ? JSON.stringify(params) : "");
	const id = _query(pool, tx, kind, changetype<usize>(text), text.byteLength, changetype<usize>(values), values.byteLength, __dbDone.index);
	if (id == 0) return Promise.reject<string>(new DatabaseError("the database client did not take the query"));
	const promise = __co_promise<string>();
	__pending.set(id, promise);
	return promise;
}

/** A text of an ended query: its result or error message, or its SQLSTATE. */
function __dbText(id: i32, what: i32): string {
	const length = _text(id, what, 0, 0);
	if (length <= 0) return "";
	const bytes = new ArrayBuffer(length);
	_text(id, what, changetype<usize>(bytes), length);
	return String.UTF8.decode(bytes);
}

/** The module calls this on the frame a query has ended. */
function __dbDone(id: i32): void {
	if (!__pending.has(id)) {
		_close(id);
		return;
	}
	const promise = __pending.get(id);
	__pending.delete(id);
	const status = _status(id);
	const text = __dbText(id, TEXT_RESULT);
	const state = status != 0 ? __dbText(id, TEXT_STATE) : "";
	_close(id);
	if (status == 0) __co_resolve(promise, text);
	else __co_reject(promise, new DatabaseError(text, status > 0 ? status : 0, state));
}

/** The module's MySQL client, for a `mysql://` address. */
class __MysqlConnection implements DatabaseConnection {
	pool: i32;

	constructor(url: string) {
		const bytes = String.UTF8.encode(url);
		this.pool = _open(changetype<usize>(bytes), bytes.byteLength);
	}

	query(sql: string, params: DatabaseValue[]): Promise<string> {
		return __send(this.pool, 0, KIND_QUERY, sql, params);
	}

	async execute(sql: string, params: DatabaseValue[]): Promise<ExecuteResult> {
		return JSON.parse<ExecuteResult>(await __send(this.pool, 0, KIND_EXECUTE, sql, params));
	}

	async begin(): Promise<DatabaseTransaction> {
		const id = await __send(this.pool, 0, KIND_BEGIN, "", []);
		return new __MysqlTransaction(this.pool, I32.parseInt(id));
	}

	/** The module keeps the connection for every plugin and the next map. */
	close(): void {}
}

/** A transaction on a connection of its own the module holds for it. */
class __MysqlTransaction implements DatabaseTransaction {
	constructor(public pool: i32, public id: i32) {}

	query(sql: string, params: DatabaseValue[]): Promise<string> {
		return __send(this.pool, this.id, KIND_QUERY, sql, params);
	}

	async execute(sql: string, params: DatabaseValue[]): Promise<ExecuteResult> {
		return JSON.parse<ExecuteResult>(await __send(this.pool, this.id, KIND_EXECUTE, sql, params));
	}

	async commit(): Promise<void> {
		await __send(this.pool, this.id, KIND_COMMIT, "", []);
	}

	async rollback(): Promise<void> {
		await __send(this.pool, this.id, KIND_ROLLBACK, "", []);
	}
}
