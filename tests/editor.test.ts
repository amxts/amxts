import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Plugins as an editor sees them.
//
// asc and tsc read the same files and disagree: asc compiled `mc_show_menu(id,
// "X", -1, 0, 0, 0, 0)` and an editor marked every 0 passed as a boolean,
// thirty-two red lines nobody saw until a developer opened the file. So the
// editor's reading is checked too - as/tsconfig.json, exactly what VS Code
// uses - and a plugin is not done while it shows an error there.
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';

test('as/ has no errors in the editor', () => {
	// tsc's own script under node: node_modules/.bin holds tsc.exe after bun
	// install and tsc.cmd after npm install.
	const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
	const run = spawnSync('node', [tsc, '--noEmit', '-p', 'as'], { encoding: 'utf8' });
	const errors = (run.stdout + run.stderr).split('\n').filter(line => /error TS\d+/.test(line));

	expect(errors).toEqual([]);
}, 600_000);

test('the standard library takes what JavaScript\'s does in the editor', () => {
	// A Map of its entries, a Set of its values, Date.UTC of the year and
	// month: the typings asc ships refused them, and the build compiles them.
	const dir = join(tmpdir(), 'amxts-editor-test');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({ extends: resolve('node_modules/assemblyscript/std/assembly.json'), files: ['probe.ts'] }));
	writeFileSync(join(dir, 'probe.ts'), [
		'const scores = new Map([["ann", 1], ["bob", 2]]);',
		'const names = new Set(["ann", "bob"]);',
		'export const total: number = scores.get("ann") + names.size + Date.UTC(2024, 0) + Date.UTC(2024, 0, 2);',
		'',
	].join('\n'));

	const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
	const run = spawnSync('node', [tsc, '--noEmit', '-p', dir], { encoding: 'utf8' });
	expect((run.stdout + run.stderr).split('\n').filter(line => /error TS\d+/.test(line))).toEqual([]);
}, 120_000);
