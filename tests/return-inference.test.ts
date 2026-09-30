/**
 * A return type read off the body when one return checks for null first:
 *
 *   const found = find(key);
 *   if (found == null) return "";
 *   return found;                    // string, as TypeScript narrows it
 *
 * The inference has no flow to narrow in, so a variable returned as it is
 * counts as checked, and the body's own compile catches it when it was not.
 * A call returned as it is keeps its null.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

const FIND = `
function find(key: string): string | null {
	if (key == "a") return "found";
	return null;
}
`;

async function compile(body: string) {
	const { error, exports } = await probe({ 'probe.ts': FIND + body });
	return { error, run: () => (error ? 0 : exports.run() as number) };
}

test('a variable checked for null before it is returned is the type without null', async () => {
	const { error, run } = await compile(`
function valueOr(key: string) {
	const found = find(key);
	if (found == null) return "";
	return found;
}
export function run(): i32 { return valueOr("a").length + valueOr("b").length; }
`);
	expect(error).toBe('');
	expect(run()).toBe(5);
});

test('a variable returned without the check does not compile quietly', async () => {
	const { error } = await compile(`
function unchecked(key: string) {
	const found = find(key);
	if (key == "x") return "";
	return found;
}
export function run(): i32 { return unchecked("a").length; }
`);
	expect(error).toContain('is not assignable to type \'~lib/string/String\'');
});

test('a call returned as it is keeps its null', async () => {
	const { error, run } = await compile(`
function passOn(key: string) {
	if (key == "x") return "";
	return find(key);
}
export function run(): i32 {
	const a = passOn("a");
	const b = passOn("b");
	return (a == null ? 100 : a.length) + (b == null ? 100 : b.length);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(105);
});

test('an array literal after another return takes its type: a checked parameter is not null in it', async () => {
	const { error, run } = await compile(`
class Item { constructor(public n: i32) {} }
const all: Item[] = [new Item(1), new Item(2), new Item(3)];
function itemsOf(item: Item | null) {
	if (item == null) return all;
	return [item];
}
export function run(): i32 { return itemsOf(null).length * 10 + itemsOf(new Item(7))[0].n; }
`);
	expect(error).toBe('');
	expect(run()).toBe(37);
});

test('a function declared inside a function has its return type read off its body, the variables around it too', async () => {
	const { error, run } = await compile(`
function outer(bonus: f64): f64 {
	const early = read();
	function read() { return bonus * 2; }
	function twice() { return read() + read(); }
	return early + twice();
}
export function run(): f64 { return outer(5); }
`);
	expect(error).toBe('');
	expect(run()).toBe(30);
});

test('a method that returns the file\'s function of its own name returns what that function does', async () => {
	// In a method the name alone is the function of the file around it: the
	// method itself would be this.label().
	const { error, run } = await compile(`
function label(key: string) {
	return key + "!";
}
class Item {
	constructor(public key: string) {}
	label() {
		return label(this.key);
	}
}
export function run(): i32 { return new Item("abc").label().length; }
`);
	expect(error).toBe('');
	expect(run()).toBe(4);
});

test('a function that may be null, returned as it is, keeps its null - a getter over one reads as the setter takes it', async () => {
	// Function<T>, a function type's wrapper, holds the type without its null
	// (Resolver.getTypeOfElement).
	const { error, run } = await compile(`
type Rule = (a: i32) => bool;
let current: Rule | null = null;
class Rules {
	get rule() {
		return current;
	}
	set rule(rule: Rule | null) {
		current = rule;
	}
}
export function run(): i32 {
	const rules = new Rules();
	const before = rules.rule == null ? 1 : 0;
	rules.rule = (a: i32): bool => a > 1;
	const rule = rules.rule;
	return before + (rule != null && rule(2) ? 10 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11);
});

test('an arrow with a body has its return type read off every return, its own variables too', async () => {
	const { error, run } = await compile(`
class Point { x: number = 1; }
export function run(): f64 {
	const make = () => {
		const p = new Point();
		p.x = 4;
		return p;
	};
	const doubled = [1, 2].map((n) => {
		const d = n * 2;
		return d;
	});
	const pick = (flag: boolean) => {
		if (flag) return 10;
		return 20;
	};
	return make().x + doubled[1] + pick(false);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(4 + 4 + 20);
});

test('cond ? null : value is the value or null, returned or kept in a variable', async () => {
	const { error, run } = await compile(`
class Box { v: number = 3; }
function pick(flag: boolean) {
	const box = new Box();
	return flag ? null : box;
}
export function run(): f64 {
	const kept = true ? null : new Box();
	const box = pick(false);
	return (box != null ? box.v : 0) + (kept == null ? 10 : 0) + (pick(true) == null ? 100 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(113);
});

test('a class field holding an arrow needs no type', async () => {
	const { error, run } = await compile(`
class Timer {
	ticks = 0;
	onTick = () => {
		this.ticks++;
	};
	value = () => 5;
	twice = (n: number) => {
		return n * 2;
	};
}
export function run(): f64 {
	const timer = new Timer();
	timer.onTick();
	return timer.ticks + timer.value() + timer.twice(3);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(1 + 5 + 6);
});
