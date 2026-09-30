/**
 * `a ?? b` and `a ??= b` as in TypeScript: the right side is taken only
 * when the left is null (not when it is "" or 0), is evaluated only then,
 * and the result has no null unless the right side can be null.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

const FIND = `
function find(key: string): string | null {
	if (key == "a") return "found";
	if (key == "empty") return "";
	return null;
}
`;

async function compile(body: string) {
	const { error, exports } = await probe({ 'probe.ts': FIND + body });
	return { error, run: () => (error ? 0 : exports.run() as number) };
}

test('the right side is taken only when the left is null', async () => {
	const { error, run } = await compile(`
export function run(): i32 {
	const a = find("a") ?? "none";
	const b = find("b") ?? "none";
	const empty = find("empty") ?? "none";
	return (a == "found" ? 100 : 0) + (b == "none" ? 10 : 0) + (empty == "" ? 1 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(111);
});

test('the result has no null: it goes where a string is expected', async () => {
	const { error, run } = await compile(`
function length(text: string): i32 { return text.length; }
function prefix(key: string) { return find(key) ?? ""; }
export function run(): i32 {
	return length(find("b") ?? "four") + length(prefix("a"));
}
`);
	expect(error).toBe('');
	expect(run()).toBe(9);
});

test('the right side is evaluated only when it is needed', async () => {
	const { error, run } = await compile(`
let calls = 0;
function fallback(): string { calls++; return "x"; }
export function run(): i32 {
	find("a") ?? fallback();
	find("b") ?? fallback();
	return calls;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(1);
});

test('the left side is evaluated once', async () => {
	const { error, run } = await compile(`
let calls = 0;
function counted(): string | null { calls++; return "x"; }
export function run(): i32 {
	const value = counted() ?? "y";
	return calls * 10 + value.length;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11);
});

test('a nullable right side keeps the null; chains read left to right', async () => {
	const { error, run } = await compile(`
export function run(): i32 {
	const none = find("b") ?? find("c");
	const chained = find("b") ?? find("c") ?? "last";
	return (none == null ? 10 : 0) + (chained == "last" ? 1 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11);
});

test('??= assigns only a missing value', async () => {
	const { error, run } = await compile(`
class Box { label: string | null = null; }
export function run(): i32 {
	const box = new Box();
	box.label ??= "first";
	box.label ??= "second";
	let local = find("b");
	local ??= "set";
	return (box.label == "first" ? 10 : 0) + (local == "set" ? 1 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11);
});

test('objects work the same way', async () => {
	const { error, run } = await compile(`
class Item { constructor(public weight: i32) {} }
function item(heavy: bool): Item | null { return heavy ? new Item(5) : null; }
export function run(): i32 {
	return (item(true) ?? new Item(1)).weight * 10 + (item(false) ?? new Item(1)).weight;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(51);
});

test('a ternary still parses next to it', async () => {
	const { error, run } = await compile(`
export function run(): i32 {
	const a = find("b") ? 1 : 2;
	const b = (find("b") ?? "z") == "z" ? 3 : 4;
	return a * 10 + b;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(23);
});
