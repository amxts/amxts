/**
 * A word TypeScript reserves only in one place is a name everywhere else:
 * `override` modifies a class member, and a variable may be called it; a
 * function may be called `number` and the type is still there.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

test('override is a variable\'s name, destructured too, and still a member\'s modifier', async () => {
	const { error, exports } = await probe({ 'probe.ts': `
class Base { size(): i32 { return 1; } }
class Wide extends Base { override size(): i32 { return 10; } }

export function run(): i32 {
	const [other, override] = [2, 100];
	const wide = new Wide();
	return override + other + (override != 0 ? wide.size() : 0);
}
` });
	expect(error).toBe('');
	expect(exports.run()).toBe(112);
});

test('a function named number, string or boolean leaves the type of that name in its file', async () => {
	const { error, exports } = await probe({ 'probe.ts': `
export function number(text: string): number { return parseFloat(text); }
export function string(value: number): string { return value.toString(); }
export function boolean(value: number): boolean { return value != 0; }

export function run(): number {
	const flag: boolean = boolean(1);
	const text: string = string(4);
	return number(text) + (flag ? 10 : 0);
}
` });
	expect(error).toBe('');
	expect(exports.run()).toBe(14);
});
