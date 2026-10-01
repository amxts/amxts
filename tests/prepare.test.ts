import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
// `amxts prepare` (scripts/prepare.ts): .amxts/tsconfig.json says what the
// build says - `~/` is the project's own files, the core's API is
// `@amxts/core` and its entries - and the tooltips in another language than
// English are a copy in .amxts/api, never a write into the installed core.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, expect, test } from 'bun:test';
import ts from 'typescript';

const CORE = process.cwd();
const dir = join(tmpdir(), 'amxts-prepare');
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(files: Record<string, string>) {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
}

function prepare(lang: string) {
	const run = spawnSync(process.execPath, [join(CORE, 'scripts/prepare.ts')], { cwd: dir, encoding: 'utf8', env: { ...process.env, AMXTS_DOCS_LANG: lang } });
	expect(run.stderr + run.stdout).not.toContain('✖');
	expect(run.status).toBe(0);
	return JSON.parse(readFileSync(join(dir, '.amxts/tsconfig.json'), 'utf8'));
}

/** Every file of the core's as/ by its hash: what the build compiles. */
function coreHashes() {
	return Object.fromEntries(readdirSync(join(CORE, 'as'), { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => join(entry.parentPath, entry.name))
		.map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]));
}

/** The words above `print` as the editor shows them for the plugin. */
function printWords(config: string) {
	const parsed = ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} })!;
	const plugin = join(dir, 'plugins/a.ts').replace(/\\/g, '/');
	const resolved = ts.resolveModuleName('@amxts/core/natives', plugin, parsed.options, ts.sys).resolvedModule?.resolvedFileName;
	const facade = ts.resolveModuleName('@amxts/core', plugin, parsed.options, ts.sys).resolvedModule!.resolvedFileName;
	const source = ts.createSourceFile(facade, readFileSync(facade, 'utf8'), ts.ScriptTarget.Latest, true);
	const print = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'print')!;
	return { natives: resolved && resolve(resolved), facade: resolve(facade), words: ts.getJSDocCommentsAndTags(print).map(doc => doc.getText(source)).join('\n') };
}

test('in Russian the editor reads a copy in .amxts/api, the installed core stays as it is, and the plugin type-checks', () => {
	rmSync(dir, { recursive: true, force: true });
	write({
		'package.json': '{ "name": "myserver", "private": true }\n',
		'amxts.config.ts': 'export default defineConfig({ modules: [] });\n',
		'plugins/a.ts': [
			'import { user_slap } from "@amxts/core/natives";',
			'import { twice } from "~/lib/twice";',
			'',
			'server.addCommand("/slap", ({ player }) => {',
			'\tuser_slap(player.id, twice(2));',
			'\tprint(player, "!gSlapped");',
			'});',
			'',
		].join('\n'),
		'plugins/lib/twice.ts': 'export function twice(n: number) {\n\treturn n * 2;\n}\n',
	});

	const before = coreHashes();
	const config = prepare('ru');
	expect(coreHashes()).toEqual(before);

	expect(config.compilerOptions.paths['~/*']).toEqual(['../plugins/*']);
	expect(config.compilerOptions.paths['@amxts/core']).toEqual(['./api/core/facade.ts']);
	expect(config.compilerOptions.paths['@amxts/core/http']).toEqual(['./api/core/modules/http.ts']);
	expect(config.include).toContain('./api/core/*.d.ts');
	const ru = printWords(join(dir, '.amxts/tsconfig.json'));
	expect(ru.facade).toBe(resolve(dir, '.amxts/api/core/facade.ts'));
	expect(ru.natives).toBe(resolve(dir, '.amxts/api/core/natives.ts'));
	expect(ru.words).toMatch(/\p{Script=Cyrillic}/u);

	const errors = () => {
		const check = spawnSync('node', [tsc, '--noEmit', '-p', join(dir, '.amxts/tsconfig.json')], { encoding: 'utf8' });
		return (check.stdout + check.stderr).split('\n').filter(line => /error TS\d+/.test(line)).map(line => line.replace(/\\/g, '/').trim());
	};
	expect(errors()).toEqual([]);

	// `~/` is the plugins folder: the core's API is not found by it.
	write({ 'plugins/b.ts': 'import { user_slap } from "~/natives";\n\nuser_slap(1, 0);\n' });
	expect(errors()).toEqual([expect.stringContaining('plugins/b.ts(1,27): error TS2307: Cannot find module \'~/natives\'')]);
	rmSync(join(dir, 'plugins/b.ts'));
}, 600_000);

test('in English the editor reads the core itself, and the copy goes', () => {
	const config = prepare('en');
	expect(existsSync(join(dir, '.amxts/api'))).toBe(false);
	expect(config.compilerOptions.paths['@amxts/core/natives'][0]).toEndWith('/as/natives.ts');
	expect(config.compilerOptions.paths['@amxts/core/*']).toBeUndefined();
	const en = printWords(join(dir, '.amxts/tsconfig.json'));
	expect(en.facade).toBe(resolve(CORE, 'as/facade.ts'));
	expect(en.words).not.toMatch(/\p{Script=Cyrillic}/u);
}, 120_000);
