/**
 * `concat` takes any number of arguments, as in JavaScript: a string's any
 * number of strings, an array's values and arrays mixed, each argument read
 * once and before any is copied, into a new array. One array or one string is
 * std's own `concat`, at the default optimization and at -O3.
 */
import { describe, expect, test } from 'vitest';
import { compileSources } from '../src/testing/compile';
import { probe } from './probe';

const SOURCE = `
class Stack<T> extends Array<T> {}
const log: string[] = [];
function noted(name: string, value: number): number { log.push(name); return value; }
function named(name: string): string { log.push(name); return name; }
function twice<U>(list: U[], value: U): U[] { return list.concat(value, [value]); }

export function text(): string {
	const parts = ["d", "e"];
	const words = [
		"a".concat("b", "c"),
		"a".concat(),
		"a".concat(...parts),
		"a".concat(named("x"), named("y")),
	];

	const base = [0];
	const more = [4, 5];
	const lists = [[6], [7, 8]];
	const mixed = base.concat(1, [2, 3], more);
	const none = base.concat();
	none.push(9);
	const value = base.concat(1);
	const values = base.concat(...more);
	const arrays = base.concat(...lists);
	const literal = base.concat(...[1, 2]);
	const ordered = base.concat(noted("z", 1), [noted("w", 2)], noted("v", 3));

	const read = [1];
	const before = read.concat(read, read.push(2));

	const halves = [0.5].concat(1, [2.5]);
	const names = ["p"].concat("q", ["r", "s"]);
	const stack = new Stack<number>();
	stack.push(1);
	const stacked = stack.concat(2, [3]);
	const generic = twice([1], 2).join() + ";" + twice(["g"], "h").join();

	return [
		words.join(), log.join(),
		mixed.join(), none.join(), base.join(), value.join(), values.join(), arrays.join(), literal.join(), ordered.join(),
		before.join(),
		halves.join(), names.join(), stacked.join(), generic,
	].join("|");
}
`;

const JS = 'abc,a,ade,axy|x,y,z,w,v|0,1,2,3,4,5|0,9|0|0,1|0,4,5|0,6,7,8|0,1,2|0,1,2,3|1,2,1,2,2|0.5,1,2.5|p,q,r,s|1,2,3|1,2,2;g,h,h';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('concat with many arguments, none, values and spreads gives what JavaScript gives', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': SOURCE }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe(JS);
		});
	});
}

test('one array and one string are std\'s own concat', async () => {
	const source = `
export function list(a: i32[], b: i32[]): i32[] { return a.concat(b); }
export function text(a: string, b: string): string { return a.concat(b); }
`;
	const { error, text } = await compileSources(['probe.ts', '--outFile', 'probe.wasm', '--textFile', 'probe.wat'], { 'probe.ts': source });
	expect(error).toBeNull();
	expect(text['probe.wat'].split('(func $probe/list ')[1].split('\n (func ')[0]).toContain('call $~lib/array/Array<i32>#concat');
	expect(text['probe.wat'].split('(func $probe/text ')[1].split('\n (func ')[0]).toContain('call $~lib/string/String#concat');
	expect(text['probe.wat']).not.toContain('Many');
});
