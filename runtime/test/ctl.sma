#include <amxmodx>

public plugin_init()
{
	register_plugin("ts2 control", "1.0", "x");
	log_amx("[ctl] plugin_init: scheduling task");
	set_task(1.0, "ctl_tick", 0);
}

public ctl_tick()
{
	log_amx("[ctl] task fired");
}
