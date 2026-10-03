/**
 * `((...) => R) | T[]` - one test, or a list of objects that each carry one
 * with more beside it:
 *
 *   shop.addItem({ title: "Buy", enabled: ({ player }) => player.money > 100 });
 *   shop.addItem({ title: "Buy", enabled: [{ when: ({ player }) => player.money > 100, message: "No money" }] });
 *
 * The type is held as the list; a function given where it is declared - an
 * argument, an object literal's field, an assignment - becomes a list of one
 * object whose field of the function's type is it. The code that reads it
 * just walks the list.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

const LIST = `
type Text = string | ((who: i32) => string);

interface Requirement {
	when: (who: i32) => bool;
	message?: Text;
}

type Enabled = ((who: i32) => bool) | Requirement[];

class Options {
	enabled: ((who: i32) => bool) | Requirement[] | null = null;
}

class Backwards {
	enabled: Requirement[] | ((who: i32) => bool) = [];
}

function first(enabled: Enabled, who: i32): string {
	// @ts-ignore: a list here
	const list: Requirement[] = enabled;
	for (let i = 0; i < list.length; i++) {
		if (!list[i].when(who)) {
			const message = list[i].message;
			return message != null ? message(who) : "no";
		}
	}
	return "yes";
}
`;

async function compile(body: string) {
	const { error, exports, string } = await probe({ 'probe.ts': LIST + body });
	return { error, run: () => (error ? '' : string(exports.run())) };
}

test('a function argument, a variable holding one, and a list, where the union is declared', async () => {
	const { error, run } = await compile(`
export function run(): string {
	const small = (who: i32): bool => who < 5;
	const one = first((who) => who > 0, 3);
	const held = first(small, 7);
	const listed = first([{ when: (who) => who > 0 }, { when: (who) => who > 10, message: (who) => \`\${who} is not over 10\` }], 7);
	return one + "|" + held + "|" + listed;
}
`);
	expect(error).toBe('');
	expect(run()).toBe('yes|no|7 is not over 10');
});

test('a field of an object literal and an assignment to a field, the union written either way round', async () => {
	const { error, run } = await compile(`
export function run(): string {
	const options: Options = { enabled: (who) => who == 1 };
	const listed: Options = { enabled: [{ when: (who) => who == 1, message: "not one" }] };
	const backwards = new Backwards();
	const empty = first(backwards.enabled, 2);
	backwards.enabled = (who) => who == 2;
	const a = options.enabled;
	const b = listed.enabled;
	return (a != null ? first(a, 2) : "none") + "|" + (b != null ? first(b, 2) : "none") + "|" + empty + "|" + first(backwards.enabled, 3);
}
`);
	expect(error).toBe('');
	expect(run()).toBe('no|not one|yes|no');
});

test('a value that is neither a function nor a list is still refused', async () => {
	const { error } = await compile(`
export function run(): string {
	return first("yes", 1);
}
`);
	expect(error).not.toBe('');
});
