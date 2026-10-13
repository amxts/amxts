// The query builder, as a plugin writes it. Each command sends its queries
// and logs what came back; tests/database-builder.test.ts sets the fake
// database up, and compares the SQL and the values the builder wrote.
import {
	and,
	asc,
	between,
	bigint,
	binary,
	blob,
	boolean,
	count,
	desc,
	double,
	eq,
	gt,
	inArray,
	int,
	isNotNull,
	isNull,
	json,
	like,
	longblob,
	lt,
	max,
	mediumblob,
	ne,
	not,
	or,
	SqlDialect,
	table,
	text,
	unique,
	varbinary,
	varchar,
} from "@amxts/core/database";

interface Settings {
	sound: boolean;
}

export const records = table("records", {
	id: int().primaryKey().autoincrement(),
	steamId: varchar(32).notNull(),
	map: varchar(64).notNull(),
	time: double().notNull(),
	bonus: int(),
	checkpoints: int().notNull().default(0),
	vip: boolean(),
	nick: text("Nick"),
	settings: json<Settings>(),
	big: bigint({ mode: "string" }),
}, t => [unique().on(t.steamId, t.map)]);

type Record = typeof records.$inferSelect;

/** A table of bytes: a recording, kept whole. */
const recordings = table("recordings", {
	id: int().primaryKey(),
	frames: longblob().notNull(),
	thumb: mediumblob(),
	icon: blob(),
	hash: binary(32).notNull(),
	tag: varbinary(16),
});

const db = new Database(env("TEST_DB", ""));

function line(row: Record): string {
	return `${row.id} ${row.steamId} ${row.map} ${row.time} ${row.bonus} ${row.bonus === null} ${row.checkpoints} ${row.vip} ${row.vip === null} ${row.nick} ${row.settings ? `${row.settings!.sound}` : "none"} ${row.big}`;
}

server.addServerCommand("b_select", async () => {
	const top = await db.select().from(records).where(eq(records.map, "kz_a")).orderBy(asc(records.time)).limit(10);
	for (const row of top) console.log(`select ${line(row)}`);
});

server.addServerCommand("b_fields", async () => {
	const maps = await db.select({ map: records.map, runs: count(), best: max(records.time) })
		.from(records)
		.where(gt(records.time, 10))
		.groupBy(records.map)
		.orderBy(desc(count()))
		.offset(5);
	for (const row of maps) console.log(`fields ${row.map} ${row.runs} ${row.best} ${row.best === null}`);
});

server.addServerCommand("b_insert", async () => {
	const { insertId } = await db.insert(records).values({ steamId: "STEAM_0:1:2", map: "kz_a", time: 61.5 });
	console.log(`insert ${insertId}`);
});

server.addServerCommand("b_insert_many", async () => {
	// Cyrillic on purpose: the values cross as UTF-8.
	const row: typeof records.$inferInsert = { steamId: "STEAM_0:1:3", map: "kz_b", time: 70, nick: "Ёжик", vip: true };
	const { affectedRows } = await db.insert(records).values([row, { steamId: "STEAM_0:1:4", map: "kz_b", time: 71, bonus: null, settings: { sound: true } }]);
	console.log(`many ${affectedRows}`);
});

server.addServerCommand("b_upsert", async () => {
	await db.insert(records)
		.values({ steamId: "STEAM_0:1:2", map: "kz_a", time: 59 })
		.onConflictDoUpdate({ target: [records.steamId, records.map], set: { time: 59, bonus: null } });
	await db.insert(records).values({ steamId: "STEAM_0:1:2", map: "kz_a", time: 59 }).onConflictDoNothing({ target: records.id });
	console.log("upsert");
});

server.addServerCommand("b_update", async () => {
	const { affectedRows } = await db.update(records)
		.set({ time: 58.25, nick: null, vip: false, big: "9007199254740993" })
		.where(and(eq(records.steamId, "STEAM_0:1:2"), eq(records.map, "kz_a")));
	console.log(`update ${affectedRows}`);
});

server.addServerCommand("b_delete", async () => {
	const { affectedRows } = await db.delete(records).where(or(
		and(like(records.map, "kz_%"), not(inArray(records.id, [1, 2, 3]))),
		between(records.time, 1, 2),
		isNull(records.bonus),
		and(isNotNull(records.nick), ne(records.checkpoints, records.bonus), lt(records.time, records.bonus)),
		inArray(records.map, []),
	));
	console.log(`delete ${affectedRows}`);
});

server.addServerCommand("b_create", async () => {
	await db.create(records);
	console.log("created");
});

server.addServerCommand("b_bytes", async () => {
	await db.create(recordings);
	const hash = new Uint8Array(32).fill(255);
	const frames = new Uint8Array(3);
	frames[1] = 1;
	frames[2] = 255;
	await db.insert(recordings).values({ id: 1, frames, hash });
	const rows = await db.select().from(recordings).where(eq(recordings.hash, hash));
	const row = rows[0];
	console.log(`bytes ${row.frames.join(",")} ${row.thumb == null} ${row.hash.length} ${row.tag == null}`);
});

server.addServerCommand("b_transaction", async () => {
	const runs = await db.transaction(async (tx) => {
		await tx.insert(records).values({ steamId: "STEAM_0:1:5", map: "kz_c", time: 1 });
		const found = await tx.select({ runs: count() }).from(records).where(eq(records.map, "kz_c"));
		return found[0].runs;
	});
	console.log(`transaction ${runs}`);
});

server.addServerCommand("b_lazy", async () => {
	const unsent = db.delete(records).where(eq(records.id, 99));
	const both = await Promise.all([
		db.select({ runs: count() }).from(records),
		db.update(records).set({ checkpoints: 3 }).where(eq(records.id, 1)),
	]);
	console.log(`lazy ${both[0][0].runs} ${both[1].affectedRows} ${unsent != null}`);
});

server.addServerCommand("b_error", async () => {
	try {
		await db.update(records).set({}).where(eq(records.id, 1));
	} catch (error) {
		console.log(`error ${error.name} ${error.message}`);
	}
});

/** A provider of the plugin's own and its dialect: PostgreSQL's names and numbered values. */
class PostgresDialect extends SqlDialect {
	get name(): string {
		return "postgres";
	}

	placeholder(index: number): string {
		return `$${index}`;
	}
}

const postgres = new PostgresDialect();

class LoggingConnection implements DatabaseConnection {
	get dialect(): SqlDialect {
		return postgres;
	}

	query(sql: string, params: DatabaseValue[]): Promise<string> {
		console.log(`pg ${sql} ${JSON.stringify(params)}`);
		return Promise.resolve<string>("[]");
	}

	execute(sql: string, params: DatabaseValue[]): Promise<ExecuteResult> {
		console.log(`pg ${sql} ${JSON.stringify(params)}`);
		return Promise.resolve<ExecuteResult>({ insertId: 0, affectedRows: 1 });
	}

	begin(): Promise<DatabaseTransaction> {
		return Promise.reject<DatabaseTransaction>(new DatabaseError("no transactions here"));
	}

	close(): void {}
}

Database.register("pglog", (): DatabaseConnection => new LoggingConnection());

server.addServerCommand("b_dialect", async () => {
	const pg = new Database("pglog://here");
	await pg.select().from(records).where(eq(records.map, "kz_a")).limit(1);
	await pg.insert(records).values({ steamId: "a", map: "b", time: 1 }).onConflictDoUpdate({ target: records.id, set: { time: 2 } });
	try {
		await pg.create(records);
	} catch (error) {
		console.log(`pg ${error.message}`);
	}
});
