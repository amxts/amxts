import { readFileSync } from 'node:fs';
import { loadPlugin } from '@amxts/core/test-utils';
// A bot a plugin adds, moves and kicks; and the natives whose `...` tail takes
// any kind of argument - text, a Float, a vector, a Ref - each sent as Pawn
// sends it.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const FIXTURE = 'tests/as/bots.ts';
const natives = readFileSync('as/natives.ts', 'utf8');

test('an `any:...` tail is an argument of its own type each, and its Floats are read off the include', () => {
	expect(natives).toContain('export function engfunc<T1 = NoArgument, T2 = NoArgument');
	expect(natives).toContain('a1: T1 = __noArgument<T1>()');
	expect(natives).toContain('__callTail<T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12>(new Call(NATIVE_engfunc).num(type_), __engfunc_floats(<i32>type_), a1');
	// RunPlayerMove: forwardmove, sidemove and upmove - the tail's 2, 3 and 4.
	expect(natives).toMatch(/case EngFunc_RunPlayerMove:\n\t\t\treturn 28;/);
	// Time's float is the result; VecToYaw's comes back through one more argument.
	expect(natives).toMatch(/case EngFunc_Time:\n\t\t\treturn 65536;/);
	expect(natives).toMatch(/case EngFunc_VecToYaw:\n\t\t\treturn 2;/);
	// pev's Float fields are a range of its enum.
	expect(natives).toContain('return selector > pev_float_start && selector < pev_float_end ? 1 : 0;');
});

test('engfunc and dllfunc take text, vectors, Floats and a Ref, and give back what they write', async () => {
	const server = await loadPlugin(FIXTURE);
	server.serverCommand('tail_natives');

	expect(server.log).toContain('fake client 1');
	expect(server.player(1)?.name).toBe('Tail');
	expect(server.log).toMatch(/model \d+/);
	expect(server.precached).toContain('models/x.mdl');
	expect(server.engineCalls).toContain('TraceLine 1,2,3 4,5,6.5 1 7 -');
	expect(server.log).toContain('angles 90');
	expect(server.log).toContain('connect 0 "No room for you"');
	expect(server.log).toContain('frame 0.009999999776482582');
});

test('server.addBot makes a bot the plugins hear come and go; move runs its moves', async () => {
	const server = await loadPlugin(FIXTURE);
	server.serverCommand('bot_add Dummy');

	expect(server.log).toContain('putinserver Dummy bot true');
	expect(server.log).toContain('added Dummy as 1');
	expect(server.engineCalls).toEqual(['ClientConnect 1 Dummy 127.0.0.1', 'ClientPutInServer 1']);

	server.serverCommand('bot_move');
	// Jump (2) and Duck (4) held; the frame's 10 ms when no msec is given.
	expect(server.engineCalls).toContain('RunPlayerMove 1 0,90,0 250 0 0 6 0 10');
	expect(server.engineCalls).toContain('RunPlayerMove 1 0,0,0 100 0 0 0 0 50');
	expect(server.player(1)?.origin[0]).toBeCloseTo(5);
	expect(server.player(1)?.origin[1]).toBeCloseTo(2.5);

	server.serverCommand('bot_kick');
	expect(server.log).toContain('disconnected Dummy');
	expect(server.player(1)).toBeUndefined();
});

test('no free slot is null, and a player is not moved', async () => {
	const server = await loadPlugin(FIXTURE, { maxPlayers: 1 });
	const alice = server.join('Alice');
	server.serverCommand('bot_add Dummy');
	expect(server.log).toContain('no slot');

	alice.command('human_move');
	expect(server.log).toContain('refused: move: Alice is not a bot - only a bot is moved by a plugin');
});
