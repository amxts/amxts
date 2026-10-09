/**
 * `array.sort` with a comparator as in JavaScript: the sign of the number it
 * returns orders two elements, so `(a, b) => a - b` sorts fractions too.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

test('a comparator returning a fraction orders by its sign, as in JavaScript', async () => {
	const { error, exports, string } = await probe({ 'probe.ts': `
class Record { constructor(public time: number) {} }
function byTime(a: Record, b: Record) { return a.time - b.time; }
export function text(): string {
	const up = [21.5, 21, 20, 20.25].sort((a, b) => a - b);
	const down = [0.1, 0.3, 0.2].sort((a, b) => b - a);
	const records = [new Record(21.5), new Record(21)].sort(byTime).map<number>(record => record.time);
	const whole = [3, 1, 2].sort((a, b) => a - b);
	return [up.join(","), down.join(","), records.join(","), whole.join(",")].join("|");
}
` });
	expect(error).toBe('');
	expect(string(exports.text())).toBe('20,20.25,21,21.5|0.3,0.2,0.1|21,21.5|1,2,3');
});
