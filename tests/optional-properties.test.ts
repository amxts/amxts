/**
 * Optional properties as in TypeScript: `interface O { time?: number }` - an
 * object literal may leave the field out, and it then reads as undefined.
 * `??`, `=== undefined` with narrowing, `!`, `?.` and destructuring with
 * defaults, at the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, run: () => (error ? 0 : exports.run() as number), text: () => (error ? '' : string(exports.text())) };
}

const OPTIONS = `
class Player { id: i32 = 3; }
interface MenuShowOptions {
	time?: number;
	target?: Player;
	force?: boolean;
	label?: string;
	onSelect?: (player: Player) => void;
}
`;

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a field left out reads as undefined: ?? takes the default, a given one is itself', async () => {
			const { error, run } = await compile(`${OPTIONS}
function show(options: MenuShowOptions = {}): f64 {
	const time = options.time ?? -1;
	return time + (options.force ?? true ? 100 : 0);
}
export function run(): f64 { return show() * 1000 + show({ time: 10, force: false }); }
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(99 * 1000 + 10);
		});

		test('=== undefined and !== undefined narrow an object field, as TypeScript does', async () => {
			const { error, run } = await compile(`${OPTIONS}
function target(options: MenuShowOptions): i32 {
	if (options.target !== undefined) return options.target.id;
	if (options.target === undefined) return -1;
	return 0;
}
function truthy(options: MenuShowOptions): i32 {
	if (!options.target) return -1;
	return options.target.id;
}
export function run(): i32 { return target({ target: new Player() }) * 100 + target({}) * 10 + truthy({}); }
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(300 - 10 - 1);
		});

		test('a boolean left out is undefined, not false: === false is false for it', async () => {
			const { error, run } = await compile(`${OPTIONS}
function force(options: MenuShowOptions): i32 {
	return (options.force === undefined ? 1 : 0) + (options.force === false ? 10 : 0) + (options.force ? 100 : 0);
}
export function run(): i32 { return force({}) * 10000 + force({ force: false }) * 100 + force({ force: true }); }
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(1 * 10000 + 10 * 100 + 100);
		});

		test('assigning undefined leaves a field out again; copying a field copies whether it was given', async () => {
			const { error, run } = await compile(`${OPTIONS}
export function run(): i32 {
	const options: MenuShowOptions = { force: true, time: 5 };
	options.force = undefined;
	options.time = undefined;
	const copy: MenuShowOptions = { force: options.force, time: options.time };
	return (copy.force === undefined ? 1 : 0) + (copy.time === undefined ? 10 : 0);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(11);
		});

		test('a number read into a variable stays undefined; ! reads the value', async () => {
			const { error, run } = await compile(`${OPTIONS}
export function run(): f64 {
	const empty: MenuShowOptions = {};
	const time = empty.time;
	const given: MenuShowOptions = { time: 4 };
	return (time === undefined ? 100 : 0) + (time ?? 20) + given.time!;
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(124);
		});

		test('undefined prints as undefined', async () => {
			const { error, text } = await compile(`${OPTIONS}
export function text(): string {
	const options: MenuShowOptions = {};
	let later: number | undefined = undefined;
	return \`\${options.time} \${later ?? 2}\`;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('undefined 2');
		});

		test('?. calls a function field only when there is one, and reads through a missing object as undefined', async () => {
			const { error, run } = await compile(`${OPTIONS}
let selected = 0;
class Item { name: string = "knife"; next: Item | null = null; count(): number { return 7; } }
interface Holder { item?: Item; list?: number[]; }
export function run(): f64 {
	const options: MenuShowOptions = { onSelect: (player: Player) => { selected = player.id; } };
	options.onSelect?.(new Player());
	const none: MenuShowOptions = {};
	none.onSelect?.(new Player());
	const full: Holder = { item: new Item(), list: [9] };
	const empty: Holder = {};
	const name = empty.item?.next?.name;
	return selected * 10000
		+ (full.item?.count() ?? 0) * 1000
		+ (empty.item?.count() ?? 5) * 100
		+ (full.list?.[0] ?? 0) * 10
		+ (name === undefined ? 1 : 0);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(3 * 10000 + 7 * 1000 + 5 * 100 + 9 * 10 + 1);
		});

		test('a destructuring parameter with defaults, as the options idiom is written', async () => {
			const { error, text } = await compile(`${OPTIONS}
function show(player: Player, name: string, { time = -1, force = false, label = "none", target }: MenuShowOptions = {}): string {
	return \`\${name} \${time} \${force} \${label} \${target == null}\`;
}
export function text(): string {
	return show(new Player(), "A") + "|" + show(new Player(), "B", { time: 10, force: true, label: "x", target: new Player() });
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('A -1 false none true|B 10 true x false');
		});

		test('destructuring a declaration, and an arrow\'s parameter', async () => {
			const { error, run } = await compile(`${OPTIONS}
function sum(list: MenuShowOptions[], fn: (options: MenuShowOptions) => f64): f64 {
	let total: f64 = 0;
	for (let i = 0; i < list.length; i++) total += fn(list[i]);
	return total;
}
export function run(): f64 {
	const options: MenuShowOptions = { time: 3 };
	const { time = 7, label: text = "ab" } = options;
	return time * 100 + <f64>text.length * 10 + sum([{ time: 1 }, {}], ({ time = 5 }) => time);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(300 + 20 + 6);
		});

		test('a generic field is undefined as its type has it', async () => {
			const { error, run } = await compile(`
class Box<T> { value?: T; }
class Player { id: i32 = 4; }
export function run(): f64 {
	const number: Box<f64> = {};
	const player: Box<Player> = { value: new Player() };
	const flag: Box<bool> = {};
	return (number.value ?? 10) + <f64>player.value!.id * 100 + (flag.value ?? true ? 1000 : 0);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(10 + 400 + 1000);
		});
	});
}

test('a closure narrows the variable it holds a copy of, as TypeScript narrows a const', async () => {
	const { error, run } = await compile(`
class Item { value: i32 = 7; }
function item(some: bool): Item | null { return some ? new Item() : null; }
function call(fn: () => i32): i32 { return fn(); }
export function run(): i32 {
	const some = item(true);
	const none = item(false);
	return call(() => {
		if (some == null) return -1;
		return some.value;
	}) * 10 + call(() => (none != null ? none.value : 3));
}
`, false);
	expect(error).toBe('');
	expect(run()).toBe(73);
});

test('for...in over an array says what to write instead', async () => {
	const { error } = await compile(`
export function run(): i32 {
	const list = [1, 2];
	let count = 0;
	for (const key in list) count++;
	return count;
}
`, false);
	expect(error).toContain('walk an array or a Map with for...of');
});
