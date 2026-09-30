/**
 * Spread as JavaScript has it: `[...a, 3]` of arrays, Maps, Sets and text,
 * `f(...list)` into a rest parameter, `Math.max(...list)`, and
 * `{ ...other, x: 1 }` of objects and Records. At the default optimization
 * and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, exports, text: () => (error ? '' : string(exports.text())) };
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('an array literal spreads arrays, a Set, a Map\'s entries and text, into a new array', async () => {
			const { error, text } = await compile(`
function sum(...values: number[]): number {
	let total = 0;
	for (const value of values) total += value;
	return total;
}
export function text(): string {
	const a = [1, 2];
	const copy = [...a];
	copy.push(9);
	const joined = [0, ...a, 3, ...[4, 5]];
	const names = new Set<string>();
	names.add("x");
	names.add("y");
	const scores = new Map<string, number>();
	scores.set("ann", 5);
	const entries = [...scores];
	return [
		a.join(","), copy.join(","), joined.join(","), [...names].join(""), entries[0][0] + entries[0][1].toString(),
		[..."hey"].join("-"), sum(...a, 10).toString(), Math.max(...joined).toString(), Math.min(4, 2, 8).toString(),
	].join("|");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('1,2|1,2,9|0,1,2,3,4,5|xy|ann5|h-e-y|13|5|2');
		});

		test('an object literal spreads another object\'s fields; a field written after wins', async () => {
			const { error, text } = await compile(`
interface Options { time: number; label: string; loud?: boolean }
export function text(): string {
	const base: Options = { time: 5, label: "base", loud: true };
	const changed: Options = { ...base, label: "changed" };
	const copy = { ...base };
	copy.time = 7;
	const scores: Record<string, number> = { a: 1 };
	const more: Record<string, number> = { ...scores, b: 2 };
	return [
		changed.time.toString(), changed.label, (changed.loud ?? false).toString(),
		base.time.toString(), copy.time.toString(), Object.keys(more).join(","),
	].join("|");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('5|changed|true|5|7|a,b');
		});
	});
}
