// The Pawn side of the map-change suite's natives: it names xt_late, which
// only late-target.ts exports, and amxts_late_call puts what the native
// answers into amxts_test_late. On the first map no plugin has exported the
// name yet, and the native filter lets this plugin load all the same.
#include <amxmodx>

native xt_late();

public plugin_natives()
{
	set_native_filter("late_natives");
}

public late_natives(const name[], index, trap)
{
	return PLUGIN_HANDLED;
}

public plugin_init()
{
	register_plugin("amxts test: late", "1.0", "amxts");
	register_srvcmd("amxts_late_call", "call");
	create_cvar("amxts_test_late", "-1");
}

public call()
{
	set_cvar_num("amxts_test_late", xt_late());
	return PLUGIN_HANDLED;
}
