/**
 * The module carries the host plugin as a C array (runtime/src/host.h) and
 * writes it out for AMX Mod X byte for byte: the header has to hold every
 * byte of the .amxx, in order, and nothing else.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { hostHeader } from '../scripts/host-header';

function bytesOf(header: string): number[] {
	const body = header.slice(header.indexOf('{'), header.indexOf('};'));
	return [...body.matchAll(/0x([0-9a-f]{2}),/g)].map(match => Number.parseInt(match[1], 16));
}

test('every byte, in order, across lines', () => {
	const plugin = Uint8Array.from({ length: 100 }, (_, i) => (i * 37) & 0xFF);
	expect(bytesOf(hostHeader(plugin))).toEqual([...plugin]);
});

test('the array the module writes out', () => {
	const header = hostHeader(Uint8Array.of(0x58, 0x58, 0x4D, 0x41));
	expect(header).toContain('static const unsigned char g_hostPlugin[] = {');
	expect(bytesOf(header)).toEqual([0x58, 0x58, 0x4D, 0x41]);
});
