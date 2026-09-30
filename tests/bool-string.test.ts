/**
 * Two compiler patches that make plugin code read as TypeScript does:
 *
 * - a boolean among string literals, `true | false | "default"`, is one
 *   value: held as a string (true is "true", false the interned "false");
 * - "" is false in a condition, as in JavaScript.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

async function compile(body: string) {
	const { error, exports } = await probe({ 'probe.ts': body });
	return { error, run: () => (error ? 0 : exports.run() as number) };
}

const SEMICLIP = `
type Enabled = true | false | "default";

class Semiclip {
	enabled: Enabled = "default";
}

function code(value: Enabled): i32 {
	if (value == "default") return 2;
	if (value == true) return 1;
	if (value == false) return 0;
	return -1;
}
`;

test('true, false and a string literal are one value', async () => {
	const { error, run } = await compile(`${SEMICLIP}
export function run(): i32 {
	const semiclip = new Semiclip();
	let seen = code(semiclip.enabled) * 100;
	semiclip.enabled = true;
	seen += code(semiclip.enabled) * 10;
	semiclip.enabled = false;
	seen += code(semiclip.enabled);
	return seen;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(210);
});

test('a condition reads the union as TypeScript does: only false is false', async () => {
	const { error, run } = await compile(`${SEMICLIP}
function truthy(value: Enabled): i32 { return value ? 1 : 0; }
export function run(): i32 {
	return truthy(true) * 100 + truthy("default") * 10 + truthy(false);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(110);
});

test('a boolean variable goes into the union too', async () => {
	const { error, run } = await compile(`${SEMICLIP}
export function run(): i32 {
	const on = code(1 > 0 ? true : false);
	let flag = false;
	return on * 10 + code(flag);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(10);
});

test('a boolean in a template reads as TypeScript prints it', async () => {
	const { error, run } = await compile(`${SEMICLIP}
export function run(): i32 {
	const semiclip = new Semiclip();
	let text = \`\${semiclip.enabled}\`;
	semiclip.enabled = false;
	text += \` \${semiclip.enabled}\`;
	semiclip.enabled = true;
	text += \` \${semiclip.enabled}\`;
	return text == "default false true" ? 1 : 0;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(1);
});

test('null in the union is a value of its own, not false', async () => {
	const { error, run } = await compile(`
type Choice = true | false | "default" | null;
function code(value: Choice): i32 {
	if (value == null) return 3;
	if (value == false) return 0;
	return 1;
}
export function run(): i32 {
	return code(null) * 10 + code(false);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(30);
});

test('"false" read back from outside is text, true in a condition', async () => {
	const { error, run } = await compile(`
function truthy(text: string): i32 { return text ? 1 : 0; }
export function run(): i32 {
	const typed = "fal" + "se";   // what a player typed: text, not the boolean
	return truthy(typed);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(1);
});

test('"" is false in a condition, a string with text is true', async () => {
	const { error, run } = await compile(`
function truthy(text: string): i32 { return text ? 1 : 0; }
function orElse(text: string): string { return text || "fallback"; }
export function run(): i32 {
	return truthy("") * 100 + truthy("x") * 10 + (orElse("") == "fallback" ? 1 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11);
});

test('an open union keeps its literals for the editor and is a string here', async () => {
	const { error, run } = await compile(`
type GameMode = "normal" | "dm" | (string & {});
let mode: GameMode = "normal";
function set(next: GameMode): void { mode = next; }
export function run(): i32 {
	const was = mode == "normal" ? 1 : 0;
	set("training");
	return was * 10 + (mode == "training" ? 1 : 0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe(11);
});

test('a string that may be null is still false when it is null', async () => {
	const { error, run } = await compile(`
function find(key: string): string | null { return key == "a" ? "found" : null; }
export function run(): i32 {
	const found = find("b");
	if (found) return 1;
	return 0;
}
`);
	expect(error).toBe('');
	expect(run()).toBe(0);
});
