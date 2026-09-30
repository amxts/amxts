import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
