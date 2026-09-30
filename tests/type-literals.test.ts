/**
 * Object types written in place, as TypeScript lets them be written:
 * `interface Settings { chat: { prefix: string } }`, a parameter
 * `(o: { x: number })`, `type Alias = { ... }`. Each is a class of its own
 * (Parser.parseTypeLiteral); the same text twice in a file is one class.
 * And `object`, TypeScript's any object: std/assembly/object.ts.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function run(body: string) {
	const { error, exports } = await probe({ 'probe.ts': body });
	return { error, value: error ? 0 : exports.run() as number };
}

describe('an object type in place', () => {
	test('a field of an interface: the literal builds it, a nested one too, and lists of them', async () => {
		const { error, value } = await run(`
interface Settings {
	chat: { prefix: string; color?: string };
	round: { time: f64; limits: { min: i32, max: i32 } };
	items: { name: string; price: i32 }[];
}
export function run(): i32 {
	const s: Settings = { chat: { prefix: "[HNS]" }, round: { time: 2.5, limits: { min: 1, max: 9 } }, items: [] };
	s.items.push({ name: "awp", price: 4750 });
	s.chat.color = "red";
	return s.items[0].price + s.round.limits.max + (s.chat.color == "red" ? 100000 : 0) + (s.chat.prefix.length * 1000000);
}
`);
		expect(error).toBe('');
		expect(value).toBe(5 * 1000000 + 100000 + 4750 + 9);
	});

	test('a parameter, a type alias; the same text twice is one type', async () => {
		const { error, value } = await run(`
type Point = { x: i32; y: i32 };
function sum(point: { x: i32; y: i32 }): i32 { return point.x + point.y; }
export function run(): i32 {
	const p: Point = { x: 1, y: 2 };
	return sum(p) + sum({ x: 10, y: 20 });
}
`);
		expect(error).toBe('');
		expect(value).toBe(33);
	});

	test('`object` is any object, as TypeScript writes it: a Map keyed by what it holds', async () => {
		const { error, value } = await run(`
class A { x: i32 = 1; }
class B { y: string = "b"; }
const seen = new Map<object, i32>();
function remember(value: object, n: i32): void { seen.set(value, n); }
export function run(): i32 {
	const a = new A();
	const b = new B();
	remember(a, 10);
	remember(b, 20);
	return seen.get(a) + seen.get(b) + (seen.has(new A()) ? 1000 : 0);
}
`);
		expect(error).toBe('');
		expect(value).toBe(30);
	});

	test('a method in it is refused: that is an interface', async () => {
		const { error } = await run('function f(o: { go(): void }): void {}\nexport function run(): i32 { return 0; }\n');
		expect(error).toContain('methods and index signatures in an object type - declare an interface');
	});
});
