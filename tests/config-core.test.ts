import type { FakeServer } from '@amxts/core/test-utils';
import { readFileSync } from 'node:fs';
import { loadPlugin } from '@amxts/core/test-utils';
// universal_config ported to TypeScript (the config-core module, its natives
// over its API), as the core builds and runs it, on the fake server: every
// native called the way a Pawn plugin calls it, on ini files that cover the
// format's corners.
//
// What the answers should be comes from universal_config.sma 1.6.1 itself,
// rule by rule.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { nativeEnums, pawnInclude } from '../scripts/plugin-natives';
import { IncludeParser } from '../src/parser/include-parser';

setDefaultTimeout(120_000);

const PLUGIN = '@amxts/config-core';
const CONFIGS = 'addons/amxmodx/configs';
/** A fresh server with these files under configs/, and a way to call natives. */
async function boot(files: Record<string, string> = {}, platform: 'win32' | 'linux' = 'linux') {
	const inConfigs = Object.fromEntries(Object.entries(files).map(([path, text]) => [`${CONFIGS}/${path}`, text]));
	const server = await loadPlugin(PLUGIN, { files: inConfigs, platform });
	const cfg = (name: string, ...args: (string | number | boolean)[]) => server.native(name, ...args) as any;
	return { server, cfg };
}

/** A file, its only section: what most tests start from. */
async function section(text: string) {
	const { server, cfg } = await boot({ 't.ini': text });
	const file = cfg('cfg_load_file', 't');
	return { server, cfg, file, sec: cfg('cfg_get_section', file, 'S') as number };
}

const strings = (server: FakeServer, handle: number) => server.cellArrayStrings(handle);

describe('loading', () => {
	test('a file and its section by name; ".ini" is added', async () => {
		const { server, cfg } = await boot({ 'a.ini': '[S]\nK = v\n' });
		expect(server.log).toContain('[ConfigCore] Plugin initialized (v0.1.1)');
		expect(cfg('cfg_load_file', 'a')).toBe(0);
		expect(cfg('cfg_load_file', 'a.ini')).toBe(1); // the same file again: a new handle
		expect(cfg('cfg_get_section', 1, 'S')).toBe(1); // and new sections
		expect(cfg('cfg_get_section', 0, 'S')).toBe(0);
		expect(cfg('cfg_get_section', 0, 'NONE')).toBe(-1);
		expect(cfg('cfg_get_section', -1, 'S')).toBe(-1);
		expect(cfg('cfg_get_section', 0, '')).toBe(-1);
		expect(cfg('cfg_get_sections_count')).toBe(2);
		expect(cfg('cfg_get_section_name', 1)).toBe('S');
		expect(cfg('cfg_get_section_name', 2)).toBe(null);
	});

	test('a file that is not there gets a handle all the same, with nothing in it', async () => {
		const { cfg } = await boot();
		expect(cfg('cfg_load_file', 'nope')).toBe(0);
		expect(cfg('cfg_get_section', 0, 'S')).toBe(-1);
	});

	test('".ini" anywhere in the name is enough; the base dir is trimmed', async () => {
		const { cfg } = await boot({ 'x.ini.bak': '[S]\nK = bak\n', 'sub/y.ini': '[S]\nK = sub\n' });
		expect(cfg('cfg_get_value', cfg('cfg_get_section', cfg('cfg_load_file', 'x.ini.bak'), 'S'), 'K')).toBe('bak');
		cfg('cfg_set_base_dir', '  sub  ');
		expect(cfg('cfg_get_value', cfg('cfg_get_section', cfg('cfg_load_file', 'y'), 'S'), 'K')).toBe('sub');
	});

	test('as many files as are loaded, each load a new handle', async () => {
		const { cfg } = await boot();
		for (let i = 0; i < 40; i++) expect(cfg('cfg_load_file', `f${i}`)).toBe(i);
	});

	test('a section keeps every entry it has', async () => {
		const lines = Array.from({ length: 70 }, (_, i) => `K${i} = ${i}`).join('\n');
		const { cfg, sec } = await section(`[S]\n${lines}\n`);
		expect(cfg('cfg_get_int', sec, 'K69')).toBe(69);
		expect(cfg('cfg_has_key', sec, 'K64')).toBe(true);
	});

	test('a section named twice: the name finds the last, and only it is saved', async () => {
		const { server, cfg, file } = await section('[S]\nA = 1\n[S]\nB = 2\n');
		const sec = cfg('cfg_get_section', file, 'S');
		expect(sec).toBe(1);
		expect(cfg('cfg_has_key', sec, 'A')).toBe(false);
		expect(cfg('cfg_save_config', file, 't')).toBe(true);
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('[S]\n\nB = 2\n');
	});

	test('a section name is what is between the brackets, spaces and all', async () => {
		const { cfg } = await boot({ 't.ini': '[ Spaced ]\nK = 1\n' });
		const file = cfg('cfg_load_file', 't');
		expect(cfg('cfg_get_section', file, 'Spaced')).toBe(-1);
		expect(cfg('cfg_get_section', file, ' Spaced ')).toBe(0);
	});

	test('lines before any section are ignored; # is not a comment', async () => {
		const { server, cfg, sec } = await section('K = outside\n[S]\n# not a comment\n');
		expect(cfg('cfg_has_key', sec, 'K')).toBe(false);
		expect(strings(server, cfg('cfg_get_top_level_keys', sec))).toEqual(['']);
		expect(cfg('cfg_get_value', sec, '', 3)).toBe('comment');
	});
});

describe('values', () => {
	const TEXT = [
		'[S]',
		'KEY = value ; a comment after it',
		'MULTI = a b "c d" "" e',
		'TABS = a\tb',
		'QUOTED = "hello world" x',
		'EMPTY =',
		'NOEQUALS line here',
		'TOOLONGKEY_ABCDEFGHIJKLMNOPQRSTUVWXYZ = long',
		`LONG = ${'x'.repeat(150)}`,
		// Cyrillic on purpose: a key and a value beyond ASCII.
		'Кириллица = значение',
		'',
	].join('\n');

	test('a value, a comment cut off; a value by index', async () => {
		const { cfg, sec } = await section(TEXT);
		expect(cfg('cfg_get_value', sec, 'KEY')).toBe('value');
		expect(cfg('cfg_get_value', sec, 'MULTI', 2)).toBe('c d');
		expect(cfg('cfg_get_value', sec, 'MULTI', 3)).toBe('e'); // "" is dropped
		expect(cfg('cfg_get_value', sec, 'MULTI', 4)).toBe(null);
		expect(cfg('cfg_get_value', sec, 'MULTI', -1)).toBe(null);
		expect(cfg('cfg_get_array_size', sec, 'MULTI')).toBe(4);
		expect(cfg('cfg_get_value', sec, 'TABS', 1)).toBe('b');
		expect(cfg('cfg_get_value', sec, 'EMPTY')).toBe(null);
		expect(cfg('cfg_has_key', sec, 'EMPTY')).toBe(true);
	});

	test('keys are case-insensitive, Cyrillic too; text is UTF-8 both ways', async () => {
		// Cyrillic on purpose: a key's case folds beyond ASCII.
		const { cfg, sec } = await section(TEXT);
		expect(cfg('cfg_get_value', sec, 'key')).toBe('value');
		expect(cfg('cfg_get_value', sec, 'КИРИЛЛИЦА')).toBe('значение');
	});

	test('keys and values are as long as they are written', async () => {
		const { cfg, sec } = await section(TEXT);
		expect(cfg('cfg_get_value', sec, 'TOOLONGKEY_ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('long');
		expect(cfg('cfg_get_value', sec, 'TOOLONGKEY_ABCDEFGHIJKLMNOPQRST')).toBe(null);
		expect(cfg('cfg_get_value', sec, 'LONG')).toBe('x'.repeat(150));
	});

	test('a line without "=" is an entry with an empty key', async () => {
		const { server, cfg, sec } = await section(TEXT);
		expect(cfg('cfg_get_value', sec, '', 1)).toBe('line');
		expect(strings(server, cfg('cfg_get_top_level_keys', sec))).toContain('');
	});

	test('the out buffer is cut to the caller\'s len, never inside a letter', async () => {
		const { server, sec } = await section(TEXT);
		expect(server.nativeWithRoom('cfg_get_value', 3, [sec, 'KEY'])).toBe('val');
		// Cyrillic on purpose: a two-byte letter is not cut in half.
		expect(server.nativeWithRoom('cfg_get_value', 5, [sec, 'Кириллица'])).toBe('зн');
	});

	test('numbers as parseInt and parseFloat read them', async () => {
		const { cfg, sec } = await section([
			'[S]',
			'NUM = 42abc',
			'NEG = -7',
			'BIG = 99999999999',
			'F = 0.01',
			'G = 2.5',
			'E = 1e5',
			'H = -.5',
			'W = abc',
			'T = true',
			'ONE = 1',
			'SP = " 3.5"',
			'',
		].join('\n'));
		expect(cfg('cfg_get_int', sec, 'NUM')).toBe(42);
		expect(cfg('cfg_get_int', sec, 'NEG')).toBe(-7);
		expect(cfg('cfg_get_int', sec, 'W')).toBe(0);
		expect(cfg('cfg_get_float', sec, 'F')).toBe(Math.fround(0.01));
		expect(cfg('cfg_get_float', sec, 'G')).toBe(2.5);
		expect(cfg('cfg_get_float', sec, 'E')).toBe(100000);
		expect(cfg('cfg_get_float', sec, 'H')).toBe(-0.5);
		expect(cfg('cfg_get_float', sec, 'SP')).toBe(3.5); // trimmed before str_to_float
		expect(cfg('cfg_get_float', sec, 'MISSING')).toBe(0);
		expect(cfg('cfg_get_bool', sec, 'T')).toBe(false); // atoi("true") is 0
		expect(cfg('cfg_get_bool', sec, 'ONE')).toBe(true);
	});

	test('a key more than once: index picks the occurrence and still the value in it', async () => {
		const { cfg, sec } = await section('[S]\nDUP = one uno\nDUP = two dos\n');
		expect(cfg('cfg_get_value_by_path', sec, 'DUP', 1, 1)).toBe('dos');
		expect(cfg('cfg_get_array_size', sec, 'DUP')).toBe(2);
		expect(cfg('cfg_get_int', sec, 'DUP')).toBe(0); // the plain lookup takes the first
	});

	test('cfg_get_value reads the first line of a key; index is the value in it', async () => {
		const { cfg, sec } = await section('[S]\nDUP = one uno\nDUP = two dos\n');
		expect(cfg('cfg_get_value', sec, 'DUP', 0)).toBe('one');
		expect(cfg('cfg_get_value', sec, 'DUP', 1)).toBe('uno');
		expect(cfg('cfg_delete_key', sec, 'NOTHING')).toBe(false);
	});
});

describe('blocks and paths', () => {
	const TEXT = [
		'[S]',
		'BLOCK = {',
		'\t; row comment',
		'\t"a" "b c" ""',
		'\t"x"\t"y"',
		'\t"unterminated',
		'\tKEYROW = 1 2 3',
		'\tINNER = {',
		'\t\t"deep1" "deep2"',
		'\t\tDEEPER = {',
		'\t\t\tLEAF = 7 8',
		'\t\t}',
		'\t}',
		'}',
		'',
	].join('\n');

	test('rows of "quoted" values: an empty one kept, a tab ends the row', async () => {
		const { server, cfg, sec } = await section(TEXT);
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK', 1, 0)).toBe('b c');
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK', 2, 0)).toBe('');
		expect(strings(server, cfg('cfg_get_value_array_by_path', sec, 'BLOCK', 0, 1))).toEqual(['x']);
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK', 0, 2)).toBe('unterminated');
		expect(cfg('cfg_get_array_size', sec, 'BLOCK')).toBe(5);
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK', 0, 5)).toBe(null);
	});

	test('a path into rows with keys and nested blocks', async () => {
		const { cfg, sec } = await section(TEXT);
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK/KEYROW', 2)).toBe('3');
		expect(cfg('cfg_get_value', sec, 'BLOCK/KEYROW', 1)).toBe('2');
		expect(cfg('cfg_get_int', sec, 'BLOCK/INNER/DEEPER/LEAF', 1)).toBe(8);
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK/INNER', 1, 0)).toBe('deep2');
		expect(cfg('cfg_get_array_size', sec, 'BLOCK/INNER')).toBe(2);
		expect(cfg('cfg_get_array_size', sec, 'BLOCK/KEYROW')).toBe(3);
		expect(cfg('cfg_get_value_by_path', sec, 'BLOCK//KEYROW', 0)).toBe('1'); // an empty part is skipped
	});

	test('blocks nest as deep as they are written', async () => {
		const { server, cfg, file, sec } = await section([
			'[S]',
			'L = {',
			'A = {',
			'B = {',
			'C = {',
			'D = {',
			'E = {',
			'V = 1',
			'}',
			'}',
			'}',
			'}',
			'}',
			'}',
			'AFTER = 2',
			'',
		].join('\n'));
		expect(cfg('cfg_get_value', sec, 'L/A/B/C/D/E/V')).toBe('1');
		expect(cfg('cfg_get_int', sec, 'AFTER')).toBe(2);
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe([
			'[S]',
			'',
			'L = {',
			'\tA = {',
			'\t\tB = {',
			'\t\t\tC = {',
			'\t\t\t\tD = {',
			'\t\t\t\t\tE = {',
			'\t\t\t\t\t\tV = 1',
			'\t\t\t\t\t}',
			'\t\t\t\t}',
			'\t\t\t}',
			'\t\t}',
			'\t}',
			'}',
			'',
			'AFTER = 2',
			'',
		].join('\n'));
	});

	test('cfg_get_value_array: a line split again, a block\'s every value', async () => {
		const { server, cfg, sec } = await section('[S]\nQ = "hello world" x\nQ = second\nB = {\n\t"a" "b"\n\tK = c\n}\n');
		expect(strings(server, cfg('cfg_get_value_array', sec, 'Q'))).toEqual(['hello', 'world']);
		expect(strings(server, cfg('cfg_get_value_array', sec, 'Q', 1))).toEqual(['second']);
		expect(strings(server, cfg('cfg_get_value_array', sec, 'B'))).toEqual(['a', 'b', 'c']);
		expect(cfg('cfg_get_value_array', sec, 'MISSING')).toBe(0);
	});

	test('cfg_get_float_array: the numbers of one value - a line is one per index', async () => {
		const { server, cfg, sec } = await section('[S]\nF = 1.5 2.5 3.5\nQ = "1.5 2.5 3.5"\n');
		expect(server.cellArrayCells(cfg('cfg_get_float_array', sec, 'F'))).toHaveLength(1);
		const three = server.cellArrayCells(cfg('cfg_get_float_array', sec, 'Q')) as number[];
		expect(three.map(bits => new Float32Array(new Int32Array([bits]).buffer)[0])).toEqual([1.5, 2.5, 3.5]);
		expect(cfg('cfg_get_float_array', sec, 'NONE')).toBe(0);
	});

	test('cfg_get_value_array_by_path: an empty line is an empty array, not Invalid_Array', async () => {
		const { server, cfg, sec } = await section('[S]\nE =\n');
		expect(strings(server, cfg('cfg_get_value_array_by_path', sec, 'E'))).toEqual([]);
	});

	test('cfg_get_section_data: keys, a values array per key, pairs', async () => {
		const { server, cfg, sec } = await section('[S]\nK = a b\nB = {\n\t"x"\n}\n');
		const data = server.cellArrayCells(cfg('cfg_get_section_data', sec)) as number[];
		expect(data).toHaveLength(3);
		expect(strings(server, data[0])).toEqual(['K', 'B']);
		const values = server.cellArrayCells(data[1]) as number[];
		expect(strings(server, values[0])).toEqual(['a', 'b']);
		expect(strings(server, values[1])).toEqual(['{block}']);
		expect(server.cellArrayCells(data[2])).toEqual([[0, 0], [1, 1]]);
	});
});

describe('writing back', () => {
	test('comments and blank lines go back before what they preceded; one before "}" moves out', async () => {
		const text = '; top\n\n[S]\n; about K\nK = 1\n\nB = {\n\t"a"\n\t; dangling\n}\nAFTER = 2\n; trailing\n';
		const { server, cfg, file } = await section(text);
		expect(cfg('cfg_save_config', file, 't')).toBe(true);
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('; top\n\n[S]\n; about K\nK = 1\n\nB = {\n\t"a"\n}\n; dangling\nAFTER = 2\n');
	});

	test('cfg_save_config without a name returns false, as the original does', async () => {
		const { cfg, file } = await section('[S]\nK = 1\n');
		expect(cfg('cfg_save_config', file)).toBe(false);
		expect(cfg('cfg_save_config', -1, 't')).toBe(false);
	});

	test('saving makes the folders on the way', async () => {
		const { server, cfg, file } = await section('[S]\nK = 1\n');
		expect(cfg('cfg_save_config', file, 'made/on/the/way')).toBe(true);
		expect(server.file(`${CONFIGS}/made/on/the/way.ini`)).toBe('[S]\n\nK = 1\n');
	});

	test('set, int, float as it was written in Pawn, bool; a new key; a second section gets a blank line', async () => {
		const { server, cfg, file, sec } = await section('[S]\nK = 1\n');
		expect(cfg('cfg_set_value', sec, 'K', 'changed')).toBe(true);
		expect(cfg('cfg_set_int', sec, 'I', 42)).toBe(true);
		expect(cfg('cfg_set_float', sec, 'F1', 2.5)).toBe(true);
		cfg('cfg_set_float', sec, 'F2', 0.1);
		cfg('cfg_set_float', sec, 'F3', 123456.7);
		cfg('cfg_set_float', sec, 'F4', -1.5);
		expect(cfg('cfg_set_bool', sec, 'B', true)).toBe(true);
		const other = cfg('cfg_create_section', file, 'NEW');
		expect(other).toBe(1);
		expect(cfg('cfg_create_section', file, 'NEW')).toBe(1);
		cfg('cfg_set_value', other, 'X', 'y');
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe([
			'[S]',
			'',
			'K = changed',
			'',
			'I = 42',
			'',
			'F1 = 2.5',
			'',
			'F2 = 0.1',
			'',
			'F3 = 123456.7',
			'',
			'F4 = -1.5',
			'',
			'B = 1',
			'',
			'[NEW]',
			'',
			'X = y',
			'',
		].join('\n'));
	});

	test('a value with a space goes back unquoted and reads as two', async () => {
		const { server, cfg, file, sec } = await section('[S]\n');
		cfg('cfg_set_value', sec, 'K', 'hello world');
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('[S]\n\nK = hello world\n');
		const again = cfg('cfg_get_section', cfg('cfg_load_file', 't'), 'S');
		expect(cfg('cfg_get_value', again, 'K')).toBe('hello');
	});

	test('index past a key that is there once makes a second entry of it', async () => {
		const { server, cfg, file, sec } = await section('[S]\nK = a\n');
		cfg('cfg_set_value', sec, 'K', 'x', 1);
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('[S]\n\nK = a\n\nK =  x\n');
	});

	test('a block built by hand: rows made up to the line, a row comment, delete and rebuild', async () => {
		const { server, cfg, file, sec } = await section('[S]\n\nCV = {\n\t"old"\n}\n');
		expect(cfg('cfg_delete_key', sec, 'CV')).toBe(true);
		expect(cfg('cfg_has_key', sec, 'CV')).toBe(false);
		expect(cfg('cfg_set_entry_type', sec, 'CV', 1)).toBe(true);
		expect(cfg('cfg_set_entry_content_type', sec, 'CV', 2)).toBe(true);
		cfg('cfg_set_value', sec, 'CV', 'a', 0, 0);
		cfg('cfg_set_value', sec, 'CV', 'b', 1, 0);
		cfg('cfg_set_value', sec, 'CV', 'c', 0, 2);
		expect(cfg('cfg_set_row_comment', sec, 'CV', 0, '; A | B')).toBe(true);
		expect(cfg('cfg_set_row_comment', sec, 'CV', 3, '; nope')).toBe(false);
		expect(cfg('cfg_get_array_size', sec, 'CV')).toBe(3);
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('[S]\n\nCV = {\n\t; A | B\n\t"a" "b"\n\t\n\t"c"\n}\n');
	});

	test('a path write makes the blocks on its way', async () => {
		const { server, cfg, file, sec } = await section('[S]\n');
		expect(cfg('cfg_set_value', sec, 'NEST/SUB/LEAF', 'v')).toBe(true);
		expect(cfg('cfg_get_value', sec, 'NEST/SUB/LEAF')).toBe('v');
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('[S]\n\nNEST = {\n\tSUB = {\n\t\tLEAF = v\n\t}\n}\n');
	});

	test('a row a path write adds has no comments of its own', async () => {
		const { server, cfg, file, sec } = await section('[S]\nP = {\n\t; c1\n\tA = 1\n}\n');
		cfg('cfg_set_value', sec, 'P/B', '2');
		cfg('cfg_save_config', file, 't');
		expect(server.file(`${CONFIGS}/t.ini`)).toBe('[S]\n\nP = {\n\t; c1\n\tA = 1\n\tB = 2\n}\n');
	});

	test('cfg_write_file writes the one section, a blank line after it', async () => {
		const { server, cfg, file } = await section('; head\n[S]\nK = 1\n[T]\nL = 2\n');
		expect(cfg('cfg_write_file', file, 'one', 'S')).toBe(true);
		expect(server.file(`${CONFIGS}/one.ini`)).toBe('; head\n[S]\nK = 1\n\n');
		expect(cfg('cfg_write_file', -1, 'two', 'T')).toBe(true); // looked for in every file
		expect(server.file(`${CONFIGS}/two.ini`)).toBe('[T]\nL = 2\n\n');
		expect(cfg('cfg_write_file', file, 'three', 'NONE')).toBe(false);
	});

	test('dump_config lists every section: headings to the admin, entries to the server console', async () => {
		const { server, cfg } = await section('[S]\nK = a b\nB = {\n\t"x" "y"\n}\n');
		const admin = server.join('Admin', { flags: 'g' });
		admin.command('dump_config');
		expect(admin.console).toBe('Current Configuration Dump:\nSection 0: S');
		expect(server.log).toContain('K = a b\nB = {\n\t = x y\n}');
		expect(cfg('cfg_get_sections_count')).toBe(1);
	});
});

describe('the include', () => {
	test('call-compatible with the original universal_config.inc', async () => {
		const { server } = await boot();
		const natives = server.plugins[0].natives;
		const generated = new IncludeParser(pawnInclude('config-core', natives)).parse();
		const original = new IncludeParser(readFileSync('includes/universal_config.inc', 'utf8')).parse();

		expect(generated.natives.map(n => n.name).sort()).toEqual(original.natives.map(n => n.name).sort());
		expect(generated.natives).toHaveLength(28);

		for (const theirs of original.natives) {
			const ours = generated.natives.find(n => n.name === theirs.name)!;
			// cfg_get_section_name answers 1 or 0 untagged in the original; `string | null` is bool:.
			if (theirs.name !== 'cfg_get_section_name') expect(`${theirs.name}: ${ours.returnType}`).toBe(`${theirs.name}: ${theirs.returnType}`);
			expect(ours.params.length).toBe(theirs.params.length);
			theirs.params.forEach((param, i) => {
				const mine = ours.params[i];
				const shape = (p: typeof param) => `${p.type}:${!!p.isArray}:${!!p.isConst}:${p.defaultValue ?? ''}`;
				expect(`${theirs.name}(${i}) ${shape(mine)}`).toBe(`${theirs.name}(${i}) ${shape(param)}`);
				// Named arguments (`.lineIndex = i`) need the names; only the result buffer's differ.
				if (!(param.isArray && !param.isConst)) expect(mine.name).toBe(param.name);
			});
		}

		const enums = nativeEnums(natives).map(e => `${e.name}{${e.members.map(m => `${m.name}=${m.value}`).join(',')}}`);
		expect(enums).toEqual([
			'ConfigFile{CFG_FILE_INVALID=-1}',
			'ConfigSection{CFG_SECTION_INVALID=-1}',
			'EntryType{CFG_ENTRY_SIMPLE=0,CFG_ENTRY_BRACKET=1}',
			'ContentType{CFG_CONTENT_SIMPLE=0,CFG_CONTENT_STRINGS=1,CFG_CONTENT_ENTRIES=2}',
		]);
	});
});
