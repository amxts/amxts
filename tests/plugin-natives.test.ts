import { loadPlugin } from '@amxts/core/test-utils';
// A plugin's own natives - its `export function`s - and fs, on the fake server.
//
// tests/as/natives.ts was the server check plugin (verified 2026-09-23); here it runs under
// bun, its natives called the way a Pawn plugin calls them (the .inc
// signature: strings, Float bits, array + size, out-buffers), and fs against
// the fake's in-memory game folder.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, test } from 'bun:test';
import { pawnInclude, setNativesBeside } from '../scripts/plugin-natives';
import { pluginProbe } from './probe';

const server = await loadPlugin('tests/as/natives.ts');

describe('natives from export function', () => {
	test('strings in, a string out through out[] and len', () => {
		expect(server.native('xn_join', 'a', 'бв', 'c')).toBe('a|бв|c');
	});

	test('a string longer than 255 characters crosses whole', () => {
		const long = 'x'.repeat(3000);
		expect(server.native('xn_length', long)).toBe(3000);
		expect(server.native('xn_join', long, '', '')).toBe(`${long}||`);
	});

	test('a string result is cut to the caller\'s buffer, never mid-character', () => {
		expect(server.nativeWithRoom('xn_join', 4, ['ab', 'cd', ''])).toBe('ab|c');
		expect(server.nativeWithRoom('xn_join', 3, ['aж', '', ''])).toBe('aж');
		expect(server.nativeWithRoom('xn_join', 2, ['aж', '', ''])).toBe('a');
	});

	test('an optional string: left out it is "", which is false', () => {
		expect(server.native('xn_greet')).toBe('никого');
		expect(server.native('xn_greet', '')).toBe('никого');
		expect(server.native('xn_greet', 'Боб')).toBe('привет, Боб');
	});

	test('a default parameter: the .inc has it, and a value passed wins', () => {
		expect(server.native('xn_parse_int', '42', -1)).toBe(42);
		expect(server.native('xn_parse_int', 'nope', 7)).toBe(7);
	});

	test('Float in and out', () => {
		expect(server.native('xn_half', 5)).toBeCloseTo(2.5);
	});

	test('an array and its size in', () => {
		expect(server.native('xn_sum', [1, 2, 3, 4])).toBe(10);
		expect(server.native('xn_sum', [])).toBe(0);
	});

	test('Float arrays in and out, the count as the result', () => {
		const scaled = server.native('xn_scale', [1, 2.5, -4], 2) as number[];
		expect(scaled.length).toBe(3);
		expect(scaled[1]).toBeCloseTo(5);
		expect(scaled[2]).toBeCloseTo(-8);
	});

	test('an array result stops at the caller\'s max', () => {
		expect(server.native('xn_range', 5)).toEqual([0, 1, 2, 3, 4]);
		expect(server.nativeWithRoom('xn_range', 3, [10])).toEqual([0, 1, 2]);
	});

	test('a Vector argument is Float:v[3]', () => {
		expect(server.native('xn_magnitude', [3, 4, 0])).toBeCloseTo(5);
	});

	test('boolean in and out', () => {
		expect(server.native('xn_not', true)).toBe(false);
		expect(server.native('xn_not', false)).toBe(true);
	});

	test('string | null is a bool, and the text in out[]', () => {
		expect(server.native('xn_lookup', 'greeting')).toBe('привет');
		expect(server.native('xn_lookup', 'nothing')).toBe(null);
	});

	test('a Player parameter: a player slot reaches the function, anything else answers the default', () => {
		const alice = server.join('Alice');
		expect(server.native('xn_player_name', alice.id)).toBe('Alice');
		expect(server.native('xn_player_name', 0)).toBe('');
		expect(server.native('xn_player_name', 33)).toBe('');
		expect(server.native('xn_player_name', -1)).toBe('');

		expect(server.native('xn_player_or_none', alice.id)).toBe(alice.id);
		expect(server.native('xn_player_or_none', 0)).toBe(-1);
		expect(server.native('xn_player_or_none')).toBe(-1);
		expect(server.native('xn_player_or_none', 33)).toBe(0);

		expect(server.native('xn_player_pair', 2, 3, 4)).toBe(234);
		expect(server.native('xn_player_pair', 2, 0, 4)).toBe(0);
	});

	test('fs from inside a native', () => {
		expect(server.native('xn_save', 'addons/amxmodx/data/n.txt', 'текст')).toBe(true);
		expect(server.file('addons/amxmodx/data/n.txt')).toBe('текст');
		expect(server.native('xn_load', 'addons/amxmodx/data/n.txt')).toBe('текст');
		expect(server.native('xn_save', 'no/such/folder/n.txt', 'x')).toBe(false);
	});

	test('the .inc a Pawn plugin includes', () => {
		const include = pawnInclude('natives', server.plugins[0].natives);
		expect(include).toContain(' * Author: amxts');
		expect(include).toContain('#define _natives_included');
		expect(include).toContain('native xn_join(const a[], const b[], const c[], out[], len);');
		expect(include).toContain('native xn_length(const text[]);');
		expect(include).toContain('native xn_parse_int(const text[], fallback = -1);');
		expect(include).toContain('native Float:xn_half(Float:value);');
		expect(include).toContain('native xn_sum(const values[], values_size);');
		expect(include).toContain('native xn_scale(const Float:values[], values_size, Float:factor, Float:out[], size);');
		expect(include).toContain('native xn_range(count, out[], size);');
		expect(include).toContain('native Float:xn_magnitude(const Float:v[3]);');
		expect(include).toContain('native bool:xn_not(bool:flag);');
		expect(include).toContain('native bool:xn_lookup(const key[], out[], len);');
		expect(include).toContain('native bool:xn_save(const path[], const text[]);');
		// A Player is a player id; `player` is called `id`, as Pawn calls it.
		expect(include).toContain('native xn_player_name(id, out[], len);');
		expect(include).toContain('native xn_player_or_none(id = 0);');
		expect(include).toContain('native xn_player_pair(first, second, extra);');
		// `name?: string` is text Pawn may leave out.
		expect(include).toContain('native xn_greet(out[], len, const name[] = "");');
		// The function's own comment goes along.
		expect(include).toContain('Три строки через');
	});
});

describe('fs', () => {
	test('the file the plugin wrote at load', () => {
		expect(server.file('addons/amxmodx/data/amxts-natives.ini')).toBe('greeting=привет\nround_time=2.5\n');
	});

	test('a file of any size is read whole', () => {
		const big = 'абв'.repeat(20000);
		server.writeFile('addons/amxmodx/data/big.txt', big);
		expect(server.nativeWithRoom('xn_load', 200000, ['addons/amxmodx/data/big.txt'])).toBe(big);
	});

	test('a file of any size is written whole', () => {
		const big = `${'строка;'.repeat(5000)}end`;
		expect(server.native('xn_save', 'addons/amxmodx/data/big-out.txt', big)).toBe(true);
		expect(server.file('addons/amxmodx/data/big-out.txt')).toBe(big);
	});

	test('a missing file', () => {
		expect(server.native('xn_load', 'addons/amxmodx/data/none.txt')).toBe('');
		expect(server.native('xn_exists', 'addons/amxmodx/data/none.txt')).toBe(false);
	});

	test('exists sees files and folders', () => {
		expect(server.native('xn_exists', 'addons/amxmodx/data/amxts-natives.ini')).toBe(true);
		expect(server.native('xn_exists', 'addons/amxmodx')).toBe(true);
	});

	test('readdir lists a folder without . and ..', () => {
		server.writeFile('maps/de_dust2.bsp', '');
		server.writeFile('maps/de_inferno.bsp', '');
		expect(server.native('xn_list', 'maps')).toBe('de_dust2.bsp,de_inferno.bsp');
		expect(server.native('xn_list', 'no-such-folder')).toBe(null);
	});
});

describe('an export a native cannot be', () => {
	test('a parameter of another type stops the build with its name', async () => {
		const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
		mkdirSync('tests/as/tmp', { recursive: true });
		writeFileSync('tests/as/tmp/bad-native.ts', 'export function bad(list: string[]) { return 1; }\n');
		try {
			await expect(loadPlugin('tests/as/tmp/bad-native.ts')).rejects.toThrow(/bad - parameter "list: Array<string>"|bad - parameter "list: string\[\]"/);
		} finally {
			rmSync('tests/as/tmp', { recursive: true, force: true });
		}
	});

	test('more arguments than the module reads stop the build', async () => {
		const { mkdirSync, writeFileSync, rmSync } = await import('node:fs');
		mkdirSync('tests/as/tmp', { recursive: true });
		// 63 numbers and a list: 65 arguments in Pawn, the list's size one of them.
		const params = [...Array.from({ length: 63 }, (_, i) => `a${i}: number`), 'list: number[]'];
		writeFileSync('tests/as/tmp/wide-native.ts', `export function wide(${params.join(', ')}) { return list.length; }\n`);
		try {
			await expect(loadPlugin('tests/as/tmp/wide-native.ts')).rejects.toThrow('wide - Pawn passes it 65 arguments, and a native takes at most 64');
		} finally {
			rmSync('tests/as/tmp', { recursive: true, force: true });
		}
	});
});

describe('a contract native', () => {
	const include = [
		'native probe_team(TeamName:team, const text[] = "", TeamName:color = TEAM_UNASSIGNED);',
		'native probe_count(count);',
		'',
	].join('\n');

	test('a Team where the include says TeamName: its number comes as the name, and a bad one never reaches it', async () => {
		const heard = await pluginProbe('contract', `
import { Team, plugin } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
let last = "";
export function probe_team(team: Team, text?: string, color: Team = "UNASSIGNED") {
	last = \`\${team}/\${text ? text : "-"}/\${color}\`;
}
export function probe_count(count: number) {
	return count;
}
export function probe_last() {
	return last;
}
`, include, async (file) => {
			const server = await loadPlugin(file);
			const answers = [server.native('probe_team', 2, 'hi', 1)];
			const first = server.native('probe_last');
			answers.push(server.native('probe_team', 1));
			const second = server.native('probe_last');
			const bad = server.native('probe_team', 7, 'no');
			return { answers, first, second, bad, after: server.native('probe_last') };
		});
		expect(heard.answers).toEqual([1, 1]);
		expect(heard.first).toBe('CT/hi/TERRORIST');
		expect(heard.second).toBe('TERRORIST/-/UNASSIGNED');
		expect(heard.bad).toBe(0);
		expect(heard.after).toBe('TERRORIST/-/UNASSIGNED');
	});

	test('a Team where the include has an untagged cell stops the build', async () => {
		const error = await pluginProbe('contract', `
import { Team, plugin } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
export function probe_team(team: Team, text?: string, color: Team = "UNASSIGNED") {}
export function probe_count(count: Team) {}
`, include, async (file) => {
			try {
				await loadPlugin(file);
				return '';
			} catch (problem) {
				return String((problem as Error).message ?? problem);
			}
		});
		expect(error).toContain('parameter "count": a Team is a TeamName number, and the include declares count');
	});
});

test('an author with */ in the name does not end the header of the include', () => {
	const natives: Parameters<typeof pawnInclude>[1] = [];
	setNativesBeside(natives, { enums: [], contract: null, author: 'a */ b' });
	const header = pawnInclude('probe', natives).split('#if')[0];

	expect(header).toContain(String.raw` * Author: a *\/ b`);
	expect(header.match(/\*\//g)).toHaveLength(1);
});
