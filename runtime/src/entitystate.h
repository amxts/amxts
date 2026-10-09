// What the server sends a player of each entity it lets him see - the
// game's AddToFullPack - for game.addEventListener("entityState", ...): the
// state read and written while the listeners run, the entity hidden from him
// when one stops it. A listener names the class it is about, and the module
// passes only those entities to the plugin; with no listener the hook is not
// in Metamod's table at all, so a server without one pays nothing.
//
// Included by module.cpp, after enginehooks.h.

extern DLL_FUNCTIONS *g_pFunctionTable_Post;

/** An entityState listener's class, "" for any, and its handlers. */
struct StatePoint {
	std::string classname;
	HookPoint   point;
};

static std::deque<StatePoint> g_statePoints;
static int g_statesHooked = 0;
// The state the listeners are reading, while they run.
static entity_state_t *g_state = NULL;

static int AddToFullPack_Post(entity_state_t *state, int e, edict_t *ent, edict_t *host, int hostflags, int player, unsigned char *set);

static void StatesAttach(bool on)
{
	g_statesHooked += on ? 1 : -1;
	if (g_pFunctionTable_Post)
		g_pFunctionTable_Post->pfnAddToFullPack = g_statesHooked > 0 ? AddToFullPack_Post : NULL;
}

/** state_hook(classname, handler) - a handler of the states of entities of a class, "" for any. */
static int32_t w_stateHook(wasm_exec_env_t env, int32_t classname, int32_t fn)
{
	std::string name = AsString(Inst(env), classname);
	for (StatePoint &p : g_statePoints)
		if (p.classname == name)
			return AddOtherHook(p.point, fn, 0);
	g_statePoints.push_back(StatePoint());
	StatePoint &p = g_statePoints.back();
	p.classname = name;
	p.point.attach = StatesAttach;
	return AddOtherHook(p.point, fn, 0);
}

// The fields state_get and state_set read and write, by number.
enum StateField {
	STATE_ORIGIN = 0,       // 0..2
	STATE_ANGLES = 3,       // 3..5
	STATE_RENDER_MODE = 6,
	STATE_RENDER_AMOUNT = 7,
	STATE_RENDER_COLOR = 8, // 8..10
	STATE_RENDER_FX = 11,
	STATE_EFFECTS = 12,
	STATE_MODEL_INDEX = 13,
	STATE_BODY = 14,
	STATE_SKIN = 15,
};

/** state_get(field) - a field of the state being sent, as a number. */
static double w_stateGet(wasm_exec_env_t env, int32_t field)
{
	(void)env;
	entity_state_t *s = g_state;
	if (!s)
		return 0;
	if (field >= STATE_ORIGIN && field < STATE_ORIGIN + 3)
		return s->origin[field - STATE_ORIGIN];
	if (field >= STATE_ANGLES && field < STATE_ANGLES + 3)
		return s->angles[field - STATE_ANGLES];
	switch (field) {
		case STATE_RENDER_MODE:     return s->rendermode;
		case STATE_RENDER_AMOUNT:   return s->renderamt;
		case STATE_RENDER_COLOR:    return s->rendercolor.r;
		case STATE_RENDER_COLOR + 1: return s->rendercolor.g;
		case STATE_RENDER_COLOR + 2: return s->rendercolor.b;
		case STATE_RENDER_FX:       return s->renderfx;
		case STATE_EFFECTS:         return s->effects;
		case STATE_MODEL_INDEX:     return s->modelindex;
		case STATE_BODY:            return s->body;
		case STATE_SKIN:            return s->skin;
	}
	return 0;
}

/** state_set(field, value) - writes a field of the state being sent: what the player sees, not the entity. */
static void w_stateSet(wasm_exec_env_t env, int32_t field, double value)
{
	(void)env;
	entity_state_t *s = g_state;
	if (!s)
		return;
	if (field >= STATE_ORIGIN && field < STATE_ORIGIN + 3) {
		s->origin[field - STATE_ORIGIN] = (float)value;
		return;
	}
	if (field >= STATE_ANGLES && field < STATE_ANGLES + 3) {
		s->angles[field - STATE_ANGLES] = (float)value;
		return;
	}
	int cell = Whole(value);
	switch (field) {
		case STATE_RENDER_MODE:     s->rendermode = cell; break;
		case STATE_RENDER_AMOUNT:   s->renderamt = cell; break;
		case STATE_RENDER_COLOR:    s->rendercolor.r = (byte)cell; break;
		case STATE_RENDER_COLOR + 1: s->rendercolor.g = (byte)cell; break;
		case STATE_RENDER_COLOR + 2: s->rendercolor.b = (byte)cell; break;
		case STATE_RENDER_FX:       s->renderfx = cell; break;
		case STATE_EFFECTS:         s->effects = cell; break;
		case STATE_MODEL_INDEX:     s->modelindex = cell; break;
		case STATE_BODY:            s->body = cell; break;
		case STATE_SKIN:            s->skin = (short)cell; break;
	}
}

/**
 * The game's AddToFullPack, after it: the entity's state the player `host`
 * is sent. The listeners of its class get (host, entity); one that stops it
 * hides the entity from him. Nothing for an entity the game did not send.
 */
static ALIGNED_ENTRY int AddToFullPack_Post(entity_state_t *state, int e, edict_t *ent, edict_t *host, int hostflags, int player, unsigned char *set)
{
	(void)e; (void)hostflags; (void)player; (void)set;
	if (!g_statesHooked || !META_RESULT_ORIG_RET(int) || !ent || !host)
		RETURN_META_VALUE(MRES_IGNORED, 0);

	static const unsigned char roles[2] = { ROLE_EDICT, ROLE_EDICT };
	const char *classname = STRING(ent->v.classname);
	bool hidden = false;
	entity_state_t *outer = g_state;
	g_state = state;
	for (size_t i = 0, end = g_statePoints.size(); i < end; i++) {
		StatePoint &p = g_statePoints[i];
		if (!p.point.attached || (!p.classname.empty() && p.classname != classname))
			continue;
		ChainCall call(p.point, roles, 2);
		call.Edict(0, host);
		call.Edict(1, ent);
		if (!call.Pre())
			hidden = true;
	}
	g_state = outer;
	if (hidden)
		RETURN_META_VALUE(MRES_OVERRIDE, 0);
	RETURN_META_VALUE(MRES_IGNORED, 0);
}
