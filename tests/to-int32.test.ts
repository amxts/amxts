/**
 * A number made a 32-bit integer by `|`, `&`, `^`, `~`, `<<`, `>>`, `>>>` and
 * where the hood wants an integer is JavaScript's ToInt32 / ToUint32 for
 * every double: truncated toward zero, wrapped modulo 2^32, NaN and the
 * infinities 0 - numbers past 2^63 included. At the default optimization and
 * at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

const VALUES: number[] = [];
for (const edge of [0, 0.5, 1.9, 2 ** 31, 2 ** 32, 2 ** 53, 2 ** 63, 2 ** 64, 1e18, 1e300, Number.POSITIVE_INFINITY]) {
	for (const each of [edge, edge + 1, edge - 1]) VALUES.push(each, -each);
}
VALUES.push(Number.NaN, 2 ** 63 + 2 ** 11, -(2 ** 63) - 2 ** 11, 2 ** 64 + 2 ** 12 + 5 * 2 ** 31, Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE);

const SOURCE = [
	'export function or0(x: number): number { return x | 0; }',
	'export function shr0(x: number): number { return x >> 0; }',
	'export function ushr0(x: number): number { return x >>> 0; }',
	'export function not(x: number): number { return ~x; }',
	'export function and(x: number, y: number): number { return x & y; }',
	'export function shl(x: number, y: number): number { return x << y; }',
].join('\n');

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a number made an integer is JavaScript\'s ToInt32 / ToUint32', async () => {
			const { error, exports } = await probe({ 'probe.ts': SOURCE }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			const wrong: string[] = [];
			const same = (what: string, got: number, want: number) => {
				if (!Object.is(got, want)) wrong.push(`${what}: ${got}, JavaScript says ${want}`);
			};
			for (const x of VALUES) {
				same(`${x} | 0`, exports.or0(x), x | 0);
				same(`${x} >> 0`, exports.shr0(x), x >> 0);
				same(`${x} >>> 0`, exports.ushr0(x), x >>> 0);
				same(`~${x}`, exports.not(x), ~x);
				same(`${x} & -1`, exports.and(x, -1), x & -1);
				same(`-1 & ${x}`, exports.and(-1, x), -1 & x);
				same(`1 << ${x}`, exports.shl(1, x), 1 << x);
			}
			expect(wrong).toEqual([]);
		});

		test('at the top level it is the same', async () => {
			const source = [
				'function big(): number { return 2 ** 64 + 4096; }',
				'const atTop = big() | 0;',
				'export function top(): number { return atTop; }',
			].join('\n');
			const { error, exports } = await probe({ 'probe.ts': source }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.top()).toBe(4096);
		});
	});
}
