/**
 * An array's `entries()`, `keys()` and `values()` as JavaScript has them, and
 * `for (const [index, item] of list.entries())` walked by index. At the
 * default optimization and at -O3.
 */
import { describe, expect, test } from 'vitest';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, text: () => (error ? '' : string(exports.text())) };
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('for...of over an array\'s entries(), keys() and values()', async () => {
			const { error, text } = await compile(`
class Player { constructor(public name: string) {} }
function players(): Player[] { return [new Player("ann"), new Player("bob")]; }
export function text(): string {
	const names = ["a", "b", "c"];
	const out: string[] = [];
	for (const [index, name] of names.entries()) out.push(\`\${index} \${name}\`);
	for (const [index] of names.entries()) out.push(index.toString());
	for (const [, name] of names.entries()) out.push(name);
	for (const [index, { name }] of players().entries()) out.push(name + index.toString());
	for (let [index, name = "none"] of names.entries()) { if (index == 1) continue; out.push(name); }
	for (const index of names.keys()) out.push(index.toString());
	for (const name of names.values()) out.push(name);
	return out.join(",");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('0 a,1 b,2 c,0,1,2,a,b,c,ann0,bob1,a,c,0,1,2,a,b,c');
		});

		test('entries(), keys() and values() outside for...of, and a Map\'s entries() destructured', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const names = ["x", "y"];
	const prices = new Map<string, number>([["ak47", 2500], ["awp", 4750]]);
	const pairs: [string, number][] = [["p", 1]];
	let out = "";
	for (const entry of names.entries()) out += entry[0].toString() + entry[1];
	for (const [name, price] of prices.entries()) out += name + price.toString();
	for (const [index, [name, count]] of pairs.entries()) out += index.toString() + name + count.toString();
	return out + [...names.keys()].join("") + [...names.values()].length.toString();
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('0x1yak472500awp47500p1012');
		});

		test('a typed array\'s entries(), keys() and values()', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const bytes = new Uint8Array(3);
	bytes[0] = 7; bytes[1] = 8; bytes[2] = 9;
	const scores = new Float32Array(2);
	scores[1] = 1.5;
	const out: string[] = [];
	for (const [index, byte] of bytes.entries()) out.push(\`\${index} \${byte}\`);
	for (const [, score] of scores.entries()) out.push(score.toString());
	for (const index of bytes.keys()) out.push(index.toString());
	for (const byte of bytes.values()) out.push(byte.toString());
	for (const entry of new Int32Array(1).entries()) out.push(entry[0].toString() + entry[1].toString());
	out.push([...bytes.keys()].join(""));
	return out.join(",");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('0 7,1 8,2 9,0,1.5,0,1,2,7,8,9,00,012');
		});

		test('for...of over keys() walks the index, a Map\'s keys() its keys', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const names = ["a", "b"];
	const prices = new Map<string, number>([["ak47", 2500]]);
	let out = "";
	for (const index of names.keys()) out += index.toString();
	for (const name of prices.keys()) out += name;
	return out;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('01ak47');
		});
	});
}
