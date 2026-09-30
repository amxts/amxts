/**
 * Function overloads, as TypeScript writes them: signatures without a body
 * right before the implementation. The editor picks the signature a call
 * matches; what compiles is the implementation (Parser.parseFunction).
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

async function run(body: string) {
	const { error, exports } = await probe({ 'probe.ts': body });
	return { error, value: error ? 0 : exports.run() as number };
}

describe('overloads', () => {
	test('the signatures are dropped, the implementation is the function - exported ones too', async () => {
		const { error, value } = await run(`
export function size<T>(name: string, extra: T): T;
/** One more signature, with its own words. */
export function size(name: string): i32;
export function size(name: string): i32 { return name.length; }

function twice(value: i32): i32;
function twice(value: i32): i32 { return value * 2; }

export function run(): i32 { return size("abcd") + twice(10); }
`);
		expect(error).toBe('');
		expect(value).toBe(24);
	});

	test('a signature with nothing of its name after it is still missing its body', async () => {
		const { error } = await run('export function lonely(a: i32): i32;\nexport function other(): i32 { return 0; }\nexport function run(): i32 { return 0; }\n');
		expect(error).toContain('Function implementation is missing or not immediately following the declaration');
	});
});
