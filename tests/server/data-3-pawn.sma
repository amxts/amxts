// Поля Player на сервере, шаг 3: Pawn-плагин читает и пишет те же поля через
// нативы модуля (amxts.inc).
// Запускается командой amxts_test_data_pawn; строки лога - как у Checks.
#include <amxmodx>
#include <amxts>

new g_ok, g_failed;

public plugin_init()
{
	register_plugin("amxts test: Player fields", "1.0", "amxts");
	register_srvcmd("amxts_test_data_pawn", "run");
}

public run()
{
	g_ok = 0;
	g_failed = 0;
	server_print("[data-pawn] --- run");

	new players[32], count;
	get_players(players, count, "d");
	expect_int("на сервере есть бот", count > 0, 1);
	if (count == 0) return finish();
	new bot = players[0];

	// Поставлено TS-плагином data-1-write.
	expect_int("ghost из TS", amxts_get_player_data(bot, "ghost"), 1);
	expect_int("поле, которого никто не писал", amxts_get_player_data(bot, "no_such_field"), 0);

	// Член поля-объекта - ключ с точкой; поставлен TS-плагином data-1-write.
	new enabled[16];
	amxts_get_player_data_string(bot, "glow.enabled", enabled, charsmax(enabled));
	expect_str("glow.enabled из TS", enabled, "true");
	new seenBy[16], own[8];
	amxts_get_player_data_string(bot, "glow.seenBy", seenBy, charsmax(seenBy));
	num_to_str(bot, own, charsmax(own));
	expect_str("seenBy - номера игроков", seenBy, own);

	// Pawn пишет член поля-объекта - и читает то, что написал.
	amxts_set_player_data_string(bot, "glow.enabled", "false");
	amxts_get_player_data_string(bot, "glow.enabled", enabled, charsmax(enabled));
	expect_str("glow.enabled = false из Pawn", enabled, "false");
	amxts_set_player_data_string(bot, "glow.enabled", "default");
	amxts_get_player_data_string(bot, "glow.enabled", enabled, charsmax(enabled));
	expect_str("glow.enabled = default из Pawn", enabled, "default");

	// Дробное и строка; строку читает data-4-reset.
	amxts_set_player_data_float(bot, "testSpeed", 1.5);
	expect_int("дробное туда и обратно", floatround(amxts_get_player_data_float(bot, "testSpeed") * 10.0), 15);
	expect_int("дробное целым", amxts_get_player_data(bot, "testSpeed"), 1);

	amxts_set_player_data_string(bot, "testTag", "Привет");
	new text[64];
	amxts_get_player_data_string(bot, "testTag", text, charsmax(text));
	expect_str("строка туда и обратно", text, "Привет");
	amxts_get_player_data_string(bot, "testTag", text, 3);
	expect_str("обрезана по границе буквы", text, "П");

	return finish();
}

finish()
{
	server_print("[data-pawn] %d ok, %d failed", g_ok, g_failed);
	return PLUGIN_HANDLED;
}

expect_int(const what[], got, expected)
{
	if (got == expected) {
		g_ok++;
		server_print("[data-pawn] ok %s", what);
		return;
	}
	g_failed++;
	server_print("[data-pawn] FAIL %s: got %d, expected %d", what, got, expected);
}

expect_str(const what[], const got[], const expected[])
{
	if (equal(got, expected)) {
		g_ok++;
		server_print("[data-pawn] ok %s", what);
		return;
	}
	g_failed++;
	server_print("[data-pawn] FAIL %s: got ^"%s^", expected ^"%s^"", what, got, expected);
}
