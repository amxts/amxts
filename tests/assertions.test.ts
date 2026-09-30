/**
 * TypeScript's type-level words that only say something about a value:
 * `satisfies`, `as const` and a type predicate `value is Type`, which narrows
 * where its call is true. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('satisfies builds a literal as the type it names; as const leaves a value as it is', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
interface Point { x: number; y: number }
const origin = { x: 1, y: 2 } satisfies Point;
const sizes = [1, 2, 3] as const;
const name = "ak47" as const;
export function run(): f64 {
	return origin.x + origin.y + sizes.length + name.length;
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(3 + 3 + 4);
		});

		test('a type predicate is a boolean, and narrows its argument where the call is true', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
class Animal { name: string = "animal"; }
class Cat extends Animal { lives: number = 9; }
function isCat(animal: Animal): animal is Cat {
	return animal instanceof Cat;
}
export function run(): f64 {
	const pets: Animal[] = [new Animal(), new Cat()];
	let lives: f64 = 0;
	for (const pet of pets) {
		if (isCat(pet)) lives += pet.lives;
	}
	return lives + (isCat(pets[0]) ? 100 : 0);
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(9);
		});
	});
}
