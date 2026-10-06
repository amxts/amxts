import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * The same scenarios as tests/async.test.ts, under WAMR AOT i386 - the engine
 * the server runs - with module.cpp's own scheduler (runtime/src/coroutines.h)
 * in a small host of its own, runtime/test/async-wamr. Asyncify, the shadow
 * stack kept aside and the rewind all happen in machine code wamrc made.
 *
 * Needs the host built once (see its CMakeLists.txt); without it this is
 * skipped rather than failed, since a checkout without MSVC cannot build it.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { compileAot, compileWasmFile } from '../src/testing/compile';

setDefaultTimeout(300_000);

const host = 'runtime/test/async-wamr/build/Release/host.exe';
const wamrc = process.env.AMXTS_WAMRC ?? 'runtime/deps/wamr/wamr-compiler/build/Release/wamrc.exe';

test.skipIf(!existsSync(host) || !existsSync(wamrc))('async/await under WAMR AOT i386', async () => {
	const out = join(tmpdir(), 'amxts-async-wamr');
	mkdirSync(out, { recursive: true });
	const wasm = join(out, 'async.wasm');
	const aot = join(out, 'async.aot');

	const problem = await compileWasmFile({ source: 'tests/as/async.ts', root: 'as' }, wasm);
	if (problem) throw new Error(problem);
	const compiled = await compileAot(wamrc, ['--target=i386'], wasm, aot);
	expect(compiled.status).toBe(0);

	const steps = [
		'ordering',
		'100',
		'100',
		'values',
		'50',
		'combinators',
		'100',
		'rejections',
		'30',
		'unhandled',
		'30',
		'wrapped',
		'reply',
		'aborts',
		'100',
		'forPlayer',
		'leave:7',
		'600',
		'survives',
		'collect',
		'20',
		'asListener',
		'10',
		'method',
		'10',
		'trap',
		'10',
		'ordering',
		'200',
		'answerEarly',
		'hooks',
		'answerLate',
		'hooks',
		'10',
		'tuples',
		'100',
		'mixedRace',
		'100',
		'settled',
		'100',
		'anyOf',
		'100',
		'find',
		'rangeError',
		'10',
		'tryAwait',
		'50',
	];
	const run = spawnSync(host, [aot, ...steps], { encoding: 'utf-8' });
	expect(run.status).toBe(0);

	const lines = run.stdout.split(/\r?\n/).filter(line => line.startsWith('log: ') || line.startsWith('host: '));
	expect(lines).toEqual([
		'log: a start',
		'log: b start',
		'log: sync end',
		'log: b after 100',
		'log: a after 200',
		'log: inner start',
		'log: inner after 50',
		'log: inner gave 100',
		'log: then got 100!',
		'log: x start',
		'log: y start',
		'log: y after 10',
		'log: x after 30',
		'log: all: 60 20',
		'log: slow start',
		'log: fast start',
		'log: fast after 20',
		'log: race: 40',
		'log: slow after 40',
		'log: catch: caught',
		'log: passed on: deep',
		'log: error: Unhandled promise rejection: nobody',
		'log: asked',
		'log: answered: yes',
		'log: listener: abort',
		'log: sleep: AbortError',
		'log: timeout: TimeoutError',
		'log: greeting 7',
		'log: greeting 8',
		'log: still here 8',
		'log: kept 42 two',
		'log: kept 42 two',
		'log: arrow 3 before',
		'log: listener 3',
		'log: arrow 3 after',
		'log: counter 2',
		'host: [amxts] fixture: Exception: unreachable - in an async function, which was dropped; the plugin runs on',
		'log: a start',
		'log: b start',
		'log: sync end',
		'log: b after 100',
		'log: a after 200',
		'log: chain_set -1 0',
		'log: outcome 1',
		'log: late answer given',
		'log: n start',
		'log: all rejected: tuple',
		'log: n after 20',
		'log: all mixed: 40 s',
		'log: all with a sleep: v',
		'log: all of one type: a,b (2)',
		'log: race: timed out',
		'log: race: boxed',
		'log: race of a base class: tom',
		'log: yes start',
		'log: yes after 5',
		'log: settled: no',
		'log: settled: 10',
		'log: settled mixed: rejected bad, fulfilled good',
		'log: won start',
		'log: any rejected: AggregateError 2 y',
		'log: won after 20',
		'log: any: 40',
		'log: any of a base class: rex',
		'log: find: rex max none',
		'log: rejected: RangeError',
		'log: inside caught RangeError inside',
		'log: guarded value 1',
		'log: guarded finally ',
		'log: first gave 1',
		'log: guarded caught bad',
		'log: guarded finally bad',
		'log: second gave -1',
		'log: again caught again',
		'log: rejected with after the tries',
	]);
});
