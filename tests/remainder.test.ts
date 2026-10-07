/**
 * `%` of two numbers is JavaScript's: the dividend's sign, `-0` kept, `NaN`
 * for a zero divisor or an infinite dividend, the dividend for an infinite
 * divisor, fractions and numbers past i32 exact. Two whole numbers within
 * i32 take a fast path (std's Math.mod in the patched AssemblyScript); the
 * rest the general remainder. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

const PAIRS: [number, number][] = [
	[7, 3],
	[-7, 3],
	[7, -3],
	[-7, -3],
	[-4, 2],
	[4, -2],
	[0, 5],
	[-0, 5],
	[6, 6],
	[-6, 6],
	[5, 0],
	[-5, 0],
	[5, -0],
	[0, 0],
	[Number.NaN, 3],
	[3, Number.NaN],
	[Number.POSITIVE_INFINITY, 3],
	[Number.NEGATIVE_INFINITY, 3],
	[3, Number.POSITIVE_INFINITY],
	[-3, Number.NEGATIVE_INFINITY],
	[5.5, 2],
	[-5.5, 2],
	[5, 2.5],
	[0.3, 0.1],
	[7, 0.5],
	[2147483647, 10],
	[-2147483647, 10],
	[-2147483647, -1],
	[-2147483648, 10],
	[-2147483648, -1],
	[2147483648, 7],
	[3, 2147483648],
	[1e15 + 3, 7],
	[-(2 ** 53), 10],
	[2 ** 53 + 2, 10],
	[1e300, 7],
];

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('n % d is JavaScript\'s remainder', async () => {
			const { error, exports } = await probe({ 'probe.ts': 'export function remainder(x: number, y: number): number { return x % y; }' }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			for (const [x, y] of PAIRS) {
				const got = exports.remainder(x, y);
				// Object.is tells -0 from 0 and NaN from NaN.
				if (!Object.is(got, x % y)) throw new Error(`${x} % ${y}: ${got}, JavaScript says ${x % y}`);
			}
		});

		test('n % d compared with 0 is JavaScript\'s, either way round', async () => {
			const source = [
				'export function zero(x: number, y: number): bool { return x % y == 0; }',
				'export function notZero(x: number, y: number): bool { return 0 != x % y; }',
			].join('\n');
			const { error, exports } = await probe({ 'probe.ts': source }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			for (const [x, y] of PAIRS) {
				if (Boolean(exports.zero(x, y)) !== (x % y === 0)) throw new Error(`${x} % ${y} == 0: ${exports.zero(x, y)}`);
				if (Boolean(exports.notZero(x, y)) !== (x % y !== 0)) throw new Error(`0 != ${x} % ${y}: ${exports.notZero(x, y)}`);
			}
		});

		test('n % d at the top level is the same', async () => {
			const { error, exports } = await probe({ 'probe.ts': 'let x: number = -4;\nconst atTop = x % 2;\nexport function top(): number { return atTop; }' }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(Object.is(exports.top(), -0)).toBe(true);
		});
	});
}
