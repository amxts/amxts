import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPlugin } from '@amxts/core/test-utils';
/**
 * Fields plugins add to Player, shared by every plugin (scripts/player-fields.ts,
 * the module's store in runtime/src/module.cpp, the fake's in
 * src/testing/server.ts). Two fixture plugins, tests/as/data-writer.ts and
 * data-reader.ts, share tests/as/player-state.ts's fields and data-fields.ts's.
 */
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { describe as describeType, playerFieldsSource } from '../scripts/player-fields';
import { compileWasmFile } from '../src/testing/compile';

setDefaultTimeout(120_000);

const PLUGINS = ['tests/as/data-writer.ts', 'tests/as/data-reader.ts'];

test('what one plugin writes, another reads', async () => {
	const server = await loadPlugin(PLUGINS);
	const alice = server.join('Alice');

	alice.command('data_read');
	expect(alice.console).toBe('ghost=false glow=default kills=0 tag=');

	alice.command('data_write Привет мир');
	alice.command('data_write Привет мир');
	alice.clearMessages();
	alice.command('data_read');
	expect(alice.console).toBe('ghost=true glow=default kills=3 tag=Привет мир');

	// Another player's fields are his own.
	const bob = server.join('Bob');
	bob.command('data_read');
	expect(bob.console).toBe('ghost=false glow=default kills=0 tag=');
});

test('a player who leaves takes his fields with him, after the plugins heard him go', async () => {
	const server = await loadPlugin(PLUGINS);
	const alice = server.join('Alice');
	alice.command('data_write x');
	const slot = alice.id;

	alice.disconnect();
	expect(server.log).toContain('left with ghost=true glow=default kills=1.5 tag=x');

	const next = server.join('Carol');
	expect(next.id).toBe(slot);
	next.command('data_read');
	expect(next.console).toBe('ghost=false glow=default kills=0 tag=');
});

test('Pawn reads and writes the same fields through the module natives', async () => {
	const server = await loadPlugin(PLUGINS);
	const alice = server.join('Alice');
	alice.command('data_write Привет');

	expect(server.amxtsNative('amxts_get_player_data', alice.id, 'ghost')).toBe(1);
	expect(server.amxtsNative('amxts_get_player_data', alice.id, 'kills')).toBe(1);
	expect(server.amxtsNative('amxts_get_player_data_float', alice.id, 'kills')).toBe(1.5);
	expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'tag')).toBe('Привет');
	// Half of a letter is not a character: cut before it.
	expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'tag', 3)).toBe('П');
	expect(server.amxtsNative('amxts_get_player_data', alice.id, 'no_such_field')).toBe(0);

	server.amxtsNative('amxts_set_player_data', alice.id, 'ghost', 0);
	server.amxtsNative('amxts_set_player_data_string', alice.id, 'glow.enabled', 'false');
	server.amxtsNative('amxts_set_player_data_float', alice.id, 'kills', 7.25);
	server.amxtsNative('amxts_set_player_data_string', alice.id, 'tag', 'from Pawn');
	alice.clearMessages();
	alice.command('data_read');
	expect(alice.console).toBe('ghost=false glow=off kills=7.25 tag=from Pawn');
});

describe('an object field', () => {
	const OBJECTS = ['tests/as/object-fields.ts', 'tests/as/data-reader.ts'];

	test('reads "default" until written; a member written is written through at once, under a dotted key', async () => {
		const server = await loadPlugin(OBJECTS);
		const alice = server.join('Alice');
		alice.command('sc_read');
		expect(alice.console).toBe('off=false on=false default=true seenBy= includes=false');
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'glow.enabled')).toBe('');

		alice.command('sc_on');
		alice.clearMessages();
		alice.command('sc_read');
		expect(alice.console).toBe('off=false on=true default=false seenBy= includes=false');
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'glow.enabled')).toBe('true');

		// Another plugin sees it.
		alice.clearMessages();
		alice.command('data_read');
		expect(alice.console).toContain('glow=true');
	});

	test('assigning the whole object writes every member; Player[] is the ids, and push writes back', async () => {
		const server = await loadPlugin(OBJECTS);
		const alice = server.join('Alice');
		const bob = server.join('Bob');
		const carol = server.join('Carol');

		alice.command('sc_all');
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'glow.enabled')).toBe('false');
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'glow.seenBy')).toBe(`${bob.id},${carol.id}`);
		alice.command('sc_read');
		expect(alice.console).toBe(`off=true on=false default=false seenBy=${bob.id},${carol.id} includes=true`);

		bob.command('sc_push');
		expect(server.amxtsNative('amxts_get_player_data_string', bob.id, 'glow.seenBy')).toBe(`${alice.id}`);

		// Pawn writes a member as text, and TS reads it.
		server.amxtsNative('amxts_set_player_data_string', bob.id, 'glow.enabled', 'default');
		server.amxtsNative('amxts_set_player_data_string', bob.id, 'glow.seenBy', `${carol.id}`);
		bob.clearMessages();
		bob.command('sc_read');
		expect(bob.console).toBe(`off=false on=false default=true seenBy=${carol.id} includes=false`);
	});

	test('a player who leaves goes from the Player[] lists of everyone', async () => {
		const server = await loadPlugin(OBJECTS);
		const alice = server.join('Alice');
		const bob = server.join('Bob');
		const carol = server.join('Carol');
		alice.command('sc_all');
		bob.disconnect();
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'glow.seenBy')).toBe(`${carol.id}`);
		// The next in his slot is nobody's; Carol, the first of the others now, still is.
		const next = server.join('Dave');
		expect(next.id).toBe(bob.id);
		alice.command('sc_read');
		expect(alice.console).toBe(`off=true on=false default=false seenBy=${carol.id} includes=true`);
	});

	test('an interface of the same file: a literal of it, then assigned, then its members live', async () => {
		const server = await loadPlugin(OBJECTS);
		const alice = server.join('Alice');
		const bob = server.join('Bob');
		alice.command('badge_read');
		expect(alice.console).toBe('title= level=0 shown=false color=red fans= friends=');

		alice.command('badge_write');
		alice.clearMessages();
		alice.command('badge_read');
		expect(alice.console).toBe(`title=Охотник level=2.5 shown=true color=blue fans=${bob.id} friends=${bob.id},${alice.id}`);
		expect(server.amxtsNative('amxts_get_player_data_float', alice.id, 'badge.level')).toBe(2.5);
		expect(server.amxtsNative('amxts_get_player_data', alice.id, 'badge.shown')).toBe(1);
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'badge.color')).toBe('blue');
		expect(server.amxtsNative('amxts_get_player_data_string', alice.id, 'friends')).toBe(`${bob.id},${alice.id}`);
	});
});

describe('playerchange', () => {
	const WATCHED = ['tests/as/data-writer.ts', 'tests/as/object-fields.ts', 'tests/as/data-watcher.ts'];

	/** What the plugins logged since the last call. */
	const heard = (server: Awaited<ReturnType<typeof loadPlugin>>) => server.logLines.splice(0);

	test('another plugin\'s write is heard, with the field\'s value before and after, of its type', async () => {
		const server = await loadPlugin(WATCHED);
		const alice = server.join('Alice');
		heard(server);

		alice.command('data_write hi');
		expect(heard(server)).toEqual([
			'ghost Alice: false -> true',
			'any: ghost',
			'kills: 1 -> 2.5',
			'any: kills',
			'tag: "" -> "hi"',
			'any: tag',
		]);

		// The same values again are no change.
		alice.command('data_write hi');
		expect(heard(server)).toEqual(['kills: 2.5 -> 4', 'any: kills']);
	});

	test('an object field hears each member that changes, with the object as it was and is', async () => {
		const server = await loadPlugin(WATCHED);
		const alice = server.join('Alice');
		server.join('Bob');
		heard(server);

		alice.command('sc_on');
		expect(heard(server)).toEqual(['glow glow.enabled: default -> true, seen by ', 'any: glow.enabled']);

		// The whole object: one change a member, in order.
		alice.command('sc_all');
		expect(heard(server)).toEqual([
			'glow glow.enabled: true -> false, seen by ',
			'any: glow.enabled',
			'glow glow.seenBy: false -> false, seen by Bob',
			'any: glow.seenBy',
		]);

		// A member's own listener hears only it.
		alice.command('sc_default');
		expect(heard(server)).toEqual(['glow glow.enabled: false -> default, seen by Bob', 'enabled: back to default', 'any: glow.enabled']);
	});

	test('Pawn\'s write is heard; a player leaving is "disconnected", not a change', async () => {
		const server = await loadPlugin(WATCHED);
		const alice = server.join('Alice');
		server.join('Bob');
		alice.command('sc_all');
		heard(server);

		server.amxtsNative('amxts_set_player_data', alice.id, 'ghost', 1);
		server.amxtsNative('amxts_set_player_data', alice.id, 'ghost', 1);
		expect(heard(server)).toEqual(['ghost Alice: false -> true', 'any: ghost']);

		server.players.find(player => player.name === 'Bob')!.disconnect();
		expect(heard(server).filter(line => !line.startsWith('left with'))).toEqual([]);
	});

	test('removeEventListener with the same function and field stops it; the others go on', async () => {
		const server = await loadPlugin(WATCHED);
		const alice = server.join('Alice');
		alice.command('watch_stop');
		heard(server);

		alice.command('data_write hi');
		expect(heard(server)).toEqual(['ghost Alice: false -> true', 'any: ghost', 'kills: 1 -> 2.5', 'any: kills', 'any: tag']);
	});
});

test('a field a playerchange listener names is one the plugin imports, written out', async () => {
	const listen = (options: string) => compileProbe({ 'plugin.ts': plugin('').replace('server.addEventListener("infochanged"', `server.addEventListener("playerchange", (event) => console.log(event.field), ${options});\nserver.addEventListener("infochanged"`) });
	expect(await listen('{ field: "ghost" }')).toBeNull();
	expect(await listen('{ field: "glow.enabled" }')).toBeNull();
	expect(await listen('{ field: "gost" }')).toContain('playerchange - "gost" is not a field of Player in what this plugin imports ("ghost", "glow", "glow.enabled"');
	expect(await listen('{ field: "kills" }')).toContain('"kills" is not a field of Player');

	const named = await compileProbe({ 'plugin.ts': `${plugin('')}\nfunction onGhost(event: PlayerChangeEvent<"gohst">) {\n\tconsole.log(event.field);\n}\n` });
	expect(named).toContain('"gohst" is not a field of Player');

	const held = await compileProbe({ 'plugin.ts': `${plugin('')}\nconst field = "ghost";\nserver.addEventListener("playerchange", (event) => console.log(event.field), { field });\n` });
	expect(held).toContain('playerchange - the field is written out, as the event\'s name is: { field: "spawnProtected" }');
});

test('a listener\'s event has the field\'s type: a value of another type does not compile', async () => {
	const typed = (body: string) => compileProbe({ 'plugin.ts': `${plugin('')}\nserver.addEventListener("playerchange", (event) => {\n\t${body}\n}, { field: "ghost" });\n` });
	expect(await typed('const on: boolean = event.value;')).toBeNull();
	expect(await typed('console.log(event.previous.toUpperCase());')).toContain('Property \'toUpperCase\' does not exist on type \'~lib/number/Bool\'');
});

let probes = 0;

const PLAYER_STATE = readFileSync('tests/as/player-state.ts', 'utf8');

/**
 * A plugin in a folder of its own, compiled: the error, or null. The folder is
 * the same one every run, so the compile cache knows it again.
 */
async function compileProbe(files: Record<string, string>) {
	const dir = join(tmpdir(), 'amxts-fields', String(probes++));
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	try {
		// Every probe has the shared fields' file beside it, as a plugin has the file of the plugin that owns them.
		for (const [name, text] of Object.entries({ 'player-state.ts': PLAYER_STATE, ...files })) writeFileSync(join(dir, name), text);
		return await compileWasmFile({ source: join(dir, 'plugin.ts'), root: 'as' }, join(dir, 'plugin.wasm'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function plugin(body: string) {
	return [
		'import { server } from "~/facade";',
		'import "./player-state";',
		'',
		'server.addEventListener("infochanged", (event) => {',
		'\tconst player = event.player;',
		`\t${body}`,
		'});',
		'',
	].join('\n');
}

const fields = (member: string) => `import "~/facade";\n\ndeclare module "~/facade" {\n\tinterface Player {\n\t\t${member}\n\t}\n}\n`;

test('a misspelt field does not compile', async () => {
	expect(await compileProbe({ 'plugin.ts': plugin('player.ghost = true;') })).toBeNull();

	const problem = await compileProbe({ 'plugin.ts': plugin('player.gost = true;') });
	expect(problem).toContain('Property \'gost\' does not exist');
});

test('a field of a file the plugin does not import is not there', async () => {
	const problem = await compileProbe({ 'plugin.ts': plugin('player.kills = 1;') });
	expect(problem).toContain('Property \'kills\' does not exist');
});

test('one field, one type', async () => {
	const problem = await compileProbe({
		'plugin.ts': `import "./fields";\n${plugin('player.ghost = true;')}`,
		'fields.ts': fields('ghost: number;'),
	});
	expect(problem).toMatch(/Player\.ghost is \w+ here and \w+ at .* - one field, one type/);
});

test('`true | false | "default"` is one type on a field and in the plugin\'s own interface', async () => {
	const body = 'const mine: Body = { enabled: player.glow.enabled }; player.glow.enabled = mine.enabled;';
	const problem = await compileProbe({ 'plugin.ts': `${plugin(body)}\ninterface Body {\n\tenabled: true | false | "default";\n}\n` });
	expect(problem).toBeNull();
});

test('a field of a type the store does not hold is a build error naming it, and a field is never optional', async () => {
	const probe = (member: string) => compileProbe({
		'plugin.ts': `import "./fields";\n${plugin('')}`,
		'fields.ts': fields(member),
	});
	expect(await probe('ids: number[];')).toContain('Player.ids: number[] - a field is boolean, number, string, a union of string literals');
	expect(await probe('spot: { at: { x: number } };')).toContain('Player.spot.at: { x: number } - a member is boolean, number, string');
	expect(await probe('spot: { at?: number };')).toContain('Player.spot.at - a member is never missing');
	expect(await probe('nick?: string;')).toContain('Player.nick - a field is never missing');
});

test('a field Player already has is refused, not silently replaced', async () => {
	const problem = await compileProbe({
		'plugin.ts': `import "./fields";
${plugin('')}`,
		'fields.ts': fields('solid: boolean;'),
	});
	expect(problem).toContain('Player.solid - Entity already has solid; name the field something else');
});

test('only interface Player goes into declare module "~/facade"', async () => {
	const problem = await compileProbe({
		'plugin.ts': `import "./fields";
${plugin('')}`,
		'fields.ts': `import "~/facade";

declare module "~/facade" {
	interface Player {
		kills: number;
	}
	const limit: number;
}
`,
	});
	expect(problem).toContain('declare module "~/facade" - only `interface Player { ... }` goes here, not "const limit: number;"');
});

test('an object field: a class with a getter and a setter a member, over dotted keys; Player[] a list that writes back', () => {
	const source = playerFieldsSource([{
		name: 'glow',
		type: {
			interface: null,
			members: [
				{ name: 'enabled', type: { literals: ['default'], boolean: true } },
				{ name: 'seenBy', type: 'players' },
			],
		},
		where: '',
	}]);
	expect(source).toContain('get glow(): __AmxtsPlayer_glow { const value = new __AmxtsPlayer_glow(); value.__slot = this.id; return value; }');
	expect(source).toContain('mine.enabled = value.enabled; mine.seenBy = value.seenBy;');
	expect(source).toContain('__amxts_pf_choice(this.__slot, "glow.enabled", "default")');
	expect(source).toContain('__amxts_pf_set_text(this.__slot, "glow.enabled", value)');
	expect(source).toContain('__AmxtsPlayerList.read(this.__slot, "glow.seenBy")');
	expect(source).toContain('class __AmxtsPlayerList extends Array<Player>');
	expect(describeType({ interface: null, members: [
		{ name: 'enabled', type: { literals: ['default'], boolean: true } },
		{ name: 'seenBy', type: 'players' },
	] })).toBe('{ enabled: true | false | "default"; seenBy: Player[] }');
});

test('the generated accessors: a getter and a setter a field, by name, on this.id', () => {
	const source = playerFieldsSource([
		{ name: 'ghost', type: 'boolean', where: '' },
		{ name: 'kills', type: 'number', where: '' },
		{ name: 'tag', type: 'string', where: '' },
	]);
	expect(source).toContain('get ghost(): bool { return __amxts_pf_get(this.id, "ghost") != 0; }');
	expect(source).toContain('set kills(value: f64) { __amxts_pf_set(this.id, "kills", value); }');
	expect(source).toContain('get tag(): string { return __amxts_pf_text(this.id, "tag"); }');
});

test('a change event a field: value and previous of its type, under the name its listener\'s call is given', () => {
	const source = playerFieldsSource([
		{ name: 'ghost', type: 'boolean', where: '' },
		{ name: 'glow', type: { interface: null, members: [{ name: 'enabled', type: { literals: ['default'], boolean: true } }] }, where: '' },
	]);
	expect(source).toContain('@global export class __PlayerChange$ghost extends PlayerChangeEvent {');
	expect(source).toContain('get value(): bool { return this.__number != 0; }');
	expect(source).toContain('get previous(): string { return __amxts_pf_choose(this.__previousText, "default"); }');
	expect(source).toContain('value.enabled = this.field == "glow.enabled" ? __amxts_pf_choose(t, "default") : __amxts_pf_choose(__amxts_pf_text(this.__slot, "glow.enabled"), "default");');
	expect(source).toContain('"playerchange:ghost": __PlayerChange$ghost;');
	expect(source).toContain('"playerchange:glow": __PlayerChange$glow;');
	expect(source).toContain('"playerchange:glow.enabled": __PlayerChange$glow$enabled;');
});
