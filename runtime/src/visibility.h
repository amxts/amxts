// Where a player sees from - the game DLL's SetupVisibility, which sets his
// PVS and PAS each frame - for game.addEventListener("visibility", ...). The
// engine sends him the entities the PVS lets through (AddToFullPack is asked
// only of those). A listener that writes the origin moves both sets for that
// frame: the module sets them again from it after the listeners, as the game
// does from the eyes. A listener that adds a point has him sent what is seen
// from it too: the sets become the union of each point's. The hook is in
// Metamod's table only while a listener exists: a server without one pays
// nothing.
//
// Included by module.cpp, after clientdata.h.

static HookPoint g_visibilityPoint;
static int g_visibilityHooked = 0;
// The player the listeners are about, while they run, his view entity, the
// origin one wrote and whether one did.
static edict_t *g_visibilityClient = NULL;
static edict_t *g_visibilityView = NULL;
static float g_visibilityOrigin[3];
static bool g_visibilityMoved = false;
// The points the listeners added, a bound that keeps the work per client per
// frame small: each is two walks of the map's tree and two ORs of a set.
#define VISIBILITY_POINTS 15
static float g_visibilityPoints[VISIBILITY_POINTS][3];
// How many points the listeners asked to add, past the bound too.
static int g_visibilityAdds = 0;
// A set is a bit per leaf of the map; the engine's own buffers are this size
// (MAX_MAP_LEAFS / 8), and it reads only the bits of the map's leaves.
#define VISIBILITY_BYTES 1024
static unsigned char g_visibilityPvs[VISIBILITY_BYTES];
static unsigned char g_visibilityPas[VISIBILITY_BYTES];

static void SetupVisibility_Post(edict_t *view, edict_t *client, unsigned char **pvs, unsigned char **pas);

static void VisibilityAttach(bool on)
{
	g_visibilityHooked += on ? 1 : -1;
	if (g_pFunctionTable_Post)
		g_pFunctionTable_Post->pfnSetupVisibility = g_visibilityHooked > 0 ? SetupVisibility_Post : NULL;
}

/** visibility_hook(handler) - a handler of each player's visibility. */
static int32_t w_visibilityHook(wasm_exec_env_t env, int32_t fn)
{
	(void)env;
	g_visibilityPoint.attach = VisibilityAttach;
	return AddOtherHook(g_visibilityPoint, fn, 0);
}

/**
 * The point the game set the player's sets from, as Counter-Strike's
 * SetupVisibility finds it: the eyes of the player he watches as a
 * spectator, else of his view entity, else his own - lower for a crouch.
 */
static void VisibilityEyes(float *origin)
{
	edict_t *client = g_visibilityClient;
	edict_t *view = g_visibilityView ? g_visibilityView : client;
	if (client->v.iuser1 && client->v.iuser2 > 0 && client->v.iuser2 < CLIENT_SLOTS) {
		edict_t *target = (edict_t *)EdictOf(client->v.iuser2);
		if (target)
			view = target;
	}
	for (int i = 0; i < 3; i++)
		origin[i] = view->v.origin[i] + view->v.view_ofs[i];
	// VEC_HULL_MIN - VEC_DUCK_HULL_MIN.
	if (view->v.flags & FL_DUCKING)
		origin[2] -= 18;
}

/** visibility_get(axis) - x, y or z of the point the player sees from. */
static double w_visibilityGet(wasm_exec_env_t env, int32_t axis)
{
	(void)env;
	if (!g_visibilityClient || axis < 0 || axis > 2)
		return 0;
	if (g_visibilityMoved)
		return g_visibilityOrigin[axis];
	float eyes[3];
	VisibilityEyes(eyes);
	return eyes[axis];
}

/** visibility_set(axis, value) - moves the point the player sees from; the sets follow after the listeners. */
static void w_visibilitySet(wasm_exec_env_t env, int32_t axis, double value)
{
	(void)env;
	if (!g_visibilityClient || axis < 0 || axis > 2)
		return;
	if (!g_visibilityMoved) {
		VisibilityEyes(g_visibilityOrigin);
		g_visibilityMoved = true;
	}
	g_visibilityOrigin[axis] = (float)value;
}

/**
 * visibility_add(axis, value) - x, y or z of one more point the player sees
 * from, x first: x adds the point. Past the bound it is left out.
 */
static void w_visibilityAdd(wasm_exec_env_t env, int32_t axis, double value)
{
	(void)env;
	if (!g_visibilityClient || axis < 0 || axis > 2)
		return;
	if (axis == 0)
		g_visibilityAdds++;
	if (g_visibilityAdds > 0 && g_visibilityAdds <= VISIBILITY_POINTS)
		g_visibilityPoints[g_visibilityAdds - 1][axis] = (float)value;
}

/**
 * `set` joined with the set of each added point, in `joined`. The engine
 * computes a set into one buffer of its own, reused by the next call, so
 * `set` is copied before the first. A NULL set lets everything through already.
 */
static unsigned char *VisibilityJoin(unsigned char *set, unsigned char *joined, unsigned char *(*of)(float *origin))
{
	if (!set)
		return NULL;
	memcpy(joined, set, VISIBILITY_BYTES);
	int added = g_visibilityAdds < VISIBILITY_POINTS ? g_visibilityAdds : VISIBILITY_POINTS;
	for (int p = 0; p < added; p++) {
		const unsigned char *more = of(g_visibilityPoints[p]);
		for (int i = 0; i < VISIBILITY_BYTES; i++)
			joined[i] |= more[i];
	}
	return joined;
}

/**
 * The game DLL's SetupVisibility, after it: the listeners get (player), and
 * an origin one wrote sets his PVS and PAS again from there, a point one
 * added joins its sets to them. The engine
 * filters by them right after, for this frame only.
 */
static ALIGNED_ENTRY void SetupVisibility_Post(edict_t *view, edict_t *client, unsigned char **pvs, unsigned char **pas)
{
	if (!client || !pvs || !pas || !g_visibilityHooked || !g_visibilityPoint.attached)
		RETURN_META(MRES_IGNORED);
	static const unsigned char roles[1] = { ROLE_EDICT };
	g_visibilityClient = client;
	g_visibilityView = view;
	g_visibilityMoved = false;
	g_visibilityAdds = 0;
	{
		ChainCall call(g_visibilityPoint, roles, 1);
		call.Edict(0, client);
		call.Pre();
	}
	g_visibilityClient = NULL;
	if (g_visibilityMoved) {
		*pvs = ENGINE_SET_PVS(g_visibilityOrigin);
		*pas = ENGINE_SET_PAS(g_visibilityOrigin);
	}
	if (g_visibilityAdds) {
		*pvs = VisibilityJoin(*pvs, g_visibilityPvs, g_engfuncs.pfnSetFatPVS);
		*pas = VisibilityJoin(*pas, g_visibilityPas, g_engfuncs.pfnSetFatPAS);
	}
	RETURN_META(MRES_IGNORED);
}
