import { loadPlugin } from '@amxts/core/test-utils';
// accessOf: the letters of users.ini as the rights' names (as/facade.ts),
// read_flags on the fake server.
import { expect, test } from 'vitest';

test('accessOf("abc") is immunity, reservation and kick; an unknown letter is left out', async () => {
	const server = await loadPlugin('tests/as/access-of.ts');
	expect(server.native('access_of', 'abc')).toBe('immunity,reservation,kick');
	expect(server.native('access_of', '')).toBe('');
});
