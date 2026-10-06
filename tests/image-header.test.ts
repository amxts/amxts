/**
 * The module carries the natives' image as a C array (runtime/src/image.h)
 * and hands it to AMX Mod X byte for byte: the header has to hold every byte
 * of the .amxx, in order, and nothing else.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { imageHeader } from '../scripts/image-header';

function bytesOf(header: string): number[] {
	const body = header.slice(header.indexOf('{'), header.indexOf('};'));
	return [...body.matchAll(/0x([0-9a-f]{2}),/g)].map(match => Number.parseInt(match[1], 16));
}

test('every byte, in order, across lines', () => {
	const image = Uint8Array.from({ length: 100 }, (_, i) => (i * 37) & 0xFF);
	expect(bytesOf(imageHeader(image))).toEqual([...image]);
});

test('the array the module loads', () => {
	const header = imageHeader(Uint8Array.of(0x58, 0x58, 0x4D, 0x41));
	expect(header).toContain('static const unsigned char g_nativesImage[] = {');
	expect(bytesOf(header)).toEqual([0x58, 0x58, 0x4D, 0x41]);
});
