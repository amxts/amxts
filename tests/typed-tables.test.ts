/**
 * The build's half of `table(...)` (scripts/typed-tables.ts): what it writes
 * in place of a table and of `select({ ... })`, and what it stops on.
 * tests/database-builder.test.ts runs what it writes.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { DATABASE_ENTRY, snakeCase, typedTables } from '../scripts/typed-tables';

const noImports = () => null;

function typed(source: string) {
	return typedTables('/plugin.ts', 'plugin.ts', source, noImports);
}

const head = `import { table, int, varchar, double, eq } from "${DATABASE_ENTRY}";\n`;

describe('typed tables', () => {
	test('a column is named in snake case', () => {
		expect(['steamId', 'map', 'mapID', 'HTTPCode', 'time2Best'].map(snakeCase)).toEqual(['steam_id', 'map', 'map_id', 'http_code', 'time2_best']);
	});

	test('a table becomes its class in place, its lines kept, and the editor\'s names leave the import', () => {
		const source = `${head}export const records = table("records", {\n\tid: int().primaryKey().autoincrement(),\n\tsteamId: varchar(32).notNull(),\n});\ntype Row = typeof records.$inferSelect;\nconst x = eq(records.id, 1);\n`;
		const { text, problems } = typed(source);
		expect(problems).toEqual([]);
		const lines = text.split('\n');
		expect(lines[0]).toBe(`import { eq }${' '.repeat(lines[0].indexOf(' from') - 'import { eq }'.length)} from "${DATABASE_ENTRY}";`);
		expect(lines[1]).toBe('export const records = new __AmxtsTable_records()');
		expect(lines[4]).toBe(';');
		expect(lines[5]).toBe(`type Row = ${'__AmxtsRow_records'.padEnd('typeof records.$inferSelect'.length)};`);
		expect(text).toContain('export class __AmxtsRow_records {');
		expect(text).toContain('new __amxtsSql.Column<string>("steam_id", 4, 1, 32, 0, null)');
		expect(text).toContain(`import * as __amxtsSql from "${DATABASE_ENTRY}";`);
	});

	test('a file that does not use the builder is left as it is', () => {
		const source = 'const rows = [1, 2];\nconsole.log(rows.length);\n';
		expect(typed(source)).toEqual({ text: source, problems: [] });
	});

	test('what cannot be read stops the build at its place, with what to write', () => {
		const { problems } = typed(`${head}const a = table("a", {\n\tname: varchar().notNull(),\n\ttime: double().autoincrement(),\n});\n`);
		expect(problems).toEqual(['plugin.ts:3:8: table - name - the length is missing: varchar(32)']);
		expect(typed(`${head}const a = table("a", { time: double().autoincrement() });\n`).problems)
			.toEqual(['plugin.ts:2:30: table - time - autoincrement is of int() and bigint()']);
		expect(typed(`${head}const columns = {};\nconst a = table("a", columns);\n`).problems)
			.toEqual(['plugin.ts:3:11: table - the columns are an object written out: table("records", { id: int().primaryKey(), ... })']);
	});

	test('select takes columns of a table and aggregates', () => {
		const source = `${head}const a = table("a", { id: int().notNull() });\nconst rows = db.select({ id: a.id, other: 5 });\n`;
		expect(typed(source).problems).toEqual(['plugin.ts:3:24: select - select takes columns of a table and aggregates: { time: records.time, runs: count() }']);
	});
});
