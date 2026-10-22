/**
 * `T | T[]` - one, or a list of them, as a query takes its rows: held as the
 * list, one given where it is declared is a list of it.
 */
import { expect, test } from 'vitest';
import { probe } from './probe';

test('a parameter of a method and of a function takes one or a list', async () => {
	const { error, exports, string } = await probe({ 'probe.ts': `
class Row {
	name: string = "";
	time?: number;
}
class Insert<I> {
	count: i32 = 0;

	values(rows: I | I[]): Insert<I> {
		this.count += rows.length;
		return this;
	}
}
function names(rows: Row | Row[]): string {
	return rows.map<string>((row: Row): string => row.name).join(",");
}
export function text(): string {
	const one: Row = { name: "solo" };
	const list: Row[] = [{ name: "a" }, { name: "b", time: 2 }];
	const insert = new Insert<Row>().values({ name: "x" }).values([{ name: "y" }, { name: "z" }]).values(one).values(list);
	return \`\${insert.count} \${names(one)} \${names(list)} \${names({ name: "literal" })}\`;
}
` });
	expect(error).toBe('');
	expect(string(exports.text())).toBe('6 solo a,b literal');
});
