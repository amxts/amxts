// The Pawn side of the chains suite: a handler of the chain chains.ts
// listens to, before the game and after it, telling chains.ts it ran
// (chains_pawn, which chains.ts exports). Without ReAPI - plain HLDS, or a
// server without it - and without chains.ts, it loads and hooks nothing.
#include <amxmodx>
#include <reapi>

native chains_pawn(post);

public plugin_natives()
{
	set_module_filter("chains_modules");
	set_native_filter("chains_natives");
}

public chains_modules(const module[], LibType:type)
{
	return PLUGIN_HANDLED;
}

public chains_natives(const name[], index, trap)
{
	return PLUGIN_HANDLED;
}

public plugin_init()
{
	register_plugin("amxts test: chains", "1.0", "amxts");
	if (!LibraryExists("reapi", LibType_Library)) return;
	RegisterHookChain(RG_CBasePlayer_TakeDamage, "on_damage", false);
	RegisterHookChain(RG_CBasePlayer_TakeDamage, "on_damage_post", true);
}

public on_damage()
{
	chains_pawn(0);
	return HC_CONTINUE;
}

public on_damage_post()
{
	chains_pawn(1);
	return HC_CONTINUE;
}
