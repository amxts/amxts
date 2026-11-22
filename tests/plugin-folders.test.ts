import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setup } from '@amxts/core/test-utils';
// Plugins in folders the config names (scripts/project.ts): a folder's prefix
// starts its plugins' .aot names, the modules the plugins share are kept in
// dir.api, and a module's owner may be in any folder of plugins - its calls
// go by the owner's .aot name. The project's modules have its auto-imports,
// and `amxts typecheck` compiles a plugin as the build does.
import { afterAll, describe, expect, test, vi } from 'vitest';
import { checkPlugin, readable } from '../scripts/compile';
import { CORE_PLUGINS, loadProject, pluginName, projectPlugins, setProjectDir } from '../scripts/project';
import { moduleVersions } from '../scripts/shared-modules';

vi.setConfig({ testTimeout: 240_000, hookTimeout: 240_000 });

// On the core's drive: a test's plugin outside the plugins folder is placed by its path from the core.
mkdirSync('dist', { recursive: true });
const root = mkdtempSync(join(process.cwd(), 'dist', 'folders-'));
afterAll(() => {
	setProjectDir(process.cwd());
	rmSync(root, { recursive: true, force: true });
});

function write(files: Record<string, string>) {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(root, path, '..'), { recursive: true });
		writeFileSync(join(root, path), text);
	}
}

write({
	'package.json': JSON.stringify({ name: 'folders-project', private: true }),
	'amxts.config.ts': 'export default defineConfig({\n\tplugins: ["modules", { path: "games", prefix: "minigame_" }],\n\tdir: { api: "api" },\n});\n',
	'plugins/core.ts': 'import * as duel from "~/api/duel";\nimport * as hns from "~/api/hns";\nimport { twice } from "./core/math";\n\nexport function test_rounds() {\n\treturn twice(hns.rounds());\n}\n\nexport function test_core_win() {\n\treturn duel.win();\n}\n',
	'plugins/core/math.ts': 'export function twice(value: number): number {\n\treturn value * 2;\n}\n',
	'plugins/api/duel.ts': 'import { bonus } from "./duel/bonus";\n\nlet wins = 0;\n\nexport function win(): number {\n\twins += bonus();\n\treturn wins;\n}\n',
	'plugins/api/duel/bonus.ts': 'export function bonus(): number {\n\treturn 1;\n}\n',
	// server is an auto-import, in a module of the project too
	'plugins/api/hns.ts': 'export function rounds(): number {\n\treturn server.players.length + 3;\n}\n',
	'plugins/modules/duel.ts': 'import "~/api/duel";\nimport { arena } from "./duel/arena";\n\nexport function test_arena() {\n\treturn arena();\n}\n',
	'plugins/modules/duel/arena.ts': 'export function arena(): string {\n\treturn "dust";\n}\n',
	'plugins/games/hns.ts': 'import "~/api/hns";\nimport * as duel from "../api/duel";\n\nexport function test_win() {\n\treturn duel.win();\n}\n',
	// TypeScript takes `any`, the build does not
	'fixtures/any.ts': 'import * as duel from "~/api/duel";\n\nlet last: any = duel.win();\n\nexport function test_any() {\n\treturn last;\n}\n',
	'fixtures/outside.ts': 'import * as duel from "~/api/duel";\n\nexport function test_outside_win() {\n\treturn duel.win();\n}\n',
});

describe('plugins in folders', () => {
	test('the top and each folder the config names are plugins; a folder\'s prefix starts their names', () => {
		const project = loadProject(root);
		expect(project.problems).toEqual([]);
		const plugins = projectPlugins(project);
		expect(plugins.map(file => relative(project.pluginsDir, file).replace(/\\/g, '/'))).toEqual(['core.ts', 'modules/duel.ts', 'games/hns.ts']);
		expect(plugins.map(file => pluginName(project, file))).toEqual(['core', 'duel', 'minigame_hns']);
	});

	test('a module in dir.api is served by the plugin of its name in any folder, and called from the others', async () => {
		const server = await setup({ rootDir: root });
		expect(server.native('test_arena')).toBe('dust');
		expect(server.native('test_win')).toBe(1);
		expect(server.native('test_win')).toBe(2);
		// One instance: the core's call counts on from the game's.
		expect(server.native('test_core_win')).toBe(3);
		expect((server as any).services.map((service: { name: string }) => service.name).sort()).toEqual(['duel', 'minigame_hns']);
		// api/hns.ts runs in games/hns.ts, minigame_hns on the server.
		expect(server.native('test_rounds')).toBe(6);
		expect(server.log).not.toContain('error');
	});

	test('a test\'s plugin outside the plugins folder calls a module in dir.api, not a copy of it', async () => {
		const server = await setup({ rootDir: root, start: false });
		await server.load(join(root, 'fixtures/outside.ts'));
		server.start();
		expect(server.native('test_win')).toBe(1);
		expect(server.native('test_outside_win')).toBe(2);
	});

	test('a change to a module\'s API is a new version for every plugin that calls it', async () => {
		setProjectDir(root);
		const before = await moduleVersions(CORE_PLUGINS, 'games/hns.ts');
		expect(before.map(version => version.split(':')[0])).toEqual(['duel', 'hns']);
		write({ 'plugins/api/duel/bonus.ts': 'export function bonus(): number {\n\treturn 1;\n}\n\nexport function lose(): number {\n\treturn 0;\n}\n' });
		write({ 'plugins/api/duel.ts': 'import { bonus } from "./duel/bonus";\n\nlet wins = 0;\n\nexport function win(): number {\n\twins += bonus();\n\treturn wins;\n}\n\nexport function reset() {\n\twins = 0;\n}\n' });
		const after = await moduleVersions(CORE_PLUGINS, 'games/hns.ts');
		expect(after[0]).not.toBe(before[0]);
		expect(after[1]).toBe(before[1]);
	});

	test('a check compiles a plugin as the build does and says what asc refuses, where', async () => {
		setProjectDir(root);
		expect(await checkPlugin({ source: join(root, 'plugins/games/hns.ts'), root: CORE_PLUGINS })).toBeNull();
		const problem = await checkPlugin({ source: join(root, 'fixtures/any.ts'), root: CORE_PLUGINS });
		expect(readable(problem!)).toMatch(/fixtures\/any\.ts:3:\d+ - TS\d+ /);
	});

	test('the shared modules\' folder is no folder of plugins, and a folder is named once', () => {
		write({ 'amxts.config.ts': 'export default defineConfig({\n\tplugins: ["api", "games", "games/"],\n\tdir: { api: "api" },\n});\n' });
		try {
			expect(loadProject(root).problems).toEqual([
				'amxts.config.ts: plugins: api is dir.api, the modules plugins share - its files are not plugins',
				'amxts.config.ts: plugins names games twice',
			]);
		} finally {
			write({ 'amxts.config.ts': 'export default defineConfig({\n\tplugins: ["modules", { path: "games", prefix: "minigame_" }],\n\tdir: { api: "api" },\n});\n' });
		}
	});
});
