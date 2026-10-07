/**
 * Objects made in their function's frame: a Vector that never leaves the
 * function that makes it is not allocated - the collector never frees it -
 * and one that leaves (returned, kept in a global or another object, given
 * to an import that may keep it, carried into the next turn of a loop,
 * grown) stays on the heap and keeps its values. Built as a full build
 * finishes a plugin, with the collector stepping on every allocation.
 */
import { readFileSync } from 'node:fs';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

const OFTEN = ['--use', 'ASC_GC_STRESS=1', '--use', 'ASC_GC_GRANULARITY=16', '-O3'];

const SOURCE = `
import { Vector } from "./vector";

// @ts-ignore: decorator
@external("env", "ent_vector") declare function readInto(id: i32, offset: i32, out: usize): void;
// @ts-ignore: decorator
@external("env", "keep") declare function keep(out: usize): void;

export let freed = 0;

export function collect(): void {
	__collect();
}

// @ts-ignore: decorator
@global function __finalize(ptr: usize): void {
	freed++;
}

// Inlined where it is called, as the facade's getters of a new Vector are.
// @ts-ignore: decorator
@inline function read(id: i32): Vector {
	const v = new Vector();
	readInto(id, 8, v.dataStart);
	return v;
}

/** Vectors read and dropped: none allocated. */
export function dropped(count: i32): f64 {
	let sum = 0.0;
	for (let i = 0; i < count; i++) sum += read(i).x + read(i).z;
	return sum;
}

let last: Vector | null = null;

class Box {
	vector: Vector | null = null;
}

/** Vectors that leave: each bit a case that read a wrong value. */
export function leaving(): i32 {
	let failed = 0;

	last = read(5);
	__collect();
	if (last!.x != 5 || last!.y != 8) failed |= 1;

	const box = new Box();
	box.vector = read(6);
	__collect();
	if (box.vector!.x != 6) failed |= 2;

	const given = read(7);
	keep(given.dataStart);
	__collect();
	if (given.x != 7) failed |= 4;

	let previous = read(0);
	for (let i = 1; i < 50; i++) {
		const next = read(i);
		__collect();
		if (previous.x != <f64>(i - 1)) failed |= 8;
		previous = next;
	}

	const grown = read(9);
	grown.push(10);
	__collect();
	if (grown.x != 9 || grown[3] != 10 || grown.length != 4) failed |= 16;

	return failed;
}
`;

test('a vector that does not leave its function is made in its frame, one that leaves on the heap', async () => {
	let memory: any = null;
	const env = {
		// x, y and z of the "entity": its id, the offset asked, 1.5.
		ent_vector(id: number, offset: number, out: number) {
			const view = new DataView(memory.buffer);
			view.setFloat64(out, id, true);
			view.setFloat64(out + 8, offset, true);
			view.setFloat64(out + 16, 1.5, true);
		},
		keep() {},
	};
	const files = { 'probe.ts': SOURCE, 'vector.ts': readFileSync('as/vector.ts', 'utf-8') };
	const { error, exports } = await probe(files, OFTEN, env, true);
	expect(error).toBe('');
	memory = exports.memory;

	expect(exports.dropped(1000)).toBe(499500 + 1000 * 1.5);
	exports.collect();
	expect(exports.freed.value).toBe(0);

	expect(exports.leaving()).toBe(0);
	expect(exports.freed.value).toBeGreaterThan(0);
});
