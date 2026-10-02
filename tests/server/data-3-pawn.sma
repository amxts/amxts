// Player fields on the server, step 3: a Pawn plugin reads and writes the same
// fields through the module's natives (amxts.inc).
// Run by the amxts_test_data_pawn command; log lines are as Checks writes them.
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
	expect_int("the server has a bot", count > 0, 1);
	if (count == 0) return finish();
	new bot = players[0];

	// Set by the TS plugin data-1-write.
	expect_int("ghost from TS", amxts_get_player_data(bot, "ghost"), 1);
	expect_int("a field nobody wrote", amxts_get_player_data(bot, "no_such_field"), 0);

	// A member of an object field is a key with a dot; set by the TS plugin data-1-write.
	new enabled[16];
	amxts_get_player_data_string(bot, "glow.enabled", enabled, charsmax(enabled));
	expect_str("glow.enabled from TS", enabled, "true");
	new seenBy[16], own[8];
	amxts_get_player_data_string(bot, "glow.seenBy", seenBy, charsmax(seenBy));
	num_to_str(bot, own, charsmax(own));
	expect_str("seenBy is the players' ids", seenBy, own);

	// Pawn writes a member of an object field - and reads what it wrote.
	amxts_set_player_data_string(bot, "glow.enabled", "false");
	amxts_get_player_data_string(bot, "glow.enabled", enabled, charsmax(enabled));
	expect_str("glow.enabled = false from Pawn", enabled, "false");
	amxts_set_player_data_string(bot, "glow.enabled", "default");
	amxts_get_player_data_string(bot, "glow.enabled", enabled, charsmax(enabled));
	expect_str("glow.enabled = default from Pawn", enabled, "default");

	// A float and a string; data-4-reset reads the string.
	amxts_set_player_data_float(bot, "testSpeed", 1.5);
	expect_int("a float there and back", floatround(amxts_get_player_data_float(bot, "testSpeed") * 10.0), 15);
	expect_int("a float as an integer", amxts_get_player_data(bot, "testSpeed"), 1);

	// Cyrillic on purpose: a string field is UTF-8, cut at a letter's boundary.
	amxts_set_player_data_string(bot, "testTag", "Привет");
	new text[64];
	amxts_get_player_data_string(bot, "testTag", text, charsmax(text));
	expect_str("a string there and back", text, "Привет");
	amxts_get_player_data_string(bot, "testTag", text, 3);
	expect_str("cut at a letter's boundary", text, "П");

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
