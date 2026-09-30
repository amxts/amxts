/**
 * Tuple types as TypeScript has them: `[number, string]` written as a type,
 * built by an array literal where it goes, read by index and destructuring.
 * At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a tuple as a variable, a parameter, a return, an array\'s and a Map\'s item', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': `
function minMax(values: number[]): [number, number] {
	return [Math.min(...values), Math.max(...values)];
}
function describe(pair: [string, number]): string {
	return pair[0] + "=" + pair[1].toString();
}
export function text(): string {
	const pair: [number, string] = [1, "a"];
	const [low, high] = minMax([4, 9, 2]);
	const list: [string, number][] = [["x", 1], ["y", 2]];
	const byName = new Map<string, [number, boolean]>();
	byName.set("ann", [3, true]);
	const kept = byName.get("ann");
	let out = pair[0].toString() + pair[1] + pair.length.toString() + " " + low.toString() + "-" + high.toString();
	for (const [name, count] of list) out += " " + name + count.toString();
	return out + " " + describe(["z", 5]) + " " + (kept != null && kept[1] ? kept[0].toString() : "none");
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe('1a2 2-9 x1 y2 z=5 3');
		});
	});
}
