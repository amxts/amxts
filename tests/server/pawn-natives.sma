// Natives a Pawn plugin registers, for call.ts to call: geoip's, which its
// module leaves unregistered without the GeoIP2 databases, and resemiclip's,
// on a server without that module - one of them is free on every test
// server. The module calls such a native with a loaded Pawn plugin, not with
// its natives' image.
#include <amxmodx>

public plugin_init()
{
	register_plugin("amxts test: Pawn natives", "1.0", "amxts");
}

public plugin_natives()
{
	register_native("geoip_timezone", "timezone");
	register_native("resemiclip_get_user_mask", "mask");
}

// geoip_timezone(const ip[], result[], len)
public timezone(plugin, params)
{
	new ip[32], text[64];
	get_string(1, ip, charsmax(ip));
	formatex(text, charsmax(text), "zone of %s", ip);
	return set_string(2, text, get_param(3));
}

// resemiclip_get_user_mask(id)
public mask(plugin, params)
{
	return get_param(1) + 47;
}
