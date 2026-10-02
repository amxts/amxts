/**
 * The temporal dead zone: a let or const read before its declaration has run
 * aborts with "ReferenceError: x is not initialized", as JavaScript throws, rather
 * than reading 0. Only a variable a read can reach early pays for the check.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { compileSources } from '../src/testing/compile';

declare const WebAssembly: any;

async function compile(body: string, optimize: boolean, extra: string[] = []) {
	const { error, binary, text: written } = await compileSources(['probe.ts', '--outFile', 'probe.wasm', '--textFile', 'probe.wat', ...(optimize ? ['-O3'] : []), ...extra], { 'probe.ts': body });
	if (error) throw new Error(error);
	const text = written['probe.wat'] ?? '';

	let memory: any;
	const string = (pointer: number) => {
		const length = new Uint32Array(memory.buffer)[(pointer - 4) >>> 2] >>> 1;
		return String.fromCharCode(...new Uint16Array(memory.buffer, pointer, length));
	};
	const instance = new WebAssembly.Instance(new WebAssembly.Module(binary!), {
		env: {
			seed: () => 1,
			abort(message: number, file: number, line: number) {
				throw new Error(`${string(message)} (${string(file)}:${line})`);
			},
		},
	});
	memory = instance.exports.memory;
	return {
		wat: text,
		call(name: string): string {
			try {
				return String(instance.exports[name]());
			} catch (error) {
				return (error as Error).message;
			}
		},
	};
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a hoisted function called above the variable it reads', async () => {
			const module = await compile(`
export function early(): f64 {
	const value = read();
	let x = 5.0;
	function read(): f64 { return x; }
	return value;
}
export function late(): f64 {
	let x = 5.0;
	function read(): f64 { return x; }
	return read();
}
`, optimize);
			expect(module.call('early')).toBe('ReferenceError: x is not initialized (probe.ts:5)');
			expect(module.call('late')).toBe('5');
		});

		test('an arrow written above the variable, called before and after it', async () => {
			const module = await compile(`
export function before(): f64 {
	const read = (): f64 => x;
	const value = read();
	let x = 5.0;
	return value;
}
export function after(): f64 {
	const read = (): f64 => x;
	let x = 5.0;
	return read();
}
`, optimize);
			expect(module.call('before')).toBe('ReferenceError: x is not initialized (probe.ts:3)');
			expect(module.call('after')).toBe('5');
		});

		test('a closure its own initializer calls', async () => {
			const module = await compile(`
function now(fn: () => i32): i32 { return fn(); }
export function run(): i32 {
	const value: i32 = now(() => value + 1);
	return value;
}
`, optimize);
			expect(module.call('run')).toBe('ReferenceError: value is not initialized (probe.ts:4)');
		});

		test('a function above a top-level variable reads it once the declaration has run', async () => {
			const module = await compile(`
let saved: (() => i32) | null = null;
function keep(fn: () => i32): i32 { saved = fn; return 1; }
const timer: i32 = keep(() => timer + 1);
function readLate(): f64 { return late; }
const late: f64 = Math.floor(Math.random()) + 2;

export function run(): f64 { return <f64>saved!() * 10 + readLate(); }
`, optimize);
			expect(module.call('run')).toBe('22');
		});
	});
}

test('a top-level variable read above its declaration while the file runs', async () => {
	const module = await compile(`
function readLate(): f64 { return late; }
const early: f64 = readLate();
const late: f64 = Math.floor(Math.random()) + 2;
export function run(): f64 { return early; }
`, false, ['--exportStart', 'start']);
	expect(module.call('start')).toBe('ReferenceError: late is not initialized (probe.ts:2)');
});

test('a variable no read can reach early has no check', async () => {
	const module = await compile(`
export function run(): f64 {
	let x = 5.0;
	const read = (): f64 => x;
	x = 6;
	return read();
}
`, false);
	expect(module.call('run')).toBe('6');
	expect(module.wat).not.toContain('is not initialized');
});
