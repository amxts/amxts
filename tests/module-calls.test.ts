import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setup } from '@amxts/core/test-utils';
// Calls of a project module from other plugins (scripts/shared-modules.ts)
// that once answered zeros without a word: an owner that never imports its
// module, and an exported function whose parameters have defaults.
import { afterAll, describe, expect, test, vi } from 'vitest';
import { setProjectDir } from '../scripts/project';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

mkdirSync('dist', { recursive: true });
const root = mkdtempSync(join(process.cwd(), 'dist', 'module-calls-'));
afterAll(() => {
	setProjectDir(process.cwd());
	rmSync(root, { recursive: true, force: true });
});

const files: Record<string, string> = {
	'package.json': JSON.stringify({ name: 'module-calls-project', private: true }),
	// The owner by name, which never imports its module.
	'plugins/lonely.ts': 'export function test_owner_alive() {\n\treturn 1;\n}\n',
	'plugins/modules/lonely.ts': 'let calls = 0;\n\nexport function call(): number {\n\tcalls += 1;\n\treturn calls;\n}\n',
	'plugins/grenades.ts': 'import "~/modules/grenades";\n',
	'plugins/modules/grenades.ts': [
		'import { Player } from "@amxts/core";',
		'',
		'export function mode(): number {',
		'\treturn 7;',
		'}',
		'',
		'export function giveGrenades(player: Player, flashes = -1, smokes = -1, label = "kit", loud = false): string {',
		'\treturn `${player.name} ${flashes} ${smokes} ${label} ${loud}`;',
		'}',
		'',
	].join('\n'),
	'plugins/caller.ts': [
		'import { Player } from "@amxts/core";',
		'import * as grenades from "~/modules/grenades";',
		'import * as lonely from "~/modules/lonely";',
		'',
		'export function test_lonely() {',
		'\treturn lonely.call();',
		'}',
		'',
		'export function test_mode() {',
		'\treturn grenades.mode();',
		'}',
		'',
		'export function test_defaults(id: number) {',
		'\treturn grenades.giveGrenades(new Player(id));',
		'}',
		'',
		'export function test_given(id: number) {',
		'\treturn grenades.giveGrenades(new Player(id), 2, 1, "full", true);',
		'}',
		'',
	].join('\n'),
};
for (const [path, text] of Object.entries(files)) {
	mkdirSync(join(root, path, '..'), { recursive: true });
	writeFileSync(join(root, path), text);
}

describe('a project module called from another plugin', () => {
	test('runs in the plugin of its name even when that plugin never imports it', async () => {
		const server = await setup({ rootDir: root });
		expect(server.native('test_owner_alive')).toBe(1);
		expect(server.native('test_lonely')).toBe(1);
		expect(server.native('test_lonely')).toBe(2);
		expect(server.log).not.toContain('no plugin runs it');
	});

	test('takes its parameters\' defaults when the caller leaves them out', async () => {
		const server = await setup({ rootDir: root });
		const alice = server.join('Alice');
		expect(server.native('test_mode')).toBe(7);
		expect(server.native('test_defaults', alice.id)).toBe('Alice -1 -1 kit false');
		expect(server.native('test_given', alice.id)).toBe('Alice 2 1 full true');
		expect(server.native('test_mode')).toBe(7);
		expect(server.log).not.toContain('error');
	});
});
