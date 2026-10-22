/**
 * A union of text, a number and a boolean - `string | number`,
 * `string | number | boolean | null` - as one value: boxed where it goes,
 * read with typeof and `as`, compared, printed and written to and read from
 * JSON as what it holds. At the default optimization and at -O3.
 */
import { describe, expect, test } from 'vitest';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		const run = async (source: string) => {
			const { error, exports, string } = await probe({ 'probe.ts': source }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			return string(exports.text());
		};

		test('a list of mixed values, a pushed one, a parameter: written as JSON', async () => {
			expect(await run(`
type Value = string | number | boolean | null;
function send(params: Value[]): string {
	return JSON.stringify(params);
}
export function text(): string {
	const values: Value[] = ["text", 1.5, 2, true, null];
	values.push(false);
	const name = "hedgehog";
	return JSON.stringify(values) + " " + send([name, 61.25, true, null]);
}
`)).toBe('["text",1.5,2,true,null,false] ["hedgehog",61.25,true,null]');
		});

		test('typeof says what it holds, `as` takes it out', async () => {
			expect(await run(`
function describe(value: string | number | null): string {
	if (typeof value == "string") return "text " + (value as string);
	if (typeof value == "number") return "number " + ((value as number) + 1).toString();
	return typeof value;
}
export function text(): string {
	return describe("a") + "; " + describe(41) + "; " + describe(null);
}
`)).toBe('text a; number 42; object');
		});

		test('compared with what it may hold, and with another; printed', async () => {
			expect(await run(`
export function text(): string {
	const a: string | number = "a";
	const two: string | number | boolean = 2;
	const yes: number | boolean = true;
	return [a == "a", two == 2, two != 3, two === 2, two !== "2", a == two, yes == true].join(",") + " " + \`\${two} \${yes} \${a}\`;
}
`)).toBe('true,true,true,true,true,false,true 2 true a');
		});

		test('a conditional of two kinds where the union goes', async () => {
			expect(await run(`
function pick(ok: boolean): string | number {
	return ok ? 1 : "a";
}
export function text(): string {
	const either: string | number = pick(false) == "a" ? "text" : 2;
	return \`\${pick(true)} \${pick(false)} \${either}\`;
}
`)).toBe('1 a text');
		});

		test('read from JSON into a field', async () => {
			expect(await run(`
class Row {
	value: string | number | null = null;
}
export function text(): string {
	const rows = JSON.parse<Row[]>('[{"value":"a"},{"value":2},{"value":null}]');
	return rows.map<string>((row: Row): string => typeof row.value).join(",") + " " + JSON.stringify(rows);
}
`)).toBe('string,number,object [{"value":"a"},{"value":2},{"value":null}]');
		});

		test('`as` of another kind than it holds throws', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
export function text(): string {
	const value: string | number = "a";
	return (value as number).toString();
}
` }, optimize ? ['-O3'] : [], { abort() { throw new Error('aborted'); } });
			expect(error).toBe('');
			expect(() => exports.text()).toThrow('aborted');
		});
	});
}

test('read where one type is expected without `as`, it says how', async () => {
	const { error } = await probe({ 'probe.ts': `
export function text(): string {
	const value: string | number = "a";
	const read: string = value;
	return read;
}
` });
	expect(error).toContain('a union of string, number and boolean read without saying which: write `value as string`, after a typeof check');
});

test('a boolean among string literals keeps its own meaning', async () => {
	const { error, exports, string } = await probe({ 'probe.ts': `
export function text(): string {
	const mode: boolean | "default" = true;
	return mode == "true" ? "text" : "box";
}
` });
	expect(error).toBe('');
	expect(string(exports.text())).toBe('text');
});
