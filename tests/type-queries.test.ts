/**
 * `typeof config` as a type, `keyof typeof config`, and a plain object's
 * field read and written by a name in a variable - `colors[name]`. At the
 * default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('typeof and keyof typeof of a plain object, its fields by name', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': `
const COLORS = { red: "#f00", blue: "#00f" };
type ColorName = keyof typeof COLORS;
let current: typeof COLORS = COLORS;
function colorOf(name: ColorName): string { return COLORS[name]; }
function paint(name: ColorName, value: string): void { COLORS[name] = value; }
export function text(): string {
	paint("red", "#e00");
	let names = "";
	for (const key in COLORS) names += key + "=" + COLORS[key as ColorName] + ";";
	return colorOf("blue") + current.red + COLORS["blue"] + names;
}
` }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe('#00f#e00#00fred=#e00;blue=#00f;');
		});
	});
}
