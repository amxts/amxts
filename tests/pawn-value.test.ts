/**
 * A size or a constant the includes write in Pawn, as a number: what
 * `players[MAX_PLAYERS]` copies across, and what as/constants.ts says. A name
 * nothing defines is no number, so the generator keeps the size a guess.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { evaluate } from '../scripts/pawn-value';

// What the includes define: `#define MAX_PLAYERS 32`, `#define MAX_NAME_LENGTH 32`,
// and `enum { STATSX_KILLS, ..., STATSX_MAX_STATS }`, whose last member counts to 8.
const known = new Map([['MAX_PLAYERS', 32], ['MAX_NAME_LENGTH', 32], ['STATSX_MAX_STATS', 8]]);

describe('evaluate', () => {
	test('a number is itself', () => {
		expect(evaluate('3', known)).toBe(3);
	});

	test('a define and an enum member are their values', () => {
		expect(evaluate('MAX_PLAYERS', known)).toBe(32);
		expect(evaluate('STATSX_MAX_STATS', known)).toBe(8);
	});

	test('an expression is worked out, a tag cast and a comment dropped', () => {
		expect(evaluate('MAX_NAME_LENGTH + 1', known)).toBe(33);
		expect(evaluate('32*2', known)).toBe(64);
		expect(evaluate('_:(MAX_PLAYERS + 1) /* with slot 0 */', known)).toBe(33);
	});

	test('a name nothing defines is no number', () => {
		expect(evaluate('MAX_BODYHITS', known)).toBeNull();
		expect(evaluate('MAX_PLAYERS + MAX_BODYHITS', known)).toBeNull();
		expect(evaluate('', known)).toBeNull();
	});
});
