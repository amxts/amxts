// Who walks through whom - player.walksThrough - how a player one walks
// through looks to him close up - server.walkThroughLook - and what else
// passes a partner - server.walkThroughOptions. A pair is one bit both ways,
// and everything for it is done here, with no call into a plugin: these run
// for every pair every frame.
//
// - PM_Move (movement.h) takes the mover's partners out of his physents, so
//   the game moves him through them - all but one he stands on, or who
//   stands on him (standOnHead);
// - AddToFullPack (entitystate.h) sends each partner to him not solid, so his
//   client predicts no collision either, and draws a partner see-through or
//   not at all by the distance, with the weapon model he holds;
// - TraceLine, after the engine: a line a player traces - his aim, so the
//   name under his crosshair, his shots, his +use - goes on through a
//   partner not drawn for him;
// - a grenade in flight passes its thrower's partners (grenades): for the
//   frame's physics the engine's collision groups say so.
//
// A flash's light, an explosion and shots stop at a partner as at anyone.
// While a player is dead or a spectator he passes everyone. Nothing is hooked
// while no pair is set.
//
// Included by module.cpp, before movement.h and entitystate.h, whose PM_Move
// and AddToFullPack call it.

/** A player's partners, a bit by id: g_partners[a] >> b & 1 == g_partners[b] >> a & 1. */
static uint64_t g_partners[CLIENT_SLOTS];
// Players with a partner: while 0, nothing here is hooked.
static int g_walkers = 0;

// The look, per viewer: closer than hide he is not drawn, closer than fade
// he is see-through, `opacity` opaque at the closest and whole at fade. 0: off.
struct WalkLook {
	double fade;
	double opacity;
	double hide;
};
static WalkLook g_walkLooks[CLIENT_SLOTS];

enum WalkLookField { LOOK_FADE = 0, LOOK_OPACITY = 1, LOOK_HIDE = 2 };

// What else passes a partner, for every pair; both on until a plugin says.
enum WalkOption { WALK_GRENADES = 0, WALK_STAND_ON_HEAD = 1 };
static bool g_walkGrenades = true;
static bool g_standOnHead = true;

static void StatesAttach(bool on);
static void GroupsClose();

extern enginefuncs_t *g_pengfuncsTable_Post;
extern DLL_FUNCTIONS *g_pFunctionTable;
extern DLL_FUNCTIONS *g_pFunctionTable_Post;

/** ReSemiclip on the server too, said once when a pair is first set. */
static void SaySemiclipBoth()
{
	static bool said = false;
	if (said || !MF_FindLibrary("resemiclip", LibType_Library))
		return;
	said = true;
	MF_PrintSrvConsole("[amxts] ReSemiclip is on the server too: a pair walks through when either lets it, and ReSemiclip's look is drawn over amxts's for its pairs\n");
}

/** The hooks in or out, as the first player gets a partner and the last loses his. */
static void WalkersAttach(bool on)
{
	StatesAttach(on);
	if (g_pengfuncsTable_Post)
		g_pengfuncsTable_Post->pfnTraceLine = on ? TraceLine_Post : NULL;
	if (on)
		SaySemiclipBoth();
	else
		GroupsClose();
}

/** `id`'s partners `partners`, kept counted in g_walkers. */
static void SetPartners(int id, uint64_t partners)
{
	if ((g_partners[id] != 0) != (partners != 0)) {
		g_walkers += partners ? 1 : -1;
		if (g_walkers == (partners ? 1 : 0))
			WalkersAttach(partners != 0);
	}
	g_partners[id] = partners;
}

static void SetPair(int a, int b, bool on)
{
	uint64_t bitA = 1ull << a, bitB = 1ull << b;
	SetPartners(a, on ? g_partners[a] | bitB : g_partners[a] & ~bitB);
	SetPartners(b, on ? g_partners[b] | bitA : g_partners[b] & ~bitA);
}

/** A slot comes or goes: nobody walks through it. */
static void ResetPartners(int id)
{
	for (int other = 1; other < CLIENT_SLOTS; other++)
		if (g_partners[id] >> other & 1)
			SetPair(id, other, false);
}

/** walk_through(id, other, on) - whether the two walk through each other; other 0 is everyone he has. */
static void w_walkThrough(wasm_exec_env_t env, int32_t id, int32_t other, int32_t on)
{
	(void)env;
	if (!InGame(id))
		return;
	if (other == 0 && !on)
		ResetPartners(id);
	else if (other != id && InGame(other))
		SetPair(id, other, on != 0);
}

/** walk_through_get(id) - his partners, bit id - 1 a player. */
static int32_t w_walkThroughGet(wasm_exec_env_t env, int32_t id)
{
	(void)env;
	return id > 0 && id < CLIENT_SLOTS ? (int32_t)(g_partners[id] >> 1) : 0;
}

/** walk_look(field, value) - a value of the look, for every viewer. */
static void w_walkLook(wasm_exec_env_t env, int32_t field, double value)
{
	(void)env;
	double v = value > 0 ? value : 0;
	for (WalkLook &look : g_walkLooks) {
		switch (field) {
			case LOOK_FADE:    look.fade = v; break;
			case LOOK_OPACITY: look.opacity = v < 1 ? v : 1; break;
			case LOOK_HIDE:    look.hide = v; break;
		}
	}
}

/** walk_look_get(field) - a value of the look. */
static double w_walkLookGet(wasm_exec_env_t env, int32_t field)
{
	(void)env;
	const WalkLook &look = g_walkLooks[0];
	switch (field) {
		case LOOK_FADE:    return look.fade;
		case LOOK_OPACITY: return look.opacity;
		case LOOK_HIDE:    return look.hide;
	}
	return 0;
}

/** walk_option(field, on) - what else passes a partner, for every pair. */
static void w_walkOption(wasm_exec_env_t env, int32_t field, int32_t on)
{
	(void)env;
	switch (field) {
		case WALK_GRENADES:
			g_walkGrenades = on != 0;
			if (!on) GroupsClose();
			break;
		case WALK_STAND_ON_HEAD: g_standOnHead = on != 0; break;
	}
}

/** walk_option_get(field) - whether it passes. */
static int32_t w_walkOptionGet(wasm_exec_env_t env, int32_t field)
{
	(void)env;
	switch (field) {
		case WALK_GRENADES:      return g_walkGrenades;
		case WALK_STAND_ON_HEAD: return g_standOnHead;
	}
	return 0;
}

/** Dead, dying or a spectator: solid to nobody. */
static ALWAYS_INLINE bool Ghost(const edict_t *player)
{
	return player->v.deadflag != DEAD_NO || player->v.iuser1 != 0;
}

/**
 * Whether one of the two is wholly above the other: the one on top stands on
 * him. Two already in each other are not, or they would stick.
 */
static ALWAYS_INLINE bool Stacked(const edict_t *a, const edict_t *b)
{
	return a->v.origin.z + a->v.mins.z >= b->v.origin.z + b->v.maxs.z
		|| b->v.origin.z + b->v.mins.z >= a->v.origin.z + a->v.maxs.z;
}

/** Whether players `a` and `b` walk through each other now. */
static ALWAYS_INLINE bool Passes(int a, int b)
{
	const edict_t *ea = INDEXENT(a), *eb = INDEXENT(b);
	if (Ghost(ea) || Ghost(eb))
		return true;
	return (g_partners[a] >> b & 1) && !(g_standOnHead && Stacked(ea, eb));
}

/** PM_Move, before the game: the mover's partners out of his physents. */
static void WalkThrough(playermove_t *pm)
{
	int mover = pm->player_index + 1;
	if (mover < 1 || mover >= CLIENT_SLOTS || pm->dead || pm->spectator)
		return;
	int kept = 0;
	for (int i = 0; i < pm->numphysent; i++) {
		int other = pm->physents[i].info;
		if (pm->physents[i].player && other > 0 && other < CLIENT_SLOTS && Passes(mover, other))
			continue;
		if (kept != i)
			pm->physents[kept] = pm->physents[i];
		kept++;
	}
	pm->numphysent = kept;
}

/** Whether `other`, a partner of `viewer`, is too close to him to be drawn. */
static ALWAYS_INLINE bool HiddenFrom(int viewer, int other)
{
	const WalkLook &look = g_walkLooks[viewer];
	edict_t *host = INDEXENT(viewer);
	return look.hide && (g_partners[viewer] >> other & 1) && !Ghost(host) && (INDEXENT(other)->v.origin - host->v.origin).Length() < look.hide;
}

/**
 * TraceLine, after the engine: a line a player traced that stopped at a
 * partner not drawn for him is traced again with that partner not solid -
 * the engine's traces pass a SOLID_NOT entity - as many times as it meets
 * one; then they are solid again. Players standing in each other are why it
 * is not traced on from the partner: that line would start in the tracer.
 */
ALIGNED_ENTRY void TraceLine_Post(const float *v1, const float *v2, int noMonsters, edict_t *skip, TraceResult *tr)
{
	int tracer = skip ? ENTINDEX(skip) : 0;
	if (tracer < 1 || tracer >= CLIENT_SLOTS || !g_walkLooks[tracer].hide || !g_partners[tracer])
		RETURN_META(MRES_IGNORED);
	edict_t *passed[CLIENT_SLOTS];
	int solid[CLIENT_SLOTS];
	int count = 0;
	while (count < CLIENT_SLOTS && tr->pHit) {
		int hit = ENTINDEX(tr->pHit);
		if (hit < 1 || hit > gpGlobals->maxClients || !HiddenFrom(tracer, hit))
			break;
		passed[count] = tr->pHit;
		solid[count++] = tr->pHit->v.solid;
		tr->pHit->v.solid = SOLID_NOT;
		TRACE_LINE(v1, v2, noMonsters, skip, tr);
	}
	for (int i = 0; i < count; i++)
		passed[i]->v.solid = solid[i];
	RETURN_META(MRES_IGNORED);
}

/**
 * AddToFullPack, before the entityState listeners: a partner of `host` -
 * or the weapon model a partner holds - sent to him. False: not sent.
 */
static bool WalkThroughState(entity_state_t *state, int e, edict_t *ent, edict_t *host)
{
	int viewer = ENTINDEX(host);
	int other = e;
	if (e > gpGlobals->maxClients) {
		if (ent->v.movetype != MOVETYPE_FOLLOW || !ent->v.aiment)
			return true;
		other = ENTINDEX(ent->v.aiment);
		if (other < 1 || other > gpGlobals->maxClients)
			return true;
	}
	// One he stands on, or who stands on him, is sent solid and whole: his client predicts it.
	if (other == viewer || viewer < 1 || viewer >= CLIENT_SLOTS || !Passes(viewer, other))
		return true;
	if (other == e)
		state->solid = SOLID_NOT;

	const WalkLook &look = g_walkLooks[viewer];
	if ((!look.fade && !look.hide) || !(g_partners[viewer] >> other & 1) || Ghost(host))
		return true;
	float distance = (INDEXENT(other)->v.origin - host->v.origin).Length();
	if (distance < look.hide)
		return false;
	if (distance >= look.fade)
		return true;
	double amount = 255 * (look.opacity + (1 - look.opacity) * distance / look.fade);
	if (state->rendermode == kRenderNormal) {
		state->rendermode = kRenderTransAlpha;
		state->renderamt = Whole(amount);
	}
	else {
		state->renderamt = Whole(state->renderamt * amount / 255);
	}
	return true;
}

// ---------------------------------------------------------------- grenades

// A grenade in flight passes its thrower's partners. The engine moves it in
// SV_Physics, with no call per entity a module can hook, but its traces and
// touches ask the collision groups (groupinfo, GROUP_OP_AND: two entities
// both in groups collide only when they share one). So for the frame's
// physics - from the end of StartFrame to the first entity sent - every
// player is in a group of his own and in one all players share, and a
// grenade in the groups of the players it hits: not its thrower's partners.
// Its think and touch - its sounds, its explosion, a flash's light - run
// out of its groups, as the game's own, and everything is out of them
// before anything is sent: the groups decide what a player is sent too.
//
// Players already in groups are another plugin's: that frame nothing is
// grouped. Ids 1 and 32 share a group (32 bits, one for all): on a 32-slot
// server a grenade passing one of them passes the other.

#define GROUP_PLAYERS (1u << 31)
#define GROUPED_MAX 64

/** A grenade in groups for the frame: its groups, while it is the same entity. */
struct GroupedGrenade {
	edict_t *e;
	int serial;
	int groups;
};

static GroupedGrenade g_grouped[GROUPED_MAX];
static int  g_groupedCount = 0;
static bool g_groupsOn = false;

static void ThinkPostAttach();
void DispatchThink_Post(edict_t *e);
void DispatchTouch_Post(edict_t *touched, edict_t *other);
int AddToFullPack(entity_state_t *state, int e, edict_t *ent, edict_t *host, int hostflags, int player, unsigned char *set);

/** A player's own group. */
static ALWAYS_INLINE int PlayerGroup(int id)
{
	return (int)(1u << ((id - 1) % 31));
}

/** The hooks that take a grenade out of its groups and the frame's groups off, in Metamod's tables while the groups are on. */
static void GroupHooks(bool on)
{
	g_groupsOn = on;
	ThinkPostAttach();
	if (g_pFunctionTable_Post)
		g_pFunctionTable_Post->pfnTouch = on ? DispatchTouch_Post : NULL;
	if (g_pFunctionTable)
		g_pFunctionTable->pfnAddToFullPack = on ? AddToFullPack : NULL;
}

/** The frame's groups off: the players and the grenades out of them. */
static void GroupsClose()
{
	if (!g_groupsOn)
		return;
	for (int i = 0; i < g_groupedCount; i++) {
		const GroupedGrenade &g = g_grouped[i];
		if (!g.e->free && g.e->serialnumber == g.serial)
			g.e->v.groupinfo = 0;
	}
	g_groupedCount = 0;
	// From the edicts themselves: Valve's engine names no edict for an empty slot.
	edict_t *edicts = INDEXENT(0);
	for (int id = 1; id <= gpGlobals->maxClients; id++)
		edicts[id].v.groupinfo = 0;
	GroupHooks(false);
}

/** End of StartFrame: the grenades thrown by a player with partners, and the players, into groups for the frame's physics. */
static void GroupsOpen()
{
	GroupsClose();
	if (!g_walkers || !g_walkGrenades)
		return;
	int maxClients = gpGlobals->maxClients;
	edict_t *edicts = INDEXENT(0);
	for (int id = 1; id <= maxClients; id++)
		if (edicts[id].v.groupinfo)
			return;
	for (int i = maxClients + 1; i < gpGlobals->maxEntities && g_groupedCount < GROUPED_MAX; i++) {
		edict_t *e = &edicts[i];
		if (e->free || e->v.movetype != MOVETYPE_BOUNCE || !e->v.owner || e->v.groupinfo)
			continue;
		int thrower = ENTINDEX(e->v.owner);
		if (thrower < 1 || thrower > maxClients || !g_partners[thrower])
			continue;
		int groups = 0;
		for (int id = 1; id <= maxClients; id++)
			if (id != thrower && !(g_partners[thrower] >> id & 1))
				groups |= PlayerGroup(id);
		// Everyone else a partner: a group nobody else is in, the thrower's, whom it passes anyway.
		if (!groups)
			groups = PlayerGroup(thrower);
		e->v.groupinfo = groups;
		g_grouped[g_groupedCount++] = { e, e->serialnumber, groups };
	}
	if (!g_groupedCount)
		return;
	for (int id = 1; id <= maxClients; id++)
		edicts[id].v.groupinfo = (int)GROUP_PLAYERS | PlayerGroup(id);
	GroupHooks(true);
}

/** The grouped grenade `e` is, or null. */
static GroupedGrenade *Grouped(const edict_t *e)
{
	for (int i = 0; i < g_groupedCount; i++)
		if (g_grouped[i].e == e)
			return &g_grouped[i];
	return NULL;
}

/** Before a think or a touch: a grouped grenade out of its groups, so what it does is the game's own. */
static void GroupsAside(edict_t *e)
{
	if (g_groupsOn && Grouped(e))
		e->v.groupinfo = 0;
}

/** After it: back into them, for the rest of its move. */
static void GroupsBack(edict_t *e)
{
	GroupedGrenade *g = g_groupsOn ? Grouped(e) : NULL;
	if (g && !e->free && e->serialnumber == g->serial && !(e->v.flags & FL_KILLME))
		e->v.groupinfo = g->groups;
}

/**
 * The think after it, in Metamod's table while a temporary entity's source
 * is kept (enginehooks.h) or the groups are on: the think done, and a
 * grenade back into its groups.
 */
static void ThinkPostAttach()
{
	if (g_pFunctionTable_Post)
		g_pFunctionTable_Post->pfnThink = g_sourcesHooked || g_groupsOn ? DispatchThink_Post : NULL;
}

void DispatchThink_Post(edict_t *e)
{
	if (g_sourcesHooked && g_thinks > 0)
		g_thinks--;
	GroupsBack(e);
	RETURN_META(MRES_IGNORED);
}

/** The game's AddToFullPack, before it, while the groups are on: the first entity sent ends the frame's physics. */
int AddToFullPack(entity_state_t *state, int e, edict_t *ent, edict_t *host, int hostflags, int player, unsigned char *set)
{
	(void)state; (void)e; (void)ent; (void)host; (void)hostflags; (void)player; (void)set;
	GroupsClose();
	RETURN_META_VALUE(MRES_IGNORED, 0);
}

void DispatchTouch_Post(edict_t *touched, edict_t *other)
{
	GroupsBack(touched);
	GroupsBack(other);
	RETURN_META(MRES_IGNORED);
}
