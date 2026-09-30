/**
 * An interface's accessors, `get size(): number` and `set size(value)`: a
 * class implements them with a getter or a field. At the default
 * optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a getter and a setter in an interface', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
interface Sized {
	get size(): number;
	get label(): string;
	set label(value: string);
}
class Box implements Sized {
	#label = "box";
	get size(): number { return 3; }
	get label(): string { return this.#label; }
	set label(value: string) { this.#label = value + "!"; }
}
class Crate implements Sized {
	size = 10;
	label = "crate";
}
function grow(item: Sized): number {
	item.label = "big";
	return item.size + item.label.length;
}
export function run(): number {
	return grow(new Box()) * 100 + grow(new Crate());
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(7 * 100 + 13);
		});
	});
}
