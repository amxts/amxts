/**
 * Destructuring as TypeScript has it: patterns inside patterns, a default
 * past the end of an array, `...rest` of an array, and an array pattern as
 * a parameter. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('nested patterns, defaults, a rest element, an array pattern parameter', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': `
interface Spot { x: number; y: number }
interface Team { name: string; lead: { name: string; spot: Spot }; scores: number[] }
function score([name, points]: [string, number]): string {
	return name + points.toString();
}
export function text(): string {
	const team: Team = { name: "ct", lead: { name: "ann", spot: { x: 1, y: 2 } }, scores: [5, 7, 9] };
	const { name, lead: { name: leader, spot: { x, y } }, scores: [first, ...others] } = team;
	const [a, b = 10, c = 20] = [1];
	const [[p, q], [r]] = [[1, 2], [3]];
	const pairs: [string, number][] = [["x", 1], ["y", 2]];
	let out = name + " " + leader + " " + x.toString() + y.toString() + " " + first.toString() + ":" + others.join(",");
	out += " " + (a + b + c).toString() + " " + (p + q + r).toString();
	for (const [key, [value]] of [["k", [4]]] as [string, number[]][]) out += " " + key + value.toString();
	return out + " " + pairs.map(([key, value]) => key + value.toString()).join("") + " " + score(["z", 3]);
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe('ct ann 12 5:7,9 31 6 k4 x1y2 z3');
		});
	});
}
