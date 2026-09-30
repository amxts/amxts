/**
 * Text and a value joined with `+` as JavaScript joins them - the value
 * written as `${value}` writes it - and JavaScript's `Number(value)`. At the
 * default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, exports, run: () => (error ? 0 : exports.run() as number), text: () => (error ? '' : string(exports.text())) };
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('text and a number are joined, either side first, as JavaScript writes the number', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const hp: number = 100;
	const speed = 2.5;
	let line = "HP: " + hp + ", speed " + speed;
	line += "; " + (hp / 3).toFixed(1) + " a third";
	line += " | " + 1e21 + " " + (0.25 + 0.5) + " " + -0 + " " + NaN;
	return hp + " left " + line;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('100 left HP: 100, speed 2.5; 33.3 a third | 1e+21 0.75 0 NaN');
		});

		test('a value left out is written undefined, a null null', async () => {
			const { error, text } = await compile(`
interface Options { label?: string; owner: string | null }
function nothing(): string | undefined { return undefined; }
function describe(options: Options, suffix?: string): string {
	let note: string | undefined = undefined;
	return \`\${options.label} \${options.owner} \${suffix} \${note}\` + " " + nothing();
}
export function text(): string {
	return describe({ owner: null }) + " | " + describe({ label: "a", owner: "b" }, "c");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('undefined null undefined undefined undefined | a b c undefined undefined');
		});

		test('arithmetic on a number left out is NaN, and the number itself undefined', async () => {
			const { error, text } = await compile(`
interface Stats { hp?: number }
function heal(stats: Stats, bonus?: number): string {
	const hp = stats.hp;
	let total = 10;
	total += stats.hp;
	const found = [1, 2].find(value => value > 5);
	const scores = new Map<string, number>();
	return (stats.hp + 1) + " " + (hp * 2) + " " + total + " " + (bonus - 1) + " " + hp + " " + (hp ?? 5) +
		" " + ((found as number) + 1) + " " + ((scores.get("ann") as number) * 2) + " " + new Map<string, string>().get("x");
}
export function text(): string {
	return heal({}) + " | " + heal({ hp: 3 }, 2);
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('NaN NaN NaN NaN undefined 5 NaN NaN undefined | 4 6 13 1 3 3 NaN NaN undefined');
		});

		test('String(value) and Boolean(value) convert as in JavaScript', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const empty = "";
	return String(2.5) + String(true) + String() + " " + Boolean(0) + Boolean(3) + Boolean(empty) + Boolean("a") + Boolean();
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('2.5true falsetruefalsetruefalse');
		});

		test('text += a number, a boolean and an object with toString', async () => {
			const { error, text } = await compile(`
class Point {
	constructor(public x: number, public y: number) {}
	toString(): string { return "(" + this.x + ", " + this.y + ")"; }
}
export function text(): string {
	let line = "at ";
	line += new Point(1, 2);
	line += " ";
	line += 7;
	line += " " + true;
	return line;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('at (1, 2) 7 true');
		});

		test('numbers still add: a number and a number are a sum', async () => {
			const { error, run } = await compile(`
export function run(): f64 {
	const a = 2;
	const b = 3;
	return a + b + 0.5;
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(5.5);
		});

		test('Number(text) reads the whole text as JavaScript does', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const values = [
		Number("12"), Number(" 3.5 "), Number(""), Number("12px"), Number("0x1F"), Number("0b101"),
		Number("-Infinity"), Number("1e3"), Number("."), Number(true), Number(false), Number(7),
	];
	return values.join(",");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('12,3.5,0,NaN,31,5,-Infinity,1000,NaN,1,0,7');
		});
	});
}
