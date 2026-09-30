import { readFileSync } from 'node:fs';
import { loadPlugin } from '@amxts/core/test-utils';
// What the bridge carries between the host plugin, the module and a plugin:
// reapi's field natives by each field's kind, a server event with all of its
// arguments, and the host plugin's one public for every exported native.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { floatBits } from '../src/testing/memory';

setDefaultTimeout(120_000);

const FIXTURE = 'tests/as/field-natives.ts';
const natives = readFileSync('as/natives.ts', 'utf8');
const host = readFileSync('runtime/host/amxts_host.sma', 'utf8');

test('each field native pair has a table of its fields\' kinds, read off reapi\'s comments', () => {
	const kinds = natives.match(/export function __get_entvar_kind\(field: i32\): i32 \{[\s\S]*?\n\}/)?.[0] ?? '';
	// var_gravity a Float, var_origin a vector, var_classname text.
	expect(kinds).toMatch(/case var_gravity:\n(?:\t\tcase \w+:\n)*\t\t\treturn 1;/);
	expect(kinds).toMatch(/case var_origin:\n(?:\t\tcase \w+:\n)*\t\t\treturn 2;/);
	expect(kinds).toMatch(/case var_classname:\n(?:\t\tcase \w+:\n)*\t\t\treturn 3;/);
	// m_rgAmmo is a whole-number array member: 0 + 4.
	expect(natives).toMatch(/case m_rgAmmo:\n(?:\t\tcase \w+:\n)*\t\t\treturn 4;/);
	// set_member shares get_member's table; get_member_s, reapi's rename, too.
	expect(natives).toContain('__setField<T>(new Call(NATIVE_set_member).num(index).num(member), __get_member_kind(<i32>member), value, element, "set_member")');
	expect(natives).toContain('__getField<T>(new Call(NATIVE_get_member_s).num(index).num(member), __get_member_kind(<i32>member), element, "get_member_s")');
});

test('a field native reads and writes a field as what it holds', async () => {
	const server = await loadPlugin(FIXTURE);
	const alice = server.join('Alice');
	alice.command('fields');

	expect(server.log).toContain('gravity 0.5 0.5');
	expect(server.log).toContain('origin 10 20 30.5');
	expect(server.log).toContain('team CT CT');
	expect(server.log).toContain('ammo 42');
	expect(server.log).toContain('classname player');
	// A vector read as a number is nothing, and the console says what to write.
	expect(server.log).toContain('get_entvar: this field is a Vector - write get_entvar<Vector>(...)');
	expect(server.log).toContain('as a number 0');
	expect(alice.get('m_szTeamName')).toBe('CT');
});

test('a server event hands its listener every argument, all twelve of pfn_playbackevent', async () => {
	expect(host).toContain('return amxts_event("pfn_playbackevent", "nnnfa3a3ffnnnn", flags, entid, eventid, delay, Origin, Angles, fparam1, fparam2, iparam1, iparam2, bparam1, bparam2);');

	const server = await loadPlugin(FIXTURE);
	server.fire('pfn_playbackevent', 0, 1, 26, floatBits(0.5), [1, 2, 3].map(floatBits), [0, 90, 0].map(floatBits), 0, 0, 0, 0, 0, 1);
	expect(server.log).toContain('played 26 at 1,2,3 delay 0.5 last 1');
});

test('every exported native is the host plugin\'s one public, and its heap holds long text', () => {
	expect(host).toContain('public __amxts_native(plugin, params)\n{\n\treturn amxts_native(plugin, params);\n}');
	expect(host).toContain('native amxts_native(caller, argc);');
	expect(host).not.toMatch(/__amxts_nat\d/);
	// 16384 cells a string and more than one of them at a time.
	expect(Number(host.match(/^#pragma dynamic (\d+)$/m)?.[1])).toBeGreaterThanOrEqual(4 * 16384);
});
