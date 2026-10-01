import { readFileSync } from 'node:fs';
import { loadPlugin } from '@amxts/core/test-utils';
// Forward, as far as it can be read without a server.
//
// subscribe() rides on two bridge natives the module registers; wamrc only
// calls them directly when the signature table lists them. And a forward's
// number is a Pawn cell: once plugin numbers became f64, Forward<number>
// declared FP_FLOAT and every forward handed Pawn plugins the bits of a
// double - this keeps that from coming back.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { floatBits } from '../src/testing/memory';
import { pluginProbe } from './probe';

setDefaultTimeout(180_000);

test('the subscribe bridge natives are in the signature table', () => {
	const table = readFileSync('runtime/natives.txt', 'utf8');
	expect(table).toMatch(/^subscribe \(iii\)$/m);
	expect(table).toMatch(/^emit_local \(iiii\)$/m);
});

test('a number argument is declared FP_CELL, FP_FLOAT only where the declaration says Float', () => {
	const facade = readFileSync('as/facade.ts', 'utf8');
	const declared = facade.match(/function forwardParam<T>\(crossing: string\): i32 \{[\s\S]*?\n\}/);
	expect(declared).not.toBeNull();
	expect(declared![0]).toContain('if (crossing == CROSS_FLOAT) return FP_FLOAT;');
	expect(declared![0]).toMatch(/return FP_CELL;\n\}$/);
});

test('a Team goes to Pawn as its TeamName number, and comes back a Team', async () => {
	const server = await loadPlugin('tests/as/forward-teams.ts');
	const alice = server.join('Alice');
	alice.command('fw_join');
	expect(server.forwards).toContainEqual({ name: 'myplugin_on_player_joined_team', args: [alice.id, 2] });
	expect(alice.console).toBe('heard CT');
});

/** The include the probes below declare their forwards in. */
const FORWARDS = 'forward probe_on_player_joined_team(id, TeamName:iTeam);\nforward probe_on_round_end(WinStatus:status);\nforward probe_on_data(const data[3]);\n';

/** Builds a plugin from `code`; what the build said, or "" when it built. */
function buildError(code: string, include = ''): Promise<string> {
	return pluginProbe('forward', code, include, async (file) => {
		try {
			await loadPlugin(file);
			return '';
		} catch (problem) {
			return String((problem as Error).message ?? problem);
		}
	});
}

test('a number goes as a Float where the declaration says Float, and as a cell otherwise', async () => {
	const sent = await pluginProbe('forward', `
import { Forward, plugin, server } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
const speed = new Forward<number, number>("probe_on_speed");
server.addCommand("fw_speed", (player, args) => { speed.emit(2.5, 3); });
`, 'forward probe_on_speed(Float:speed, count);\n', async (file) => {
		const server = await loadPlugin(file);
		server.join('Alice').command('fw_speed');
		return server.forwards;
	});
	expect(sent).toContainEqual({ name: 'probe_on_speed', args: [2.5, 3] });
});

test('a Team for a forward no include declares is a build error, not text in Pawn', async () => {
	const error = await buildError(`
import { Forward, Team } from "@amxts/core";
export const changed = new Forward<Team>("probe_on_team_changed");
`);
	expect(error).toContain('no include declares probe_on_team_changed');
});

test('a string where the declaration has a cell is a build error', async () => {
	const error = await buildError(`
import { Forward, Player, plugin } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
export const joined = new Forward<Player, string>("probe_on_player_joined_team");
`, FORWARDS);
	expect(error).toContain('argument 2 is TeamName:iTeam in the include, a cell');
});

test('a forward with another number of arguments than its declaration is a build error', async () => {
	const error = await buildError(`
import { Forward, plugin } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
export const ended = new Forward<number, number>("probe_on_round_end");
`, FORWARDS);
	expect(error).toContain('declares probe_on_round_end with 1 argument');
});

test('a RoundWinner goes to Pawn as its WinStatus number, and comes back a RoundWinner', async () => {
	const sent = await pluginProbe('forward', `
import { Forward, RoundWinner, plugin, print, server } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
const ended = new Forward<RoundWinner>("probe_on_round_end");
let heard = "";
ended.subscribe(onEnded);
server.addCommand("fw_end", end);
function onEnded(winner: RoundWinner) {
	heard = winner;
}
function end(player: Player, args: string[]) {
	ended.emit("TERRORIST");
	print(player, \`heard \${heard}\`, "console");
}
import { Player } from "@amxts/core";
`, FORWARDS, async (file) => {
		const server = await loadPlugin(file);
		const alice = server.join('Alice');
		alice.command('fw_end');
		return { forwards: server.forwards, console: alice.console };
	});
	expect(sent.forwards).toContainEqual({ name: 'probe_on_round_end', args: [2] });
	expect(sent.console).toBe('heard TERRORIST');
});

/** A plugin that emits and hears a forward of every kind of argument, past the old three. */
const EVERY_KIND = `
import { Float, Forward, Player, Vector, server } from "@amxts/core";
const bought = new Forward<Player, string, number, Float, boolean, number[], Vector, string>("probe_on_every_kind");
bought.subscribe(onBought);
server.addCommand("fw_every", (player) => {
	bought.emit(player, "раз два", 7, 2.5, true, [1, 2, 3], new Vector(1.5, 2.5, 3.5), "x".repeat(700));
});
function onBought(player: Player, word: string, count: number, speed: Float, flag: boolean, list: number[], at: Vector, long: string) {
	console.log(\`heard \${player.name} \${word} \${count} \${speed} \${flag} \${list.join(",")} \${at.x},\${at.y},\${at.z} \${long.length}\`);
}
`;

test('a forward carries eight arguments of every kind to Pawn and to a subscriber', async () => {
	const heard = await pluginProbe('forward', EVERY_KIND, '', async (file) => {
		const server = await loadPlugin(file);
		const alice = server.join('Alice');
		alice.command('fw_every');
		return { server, alice };
	});
	const sent = heard.server.forwards.find(f => f.name === 'probe_on_every_kind');
	// A Float without an include is a Float by its type; a Vector is three Floats.
	expect(sent?.args).toEqual([heard.alice.id, 'раз два', 7, 2.5, 1, [1, 2, 3], [1.5, 2.5, 3.5].map(floatBits), 'x'.repeat(700)]);
	expect(heard.server.log).toContain('heard Alice раз два 7 2.5 true 1,2,3 1.5,2.5,3.5 700');
});

test('a forward a Pawn plugin raises reaches a subscriber with all its arguments', async () => {
	const log = await pluginProbe('forward', EVERY_KIND, '', async (file) => {
		const server = await loadPlugin(file);
		const alice = server.join('Alice');
		server.fire('probe_on_every_kind', alice.id, 'три', 9, floatBits(0.25), 0, [4, 5], [1, 2, 3].map(floatBits), 'y'.repeat(3000));
		return server.log;
	});
	expect(log).toContain('heard Alice три 9 0.25 false 4,5 1,2,3 3000');
});

test('a forward takes 32 arguments, as many as AMX Mod X gives one', async () => {
	const count = 32;
	const names = Array.from({ length: count }, (_, i) => `a${i + 1}`);
	const heard = await pluginProbe('forward', `
import { Forward, server } from "@amxts/core";
const wide = new Forward<${names.map(() => 'number').join(', ')}>("probe_on_wide");
wide.subscribe(onWide);
server.addCommand("fw_wide", (player) => {
	wide.emit(${names.map((_, i) => i + 1).join(', ')});
});
function onWide(${names.map(n => `${n}: number`).join(', ')}) {
	console.log(\`wide \${${names.join(' + ')}} \${a32}\`);
}
`, '', async (file) => {
		const server = await loadPlugin(file);
		server.join('Alice').command('fw_wide');
		return { forwards: server.forwards, log: server.log };
	});
	expect(heard.forwards).toContainEqual({ name: 'probe_on_wide', args: Array.from({ length: count }, (_, i) => i + 1) });
	expect(heard.log).toContain('wide 528 32');
});

test('an array where the declaration has a cell is a build error', async () => {
	const error = await buildError(`
import { Forward, plugin } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
export const ended = new Forward<number[]>("probe_on_round_end");
`, FORWARDS);
	expect(error).toContain('argument 1 is WinStatus:status in the include, a cell: a number[] would go as an array');
});

test('an array the declaration leaves without a tag is a build error: it would cross as text', async () => {
	const error = await buildError(`
import { Forward, plugin } from "@amxts/core";
plugin({ name: "probe", version: "1", author: "x", include: "PROBE_INC" });
export const data = new Forward<number[]>("probe_on_data");
`, FORWARDS);
	expect(error).toContain('argument 1 is data[] in the include, without a tag: Pawn passes it as text, and a number[] would arrive empty');
});
