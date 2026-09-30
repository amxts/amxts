import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import binaryen from 'binaryen';
/**
 * async/await, Promise and AbortSignal, compiled as a plugin is and run under
 * tests/async-host.ts - the module's coroutine scheduler, in JavaScript.
 *
 * The fixture is tests/as/async.ts: each export is one scenario, and what it
 * prints is what is checked. Time is the host's own clock, moved with
 * `advance(ms)`, so a sleep of a second takes no second.
 */
// @ts-ignore - bun:test types not available during type checking
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { importsOf } from '../scripts/compile';
import { compileWasmFile } from '../src/testing/compile';
import { AsyncHost } from './async-host';

setDefaultTimeout(300_000);

const out = join(tmpdir(), 'amxts-async-test');
mkdirSync(out, { recursive: true });

let fixture: Uint8Array;

beforeAll(async () => {
	const wasm = join(out, 'async.wasm');
	const problem = await compileWasmFile({ source: 'tests/as/async.ts', root: 'as' }, wasm, true);
	if (problem) throw new Error(problem);
	fixture = readFileSync(wasm);
});

/** A fresh plugin instance, a scenario run, and what it printed since. */
function run(...steps: (string | number | [string, number])[]) {
	const host = new AsyncHost(fixture);
	for (const step of steps) {
		if (typeof step === 'number') host.advance(step);
		else if (Array.isArray(step)) host.fire(step[0], step[1]);
		else host.call(step);
	}
	return host;
}

describe('semantics', () => {
	test('a call without await does not wait, and coroutines finish in their own time', () => {
		const host = run('ordering');
		expect(host.log.splice(0)).toEqual(['a start', 'b start', 'sync end']);
		expect(host.parked).toBe(2);

		host.advance(100);
		expect(host.log.splice(0)).toEqual(['b after 100']);
		host.advance(100);
		expect(host.log.splice(0)).toEqual(['a after 200']);
		expect(host.parked).toBe(0);
	});

	test('a .catch that answers with a value can be awaited', () => {
		const host = run('recovery', 20);
		expect(host.log).toEqual(['recovered: ENOENT: gone', 'late: -1']);
	});

	test('an async function gives its value through await, and to .then', () => {
		const host = run('values', 50);
		expect(host.log).toEqual(['inner start', 'inner after 50', 'inner gave 100', 'then got 100!']);
	});

	test('Promise.all keeps the order of the list, Promise.race takes the first', () => {
		const host = run('combinators', 100);
		expect(host.log).toContain('all: 60 20');
		expect(host.log).toContain('race: 40');
		expect(host.log.indexOf('y after 10')).toBeLessThan(host.log.indexOf('x after 30'));
	});

	test('await takes a plain value, Promise.all too, and for await awaits each item', () => {
		const host = run('plain', 100);
		expect(host.log).toContain('for await: b');
		expect(host.log).toContain('plain: 5 20 7 60');
	});

	test('Promise.all of different types gives a tuple, read by destructuring', () => {
		const host = run('tuples', 100);
		expect(host.log).toContain('all mixed: 40 s');
		expect(host.log).toContain('all with a sleep: v');
		expect(host.log).toContain('all of one type: a,b (2)');
		expect(host.log).toContain('all rejected: tuple');
		expect(host.log.some(line => line.includes('Unhandled'))).toBe(false);
	});

	test('Promise.race of different types: nullable beside a sleep, a common base class otherwise', () => {
		const host = run('mixedRace', 100);
		expect(host.log).toEqual(['race: timed out', 'race: boxed', 'race of a base class: tom']);
	});

	test('Promise.race and any of a count and a number give a number', () => {
		const host = run('numberRace', 100);
		expect(host.log).toEqual(['race of numbers: 3 5 3']);
	});

	test('Promise.allSettled says how each settled, for a list and for a tuple', () => {
		const host = run('settled', 100);
		expect(host.log).toEqual([
			'yes start',
			'yes after 5',
			'settled: no',
			'settled: 10',
			'settled mixed: rejected bad, fulfilled good',
		]);
	});

	test('Promise.any takes the first value, and rejects with an AggregateError when all reject', () => {
		const host = run('anyOf', 100);
		expect(host.log).toEqual([
			'won start',
			'any rejected: AggregateError 2 y',
			'won after 20',
			'any: 40',
			'any of a base class: rex',
		]);
	});

	test('Array#find and findLast give the element or null', () => {
		const host = run('find');
		expect(host.log).toEqual(['find: rex max none']);
	});

	test('a rejection reaches .catch, through an await that passes it on', () => {
		const host = run('rejections', 30);
		expect(host.log).toEqual(['catch: caught', 'passed on: deep']);
	});

	test('throw in an async function rejects its promise with the error thrown', () => {
		const host = run('throws', 10);
		expect(host.log).toEqual(['catch: at once', 'catch: RangeError thrown', 'passed on: awaited']);
	});

	test('try around await: a rejection reaches the catch, finally runs, and the value returns', () => {
		const host = run('tryAwait', 50);
		for (const line of [
			'guarded value 1',
			'guarded finally ',
			'first gave 1',
			'guarded caught bad',
			'guarded finally bad',
			'second gave -1',
			'inside caught RangeError inside',
			'again caught again',
			'rejected with after the tries',
		]) expect(host.log).toContain(line);
		expect(host.log.indexOf('guarded value 1')).toBeLessThan(host.log.indexOf('guarded finally '));
		expect(host.log.indexOf('guarded finally ')).toBeLessThan(host.log.indexOf('first gave 1'));
		expect(host.log.some(line => line.includes('Unhandled'))).toBe(false);
		expect(host.parked).toBe(0);
	});

	test('a rejection nobody handles is one line, as in Node', () => {
		const host = run('unhandled', 30);
		expect(host.log).toEqual(['error: Unhandled promise rejection: nobody']);
	});

	test('a closure awaits and keeps the variables around it; a closure in an async function keeps its locals across an await', () => {
		const host = run('closureAwaits');
		expect(host.log.splice(0)).toEqual([]);
		host.advance(10);
		expect(host.log.splice(0)).toEqual(['closure 1 after 10']);
		host.advance(10);
		expect(host.log.splice(0)).toEqual(['closure 2 after 20']);

		const counted = run('awaitsAroundClosure');
		expect(counted.log.splice(0)).toEqual(['async local 1']);
		counted.advance(10);
		expect(counted.log).toEqual(['async local 2']);
	});

	test('a parked closure keeps what it captured through a collection', () => {
		const host = run('parkedClosure', 'collect', 20);
		expect(host.log).toEqual(['held 42']);
	});

	test('the resolve of an executor, called by a later callback that captured it', () => {
		const host = run('executorClosure', 10);
		expect(host.log).toEqual(['resolved late']);
	});

	test('new Promise(executor) wraps a callback: its resolve can be kept and called later', () => {
		const host = run('wrapped');
		expect(host.log.splice(0)).toEqual(['asked']);
		host.call('reply');
		expect(host.log).toEqual(['answered: yes']);
	});

	test('abort() and AbortSignal.timeout give a sleep up, quietly', () => {
		const host = run('aborts');
		expect(host.log.splice(0)).toEqual(['listener: abort', 'sleep: AbortError']);
		host.advance(100);
		expect(host.log).toEqual(['timeout: TimeoutError']);
	});

	test('a coroutine a player started ends when that player leaves, and no other', () => {
		const host = run('forPlayer');
		expect(host.log.splice(0)).toEqual(['greeting 7', 'greeting 8']);
		host.fire('client_disconnected', 7);
		expect(host.parked).toBe(1);
		host.advance(600);
		// No "Unhandled promise rejection": an abort is expected.
		expect(host.log).toEqual(['still here 8']);
	});

	test('what a parked coroutine holds survives a collection', () => {
		const host = run('survives', 'collect', 20);
		expect(host.log).toEqual(['kept 42 two', 'kept 42 two']);
	});

	test('an async function where a listener goes: named or written in place', () => {
		const host = run('asListener');
		expect(host.log.splice(0)).toEqual(['arrow 3 before']);
		host.advance(10);
		expect(host.log).toEqual(['listener 3', 'arrow 3 after']);
	});

	test('an async method, with `this`', () => {
		const host = run('method', 10);
		expect(host.log).toEqual(['counter 2']);
	});

	test('an async game listener answers the chain only before its first await', () => {
		const host = run('answerEarly');
		host.fireHooks();
		// SetHookChainReturn(ATYPE_FLOAT, 0) through the dispatcher, then handled().
		expect(host.log.length).toBe(2);
		expect(host.log[0]).toMatch(/^native \d+ with 2 argument\(s\)$/);
		expect(host.log[1]).toBe('outcome 1');

		host.log.length = 0;
		host.call('answerLate');
		host.fireHooks();
		expect(host.log).toEqual([]);
		host.advance(10);
		expect(host.log).toEqual(['late answer given']);
	});

	test('an error the library throws in an async function rejects its promise with it', () => {
		const host = run('rangeError', 10);
		expect(host.log).toEqual(['rejected: RangeError']);
		expect(host.parked).toBe(0);
	});

	test('a trap after an await drops that coroutine and nothing else', () => {
		const host = run('trap', 10);
		expect(host.log.some(line => line.startsWith('trap:'))).toBe(true);
		expect(host.parked).toBe(0);
		host.log.length = 0;
		host.call('ordering');
		host.advance(200);
		expect(host.log).toContain('a after 200');
	});
});

/** Writes `source` as a plugin beside the fixture and compiles it; the error text, or null. */
async function compileSnippet(name: string, source: string) {
	const file = join(out, `${name}.ts`);
	writeFileSync(file, source);
	return compileWasmFile({ source: file, root: 'as' }, join(out, `${name}.wasm`));
}

describe('compiler', () => {
	test('an async function returns Promise<T> of what it returns', async () => {
		expect(await compileSnippet('typed', [
			'import { sleep } from "~/facade";',
			'async function f() { await sleep(1); return "text"; }',
			'const p: Promise<string> = f();',
			'export function g(): void { p.then((text) => console.log(text)); }',
		].join('\n'))).toBeNull();

		const wrong = await compileSnippet('typed-wrong', [
			'async function f() { return "text"; }',
			'const s: string = f();',
		].join('\n'));
		expect(wrong).toContain('Promise');
	});

	test('await outside an async function is an error', async () => {
		const problem = await compileSnippet('await-outside', [
			'import { sleep } from "~/facade";',
			'function f() { await sleep(1); }',
			'f();',
		].join('\n'));
		expect(problem).toContain('TS1308');
	});

	test('an async function that says it returns anything but a Promise is an error', async () => {
		const problem = await compileSnippet('not-promise', 'async function f(): number { return 1; }\nf();');
		expect(problem).toContain('TS1064');
	});

	test('Promise.race of values that share no type says to await them one by one', async () => {
		const problem = await compileSnippet('race-mixed', [
			'async function a() { return 1; }',
			'async function b() { return "x"; }',
			'async function f() { const first = await Promise.race([a(), b()]); console.log(`${first}`); }',
			'f();',
		].join('\n'));
		expect(problem).toContain('Promise.race of \'number\' and \'string\'');
		expect(problem).toContain('Await them one by one');
		expect(problem).not.toContain('TS1140');
	});

	test('a tuple has no element past its end', async () => {
		const problem = await compileSnippet('tuple-index', [
			'async function a() { return 1; }',
			'async function b() { return "x"; }',
			'async function f() { const [x, y, z] = await Promise.all([a(), b()]); }',
			'f();',
		].join('\n'));
		expect(problem).toContain('Tuple type \'[number, string]\' of length \'2\' has no element at index \'2\'');
	});

	test('a plugin without async is compiled as it always was', async () => {
		const wasm = join(out, 'hello.wasm');
		expect(await compileWasmFile({ source: 'runtime/host/hello.ts', root: 'as' }, wasm)).toBeNull();
		const imports = [...importsOf(readFileSync(wasm))];
		expect(imports.filter(name => name.startsWith('env.co_'))).toEqual([]);
	});
});

describe('the Asyncify list', () => {
	/** Every function of the fixture that Asyncify instrumented, by name. */
	function instrumented() {
		const module = binaryen.readBinary(fixture);
		try {
			const text = module.emitText();
			const chunks = text.split('\n (func $').slice(1);
			const nameOf = (chunk: string) => chunk.slice(0, chunk.search(/[\s(]/));
			// Asyncify's state is a global without a name; asyncify_get_state reads it.
			const getter = text.match(/\(export "asyncify_get_state" \(func \$([^)\s]+)\)\)/)![1];
			const state = chunks.find(chunk => nameOf(chunk) === getter)!.match(/global\.get (\$[^)\s]+)/)![1];
			return chunks.filter(chunk => chunk.includes(`global.get ${state})`)).map(nameOf);
		} finally {
			module.dispose();
		}
	}

	test('every async function, what it calls to await, and nothing reached only through a table', () => {
		const names = instrumented();
		for (const name of ['tick', 'twice', 'both', 'fails', 'Counter#add', 'listen']) {
			expect(names.some(n => n.endsWith(`async/${name}`))).toBe(true);
			expect(names.some(n => n.endsWith(`async/${name}@coroutine`))).toBe(true);
		}
		expect(names.some(n => n.endsWith('__co_wait'))).toBe(true);
		// The facade's trampolines call listeners through the table: never on the list.
		expect(names.filter(n => /~lib\/~\/(?:facade|events|hooks)\//.test(n))).toEqual([]);
		// Nor a function that never awaits.
		expect(names.some(n => n.endsWith('async/collect') || n.endsWith('async/reply'))).toBe(false);
	});
});
