/**
 * A named function goes where a function type with more parameters is
 * expected, as TypeScript allows:
 *
 *   type Source = (viewer: Player, menu: string) => Row[] | null;
 *   function adminRows(viewer: Player) { ... return rows; }   // Row[]
 *   setSource("ADMIN", adminRows);
 *
 * call_indirect needs the exact signature, so the table gets an adapter with
 * the full one that calls the function with the leading arguments. The
 * return is covariant for references, as in TypeScript.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

const SOURCES = `
export class Row { constructor(public id: i32) {} }
type Source = (viewer: i32, menu: string) => Row[] | null;
let source: Source | null = null;
function setSource(rows: Source): void { source = rows; }
function rowsFor(viewer: i32): i32 {
	const rows = source!(viewer, "MENU");
	if (rows == null) return -1;
	let sum = 0;
	for (let i = 0; i < rows.length; i++) sum += rows[i].id;
	return sum;
}
`;

async function compile(body: string, files: Record<string, string> = {}) {
	const { error, exports } = await probe({ 'probe.ts': SOURCES + body, ...files });
	return { error, run: () => (error ? 0 : exports.run() as number) };
}

test('a function with fewer parameters and a narrower return goes in', async () => {
	const { error, run } = await compile(`
function adminRows(viewer: i32) {
	const rows: Row[] = [new Row(viewer), new Row(10)];
	return rows;
}
export function run(): i32 {
	setSource(adminRows);
	return rowsFor(5);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(15);
});

test('a function with fewer parameters and the same return goes in', async () => {
	const { error, run } = await compile(`
function noRows(viewer: i32): Row[] | null { return viewer > 0 ? null : []; }
export function run(): i32 {
	setSource(noRows);
	return rowsFor(1);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(-1);
});

test('a function of a namespace import goes in the same way', async () => {
	const { error, run } = await compile(`
import * as lists from "./lists";
export function run(): i32 {
	setSource(lists.one);
	return rowsFor(7);
}
`, {
		'lists.ts': `
import { Row } from "./probe";
export function one(viewer: i32): Row[] { return [new Row(viewer * 2)]; }
`,
	});
	expect(error).toBe('');
	expect(run()).toBe(14);
});

test('a parameter of another type is still an error', async () => {
	const { error } = await compile(`
function wrong(viewer: string): Row[] { return []; }
export function run(): i32 {
	setSource(wrong);
	return 0;
}
`);
	expect(error).toContain('not assignable');
});
