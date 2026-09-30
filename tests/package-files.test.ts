// What the core's npm package carries: every file an installed project runs -
// the bin, the cli-api, the tasks the command starts, the test utils, the lint
// plugin - and everything they import is in package.json's "files". The
// patched AssemblyScript is not: scripts/publish.ts adds it.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8'));
const ENTRIES = ['bin/amxts.mjs', 'src/cli-api.mjs', 'src/testing/index.ts', 'lint/oxlint-plugin.mjs', 'scripts/run.ts', 'scripts/prepare.ts', 'scripts/build-wasm.ts', 'scripts/check.ts'];

/** The files an entry imports, itself included, by relative imports. */
function reached(entries: string[]) {
	const seen = new Set<string>();
	const visit = (file: string) => {
		if (seen.has(file) || file.startsWith('runtime/deps/')) return;
		seen.add(file);
		for (const [, spec] of readFileSync(join(CORE, file), 'utf8').matchAll(/(?:from|import)[\s(]*['"](\.[^'"]+)['"]/g)) {
			const target = resolve(CORE, dirname(file), spec);
			const found = [target, `${target}.ts`, `${target}/index.ts`].find(each => existsSync(each) && statSync(each).isFile());
			if (found) visit(relative(CORE, found).split('\\').join('/'));
		}
	};
	entries.forEach(visit);
	return [...seen];
}

function packed(file: string) {
	return (pkg.files as string[]).some(entry => entry.includes('*')
		? new RegExp(`^${entry.replace(/\./g, '\\.').replace(/\*/g, '[^/]*')}$`).test(file)
		: file === entry || file.startsWith(`${entry}/`));
}

test('the package carries what an installed project runs', () => {
	const files = reached(ENTRIES);
	expect(files.length).toBeGreaterThan(30);
	expect(files.filter(file => !packed(file))).toEqual([]);
});

test('the package carries no test, no C++ source, no docs', () => {
	for (const file of ['tests/cli-api.test.ts', 'runtime/src/module.cpp', 'docs/en/1.getting-started/02.quick-start.md', 'scripts/release.ts', 'scripts/test-server.ts', 'docker/build/Dockerfile'])
		expect(packed(file)).toBe(false);
});
