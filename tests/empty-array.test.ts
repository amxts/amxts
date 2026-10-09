/**
 * `const rows = []` says no element type: TypeScript reads it off the later
 * pushes, the build does not, and says to write it rather than make an array
 * of addresses.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

test('an empty array without its type stops the build with the type to write; with one, it builds', async () => {
	const untyped = await probe({ 'probe.ts': `
const kept = [];
export function text(): string {
	const rows = [];
	rows.push("a");
	return rows.join(",");
}
` });
	expect(untyped.error).toContain('an empty array whose element type is not written - write it: const rows: Row[] = []');
	expect(untyped.error).toContain('const kept: Row[] = []');

	const typed = await probe({ 'probe.ts': `
export function text(): string {
	const rows: string[] = [];
	rows.push("a");
	const more = rows.length > 0 ? rows : [];
	return rows.concat(more).join(",");
}
` });
	expect(typed.error).toBe('');
	expect(typed.string(typed.exports.text())).toBe('a,a');
});
