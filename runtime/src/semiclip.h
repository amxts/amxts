// Who walks through whom - player.walksThrough - and how a player one walks
// through looks to him close up - server.walkThroughLook. A pair is one bit
// both ways, and everything for it is done here, with no call into a plugin:
// these run for every pair every frame.
//
// - PM_Move (movement.h) takes the mover's partners out of his physents, so
//   the game moves him through them;
// - AddToFullPack (entitystate.h) sends each partner to him not solid, so his
//   client predicts no collision either, and draws a partner see-through or
//   not at all by the distance, with the weapon model he holds;
// - TraceLine, after the engine: a line a player traces - his aim, so the
//   name under his crosshair, his shots, his +use - goes on through a
//   partner not drawn for him;
// - ReGameDLL's RadiusFlash_TraceLine lets a flash's line through a partner
//   of the player it blinds. Without ReGameDLL a partner still blocks it.
//
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

static void StatesAttach(bool on);
static void FlashLine(re::IHookChain<void, void *, entvars_t *, entvars_t *, Vector &, Vector &, void *> *chain, void *player, entvars_t *inflictor, entvars_t *attacker, Vector &start, Vector &end, void *trace);

typedef re::IHookChainRegistry<void, void *, entvars_t *, entvars_t *, Vector &, Vector &, void *> FlashLineChain;

extern enginefuncs_t *g_pengfuncsTable_Post;

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
	if (g_regameChains) {
		FlashLineChain *chain = (FlashLineChain *)g_regameChains->RadiusFlash_TraceLine();
		if (on) chain->registerHook(FlashLine, CHAIN_PRIORITY);
		else chain->unregisterHook(FlashLine);
	}
	if (on)
		SaySemiclipBoth();
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

/** Dead, dying or a spectator: solid to nobody. */
static ALWAYS_INLINE bool Ghost(const edict_t *player)
{
	return player->v.deadflag != DEAD_NO || player->v.iuser1 != 0;
}

/** Whether players `a` and `b` walk through each other now. */
static ALWAYS_INLINE bool Passes(int a, int b)
{
	return (g_partners[a] >> b & 1) || Ghost(INDEXENT(a)) || Ghost(INDEXENT(b));
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

/**
 * ReGameDLL's RadiusFlash_TraceLine: the line from a flash to the eyes of
 * `player`. One that stops at a partner of his goes on from the partner.
 */
static void FlashLine(re::IHookChain<void, void *, entvars_t *, entvars_t *, Vector &, Vector &, void *> *chain, void *player, entvars_t *inflictor, entvars_t *attacker, Vector &start, Vector &end, void *trace)
{
	chain->callNext(player, inflictor, attacker, start, end, trace);
	int blinded = CellOfCbase(player);
	TraceResult *tr = (TraceResult *)trace;
	for (int i = 0; i < gpGlobals->maxClients && tr->pHit; i++) {
		int hit = ENTINDEX(tr->pHit);
		if (hit < 1 || hit > gpGlobals->maxClients || blinded < 1 || !(g_partners[blinded] >> hit & 1))
			break;
		Vector eyes = tr->pHit->v.origin + tr->pHit->v.view_ofs;
		TRACE_LINE(eyes, end, 0, tr->pHit, tr);
	}
}
