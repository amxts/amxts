/**
 * A private name, `#secret`: a field, a method and a static member of a
 * class, which JSON.stringify leaves out as JavaScript does.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

test('#secret fields and methods, left out of JSON', async () => {
	const { error, exports, string } = await probe({ 'probe.ts': `
class Counter {
	static #made = 0;
	#count = 0;
	name = "kills";
	constructor() { Counter.#made++; }
	#bump(by: number): void { this.#count += by; }
	add(): number { this.#bump(2); return this.#count; }
	static made(): number { return Counter.#made; }
}
export function text(): string {
	const counter = new Counter();
	new Counter();
	counter.add();
	return counter.add().toString() + " " + Counter.made().toString() + " " + JSON.stringify(counter);
}
` });
	expect(error).toBe('');
	expect(string(exports.text())).toBe('4 2 {"name":"kills"}');
});
