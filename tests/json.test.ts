/**
 * JSON as JavaScript has it, typed: JSON.parse<T>(text) or `as T` builds a T
 * - fields, arrays, Records, text, numbers, booleans - and JSON.stringify
 * writes any value. At the default optimization and at -O3.
 */
import { describe, expect, test } from 'vitest';
import { probe } from './probe';

async function compile(body: string, optimize: boolean) {
	const { error, exports, string } = await probe({ 'probe.ts': body }, optimize ? ['-O3'] : []);
	return { error, exports, run: () => (error ? 0 : exports.run() as number), text: () => (error ? '' : string(exports.text())) };
}

const TYPES = `
interface Weapon { name: string; ammo: number }
interface Settings {
	title: string;
	volume: number;
	enabled: boolean;
	tags: string[];
	weapons: Weapon[];
	prices: Record<string, number>;
	nickname?: string;
	delay?: number;
	loud?: boolean;
}
`;

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('JSON.parse<T> builds the object: fields, nested objects, arrays, a Record, optional fields', async () => {
			const { error, text } = await compile(`${TYPES}
export function text(): string {
	const s = JSON.parse<Settings>(\`{
		"title": "Shop \\\\u0041\\\\n", "volume": 0.5, "enabled": true, "tags": ["a", "b"],
		"weapons": [{ "name": "ak47", "ammo": 30 }, { "name": "awp", "ammo": 10, "extra": [1, {}] }],
		"prices": { "ak47": 2500, "awp": 4750 }, "loud": false
	}\`);
	return [
		s.title, s.volume.toString(), s.enabled.toString(), s.tags.join("+"),
		s.weapons.map<string>((w) => w.name + w.ammo.toString()).join(","),
		(s.prices.awp ?? 0).toString(), Object.keys(s.prices).join(","),
		(s.nickname ?? "none"), (s.delay ?? -1).toString(), (s.loud ?? true).toString(),
	].join("|");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('Shop A\n|0.5|true|a+b|ak4730,awp10|4750|ak47,awp|none|-1|false');
		});

		test('JSON.parse(text) as T and a declared type read the same; numbers, text and lists at the top', async () => {
			const { error, text } = await compile(`${TYPES}
export function text(): string {
	const weapon = JSON.parse('{"name":"m4a1","ammo":30}') as Weapon;
	const list: number[] = JSON.parse("[1, 2.5, -3e2]");
	const word = JSON.parse<string>('"hi"');
	return weapon.name + " " + list.join(",") + " " + word + " " + JSON.parse<boolean>("true").toString();
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('m4a1 1,2.5,-300 hi true');
		});

		test('JSON.parse takes its type from a return, and JSON.stringify writes it back', async () => {
			const { error, text } = await compile(`
interface Stats {
	kills: number;
	deaths: number;
	lastMap?: string;
}
function loadStats(text: string | null): Stats {
	if (text == null) return { kills: 0, deaths: 0 };
	return JSON.parse(text);
}
export function text(): string {
	const stats = loadStats('{"kills": 3, "deaths": 1}');
	stats.kills++;
	return JSON.stringify(stats) + JSON.stringify(loadStats(null));
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('{"kills":4,"deaths":1}{"kills":0,"deaths":0}');
		});

		test('bad JSON is a SyntaxError, a value of the wrong kind or a missing field a TypeError - caught', async () => {
			const { error, text } = await compile(`${TYPES}
function attempt(text: string): string {
	try {
		const weapon = JSON.parse<Weapon>(text);
		return "ok " + weapon.name;
	} catch (e) {
		return e.name + ": " + e.message;
	}
}
export function text(): string {
	return [
		attempt('{"name": "ak47", "ammo": }'),
		attempt('{"name": "ak47"'),
		attempt('{"name": 5, "ammo": 1}'),
		attempt('{"ammo": 1}'),
		attempt('{"name": "ok", "ammo": 1}'),
	].join("|");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe([
				'SyntaxError: Unexpected token } in JSON at position 25',
				'SyntaxError: Unexpected end of JSON input',
				'TypeError: JSON: name is a number, text was expected',
				'TypeError: JSON: name is missing, text was expected',
				'ok ok',
			].join('|'));
		});

		test('rows read straight: escaped keys, other keys skipped, null for an optional field, a key given twice', async () => {
			const { error, text } = await compile(`
interface Row {
	map: string;
	time: number;
	note?: string;
	best: number | null;
}
export function text(): string {
	const rows = JSON.parse<Row[]>(\`[
		{"map":"kz_a","time":1.5,"best":null,"extra":{"deep":[1,"x",{"y":null}]}},
		{"m\\\\u0061p":"kz_b","note":null,"time":-0,"best":2},
		{"map":"kz_c","time":3,"best":4,"map":"kz_d"}
	]\`);
	return rows.map<string>((row) => \`\${row.map} \${row.time} \${1 / row.time} \${row.note ?? "none"} \${row.best}\`).join("|");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('kz_a 1.5 0.6666666666666666 none null|kz_b 0 -Infinity none 2|kz_d 3 0.3333333333333333 none 4');
		});

		test('a number reads as parseFloat reads its text', async () => {
			const { error, text } = await compile(`
export function text(): string {
	const written = ["0.1", "123.456", "1e22", "1.5e-7", "12345678901234567", "3.141592653589793", "9007199254740993", "1e-30", "2.5E+3", "-7.25", "100000000000000000000000"];
	const read = JSON.parse<number[]>(\`[\${written.join(",")}]\`);
	let same = read.length == written.length;
	for (let i = 0; i < written.length; i++) if (read[i] != parseFloat(written[i])) same = false;
	return \`\${same} \${read[0]} \${read[3]}\`;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('true 0.1 1.5e-7');
		});

		test('text that is not a T says why and where, as it does read the slow way', async () => {
			const { error, text } = await compile(`${TYPES}
function attempt(text: string): string {
	try {
		return "ok " + JSON.parse<Weapon[]>(text).length.toString();
	} catch (e) {
		return e.name + ": " + e.message;
	}
}
export function text(): string {
	let bytes = "";
	try {
		JSON.parse<Uint8Array[]>('["AA==", "A*=="]');
	} catch (e) {
		bytes = e.message;
	}
	return [
		attempt('[{"name": "a", "ammo": 1}, {"name": 2, "ammo": 1}]'),
		attempt('[{"name": "a", "ammo": 1}, {"ammo": 1}]'),
		attempt('[{"name":5,"ammo":1},]'),
		attempt('[{"name": "a", "ammo": 1}, 7]'),
		attempt('{"name": "a"}'),
		attempt('[{"name": "a", "ammo": 1}] x'),
		attempt('[{"name": "a", "ammo": 1}]'),
		bytes,
	].join("|");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe([
				'TypeError: JSON: [1].name is a number, text was expected',
				'TypeError: JSON: [1].name is missing, text was expected',
				'SyntaxError: Unexpected token ] in JSON at position 21',
				'TypeError: JSON: [1] is a number, an object was expected',
				'TypeError: JSON: the value is an object, an array was expected',
				'SyntaxError: Unexpected token x in JSON at position 27',
				'ok 1',
				'JSON: [1] is not base64 text, which a Uint8Array is read from',
			].join('|'));
		});

		test('a field the text leaves out keeps its class default, with or without a constructor taking arguments', async () => {
			const { error, text } = await compile(`
class Profile {
	kills: number = 0;
	title: string = "rookie";
	tags: string[] = ["new"];
}
class Spot {
	name: string = "start";
	constructor(public x: number) {}
}
export function text(): string {
	const old = JSON.parse<Profile>('{"kills": 3}');
	const spot = JSON.parse<Spot>('{"x": 2}');
	return \`\${old.kills} \${old.title} \${old.tags.join(",")} \${spot.x} \${spot.name}\`;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('3 rookie new 2 start');
		});

		test('JSON.stringify writes objects in field order, leaves undefined out, escapes text, indents', async () => {
			const { error, text } = await compile(`${TYPES}
class Point {
	constructor(public x: number, public y: number) {}
}
class Stamp {
	toJSON(): string { return "stamp"; }
}
export function text(): string {
	const settings: Settings = {
		title: "a \\"quoted\\"\\nline", volume: 1.5, enabled: false, tags: [],
		weapons: [{ name: "ak47", ammo: 30 }], prices: { ak47: 2500 }, delay: 3,
	};
	const scores: Record<string, number[]> = { a: [1], b: [2, 3] };
	return JSON.stringify(settings) + "\\n" + JSON.stringify(scores, null, 2) + "\\n"
		+ JSON.stringify([new Point(1, 2)]) + JSON.stringify(new Stamp()) + JSON.stringify(NaN) + JSON.stringify("x");
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe([
				'{"title":"a \\"quoted\\"\\nline","volume":1.5,"enabled":false,"tags":[],"weapons":[{"name":"ak47","ammo":30}],"prices":{"ak47":2500},"delay":3}',
				'{\n  "a": [\n    1\n  ],\n  "b": [\n    2,\n    3\n  ]\n}',
				'[{"x":1,"y":2}]"stamp"null"x"',
			].join('\n'));
		});

		test('a Uint8Array is base64 text both ways, and a union of values holds one', async () => {
			const { error, text } = await compile(`
interface Blob { data: Uint8Array; none: Uint8Array | null }
export function text(): string {
	const every = new Uint8Array(256);
	for (let i = 0; i < 256; i++) every[i] = i;
	const written = JSON.stringify(every);
	const back = JSON.parse<Uint8Array>(written);
	let same = back.length == 256;
	for (let i = 0; i < 256; i++) if (back[i] != i) same = false;
	const blob = JSON.parse<Blob>('{"data":"AAH/","none":null}');
	const tails = ["", "AA", "AAE", "AAEC", "AA==", "AAE="].map(t => JSON.stringify(JSON.parse<Uint8Array>(\`"\${t}"\`)));
	const value: string | number | boolean | Uint8Array | null = blob.data;
	let bad = "";
	try {
		JSON.parse<Blob>('{"data":"A*==","none":null}');
	} catch (e) {
		bad = e.message;
	}
	return \`\${written.substring(0, 12)}|\${same}|\${blob.data.join(",")}|\${blob.none == null}|\${tails.join(" ")}|\${typeof value}|\${(value as Uint8Array).length}|\${JSON.stringify([value, 1])}|\${bad}\`;
}
`, optimize);
			expect(error).toBe('');
			expect(text()).toBe('"AAECAwQFBgc|true|0,1,255|true|"" "AA==" "AAE=" "AAEC" "AA==" "AAE="|object|3|["AAH/",1]|JSON: data is not base64 text, which a Uint8Array is read from');
		});
	});
}
