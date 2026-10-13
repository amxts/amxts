// The module's database client (runtime/src/database.h) on the fake server:
// the db_* externals as/database.ts declares, answered from what the test
// says - `server.database(url).answer(sql, rows)` - with no database running.
// A query nothing answers stops the test with its SQL, as a native the fake
// server does not answer does.
//
// What a query gives waits until the test lets the server's frames run
// (`await server.responses()`), and is handed to the plugin's callback then,
// as the module hands it over on a frame - never inside the call that sent it.
import type { FakeServer, PluginInstance } from './server';

// db_query's kinds and db_text's texts: DB_* in runtime/src/database.h.
const KIND_QUERY = 0;
const KIND_EXECUTE = 1;
const KIND_BEGIN = 2;
const KIND_COMMIT = 3;
const KIND_ROLLBACK = 4;
const TEXT_STATE = 1;
const CLIENT_ERROR = -1;

const SHAPE_NARROW = 0;

/** A value of a query's `?`, as the plugin gave it. */
export type DatabaseValue = string | number | boolean | Uint8Array | null;

/** A row a query gives: its columns by name - a `Uint8Array` is a BLOB's, `BINARY`'s or `VARBINARY`'s bytes. */
export type DatabaseRow = Record<string, DatabaseValue>;

/** What an `execute` gives; a field left out is `0`. */
export interface DatabaseExecuted {
	insertId?: number;
	affectedRows?: number;
}

/** What a statement answers: rows for a query, the counts for an execute - or a function of the values that gives one. */
export type DatabaseAnswer = DatabaseRow[] | DatabaseExecuted | ((params: DatabaseValue[]) => DatabaseRow[] | DatabaseExecuted);

/** How a statement fails, as the server refuses one: `{ code: 1062, message: "Duplicate entry ..." }`. A failure without `code` is a lost connection. */
export interface DatabaseFailure {
	code?: number;
	sqlState?: string;
	message: string;
}

/** A query a plugin sent: its SQL, its values and the transaction it ran in (`0` for none). */
export interface SentQuery {
	sql: string;
	params: DatabaseValue[];
	transaction: number;
}

/** A transaction a plugin ran: what it sent, and how it ended - `null` while it runs. */
export interface SentTransaction {
	id: number;
	queries: SentQuery[];
	committed: boolean | null;
}

interface Rule {
	sql: string | RegExp;
	answer: DatabaseAnswer | null;
	failure: DatabaseFailure | null;
}

/** SQL compared as written, but for its spacing. */
function normalize(sql: string): string {
	return sql.trim().replace(/\s+/g, ' ');
}

/** The database at an address, as a test sets it up and reads what the plugins sent it. */
export class FakeDatabase {
	/** Every query the plugins sent, in order. */
	readonly queries: SentQuery[] = [];
	/** Every transaction the plugins ran, in order. */
	readonly transactions: SentTransaction[] = [];
	private readonly rules: Rule[] = [];

	/**
	 * Answers a statement - its SQL as written, spacing aside, or a pattern -
	 * with rows, with an execute's counts, or with a function of its values.
	 * The answer given last for a statement is the one used.
	 */
	answer(sql: string | RegExp, answer: DatabaseAnswer): this {
		this.rules.unshift({ sql, answer, failure: null });
		return this;
	}

	/** Makes a statement fail as the server would refuse it. */
	fail(sql: string | RegExp, failure: DatabaseFailure): this {
		this.rules.unshift({ sql, answer: null, failure });
		return this;
	}

	/** What a statement gives: the outcome the plugin reads. @internal */
	run(kind: number, sql: string, params: DatabaseValue[]): { status: number; text: string; state: string } {
		const written = normalize(sql);
		const rule = this.rules.find(r => typeof r.sql === 'string' ? normalize(r.sql) === written : r.sql.test(sql));
		if (!rule) {
			throw new Error(`[amxts] no answer for the query ${JSON.stringify(written)} - give one with server.database(url).answer(sql, rows)`);
		}
		if (rule.failure) {
			const { code = 0, message, sqlState = 'HY000' } = rule.failure;
			return code > 0 ? { status: code, text: message, state: sqlState } : { status: CLIENT_ERROR, text: message, state: '' };
		}
		const answer = typeof rule.answer === 'function' ? rule.answer(params) : rule.answer!;
		if (kind === KIND_EXECUTE) {
			const counts = Array.isArray(answer) ? {} : answer;
			return { status: 0, text: JSON.stringify({ insertId: counts.insertId ?? 0, affectedRows: counts.affectedRows ?? 0 }), state: '' };
		}
		return { status: 0, text: JSON.stringify(Array.isArray(answer) ? answer : [], bytesAsBase64), state: '' };
	}
}

/** Bytes in the rows as the module writes them: base64 text, which the plugin reads into a Uint8Array. */
function bytesAsBase64(key: string, value: unknown): unknown {
	return value instanceof Uint8Array ? Buffer.from(value).toString('base64') : value;
}

/** Bytes among a query's values as the plugin sends them, `{"$bytes":"<base64>"}`: a Uint8Array again. */
function bytesOfBase64(key: string, value: unknown): unknown {
	const bytes = value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as { $bytes?: unknown }).$bytes : undefined;
	return typeof bytes === 'string' ? new Uint8Array(Buffer.from(bytes, 'base64')) : value;
}

/** A query a plugin holds, as the module keeps one. */
interface FakeQuery {
	plugin: PluginInstance;
	fn: number;
	status: number;
	text: string;
	state: string;
	ended: boolean;
}

/** The pools plugins opened and the queries they sent: what db_* reach. */
export class FakeDatabases {
	/** The databases a test set up, by address; `''` for every address. */
	readonly byUrl = new Map<string, FakeDatabase>();
	private readonly pools: string[] = [];
	private readonly queries = new Map<number, FakeQuery>();
	private readonly ended: number[] = [];
	/** The transactions that have begun and not ended, by id. */
	private readonly open = new Map<number, SentTransaction>();
	private nextId = 1;

	constructor(private readonly server: FakeServer) {}

	/** The database at `url` - every address when it is left out - made on first use. */
	database(url = ''): FakeDatabase {
		let database = this.byUrl.get(url);
		if (!database) this.byUrl.set(url, database = new FakeDatabase());
		return database;
	}

	/** db_open: the pool's id, the same for one address; 0 for an address that is not mysql://. */
	openPool(url: string): number {
		if (!url.startsWith('mysql://')) return 0;
		const at = this.pools.indexOf(url);
		if (at >= 0) return at + 1;
		this.pools.push(url);
		return this.pools.length;
	}

	/** db_query: the query's outcome is worked out now and handed over on the next frame. */
	query(plugin: PluginInstance, pool: number, tx: number, kind: number, sql: string, paramsJson: string, fn: number): number {
		const url = this.pools[pool - 1];
		if (url === undefined) return 0;
		const id = this.nextId++;
		try {
			this.queries.set(id, { plugin, fn, ...this.outcome(id, url, tx, kind, sql, paramsJson), ended: false });
		} catch (error) {
			// Thrown inside the plugin's async code it would be caught there: it stops the test at server.responses().
			this.problem ??= error as Error;
			this.queries.set(id, { plugin, fn, status: CLIENT_ERROR, text: (error as Error).message, state: '', ended: false });
		}
		this.ended.push(id);
		return id;
	}

	/** What stops the test: a query nothing answered, thrown by server.responses(). @internal */
	problem: Error | null = null;

	/** What a query gives, recording it on its database. */
	private outcome(id: number, url: string, tx: number, kind: number, sql: string, paramsJson: string): { status: number; text: string; state: string } {
		const database = this.byUrl.get(url) ?? this.byUrl.get('');
		if (!database) throw new Error(`[amxts] a plugin queried ${url.replace(/\/\/[^@/]*@/, '//')}, which the test did not set up - server.database(url).answer(sql, rows)`);

		const params = paramsJson ? JSON.parse(paramsJson, bytesOfBase64) as DatabaseValue[] : [];
		let outcome = { status: 0, text: '', state: '' };
		if (kind === KIND_BEGIN) {
			const transaction: SentTransaction = { id, queries: [], committed: null };
			database.transactions.push(transaction);
			this.open.set(id, transaction);
			outcome.text = String(id);
		} else if (kind === KIND_COMMIT || kind === KIND_ROLLBACK) {
			const transaction = this.open.get(tx);
			if (transaction) {
				transaction.committed = kind === KIND_COMMIT;
				this.open.delete(tx);
			} else {
				outcome = { status: CLIENT_ERROR, text: 'the transaction has ended', state: '' };
			}
		} else if (tx !== 0 && !this.open.has(tx)) {
			outcome = { status: CLIENT_ERROR, text: 'the transaction has ended', state: '' };
		} else {
			const sent = { sql, params, transaction: tx };
			database.queries.push(sent);
			this.open.get(tx)?.queries.push(sent);
			outcome = database.run(kind === KIND_QUERY ? KIND_QUERY : KIND_EXECUTE, sql, params);
		}
		return outcome;
	}

	private of(plugin: PluginInstance, id: number): FakeQuery | undefined {
		const query = this.queries.get(id);
		return query && query.plugin === plugin && query.ended ? query : undefined;
	}

	status(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id)?.status ?? CLIENT_ERROR;
	}

	text(plugin: PluginInstance, id: number, what: number, out: number, max: number): number {
		const query = this.of(plugin, id);
		if (!query) return 0;
		const bytes = new TextEncoder().encode(what === TEXT_STATE ? query.state : query.text);
		if (out > 0 && max > 0) plugin.memory.setRaw(out, bytes.subarray(0, Math.min(max, bytes.length)));
		return bytes.length;
	}

	close(plugin: PluginInstance, id: number): void {
		if (this.of(plugin, id)) this.queries.delete(id);
	}

	/** Whether a query has ended and waits for a frame. */
	get busy(): boolean {
		return this.ended.length > 0;
	}

	/** One frame: every query that has ended goes to its callback. */
	frame(): void {
		for (const id of this.ended.splice(0)) {
			const query = this.queries.get(id)!;
			query.ended = true;
			if (query.plugin.unloaded) {
				this.queries.delete(id);
				continue;
			}
			this.server.call({ plugin: query.plugin, fn: query.fn, shape: SHAPE_NARROW }, [id], 0);
		}
	}
}
