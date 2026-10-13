// HUD messages sent by the module: player.showHud, server.showHud and
// HudLine, as AMX Mod X's set_hudmessage, show_hudmessage, ShowSyncHudMsg,
// ClearSyncHud and show_dhudmessage send them - one call from a plugin, no
// native's arguments formatted on the way.
//
// Each player has four channels. A line (HudLine) keeps the channel it last
// had while nothing else took it since; any other message takes a channel
// whose message has ended, or else the one of the least important line that
// ends first - a line of a higher priority is not taken, and a message that
// finds all four held by such lines is not sent. The book is the module's,
// kept for every amxts plugin; a Pawn plugin's messages are in AMX Mod X's.
//
// Included by module.cpp, after the client helpers.

// What hud_show reads at `params`, twelve doubles: where, how and how long.
#define HUD_X          0
#define HUD_Y          1
#define HUD_EFFECT     2
#define HUD_RED        3
#define HUD_GREEN      4
#define HUD_BLUE       5
#define HUD_FX_TIME    6
#define HUD_HOLD       7
#define HUD_FADE_IN    8
#define HUD_FADE_OUT   9
#define HUD_CHANNEL    10
#define HUD_LARGE      11
#define HUD_PARAMS     12

#define TE_TEXTMESSAGE  29
#define DRC_CMD_MESSAGE 6

/** A player's channels: when the message on each ends, the line on it (0 none) and that line's priority. */
struct HudPlayer {
	float ends[5] = {};
	int lines[5] = {};
	int priority[5] = {};
};

static HudPlayer g_hud[CLIENT_SLOTS];
// g_hudLines (module.cpp, which lets them go at the map's end): each line's
// last channel by player, a line's id its place plus one. g_hudPriority: each
// line's priority, by the same place; grown with the lines, read only below
// their count.
static std::vector<int> g_hudPriority;

/** hud_line() - a new line of priority 0: its id. */
static int32_t w_hudLine(wasm_exec_env_t env)
{
	(void)env;
	g_hudLines.emplace_back(CLIENT_SLOTS, 0);
	g_hudPriority.resize(g_hudLines.size());
	g_hudPriority.back() = 0;
	return (int32_t)g_hudLines.size();
}

/** hud_line2(priority) - a new line that gives way to lines of a higher priority: its id. */
static int32_t w_hudLine2(wasm_exec_env_t env, int32_t priority)
{
	int32_t line = w_hudLine(env);
	g_hudPriority.back() = priority;
	return line;
}

/** Whether channel `a` is taken before `b`: an ended message first, then the least important line, then the one that ends first. */
static bool HudBefore(const HudPlayer &player, int a, int b, float now)
{
	bool endedA = player.ends[a] <= now, endedB = player.ends[b] <= now;
	if (endedA != endedB)
		return endedA;
	if (!endedA && player.priority[a] != player.priority[b])
		return player.priority[a] < player.priority[b];
	return player.ends[a] < player.ends[b];
}

/**
 * The channel a message to the player goes on, held until `ends`: the one
 * asked for, a line's own while it holds it, or the first of HudBefore; -1
 * when every channel holds a line more important than this message.
 */
static int HudChannel(int id, int line, int fixed, float ends)
{
	HudPlayer &player = g_hud[id];
	bool lined = line > 0 && (size_t)line <= g_hudLines.size();
	int priority = lined ? g_hudPriority[line - 1] : 0;
	int channel = 0;
	if (fixed >= 0) {
		channel = abs(fixed % 5);
		lined = false;
		priority = 0;
	}
	else if (lined && g_hudLines[line - 1][id] && player.lines[g_hudLines[line - 1][id]] == line) {
		channel = g_hudLines[line - 1][id];
	}
	else {
		channel = 1;
		for (int i = 2; i <= 4; i++)
			if (HudBefore(player, i, channel, gpGlobals->time))
				channel = i;
		if (player.ends[channel] > gpGlobals->time && player.priority[channel] > priority)
			return -1;
	}
	if (lined)
		g_hudLines[line - 1][id] = (uint8_t)channel;
	player.lines[channel] = lined ? line : 0;
	player.priority[channel] = priority;
	player.ends[channel] = ends;
	return channel;
}

/**
 * When a message ends on the client: faded in, held and faded out; the
 * typewriter brings its letters in one at a time, then holds the effect's
 * time.
 */
static float HudEnds(const double *p, size_t letters)
{
	double in = Whole(p[HUD_EFFECT]) == 2 ? p[HUD_FADE_IN] * (double)letters + p[HUD_FX_TIME] : p[HUD_FADE_IN];
	return gpGlobals->time + (float)(in + p[HUD_HOLD] + p[HUD_FADE_OUT]);
}

/** A number of `scale` parts to one, as the engine reads a HUD message's (FixedUnsigned16 / FixedSigned16). */
static int HudFixed(double value, int scale, bool sign)
{
	int output = Whole(value * scale);
	if (sign)
		return output > 32767 ? 32767 : output < -32768 ? -32768 : output;
	return output > 65535 ? 65535 : output < 0 ? 0 : output;
}

/** The text cut into the lines the client draws: a break at the last space before 69 letters, as UTIL_SplitHudMessage does. */
static std::string HudLines(const std::string &text)
{
	std::string out;
	out.reserve(text.size() + 8);
	int column = 0;
	int space = -1;
	for (size_t i = 0; i < text.size() && out.size() < 480; i++) {
		char c = text[i];
		if (c == ' ')
			space = (int)out.size();
		else if (c == '\n') {
			space = -1;
			column = 0;
		}
		out += c;
		if (++column == 69) {
			if (space == -1) {
				out += '\n';
				column = 0;
			}
			else {
				out[space] = '\n';
				column = (int)out.size() - space - 1;
				space = -1;
			}
		}
	}
	return out;
}

static void HudSend(int id, const double *p, int channel, const char *text)
{
	MESSAGE_BEGIN(MSG_ONE_UNRELIABLE, SVC_TEMPENTITY, NULL, INDEXENT(id));
	WRITE_BYTE(TE_TEXTMESSAGE);
	WRITE_BYTE(channel & 0xFF);
	WRITE_SHORT(HudFixed(p[HUD_X], 1 << 13, true));
	WRITE_SHORT(HudFixed(p[HUD_Y], 1 << 13, true));
	int effect = Whole(p[HUD_EFFECT]);
	WRITE_BYTE(effect);
	WRITE_BYTE(Whole(p[HUD_RED]));
	WRITE_BYTE(Whole(p[HUD_GREEN]));
	WRITE_BYTE(Whole(p[HUD_BLUE]));
	WRITE_BYTE(0);
	// The second colour, the typewriter's: set_hudmessage's own.
	WRITE_BYTE(255);
	WRITE_BYTE(255);
	WRITE_BYTE(250);
	WRITE_BYTE(0);
	WRITE_SHORT(HudFixed(p[HUD_FADE_IN], 1 << 8, false));
	WRITE_SHORT(HudFixed(p[HUD_FADE_OUT], 1 << 8, false));
	WRITE_SHORT(HudFixed(p[HUD_HOLD], 1 << 8, false));
	if (effect == 2)
		WRITE_SHORT(HudFixed(p[HUD_FX_TIME], 1 << 8, false));
	WRITE_STRING(text);
	MESSAGE_END();
}

/** A large message - the director's, as show_dhudmessage sends it: no channel, up to 128 letters. */
static void HudSendLarge(int id, const double *p, const std::string &text)
{
	auto bits = [](double value) { float f = (float)value; int32_t i; memcpy(&i, &f, 4); return i; };
	MESSAGE_BEGIN(MSG_ONE_UNRELIABLE, SVC_DIRECTOR, NULL, INDEXENT(id));
	WRITE_BYTE((int)text.size() + 31);
	WRITE_BYTE(DRC_CMD_MESSAGE);
	WRITE_BYTE(Whole(p[HUD_EFFECT]));
	WRITE_LONG(Whole(p[HUD_BLUE]) + (Whole(p[HUD_GREEN]) << 8) + (Whole(p[HUD_RED]) << 16));
	WRITE_LONG(bits(p[HUD_X]));
	WRITE_LONG(bits(p[HUD_Y]));
	WRITE_LONG(bits(p[HUD_FADE_IN]));
	WRITE_LONG(bits(p[HUD_FADE_OUT]));
	WRITE_LONG(bits(p[HUD_HOLD]));
	WRITE_LONG(bits(p[HUD_FX_TIME]));
	WRITE_STRING(text.c_str());
	MESSAGE_END();
}

/** The players a HUD message goes to: one, or (0) everyone in the game; never a bot, whose game draws nothing. */
static bool HudReaches(int id)
{
	return InGame(id) && !MF_IsPlayerBot(id);
}

/**
 * hud_show(id, line, params, text) - a HUD message to a player, or to every
 * player (0), on a line's channel (0: an automatic one); the twelve doubles
 * at `params` say how.
 */
static void w_hudShow(wasm_exec_env_t env, int32_t id, int32_t line, int32_t params, int32_t text)
{
	wasm_module_inst_t inst = Inst(env);
	if (!wasm_runtime_validate_app_addr(inst, (uint64_t)params, HUD_PARAMS * sizeof(double)))
		return;
	const double *p = (const double *)wasm_runtime_addr_app_to_native(inst, (uint64_t)params);
	bool large = p[HUD_LARGE] != 0;
	int fixed = Whole(p[HUD_CHANNEL]);
	// The text is read and cut once, for the first player it reaches: a
	// message to bots alone costs nothing more.
	std::string message;
	bool made = false;
	int first = id > 0 ? id : 1, last = id > 0 ? id : gpGlobals->maxClients;
	for (int to = first; to <= last && to < CLIENT_SLOTS; to++) {
		if (!HudReaches(to))
			continue;
		if (!made) {
			message = large ? AsString(inst, text) : HudLines(AsString(inst, text));
			made = true;
		}
		if (large) {
			HudSendLarge(to, p, message);
			continue;
		}
		int channel = HudChannel(to, line, fixed, HudEnds(p, message.size()));
		if (channel >= 0)
			HudSend(to, p, channel, message.c_str());
	}
}

/** hud_clear(id, line) - takes a line's message off a player's screen, or every player's (0), where it still holds its channel. */
static void w_hudClear(wasm_exec_env_t env, int32_t id, int32_t line)
{
	(void)env;
	if (line <= 0 || (size_t)line > g_hudLines.size())
		return;
	static const double none[HUD_PARAMS] = {};
	int first = id > 0 ? id : 1, last = id > 0 ? id : gpGlobals->maxClients;
	for (int to = first; to <= last && to < CLIENT_SLOTS; to++) {
		uint8_t channel = g_hudLines[line - 1][to];
		if (!channel || g_hud[to].lines[channel] != line || !HudReaches(to))
			continue;
		HudSend(to, none, channel, "");
		g_hud[to].ends[channel] = 0;
	}
}

/** A player's slot taken anew: his channels start over, as AMX Mod X's do at connect. */
static void HudSlotReset(int id)
{
	g_hud[id] = HudPlayer();
	for (auto &line : g_hudLines)
		line[id] = 0;
}
