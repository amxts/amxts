// То, для чего нужен игрок: бот, которого добавил раннер, «пишет» в чат
// команду, и её обработчик получает этого игрока.
import { m_flVelocityModifier, m_iFOV, m_szTeamName, var_fov, var_weapons } from "@amxts/core/constants";
import { amxclient_cmd, get_cvar_string, get_entvar, get_member, get_speak, get_user_info, set_speak, set_user_info } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

let caller = "";
let words = "";

server.addCommand("/amxts_ping [words]", ({ player, words: typed }) => {
	caller = player.name;
	words = typed ?? "";
});

server.addServerCommand("amxts_test_player", run);

async function run() {
	const check = new Checks("player");

	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.isBot, "isBot").toBe(true);
	check.expect(bot.name.length > 0, `у бота есть имя (${bot.name})`).toBe(true);

	amxclient_cmd(bot.id, "say", "/amxts_ping раз два");
	check.expect(caller, "чат-команда дошла от бота").toBe(bot.name);
	check.expect(words, "аргументы команды").toBe("раз два");

	enumFields(check, bot);
	memberFields(check, bot);
	ammo(check, bot);
	language(check, bot);
	voice(check, bot);
	observer(check, bot);
	fieldOfView(check, bot);
	const answer = await bot.queryCvar("fps_max");
	check.expect(answer == null, "queryCvar у бота - null: спросить некого").toBe(true);
	joinTeam(check, bot);
	check.done();
}

/** Запас патронов к оружию, которое у игрока есть: getAmmo читает то, что записал setAmmo. */
function ammo(check: Checks, bot: Player) {
	if (!bot.isAlive) return;
	bot.give("weapon_hegrenade");
	const grenade = bot.items.find(item => item.classname == "weapon_hegrenade");
	check.expect(grenade?.kind ?? "none", "classname оружия - имя, которое берёт give: выданное находится в items").toBe("hegrenade");
	const before = bot.getAmmo("weapon_hegrenade");
	bot.setAmmo("weapon_hegrenade", 2);
	check.expect(bot.getAmmo("weapon_hegrenade"), "getAmmo читает записанное setAmmo").toBe(2);
	bot.setAmmo("weapon_hegrenade", before);
}

/** Члены игрока через натив: текстовый пишется и читается строкой, дробный - числом. */
function memberFields(check: Checks, bot: Player) {
	const team = bot.teamName;
	bot.teamName = "amxts";
	check.expect(get_member<string>(bot.id, m_szTeamName), "get_member<string> читает записанное").toBe("amxts");
	bot.teamName = team;

	check.expect(get_member(bot.id, m_flVelocityModifier), "get_member дробного поля - число").toBe(bot.velocityModifier);
}

/** Поля игрока с именами вместо чисел движка: броня, режим наблюдения, оружие. */
function enumFields(check: Checks, bot: Player) {
	const armour = bot.kevlar;
	bot.kevlar = "vestHelmet";
	check.expect(bot.kevlar, "kevlar читается именем").toBe("vestHelmet");
	bot.kevlar = armour;

	check.expect(bot.observerMode != "unknown", `observerMode - имя (${bot.observerMode})`).toBe(true);

	// Список оружия, записанный обратно, оставляет маску как была - и бит костюма тоже.
	const before = get_entvar(bot.id, var_weapons);
	const weapons = bot.weapons;
	bot.weapons = weapons;
	check.expect(get_entvar(bot.id, var_weapons), `weapons (${weapons.join(",")}) записаны обратно без потерь`).toBe(before);
}

/** Язык: setinfo lang игрока, а без него - язык сервера. */
function language(check: Checks, bot: Player) {
	const own = get_user_info(bot.id, "lang");
	set_user_info(bot.id, "lang", "ru");
	check.expect(bot.language, "language - его setinfo lang").toBe("ru");
	set_user_info(bot.id, "lang", "");
	check.expect(bot.language, "без setinfo lang - язык сервера").toBe(get_cvar_string("amx_language"));
	set_user_info(bot.id, "lang", own);
}

/** Голос: каждое свойство - свой бит set_speak, остальные не трогаются. */
function voice(check: Checks, bot: Player) {
	const before = get_speak(bot.id);
	set_speak(bot.id, 0);
	bot.hearsEveryone = true;
	bot.heardByEveryone = true;
	bot.muted = true;
	check.expect(get_speak(bot.id), "три бита: SPEAK_MUTED | SPEAK_ALL | SPEAK_LISTENALL").toBe(7);
	bot.heardByEveryone = false;
	check.expect(get_speak(bot.id), "снят один SPEAK_ALL").toBe(5);
	check.expect(bot.hearsEveryone, "hearsEveryone читается").toBe(true);
	set_speak(bot.id, before);
}

/**
 * Режим наблюдения ставится, как его ставит игра: на того, за кем можно
 * наблюдать, а без такого - свободный полёт; выбранный режим запоминается.
 * "none" только очищает поле.
 */
function observer(check: Checks, bot: Player) {
	const last = bot.observerLastMode;
	const watched = bot.iuser2;

	// Игра не переключает на режим, в котором он уже есть.
	bot.observerMode = "none";
	bot.observerMode = "chaseFree";
	const expected = bot.iuser2 > 0 ? "chaseFree" : "roaming";
	check.expect(bot.observerMode, `observerMode - как решила игра (цель ${bot.iuser2})`).toBe(expected);
	check.expect(bot.observerLastMode, "observerLastMode - выбранный режим").toBe("chaseFree");

	bot.observerMode = "none";
	check.expect(bot.observerMode, "\"none\" записан как есть").toBe("none");
	bot.observerLastMode = last;
	bot.iuser2 = watched;
}

/** Поле зрения игрока - m_iFOV, по которому игра приближает прицел; pev->fov пишется вместе с ним, как это делает игра. */
function fieldOfView(check: Checks, bot: Player) {
	const before = bot.fov;
	bot.fov = 110;
	check.expect(get_member(bot.id, m_iFOV), "fov записан в m_iFOV").toBe(110);
	check.expect(get_entvar(bot.id, var_fov), "и в pev->fov").toBe(110.0);
	check.expect(bot.fov, "fov прочитан обратно").toBe(110);
	const entity: Entity = bot;
	check.expect(entity.health, "health игрока через Entity - его собственный").toBe(bot.health);
	bot.fov = before;
}

/** Вход в сторону как выбор игрока - и обратно. Последним: бот при этом может умереть. */
function joinTeam(check: Checks, bot: Player) {
	const side = bot.team;
	const other = side == "CT" ? "TERRORIST" : "CT";
	check.expect(bot.joinTeam(other), `joinTeam("${other}") - игра согласилась`).toBe(true);
	check.expect(bot.team, "бот на другой стороне").toBe(other);
	check.expect(bot.joinTeam("UNASSIGNED"), "joinTeam(\"UNASSIGNED\") - false").toBe(false);
	if (side == "CT" || side == "TERRORIST") bot.joinTeam(side);
}
