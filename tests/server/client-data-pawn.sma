// The Pawn side of the client-data suite: every weapon animation the game
// sends a player (SVC_WEAPONANIM), with the body it is drawn with, told to
// client-data.ts (client_data_pawn, which it exports). Without
// client-data.ts it loads and tells nobody.
#include <amxmodx>

#define SVC_WEAPONANIM 35

native client_data_pawn(player, anim, body);

public plugin_natives()
{
	set_native_filter("client_data_natives");
}

public client_data_natives(const name[], index, trap)
{
	return PLUGIN_HANDLED;
}

public plugin_init()
{
	register_plugin("amxts test: client data", "1.0", "amxts");
	register_message(SVC_WEAPONANIM, "on_weapon_anim");
}

public on_weapon_anim(msg_id, msg_dest, player)
{
	client_data_pawn(player, get_msg_arg_int(1), get_msg_arg_int(2));
	return PLUGIN_CONTINUE;
}
