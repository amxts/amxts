// A Pawn plugin for world-api.ts: a public it calls through server.plugins,
// and a vault of AMX Mod X's nvault, which a Storage of that name takes the
// first time it is opened.
#include <amxmodx>
#include <nvault>

public plugin_init()
{
	register_plugin("amxts test: world", "1.0", "amxts");

	new vault = nvault_open("amxts_world_import");
	nvault_set(vault, "key", "from pawn");
	nvault_close(vault);
}

public world_sum(a, b)
{
	return a + b;
}
