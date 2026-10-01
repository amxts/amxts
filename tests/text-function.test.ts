/**
 * `string | (...) => string` - text that is fixed, or that depends on who
 * reads it (code-style rule 31):
 *
 *   shop.addItem("Close", ...);
 *   shop.addItem((player) => `Heal (${player.health} HP)`, ...);
 *
 * The type is held as the function; a string given where it is declared - an
 * argument, an object literal's field, an assignment - becomes a function
 * that returns it. The code that reads it just calls it.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { probe } from './probe';

const TEXT = `
type Text = string | ((who: i32) => string);

function show(text: Text, who: i32): string {
	return text(who);
}

class Options {
	title: Text | null = null;
}

class Label {
	text: Text = "none";
}
`;

async function compile(body: string) {
	const { error, exports, string } = await probe({ 'probe.ts': TEXT + body });
	return { error, run: () => (error ? '' : string(exports.run())) };
}

test('a string argument, a function argument and a variable, where the text type is declared', async () => {
	const { error, run } = await compile(`
export function run(): string {
	let name = "Bob";
	const fixed = show("Close", 1);
	const computed = show((who) => \`#\${who}\`, 7);
	const later = new Label();
	later.text = name;
	name = "Carol";
	return fixed + "|" + computed + "|" + show(name, 2) + "|" + later.text(0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe('Close|#7|Carol|Bob'); // a variable is read as it was given, as in JavaScript
});

test('an object literal\'s field and an assignment to a field take text too', async () => {
	const { error, run } = await compile(`
export function run(): string {
	const options: Options = { title: "Shop" };
	const label = new Label();
	const before = show(label.text, 0);
	label.text = "Heal";
	const title = options.title;
	return (title != null ? title(0) : "no") + "|" + before + "|" + label.text(0);
}
`);
	expect(error).toBe('');
	expect(run()).toBe('Shop|none|Heal');
});

test('a number where text is declared is still refused', async () => {
	const { error } = await compile(`
export function run(): string {
	return show(5, 0);
}
`);
	expect(error).toContain('not assignable');
});

test('a string that may be null is text once the flow has checked it, and not before', async () => {
	const checked = await compile(`
function find(key: string): string | null {
	return key == "a" ? "found" : null;
}
export function run(): string {
	const found = find("a");
	if (found == null) return "";
	return show(found, 0);
}
`);
	expect(checked.error).toBe('');
	expect(checked.run()).toBe('found');

	const unchecked = await compile(`
function find(key: string): string | null {
	return key == "a" ? "found" : null;
}
export function run(): string {
	return show(find("a"), 0);
}
`);
	expect(unchecked.error).toContain('not assignable');
});

test('a yes or no that is fixed, or that depends on who asks: boolean | (...) => boolean', async () => {
	const { error, exports } = await probe({ 'probe.ts': `
type Test = boolean | ((who: i32) => boolean);

class Item {
	enabled: Test = true;
}

function asks(test: Test, who: i32): string {
	return test(who) ? "y" : "n";
}

export function run(): i32 {
	const item = new Item();
	const fixed: Item = { enabled: false };
	let answers = asks(item.enabled, 1) + asks(fixed.enabled, 1) + asks((who) => who > 5, 7) + asks(false, 0);
	item.enabled = (who) => who == 2;
	answers += asks(item.enabled, 2) + asks(item.enabled, 3);
	return answers == "ynynyn" ? 1 : 0;
}
` });
	expect(error).toBe('');
	expect(exports.run()).toBe(1);
});
