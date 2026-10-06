// The Pawn side of the quick-menu suite: a menu of AMX Mod X's own and an
// old-style one, shown to a player by a server command, each writing what it
// got into amxts_test_quick_menu_pawn. The old-style handler answers
// PLUGIN_CONTINUE, so AMX Mod X passes the key on as it does after any
// handler that does not take it.
#include <amxmodx>

new g_answer;

public plugin_init()
{
	register_plugin("amxts test: quick-menu", "1.0", "amxts");
	g_answer = create_cvar("amxts_test_quick_menu_pawn", "");
	register_srvcmd("amxts_quick_menu_pawn_new", "show_new");
	register_srvcmd("amxts_quick_menu_pawn_old", "show_old");
	register_menucmd(register_menuid("Pawn old"), MENU_KEY_1 | MENU_KEY_2, "on_old");
}

public show_new()
{
	new menu = menu_create("Pawn new", "on_new");
	menu_additem(menu, "one");
	menu_additem(menu, "two");
	menu_display(read_argv_int(1), menu);
	return PLUGIN_HANDLED;
}

public on_new(id, menu, item)
{
	set_pcvar_string(g_answer, fmt("new %d", item));
	menu_destroy(menu);
	return PLUGIN_HANDLED;
}

public show_old()
{
	show_menu(read_argv_int(1), MENU_KEY_1 | MENU_KEY_2, "Pawn old^n1. one^n2. two", -1, "Pawn old");
	return PLUGIN_HANDLED;
}

public on_old(id, key)
{
	set_pcvar_string(g_answer, fmt("old %d", key));
	return PLUGIN_CONTINUE;
}
