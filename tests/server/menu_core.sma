// menu-core глазами Pawn-плагина: меню с плейсхолдером Pawn-плагина и
// плейсхолдером TS-плагина (menu-ts.ts), строка источника списка и ключ
// перевода (common.txt AMX Mod X), показанные боту с lang ru на сервере с
// amx_language en. Что меню показывает, читается mc_get_menu_text.
// Запускается командой amxts_test_menu_core; строки лога - как у Checks.
#include <amxmodx>
#include <menu_core>

new g_ok, g_failed;

public plugin_init()
{
	register_plugin("amxts test: menu-core", "1.0", "amxts");
	register_srvcmd("amxts_test_menu_core", "run");
	register_dictionary("common.txt");
}

public run()
{
	g_ok = 0;
	g_failed = 0;
	server_print("[menu-core] --- run");

	new players[32], count;
	get_players(players, count, "d");
	expect_int("на сервере есть бот", count > 0, 1);
	if (count == 0) return finish();
	new bot = players[0];

	set_cvar_string("amx_language", "en");
	set_cvar_num("amx_client_languages", 1);
	set_user_info(bot, "lang", "ru");

	mc_register_placeholder("xt_pawn", "Placeholder_Pawn");
	mc_register_list_data_source("LIST_XT", "Source_Rows");
	mc_create_menu("XT_MENU", "MORE");
	mc_add_menu_item("XT_MENU", "Pawn:", "%xt_pawn%");
	mc_add_menu_item("XT_MENU", "TS:", "%xt_ts%");
	mc_add_menu_item("XT_MENU", "EXIT");
	mc_create_menu("LIST_XT", "List");
	mc_add_menu_item("LIST_XT", "%name%");

	new text[1024];
	expect_int("меню открылось", mc_show_menu(bot, "XT_MENU"), 1);
	mc_get_menu_text(bot, text, charsmax(text));
	expect_contains("плейсхолдер Pawn-плагина", text, "Pawn: от Pawn");
	expect_contains("плейсхолдер TS-плагина", text, "TS: от TS");

	new mine[64], theirs[64];
	LookupLangKey(mine, charsmax(mine), "MORE", bot);
	new serverLang = LANG_SERVER;
	LookupLangKey(theirs, charsmax(theirs), "MORE", serverLang);
	expect_int("язык бота не совпадает с языком сервера", equal(mine, theirs), 0);
	expect_int("заголовок - ключ на языке бота", contain(text, mine) == 0, 1);
	LookupLangKey(mine, charsmax(mine), "EXIT", bot);
	expect_contains("пункт - ключ на языке бота", text, mine);

	expect_int("список открылся", mc_show_menu(bot, "LIST_XT"), 1);
	mc_get_menu_text(bot, text, charsmax(text));
	expect_contains("строка источника списка", text, "Строка источника");

	mc_hide_menu(bot);
	return finish();
}

public Placeholder_Pawn(id, target, value[], len)
{
	formatex(value, len, "от Pawn");
}

public Source_Rows(id, Array:items)
{
	new row[289];
	row[0] = id;
	copy(row[65], 63, "Строка источника");
	ArrayPushArray(items, row);
	return 1;
}

finish()
{
	server_print("[menu-core] %d ok, %d failed", g_ok, g_failed);
	return PLUGIN_HANDLED;
}

expect_int(const what[], got, expected)
{
	if (got == expected) {
		g_ok++;
		server_print("[menu-core] ok %s", what);
		return;
	}
	g_failed++;
	server_print("[menu-core] FAIL %s: got %d, expected %d", what, got, expected);
}

expect_contains(const what[], const text[], const part[])
{
	if (contain(text, part) != -1) {
		g_ok++;
		server_print("[menu-core] ok %s", what);
		return;
	}
	g_failed++;
	server_print("[menu-core] FAIL %s: no ^"%s^" in ^"%s^"", what, part, text);
}
