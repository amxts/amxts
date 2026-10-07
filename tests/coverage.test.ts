/**
 * The "From Pawn" pages are written from the API's tooltips and the coverage
 * tables of scripts/coverage.ts, so a covered native shows up there the day
 * its element gets a `Pawn:` line. `bun scripts/coverage.ts --write` rewrites
 * them.
 */
import { readFileSync } from 'node:fs';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { API, coverage, pages, PLAIN } from '../scripts/coverage';

describe('coverage', () => {
	test('the "From Pawn" pages are up to date', async () => {
		for (const { path, text } of await pages()) expect(readFileSync(path, 'utf8')).toBe(text);
	});

	test('every native the tables name is a native of the modules', async () => {
		const names = new Set([...(await coverage()).keys()].map(native => native.name));
		expect([...Object.keys(API), ...Object.keys(PLAIN)].filter(name => !names.has(name))).toEqual([]);
	});
});
