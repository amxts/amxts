import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// `amxts upgrade` (scripts/upgrade.ts): imports of the core's API by `~/`
// become imports by the package's name, a module package's place in the
// build's tree its name; the project's own files, strings and comments stay.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, expect, test } from 'bun:test';
import { setProjectDir } from '../scripts/project';
import { renamesFor, upgradeProject, upgradeText } from '../scripts/upgrade';

const HERE = process.cwd();
const made: string[] = [];

afterEach(() => {
	setProjectDir(HERE);
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const MODULES = [{ name: '@amxts/menu-core', short: 'menu-core' }];

const PLUGIN = [
	'import { get_maxplayers } from "~/natives";',
	'import { MAX_PLAYERS } from \'~/constants\';',
	'import * as fs from "~/fs";',
	'import { fetch } from "~/modules/http";',
	'import { Weapon } from "~/entities";',
	'import * as menus from "~/modules/menu-core";',
	'import { typed } from "~/modules/menu-core/src/typed";',
	'import "~/myplugin/player";',
	'export { EOL } from "~/os";',
	'',
	'declare module "~/facade" {',
	'\tinterface Player {',
	'\t\tghost: boolean;',
	'\t}',
	'}',
	'',
	'// import { x } from "~/natives";',
	'const text = \'import { x } from "~/natives"\';',
	'const later = import("~/natives");',
	'',
].join('\n');

test('every import of the core\'s API and of a module package by ~/ is rewritten; nothing else is', () => {
	const { text, changes } = upgradeText('plugins/a.ts', PLUGIN, renamesFor(MODULES));

	expect(text).toBe(PLUGIN
		.replace('"~/natives";', '"@amxts/core/natives";')
		.replace('\'~/constants\'', '\'@amxts/core/constants\'')
		.replace('"~/fs"', '"@amxts/core/fs"')
		.replace('"~/modules/http"', '"@amxts/core/http"')
		.replace('"~/entities"', '"@amxts/core"')
		.replace('"~/modules/menu-core";', '"@amxts/menu-core";')
		.replace('"~/modules/menu-core/src/typed"', '"@amxts/menu-core/src/typed"')
		.replace('"~/os"', '"@amxts/core/os"')
		.replace('declare module "~/facade"', 'declare module "@amxts/core"')
		.replace('import("~/natives")', 'import("@amxts/core/natives")'));
	expect(changes.map(change => `${change.file}:${change.line} ${change.from} -> ${change.to}`)).toEqual([
		'plugins/a.ts:1 ~/natives -> @amxts/core/natives',
		'plugins/a.ts:2 ~/constants -> @amxts/core/constants',
		'plugins/a.ts:3 ~/fs -> @amxts/core/fs',
		'plugins/a.ts:4 ~/modules/http -> @amxts/core/http',
		'plugins/a.ts:5 ~/entities -> @amxts/core',
		'plugins/a.ts:6 ~/modules/menu-core -> @amxts/menu-core',
		'plugins/a.ts:7 ~/modules/menu-core/src/typed -> @amxts/menu-core/src/typed',
		'plugins/a.ts:9 ~/os -> @amxts/core/os',
		'plugins/a.ts:11 ~/facade -> @amxts/core',
		'plugins/a.ts:19 ~/natives -> @amxts/core/natives',
	]);

	// A second run finds nothing.
	expect(upgradeText('plugins/a.ts', text, renamesFor(MODULES)).changes).toEqual([]);
});

test('a place the project\'s plugins folder has a file at is its own', () => {
	const renames = renamesFor(MODULES, place => place === 'os.ts');
	expect(upgradeText('a.ts', 'import { EOL } from "~/os";\n', renames).changes).toEqual([]);
});

test('a project is rewritten in place - plugins, tests, a local module - and a second run changes nothing', () => {
	const dir = join(tmpdir(), 'amxts-upgrade');
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	const files: Record<string, string> = {
		'package.json': '{ "name": "myserver", "private": true }\n',
		'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		'plugins/myplugin.ts': 'import { user_slap } from "~/natives";\nimport { twice } from "~/lib/twice";\n',
		'plugins/lib/twice.ts': 'export function twice(n: number) {\n\treturn n * 2;\n}\n',
		'plugins/modules/greeter.ts': 'import * as fs from "~/fs";\n',
		'test/fixtures/probe.ts': 'import { HIDE_HUD } from "~/facade";\n',
		'dist/old.ts': 'import { user_slap } from "~/natives";\n',
	};
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}

	const changes = upgradeProject(dir);
	expect(changes.map(change => `${change.file}:${change.line} ${change.to}`)).toEqual([
		'plugins/modules/greeter.ts:1 @amxts/core/fs',
		'plugins/myplugin.ts:1 @amxts/core/natives',
		'test/fixtures/probe.ts:1 @amxts/core',
	]);
	expect(readFileSync(join(dir, 'plugins/myplugin.ts'), 'utf8')).toBe('import { user_slap } from "@amxts/core/natives";\nimport { twice } from "~/lib/twice";\n');
	// What the build wrote is not the project's code.
	expect(readFileSync(join(dir, 'dist/old.ts'), 'utf8')).toBe(files['dist/old.ts']);
	expect(upgradeProject(dir)).toEqual([]);
});
