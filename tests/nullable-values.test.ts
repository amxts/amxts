/**
 * `number | null` and `boolean | null` - a value that may be null, as a
 * database row's column is: `=== null` and `=== undefined` tell null from
 * undefined, `== null` and `??` take either, and null prints and goes to and
 * from JSON as null. At the default optimization and at -O3.
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

		test('fields read from JSON: null is null, not undefined, and written back as null', async () => {
			expect(await run(`
class Row {
	bonus: number | null = null;
	active: boolean | null = null;
}
export function text(): string {
	const rows = JSON.parse<Row[]>('[{"bonus":2.5,"active":true},{"bonus":null,"active":null}]');
	const given = rows[0], empty = rows[1];
	return [
		\`\${given.bonus} \${given.bonus === null} \${given.active === null} \${given.active}\`,
		\`\${empty.bonus} \${empty.bonus === null} \${empty.bonus === undefined} \${empty.bonus == undefined} \${empty.active === null}\`,
		JSON.stringify(rows),
	].join(" | ");
}
`)).toBe('2.5 false false true | null true false true true | [{"bonus":2.5,"active":true},{"bonus":null,"active":null}]');
		});

		test('a variable, a parameter, a return and an object literal', async () => {
			expect(await run(`
function plusOne(value: number | null): number | null {
	return value === null ? null : value + 1;
}
export function text(): string {
	let value: number | null = null;
	const before = plusOne(value);
	value = 3;
	const shape: { time: number | null } = { time: null };
	let flag: boolean | null = null;
	const unset = flag === null;
	flag = false;
	return \`\${before} \${plusOne(value)} \${shape.time} \${shape.time !== null} \${(shape.time ?? 7) + 1} \${unset} \${flag === null} \${flag}\`;
}
`)).toBe('null 4 null false 8 true false false');
		});

		test('an optional number stays undefined, not null', async () => {
			expect(await run(`
class Options {
	time?: number;
}
export function text(): string {
	const options = new Options();
	return \`\${options.time} \${options.time === undefined} \${options.time === null} \${options.time == null} \${options.time ?? 4}\`;
}
`)).toBe('undefined true false true 4');
		});
	});
}

test('a boolean | null parameter or return type says what to write', async () => {
	const { error } = await probe({ 'probe.ts': `
function read(flag: boolean | null): boolean | null {
	return flag;
}
export function text(): string {
	return \`\${read(null)}\`;
}
` });
	expect(error).toContain('a boolean | null parameter - pass the object that holds it, or a number | null');
	expect(error).toContain('a boolean | null return type - return the object that holds it, or a number | null');
});
