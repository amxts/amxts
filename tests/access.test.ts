import { loadPlugin } from '@amxts/core/test-utils';
// accessOf: the letters of users.ini as the rights' names (as/facade.ts),
// read_flags on the fake server.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

test('accessOf("abc") is immunity, reservation and kick; an unknown letter is left out', async () => {
	const server = await loadPlugin('tests/as/access-of.ts');
	expect(server.native('access_of', 'abc')).toBe('immunity,reservation,kick');
	expect(server.native('access_of', '')).toBe('');
});
