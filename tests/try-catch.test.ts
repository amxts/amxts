/**
 * `try`/`catch`/`finally` as in JavaScript: a throw - in the same function,
 * in one it calls, in a closure, in the library - reaches the catch with its
 * Error; `finally` runs however the try is left; a throw outside every try
 * still ends the call. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, exports, run: () => (error ? 0 : exports.run() as number), text: () => (error ? '' : string(exports.text())) };
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a throw in the try reaches the catch with its Error; what follows the throw does not run', async () => {
			const { error, text } = await compile(`
export function text(): string {
	let out = "";
	try {
		out += "a";
		throw new RangeError("too far");
		out += "b";
	} catch (e) {
		out += e.name + ":" + e.message;
	}
	return out + ";";
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('aRangeError:too far;');
		});

		test('a throw in a called function unwinds through its callers to the catch', async () => {
			const { error, text } = await compile(`
let log = "";
function deep(n: number): number {
	if (n == 0) throw new Error("bottom");
	const below = deep(n - 1);
	log += "never";
	return below + 1;
}
function middle(): string {
	const value = deep(3);
	log += "never";
	return value.toString();
}
export function text(): string {
	try {
		log += middle();
	} catch (error) {
		log += "caught " + error.message;
	}
	return log;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('caught bottom');
		});

		test('finally runs after the try, after the catch, and on a return from either', async () => {
			const { error, text } = await compile(`
let log = "";
function plain(): void {
	try { log += "t"; } finally { log += "f"; }
}
function caught(): void {
	try { throw new Error("x"); } catch (e) { log += "c"; } finally { log += "f"; }
}
function returns(): string {
	try {
		return value("r");
	} finally {
		log += "F";
	}
}
function returnsFromCatch(): number {
	try {
		throw new Error("x");
	} catch (e) {
		return 7;
	} finally {
		log += "G";
	}
}
function value(text: string): string {
	log += text;
	return text;
}
export function text(): string {
	plain();
	log += "|";
	caught();
	log += "|";
	const r = returns();
	const n = returnsFromCatch();
	log += "|" + r + "|" + n.toString();
	return log;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('tf|cf|rFG|r|7');
		});

		test('break and continue out of a try run its finally', async () => {
			const { error, text } = await compile(`
export function text(): string {
	let log = "";
	for (let i = 0; i < 5; i++) {
		try {
			if (i == 1) continue;
			if (i == 3) break;
			log += i.toString();
		} finally {
			log += "f";
		}
	}
	return log;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('0ff2ff');
		});

		test('a finally without a catch lets the error on to the try around it; a catch may throw again', async () => {
			const { error, text } = await compile(`
let log = "";
function inner(): void {
	try {
		throw new Error("first");
	} finally {
		log += "finally;";
	}
}
export function text(): string {
	try {
		try {
			inner();
		} catch (e) {
			log += "inner " + e.message + ";";
			throw new Error("second");
		}
	} catch (e) {
		log += "outer " + e.message;
	}
	return log;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('finally;inner first;outer second');
		});

		test('an error thrown in a closure the library calls reaches the catch around the call', async () => {
			const { error, text } = await compile(`
export function text(): string {
	let seen = "";
	try {
		[1, 2, 3].forEach((n) => {
			seen += n.toString();
			if (n == 2) throw new Error("at " + n.toString());
		});
	} catch (e) {
		seen += " " + e.message;
	}
	return seen;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('12 at 2');
		});

		test('what the library throws is caught: an index out of range, JSON that is not, toFixed', async () => {
			const { error, text } = await compile(`
function name(run: () => void): string {
	try {
		run();
		return "none";
	} catch (e) {
		return e.name;
	}
}
export function text(): string {
	const list = [1, 2];
	return name(() => { list[5]; }) + "," + name(() => { JSON.parse<number>("{"); }) + "," + name(() => { (1).toFixed(101); });
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('RangeError,SyntaxError,RangeError');
		});

		test('a null where an object must be and a variable read before its declaration are errors a catch takes', async () => {
			const { error, text } = await compile(`
class Box { value: number = 1; }
let empty: Box | null = null;
function tdz(): number {
	const read = () => late;
	const first = read();
	const late = 3;
	return first;
}
function name(run: () => void): string {
	try {
		run();
		return "none";
	} catch (e) {
		return e.name;
	}
}
export function text(): string {
	return name(() => { empty!.value; }) + "," + name(() => { tdz(); }) + "," + name(() => { new Box().value; });
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('TypeError,ReferenceError,none');
		});

		test('a string thrown is an Error with it as the message; catch without a binding; catch (e: unknown)', async () => {
			const { error, text } = await compile(`
export function text(): string {
	let out = "";
	try { throw "plain text"; } catch (e: unknown) { out += (e as Error).message; }
	try { throw new Error("x"); } catch { out += "|no binding"; }
	return out;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('plain text|no binding');
		});

		test('an Error of its own class is caught as itself', async () => {
			const { error, run } = await compile(`
class NotFound extends Error {
	constructor(public id: number) {
		super("not found");
		this.name = "NotFound";
	}
}
function find(id: number): number {
	if (id > 10) throw new NotFound(id);
	return id;
}
export function run(): f64 {
	try {
		return find(3) + find(42);
	} catch (e) {
		if (e instanceof NotFound) return e.id;
		return -1;
	}
}
`, optimize);
			expect(error).toBe('');
			expect(run()).toBe(42);
		});

		test('a throw outside every try still ends the call, before and after one was caught', async () => {
			const { error, exports } = await compile(`
export function caught(): i32 {
	try { throw new Error("x"); } catch (e) { return 1; }
}
export function uncaught(): i32 {
	throw new Error("out");
}
export function after(): i32 {
	caught();
	uncaught();
	return 2;
}
`, optimize);
			expect(error).toBe('');
			expect(exports.caught()).toBe(1);
			expect(() => exports.uncaught()).toThrow();
			expect(exports.caught()).toBe(1);
			expect(() => exports.after()).toThrow();
		});

		test('a value a function would have returned is not seen: the caller unwinds on', async () => {
			const { error, text } = await compile(`
class Box { constructor(public text: string) {} }
function make(fail: boolean): Box {
	if (fail) throw new Error("no box");
	return new Box("box");
}
export function text(): string {
	let out = "";
	for (const fail of [false, true, false]) {
		try {
			out += make(fail).text;
		} catch (e) {
			out += "(" + e.message + ")";
		}
	}
	return out;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('box(no box)box');
		});
	});
}
