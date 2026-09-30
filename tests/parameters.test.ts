/**
 * Parameters written as TypeScript writes them:
 *
 * - `flashCount = -1` - the type read off the default, as for a field;
 * - `player?: Player` - optional with no default, null when left out;
 * - `times?: number`, `loud?: boolean` - undefined when left out, as an
 *   optional property is.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string) {
	const { error, exports } = await probe({ 'probe.ts': body });
	return { error, run: () => (error ? 0 : exports.run() as number) };
}

test('a default says the type: a number, a fraction, a string, a boolean', async () => {
	const { error, run } = await compile(`
function give(flash = -1, smoke = 2, scale = 0.5, name = "he", loud = false): f64 {
	return flash + smoke + scale + <f64>name.length + (loud ? 100 : 0);
}
export function run(): f64 { return give() + give(1, 1, 1.0, "", true); }
`);
	expect(error).toBe('');
	expect(run()).toBe(3.5 + 103);
});

test('an optional object parameter is null when left out', async () => {
	const { error, run } = await compile(`
class Player { id: i32 = 7; }
function knife(player?: Player): i32 { return player ? player.id : 0; }
export function run(): i32 { return knife() * 10 + knife(new Player()); }
`);
	expect(error).toBe('');
	expect(run()).toBe(7);
});

test('an optional number left out is undefined: `??` and `=== undefined` see it', async () => {
	const { error, run } = await compile(`
function count(times?: number): f64 { return times ?? 5; }
function given(times?: number): f64 { return times === undefined ? 0 : 1; }
export function run(): f64 { return count() * 100 + count(2) * 10 + given() + given(0); }
`);
	expect(error).toBe('');
	expect(run()).toBe(521);
});

test('an optional boolean left out is undefined: `??`, `=== undefined`, `=== false` and a template see it', async () => {
	const { error, run } = await compile(`
function loudness(loud?: boolean): f64 {
	const quiet = loud === false ? 1000 : 0;
	const unset = loud === undefined ? 100 : 0;
	return quiet + unset + ((loud ?? true) ? 10 : 0) + (\`\${loud}\` == "undefined" ? 1 : 0);
}
function later(loud?: boolean): f64 {
	loud = loud ?? false;
	return loud === undefined ? 1 : 0;
}
export function run(): f64 { return loudness() * 10000 + loudness(false) * 10 + loudness(true) + later(); }
`);
	expect(error).toBe('');
	expect(run()).toBe(111 * 10000 + 1000 * 10 + 10);
});

test('an optional boolean read into a variable keeps whether it was given', async () => {
	const { error, run } = await compile(`
class Options { loud?: boolean; }
class Copy { loud?: boolean; }
function level(options: Options): f64 {
	const loud = options.loud;
	const same = loud;
	const copy: Copy = { loud: same };
	const also = new Copy();
	also.loud = loud;
	return ((loud ?? true) ? 1 : 0) + (same === undefined ? 10 : 0) + ((copy.loud ?? true) ? 100 : 0) +
		(also.loud === undefined ? 1000 : 0) + (\`\${loud}\` == "undefined" ? 10000 : 0);
}
export function run(): f64 {
	const quiet: Options = { loud: false };
	return level({}) * 100000 + level(quiet);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11111 * 100000);
});

test('an optional parameter left out leaves an object literal\'s field at its default', async () => {
	const { error, run } = await compile(`
class Options { label?: string = "none"; }
function describe(label?: string): i32 {
	const options: Options = { label };
	return options.label!.length;
}
export function run(): i32 { return describe() * 10 + describe("ab"); }
`);
	expect(error).toBe('');
	expect(run()).toBe(42);
});
