/**
 * Objects made in their function's frame: a Vector that never leaves the
 * function that makes it is not allocated - the collector never frees it -
 * and one that leaves (returned, kept in a global or another object, given
 * to an import that may keep it, carried into the next turn of a loop,
 * grown) stays on the heap and keeps its values. The same for an object
 * literal given to a function: in the caller's frame when the function only
 * reads it, on the heap when it keeps it - or a word read from it - however
 * far down. Built as a full build finishes a plugin, with the collector
 * stepping on every allocation.
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

class Pair {
	a: f64;
	b: f64 = 0;
	// @ts-ignore: decorator
	@inline constructor(a: f64) {
		this.a = a;
	}
}

/** An object whose constructor leaves a field at zero: zeroed each time it is made in the frame. */
export function zeroed(count: i32): f64 {
	let sum = 0.0;
	for (let i = 0; i < count; i++) {
		const pair = new Pair(i);
		sum += pair.b;
		pair.b = 7;
		sum += pair.b - 7 + pair.a;
	}
	return sum;
}

/** Vectors in the frame while the collector runs: their numbers are no references to visit. */
export function heldAcross(): f64 {
	const sum = read(3).x + read(3).y;
	__collect();
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
	expect(exports.zeroed(1000)).toBe(499500);
	exports.collect();
	expect(exports.freed.value).toBe(0);

	// 3.0 and 8.0 are words past the end of memory, were they read as addresses.
	expect(exports.heldAcross()).toBe(3 + 8);

	expect(exports.leaving()).toBe(0);
	expect(exports.freed.value).toBeGreaterThan(0);
});

const LITERALS = `
// @ts-ignore: decorator
@external("env", "touch") declare function touch(): void;

export let freed = 0;

// @ts-ignore: decorator
@global function __finalize(ptr: usize): void {
	freed++;
}

export function collect(): void {
	__collect();
}

class Options {
	value: number = 0;
	name: string = "";
	color: number[] | null = null;
}

// Each is exported and bigger than what a build inlines, so it is called and
// what it does with its options is known only from it.

// Exported, so no build takes it for a constant.
export let quiet = 0;

// @ts-ignore: decorator
@inline function big(): void {
	if (quiet < 0) {
		touch(); touch(); touch(); touch(); touch(); touch(); touch(); touch(); touch(); touch();
		touch(); touch(); touch(); touch(); touch(); touch(); touch(); touch(); touch(); touch();
	}
}

/** Reads its options and keeps none of them. */
export function read(options: Options): number {
	big();
	const color = options.color;
	return options.value + (color != null ? color[0] + color.length : 0);
}

/** Gives its options a name made here, after calling itself depth times. */
export function name(options: Options, depth: i32): void {
	big();
	if (depth > 0) name(options, depth - 1);
	else options.name = "a" + options.value.toString();
}

/**
 * Names its options and reads the name after the collector runs: they hold
 * the only reference to it, and a text of its size made after would take its
 * place were it freed.
 */
export function readAcross(options: Options): number {
	big();
	name(options, 1);
	__collect();
	const other = String.fromCharCode(122, 122 + quiet);
	return options.name.length + options.name.charCodeAt(0) + other.length - 2;
}

let saved: Options | null = null;
let list = new Array<Options>();
let held: (() => number) | null = null;

/** Keeps them, after calling itself depth times. */
export function keep(options: Options, depth: i32): void {
	big();
	if (depth > 0) keep(options, depth - 1);
	else saved = options;
}

/** Keeps them two calls down, and calls itself on the way. */
export function pass(options: Options, depth: i32): void {
	big();
	if (depth > 0) pass(options, depth - 1);
	else keep(options, 0);
}

let savedColor: number[] | null = null;

/** Keeps a word read from its options - their colour - after calling itself depth times. */
export function keepColor(options: Options, depth: i32): void {
	big();
	if (depth > 0) keepColor(options, depth - 1);
	else savedColor = options.color;
}

export function capture(options: Options): void {
	big();
	held = () => options.value;
}

export function push(options: Options): void {
	big();
	list.push(options);
}

export function catchKeeps(options: Options, fail: bool): void {
	big();
	try {
		if (fail) throw new Error("no");
	} catch (error) {
		saved = options;
	}
}

/** Literals given to a function that only reads them: none allocated. */
export function given(count: number): number {
	let sum = 0;
	for (let i = 0; i < count; i++) sum += read({ value: i, color: [i, 2, 3] });
	return sum + read({ value: 1 });
}

/** A literal in the frame given a string by a function it is given to, across a collection: the collector reads it. */
export function heldAcross(count: number): number {
	let sum = 0;
	for (let i = 0; i < count; i++) sum += readAcross({ value: i });
	return sum;
}

// Literals that leave, each case on its own: 1 where it read a wrong value.
// Made by one literal turned twice, so the two would share a place in the
// frame.

export function kept(): i32 {
	let first: Options | null = null;
	for (let i = 1; i <= 2; i++) {
		keep({ value: i }, 1);
		if (i == 1) first = saved;
	}
	__collect();
	return first!.value != 1 || saved!.value != 2 ? 1 : 0;
}

export function keptTwoDown(): i32 {
	let first: Options | null = null;
	for (let i = 1; i <= 2; i++) {
		pass({ value: i }, 1);
		if (i == 1) first = saved;
	}
	__collect();
	return first!.value != 1 || saved!.value != 2 ? 1 : 0;
}

export function keptInside(): i32 {
	let first: number[] | null = null;
	for (let i = 1; i <= 2; i++) {
		keepColor({ color: [i, 2, 3] }, 1);
		if (i == 1) first = savedColor;
	}
	__collect();
	return first![0] != 1 || savedColor![0] != 2 ? 1 : 0;
}

export function captured(): i32 {
	let first: (() => number) | null = null;
	for (let i = 1; i <= 2; i++) {
		capture({ value: i });
		if (i == 1) first = held;
	}
	__collect();
	return first!() != 1 || held!() != 2 ? 1 : 0;
}

export function pushed(): i32 {
	for (let i = 1; i <= 2; i++) push({ value: i });
	__collect();
	return list[0].value != 1 || list[1].value != 2 ? 1 : 0;
}

export function caught(): i32 {
	let first: Options | null = null;
	for (let i = 1; i <= 3; i++) {
		catchKeeps({ value: i }, i != 2);
		if (i == 1) first = saved;
	}
	__collect();
	return first!.value != 1 || saved!.value != 3 ? 1 : 0;
}

/** A closure the global alone keeps, then objects made after it would take its place were it freed. */
export function capturedThenCaught(): i32 {
	return captured() | caught() | (held!() != 2 ? 1 : 0);
}
`;

test('a literal given to a function that only reads it is made in the caller\'s frame, one the callee keeps on the heap', async () => {
	const files = { 'probe.ts': LITERALS };
	const { error, exports } = await probe(files, OFTEN, { touch() {} }, true);
	expect(error).toBe('');

	// value + color[0] + its length, for 0..999, then 1.
	expect(exports.given(1000)).toBe(2 * 499500 + 1000 * 3 + 1);
	exports.collect();
	expect(exports.freed.value).toBe(0);

	// "a0".."a9": length 2, 'a' 97.
	expect(exports.heldAcross(10)).toBe(10 * (2 + 97));

	for (const leaving of ['kept', 'keptTwoDown', 'keptInside', 'captured', 'pushed', 'caught', 'capturedThenCaught']) expect([leaving, exports[leaving]()]).toEqual([leaving, 0]);
});
