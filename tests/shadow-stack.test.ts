/**
 * The collector and the shadow stack: a function that cannot run the
 * collector keeps no frame, and what a function holds across one that can
 * still lives. Collected as often as it can be - a short step on every
 * allocation, and a full collection where the test makes garbage - and an
 * object freed has its value overwritten, so one a frame failed to keep
 * shows it. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { compileSources } from '../src/testing/compile';
import { probe } from './probe';

const OFTEN = ['--use', 'ASC_GC_STRESS=1', '--use', 'ASC_GC_GRANULARITY=16'];

const SOURCE = `
// @ts-ignore: decorator
@global function __finalize(ptr: usize): void {
	store<i32>(ptr, -999);
}

class Node {
	constructor(public value: i32) {}
}
class Holder {
	tag: i32;
	child: Node | null = null;
	constructor(tag: i32) {
		this.tag = tag;
	}
}

// An array whose elements are in its own object, as a Vector's are.
class Three extends Array<f64> {
	private room0: f64;
	private room1: f64;
	private room2: f64;
	constructor(x: f64) {
		super(3, true);
		const self = changetype<usize>(this);
		store<usize>(self, self, offsetof<ArrayBufferView>("buffer"));
		store<usize>(self, self + offsetof<Three>("room0"), offsetof<ArrayBufferView>("dataStart"));
		store<i32>(self, 24, offsetof<ArrayBufferView>("byteLength"));
		store<f64>(this.dataStart, x);
	}
}

let kept: Holder | null = null;

/** Allocates nodes nobody keeps, then collects all there is to collect. */
function garbage(count: i32): i32 {
	let sum = 0;
	for (let i = 0; i < count; i++) sum += new Node(-1).value;
	__collect();
	return sum;
}

// None of these can collect: no frame, and no slots for their arguments.
function take(holder: Holder): Node {
	const child = holder.child!;
	holder.child = null;
	return child;
}
function takeKept(): Holder {
	const holder = kept!;
	kept = null;
	return holder;
}
function plus(node: Node, value: i32): i32 {
	return node.value * 1000 + value;
}

function both(a: Node, b: Node): i32 {
	garbage(500);
	return a.value * 1000 + b.value;
}

function make(value: i32): Node {
	garbage(500);
	return new Node(value);
}

export function run(): i32 {
	let failed = 0;

	// What a frameless function gives back, held by its caller alone.
	const holder = new Holder(1);
	holder.child = new Node(7);
	const child = take(holder);
	garbage(1000);
	if (child.value != 7) failed |= 1;

	// An argument a frameless call gave, while the next argument allocates.
	const second = new Holder(2);
	second.child = new Node(5);
	if (both(take(second), new Node(9)) != 5009) failed |= 2;

	// The same into a frameless callee: the first argument still needs its slot.
	const third = new Holder(3);
	third.child = new Node(4);
	if (plus(take(third), make(6).value) != 4006) failed |= 4;

	// An object a frameless call took from a global, written to while allocating.
	kept = new Holder(8);
	const owner = takeKept();
	owner.child = make(3);
	garbage(1000);
	if (owner.tag != 8 || owner.child!.value != 3) failed |= 8;

	// A value carried from one iteration to the next, across allocations.
	let last = new Node(0);
	for (let i = 1; i < 50; i++) {
		const next = make(i);
		if (last.value != i - 1) failed |= 16;
		last = next;
	}

	// Closures made while allocating: each environment is a plain pointer
	// to the call that makes the closure, held by nothing else meanwhile.
	let words = "";
	for (let i = 0; i < 20; i++) {
		const word = "w" + i.toString();
		const add = (): void => {
			words += word;
		};
		garbage(20);
		add();
	}
	if (words != "w0w1w2w3w4w5w6w7w8w9w10w11w12w13w14w15w16w17w18w19") failed |= 64;

	// The same, the closure an argument of the call that runs it.
	let seen = "";
	[1, 2, 3].forEach((n) => {
		seen += n.toString();
	});
	if (seen != "123") failed |= 128;

	// A caught error, and what the function held before the throw.
	const before = new Node(11);
	let caught = 0;
	try {
		throwAfter(200);
	} catch (e) {
		caught = 1;
	}
	garbage(1000);
	if (caught != 1 || before.value != 11) failed |= 32;

	// An array in its own object, across collections and grown out of it.
	const three = new Three(5);
	garbage(1000);
	three.push(6);
	garbage(1000);
	if (three[0] != 5 || three[2] != 0 || three[3] != 6 || three.length != 4) failed |= 256;

	return failed;
}

function throwAfter(count: i32): void {
	garbage(count);
	throw new Error("thrown");
}

// Closures a global alone keeps - a variable or a static field - made after
// a catch, inside a try, before a rethrow.
let held: (() => i32) | null = null;
class Handlers {
	static last: (() => i32) | null = null;
}

function capture(node: Node): void {
	held = () => node.value;
}

function captureAfterCatch(node: Node): void {
	try {
		throwAfter(10);
	} catch (e) {
		held = () => node.value;
	}
}

function captureInTry(node: Node): void {
	try {
		Handlers.last = () => node.value;
		throwAfter(10);
	} catch (e) {}
}

function captureAndRethrow(node: Node): void {
	try {
		try {
			throwAfter(10);
		} catch (e) {
			held = () => node.value;
			throw e;
		}
	} catch (e) {}
}

// A template of three parts or more is joined from a static array the
// collector never visits: a part made for it is held by its local alone,
// the second here, which nothing else reads after the array is filled.
function word(i: i32): string {
	return "w" + i.toString();
}

export function templateParts(): i32 {
	const text = \`\${word(1)} \${word(2)}.\`;
	return text == "w1 w2." ? 0 : 1;
}

export function heldByGlobals(): i32 {
	let failed = 0;
	capture(new Node(21));
	garbage(1000);
	if (held!() != 21) failed |= 1;
	captureAfterCatch(new Node(22));
	garbage(1000);
	if (held!() != 22) failed |= 2;
	captureInTry(new Node(23));
	garbage(1000);
	if (Handlers.last!() != 23) failed |= 4;
	captureAndRethrow(new Node(24));
	garbage(1000);
	if (held!() != 24) failed |= 8;
	return failed;
}
`;

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('what a function holds survives collections, with or without a frame', async () => {
			const { error, exports } = await probe({ 'probe.ts': SOURCE }, [...OFTEN, ...(optimize ? ['-O3'] : [])]);
			expect(error).toBe('');
			expect(exports.run()).toBe(0);
		});

		test('a closure a global alone keeps survives collections', async () => {
			const { error, exports } = await probe({ 'probe.ts': SOURCE }, [...OFTEN, ...(optimize ? ['-O3'] : [])]);
			expect(error).toBe('');
			expect(exports.heldByGlobals()).toBe(0);
		});

		// A whole cycle of the collector on every allocation: the join's frees what nothing keeps.
		test('the parts of a template live until it is joined', async () => {
			const { error, exports } = await probe({ 'probe.ts': SOURCE }, [...OFTEN, '--use', 'ASC_GC_SWEEPFACTOR=1000000', ...(optimize ? ['-O3'] : [])]);
			expect(error).toBe('');
			expect(exports.templateParts()).toBe(0);
		});
	});
}

test('a call to an import marked @leaf keeps no frame, a call to another one does', async () => {
	const source = `
class Box {
	constructor(public value: i32) {}
}
let box = new Box(1);
// @ts-ignore: decorator
@external("env", "leaf") @leaf declare function leaf(at: usize): void;
// @ts-ignore: decorator
@external("env", "plain") declare function plain(at: usize): void;
export function viaLeaf(): i32 {
	const held = box;
	leaf(changetype<usize>(held));
	return held.value;
}
export function viaPlain(): i32 {
	const held = box;
	plain(changetype<usize>(held));
	return held.value;
}
`;
	const { error, text } = await compileSources(['probe.ts', '--outFile', 'probe.wasm', '--textFile', 'probe.wat'], { 'probe.ts': source });
	expect(error).toBeNull();
	const body = (name: string) => text['probe.wat'].split(`(func $probe/${name} `)[1].split('\n (func ')[0];
	expect(body('viaLeaf')).not.toContain('__stack_pointer');
	expect(body('viaPlain')).toContain('__stack_pointer');
});
