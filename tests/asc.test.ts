// asc as every build runs it (scripts/asc.ts): a compile keeps nothing alive
// after it is over.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { ascMain } from '../scripts/asc';

test('a compile leaves its program on no transform class that outlives it', async () => {
	class Kept {
		afterParse() {}
	}

	const { error } = await ascMain(['a.ts', '--noEmit'], {
		readFile: (name: string) => (name === 'a.ts' ? 'export const a = 1;' : null),
		writeFile() {},
		listFiles: () => [],
		transforms: [Kept],
	});

	expect(error).toBeNull();
	expect(Object.keys(Kept.prototype)).toEqual([]);
});

test('every compile goes through ascMain', () => {
	const files = ['scripts', 'src', 'tests'].flatMap(dir => readdirSync(dir, { recursive: true, encoding: 'utf8' })
		.filter(name => /\.(?:ts|mjs)$/.test(name))
		.map(name => join(dir, name).replace(/\\/g, '/')));
	const calling = files.filter(file => file !== 'scripts/asc.ts' && /\basc\.main\(/.test(readFileSync(file, 'utf8')));

	expect(calling).toEqual([]);
});
