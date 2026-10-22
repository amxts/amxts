import type { FakeServer } from '@amxts/core/test-utils';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugin } from '@amxts/core/test-utils';
import binaryen from 'binaryen';
// The query builder (as/sql.ts) on the fake server: tests/as/database-builder.ts
// against server.database(url), which keeps the SQL and the values each
// statement was sent with.
import { beforeAll, describe, expect, test } from 'vitest';
import { compileWasmFile } from '../src/testing/compile';

const URL = 'mysql://kz:secret@127.0.0.1:3306/kz';

let server: FakeServer;

beforeAll(async () => {
	server = await loadPlugin('tests/as/database-builder.ts', { env: { TEST_DB: URL } });
});

/** Runs a command and lets its queries come back; the lines it logged. */
async function run(command: string): Promise<string[]> {
	const from = server.logLines.length;
	server.serverCommand(command);
	await server.responses();
	return server.logLines.slice(from);
}

/** The statements sent since `from`: their SQL and values. */
function sent(from: number) {
	return server.database(URL).queries.slice(from).map(query => [query.sql, query.params]);
}

describe('query builder', () => {
	test('select every column, read into the row by the schema', async () => {
		const from = server.database(URL).queries.length;
		// Cyrillic on purpose: the rows cross as UTF-8.
		server.database(URL).answer(/^SELECT `id`/, [
			{ id: 1, steam_id: 'STEAM_0:1:2', map: 'kz_a', time: 61.5, bonus: null, checkpoints: 3, vip: 1, Nick: 'Ёжик', settings: '{"sound":true}', big: '9007199254740993' },
			{ id: 2, steam_id: 'STEAM_0:1:3', map: 'kz_a', time: 62, bonus: 4, checkpoints: 0, vip: null, Nick: null, settings: null, big: null },
		]);
		// Cyrillic on purpose: and back.
		expect(await run('b_select')).toEqual([
			'select 1 STEAM_0:1:2 kz_a 61.5 null true 3 true false Ёжик true 9007199254740993',
			'select 2 STEAM_0:1:3 kz_a 62 4 false 0 null true null none null',
		]);
		expect(sent(from)).toEqual([[
			'SELECT `id`, `steam_id`, `map`, `time`, `bonus`, `checkpoints`, `vip`, `Nick`, `settings`, CAST(`big` AS CHAR) AS `big` FROM `records` WHERE `map` = ? ORDER BY `time` ASC LIMIT ?',
			['kz_a', 10],
		]]);
	});

	test('chosen columns and aggregates, grouped and ordered, read by their names', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^SELECT `map` AS/, [{ map: 'kz_a', runs: 3, best: 61.5 }, { map: 'kz_b', runs: 0, best: null }]);
		expect(await run('b_fields')).toEqual(['fields kz_a 3 61.5 false', 'fields kz_b 0 null true']);
		expect(sent(from)).toEqual([[
			'SELECT `map` AS `map`, COUNT(*) AS `runs`, MAX(`time`) AS `best` FROM `records` WHERE `time` > ? GROUP BY `map` ORDER BY COUNT(*) DESC LIMIT 18446744073709551615 OFFSET ?',
			[10, 5],
		]]);
	});

	test('an insert writes the columns given; one left out keeps its default', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^INSERT INTO `records`/, { insertId: 42, affectedRows: 1 });
		expect(await run('b_insert')).toEqual(['insert 42']);
		expect(sent(from)).toEqual([['INSERT INTO `records` (`steam_id`, `map`, `time`) VALUES (?, ?, ?)', ['STEAM_0:1:2', 'kz_a', 61.5]]]);
	});

	test('rows of an insert of several: a column one of them gives, DEFAULT in the rest; null is NULL', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^INSERT INTO `records`/, { insertId: 43, affectedRows: 2 });
		expect(await run('b_insert_many')).toEqual(['many 2']);
		// Cyrillic on purpose: the values cross as UTF-8.
		expect(sent(from)).toEqual([[
			'INSERT INTO `records` (`steam_id`, `map`, `time`, `bonus`, `vip`, `Nick`, `settings`) VALUES (?, ?, ?, DEFAULT, ?, ?, DEFAULT), (?, ?, ?, ?, DEFAULT, DEFAULT, ?)',
			['STEAM_0:1:3', 'kz_b', 70, true, 'Ёжик', 'STEAM_0:1:4', 'kz_b', 71, null, '{"sound":true}'],
		]]);
	});

	test('an upsert: ON DUPLICATE KEY UPDATE with the values to set, or the key set to itself', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^INSERT INTO `records`/, { insertId: 0, affectedRows: 2 });
		expect(await run('b_upsert')).toEqual(['upsert']);
		expect(sent(from)).toEqual([
			['INSERT INTO `records` (`steam_id`, `map`, `time`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `time` = ?, `bonus` = ?', ['STEAM_0:1:2', 'kz_a', 59, 59, null]],
			['INSERT INTO `records` (`steam_id`, `map`, `time`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `id` = `id`', ['STEAM_0:1:2', 'kz_a', 59]],
		]);
	});

	test('an update sets the columns named, null as NULL, and only them', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^UPDATE `records`/, { affectedRows: 1 });
		expect(await run('b_update')).toEqual(['update 1']);
		expect(sent(from)).toEqual([[
			'UPDATE `records` SET `time` = ?, `vip` = ?, `Nick` = ?, `big` = ? WHERE (`steam_id` = ? AND `map` = ?)',
			[58.25, false, null, '9007199254740993', 'STEAM_0:1:2', 'kz_a'],
		]]);
	});

	test('a delete under every kind of condition', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^DELETE FROM `records`/, { affectedRows: 4 });
		expect(await run('b_delete')).toEqual(['delete 4']);
		expect(sent(from)).toEqual([[
			'DELETE FROM `records` WHERE ((`map` LIKE ? AND NOT (`id` IN (?, ?, ?))) OR `time` BETWEEN ? AND ? OR `bonus` IS NULL OR (`Nick` IS NOT NULL AND `checkpoints` <> `bonus` AND `time` < `bonus`) OR 1 = 0)',
			['kz_%', 1, 2, 3, 1, 2],
		]]);
	});

	test('create: the table, its columns as MySQL types them and its keys', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^CREATE TABLE/, { affectedRows: 0 });
		expect(await run('b_create')).toEqual(['created']);
		expect(sent(from)).toEqual([[
			'CREATE TABLE IF NOT EXISTS `records` (`id` INT AUTO_INCREMENT NOT NULL, `steam_id` VARCHAR(32) NOT NULL, `map` VARCHAR(64) NOT NULL, `time` DOUBLE NOT NULL, `bonus` INT, `checkpoints` INT NOT NULL DEFAULT 0, `vip` BOOLEAN, `Nick` TEXT, `settings` JSON, `big` BIGINT, PRIMARY KEY (`id`), UNIQUE KEY `records_steam_id_map_unique` (`steam_id`, `map`))',
			[],
		]]);
	});

	test('bytes: binary columns created, written and read as Uint8Array', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^CREATE TABLE IF NOT EXISTS `recordings`/, { affectedRows: 0 });
		server.database(URL).answer(/^INSERT INTO `recordings`/, { insertId: 0, affectedRows: 1 });
		const hash = new Uint8Array(32).fill(255);
		server.database(URL).answer(/^SELECT .* FROM `recordings`/, [{ id: 1, frames: new Uint8Array([0, 1, 255]), thumb: null, icon: null, hash, tag: null }]);
		expect(await run('b_bytes')).toEqual(['bytes 0,1,255 true 32 true']);
		const queries = sent(from);
		expect(queries[0]).toEqual([
			'CREATE TABLE IF NOT EXISTS `recordings` (`id` INT NOT NULL, `frames` LONGBLOB NOT NULL, `thumb` MEDIUMBLOB, `icon` BLOB, `hash` BINARY(32) NOT NULL, `tag` VARBINARY(16), PRIMARY KEY (`id`))',
			[],
		]);
		expect(queries[1][1]).toEqual([1, new Uint8Array([0, 1, 255]), hash]);
		expect(queries[2][1]).toEqual([hash]);
	});

	test('a transaction: the builder on tx, committed', async () => {
		const db = server.database(URL);
		db.answer(/^INSERT INTO `records`/, { insertId: 9, affectedRows: 1 }).answer(/^SELECT COUNT/, [{ runs: 1 }]);
		expect(await run('b_transaction')).toEqual(['transaction 1']);
		const last = db.transactions.at(-1)!;
		expect(last.committed).toBe(true);
		expect(last.queries.map(query => query.sql)).toEqual([
			'INSERT INTO `records` (`steam_id`, `map`, `time`) VALUES (?, ?, ?)',
			'SELECT COUNT(*) AS `runs` FROM `records` WHERE `map` = ?',
		]);
	});

	test('a query is sent when awaited - in Promise.all too - and never when it is not', async () => {
		const from = server.database(URL).queries.length;
		server.database(URL).answer(/^SELECT COUNT/, [{ runs: 5 }]).answer(/^UPDATE `records`/, { affectedRows: 1 });
		expect(await run('b_lazy')).toEqual(['lazy 5 1 true']);
		expect(sent(from)).toEqual([
			['SELECT COUNT(*) AS `runs` FROM `records`', []],
			['UPDATE `records` SET `checkpoints` = ? WHERE `id` = ?', [3, 1]],
		]);
	});

	test('an update that sets nothing rejects with what is wrong', async () => {
		expect(await run('b_error')).toEqual(['error DatabaseError an update of records that sets no column']);
	});

	test('a provider\'s own dialect writes the statements: its names and numbered values; what it lacks rejects', async () => {
		expect(await run('b_dialect')).toEqual([
			'pg SELECT "id", "steam_id", "map", "time", "bonus", "checkpoints", "vip", "Nick", "settings", CAST("big" AS TEXT) AS "big" FROM "records" WHERE "map" = $1 LIMIT $2 ["kz_a",1]',
			'pg INSERT INTO "records" ("steam_id", "map", "time") VALUES ($1, $2, $3) ON CONFLICT ("id") DO UPDATE SET "time" = $4 ["a","b",1,2]',
			'pg postgres has no column types: create the table with db.execute',
		]);
	});
});

test('a plugin that does not use the builder compiles none of it', async () => {
	const wasm = join(tmpdir(), 'amxts-database-raw.wasm');
	expect(await compileWasmFile({ source: 'tests/as/database.ts', root: 'as' }, wasm, true)).toBeNull();
	const module = binaryen.readBinary(readFileSync(wasm));
	try {
		const functions = [...module.emitText().matchAll(/\(func \$([^\s(]+)/g)].map(match => match[1]);
		console.log(functions.filter(name => /atabase|sql/i.test(name)).join(' | '));
		expect(functions.some(name => name.includes('database/Database'))).toBe(true);
		expect(functions.filter(name => /sql\//.test(name))).toEqual([]);
	} finally {
		module.dispose();
	}
});
