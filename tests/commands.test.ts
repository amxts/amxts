import { loadPlugin } from '@amxts/core/test-utils';
// Commands with typed arguments: the build reads the usage and the type
// argument (scripts/typed-commands.ts) and the facade's CommandWords reads
// each word; tests/as/commands.ts on the fake server, and what does not build.
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import ts from 'typescript';
import { parseUsage, typedCommands } from '../scripts/typed-commands';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/commands.ts';
const COMMON = [
	'[en]',
	'USAGE = Usage',
	'MORE_CL_MATCHT = There is more than one client matching your argument',
	'CL_NOT_FOUND = Client with that name or userid not found',
	'',
].join('\n');

async function boot() {
	const server = await loadPlugin(PLUGIN, { files: { 'addons/amxmodx/data/lang/common.txt': COMMON } });
	const admin = server.join('Admin', { flags: 'c' });
	const alice = server.join('Alice');
	const alan = server.join('Alan');
	const bob = server.join('Bob Smith');
	return { server, admin, alice, alan, bob, heard: () => server.native('cmd_heard') };
}

describe('a command\'s arguments, read as their types say', () => {
	test('a Player by a part of his name, #userid or in quotes; the last text takes the rest of the line', async () => {
		const { admin, bob, heard } = await boot();

		admin.say('/kick bob being rude, again');
		expect(heard()).toBe('Admin kicks Bob Smith: being rude, again');
		admin.say(`/kick #${bob.userid}`);
		expect(heard()).toBe('Admin kicks Bob Smith: -');
		admin.say('/kick "Bob Smith" "bye"');
		expect(heard()).toBe('Admin kicks Bob Smith: bye');
		admin.say('/kick ALICE');
		expect(heard()).toBe('Admin kicks Alice: -');
	});

	test('a player nobody\'s name matches, or several, is answered with the usage', async () => {
		const { admin, heard } = await boot();

		admin.say('/kick al spam');
		expect(heard()).toBe('');
		expect(admin.chat).toBe('There is more than one client matching your argument: Alice, Alan\nUsage: /kick <target> [reason]');

		admin.clearMessages();
		admin.say('/kick zed');
		expect(admin.chat).toBe('Client with that name or userid not found\nUsage: /kick <target> [reason]');

		admin.clearMessages();
		admin.say('/kick');
		expect(admin.chat).toBe('Usage: /kick <target> [reason]');
		expect(heard()).toBe('');
	});

	test('a number, one of some words, and a word too many', async () => {
		const { alice, heard } = await boot();

		alice.command('give 5 armor');
		expect(heard()).toBe('Alice gives 5 armor');
		alice.command('give 2.5');
		expect(heard()).toBe('Alice gives 2.5 health');

		for (const wrong of ['give', 'give five', 'give 5 shoes', 'give 5 armor more']) {
			alice.clearMessages();
			alice.command(wrong);
			expect({ wrong, said: alice.chat }).toEqual({ wrong, said: 'Usage: give <amount> [what]' });
		}
		expect(heard()).toBe('');
	});

	test('without a type every argument is text; a command without arguments takes no words', async () => {
		const { alice, heard } = await boot();

		alice.say('/me waves "hello" to all');
		expect(heard()).toBe('Alice waves "hello" to all');
		alice.say('/hp');
		expect(heard()).toBe('Alice has 100 HP');
		alice.say('/hp now');
		expect(heard()).toBe('');
		expect(alice.chat).toBe('Usage: /hp');
		alice.say('rules');
		expect(heard()).toBe('Alice reads the rules');
	});

	test('the access a command asks for, and a server command\'s words', async () => {
		const { server, alice, heard } = await boot();

		expect(alice.say('/kick bob')).toBe(false);
		expect(heard()).toBe('');

		server.serverCommand('cmd_reset scores');
		expect(heard()).toBe('reset scores');
		server.serverCommand('cmd_reset');
		expect(heard()).toBe('reset all');
		server.serverCommand('cmd_reset everything');
		expect(heard()).toBe('');
		expect(server.log).toContain('Usage: cmd_reset [what]');
	});

	test('server.commands lists them: what a /help prints, by the access of who asks', async () => {
		const { admin, alice } = await boot();

		alice.say('/help');
		expect(alice.chat).toBe(['give <amount> [what]', '/me <text>', '/hp', 'say rules', 'cmd_reset [what]', '/help'].join('\n'));
		admin.say('/help');
		expect(admin.chat.split('\n')[0]).toBe('/kick <target> [reason]');
	});
});

describe('what does not build', () => {
	const KICK = 'interface KickArgs {\n\ttarget: Player;\n\treason?: string;\n}\n';

	function built(body: string) {
		const text = `import { server, Player } from "~/facade";\n${body}`;
		return typedCommands('plugins/a.ts', 'plugins/a.ts', text, () => null);
	}

	test('the usage\'s names and the interface\'s fields, both ways, and optional on both sides', () => {
		expect(built(`${KICK}server.addCommand<KickArgs>("/kick <target> [reason]", ({ target }) => {});\n`).problems).toEqual([]);
		expect(built(`${KICK}server.addCommand<KickArgs>("/kick <target> [reason] [count]", () => {});\n`).problems).toEqual([
			'plugins/a.ts:6:29: server.addCommand - count - the usage has it and KickArgs does not: add count?: string (or a number, a Player) to KickArgs, or take it out of the usage',
		]);
		expect(built(`${KICK}server.addCommand<KickArgs>("/kick <target>", () => {});\n`).problems).toEqual([
			'plugins/a.ts:4:2: server.addCommand - reason - KickArgs has it and the usage does not: write <reason> or [reason] in the usage, or take it out of KickArgs',
		]);
		expect(built(`${KICK}server.addCommand<KickArgs>("/kick <target> <reason>", () => {});\n`).problems).toEqual([
			'plugins/a.ts:4:2: server.addCommand - reason - the usage requires it, <reason>: write reason: without the ? in KickArgs, or [reason] in the usage',
		]);
		expect(built(`${KICK}server.addCommand<KickArgs>("/kick [target] [reason]", () => {});\n`).problems[0]).toContain('target - the usage has it optional, [target]: write target?: in KickArgs');
	});

	test('a type in place, a type that is not one of a command\'s, a usage that is not text in place', () => {
		expect(built('server.addCommand<{ target: Player }>("/kick <target>", () => {});\n').problems[0]).toContain('a command\'s arguments are an interface declared beside it, passed by its name');
		expect(built('interface A {\n\ton: boolean;\n}\nserver.addCommand<A>("/x <on>", () => {});\n').problems[0]).toContain('boolean - a command\'s argument is a number, a string, a Player or a union of string literals');
		// A name made at run time takes no arguments - or those a template writes after it.
		expect(built('const usage = "/hp";\nserver.addCommand(usage, () => {});\n').problems).toEqual([]);
		expect(built('interface A {\n\tvalue?: string;\n}\nconst name = "x";\nserver.addCommand<A>(name, () => {});\nserver.addCommand<A>(`${name} [value]`, () => {});\n').problems).toEqual([
			'plugins/a.ts:6:22: server.addCommand - a command with arguments has its usage in place - "/kick <target>", or `${name} <target>` for a name made at run time: the build reads the arguments from it',
		]);
		expect(built('interface A {\n\tplayer: Player;\n}\nserver.addCommand<A>("/x <player>", () => {});\n').problems[0]).toContain('player - the handler gets the player who typed the command as player');
	});

	test('a usage: its name, <required> and [optional] arguments; a chat phrase whole', () => {
		expect(parseUsage('/kick <target> [reason]')).toEqual({ name: '/kick', args: [{ name: 'target', optional: false }, { name: 'reason', optional: true }] });
		expect(parseUsage('say rules')).toEqual({ name: 'say rules', args: [] });
		expect(parseUsage('/x [a] <b>')).toBe('<b> - a required argument cannot follow an optional one');
		expect(parseUsage('/x target')).toContain('"target" - an argument is one word, <name> or [name]');
		expect(parseUsage('/x <a> <a>')).toBe('a - the usage names it twice');
	});

	test('the call becomes the generated function in its place, and every line keeps its number', () => {
		const source = `${KICK}server.addCommand<KickArgs>("/kick <target> [reason]", ({ target }) => {});\n`;
		const { text } = built(source);
		const lines = text.split('\n');
		expect(lines[5]).toBe('__amxtsCommand0            ("/kick <target> [reason]", ({ target }) => {});');
		expect(text).toContain('class __AmxtsCommandArgs0 {\n\tplayer!: __AmxtsPlayer;\n\ttarget!: __AmxtsPlayer;\n\treason?: string;\n}');
		// The generated code parses.
		const parsed = ts.createSourceFile('a.ts', text, ts.ScriptTarget.Latest, true);
		expect((parsed as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
	});
});
