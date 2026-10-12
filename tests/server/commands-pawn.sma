// The Pawn side of the commands suite: a player's command sent with
// amxclient_cmd, as a Pawn plugin sends one for him, and a command of its
// own that it takes before the amxts plugins hear it.
#include <amxmodx>

public plugin_init()
{
	register_plugin("amxts test: commands", "1.0", "amxts");
	register_srvcmd("amxts_commands_pawn", "send");
	register_clcmd("amxts_commands_taken", "take");
}

// amxts_commands_pawn <id> <command> [arg]
public send()
{
	new command[64], arg[128];
	read_argv(2, command, charsmax(command));
	read_argv(3, arg, charsmax(arg));
	amxclient_cmd(read_argv_int(1), command, arg);
	return PLUGIN_HANDLED;
}

public take(id)
{
	return PLUGIN_HANDLED;
}
