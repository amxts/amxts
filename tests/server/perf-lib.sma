// A native another Pawn plugin registers, for perf-pawn.sma to time against
// the one perf.ts exports: Pawn calling a Pawn plugin's native.
#include <amxmodx>

public plugin_init()
{
	register_plugin("amxts test: perf lib", "1.0", "amxts");
}

public plugin_natives()
{
	register_native("perf_lib_echo", "echo");
}

public echo(plugin, params)
{
	return get_param(1);
}
