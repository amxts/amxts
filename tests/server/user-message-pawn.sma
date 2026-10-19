// The Pawn side of the user-message suite: a hook of AmxtsJump, the message
// an amxts plugin registers, which hands what it hears back to that plugin
// as a server command - its count of arguments, then each.
#include <amxmodx>

public plugin_init()
{
	register_plugin("amxts test: user message", "1.0", "amxts");
	register_srvcmd("amxts_user_message_hook", "hook");
}

// Registered when the amxts plugin asks: its message is registered at its plugin_init.
public hook()
{
	register_message(get_user_msgid("AmxtsJump"), "heard");
	return PLUGIN_HANDLED;
}

public heard(msgid, dest, receiver)
{
	new line[256], text[200];
	new count = get_msg_args();
	formatex(line, charsmax(line), "%d", count);
	for (new i = 1; i <= count; i++) {
		switch (get_msg_argtype(i)) {
			case ARG_STRING: {
				get_msg_arg_string(i, text, charsmax(text));
				format(line, charsmax(line), "%s %s", line, text);
			}
			case ARG_ANGLE: format(line, charsmax(line), "%s %d", line, floatround(get_msg_arg_float(i)));
			case ARG_COORD: format(line, charsmax(line), "%s %.1f", line, get_msg_arg_float(i));
			default: format(line, charsmax(line), "%s %d", line, get_msg_arg_int(i));
		}
	}
	server_cmd("amxts_user_message_heard ^"%s^"", line);
	return PLUGIN_CONTINUE;
}
