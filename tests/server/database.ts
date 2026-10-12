// Database on a real server: the module's MySQL client - a thread a
// connection, the promise settled on a frame - against the runner's MySQL and
// MariaDB (tests/database-servers.ts). MySQL signs in with
// caching_sha2_password: first without TLS, the full way through the
// server's RSA key, then over TLS from its cache; MariaDB with
// mysql_native_password. The runner gives both addresses:
// amxts_test_database <mysql> <mariadb>.
import { Checks } from "@amxts/core/check";

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

async function count(db: Database): Promise<number> {
	const rows = await db.query<Counted>("SELECT COUNT(*) AS count FROM amxts_runs");
	return rows[0].count;
}

async function check(checks: Checks, label: string, url: string) {
	const db = new Database(url);
	await db.execute("DROP TABLE IF EXISTS amxts_runs");
	await db.execute(
		"CREATE TABLE amxts_runs (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(64) NOT NULL UNIQUE, time DOUBLE NOT NULL, "
		+ "finished TINYINT(1) NOT NULL, price DECIMAL(10,3) NOT NULL, born DATETIME NULL) CHARACTER SET utf8mb4",
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
		+ "DATE('2026-10-12') AS day, CAST('-27:05:01' AS TIME) AS clock, b'101' AS bits, NULL AS missing FROM amxts_runs WHERE id = ?",
		[1],
	);
	const t = typed[0];
	checks.expect(`${t.small} ${t.big} ${t.single} ${t.day} ${t.clock} ${t.bits} ${t.missing}`, `${label}: column types`)
		.toBe("-5 9007199254740991 1.5 2026-10-12 -27:05:01 5 null");

	// Sent at once, they run in order on the one connection.
	const sent: Promise<ExecuteResult>[] = [];
	for (let i = 0; i < 5; i++) sent.push(db.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", [`run ${i}`, i, false, 0]));
	const ids = (await Promise.all(sent)).map(result => result.insertId);
	checks.expect(ids.join(","), `${label}: queries in the order sent`).toBe("2,3,4,5,6");

	const committed = await db.transaction(async (tx) => {
		const { insertId } = await tx.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", ["kept", 1, true, 0]);
		await tx.execute("UPDATE amxts_runs SET time = time + 1 WHERE id = ?", [insertId]);
		return insertId;
	});
	checks.expect(`${committed} ${await count(db)}`, `${label}: a transaction committed`).toBe("7 7");

	let thrown = "none";
	try {
		await db.transaction(async (tx) => {
			await tx.execute("INSERT INTO amxts_runs (name, time, finished, price) VALUES (?, ?, ?, ?)", ["dropped", 1, true, 0]);
			throw new Error("changed my mind");
		});
	} catch (error) {
		thrown = error.message;
	}
	checks.expect(`${thrown} ${await count(db)}`, `${label}: a transaction rolled back`).toBe("changed my mind 7");

	// The connection killed under it: that query fails, the next opens it again.
	checks.expect(await failure(db.execute("KILL CONNECTION_ID()")) != "none", `${label}: a lost connection fails the query`).toBe(true);
	checks.expect(await count(db), `${label}: the next query connects again`).toBe(7);

	const wrong = new Database(url.replace(":secret@", ":wrong@"));
	checks.expect(await code(wrong.execute("SELECT 1")), `${label}: a wrong password`).toBe("1045 28000");
}

async function run(mysql: string, mariadb: string) {
	const checks = new Checks("database");
	checks.expect(mysql.length > 0 && mariadb.length > 0, "the runner's MySQL and MariaDB (Docker is needed)").toBe(true);
	if (mysql.length == 0 || mariadb.length == 0) {
		checks.done();
		return;
	}

	// First without TLS: the user's first sign-in is the full one, the password encrypted with the server's RSA key.
	await check(checks, "MySQL without TLS", `${mysql}?ssl-mode=disabled`);
	await check(checks, "MySQL over TLS", `${mysql}?ssl-mode=required`);
	await check(checks, "MariaDB", mariadb);

	const offline = new Database("mysql://amxts:secret@127.0.0.1:1/amxts");
	checks.expect((await failure(offline.execute("SELECT 1"))).startsWith("0  could not connect to 127.0.0.1:1"), "no server").toBe(true);
	checks.expect(await failure(new Database("sqlite://runs.db").execute("SELECT 1")), "a scheme without a provider")
		.toBe("0  no database provider for sqlite://; there are: mysql");

	checks.done();
}
