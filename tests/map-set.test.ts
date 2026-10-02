/**
 * Map and Set as JavaScript has them: made of a list of entries or values,
 * `for...of` over a Map's entries and a Set's values, `entries()` and
 * `forEach`, and `map.get` of a missing key giving undefined. At the default
 * optimization and at -O3.
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
		test('for...of walks a Map\'s entries and a Set\'s values, in the order added', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const kills = new Map<string, number>();
	kills.set("b", 2);
	kills.set("a", 1);
	const names = new Set<string>();
	names.add("x");
	names.add("y");
	let out = "";
	for (const [name, count] of kills) out += name + count.toString();
	for (const entry of kills.entries()) out += entry[0];
	for (const name of names) out += name;
	kills.forEach((count, name) => { out += name + (count * 10).toString(); });
	names.forEach((name) => { out += name.toUpperCase(); });
	return out;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('b2a1baxyb20a10XY');
		});

		test('a Map is made of its entries and a Set of its values, their types read off them', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const prices = new Map([["ak47", 2500], ["awp", 4750.5]]);
	const kills = new Map<string, number>([["ann", 3]]);
	const maps = new Set(["de_dust2", "de_inferno", "de_dust2"]);
	const empty = new Map<string, number>();
	let out = "";
	for (const [name, price] of prices) out += name + price.toString() + " ";
	for (const name of maps) out += name + " ";
	return out + kills.get("ann").toString() + maps.size.toString() + empty.size.toString();
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('ak472500 awp4750.5 de_dust2 de_inferno 320');
		});

		test('map.get of a missing key is undefined: ?? takes the default, has is not needed', async () => {
			const { error, text } = await compile(`
class Player { constructor(public name: string) {} }
export function text(): string {
	const scores = new Map<string, number>();
	scores.set("ann", 5);
	const players = new Map<number, Player>();
	players.set(1, new Player("ann"));
	const flags = new Map<string, boolean>();
	flags.set("off", false);
	const found = players.get(1);
	const missing = players.get(2);
	return [
		(scores.get("ann") ?? 0).toString(), (scores.get("bob") ?? 0).toString(), (scores.get("bob") === undefined).toString(),
		players.get(1)!.name, found!.name, (missing == null).toString(), (players.get(3)?.name ?? "none"),
		(flags.get("off") ?? true).toString(), (flags.get("gone") ?? true).toString(),
	].join(",");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('5,0,true,ann,ann,true,none,false,true');
		});

		test('map.has(key) ? map.get(key) : fallback is the value type, as the editor types it', async () => {
			const { error, text } = await compile(`
class Player { constructor(public name: string) {} }
const prefixes = new Map<number, string>();
const players = new Map<number, Player>();
function prefixFor(plugin: number): string { return prefixes.has(plugin) ? prefixes.get(plugin) : "core"; }
function playerFor(id: number): Player { return !players.has(id) ? new Player("nobody") : players.get(id); }
function length(text: string): number { return text.length; }
export function text(): string {
	prefixes.set(1, "mine");
	players.set(1, new Player("ann"));
	const found = prefixes.has(2) ? prefixes.get(2) : "none";
	let named: string = prefixes.has(1) ? prefixes.get(1) : "none";
	return [prefixFor(1), prefixFor(2), playerFor(1).name, playerFor(2).name, found, named,
		length(prefixes.has(1) ? prefixes.get(1) : "").toString()].join(",");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('mine,core,ann,nobody,none,mine,4');
		});

		test('a ternary with a null of its own is not the value type', async () => {
			const { error } = await compile(`
const prefixes = new Map<number, string>();
export function text(): string { return prefixes.has(1) ? prefixes.get(1) : null; }
`, optimize);
			expect(error).toContain('is not assignable to type \'~lib/string/String\'');
		});

		test('an object read with map.get and used as there is checked where it runs', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
class Player { constructor(public id: number) {} }
const players = new Map<string, Player>();
players.set("ann", new Player(4));
export function run(): f64 {
	const ann = players.get("ann");
	return ann.id + players.get("ann").id;
}
export function missing(): f64 { return players.get("ben").id; }
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(8);
			expect(() => exports.missing()).toThrow();
		});
	});
}
