// A TS plugin beside menu-core: answers for a placeholder through the mc_* natives -
// by a publicFor name and setArgText - and checks lang.translate: a bot with lang ru
// gets common.txt's Russian translation, and the server (amx_language en) its own.
import { publicFor, setArgText } from "@amxts/core";
import { mc_register_placeholder, set_user_info } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addEventListener("cfg", () => {
	lang.load("common");
	mc_register_placeholder("xt_ts", publicFor(tsValue, "xt:ts"));
});

function tsValue(id: number, target: number, value: number, len: number) {
	setArgText(2, "from TS", len);
}

server.addServerCommand("amxts_test_menu_lang", () => {
	const check = new Checks("menu-lang");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	new Cvar("amx_language").value = "en";
	new Cvar("amx_client_languages").value = "1";
	set_user_info(bot.id, "lang", "ru");

	// Cyrillic on purpose: common.txt's Russian translation.
	check.expect(lang.translate(bot, "MORE"), "a translation in the bot's language").toBe("Дальше");
	check.expect(lang.translate(null, "MORE"), "a translation in the server's language").toBe("More");
	check.done();
});
