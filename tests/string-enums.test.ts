/**
 * A string enum, `enum Color { Red = "red" }`: its members are the strings,
 * and the enum as a type is a string - in its file and in one that imports
 * it. At the default optimization and at -O3.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { probe } from './probe';

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('members are strings, the enum is a type, across files', async () => {
			const { error, exports, string } = await probe({
				'colors.ts': `
export enum Color { Red = "red", Blue = "blue" }
export function paint(color: Color): string { return "paint " + color; }
`,
				'probe.ts': `
import { Color, paint } from "./colors";
const enum Side { Left = "left", Right = "right" }
function flip(side: Side): Side {
	return side == Side.Left ? Side.Right : Side.Left;
}
export function text(): string {
	let color: Color = Color.Blue;
	let named = "";
	switch (color) {
		case Color.Red: named = "r"; break;
		case Color.Blue: named = "b"; break;
	}
	const colors: Color[] = [Color.Red, color];
	return paint(Color.Red) + " " + named + " " + colors.join(",") + " " + flip(Side.Left);
}
`,
			}, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			expect(string(exports.text())).toBe('paint red b red,blue right');
		});
	});
}
