/**
 * An element of a typed array - and any other small or unsigned integer a
 * plugin reads, a DataView's byte, what `>>>` gives - is a number, as in
 * JavaScript: `bytes[i] << 8` is up to 65280, not cut to the element's 8
 * bits, and `+`, `*`, `-`, text and comparisons give what they give in
 * JavaScript. Written back, it is stored as the typed array stores it. A
 * literal past 32 bits in a bitwise operator is its low 32 bits, as
 * JavaScript's ToInt32 makes it. Each case runs here in JavaScript and in the
 * compiled probe, at the default optimization and at -O3.
 */
import { describe, expect, test } from 'vitest';
import { probe } from './probe';

const SETUP = `
const u8 = new Uint8Array(4); u8[0] = 255; u8[1] = 254; u8[2] = 128; u8[3] = 1;
const i8 = new Int8Array(2); i8[0] = -128; i8[1] = 127;
const u16 = new Uint16Array(2); u16[0] = 65535; u16[1] = 40000;
const i16 = new Int16Array(2); i16[0] = -32768; i16[1] = 32767;
const c8 = new Uint8ClampedArray(2); c8[0] = 300; c8[1] = -5;
const u32 = new Uint32Array(2); u32[0] = 4000000000; u32[1] = 3000000000;
`;

const NUMBERS: Record<string, string> = {
	u8Shl: 'return u8[1] << 8;',
	u8Word: 'return u8[0] | (u8[1] << 8) | (u8[2] << 16) | (u8[3] << 24);',
	u8WordUnsigned: 'return (u8[0] | (u8[1] << 8) | (u8[2] << 16) | (u8[3] << 24)) >>> 0;',
	u8WordByProducts: 'return u8[0] + u8[1] * 256 + u8[2] * 65536 + u8[0] * 16777216;',
	u8Add: 'return u8[0] + u8[1];',
	u8Mul: 'return u8[0] * u8[1];',
	u8MulFour: 'return u8[0] * u8[1] * u8[0] * u8[1];',
	u8Sub: 'return u8[3] - u8[0];',
	u8Neg: 'return -u8[0];',
	u8Not: 'return ~u8[0];',
	u8Div: 'return u8[0] / 2;',
	u8Rem: 'return u8[0] % 7;',
	u8Index: 'const table = new Uint32Array(512); table[256] = 7; table[509] = 9; return table[u8[0] + 1] + table[u8[0] + u8[1]];',
	u8Compare: 'return u8[0] + 1 > 255 ? 1 : 0;',
	u8Equal: 'return u8[0] == 255 ? 1 : 0;',
	u8Local: 'const v = u8[0]; return v + v;',
	u8Switch: 'switch (u8[0]) { case 255: return 1; } return 0;',
	u8ForOf: 'let s = 0; for (const b of u8) s += b * b; return s;',
	u8Reduce: 'return u8.reduce((sum, b) => sum + (b << 8), 0);',
	u8Map: 'return u8.map(b => b * 2)[0];',
	i8Sub: 'return i8[0] - 1;',
	i8Neg: 'return -i8[0];',
	i8Mul: 'return i8[0] * i8[0];',
	i8Shr: 'return i8[0] >> 1;',
	i8Ushr: 'return i8[0] >>> 0;',
	i8Less: 'return i8[0] < i8[1] ? 1 : 0;',
	u16Shl: 'return u16[0] << 16;',
	u16Add: 'return u16[0] + u16[1];',
	u16Mul: 'return u16[0] * u16[1];',
	i16Mul: 'return i16[0] * 2;',
	i16Square: 'return i16[0] * i16[0];',
	i16Sub: 'return i16[0] - i16[1];',
	clamped: 'return c8[0] + c8[1] + c8[0];',
	dataView: 'const view = new DataView(u8.buffer); return view.getUint8(0) * view.getUint8(1) + (view.getInt8(0) << 8);',
	storeU8: 'const a = new Uint8Array(3); a[0] = 300; a[1] = -1; a[2] = -1.5; return a[0] * 100000 + a[1] * 1000 + a[2];',
	storeI8: 'const a = new Int8Array(2); a[0] = 200; a[1] = 3e9 + 7; return a[0] * 1000 + a[1];',
	storeI16: 'const a = new Int16Array(1); a[0] = 40000; return a[0];',
	storeU16: 'const a = new Uint16Array(1); a[0] = -2; return a[0];',
	compound: 'const a = new Uint8Array(1); a[0] = 200; a[0] += 100; return a[0];',
	compoundShift: 'const a = new Uint8Array(1); a[0] = 255; a[0] <<= 4; return a[0];',
	increment: 'const a = new Uint8Array(2); a[0] = 255; a[0]++; a[1]--; return a[0] * 1000 + a[1];',
	incrementSigned: 'const a = new Int8Array(1); a[0] = 127; a[0]++; return a[0];',
	u32Add: 'return u32[0] + u32[1];',
	u32Compare: 'return u32[0] > 2147483647 ? 1 : 0;',
	unsignedAdd: 'const a = -1; const b = -2; return (a >>> 0) + (b >>> 0);',
	unsignedLocal: 'const h = -1 >>> 0; return h * 2;',
	storeU32: 'const a = new Uint32Array(1); a[0] = -1; a[0] += 2; return a[0];',
	bigXor: 'return 0xEDB88320 ^ 0;',
	bigOr: 'return 0x80000000 | 0;',
	bigBoth: 'return 0xFFFFFFFF ^ 0xF0F0F0F0;',
	crcTable: 'let c = 3; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c;',
	histogram: 'const counts = new Uint16Array(256); for (let i = 0; i < 300; i++) counts[u8[i % 4]]++; return counts[255] * 1000 + counts[1];',
};

const TEXTS: Record<string, string> = {
	u8Text: 'return `${u8[0] + 1}`;',
	u16Joined: 'return "n=" + u16[0] * 2;',
	i8Text: 'return `${i8[0] - 1}`;',
};

const SOURCE = [
	SETUP,
	...Object.entries(NUMBERS).map(([name, body]) => `export function ${name}(): number { ${body} }`),
	...Object.entries(TEXTS).map(([name, body]) => `export function ${name}(): string { ${body} }`),
].join('\n');

/** The case run as JavaScript, on JavaScript's own typed arrays. */
function javascript(body: string): unknown {
	// oxlint-disable-next-line no-new-func
	return new Function(`${SETUP}\n${body}`)();
}

for (const optimize of [false, true]) {
	describe(optimize ? '-O3' : 'default', () => {
		test('a typed array\'s element is a number in every expression', async () => {
			const { error, exports, string } = await probe({ 'probe.ts': SOURCE }, optimize ? ['-O3'] : []);
			expect(error).toBe('');
			const wrong: string[] = [];
			for (const [name, body] of Object.entries(NUMBERS)) {
				const got = exports[name]();
				const want = javascript(body);
				if (!Object.is(got, want)) wrong.push(`${name}: ${got}, JavaScript says ${want}`);
			}
			for (const [name, body] of Object.entries(TEXTS)) {
				const got = string(exports[name]());
				const want = javascript(body);
				if (got !== want) wrong.push(`${name}: ${got}, JavaScript says ${want}`);
			}
			expect(wrong).toEqual([]);
		});
	});
}
