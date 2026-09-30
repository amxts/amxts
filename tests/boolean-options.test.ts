/**
 * `boolean | Options`, as the DOM's `addEventListener(type, listener,
 * useCapture | options)`: a switch, or the options it is one of. It is held
 * as the options; a boolean given where it is declared becomes an object
 * whose first boolean field is that boolean (Compiler.booleanAsOptions).
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string) {
	const { error, exports } = await probe({ 'probe.ts': body });
	return { error, run: () => (error ? 0 : exports.run() as number) };
}

const LISTEN = `
interface ListenOptions {
	name?: string;
	post?: boolean;
	once?: boolean;
}

function code(options: boolean | ListenOptions = {}): i32 {
	const given = options as ListenOptions;
	const name = given.name ?? "";
	return (given.post ? 100 : 0) + (given.once ? 10 : 0) + name.length;
}
`;

test('a boolean is the options\' first boolean field; the options go as they are', async () => {
	const { error, run } = await compile(`${LISTEN}
export function run(): i32 {
	let seen = code(true) * 10000;            // { post: true }
	seen += code(false) * 1000;               // { post: false }
	seen += code({ once: true, name: "ab" }); // 12
	return seen + code();                     // {}
}
`);
	expect(error).toBe('');
	expect(run()).toBe(1000012);
});

test('a boolean variable and a boolean expression are switches too', async () => {
	const { error, run } = await compile(`${LISTEN}
export function run(): i32 {
	const after = 2 > 1;
	return code(after) + code(!after);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(100);
});

test('a type without a boolean field takes no boolean', async () => {
	const { error } = await compile(`
interface Named { name?: string; }
function code(options: boolean | Named): i32 { return 0; }
export function run(): i32 { return code(true); }
`);
	expect(error).not.toBe('');
});
