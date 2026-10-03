import { readFileSync } from 'node:fs';
import { loadPlugin } from '@amxts/core/test-utils';
// Messages to clients as events, on the fake server: tests/as/messages.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { CLIENT_MESSAGES, MESSAGE_FIELDS, MESSAGE_GROUPS } from '../scripts/client-messages';
import { MESSAGES } from '../scripts/docs/messages';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/messages.ts';
// AMX Mod X's ARG_* of a message argument.
const BYTE = 1;
const SHORT = 3;
const LONG = 4;
const COORD = 6;
const STRING = 7;

const LISTENED = ['TextMsg', 'RoundTime', 'HideWeapon', 'TeamScore', 'ItemPickup', 'DeathMsg', 'TeamInfo', 'ScreenFade', 'StatusIcon', 'ScoreAttrib', 'VGUIMenu', 'Damage', 'BarTime', 'BarTime2', 'SpecHealth', 'SpecHealth2', 'VoiceMask'];

test('a message is registered once per name, when the server is up, and only its name reaches the plugin', async () => {
	const server = await loadPlugin(PLUGIN);
	const ids = LISTENED.map(name => server.messageIds.get(name));

	expect([...server.messageHooks.keys()].sort()).toEqual(ids.map(Number).sort());
	expect(server.sendMessage('Money', [800, 1]).prevented).toBe(false);
});

test('TextMsg: the destination is a name, the receiver a player, the texts put in a list; preventDefault stops it', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	const draw = server.sendMessage('TextMsg', [4, '#Round_Draw'], { player: alice });
	const other = server.sendMessage('TextMsg', [3, '#Game_Commencing']);
	const restart = server.sendMessage('TextMsg', [4, '#Game_will_restart_in', '1', 'SECOND']);

	expect(server.log).toContain('text center #Round_Draw [] to Alice');
	expect(server.log).toContain('text chat #Game_Commencing [] to everyone');
	expect(server.log).toContain('text center #Game_will_restart_in [1|SECOND] to everyone');
	expect(draw.prevented).toBe(true);
	expect(other.prevented).toBe(false);
	expect(restart.args).toEqual([4, '#Game_will_restart_in', '5', 'SECONDS']);
});

test('writing a field writes the argument: a number, flags', async () => {
	const server = await loadPlugin(PLUGIN);

	expect(server.sendMessage('RoundTime', [120], { types: [SHORT] }).args).toEqual([90]);
	// Timer (16) stays, Money (32) is added.
	expect(server.sendMessage('HideWeapon', [16]).args).toEqual([48]);
	expect(server.sendMessage('ItemPickup', ['weapon_knife']).prevented).toBe(true);
	expect(server.sendMessage('ItemPickup', ['item_kevlar']).prevented).toBe(false);
});

test('DeathMsg: the killer and the victim are players, the headshot a boolean', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bob = server.join('Bob');

	server.sendMessage('DeathMsg', [alice.id, bob.id, 1, 'ak47']);
	server.sendMessage('DeathMsg', [0, bob.id, 0, 'world']);

	expect(server.log).toContain('death Alice Bob true ak47');
	expect(server.log).toContain('death world Bob false world');
});

test('a team written as text is a Team, and a team is written back as its text', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	expect(server.sendMessage('TeamInfo', [alice.id, 'SPECTATOR']).args).toEqual([alice.id, 'CT']);
	expect(server.sendMessage('TeamScore', ['CT', 5], { types: [STRING, SHORT] }).args).toEqual(['CT', 6]);
	expect(server.sendMessage('TeamScore', ['TERRORIST', 2], { types: [STRING, SHORT] }).args).toEqual(['TERRORIST', 2]);

	expect(server.log).toContain('team Alice SPECTATOR');
	expect(server.log).toContain('score TeamScore CT 5');
});

test('ScreenFade: seconds, the direction, flags as booleans and the colour, as player.screen.fade takes them', async () => {
	const server = await loadPlugin(PLUGIN);
	const types = [SHORT, SHORT, SHORT, BYTE, BYTE, BYTE, BYTE];

	// 2048 is half a second; FFADE_OUT | FFADE_MODULATE.
	const sent = server.sendMessage('ScreenFade', [2048, 4096, 1 | 2, 0, 0, 0, 255], { types });

	expect(server.log).toContain('fade 0.5 1 out true false 0,0,0,255');
	// In (bit 1 cleared), modulate kept, stay (4) set; the colour written whole.
	expect(sent.args).toEqual([2048, 4096, 2 | 4, 255, 0, 0, 128]);
});

test('an argument the message did not write reads as empty: StatusIcon\'s colour when it hides the icon', async () => {
	const server = await loadPlugin(PLUGIN);

	server.sendMessage('StatusIcon', [0, 'buyzone'], { types: [BYTE, STRING] });
	server.sendMessage('StatusIcon', [1, 'c4', 0, 160, 0], { types: [BYTE, STRING, BYTE, BYTE, BYTE] });

	expect(server.log).toContain('icon hide buyzone [0,0,0]');
	expect(server.log).toContain('icon show c4 [0,160,0]');
});

test('ScoreAttrib\'s flags, VGUIMenu\'s menu and Damage\'s origin by name and as a vector', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	// SCORE_STATUS_DEAD | SCORE_STATUS_BOMB: the bomb is taken off.
	expect(server.sendMessage('ScoreAttrib', [alice.id, 1 | 2]).args).toEqual([alice.id, 1]);
	expect(server.log).toContain('attrib Alice dead,bomb');
	// VGUI_Menu_Team is 2, VGUI_Menu_Buy 28.
	expect(server.sendMessage('VGUIMenu', [2, 0x3FF, -1, 0, ' '], { types: [BYTE, SHORT, BYTE, BYTE, STRING] }).prevented).toBe(true);
	expect(server.sendMessage('VGUIMenu', [28, 0x3FF, -1, 0, ' '], { types: [BYTE, SHORT, BYTE, BYTE, STRING] }).prevented).toBe(false);

	const damage = server.sendMessage('Damage', [0, 30, 2, 10.5, -20, 64], { types: [BYTE, BYTE, LONG, COORD, COORD, COORD] });
	expect(server.log).toContain('damage 30 10.5 -20 64');
	expect(damage.args).toEqual([0, 30, 2, 1, 2, 3]);
});

test('one name hears both of its messages: BarTime\'s startPercent reads as 0 and is not written', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	expect(server.sendMessage('BarTime', [5], { types: [SHORT] }).args).toEqual([5]);
	expect(server.sendMessage('BarTime2', [5, 40], { types: [SHORT, SHORT] }).args).toEqual([5, 25]);
	expect(server.sendMessage('BarTime2', [9, 40], { types: [SHORT, SHORT] }).prevented).toBe(true);
	server.sendMessage('SpecHealth', [80]);
	server.sendMessage('SpecHealth2', [70, alice.id]);

	expect(server.log).toContain('bar BarTime 5 0');
	expect(server.log).toContain('bar BarTime2 5 40');
	expect(server.log).toContain('spectated SpecHealth 80 null');
	expect(server.log).toContain('spectated SpecHealth2 70 Alice');
});

test('a listener hears the screen\'s own progress bar, as it hears the game\'s', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	alice.command('msg_bar');

	expect(server.log).toContain('bar BarTime2 3 50');
	expect(server.userMessages).toEqual([{ name: 'BarTime2', player: alice.id, args: [3, 25] }]);
});

test('a message whose layout is not known is read by its arguments', async () => {
	const server = await loadPlugin(PLUGIN);

	server.sendMessage('VoiceMask', [7, 0], { types: [LONG, LONG] });

	expect(server.log).toContain('voice 2 7 false');
});

test('the layouts: every message the game has, every name\'s words and its fields\' in both languages, an argument once', () => {
	const events = readFileSync('as/events.ts', 'utf8');
	const groups = [...MESSAGE_GROUPS];

	for (const [message, fields] of Object.entries(MESSAGE_FIELDS)) {
		expect(CLIENT_MESSAGES).toContain(message);
		// Two fields over one argument only as bits of it.
		const plain = fields.filter(field => field.kind !== 'bit' && field.kind !== 'fadeDirection').map(field => field.arg);
		expect(new Set(plain).size).toBe(plain.length);
	}
	// Every message under a name in the player's words; a name's words are its first message's, ending with the game's names.
	expect(groups.flatMap(([, messages]) => messages).sort()).toEqual([...CLIENT_MESSAGES].sort());
	expect(Object.keys(MESSAGES).sort()).toEqual(groups.map(([, messages]) => messages[0]).sort());
	for (const [name, messages] of groups) {
		const words = MESSAGES[messages[0]];
		expect(name).toMatch(/^[a-z][A-Za-z0-9]*$/);
		expect(`${name}: ${words.summary.en && words.summary.ru ? 'words' : 'none'}`).toBe(`${name}: words`);
		for (const field of messages.flatMap(message => MESSAGE_FIELDS[message] ?? [])) {
			expect(`${name}.${field.name}: ${words.fields?.[field.name]?.ru ? 'words' : 'none'}`).toBe(`${name}.${field.name}: words`);
		}
		expect(events).toContain(`\t${name}: ${MESSAGE_FIELDS[messages[0]] ? `${messages[0]}Message` : 'ClientMessage'};`);
		expect(events).toContain(`\tif (name == "${name}") return [${messages.map(message => `"${message}"`).join(', ')}];`);
	}
	// The look-alikes that are one thing to an author share a name; a field one of them lacks says so.
	expect(MESSAGE_GROUPS.get('progressBar')).toEqual(['BarTime', 'BarTime2']);
	expect(events).toContain('The game\'s `BarTime` and `BarTime2` messages.');
	expect(events).toContain('`BarTime` does not carry it: there it reads as `0`, and writing it does nothing.');
	// The menu names are the game event's: VguiMenu from the same include.
	expect(events).toContain('case 27: return "classCT";');
});
