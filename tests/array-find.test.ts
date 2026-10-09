/**
 * `array.find` and `findLast` as in JavaScript, on any element: the element,
 * or undefined. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('find on numbers gives the number or undefined; on text and objects the value or undefined', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': `
class Box { constructor(public size: number) {} }
export function text(): string {
	const sizes = [3, 8, 12];
	const big = sizes.find((size) => size > 5);
	const huge = sizes.find((size) => size > 100);
	const last = sizes.findLast((size) => size > 5);
	const words = ["a", "bb"];
	const boxes = [new Box(1)];
	return [
		(big ?? -1).toString(), (huge ?? -1).toString(), (huge === undefined).toString(), (last ?? -1).toString(),
		words.find((word) => word.length == 2) ?? "none", words.find((word) => word.length == 5) ?? "none",
		(boxes.find((box) => box.size == 1)?.size ?? 0).toString(), (boxes.find((box) => box.size == 2) === undefined).toString(),
	].join(",");
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe('8,-1,true,12,bb,none,1,true');
		});
	});
}

test('flatMap joins the arrays a function returns, as in JavaScript', async () => {
	const { error, exports, string } = await probe({ 'probe.ts': `
export function text(): string {
	const words = ["a", "bb"].flatMap(word => [word, word.toUpperCase()]);
	const sizes = [1, 2, 3].flatMap(size => size == 2 ? [] : [size, size * 10]);
	return words.join(",") + "|" + sizes.join(",");
}
` });
	expect(error).toBe('');
	expect(string(exports.text())).toBe('a,A,bb,BB|1,10,3,30');
});
