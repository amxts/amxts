import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setup } from '@amxts/core/test-utils';
// env() (scripts/server-env.ts): the server's addons/amxts/.env and its
// environment, and the variables a plugin cannot start without - those it
// reads without a default.
// @ts-ignore - bun:test types not available during type checking
import { afterEach, expect, setDefaultTimeout, test } from 'bun:test';
import { setProjectDir } from '../scripts/project';
import { envBuild, envCallsOf, envProblems, parseDotenv } from '../scripts/server-env';

setDefaultTimeout(240_000);

const HERE = process.cwd();
const made: string[] = [];

afterEach(() => {
	setProjectDir(HERE);
	for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

let projects = 0;

/** A project folder with these files, the same one every run so the compile cache knows it again. */
function project(files: Record<string, string>) {
	const dir = join(tmpdir(), 'amxts-env', String(projects++));
	rmSync(dir, { recursive: true, force: true });
	made.push(dir);
	for (const [path, text] of Object.entries({ 'amxts.config.ts': 'export default defineConfig({ modules: [] });\n', ...files })) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

test('.env: comments, quotes, = in a value, CRLF', () => {
	const text = [
		'# a comment',
		'TOKEN=abc=def',
		'  SPACED  =  x y  ',
		'QUOTED="a # b "  # after',
		'SINGLE=\'it\'',
		'CUT=value # a comment',
		'EMPTY=',
		'no equals sign',
		'=no name',
		'URL=https://example.com/download/%s?key=1#top',
		'',
	].join('\r\n');

	expect(Object.fromEntries(parseDotenv(text))).toEqual({
		TOKEN: 'abc=def',
		SPACED: 'x y',
		QUOTED: 'a # b ',
		SINGLE: 'it',
		CUT: 'value',
		EMPTY: '',
		URL: 'https://example.com/download/%s?key=1#top',
	});
});

test('the env() calls of a file: the facade\'s, by the name it is imported under, each as the .aot lists it', () => {
	const calls = (text: string) => envCallsOf(text).map(call => `${call.entry} :${call.line}`);

	expect(calls([
		'const a = env("A");',
		'const b = env(\'B\', "https://example.com/a b");',
		'const c = env("C", 100);',
		'const d = env("D", -1.5);',
		'const e = env("E", false);',
		'const f = env(name);',
		'const g = env("G", limit);',
		'import { env } from "~/facade";',
		'',
	].join('\n'))).toEqual(['A :1', 'B string https://example.com/a b :2', 'C number 100 :3', 'D number -1.5 :4', 'E boolean false :5', 'null :6', 'null :7']);
	expect(calls('import { env as setting } from "@amxts/core";\nsetting("A");\nenv("NOT_THE_FACADE");\n')).toEqual(['A :2']);
	expect(calls('function env(name: string) { return name; }\nenv("A");\n')).toEqual([]);

	// One line a name: required wherever one call has no default.
	const build = envBuild();
	build.read('plugins/a.ts', 'import { env } from "~/facade";\nenv("B", 1);\nenv("A", true);\nenv("B");\nenv("B", 2);\n');
	expect(build.entries()).toEqual(['A boolean true', 'B']);
});

test('what a plugin needs that the server has not: a required variable, or one of another kind', () => {
	const entries = ['TOKEN', 'LIMIT number 100', 'DEBUG boolean false', 'MIRROR string https://example.com'];
	const problems = (values: Record<string, string>) => envProblems(entries, new Map(Object.entries(values)));

	expect(problems({})).toEqual(['TOKEN']);
	expect(problems({ TOKEN: '', LIMIT: '-1.5e3', DEBUG: 'Yes', MIRROR: 'x' })).toEqual([]);
	for (const word of ['1', '0', 'TRUE', 'false', 'yes', 'No', 'on', 'OFF']) expect(problems({ TOKEN: 't', DEBUG: word })).toEqual([]);
	for (const number of ['100', '+1', '.5', '1.', '2E10']) expect(problems({ TOKEN: 't', LIMIT: number })).toEqual([]);
	expect(problems({ TOKEN: 't', LIMIT: 'abc', DEBUG: 'maybe' })).toEqual(['LIMIT as a number', 'DEBUG as a boolean']);
	for (const number of ['', '0x10', '1e', 'NaN', 'Infinity', '1 000']) expect(problems({ TOKEN: 't', LIMIT: number })).toEqual(['LIMIT as a number']);
});

const READER = `const token = env("MYPLUGIN_TOKEN");
const mirror = env("MYPLUGIN_MIRROR", "none");

server.addServerCommand("reader_show", () => {
	const limit = env("MYPLUGIN_LIMIT", 100);
	const debug = env("MYPLUGIN_DEBUG", false);
	console.log(\`token \${token} (\${token.length}), mirror \${mirror}, limit \${limit + 1}, debug \${debug ? "on" : "off"}\`);
});
`;

test('env() reads .env, the environment over it, and the default where neither has it', async () => {
	const dir = project({ 'plugins/reader.ts': READER });
	const server = await setup({
		rootDir: dir,
		files: { 'addons/amxts/.env': '# the server\'s\r\nMYPLUGIN_TOKEN="from file"\r\nMYPLUGIN_MIRROR=https://example.com\r\n' },
		env: { MYPLUGIN_MIRROR: 'from env' },
	});

	server.serverCommand('reader_show');
	expect(server.log).toContain('token from file (9), mirror from env, limit 101, debug off');
});

test('env() turns a value into its default\'s kind: a number, an on/off switch in any case, text', async () => {
	const dir = project({ 'plugins/reader.ts': READER });
	const seen = async (values: Record<string, string>) => {
		const server = await setup({ rootDir: dir, env: { MYPLUGIN_TOKEN: 't', ...values } });
		server.serverCommand('reader_show');
		return server.log.split('\n').at(-1);
	};

	expect(await seen({ MYPLUGIN_LIMIT: '-2.5', MYPLUGIN_DEBUG: 'YES' })).toBe('token t (1), mirror none, limit -1.5, debug on');
	for (const word of ['1', 'true', 'On']) expect(await seen({ MYPLUGIN_DEBUG: word })).toContain('debug on');
	for (const word of ['0', 'False', 'no', 'off']) expect(await seen({ MYPLUGIN_DEBUG: word })).toContain('debug off');
});

test('a plugin does not start while a value is not of its default\'s kind', async () => {
	const dir = project({ 'plugins/reader.ts': READER });

	await expect(setup({ rootDir: dir, env: { MYPLUGIN_TOKEN: 't', MYPLUGIN_LIMIT: 'abc' } })).rejects.toThrow('[amxts] reader needs MYPLUGIN_LIMIT as a number in addons/amxts/.env');
	await expect(setup({ rootDir: dir, env: { MYPLUGIN_TOKEN: 't', MYPLUGIN_DEBUG: 'maybe' } })).rejects.toThrow('[amxts] reader needs MYPLUGIN_DEBUG as a boolean in addons/amxts/.env');
});

test('a plugin does not start without a variable it reads without a default', async () => {
	const dir = project({ 'plugins/reader.ts': READER });

	await expect(setup({ rootDir: dir })).rejects.toThrow('[amxts] reader needs MYPLUGIN_TOKEN in addons/amxts/.env');
	await expect(setup({ rootDir: dir, env: { MYPLUGIN_TOKEN: 'set' } })).resolves.toBeDefined();
});

test('a name or a default that is not written out does not build', async () => {
	const dir = project({ 'plugins/reader.ts': 'const name = "MYPLUGIN_TOKEN";\nconst limit = 5;\nconsole.log(env(name));\nconsole.log(env("MYPLUGIN_LIMIT", limit));\n' });

	await expect(setup({ rootDir: dir })).rejects.toThrow(/reader\.ts:3: env\(\) takes its name and its default written out[^\n]*\n.*reader\.ts:4: env\(\) takes/);
});

test('the module\'s line for a missing variable is the one a game panel reads', () => {
	// A panel shows a hint from this line by this pattern: its shape stays.
	const PANEL = /\[amxts\]\s+(\S+?)(?:\.aot|\.ts)?\s+needs\s+([A-Z_][A-Z0-9_]*)/;
	const format = readFileSync('runtime/src/module.cpp', 'utf8').match(/MF_PrintSrvConsole\("(\[amxts\] %s needs %s in %s)\\n", Stem\(name\)/)?.[1];
	const line = (missing: string) => {
		const values = ['kz_core', missing, 'addons/amxts/.env'];
		return format?.replace(/%s/g, () => values.shift()!);
	};

	expect(line('KZ_MAP_TOKEN, KZ_OTHER')).toBe('[amxts] kz_core needs KZ_MAP_TOKEN, KZ_OTHER in addons/amxts/.env');
	expect(line('KZ_MAP_TOKEN, KZ_OTHER')!.match(PANEL)?.slice(1)).toEqual(['kz_core', 'KZ_MAP_TOKEN']);
	expect(line('KZ_MAX_RECORDS as a number')).toBe('[amxts] kz_core needs KZ_MAX_RECORDS as a number in addons/amxts/.env');
	expect(line('KZ_MAX_RECORDS as a number')!.match(PANEL)?.slice(1)).toEqual(['kz_core', 'KZ_MAX_RECORDS']);
});
