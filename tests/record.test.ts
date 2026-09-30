/**
 * `Record<K, V>` and index signatures, as TypeScript writes an object used as
 * a dictionary: a Map underneath, keys in the order added, a missing key read
 * as undefined; `Record<"a" | "b", T>` an object of those fields. Dot and
 * bracket access, `in`, `delete`, `Object.keys/values/entries` and
 * `for...in`, at the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, run: () => (error ? 0 : exports.run() as number), text: () => (error ? '' : string(exports.text())) };
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('an object literal fills a Record; dot and bracket read and write its keys', async () => {
			const { error, run } = await compile(`
export function run(): f64 {
	const kills: Record<string, number> = { alice: 3, bob: 5 };
	kills.carol = 7;
	kills["dave"] = 1;
	const name = "bob";
	kills[name] += 10;
	kills.alice++;
	return kills.alice * 1000 + kills[name] * 10 + kills.carol + kills.dave * 0.5;
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(4 * 1000 + 15 * 10 + 7 + 0.5);
		});

		test('a missing key is undefined: a number NaN-undefined, an object null, ?? takes the default', async () => {
			const { error, run } = await compile(`
class Player { constructor(public id: number) {} }
export function run(): f64 {
	const scores: Record<string, number> = {};
	const players: Record<string, Player> = { ann: new Player(4) };
	let result: f64 = 0;
	if (scores.nobody === undefined) result += 1;
	if (isNaN(scores.nobody + 1)) result += 10;
	result += (scores.nobody ?? 100);
	const who = players["ben"];
	if (who == null) result += 1000;
	result += (players.ann?.id ?? 0) * 10000;
	return result;
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(1 + 10 + 100 + 1000 + 40000);
		});

		test('a boolean of a Record is undefined when its key is not there', async () => {
			const { error, run } = await compile(`
export function run(): i32 {
	const flags: Record<string, boolean> = { off: false };
	return (flags.off ?? true ? 1 : 0) + (flags.missing ?? true ? 10 : 0)
		+ (flags.missing === undefined ? 100 : 0) + (flags.off === undefined ? 1000 : 0) + (flags.missing ? 10000 : 0);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(10 + 100);
		});

		test('in, delete, and a key named like a Map method is still a key', async () => {
			const { error, run } = await compile(`
export function run(): i32 {
	const seen: Record<string, number> = { size: 2, keys: 3 };
	let result = 0;
	if ("size" in seen) result += 1;
	delete seen.size;
	if (!("size" in seen)) result += 10;
	const key = "keys";
	if (key in seen) result += 100;
	delete seen[key];
	if (Object.keys(seen).length == 0) result += 1000;
	return result + <i32>(seen.size ?? 0);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(1111);
		});

		test('Object.keys, values and entries and for...in walk the keys in the order they were added', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const hp: Record<string, number> = { b: 2, a: 1 };
	hp.c = 3;
	delete hp.b;
	hp.b = 4;
	let out = Object.keys(hp).join(",") + "|" + Object.values(hp).join(",") + "|";
	for (const [key, value] of Object.entries(hp)) out += key + "=" + value.toString() + ";";
	for (const key in hp) out += key;
	return out;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('a,c,b|1,3,4|a=1;c=3;b=4;acb');
		});

		test('an index signature is a Record, in place and as an interface', async () => {
			const { error, run } = await compile(`
interface Scores { [name: string]: number }
function total(scores: Scores): f64 {
	let sum: f64 = 0;
	for (const name in scores) sum += scores[name];
	return sum;
}
export function run(): f64 {
	const byTeam: { [team: string]: Scores } = { ct: { a: 1, b: 2 } };
	byTeam.t = { c: 10 };
	return total(byTeam.ct) * 100 + total(byTeam["t"]);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(300 + 10);
		});

		test('an object read off an index signature and used is checked where it runs: a missing key stops the call', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
class Player { constructor(public id: number) {} }
const players: { [name: string]: Player } = { ann: new Player(4) };
export function run(): f64 { return players.ann.id; }
export function missing(): f64 { return players.ben.id; }
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(4);
			expect(() => exports.missing()).toThrow();
		});

		test('Record<"a" | "b", T> is an object of those fields: bracket access by a key, keys in order', async () => {
			const { error, text } = await compile(`
type Team = "CT" | "TERRORIST";
export function text(): string {
	const wins: Record<Team, number> = { CT: 1, TERRORIST: 2 };
	const team: Team = "TERRORIST";
	wins[team] += 5;
	wins.CT++;
	const colours: Record<"red" | "blue", string> = { red: "r", blue: "b" };
	let out = wins.CT.toString() + wins[team].toString() + colours.red + Object.keys(wins).join("") + Object.values(colours).join("");
	for (const [key, value] of Object.entries(colours)) out += key + value;
	return out + (("CT" in wins) ? "!" : "?");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('27rCTTERRORISTrbredrblueb!');
		});

		test('nested Records, a Record in a field, ??= on a key, a function kept by key', async () => {
			const { error, run } = await compile(`
class Stats { byMap: Record<string, Record<string, number>> = {}; }
export function run(): f64 {
	const stats = new Stats();
	stats.byMap.dust = { kills: 2 };
	stats.byMap.dust!.deaths = 3;
	stats.byMap["aztec"] ??= {};
	stats.byMap.aztec!.kills ??= 7;
	const handlers: Record<string, (n: number) => number> = { double: (n) => n * 2 };
	const double = handlers.double;
	const lists: Record<string, number[]> = {};
	lists.a ??= [];
	lists.a!.push(5);
	return stats.byMap.dust!.kills! * 1000 + stats.byMap.dust!.deaths! * 100 + stats.byMap.aztec!.kills! * 10
		+ (double != null ? double(lists.a![0]) : 0) * 10000;
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(2000 + 300 + 70 + 100000);
		});

		test('a misspelt key of Record<"a" | "b", T> does not build', async () => {
			const { error } = await compile(`
export function run(): f64 {
	const wins: Record<"ct" | "t", number> = { ct: 1, t: 2 };
	return wins.tt;
}
`, optimize);
			expect(error).toContain('tt');
		});

		test('Object.keys and for...in of an object of fields give its fields in order', async () => {
			const { error, text } = await compile(`
class Point { x: number = 1; y: number = 2; z?: number }
export function text(): string {
	const point = new Point();
	let out = Object.keys(point).join(",") + "|" + Object.values(point).length.toString() + "|";
	for (const key in point) out += key;
	return out + ("x" in point ? "+" : "-") + ("z" in point ? "+" : "-") + ("w" in point ? "+" : "-");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('x,y,z|3|xyz+--');
		});

		test('delete of an optional field leaves it undefined', async () => {
			const { error, run } = await compile(`
interface Options { time?: number; label?: string }
export function run(): i32 {
	const options: Options = { time: 5, label: "x" };
	delete options.time;
	delete options.label;
	return (options.time === undefined ? 1 : 0) + (options.label == null ? 10 : 0);
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(11);
		});
	});
}
