/**
 * `push` and `unshift` take any number of values, as in JavaScript: the
 * values in order, each argument read once and before any goes in, and the
 * new length back. One value is std's own `push`, at the default
 * optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { compileSources } from '../src/testing/compile';
import { probe } from './probe';

const SOURCE = `
class Stack<T> extends Array<T> {}
const log: string[] = [];
function noted(name: string, value: number): number { log.push(name); return value; }

export function text(): string {
	const numbers = [0];
	const many = numbers.push(1, 2, 3);
	const none = numbers.push();
	const front = numbers.unshift(-2, -1);
	const noFront = numbers.unshift();

	const lengths: number[] = [];
	const seen = lengths.push(lengths.length, lengths.length);

	const words = ["c"];
	words.unshift("a", "b");
	words.push("d", "e");

	const ordered: number[] = [];
	ordered.push(noted("x", 1), noted("y", 2));
	ordered.unshift(noted("z", 3), noted("w", 4));

	const more = [7, 8];
	const spread = [6];
	spread.push(...more);
	spread.unshift(...more);

	const stack = new Stack<number>();
	const stacked = stack.push(1, 2);

	return [
		numbers.join(), many.toString(), none.toString(), front.toString(), noFront.toString(),
		lengths.join(), seen.toString(),
		words.join(),
		ordered.join(), log.join(),
		spread.join(),
		stack.join(), stacked.toString(),
	].join("|");
}
`;

const JS = '-2,-1,0,1,2,3|4|4|6|6|0,0|2|a,b,c,d,e|3,4,1,2|x,y,z,w|7,8,6,7,8|1,2|2';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('push and unshift with many values, none and a spread give what JavaScript gives', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': SOURCE }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe(JS);
		});
	});
}

test('one value is std\'s own push and unshift', async () => {
	const source = `
export function one(list: i32[], value: i32): i32 { list.unshift(value); return list.push(value); }
export function make(): i32[] { return []; }
`;
	const { error, text } = await compileSources(['probe.ts', '--outFile', 'probe.wasm', '--textFile', 'probe.wat'], { 'probe.ts': source });
	expect(error).toBeNull();
	const body = text['probe.wat'].split('(func $probe/one ')[1].split('\n (func ')[0];
	expect(body).toContain('call $~lib/array/Array<i32>#push');
	expect(body).toContain('call $~lib/array/Array<i32>#unshift');
	expect(text['probe.wat']).not.toContain('Many');
});
