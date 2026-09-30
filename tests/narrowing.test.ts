/**
 * Narrowing as TypeScript does it: a variable at the top of a file checked
 * for null, a variable tested with instanceof. At the default optimization
 * and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a variable at the top of a file is narrowed by a null check, and no longer once assigned', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
class Menu { constructor(public id: number) {} }
function create(): Menu | null { return new Menu(7); }
const shop = create();
let current: Menu | null = null;
export function run(): f64 {
	let total: f64 = 0;
	if (shop != null) total += shop.id;
	if (!current) current = new Menu(1);
	if (current) total += current.id;
	if (shop && shop.id > 0) total += 100;
	return total;
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(108);
		});

		test('instanceof narrows a variable where the test holds', async () => {
			const { error, exports } = await probe({ 'probe.ts': `
class Animal { name: string = "animal"; }
class Cat extends Animal { lives: number = 9; }
function lives(animal: Animal): f64 {
	if (animal instanceof Cat) return animal.lives;
	return animal instanceof Animal && !(animal instanceof Cat) ? 1 : 0;
}
export function run(): f64 {
	const pet: Animal = new Cat();
	return lives(pet) * 10 + lives(new Animal()) + (pet instanceof Cat ? pet.lives * 100 : 0);
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(exports.run()).toBe(90 + 1 + 900);
		});
	});
}
