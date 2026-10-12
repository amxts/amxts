import type { FakeServer } from '@amxts/core/test-utils';
import { loadPlugin } from '@amxts/core/test-utils';
// Database (as/database.ts) on the fake server, which answers the module's
// MySQL client from what the test sets up (src/testing/database.ts):
// tests/as/database.ts against server.database(url).
// @ts-ignore - bun:test types not available during type checking
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const URL = 'mysql://kz:secret@127.0.0.1:3306/kz';

let server: FakeServer;

beforeAll(async () => {
	server = await loadPlugin('tests/as/database.ts', { env: { TEST_DB: URL } });
});

/** Runs a command and lets its queries come back; the lines it logged. */
async function run(command: string): Promise<string[]> {
	const from = server.logLines.length;
	server.serverCommand(command);
	await server.responses();
	return server.logLines.slice(from);
}

describe('Database', () => {
	test('a query reads its rows into an interface; a field the row lacks stays undefined', async () => {
		// Cyrillic on purpose: the rows cross as UTF-8.
		server.database(URL).answer('SELECT name, time FROM records WHERE map = ?  ORDER BY time LIMIT 10', [{ name: 'Ёжик', time: 61.25, extra: 1 }]);
		expect(await run('db_query')).toEqual(['query 1 Ёжик 61.25 undefined']);
		expect(server.database(URL).queries.at(-1)).toEqual({ sql: 'SELECT name, time FROM records WHERE map = ? ORDER BY time LIMIT 10', params: ['de_dust2'], transaction: 0 });
	});

	test('an execute gives the inserted id and the rows changed', async () => {
		server.database(URL).answer(/^INSERT INTO records/, { insertId: 42, affectedRows: 1 });
		expect(await run('db_execute')).toEqual(['execute 42 1']);
	});

	test('values of every kind, in an array of mixed types', async () => {
		let given: unknown[] = [];
		server.database(URL).answer(/^UPDATE records/, (params) => {
			given = params;
			return { affectedRows: 1 };
		});
		expect(await run('db_values')).toEqual(['values sent']);
		expect(given).toEqual(['text', 1.5, 2, true, null, false]);
	});

	test('a refused statement rejects with a DatabaseError of its code and SQLSTATE', async () => {
		server.database(URL).fail(/^INSERT INTO records \(name\)/, { code: 1062, sqlState: '23000', message: 'Duplicate entry \'taken\' for key \'name\'' });
		expect(await run('db_error')).toEqual(['error DatabaseError 1062 23000 Duplicate entry \'taken\' for key \'name\'']);
	});

	test('a row without a field the interface requires is a TypeError naming it', async () => {
		server.database(URL).answer('SELECT name FROM records', [{ name: 'a' }]);
		expect(await run('db_missing')).toEqual(['missing TypeError JSON: [0].rank is missing, a number was expected']);
	});

	test('a transaction commits what it sent when it returns', async () => {
		const db = server.database(URL);
		db.answer(/^INSERT INTO runs/, { insertId: 9, affectedRows: 1 }).answer(/^UPDATE stats/, { affectedRows: 1 });
		expect(await run('db_commit')).toEqual(['commit 9']);
		const last = db.transactions.at(-1)!;
		expect(last.committed).toBe(true);
		expect(last.queries.map(q => q.sql)).toEqual(['INSERT INTO runs (name) VALUES (?)', 'UPDATE stats SET runs = runs + 1']);
	});

	test('a transaction rolls back when it throws, and the error goes on', async () => {
		const db = server.database(URL);
		expect(await run('db_rollback')).toEqual(['rollback changed my mind']);
		expect(db.transactions.at(-1)!.committed).toBe(false);
	});

	test('a provider the plugin registers; a scheme nobody registered', async () => {
		expect(await run('db_provider')).toEqual([
			'provider memory://here 4 ["a",1,true,null]',
			'unknown no database provider for nothing://; there are: mysql, memory',
		]);
	});

	test('a query nothing answers stops the test with its SQL', async () => {
		const fresh = await loadPlugin('tests/as/database.ts', { env: { TEST_DB: 'mysql://other@127.0.0.1/other' } });
		fresh.database('mysql://other@127.0.0.1/other');
		fresh.serverCommand('db_execute');
		await expect(fresh.responses()).rejects.toThrow('no answer for the query "INSERT INTO records (name, time) VALUES (?, ?)"');
	});
});
