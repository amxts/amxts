// The server's own: the game's folder, the versions it runs, the map to go
// to and the light of the map - server.game, server.versions,
// server.changeLevel, server.mapExists, server.lightStyle - and what a
// player sees through, player.view.
//
// Included by module.cpp, after the client helpers and the hookchains.

// What server_text writes: the game's folder, amxts's version, ReHLDS's API
// version and ReGameDLL's ("" without them).
#define SERVER_GAME     1
#define SERVER_AMXTS    2
#define SERVER_REHLDS   3
#define SERVER_REGAMEDLL 4

/** server_text(what, out, max) - one of the server's texts as UTF-8; its length. */
static int32_t w_serverText(wasm_exec_env_t env, int32_t what, int32_t out, int32_t max)
{
	char text[256] = "";
	if (what == SERVER_GAME) {
		GET_GAME_DIR(text);
	}
	else if (what == SERVER_AMXTS) {
		// The build is the version and the commit: 0.3.0+1bf291c0ab.
		snprintf(text, sizeof(text), "%s", AMXTS_BUILD);
		char *commit = strchr(text, '+');
		if (commit)
			*commit = '\0';
	}
	else if (what == SERVER_REHLDS && g_rehlds) {
		snprintf(text, sizeof(text), "%d.%d", g_rehlds->GetMajorVersion(), g_rehlds->GetMinorVersion());
	}
	else if (what == SERVER_REGAMEDLL && g_regame) {
		snprintf(text, sizeof(text), "%d.%d", g_regame->GetMajorVersion(), g_regame->GetMinorVersion());
	}
	return WriteBytes(Inst(env), out, max, text);
}

/** map_valid(name) - 1 when the server has the map. */
static int32_t w_mapValid(wasm_exec_env_t env, int32_t name)
{
	std::string map = AsString(Inst(env), name);
	return !map.empty() && IS_MAP_VALID((char *)map.c_str()) ? 1 : 0;
}

/** change_level(name) - goes to the map; 0 for a map the server does not have. */
static int32_t w_changeLevel(wasm_exec_env_t env, int32_t name)
{
	std::string map = AsString(Inst(env), name);
	if (map.empty() || !IS_MAP_VALID((char *)map.c_str()))
		return 0;
	CHANGE_LEVEL((char *)map.c_str(), NULL);
	return 1;
}

// The engine keeps the light style's text by its address, so it lives here
// until the map's own worldspawn sets it again.
static std::string g_lightStyle;

/** light_style(text) - the map's light, "a" darkest to "z" brightest, "m" the game's own. */
static void w_lightStyle(wasm_exec_env_t env, int32_t text)
{
	g_lightStyle = AsString(Inst(env), text);
	if (g_lightStyle.empty())
		g_lightStyle = "m";
	LIGHT_STYLE(0, (char *)g_lightStyle.c_str());
}

/**
 * player_light_style(id, text) - the light one player sees, "" for the
 * server's: the engine's lightstyle message to him alone. The server's next
 * light reaches him too, and the map's start sets it again.
 */
#define SVC_LIGHTSTYLE 12 // the engine's, which the SDK's util.h leaves out

static void w_playerLightStyle(wasm_exec_env_t env, int32_t id, int32_t text)
{
	if (!InGame(id) || (INDEXENT(id)->v.flags & FL_FAKECLIENT))
		return;
	std::string style = AsString(Inst(env), text);
	if (style.empty())
		style = g_lightStyle.empty() ? "m" : g_lightStyle;
	MESSAGE_BEGIN(MSG_ONE, SVC_LIGHTSTYLE, NULL, INDEXENT(id));
	WRITE_BYTE(0);
	WRITE_STRING(style.c_str());
	MESSAGE_END();
}

// The entity each player sees through (player.view), with his user id, so
// that a player who takes the slot later sees through his own eyes.
static struct { int32_t target; int userId; } g_views[CLIENT_SLOTS];

/** player_view(id, target) - he sees through that entity; 0 or his own id, through his own eyes. */
static void w_playerView(wasm_exec_env_t env, int32_t id, int32_t target)
{
	(void)env;
	if (!InGame(id))
		return;
	edict_t *player = INDEXENT(id);
	edict_t *seen = target > 0 && target < gpGlobals->maxEntities ? INDEXENT(target) : NULL;
	if (!seen || seen->free)
		seen = player;
	SET_VIEW(player, seen);
	g_views[id].target = seen == player ? 0 : target;
	g_views[id].userId = GETPLAYERUSERID(player);
}

/** player_view_get(id) - the entity he sees through, 0 for his own eyes. */
static int32_t w_playerViewGet(wasm_exec_env_t env, int32_t id)
{
	(void)env;
	if (!InGame(id) || g_views[id].userId != GETPLAYERUSERID(INDEXENT(id)))
		return 0;
	int32_t target = g_views[id].target;
	return target > 0 && !INDEXENT(target)->free ? target : 0;
}
