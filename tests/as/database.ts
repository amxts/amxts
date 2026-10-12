// Database, as a plugin writes it. Each command sends its queries and logs
// what came back; tests/database.test.ts sets the fake database up and reads
// the lines.
import { mysql, SqlDialect } from "@amxts/core/database";

interface Record {
	name: string;
	time: number;
	note?: string;
}

interface Strict {
	name: string;
	rank: number;
}

const db = new Database(env("TEST_DB", ""));

server.addServerCommand("db_query", async () => {
	const top = await db.query<Record>("SELECT name, time FROM records WHERE map = ? ORDER BY time LIMIT 10", ["de_dust2"]);
	console.log(`query ${top.length} ${top[0].name} ${top[0].time} ${top[0].note}`);
});

server.addServerCommand("db_execute", async () => {
	// Cyrillic on purpose: the values cross as UTF-8.
	const { insertId, affectedRows } = await db.execute("INSERT INTO records (name, time) VALUES (?, ?)", ["Ёжик", 61.5]);
	console.log(`execute ${insertId} ${affectedRows}`);
});

server.addServerCommand("db_values", async () => {
	const values: DatabaseValue[] = ["text", 1.5, 2, true, null];
	values.push(false);
	await db.execute("UPDATE records SET a = ?, b = ?, c = ?, d = ?, e = ?, f = ?", values);
	console.log("values sent");
});

server.addServerCommand("db_error", async () => {
	try {
		await db.execute("INSERT INTO records (name) VALUES (?)", ["taken"]);
	} catch (error) {
		const failed = error as DatabaseError;
		console.log(`error ${failed.name} ${failed.code} ${failed.sqlState} ${failed.message}`);
	}
});

server.addServerCommand("db_missing", async () => {
	try {
		await db.query<Strict>("SELECT name FROM records");
	} catch (error) {
		console.log(`missing ${error.name} ${error.message}`);
	}
});

server.addServerCommand("db_commit", async () => {
	const id = await db.transaction(async (tx) => {
		const { insertId } = await tx.execute("INSERT INTO runs (name) VALUES (?)", ["kept"]);
		await tx.execute("UPDATE stats SET runs = runs + 1");
		return insertId;
	});
	console.log(`commit ${id}`);
});

server.addServerCommand("db_rollback", async () => {
	try {
		await db.transaction(async (tx) => {
			await tx.execute("INSERT INTO runs (name) VALUES (?)", ["dropped"]);
			throw new Error("changed my mind");
		});
	} catch (error) {
		console.log(`rollback ${error.message}`);
	}
});

/** A provider of the plugin's own: rows from memory, saying what it was given. */
class MemoryConnection implements DatabaseConnection {
	constructor(public url: string) {}

	get dialect(): SqlDialect {
		return mysql;
	}

	query(sql: string, params: DatabaseValue[]): Promise<string> {
		return Promise.resolve<string>(`[{"name":${JSON.stringify(this.url)},"time":${params.length},"note":${JSON.stringify(JSON.stringify(params))}}]`);
	}

	execute(sql: string, params: DatabaseValue[]): Promise<ExecuteResult> {
		return Promise.resolve<ExecuteResult>({ insertId: 7, affectedRows: params.length });
	}

	begin(): Promise<DatabaseTransaction> {
		return Promise.reject<DatabaseTransaction>(new DatabaseError("memory has no transactions"));
	}

	close(): void {}
}

Database.register("memory", (url: string): DatabaseConnection => new MemoryConnection(url));

server.addServerCommand("db_provider", async () => {
	const memory = new Database("memory://here");
	const rows = await memory.query<Record>("SELECT anything", ["a", 1, true, null]);
	console.log(`provider ${rows[0].name} ${rows[0].time} ${rows[0].note}`);
	try {
		await new Database("nothing://here").execute("SELECT 1");
	} catch (error) {
		console.log(`unknown ${error.message}`);
	}
});
