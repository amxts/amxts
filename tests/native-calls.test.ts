import { readFileSync } from 'node:fs';
/**
 * The module's own calls to AMX Mod X natives pass every parameter the
 * include declares, the defaults too.
 *
 * `Args` clears only the cells a call passes, and AMX Mod X's natives read
 * some of their optional parameters without looking at the count:
 * register_srvcmd reads its info[] from whatever an earlier call left on
 * the stack.
 *
 * Reads runtime/natives.txt; run `bun run generate` first.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';

const SOURCES = ['module.cpp', 'fields.h', 'network.h', 'coroutine.h', 'coroutines.h', 'stack.h'];

/** Variadic natives, which the signature table leaves out: a call passes what its format needs. */
const VARIADIC = new Set(['client_print']);

/** name -> how many parameters the include declares */
function arities(): Map<string, number> {
	const table = new Map<string, number>();
	for (const line of readFileSync('runtime/natives.txt', 'utf-8').split('\n')) {
		if (!line.trim() || line.startsWith('#'))
			continue;
		const [name, signature] = line.trim().split(/\s+/);
		table.set(name, signature.slice(1, signature.indexOf(')')).length);
	}
	return table;
}

interface Call { native: string; passed: number }

/**
 * The forms a call takes, each with the groups `native` and `passed`:
 * `Args params(3); ... CallNative("name", params)` in one function, before
 * another Args of that name; `CallNative("name", Args(0))`;
 * `CallWith("name", 4, ...)`.
 */
const FORMS = [
	/Args (\w+)\((?<passed>\d+)\);(?:(?!\n\}|Args \1\()[\s\S])*?Call(?:Native|Cached)\((?:\w+, )?"(?<native>\w+)", \1\)/g,
	/Call(?:Native|Cached)\((?:\w+, )?"(?<native>\w+)", Args\((?<passed>\d+)\)\)/g,
	/CallWith\("(?<native>\w+)", (?<passed>\d+)/g,
];

/** Every call with a native's name in the source, and how many parameters it passes. */
function calls(source: string): Call[] {
	return FORMS.flatMap(form => [...source.matchAll(form)].map(match => ({
		native: match.groups!.native,
		passed: Number(match.groups!.passed),
	})));
}

test('the module passes every parameter of a native it calls', () => {
	const table = arities();
	const all = SOURCES.flatMap(file => calls(readFileSync(`runtime/src/${file}`, 'utf-8')).map(call => ({ file, ...call })));

	// The patterns find the calls: message_begin's takes defaults it must pass.
	expect(all.some(call => call.native === 'message_begin')).toBe(true);
	expect(all.length).toBeGreaterThan(15);

	const short = all
		.filter(call => !VARIADIC.has(call.native))
		.filter(call => table.get(call.native) !== call.passed)
		.map(call => `${call.file}: ${call.native} passes ${call.passed} of ${table.get(call.native) ?? 'unknown'}`);
	expect(short).toEqual([]);
});
