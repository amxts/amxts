import { loadPlugin } from '@amxts/core/test-utils';
// What a player has and does, on the fake server: tests/as/player-api.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/player-api.ts';

test('getAmmo reads what setAmmo wrote; a weapon he does not carry is 0', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('pl_ammo');

	expect(alice.console).toBe('2 0');
	expect(alice.ammo.get('weapon_flashbang')).toBe(2);
});

test('language: his setinfo lang, else the server\'s - as lang.translate picks it', async () => {
	const server = await loadPlugin(PLUGIN, { cvars: { amx_language: 'de' } });
	const alice = server.join('Alice');
	const read = () => {
		alice.command('pl_lang');
		return alice.console.split('\n').at(-1);
	};

	const none = read();
	alice.info.set('lang', 'ru');
	const own = read();
	alice.info.set('lang', '1ru');
	const notALanguage = read();
	alice.info.set('lang', 'ru');
	server.setCvar('amx_client_languages', 0);
	const serverWide = read();

	expect([none, own, notALanguage, serverWide]).toEqual(['de', 'ru', 'de', 'de']);
});

test('authType, protocol and authKey: what Reunion says, and "unknown", 0 and "" without it or without reapi', async () => {
	const lines: string[] = [];
	for (const options of [{ reunion: true }, {}, { reunion: true, modules: ['cstrike', 'fun', 'hamsandwich', 'engine', 'fakemeta'] }]) {
		const server = await loadPlugin(PLUGIN, options);
		const alice = server.join('Alice', { authType: 'revEmu2013', protocol: 47, authKey: 'a1b2c3' });
		const bob = server.join('Bob');

		alice.command('pl_auth');
		bob.command('pl_auth');
		lines.push(alice.console, bob.console);
	}

	expect(lines).toEqual(['revEmu2013 47 a1b2c3', 'steam 48 ', 'unknown 0 ', 'unknown 0 ', 'unknown 0 ', 'unknown 0 ']);
});

test('voice: muted, heard by everyone and hears everyone are set_speak\'s three bits, each kept apart', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const speak: number[] = [];

	for (const line of ['pl_voice muted heard hears', 'pl_voice hears', 'pl_voice muted', 'pl_voice']) {
		alice.command(line);
		speak.push(alice.speak);
	}

	// SPEAK_MUTED 1, SPEAK_ALL 2, SPEAK_LISTENALL 4.
	expect(speak).toEqual([7, 4, 1, 0]);
	expect(alice.console.split('\n')).toEqual(['true true true', 'false false true', 'true false false', 'false false false']);
});

test('joinTeam: the side, with reapi and without it; no side to join is false', async () => {
	for (const modules of [undefined, ['cstrike', 'fun', 'hamsandwich', 'engine', 'fakemeta']]) {
		const server = await loadPlugin(PLUGIN, { modules });
		const alice = server.join('Alice', { team: 'UNASSIGNED' });

		alice.command('pl_join CT');
		alice.command('pl_join TERRORIST');
		alice.command('pl_join UNASSIGNED');

		expect(alice.console.split('\n')).toEqual(['true CT', 'true TERRORIST', 'false TERRORIST']);
	}
});

test('playSound: SendAudio to the player alone, at the normal pitch', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('pl_sound');

	expect(server.userMessages).toEqual([{ name: 'SendAudio', player: alice.id, args: [alice.id, 'vox/one.wav', 100] }]);
	expect(server.sounds).toEqual([{ entity: alice.id, sample: 'vox/one.wav' }]);
});

test('observerMode switches as the game does: onto a living player, roaming with nobody to watch; "none" only clears it', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	alice.alive = false;

	alice.command('pl_observe inEye');
	const bob = server.join('Bob');
	alice.command('pl_observe chaseFree');
	alice.command('pl_observe none');

	expect(alice.console.split('\n')).toEqual(['roaming inEye 0', `chaseFree chaseFree ${bob.id}`, `none chaseFree ${bob.id}`]);
});

test('a weapon\'s classname is the name give takes; the one given is found in items', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice', { weapons: [] });
	server.join('Bob', { weapons: [] });
	alice.give('weapon_ak47').set('m_Weapon_iClip', 7);
	alice.give('weapon_deagle').set('m_Weapon_iClip', 3);

	alice.command('pl_copy_weapons');

	expect(alice.console).toBe('weapon_ak47 7, weapon_deagle 3');
});

test('queryCvar: the answer the client gives, null for a cvar it has not; a bot is null at once', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const bot = server.join('Bot', { bot: true });

	alice.command('pl_cvar fps_max');
	alice.command('pl_cvar fps_override');
	alice.command('pl_cvar no_such_cvar');
	bot.command('pl_cvar fps_max');
	server.answerCvar(alice, 'fps_override', '0');
	server.answerCvar(alice, 'fps_max', '99.5');
	server.answerCvar(alice, 'no_such_cvar', 'Bad CVAR request');

	expect(alice.console.split('\n')).toEqual(['fps_override = 0', 'fps_max = 99.5', 'no_such_cvar = none']);
	expect(bot.console).toBe('fps_max = none');
});

test('queryCvar: a player who leaves before he answers rejects it with an AbortError', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('pl_cvar_left');
	alice.disconnect();

	expect(server.log).toContain('fps_max: AbortError');
});

test('a field the client learns from a message sends it: money, armour, flashlight, night vision, defuse kit', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	alice.set('m_iAccount', 800);
	server.userMessages.length = 0;

	alice.command('pl_hud');

	expect(alice.get('m_iAccount')).toBe(1300);
	expect(alice.get('var_body')).toBe(0);
	expect(server.userMessages.map(message => [message.name, message.player, ...message.args])).toEqual([
		['Money', alice.id, 1300, 1],
		['ArmorType', alice.id, 1],
		['FlashBat', alice.id, 40],
		['ItemStatus', alice.id, 1],
		['NVGToggle', alice.id, 1],
		['StatusIcon', alice.id, 1, 'defuser', 0, 160, 0],
		['ItemStatus', alice.id, 3],
		['StatusIcon', alice.id, 0, 'defuser'],
		['ItemStatus', alice.id, 1],
	]);
});
