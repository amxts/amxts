// The engine's and the game DLL's functions that AMX Mod X and its modules
// hook to raise their forwards, hooked by the module itself through Metamod:
// the messages the game sends (register_message, register_event), the log
// (register_logevent), a cvar's change (hook_cvar_change), a touch (the
// engine module's register_touch), a client's answer about a cvar
// (query_client_cvar), and the functions fakemeta's register_forward hooks
// that the plain-HLDS backends hear (as/hlds.ts). Each is a point of
// gamehooks.h - a plugin's handlers walked in place, switched on and off by
// it, gone with it - and a listener reads the call as a hookchain's (arg,
// arg_text) and answers it the same way (handled(), chain_set).
//
// Every hook here is in Metamod's table and costs a check when no handler is
// on: Metamod-R compiles its calls when the plugins load, and calls a
// function put into the table later only when another plugin hooks it too.
// AMX Mod X hooks the messages' functions, so those go in and out with their
// handlers (MessageHooks), and a message nobody listens to costs nothing.
//
// Included by module.cpp, after gamehooks.h.

// Metamod's copies of the module's tables (amxxmodule.cpp). A hook whose
// type the SDK's declaration of it gets wrong, or which it has no place for
// (AlertMessage, CvarValue2), is put there by hand; AMX Mod X hooks both
// functions itself, so Metamod-R calls whatever the table holds.
extern enginefuncs_t *g_pengfuncsTable;
extern NEW_DLL_FUNCTIONS *g_pNewFunctionsTable;

/** Puts a point into g_otherPoints when a plugin first adds a handler to it, and adds the handler. */
static int32_t AddOtherHook(HookPoint &point, int32_t fn, int32_t post)
{
	if (!point.listed) {
		point.listed = true;
		g_otherPoints.push_back(&point);
	}
	return AddHook(point, fn, post);
}

/** A counter of the points of one kind in the game's way, for a point's attach. */
#define POINTS_COUNTER(name) \
	static int name = 0; \
	static void name##Attach(bool on) { name += on ? 1 : -1; }

// ---------------------------------------------------------------- messages

// A message's argument types, as AMX Mod X numbers them (ARG_* in its includes).
enum MessageArgType { MESSAGE_BYTE = 1, MESSAGE_CHAR, MESSAGE_SHORT, MESSAGE_LONG, MESSAGE_ANGLE, MESSAGE_COORD, MESSAGE_STRING, MESSAGE_ENTITY };

#define MESSAGE_TYPES 256

struct MessageArg {
	int         type;
	int         number;
	float       real;
	std::string text;
};

/**
 * A message the game writes, held from its MessageBegin to its MessageEnd:
 * the game's own call superceded, the listeners heard, then the message sent
 * again through the engine's own functions, with what they wrote - or not at
 * all, when one blocked it.
 *
 * One a Pawn plugin holds too (register_message, set_msg_block: AMX Mod X,
 * ahead in Metamod's list, supercedes it and sends its own copy at its
 * MessageEnd, before the module's) is heard as the game wrote it, and only
 * heard: what a TypeScript listener writes or blocks of it is not sent.
 */
struct HeldMessage {
	int                     dest = 0;
	int                     type = 0;
	bool                    hasOrigin = false;
	float                   origin[3] = { 0, 0, 0 };
	edict_t                *ed = NULL;
	std::vector<MessageArg> args;
	// The module sends it: no Pawn plugin holds it.
	bool                    sent = true;
	bool                    changed = false;
	// The players a listener chose (recipients), by id: a copy goes to each
	// of them the message would reach, and to nobody else.
	bool                    chosen = false;
	bool                    to[CLIENT_SLOTS] = {};
};

static int g_messagesHooked = 0;
static void MessagesAttach(bool on);
static void TempEntitiesAttach(bool on);
static void MessageHooks(bool on);

static HookPoint   g_messagePoints[MESSAGE_TYPES];
static HeldMessage g_held;
static bool        g_holding = false;
// A message begun while one is held, passed by as it is.
static int         g_passing = 0;
// The module sending a held message again, which its hooks pass by.
static bool        g_sending = false;
// The message the listeners are hearing.
static HeldMessage *g_message = NULL;

/** msg_hook(id, handler) - a handler of the game's message `id`; 0 for no such message. */
static int32_t w_msg_hook(wasm_exec_env_t env, int32_t id, int32_t fn)
{
	(void)env;
	if (id <= 0 || id >= MESSAGE_TYPES) {
		TakeTag();
		return 0;
	}
	g_messagePoints[id].attach = id == SVC_TEMPENTITY ? TempEntitiesAttach : MessagesAttach;
	return AddOtherHook(g_messagePoints[id], fn, 0);
}

static MessageArg *HeardArg(int32_t index)
{
	return g_message && index >= 0 && index < (int32_t)g_message->args.size() ? &g_message->args[index] : NULL;
}

/** msg_argc() - the arguments of the message heard. */
static int32_t w_msg_argc(wasm_exec_env_t env)
{
	(void)env;
	return g_message ? (int32_t)g_message->args.size() : 0;
}

/** msg_arg_type(index) - an argument's type, ARG_*; 0 past the last. */
static int32_t w_msg_arg_type(wasm_exec_env_t env, int32_t index)
{
	(void)env;
	MessageArg *arg = HeardArg(index);
	return arg ? arg->type : 0;
}

/** msg_number(index) - a number argument: an angle or a coordinate as a fraction. */
static double w_msg_number(wasm_exec_env_t env, int32_t index)
{
	(void)env;
	MessageArg *arg = HeardArg(index);
	if (!arg)
		return 0;
	return arg->type == MESSAGE_ANGLE || arg->type == MESSAGE_COORD ? (double)arg->real : (double)arg->number;
}

/** msg_text(index, out, max) - a text argument, as UTF-8 bytes. */
static int32_t w_msg_text(wasm_exec_env_t env, int32_t index, int32_t out, int32_t max)
{
	MessageArg *arg = HeardArg(index);
	return WriteBytes(Inst(env), out, max, arg && arg->type == MESSAGE_STRING ? arg->text.c_str() : "");
}

/** msg_set_number(index, value) - a number argument written: the message goes with it. */
static void w_msg_set_number(wasm_exec_env_t env, int32_t index, double value)
{
	(void)env;
	MessageArg *arg = HeardArg(index);
	if (!arg || arg->type == MESSAGE_STRING)
		return;
	if (arg->type == MESSAGE_ANGLE || arg->type == MESSAGE_COORD)
		arg->real = (float)value;
	else
		arg->number = Whole(value);
	g_message->changed = true;
}

/** msg_to(ids, count) - the players the message heard goes to (event.recipients), of those it would reach. */
static void w_msg_to(wasm_exec_env_t env, int32_t ids, int32_t count)
{
	wasm_module_inst_t inst = Inst(env);
	if (!g_message || count < 0 || (count > 0 && !wasm_runtime_validate_app_addr(inst, (uint64_t)ids, (uint64_t)count * 4)))
		return;
	const int32_t *id = count > 0 ? (const int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ids) : NULL;
	memset(g_message->to, 0, sizeof(g_message->to));
	for (int32_t i = 0; i < count; i++)
		if (id[i] > 0 && id[i] < CLIENT_SLOTS)
			g_message->to[id[i]] = true;
	g_message->chosen = true;
	g_message->changed = true;
}

/** msg_set_text(index, text) - a text argument written. */
static void w_msg_set_text(wasm_exec_env_t env, int32_t index, int32_t text)
{
	MessageArg *arg = HeardArg(index);
	if (!arg || arg->type != MESSAGE_STRING)
		return;
	arg->text = AsString(Inst(env), text);
	g_message->changed = true;
}

/** A message's name for the console: the game's, or the engine's own temporary entity's. */
static const char *MessageName(int type)
{
	const char *name = type == SVC_TEMPENTITY ? "SVC_TEMPENTITY" : GET_USER_MSG_NAME(PLID, type, NULL);
	return name ? name : "?";
}

/** The message's listeners, with its receiver, its id and its destination as the call's cells; whether one blocked it. */
static bool HearMessage(HeldMessage &m)
{
	static const unsigned char roles[3] = { ROLE_INT, ROLE_INT, ROLE_INT };
	int receiver = m.ed ? (int)ENTINDEX(m.ed) : 0;

	HeldMessage *outer = g_message;
	g_message = &m;
	bool go;
	{
		ChainCall call(g_messagePoints[m.type], roles, 3);
		call.Int(0, receiver >= 1 && receiver <= gpGlobals->maxClients ? receiver : 0);
		call.Int(1, m.type);
		call.Int(2, m.dest);
		go = call.Pre();
	}
	g_message = outer;

	if (!m.sent && (!go || m.changed)) {
		static bool said[MESSAGE_TYPES];
		if (!said[m.type])
			MF_PrintSrvConsole("[amxts] a Pawn plugin hooks the message %s too (register_message): it goes out as that plugin leaves it, and a TypeScript listener's change, recipients or preventDefault() of it is not sent\n",
			                   MessageName(m.type));
		said[m.type] = true;
	}
	return !go;
}

/** A held message sent through the engine's own functions, which no Metamod plugin hears: to `dest` and `ed`, as the game wrote it or a copy to one player. */
static void SendHeld(const HeldMessage &m, int dest, edict_t *ed)
{
	g_sending = true;
	g_engfuncs.pfnMessageBegin(dest, m.type, m.hasOrigin ? m.origin : NULL, ed);
	for (const MessageArg &arg : m.args) {
		switch (arg.type) {
		case MESSAGE_BYTE:   g_engfuncs.pfnWriteByte(arg.number); break;
		case MESSAGE_CHAR:   g_engfuncs.pfnWriteChar(arg.number); break;
		case MESSAGE_SHORT:  g_engfuncs.pfnWriteShort(arg.number); break;
		case MESSAGE_LONG:   g_engfuncs.pfnWriteLong(arg.number); break;
		case MESSAGE_ANGLE:  g_engfuncs.pfnWriteAngle(arg.real); break;
		case MESSAGE_COORD:  g_engfuncs.pfnWriteCoord(arg.real); break;
		case MESSAGE_STRING: g_engfuncs.pfnWriteString(arg.text.c_str()); break;
		case MESSAGE_ENTITY: g_engfuncs.pfnWriteEntity(arg.number); break;
		}
	}
	g_engfuncs.pfnMessageEnd();
	g_sending = false;
}

/** The trace's words for the copies sent to the chosen players - ` to 2 players "a" "b"` - by their ids; "" for -1, none sent so. */
static std::string TracedTo(const int *sent, int count)
{
	std::string to = count < 0 ? "" : " to " + std::to_string(count) + (count == 1 ? " player" : " players");
	for (int i = 0; i < count; i++)
		to += std::string(" \"") + STRING(INDEXENT(sent[i])->v.netname) + "\"";
	return to;
}

/**
 * A held message to the chosen players alone: a copy to each of them it would
 * reach - everyone in the game for a broadcast, the one player for a message
 * to one, those whose PVS or PAS holds the origin, as the engine checks it -
 * reliable for a reliable message, unreliable else. The engine's init string
 * and its proxies' messages go as they are (-1). The ids it went to are
 * written into `sent`; how many.
 */
static int SendChosen(const HeldMessage &m, int *sent)
{
	if (m.dest == MSG_INIT || m.dest == MSG_SPEC) {
		SendHeld(m, m.dest, m.ed);
		return -1;
	}
	bool one = m.dest == MSG_ONE || m.dest == MSG_ONE_UNRELIABLE;
	bool reliable = m.dest == MSG_ALL || m.dest == MSG_ONE || m.dest == MSG_PVS_R || m.dest == MSG_PAS_R;
	float origin[3] = { m.origin[0], m.origin[1], m.origin[2] };
	unsigned char *set = !m.hasOrigin ? NULL
		: m.dest == MSG_PVS || m.dest == MSG_PVS_R ? g_engfuncs.pfnSetFatPVS(origin)
		: m.dest == MSG_PAS || m.dest == MSG_PAS_R ? g_engfuncs.pfnSetFatPAS(origin)
		: NULL;
	int count = 0;
	for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++) {
		if (!m.to[id] || !InGame(id))
			continue;
		edict_t *e = INDEXENT(id);
		if ((one && e != m.ed) || (set && !(e->v.flags & FL_PROXY) && !g_engfuncs.pfnCheckVisibility(e, set)))
			continue;
		SendHeld(m, reliable ? MSG_ONE : MSG_ONE_UNRELIABLE, e);
		sent[count++] = id;
	}
	return count;
}

void MessageBegin(int dest, int type, const float *origin, edict_t *ed)
{
	if (g_sending || !g_messagesHooked)
		RETURN_META(MRES_IGNORED);
	// A message held for its listeners takes a plugin's menu only once it
	// reaches the player (MessageEnd): one they block never shows.
	bool held = !g_holding && type > 0 && type < MESSAGE_TYPES && g_messagePoints[type].attached;
	if (!held)
		MenuMessage(type, ed);
	if (g_holding) {
		g_passing++;
		RETURN_META(MRES_IGNORED);
	}
	if (!held)
		RETURN_META(MRES_IGNORED);

	g_holding = true;
	g_held.dest = dest;
	g_held.type = type;
	g_held.hasOrigin = origin != NULL;
	if (origin)
		memcpy(g_held.origin, origin, sizeof(g_held.origin));
	g_held.ed = ed;
	g_held.args.clear();
	g_held.sent = META_RESULT_STATUS < MRES_SUPERCEDE;
	g_held.changed = false;
	g_held.chosen = false;
	RETURN_META(g_held.sent ? MRES_SUPERCEDE : MRES_IGNORED);
}

/** One argument of the held message as the game writes it; whether the module holds it. */
static bool HoldArg(int type, int number, float real, const char *text)
{
	if (!g_holding || g_passing || g_sending)
		return false;
	g_held.args.push_back(MessageArg());
	MessageArg &arg = g_held.args.back();
	arg.type = type;
	arg.number = number;
	arg.real = real;
	if (text)
		arg.text = text;
	return g_held.sent;
}

#define HELD(type, number, real, text) RETURN_META(HoldArg(type, number, real, text) ? MRES_SUPERCEDE : MRES_IGNORED)

void WriteByte(int value)           { HELD(MESSAGE_BYTE, value, 0, NULL); }
void WriteChar(int value)           { HELD(MESSAGE_CHAR, value, 0, NULL); }
void WriteShort(int value)          { HELD(MESSAGE_SHORT, value, 0, NULL); }
void WriteLong(int value)           { HELD(MESSAGE_LONG, value, 0, NULL); }
void WriteAngle(float value)        { HELD(MESSAGE_ANGLE, 0, value, NULL); }
void WriteCoord(float value)        { HELD(MESSAGE_COORD, 0, value, NULL); }
void WriteString(const char *value) { HELD(MESSAGE_STRING, 0, 0, value ? value : ""); }
void WriteEntity(int value)         { HELD(MESSAGE_ENTITY, value, 0, NULL); }

void MessageEnd()
{
	if (g_sending)
		RETURN_META(MRES_IGNORED);
	if (g_passing) {
		g_passing--;
		RETURN_META(MRES_IGNORED);
	}
	if (!g_holding)
		RETURN_META(MRES_IGNORED);

	// Taken off the hook first: a listener may make the game send another.
	g_holding = false;
	HeldMessage message;
	std::swap(message, g_held);
	bool blocked = HearMessage(message);
	int sent[CLIENT_SLOTS];
	int count = -1;
	if (message.sent && !blocked) {
		MenuMessage(message.type, message.ed);
		if (message.chosen)
			count = SendChosen(message, sent);
		else
			SendHeld(message, message.dest, message.ed);
	}
	if (g_trace) {
		MF_PrintSrvConsole("[amxts] TRACE message %s %s%s\n", MessageName(message.type),
		                   !message.sent ? "heard" : blocked ? "blocked" : message.changed ? "sent changed" : "sent", TracedTo(sent, count).c_str());
	}
	if (!g_messagesHooked)
		MessageHooks(false);
	RETURN_META(message.sent ? MRES_SUPERCEDE : MRES_IGNORED);
}

/**
 * The messages' hooks in Metamod's table while a message is listened to,
 * out of it while none is - not while one is held, whose end must come.
 */
static void MessageHooks(bool on)
{
	if (!g_pengfuncsTable || (!on && g_holding))
		return;
	enginefuncs_t &t = *g_pengfuncsTable;
	t.pfnMessageBegin = on ? MessageBegin : NULL;
	t.pfnWriteByte = on ? WriteByte : NULL;
	t.pfnWriteChar = on ? WriteChar : NULL;
	t.pfnWriteShort = on ? WriteShort : NULL;
	t.pfnWriteLong = on ? WriteLong : NULL;
	t.pfnWriteAngle = on ? WriteAngle : NULL;
	t.pfnWriteCoord = on ? WriteCoord : NULL;
	t.pfnWriteString = on ? WriteString : NULL;
	t.pfnWriteEntity = on ? WriteEntity : NULL;
	t.pfnMessageEnd = on ? MessageEnd : NULL;
}

static void MessagesAttach(bool on)
{
	g_messagesHooked += on ? 1 : -1;
	if (g_messagesHooked == (on ? 1 : 0))
		MessageHooks(on);
}

// ---------------------------------------------------------------- what made a temporary entity

// A temporary entity names nothing that made it - a spray's decal is the
// spray can's think - so its listeners are told the entity whose think is
// running, else the player whose command is. The module keeps both while a
// temporary entity is listened to; its hooks of them are out of Metamod's
// tables while none is, as every entity's think of every frame passes there.
extern DLL_FUNCTIONS *g_pFunctionTable;
extern DLL_FUNCTIONS *g_pFunctionTable_Post;

// The thinks running, the innermost last: a think may make another think.
#define THINKS_KEPT 8
static edict_t *g_thinking[THINKS_KEPT];
static int      g_thinks = 0;
// The player whose command is running, between CmdStart and CmdEnd.
static edict_t *g_commanding = NULL;
static bool     g_sourcesHooked = false;

static void DispatchThink_Source(edict_t *e)
{
	if (g_thinks < THINKS_KEPT)
		g_thinking[g_thinks] = e;
	g_thinks++;
	// The module's own hook, which answers Metamod for this one.
	DispatchThink(e);
}

static void DispatchThink_SourcePost(edict_t *e)
{
	(void)e;
	if (g_thinks > 0)
		g_thinks--;
	RETURN_META(MRES_IGNORED);
}

static void CmdStart_Source(const edict_t *player, const struct usercmd_s *cmd, unsigned int seed)
{
	(void)cmd;
	(void)seed;
	g_commanding = (edict_t *)player;
	RETURN_META(MRES_IGNORED);
}

static void CmdEnd_SourcePost(const edict_t *player)
{
	(void)player;
	g_commanding = NULL;
	RETURN_META(MRES_IGNORED);
}

/** The hooks that keep a temporary entity's source, in Metamod's tables or out of them; either way from nothing running. */
static void SourceHooks(bool on)
{
	g_thinks = 0;
	g_commanding = NULL;
	if (!g_pFunctionTable || !g_pFunctionTable_Post)
		return;
	g_pFunctionTable->pfnThink = on ? DispatchThink_Source : DispatchThink;
	g_pFunctionTable_Post->pfnThink = on ? DispatchThink_SourcePost : NULL;
	g_pFunctionTable->pfnCmdStart = on ? CmdStart_Source : NULL;
	g_pFunctionTable_Post->pfnCmdEnd = on ? CmdEnd_SourcePost : NULL;
}

static void TempEntitiesAttach(bool on)
{
	MessagesAttach(on);
	g_sourcesHooked = on;
	SourceHooks(on);
}

/** effect_source() - what made the temporary entity heard: the entity whose think is running, else the player whose command is; 0 for neither. */
static int32_t w_effect_source(wasm_exec_env_t env)
{
	(void)env;
	edict_t *e = g_thinks == 0 ? g_commanding : g_thinks <= THINKS_KEPT ? g_thinking[g_thinks - 1] : NULL;
	return e && !e->free ? (int32_t)ENTINDEX(e) : 0;
}

// ---------------------------------------------------------------- the facade's messages

// Metamod's engine table with every plugin's hooks in it, as AMX Mod X's
// emessage_begin calls it: a message sent through it is heard as the game's
// own. What a field's setter sends with the field - the HUD's money, the
// armour's kind - is a call each here, not an AMX Mod X native's.
static enginefuncs_t *g_hookedEngine = NULL;

/** send_one(player, type): a message to one player in the game begun; 0, and nothing begun, for one who is not. */
static int32_t w_sendOne(wasm_exec_env_t env, int32_t player, int32_t type)
{
	if (!g_hookedEngine)
		GET_HOOK_TABLES(PLID, &g_hookedEngine, NULL, NULL);
	edict_t *e = !g_hookedEngine || type < 1 || player > gpGlobals->maxClients || !InGame(player) ? NULL : (edict_t *)EdictOf(player);
	if (!e)
		return 0;
	g_hookedEngine->pfnMessageBegin(MSG_ONE, type, NULL, e);
	return 1;
}

// How send_cells writes each of its numbers, two bits a number: as a byte, a long.
#define SEND_BYTE 1
#define SEND_LONG 2

static void SendCell(int32_t value, int kind)
{
	if (kind == SEND_BYTE)
		g_hookedEngine->pfnWriteByte(value);
	else if (kind == SEND_LONG)
		g_hookedEngine->pfnWriteLong(value);
}

/**
 * send_cells(player, type, first, second, kinds): a message of one or two
 * numbers to one player in the game, sent whole - what a field's setter
 * sends with the field, in one call; `kinds` says how each is written.
 */
static void w_sendCells(wasm_exec_env_t env, int32_t player, int32_t type, int32_t first, int32_t second, int32_t kinds)
{
	if (!w_sendOne(env, player, type))
		return;
	SendCell(first, kinds & 3);
	SendCell(second, (kinds >> 2) & 3);
	g_hookedEngine->pfnMessageEnd();
}

static void w_sendByte(wasm_exec_env_t env, int32_t value)
{
	g_hookedEngine->pfnWriteByte(value);
}

static void w_sendLong(wasm_exec_env_t env, int32_t value)
{
	g_hookedEngine->pfnWriteLong(value);
}

static void w_sendString(wasm_exec_env_t env, int32_t text)
{
	g_hookedEngine->pfnWriteString(AsString(Inst(env), text).c_str());
}

static void w_sendEnd(wasm_exec_env_t env)
{
	g_hookedEngine->pfnMessageEnd();
}

/**
 * msg_register(name): a message of a plugin's own, of any length, registered
 * through Metamod's table as the game registers its own, so Metamod and AMX
 * Mod X know it by its name (get_user_msgid, message_begin); its id - the
 * engine keeps it, so the same for the name on every map - or 0 for one the
 * engine refuses or that is known with a fixed size, which a plugin's
 * message would not match.
 */
static int32_t w_msgRegister(wasm_exec_env_t env, int32_t name)
{
	std::string text = AsString(Inst(env), name);
	int size = -1;
	int id = GET_USER_MSG_ID(PLID, text.c_str(), &size);
	if (id > 0 && size != -1)
		MF_PrintSrvConsole("[amxts] the message %s is registered with a fixed size of %d bytes: a UserMessage of that name is not sent\n", text.c_str(), size);
	if (id > 0)
		return size == -1 ? id : 0;
	if (!g_hookedEngine)
		GET_HOOK_TABLES(PLID, &g_hookedEngine, NULL, NULL);
	// Metamod keeps the name's pointer.
	return g_hookedEngine ? g_hookedEngine->pfnRegUserMsg(strdup(text.c_str()), -1) : 0;
}

// ---------------------------------------------------------------- the log

// A log line's most arguments, and AMX Mod X's.
#define LOG_ARGS 12

/** A line of the game's log, in its arguments as AMX Mod X splits it for read_logargv. */
struct LogLine {
	std::string text;
	int         argc = 0;
	std::string args[LOG_ARGS];
};

/** The line being heard: the log event's and the `log` event's, for read_logdata and the rest. */
static LogLine *g_log = NULL;

/**
 * A line's arguments: a quoted text is one, without its quotes; a text in
 * parentheses is one, without them; and the words between are one, without
 * the spaces around them - `World triggered "Round_Draw" (CT "0")` is
 * `World triggered`, `Round_Draw` and `CT "0"`.
 */
static void SplitLog(LogLine &line)
{
	const char *at = line.text.c_str();
	line.argc = 0;
	while (*at == ' ')
		at++;
	while (*at && line.argc < LOG_ARGS) {
		std::string &arg = line.args[line.argc++];
		arg.clear();
		char close = *at == '"' ? '"' : *at == '(' ? ')' : 0;
		if (close) {
			const char *end = strchr(at + 1, close);
			if (!end)
				end = at + strlen(at);
			arg.assign(at + 1, end);
			at = *end ? end + 1 : end;
		}
		else {
			const char *end = at;
			while (*end && *end != '"' && *end != '(')
				end++;
			const char *last = end;
			while (last > at && last[-1] == ' ')
				last--;
			arg.assign(at, last);
			at = end;
		}
		while (*at == ' ')
			at++;
	}
}

/**
 * A log event's handlers: lines of `argc` arguments, and of them those whose
 * argument `at` is `text` (`=`) or holds it (`&`) - AMX Mod X's
 * register_logevent filter, "1=Round_Start". `at` -1 for every line.
 */
struct LogPoint {
	int         argc;
	int         at;
	bool        whole;
	std::string text;
	HookPoint   point;
};

POINTS_COUNTER(g_logHooked)

static std::deque<LogPoint> g_logPoints;

/** log_hook(argc, filter, handler) - a handler of the log's lines that `filter` takes ("" for any of `argc` arguments). */
static int32_t w_log_hook(wasm_exec_env_t env, int32_t argc, int32_t filter, int32_t fn)
{
	std::string text = AsString(Inst(env), filter);
	int at = -1;
	bool whole = true;
	size_t sign = text.find_first_of("=&");
	if (sign != std::string::npos && sign > 0) {
		at = atoi(text.c_str());
		whole = text[sign] == '=';
		text = text.substr(sign + 1);
	}

	for (LogPoint &p : g_logPoints)
		if (p.argc == argc && p.at == at && p.whole == whole && p.text == text)
			return AddOtherHook(p.point, fn, 0);
	g_logPoints.push_back(LogPoint());
	LogPoint &p = g_logPoints.back();
	p.argc = argc;
	p.at = at;
	p.whole = whole;
	p.text = text;
	p.point.attach = g_logHookedAttach;
	return AddOtherHook(p.point, fn, 0);
}

/** A line to the log events that take it. */
static void HearLog(LogLine &line)
{
	if (!g_logHooked)
		return;
	for (size_t i = 0, end = g_logPoints.size(); i < end; i++) {
		LogPoint &p = g_logPoints[i];
		if (!p.point.attached || p.argc != line.argc)
			continue;
		if (p.at >= 0 && (p.at >= line.argc || (p.whole ? line.args[p.at] != p.text : line.args[p.at].find(p.text) == std::string::npos)))
			continue;
		ChainCall call(p.point, NULL, 0);
		call.Pre();
	}
}

/** read_logdata(output[], len) - the line heard. */
static cell AMX_NATIVE_CALL n_readLogdata(AMX *amx, cell *params)
{
	return MF_SetAmxString(amx, params[1], g_log ? g_log->text.c_str() : "", (int)params[2]);
}

/** read_logargc() - its arguments. */
static cell AMX_NATIVE_CALL n_readLogargc(AMX *amx, cell *params)
{
	(void)amx;
	(void)params;
	return g_log ? g_log->argc : 0;
}

/** log_text(index, out, max) - the line heard (index -1) or one of its arguments, as UTF-8; its length. */
static int32_t w_logText(wasm_exec_env_t env, int32_t index, int32_t out, int32_t max)
{
	const char *text = !g_log ? "" : index < 0 ? g_log->text.c_str() : index < g_log->argc ? g_log->args[index].c_str() : "";
	return WriteBytes(Inst(env), out, max, text);
}

/** log_count() - how many arguments the line heard has. */
static int32_t w_logCount(wasm_exec_env_t env)
{
	(void)env;
	return g_log ? g_log->argc : 0;
}

/** read_logargv(id, output[], len) - one of them. */
static cell AMX_NATIVE_CALL n_readLogargv(AMX *amx, cell *params)
{
	int index = (int)params[1];
	const char *text = g_log && index >= 0 && index < g_log->argc ? g_log->args[index].c_str() : "";
	return MF_SetAmxString(amx, params[2], text, (int)params[3]);
}

// ---------------------------------------------------------------- cvars

/**
 * A cvar's change handlers. The console and the configs set a cvar through
 * the engine's internal Cvar_DirectSet, which Metamod's table does not carry:
 * ReHLDS's hookchain of it, else a jump over the function at the gamedata's
 * signature of it (EntryHook), else the cvars compared each frame.
 */
struct CvarPoint {
	cvar_t     *var;
	std::string seen;
	HookPoint   point;
};

static std::deque<CvarPoint> g_cvarPoints;
static int      g_cvarsHooked = 0;
static unsigned g_cvarChanges = 0;
static EntryHook g_cvarSet = { NULL, NULL, { 0 }, { 0 }, false };
// Linux's engine built with regparm(3): the gamedata's "RegParm" key.
static bool     g_cvarSetRegParm = false;

static void CvarSet_RH(IRehldsHook_Cvar_DirectSet *chain, cvar_t *var, const char *value);

static void CvarsAttach(bool on)
{
	bool was = g_cvarsHooked > 0;
	g_cvarsHooked += on ? 1 : -1;
	bool now = g_cvarsHooked > 0;
	if (was == now)
		return;
	if (g_rehlds) {
		if (now)
			g_rehlds->GetHookchains()->Cvar_DirectSet()->registerHook(CvarSet_RH, HC_PRIORITY_DEFAULT + 1);
		else
			g_rehlds->GetHookchains()->Cvar_DirectSet()->unregisterHook(CvarSet_RH);
		return;
	}
	// The cvars compared each frame start from what they are now.
	for (CvarPoint &p : g_cvarPoints)
		p.seen = p.var->string;
}

static CvarPoint *CvarPointOf(const cvar_t *var)
{
	for (CvarPoint &p : g_cvarPoints)
		if (p.var == var && p.point.attached)
			return &p;
	return NULL;
}

/** cvar_hook(name, handler) - a handler of the cvar's changes; 0 for no such cvar. */
static int32_t w_cvar_hook(wasm_exec_env_t env, int32_t name, int32_t fn)
{
	cvar_t *var = CVAR_GET_POINTER(AsString(Inst(env), name).c_str());
	if (!var) {
		TakeTag();
		return 0;
	}
	for (CvarPoint &p : g_cvarPoints)
		if (p.var == var)
			return AddOtherHook(p.point, fn, 0);
	g_cvarPoints.push_back(CvarPoint());
	CvarPoint &p = g_cvarPoints.back();
	p.var = var;
	p.seen = var->string;
	p.point.attach = CvarsAttach;
	return AddOtherHook(p.point, fn, 0);
}

/**
 * cvar_exact() - 1 when a cvar's handlers hear its change as it is made
 * (ReHLDS's hookchain, or the jump at the gamedata's signature), 0 where
 * the cvars are compared once a frame: a plugin keeps a cvar's text only
 * when a change can let it go at once.
 */
static int32_t w_cvar_exact(wasm_exec_env_t env)
{
	(void)env;
	return g_rehlds || g_cvarSet.at ? 1 : 0;
}

/** The cvar's handlers, with its pointer, the text before and the text now as the call's arguments. */
static void CvarChanged(CvarPoint &p, const char *before)
{
	static const unsigned char roles[3] = { ROLE_INT, ROLE_TEXT, ROLE_TEXT };
	g_cvarChanges++;
	std::string now = p.var->string;
	ChainCall call(p.point, roles, 3);
	call.Pointer(0, p.var);
	call.Text(1, before);
	call.Text(2, now.c_str());
	call.Pre();
}

/**
 * A cvar set: the change goes on, and the handlers hear it after it, once.
 * AMX Mod X's own hook is inside the module's - its plugins hear the change
 * first - and one that clamps a value to a cvar's bounds sets the cvar again
 * from inside: that inner change is the one heard.
 */
template <typename Next>
static void CvarSetting(cvar_t *var, const char *value, Next next)
{
	CvarPoint *p = var && value && g_cvarsHooked ? CvarPointOf(var) : NULL;
	if (!p || !strcmp(var->string, value)) {
		next();
		return;
	}
	std::string before = var->string;
	unsigned changes = g_cvarChanges;
	next();
	if (changes == g_cvarChanges && before != var->string)
		CvarChanged(*p, before.c_str());
}

static void CvarSet_RH(IRehldsHook_Cvar_DirectSet *chain, cvar_t *var, const char *value)
{
	CvarSetting(var, value, [&]() { chain->callNext(var, value); });
}

typedef void (*CvarSetFn)(cvar_t *var, const char *value);

static void CvarSet_Hooked(cvar_t *var, const char *value)
{
	CvarSetting(var, value, [&]() {
		HookOff(g_cvarSet);
		((CvarSetFn)g_cvarSet.at)(var, value);
		HookOn(g_cvarSet);
	});
}

#ifndef _WIN32
typedef void (__attribute__((regparm(3))) *CvarSetRegFn)(cvar_t *var, const char *value);

static void __attribute__((regparm(3))) CvarSet_HookedRegParm(cvar_t *var, const char *value)
{
	CvarSetting(var, value, [&]() {
		HookOff(g_cvarSet);
		((CvarSetRegFn)g_cvarSet.at)(var, value);
		HookOn(g_cvarSet);
	});
}
#endif

/** Cvar_DirectSet on plain HLDS: the gamedata's signature of it, else nothing - the cvars are then compared each frame. */
static void FindCvarSet()
{
	void *address = NULL;
	if (g_rehlds || !g_entityData || !g_entityData->GetMemSig("Cvar_DirectSet", &address) || !address)
		return;
	g_cvarSet.at = (unsigned char *)address;
	g_cvarSet.to = (void *)CvarSet_Hooked;
#ifndef _WIN32
	const char *regparm = g_entityData->GetKeyValue("RegParm");
	if (regparm && atoi(regparm) != 0)
		g_cvarSet.to = (void *)CvarSet_HookedRegParm;
#endif
}

/** The module going: its hook of Cvar_DirectSet out of the engine's way. */
static void UnhookCvars()
{
	if (g_rehlds && g_cvarsHooked > 0)
		g_rehlds->GetHookchains()->Cvar_DirectSet()->unregisterHook(CvarSet_RH);
	HookOff(g_cvarSet);
}

/** The cvars compared, on a server where neither hook is found: a change is heard on the frame after it. */
static void CompareCvars()
{
	if (g_rehlds || g_cvarSet.at || !g_cvarsHooked)
		return;
	for (size_t i = 0, end = g_cvarPoints.size(); i < end; i++) {
		CvarPoint &p = g_cvarPoints[i];
		if (!p.point.attached || p.seen == p.var->string)
			continue;
		std::string before = p.seen;
		p.seen = p.var->string;
		CvarChanged(p, before.c_str());
	}
}

// ---------------------------------------------------------------- touches

/** A touch's handlers: of an entity of class `touched` by one of class `toucher`, by their numbers (ClassNumber), 0 for any. */
struct TouchPoint {
	int       touched;
	int       toucher;
	HookPoint point;
};

POINTS_COUNTER(g_touchesHooked)

static std::deque<TouchPoint> g_touchPoints;

// A touch's classes are matched as numbers, not as text: one number a class
// name, and each entity's number kept with the classname it was read from,
// read again when that changes. The engine's strings go with the map, and
// the entities' numbers with them (ForgetOtherPoints).
static std::unordered_map<std::string, int> g_classNumbers;
static std::vector<std::pair<string_t, int>> g_entityClasses;
// The touched classes some point names, by number, and whether one names any:
// a touch of another class goes past the points at once.
static std::vector<char> g_touchedClasses;
static bool g_anyTouched;

/** A class name's number, from 1; "" and "*" are 0, any class. */
static int ClassNumber(const std::string &name)
{
	if (name.empty() || name == "*")
		return 0;
	return g_classNumbers.emplace(name, (int)g_classNumbers.size() + 1).first->second;
}

/** The entity's class number read from its classname, and kept: ClassOf's seldom part. */
static NEVER_INLINE int ReadClass(edict_t *e, int index)
{
	if (index >= (int)g_entityClasses.size())
		g_entityClasses.resize(index + 1, std::make_pair((string_t)0, -1));
	std::pair<string_t, int> &known = g_entityClasses[index];
	known.first = e->v.classname;
	known.second = ClassNumber(STRING(e->v.classname));
	return known.second;
}

/** The entity's class number, by its index: read again only when its classname changed. */
static ALWAYS_INLINE int ClassOf(edict_t *e, int index)
{
	if (index < (int)g_entityClasses.size()) {
		const std::pair<string_t, int> &known = g_entityClasses[index];
		if (known.second >= 0 && known.first == e->v.classname)
			return known.second;
	}
	return ReadClass(e, index);
}

/** touch_hook(touched, toucher, handler) - a handler of a touch of these classes. */
static int32_t w_touch_hook(wasm_exec_env_t env, int32_t touched, int32_t toucher, int32_t fn)
{
	int a = ClassNumber(AsString(Inst(env), touched));
	int b = ClassNumber(AsString(Inst(env), toucher));
	for (TouchPoint &p : g_touchPoints)
		if (p.touched == a && p.toucher == b)
			return AddOtherHook(p.point, fn, 0);
	g_touchPoints.push_back(TouchPoint());
	TouchPoint &p = g_touchPoints.back();
	if (a >= (int)g_touchedClasses.size())
		g_touchedClasses.resize(a + 1);
	g_touchedClasses[a] = 1;
	g_anyTouched |= a == 0;
	p.touched = a;
	p.toucher = b;
	p.point.attach = g_touchesHookedAttach;
	return AddOtherHook(p.point, fn, 0);
}

/**
 * The touch handlers whose classes match, `a` the touched entity's class:
 * TouchHeard's seldom part, out of line, so that its callers - every touch
 * of the game - carry no handler call's frame.
 */
static NEVER_INLINE bool TouchListeners(edict_t *touched, edict_t *other, int a, int otherIndex)
{
	static const unsigned char roles[2] = { ROLE_EDICT, ROLE_EDICT };
	int b = ClassOf(other, otherIndex);
	bool blocked = false;
	for (size_t i = 0, end = g_touchPoints.size(); i < end; i++) {
		TouchPoint &p = g_touchPoints[i];
		if (!p.point.attached || (p.touched && p.touched != a) || (p.toucher && p.toucher != b))
			continue;
		ChainCall call(p.point, roles, 2);
		call.Edict(0, touched);
		call.Edict(1, other);
		if (!call.Pre())
			blocked = true;
	}
	return !blocked;
}

/** The touch handlers of these two, (touched, toucher), with their indexes: false when one blocked it with handled(). */
static ALWAYS_INLINE bool TouchHeard(edict_t *touched, edict_t *other, int touchedIndex, int otherIndex)
{
	if (!g_touchesHooked)
		return true;
	int a = ClassOf(touched, touchedIndex);
	if (!g_anyTouched && (a >= (int)g_touchedClasses.size() || !g_touchedClasses[a]))
		return true;
	return TouchListeners(touched, other, a, otherIndex);
}

/**
 * The game's DispatchTouch: `other` moved into `touched`. The handlers
 * get (touched, toucher) and block it with handled(). The engine module,
 * after the module in Metamod's list, hears it after them.
 */
void DispatchTouch(edict_t *touched, edict_t *other)
{
	if (!touched || !other || TouchHeard(touched, other, IndexOf(touched), IndexOf(other)))
		RETURN_META(MRES_IGNORED);
	RETURN_META(MRES_SUPERCEDE);
}

// ---------------------------------------------------------------- fakemeta's functions

// The functions the plain-HLDS backends hear, by the number stock_hook
// takes; must match STOCK_* in as/facade.ts.
enum StockFunction {
	STOCK_SET_MODEL,
	STOCK_EMIT_SOUND,
	STOCK_CLIENT_LISTENING,
	STOCK_PRECACHE_MODEL,
	STOCK_PRECACHE_SOUND,
	STOCK_PRECACHE_GENERIC,
	STOCK_GAME_DESCRIPTION,
	STOCK_CVAR_ANSWER,
	STOCK_PM_MOVE, // movement.h's
	STOCK_COUNT
};

static int       g_stocksHooked[STOCK_COUNT];
static HookPoint g_stockPoints[STOCK_COUNT];

template <int K>
static void StockAttach(bool on)
{
	g_stocksHooked[K] += on ? 1 : -1;
}

static void (*const g_stockAttach[STOCK_COUNT])(bool) = {
	StockAttach<0>, StockAttach<1>, StockAttach<2>, StockAttach<3>,
	StockAttach<4>, StockAttach<5>, StockAttach<6>, StockAttach<7>,
	StockAttach<8>,
};

/** stock_hook(function, handler, post) - a handler of one of the functions above, before the game's or after it. */
static int32_t w_stock_hook(wasm_exec_env_t env, int32_t function, int32_t fn, int32_t post)
{
	(void)env;
	if (function < 0 || function >= STOCK_COUNT) {
		TakeTag();
		return 0;
	}
	g_stockPoints[function].attach = g_stockAttach[function];
	return AddOtherHook(g_stockPoints[function], fn, post);
}

/** Whether a phase of a function has a handler on. */
static bool StockHeard(int function, int post)
{
	if (!g_stocksHooked[function])
		return false;
	for (const GameHandler &h : g_stockPoints[function].phase[post].handlers)
		if (!h.off && h.plugin != HANDLER_GONE)
			return true;
	return false;
}

void SetModel(edict_t *e, const char *model)
{
	if (!StockHeard(STOCK_SET_MODEL, 0))
		RETURN_META(MRES_IGNORED);
	static const unsigned char roles[2] = { ROLE_EDICT, ROLE_TEXT };
	ChainCall call(g_stockPoints[STOCK_SET_MODEL], roles, 2);
	call.Edict(0, e);
	call.Text(1, model);
	RETURN_META(call.Pre() ? MRES_IGNORED : MRES_SUPERCEDE);
}

/** A sound the game plays: a listener may stop it, or choose its players - then the engine's own call plays it to them (sound.h). */
void EmitSound(edict_t *e, int channel, const char *sample, float volume, float attenuation, int flags, int pitch)
{
	if (!StockHeard(STOCK_EMIT_SOUND, 0))
		RETURN_META(MRES_IGNORED);
	static const unsigned char roles[7] = { ROLE_EDICT, ROLE_INT, ROLE_TEXT, ROLE_FLOAT, ROLE_FLOAT, ROLE_INT, ROLE_INT };
	SoundChoice choice;
	ChainCall call(g_stockPoints[STOCK_EMIT_SOUND], roles, 7);
	call.Edict(0, e);
	call.Int(1, channel);
	call.Text(2, sample);
	call.Float(3, volume);
	call.Float(4, attenuation);
	call.Int(5, flags);
	call.Int(6, pitch);
	if (!call.Pre())
		RETURN_META(MRES_SUPERCEDE);
	if (!choice.Play(e))
		RETURN_META(MRES_IGNORED);
	g_engfuncs.pfnEmitSound(e, channel, sample, volume, attenuation, flags, pitch);
	RETURN_META(MRES_SUPERCEDE);
}

/** Whether a client hears another: a listener writes the third argument, and the engine is told that instead. */
qboolean Voice_SetClientListening(int receiver, int sender, qboolean listen)
{
	if (!StockHeard(STOCK_CLIENT_LISTENING, 0))
		RETURN_META_VALUE(MRES_IGNORED, 0);
	static const unsigned char roles[3] = { ROLE_INT, ROLE_INT, ROLE_INT };
	ChainCall call(g_stockPoints[STOCK_CLIENT_LISTENING], roles, 3);
	call.Int(0, receiver);
	call.Int(1, sender);
	call.Int(2, listen);
	call.Pre();
	if (!call.Changed(2))
		RETURN_META_VALUE(MRES_IGNORED, 0);
	RETURN_META_VALUE(MRES_SUPERCEDE, g_engfuncs.pfnVoice_SetClientListening(receiver, sender, call.CellAt(2) != 0));
}

/** A precache asked for: blocked, it answers 0; after it, arg(-1) is the engine's answer. */
static int HearPrecache(int function, const char *path, bool post)
{
	if (!StockHeard(function, post ? 1 : 0))
		return -1;
	static const unsigned char roles[1] = { ROLE_TEXT };
	ChainCall call(g_stockPoints[function], roles, 1);
	call.Text(0, path);
	if (post) {
		call.Returned(META_RESULT_ORIG_RET(int));
		call.Post();
		return -1;
	}
	return call.Pre() ? -1 : 0;
}

// ---- how full the engine's precache tables are

// The engine's tables of what a map precaches: models (sprites among them),
// sounds and other files, 512 each on ReHLDS and on Valve's HLDS (MAX_MODELS,
// MAX_SOUNDS, MAX_GENERIC). A precache past one stops the server.
#define PRECACHE_KINDS 3
#define PRECACHE_ROOM  512
static const char *const g_precacheKinds[PRECACHE_KINDS] = { "models", "sounds", "files" };

// The highest index the engine gave a precache of each kind this map, -1 for
// none: it fills a table in order, so every index below is taken - the map's
// own models included, which it puts there before any precache.
static int g_precacheTop[PRECACHE_KINDS] = { -1, -1, -1 };
// What was said of each kind this map: 1 near the room, 2 full.
static int g_precacheSaid[PRECACHE_KINDS] = { 0, 0, 0 };

/** The map ends: its tables start over with the next one. */
static void ForgetPrecaches()
{
	for (int kind = 0; kind < PRECACHE_KINDS; kind++)
		g_precacheTop[kind] = -1, g_precacheSaid[kind] = 0;
}

/**
 * The engine gave `path` the index `index` in table `kind`. Once the table is
 * at nine tenths of its room, and again once it is full, the console and AMX
 * Mod X's log say so, with the file and who precached it - a crash on the
 * next one names nothing.
 */
static void CountPrecache(int kind, const char *path, int index)
{
	if (index <= g_precacheTop[kind])
		return;
	g_precacheTop[kind] = index;
	int used = index + 1;
	int step = used >= PRECACHE_ROOM ? 2 : used * 10 >= PRECACHE_ROOM * 9 ? 1 : 0;
	if (step <= g_precacheSaid[kind])
		return;
	g_precacheSaid[kind] = step;

	std::string who = g_currentPlugin >= 0 ? PluginName(g_currentPlugin) : "a Pawn plugin or the game";
	char line[384];
	if (step == 2)
		snprintf(line, sizeof(line), "the map has precached %d %s, the engine's room: one more stops the server - the last, \"%s\", by %s",
		         used, g_precacheKinds[kind], path, who.c_str());
	else
		snprintf(line, sizeof(line), "the map has precached %d %s of the engine's %d - one past that stops the server; the last, \"%s\", by %s",
		         used, g_precacheKinds[kind], PRECACHE_ROOM, path, who.c_str());
	MF_PrintSrvConsole("[amxts] %s\n", line);
	MF_Log("%s", line);
}

/** precache_count(kind) - how much of the engine's table of `kind` this map has taken: 0 models, 1 sounds, 2 files. */
static int32_t w_precacheCount(wasm_exec_env_t env, int32_t kind)
{
	(void)env;
	return kind >= 0 && kind < PRECACHE_KINDS ? g_precacheTop[kind] + 1 : 0;
}

#define PRECACHE_HOOKS(Name, function, kind) \
	int Name(const char *path) \
	{ \
		int blocked = HearPrecache(function, path, false); \
		if (blocked < 0) \
			RETURN_META_VALUE(MRES_IGNORED, 0); \
		RETURN_META_VALUE(MRES_SUPERCEDE, blocked); \
	} \
	int Name##_Post(const char *path) \
	{ \
		if (path) \
			CountPrecache(kind, path, META_RESULT_ORIG_RET(int)); \
		HearPrecache(function, path, true); \
		RETURN_META_VALUE(MRES_IGNORED, 0); \
	}

PRECACHE_HOOKS(PrecacheModel, STOCK_PRECACHE_MODEL, 0)
PRECACHE_HOOKS(PrecacheSound, STOCK_PRECACHE_SOUND, 1)
PRECACHE_HOOKS(PrecacheGeneric, STOCK_PRECACHE_GENERIC, 2)

/** The game's name in the server browser: a listener answers another with chain_set_text(-1, ...) and handled(). */
const char *GetGameDescription()
{
	if (!StockHeard(STOCK_GAME_DESCRIPTION, 0))
		RETURN_META_VALUE(MRES_IGNORED, NULL);
	ChainCall call(g_stockPoints[STOCK_GAME_DESCRIPTION], NULL, 0);
	if (call.Pre() || !call.answered)
		RETURN_META_VALUE(MRES_IGNORED, NULL);
	RETURN_META_VALUE(MRES_SUPERCEDE, call.ResultText());
}

/**
 * A client's answer about one of its cvars, to a question the module asked
 * (query_cvar): the player, the question's id, the cvar and its value.
 */
static void CvarValue2(const edict_t *e, int request, const char *name, const char *value)
{
	if (!StockHeard(STOCK_CVAR_ANSWER, 0))
		RETURN_META(MRES_IGNORED);
	static const unsigned char roles[4] = { ROLE_EDICT, ROLE_INT, ROLE_TEXT, ROLE_TEXT };
	ChainCall call(g_stockPoints[STOCK_CVAR_ANSWER], roles, 4);
	call.Edict(0, e);
	call.Int(1, request);
	call.Text(2, name);
	call.Text(3, value);
	call.Pre();
	RETURN_META(MRES_IGNORED);
}

/**
 * query_cvar(id, name) - asks player `id`'s game for one of its cvars; the
 * question's id, which the answer carries (STOCK_CVAR_ANSWER), or 0 when it
 * cannot be asked. The id is Metamod's, unique among its plugins, so AMX Mod
 * X takes no answer of the module's for one of its own.
 */
static int32_t w_query_cvar(wasm_exec_env_t env, int32_t id, int32_t name)
{
	if (id < 1 || id > gpGlobals->maxClients || !g_engfuncs.pfnQueryClientCvarValue2 || !g_pNewFunctionsTable)
		return 0;
	edict_t *e = INDEXENT(id);
	if (!e || e->free)
		return 0;
	g_pNewFunctionsTable->pfnCvarValue2 = CvarValue2;
	int request = MAKE_REQUESTID(PLID);
	g_engfuncs.pfnQueryClientCvarValue2(e, AsString(Inst(env), name).c_str(), request);
	return request;
}

/** The points made for things of a map - log filters, cvars, touches - go with it, after TeardownGameHooks has emptied them. */
static void ForgetOtherPoints()
{
	g_logPoints.clear();
	g_cvarPoints.clear();
	g_touchPoints.clear();
	g_entityClasses.clear();
	g_touchedClasses.clear();
	g_anyTouched = false;
}

#define ENGINE_HOOK_NATIVES \
	{ "msg_hook",       (void *)w_msg_hook,       "(ii)i",   NULL }, \
	{ "msg_argc",       (void *)w_msg_argc,       "()i",     NULL }, \
	{ "msg_arg_type",   (void *)w_msg_arg_type,   "(i)i",    NULL }, \
	{ "msg_number",     (void *)w_msg_number,     "(i)F",    NULL }, \
	{ "msg_text",       (void *)w_msg_text,       "(iii)i",  NULL }, \
	{ "msg_set_number", (void *)w_msg_set_number, "(iF)",    NULL }, \
	{ "msg_set_text",   (void *)w_msg_set_text,   "(ii)",    NULL }, \
	{ "msg_to",         (void *)w_msg_to,         "(ii)",    NULL }, \
	{ "effect_source",  (void *)w_effect_source,  "()i",     NULL }, \
	{ "log_hook",       (void *)w_log_hook,       "(iii)i",  NULL }, \
	{ "log_text",       (void *)w_logText,        "(iii)i",  NULL }, \
	{ "log_count",      (void *)w_logCount,       "()i",     NULL }, \
	{ "cvar_hook",      (void *)w_cvar_hook,      "(ii)i",   NULL }, \
	{ "cvar_exact",     (void *)w_cvar_exact,     "()i",     NULL }, \
	{ "touch_hook",     (void *)w_touch_hook,     "(iii)i",  NULL }, \
	{ "stock_hook",     (void *)w_stock_hook,     "(iii)i",  NULL }, \
	{ "query_cvar",     (void *)w_query_cvar,     "(ii)i",   NULL }, \
	{ "send_one",       (void *)w_sendOne,        "(ii)i",   NULL }, \
	{ "send_byte",      (void *)w_sendByte,       "(i)",     NULL }, \
	{ "send_long",      (void *)w_sendLong,       "(i)",     NULL }, \
	{ "send_string",    (void *)w_sendString,     "(i)",     NULL }, \
	{ "send_end",       (void *)w_sendEnd,        "()",      NULL }, \
	{ "send_cells",     (void *)w_sendCells,      "(iiiii)", NULL }, \
	{ "msg_register",   (void *)w_msgRegister,    "(i)i",    NULL }, \
	{ "precache_count", (void *)w_precacheCount,  "(i)i",    NULL },
