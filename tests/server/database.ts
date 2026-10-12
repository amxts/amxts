// Database on a real server: the module's MySQL client - a thread a
// connection, the promise settled on a frame - against the runner's MySQL and
// MariaDB (tests/database-servers.ts). MySQL signs in with
// caching_sha2_password: first without TLS, the full way through the
// server's RSA key, then over TLS from its cache; MariaDB with
// mysql_native_password. The runner gives both addresses:
// amxts_test_database <mysql> <mariadb>.
import { Checks } from "@amxts/core/check";
import { and, asc, bigint, boolean, count, desc, double, eq, gt, inArray, int, isNull, json, max, table, text, unique, varchar } from "@amxts/core/database";

interface DatabaseArgs {
	mysql?: string;
	mariadb?: string;
}

interface Run {
	id: number;
	name: string;
	time: number;
	finished: number;
	price: number;
	born: string | null;
	note?: string;
}

interface Counted {
	count: number;
}

interface Typed {
	small: number;
	big: number;
	single: number;
	day: string;
	clock: string;
	bits: number;
	missing: string | null;
}

// Cyrillic on purpose: text goes to the server and back as UTF-8.
const NAME = "Ёжик";

server.addServerCommand<DatabaseArgs>("amxts_test_database [mysql] [mariadb]", ({ mysql, mariadb }) => {
	run(mysql ?? "", mariadb ?? "");
});

/** What a failed query says: its code, SQLSTATE and message; `none` when it did not fail. */
async function failure(sent: Promise<ExecuteResult>): Promise<string> {
	try {
		await sent;
		return "none";
	} catch (error) {
		const failed = error as DatabaseError;
		return `${failed.code} ${failed.sqlState} ${failed.message}`;
	}
}

/** A failure's code and SQLSTATE alone. */
async function code(sent: Promise<ExecuteResult>): Promise<string> {
	return (await failure(sent)).split(" ").slice(0, 2).join(" ");
}

interface Connection {
	id: number;
}

async function connectionId(db: Database): Promise<number> {
	return (await db.query<Connection>("SELECT CONNECTION_ID() AS id"))[0].id;
}

function row(rows: Run[]): string {
	const first = rows[0];
	return `${rows.length} ${first.name} ${first.time} ${first.finished} ${first.price} ${first.born} ${first.note}`;
}

async function countRuns(db: Database): Promise<number> {
	const rows = await db.query<Counted>("SELECT COUNT(*) AS count FROM amxts_runs");
	return rows[0].count;
}

async function check(checks: Checks, label: string, url: string) {
	const db = new Database(url);
	await db.execute("DROP TABLE IF EXISTS amxts_runs");
	await db.execute(
		"CREATE TABLE amxts_runs (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL UNIQUE, time DOUBLE NOT NULL, "
		+ "finished TINYINT(1) NOT NULL, price DECIMAL(10,3) NOT NULL, born DATETIME NULL, mask BIT(3) NOT NULL DEFAULT b'101') CHARACTER SET utf8mb4",
	);

	const inserted = await db.execute("INSERT INTO amxts_runs (name, time, finished, price, born) VALUES (?, ?, ?, ?, ?)", [NAME, 61.25, true, 12.5, null]);
	checks.expect(`${inserted.insertId} ${inserted.affectedRows}`, `${label}: an INSERT with values`).toBe("1 1");

	const prepared = await db.query<Run>("SELECT * FROM amxts_runs WHERE name = ?", [NAME]);
	const plain = await db.query<Run>("SELECT * FROM amxts_runs");
	checks.expect(row(prepared), `${label}: a row, with values`).toBe(`1 ${NAME} 61.25 1 12.5 null undefined`);
	checks.expect(row(plain), `${label}: a row, without`).toBe(`1 ${NAME} 61.25 1 12.5 null undefined`);
	const first = await connectionId(db);
	checks.expect(await connectionId(db), `${label}: one connection from query to query`).toBe(first);

	const duplicate = db.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", [NAME, 1, false, 0]);
	checks.expect(await code(duplicate), `${label}: a duplicate key`).toBe("1062 23000");
	checks.expect(await code(db.execute("SELEKT 1")), `${label}: a syntax error`).toBe("1064 42000");

	const typed = await db.query<Typed>(
		"SELECT CAST(-5 AS SIGNED) AS small, CAST(9007199254740991 AS UNSIGNED) AS big, CAST(1.5 AS FLOAT) AS single, "
		+ "DATE('2026-10-12') AS day, CAST('-27:05:01' AS TIME) AS clock, mask AS bits, NULL AS missing FROM amxts_runs WHERE id = ?",
		[1],
	);
	const t = typed[0];
	checks.expect(`${t.small} ${t.big} ${t.single} ${t.day} ${t.clock} ${t.bits} ${t.missing}`, `${label}: column types`)
		.toBe("-5 9007199254740991 1.5 2026-10-12 -27:05:01 5 null");

	// Sent at once, they run in order on the one connection.
	const sent: Promise<ExecuteResult>[] = [];
	for (let i = 0; i < 5; i++) sent.push(db.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", [`run ${i}`, i, false, 0]));
	// A failed INSERT takes an id too, as InnoDB counts: the order is read from the first.
	const ids = (await Promise.all(sent)).map(result => result.insertId);
	checks.expect(ids.map(id => id - ids[0]).join(","), `${label}: queries in the order sent`).toBe("0,1,2,3,4");

	const committed = await db.transaction(async (tx) => {
		const { insertId } = await tx.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", ["kept", 1, true, 0]);
		await tx.execute("UPDATE amxts_runs SET time = time + 1 WHERE id = ?", [insertId]);
		return insertId;
	});
	checks.expect(`${committed > ids[4]} ${await countRuns(db)}`, `${label}: a transaction committed`).toBe("true 7");

	let thrown = "none";
	try {
		await db.transaction(async (tx) => {
			await tx.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", ["dropped", 1, true, 0]);
			throw new Error("changed my mind");
		});
	} catch (error) {
		thrown = error.message;
	}
	checks.expect(`${thrown} ${await countRuns(db)}`, `${label}: a transaction rolled back`).toBe("changed my mind 7");

	// The connection killed under it: that query fails, the next opens it again.
	checks.expect(await failure(db.execute("KILL CONNECTION_ID()")) != "none", `${label}: a lost connection fails the query`).toBe(true);
	checks.expect(await countRuns(db), `${label}: the next query connects again`).toBe(7);

	const wrong = new Database(url.replace(":secret@", ":wrong@"));
	checks.expect(await code(wrong.execute("SELECT 1")), `${label}: a wrong password`).toBe("1045 28000");
}

interface Options {
	sound: boolean;
}

/** The query builder's table: created by `create`, every kind of column. */
const builderRuns = table("amxts_builder_runs", {
	id: int().primaryKey().autoincrement(),
	steamId: varchar(32).notNull(),
	map: varchar(64).notNull(),
	time: double().notNull(),
	bonus: int(),
	vip: boolean().notNull().default(false),
	nick: text("Nick"),
	options: json<Options>(),
	big: bigint({ mode: "string" }),
}, t => [unique().on(t.steamId, t.map)]);

type BuilderRun = typeof builderRuns.$inferSelect;

function builderRow(run: BuilderRun): string {
	return `${run.steamId} ${run.map} ${run.time} ${run.bonus} ${run.vip} ${run.nick} ${run.options ? `${run.options!.sound}` : "none"} ${run.big}`;
}

/** The query builder against the server: create, insert, upsert, select, update, delete, a transaction. */
async function builder(checks: Checks, label: string, url: string) {
	const db = new Database(url);
	await db.execute("DROP TABLE IF EXISTS amxts_builder_runs");
	await db.create(builderRuns);
	await db.create(builderRuns);

	const first = await db.insert(builderRuns).values({ steamId: "STEAM_0:1:1", map: "kz_a", time: 61.5, nick: NAME, options: { sound: true }, big: "9007199254740993" });
	checks.expect(`${first.insertId} ${first.affectedRows}`, `${label}: builder insert`).toBe("1 1");
	const many = await db.insert(builderRuns).values([
		{ steamId: "STEAM_0:1:2", map: "kz_a", time: 70, vip: true },
		{ steamId: "STEAM_0:1:3", map: "kz_b", time: 80, bonus: 2 },
	]);
	checks.expect(many.affectedRows, `${label}: builder insert of rows`).toBe(2);

	const top = await db.select().from(builderRuns).where(eq(builderRuns.map, "kz_a")).orderBy(asc(builderRuns.time));
	checks.expect(top.map(builderRow).join(" | "), `${label}: builder select`)
		.toBe(`STEAM_0:1:1 kz_a 61.5 null false ${NAME} true 9007199254740993 | STEAM_0:1:2 kz_a 70 null true null none null`);

	await db.insert(builderRuns).values({ steamId: "STEAM_0:1:1", map: "kz_a", time: 59 }).onConflictDoUpdate({ target: [builderRuns.steamId, builderRuns.map], set: { time: 59, nick: null } });
	await db.insert(builderRuns).values({ steamId: "STEAM_0:1:2", map: "kz_a", time: 1 }).onConflictDoNothing({ target: [builderRuns.steamId, builderRuns.map] });
	const best = await db.select({ map: builderRuns.map, runs: count(), worst: max(builderRuns.time) })
		.from(builderRuns)
		.where(gt(builderRuns.time, 0))
		.groupBy(builderRuns.map)
		.orderBy(desc(count()));
	checks.expect(best.map(run => `${run.map} ${run.runs} ${run.worst}`).join(" | "), `${label}: builder upsert, aggregates`).toBe("kz_a 2 70 | kz_b 1 80");

	const changed = await db.update(builderRuns).set({ bonus: 5, vip: false }).where(and(eq(builderRuns.map, "kz_a"), isNull(builderRuns.bonus)));
	checks.expect(changed.affectedRows, `${label}: builder update`).toBe(2);
	const kept = await db.transaction(async (tx) => {
		await tx.delete(builderRuns).where(inArray(builderRuns.steamId, ["STEAM_0:1:3"]));
		const left = await tx.select({ runs: count() }).from(builderRuns);
		return left[0].runs;
	});
	const after = await db.select().from(builderRuns).orderBy(builderRuns.id);
	checks.expect(`${kept} ${after.map(builderRow).join(" | ")}`, `${label}: builder delete in a transaction`)
		.toBe("2 STEAM_0:1:1 kz_a 59 5 false null true 9007199254740993 | STEAM_0:1:2 kz_a 70 5 false null none null");
}

/** The checks of one server; an error that escapes them is a failed check, not a suite that never ends. */
async function guarded(checks: Checks, label: string, url: string) {
	try {
		await check(checks, label, url);
		await builder(checks, label, url);
	} catch (error) {
		checks.expect(`${error.name}: ${error.message}`, `${label}: ran to the end`).toBe("no error");
	}
}

async function run(mysql: string, mariadb: string) {
	const checks = new Checks("database");
	checks.expect(mysql.length > 0 && mariadb.length > 0, "the runner's MySQL and MariaDB (Docker is needed)").toBe(true);
	if (mysql.length == 0 || mariadb.length == 0) {
		checks.done();
		return;
	}

	// First without TLS: the user's first sign-in is the full one, the password encrypted with the server's RSA key.
	await guarded(checks, "MySQL without TLS", `${mysql}?ssl-mode=disabled`);
	await guarded(checks, "MySQL over TLS", `${mysql}?ssl-mode=required`);
	await guarded(checks, "MariaDB", mariadb);

	const offline = new Database("mysql://amxts:secret@127.0.0.1:1/amxts");
	checks.expect((await failure(offline.execute("SELECT 1"))).startsWith("0  could not connect to 127.0.0.1:1"), "no server").toBe(true);
	checks.expect(await failure(new Database("sqlite://runs.db").execute("SELECT 1")), "a scheme without a provider")
		.toBe("0  no database provider for sqlite://; there are: mysql");

	checks.done();
}
