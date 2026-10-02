// TS-плагин рядом с menu-core: отвечает за плейсхолдер через нативы mc_*, -
// именем publicFor и setArgText, - и проверяет lang.translate: бот с lang ru
// получает русский перевод common.txt, а сервер (amx_language en) - свой.
import { publicFor, setArgText } from "@amxts/core";
import { mc_register_placeholder, set_user_info } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addEventListener("cfg", () => {
	lang.load("common");
	mc_register_placeholder("xt_ts", publicFor(tsValue, "xt:ts"));
});

function tsValue(id: number, target: number, value: number, len: number) {
	setArgText(2, "от TS", len);
}

server.addServerCommand("amxts_test_menu_lang", () => {
	const check = new Checks("menu-lang");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	new Cvar("amx_language").value = "en";
	new Cvar("amx_client_languages").value = "1";
	set_user_info(bot.id, "lang", "ru");

	check.expect(lang.translate(bot, "MORE"), "перевод на языке бота").toBe("Дальше");
	check.expect(lang.translate(null, "MORE"), "перевод на языке сервера").toBe("More");
	check.done();
});
