/**
 * A loop with a label: `break outer` leaves it and `continue outer` goes
 * round it from a loop inside, through for, for...of, while and do, and past
 * a finally. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('break and continue name the loop of a label', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': `
export function text(): string {
	const grid = [[1, 2, 3], [4, -1, 6], [7, 8, 9]];
	let found = "";
	search: for (let row = 0; row < grid.length; row++) {
		for (const cell of grid[row]) {
			if (cell < 0) {
				found = "row " + row.toString();
				break search;
			}
		}
	}
	let skipped = "";
	rows: for (const row of grid) {
		let i = 0;
		while (i < row.length) {
			if (row[i] % 2 == 0) continue rows;
			i++;
		}
		skipped += "!";
	}
	let rounds = 0;
	let n = 0;
	outer: do {
		n++;
		let k = 0;
		do {
			k++;
			if (k == 2) continue outer;
		} while (k < 5);
		rounds += 100;
	} while (n < 3);
	let cleanups = 0;
	each: for (let a = 0; a < 3; a++) {
		for (let b = 0; b < 3; b++) {
			try {
				if (b == 1) continue each;
				if (a == 2) break each;
			} finally {
				cleanups++;
			}
		}
	}
	return found + " " + skipped + " " + rounds.toString() + n.toString() + " " + cleanups.toString();
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe('row 1  03 5');
		});
	});
}
