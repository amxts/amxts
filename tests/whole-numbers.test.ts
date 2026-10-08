/**
 * The compiler keeps a `number` local that only ever holds a whole number
 * within i32 in an i32 local, and its arithmetic in i32. Each probe of
 * whole-numbers-probe.ts is run compiled and as JavaScript, from the same
 * source: the answers must be the same to the bit - -0, NaN and a sum past
 * 2^31 included.
 */
import { readFileSync } from 'node:fs';
import binaryen from 'binaryen';
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { compileSources } from '../src/testing/compile';
import * as javascript from './whole-numbers-probe';

declare const WebAssembly: any;

setDefaultTimeout(120_000);

const SOURCE = readFileSync('tests/whole-numbers-probe.ts', 'utf8');

const NAMES = [...SOURCE.matchAll(/export function (\w+)/g)].map(match => match[1]);

/** The probe compiled as a full build compiles a plugin; its exports, and its text. */
async function compiled() {
	const { error, binary } = await compileSources(['probe.ts', '--outFile', 'probe.wasm', '-O3', '--debug'], { 'probe.ts': SOURCE }, true);
	expect(error ?? '').toBe('');
	const exports = new WebAssembly.Instance(new WebAssembly.Module(binary!), { env: { abort() {} } }).exports as Record<string, () => number>;
	return { exports, text: binaryen.readBinary(binary!).emitText() };
}

test('whole numbers in i32 give what JavaScript gives, to the bit', async () => {
	const { exports } = await compiled();
	const expected = javascript as unknown as Record<string, () => number>;
	for (const name of NAMES) {
		const got = exports[name]();
		const want = expected[name]();
		expect(Object.is(got, want) ? want : `${name}: ${got}`).toBe(want);
	}
});

test('a loop over whole numbers within i32 runs in i32: no f64, no Math.mod', async () => {
	const { text } = await compiled();
	const body = (name: string) => text.slice(text.indexOf(`(func $probe/${name} `), text.indexOf('\n )\n', text.indexOf(`(func $probe/${name} `)));
	for (const name of ['divisors', 'primes', 'powers']) {
		expect(body(name)).not.toContain('NativeMath.mod');
		expect(body(name)).not.toContain('i32.trunc_sat_f64_s');
	}
	// What is not proven stays f64.
	expect(body('pastI32')).toContain('f64.add');
	expect(body('counterPastI32')).toContain('f64.lt');
	expect(body('halves')).toContain('(f64.const 0.5)');
});
