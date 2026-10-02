// What a player is for: a bot the runner added "writes" a command in chat,
// and its handler gets this player. The module reads and writes the player's
// fields in memory itself; what is written is checked against the engine and
// fakemeta modules, which every server has, and reapi natives where reapi is.
import { EV_FL_fov, EV_INT_weapons, m_autoBuyString, m_flVelocityModifier } from "@amxts/core/constants";
import {
	amxclient_cmd,
	entity_get_float,
	entity_get_int,
	get_cvar_string,
	get_ent_data,
	get_ent_data_float,
	get_ent_data_string,
	get_member,
	get_speak,
	get_user_info,
	set_speak,
	set_user_info,
} from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

let caller = "";
let words = "";

server.addCommand("/amxts_ping [words]", ({ player, words: typed }) => {
	caller = player.name;
	words = typed ?? "";
});

server.addServerCommand("amxts_test_player", run);

// The last Money message and its player, as every plugin's message listeners hear it.
let moneyShown = -1;
let moneyShownTo = 0;

server.addEventListener("message:Money", (message) => {
	moneyShown = message.amount;
	moneyShownTo = message.player?.id ?? 0;
});

async function run() {
	const check = new Checks("player");

	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.isBot, "isBot").toBe(true);
	check.expect(bot.name.length > 0, `the bot has a name (${bot.name})`).toBe(true);

	// Cyrillic on purpose: a chat command's arguments are UTF-8.
	amxclient_cmd(bot.id, "say", "/amxts_ping раз два");
	check.expect(caller, "the chat command came from the bot").toBe(bot.name);
	check.expect(words, "the command's arguments").toBe("раз два");

	enumFields(check, bot);
	memberFields(check, bot);
	ammo(check, bot);
	language(check, bot);
	voice(check, bot);
	observer(check, bot);
	fieldOfView(check, bot);
	money(check, bot);
	const answer = await bot.queryCvar("fps_max");
	check.expect(answer == null, "queryCvar of a bot is null: there is no one to ask").toBe(true);
	joinTeam(check);
	check.done();
}

/** The ammo for a weapon the player has: getAmmo reads what setAmmo wrote. */
function ammo(check: Checks, bot: Player) {
	if (!bot.isAlive) return;
	bot.give("weapon_hegrenade");
	const grenade = bot.items.find(item => item.classname == "weapon_hegrenade");
	check.expect(grenade?.kind ?? "none", "a weapon's classname is the name give takes: what is given is found in items").toBe("hegrenade");
	const before = bot.getAmmo("weapon_hegrenade");
	bot.setAmmo("weapon_hegrenade", 2);
	check.expect(bot.getAmmo("weapon_hegrenade"), "getAmmo reads what setAmmo wrote").toBe(2);
	bot.setAmmo("weapon_hegrenade", before);
}

/** The player's members: a text one is written and read as a string, a float one as a number; the reapi native sees the same. */
function memberFields(check: Checks, bot: Player) {
	const autoBuy = bot.autoBuyString;
	bot.autoBuyString = "amxts";
	check.expect(get_ent_data_string(bot.id, "CBasePlayer", "m_autoBuyString"), "a text member is written where the game keeps it").toBe("amxts");
	if (hasModule("reapi")) check.expect(get_member<string>(bot.id, m_autoBuyString), "get_member<string> reads what is written").toBe("amxts");
	bot.autoBuyString = autoBuy;

	check.expect(get_ent_data_float(bot.id, "CBasePlayer", "m_flVelocityModifier"), "a float member is a number").toBe(bot.slowdown);
	if (hasModule("reapi")) check.expect(get_member(bot.id, m_flVelocityModifier), "get_member of a float field is a number").toBe(bot.slowdown);
}

/** The player's fields with names instead of the engine's numbers: armor, observer mode, weapons. */
function enumFields(check: Checks, bot: Player) {
	const armour = bot.kevlar;
	bot.kevlar = "vestHelmet";
	check.expect(bot.kevlar, "kevlar reads as a name").toBe("vestHelmet");
	bot.kevlar = armour;

	check.expect(bot.observerMode != "unknown", `observerMode is a name (${bot.observerMode})`).toBe(true);

	// A weapon list written back leaves the mask as it was - the suit's bit too.
	const before = entity_get_int(bot.id, EV_INT_weapons);
	const weapons = bot.weapons;
	bot.weapons = weapons;
	check.expect(entity_get_int(bot.id, EV_INT_weapons), `weapons (${weapons.join(",")}) are written back without loss`).toBe(before);
}

/** The language: the player's setinfo lang, and without it the server's language. */
function language(check: Checks, bot: Player) {
	const own = get_user_info(bot.id, "lang");
	set_user_info(bot.id, "lang", "ru");
	check.expect(bot.language, "language is its setinfo lang").toBe("ru");
	set_user_info(bot.id, "lang", "");
	check.expect(bot.language, "without setinfo lang it is the server's language").toBe(get_cvar_string("amx_language"));
	set_user_info(bot.id, "lang", own);
}

/** Voice: each property is its own bit of set_speak, the others are left alone. */
function voice(check: Checks, bot: Player) {
	const before = get_speak(bot.id);
	set_speak(bot.id, 0);
	bot.hearsEveryone = true;
	bot.heardByEveryone = true;
	bot.muted = true;
	check.expect(get_speak(bot.id), "three bits: SPEAK_MUTED | SPEAK_ALL | SPEAK_LISTENALL").toBe(7);
	bot.heardByEveryone = false;
	check.expect(get_speak(bot.id), "one SPEAK_ALL is cleared").toBe(5);
	check.expect(bot.hearsEveryone, "hearsEveryone reads").toBe(true);
	set_speak(bot.id, before);
}

/**
 * The observer mode is set as the game sets it: on someone who can be
 * watched, and without one free flight; the chosen mode is remembered.
 * "none" only clears the field.
 */
function observer(check: Checks, bot: Player) {
	const last = bot.observerLastMode;
	const watched = bot.iuser2;

	// The game does not switch to the mode it is already in.
	bot.observerMode = "none";
	bot.observerMode = "chaseFree";
	const expected = bot.iuser2 > 0 ? "chaseFree" : "roaming";
	check.expect(bot.observerMode, `observerMode is what the game decided (target ${bot.iuser2})`).toBe(expected);
	check.expect(bot.observerLastMode, "observerLastMode is the chosen mode").toBe("chaseFree");

	bot.observerMode = "none";
	check.expect(bot.observerMode, "\"none\" is written as it is").toBe("none");
	bot.observerLastMode = last;
	bot.iuser2 = watched;
}

/** The player's field of view - m_iFOV, by which the game zooms the sight; pev->fov is written with it, as the game does. */
function fieldOfView(check: Checks, bot: Player) {
	const before = bot.fov;
	bot.fov = 110;
	check.expect(get_ent_data(bot.id, "CBasePlayer", "m_iFOV"), "fov is written to m_iFOV").toBe(110);
	check.expect(entity_get_float(bot.id, EV_FL_fov), "and to pev->fov").toBe(110.0);
	check.expect(bot.fov, "fov reads back").toBe(110);
	const entity: Entity = bot;
	check.expect(entity.health, "a player's health through Entity is its own").toBe(bot.health);
	bot.fov = before;
}

/** Money written shows on the player's HUD: the Money message goes to him with the new amount. */
function money(check: Checks, bot: Player) {
	const before = bot.money;
	moneyShown = -1;
	bot.money = before + 500;
	check.expect(get_ent_data(bot.id, "CBasePlayer", "m_iAccount"), "money is written to m_iAccount").toBe(before + 500);
	check.expect(moneyShownTo, "a Money message went to the player").toBe(bot.id);
	check.expect(moneyShown, "with the new amount").toBe(before + 500);
	bot.money = before;
}

/**
 * Joining a side as the player's choice - and back. The bot is from the bigger side: the game
 * without ReAPI does not let anyone in where there would be more players than
 * mp_limitteams allows. Last: the bot may die doing it.
 */
function joinTeam(check: Checks) {
	const count = (team: Team) => server.players.filter(player => player.team === team).length;
	const side: Team = count("CT") >= count("TERRORIST") ? "CT" : "TERRORIST";
	const other: Team = side == "CT" ? "TERRORIST" : "CT";
	const bot = server.players.filter(player => player.isBot && player.team === side)[0];
	check.expect(bot.joinTeam(other), `joinTeam("${other}") - the game agreed`).toBe(true);
	check.expect(bot.team, "the bot is on the other side").toBe(other);
	check.expect(bot.joinTeam("UNASSIGNED"), "joinTeam(\"UNASSIGNED\") - false").toBe(false);
	bot.joinTeam(side);
}
