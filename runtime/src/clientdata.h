// What the server sends a player of himself each frame - the game DLL's
// UpdateClientData, clientdata_t - for game.addEventListener("clientData",
// ...), and a weapon's viewBody: the body its view model is drawn with.
// Writing it holds the weapon (0 is a body too); the module lets it go and
// forgets the value when the weapon leaves its holder's hands.
//
// A client with cl_lw 1 predicts his weapon's animations himself, drawn with
// body 0, and the game sends him none of them (SendWeaponAnim skips a player
// the engine's CanSkipPlayer says predicts). Once his client data has had a
// weapon with a viewBody in his hands, the module says he does not - so the
// game sends every animation, with the weapon's pev->body - and writes
// clientdata_t's m_flNextAttack: the seconds until his next attack, which his client counts
// down and runs the weapon's code (and its animations) only at 0 or less.
// His client also replays clientdata_t's weaponanim with a body of its own
// whenever it is not the last animation it played itself, so the module
// holds weaponanim at the deploy's and sends the deploy's again with the body
// once his client has replayed it.
// A spectator watching a player through his eyes is sent that player's
// client data, and his client replays the weaponanim in it the same way; the
// game's animations go to the player alone. For a viewBody in the watched
// player's hands the spectator's weaponanim is held the same way, and each
// animation the game plays of it is sent him with the body.
// Both hooks are in Metamod's tables only while a listener or a viewBody
// needs them: a server without either pays nothing.
//
// Included by module.cpp, after entitystate.h.

static HookPoint g_clientDataPoint;
static int g_clientDataHooked = 0;
// The client data the listeners are reading, while they run.
static clientdata_t *g_clientData = NULL;

/**
 * A weapon's viewBody, by its edict: whether one is set (0 is a body, so it is
 * kept apart from the body), the body, and the edict's serial number when it
 * was set.
 */
struct ViewBody {
	bool set;
	int serial;
	int body;
};

static std::vector<ViewBody> g_viewBodies;
// The weapons with a viewBody set; one removed with it still set keeps it counted till the map's end.
static int g_viewBodyCount = 0;

/**
 * The weapon with a viewBody his client data last had - in his hands, or in
 * the hands of the player he watches in-eye - by his id: its edict and
 * serial, whether it is in his own hands, the animation held for his client,
 * and whether its redraw is still to be sent. `played` counts the animations the game has played of a
 * viewBody weapon in his own hands; `relayed` and `relayedAnim` are the
 * watched player's count and weaponanim last sent to him.
 */
struct HeldAnim {
	int weapon;
	int serial;
	bool own;
	int anim;
	bool redraw;
	int played;
	int relayed;
	int relayedAnim;
};

// pev->iuser1 of a spectator watching through the eyes of the player in pev->iuser2.
static const int OBS_IN_EYE = 4;

static HeldAnim g_heldAnims[CLIENT_SLOTS];

static void UpdateClientData_Post(const edict_t *ent, int sendweapons, clientdata_t *cd);
static qboolean CanSkipPlayer(const edict_t *player);

static void ClientDataHooks()
{
	if (g_pFunctionTable_Post)
		g_pFunctionTable_Post->pfnUpdateClientData = g_clientDataHooked > 0 || g_viewBodyCount > 0 ? UpdateClientData_Post : NULL;
	if (g_pengfuncsTable)
		g_pengfuncsTable->pfnCanSkipPlayer = g_viewBodyCount > 0 ? CanSkipPlayer : NULL;
	// Out of the table they are not watched: a weapon in his hands then is a new one.
	if (!g_viewBodyCount)
		memset(g_heldAnims, 0, sizeof(g_heldAnims));
}

static void ClientDataAttach(bool on)
{
	g_clientDataHooked += on ? 1 : -1;
	ClientDataHooks();
}

/** The weapons' viewBody let go with the map's entities. */
static void ForgetViewBodies()
{
	g_viewBodies.clear();
	g_viewBodyCount = 0;
	ClientDataHooks();
}

/** Let a weapon's viewBody go: it has left its holder's hands. */
static void ReleaseViewBody(int weapon)
{
	if (weapon <= 0 || weapon >= (int)g_viewBodies.size())
		return;
	ViewBody &view = g_viewBodies[weapon];
	if (!view.set)
		return;
	view.set = false;
	view.body = 0;
	edict_t *edict = (edict_t *)EdictOf(weapon);
	if (edict && view.serial == edict->serialnumber)
		edict->v.body = 0;
	g_viewBodyCount--;
	ClientDataHooks();
}

/**
 * Whether the weapon in a player's hands has a viewBody set (0 is a body too),
 * drawn with its own `body`; `weapon` gets its edict's index.
 */
static bool ActiveViewBody(const edict_t *player, int *weapon = NULL, int *body = NULL)
{
	// CBasePlayer::m_pActiveItem's offset, looked up once; -1 when the gamedata has none.
	static int active = -2;
	if (active == -2) {
		TypeDescription type;
		active = g_entityData && g_entityData->GetOffsetByClass("CBasePlayer", "m_pActiveItem", &type) ? type.fieldOffset : -1;
	}
	if (active < 0 || !player || !player->pvPrivateData)
		return false;
	FindEdicts();
	int index = IndexOfObject(*(void **)((char *)player->pvPrivateData + active));
	if (index <= 0 || index >= (int)g_viewBodies.size())
		return false;
	const ViewBody &view = g_viewBodies[index];
	const edict_t *edict = (const edict_t *)EdictOf(index);
	if (!view.set || !edict || view.serial != edict->serialnumber)
		return false;
	if (weapon)
		*weapon = index;
	if (body)
		*body = view.body;
	return true;
}

/**
 * The client data of a player who predicts his weapon (cl_lw 1), while the
 * weapon in his hands has a viewBody: his client runs no weapon code, and
 * weaponanim is held at the animation it last played itself - the deploy's,
 * which it replays once with its own body. The game left the deploy's draw
 * to his client; it is sent with the body in the packet of the replay, and
 * again on his next client data: both are reliable, and the netchan sends a
 * reliable only once the last is acknowledged, so the second reaches his
 * client after the replay at any ping.
 * An in-eye spectator is held at the watched player's weapon the same way,
 * and sent each of its animations the game has played since his last client
 * data - the game's own go to the player alone.
 */
static void HoldWeaponAnim(const edict_t *ent, int sendweapons, clientdata_t *cd)
{
	int id = ENTINDEX((edict_t *)ent);
	if (id < 1 || id >= CLIENT_SLOTS)
		return;
	HeldAnim &held = g_heldAnims[id];
	int holder = ent->v.iuser1 == OBS_IN_EYE ? ent->v.iuser2 : id;
	if (holder < 1 || holder >= CLIENT_SLOTS)
		holder = 0;
	int weapon = 0;
	int body = 0;
	bool hold = sendweapons && holder && ActiveViewBody((const edict_t *)EdictOf(holder), &weapon, &body);
	// His own hands: a viewBody weapon that is no longer the one in them is let
	// go - holstered, dropped, taken away - so it carries no body to its next
	// holder. The watched player's weapon is let go only when he himself is
	// sent: a spectator who joins the game leaves it in its holder's hands.
	if (held.own && held.weapon != weapon)
		ReleaseViewBody(held.weapon);
	if (!hold) {
		held.weapon = 0;
		return;
	}
	// The value Pawn plugins write: far beyond any ping, counted down from each frame's.
	cd->m_flNextAttack = gpGlobals->time + 0.001f;
	int serial = g_viewBodies[weapon].serial;
	bool first = held.weapon != weapon || held.serial != serial;
	int played = g_heldAnims[holder].played;
	if (first) {
		held.weapon = weapon;
		held.serial = serial;
		held.own = holder == id;
		held.anim = cd->weaponanim;
		held.relayed = played;
		held.relayedAnim = cd->weaponanim;
	}
	// The watched player's animations since his last client data: the last of them is the weaponanim.
	bool relay = holder != id && (held.relayed != played || held.relayedAnim != cd->weaponanim);
	if (relay) {
		held.relayed = played;
		held.relayedAnim = cd->weaponanim;
	}
	if (first || held.redraw || relay) {
		held.redraw = first;
		MESSAGE_BEGIN(MSG_ONE, SVC_WEAPONANIM, NULL, (edict_t *)ent);
		WRITE_BYTE(relay ? held.relayedAnim : held.anim);
		WRITE_BYTE(body);
		MESSAGE_END();
	}
	cd->weaponanim = held.anim;
}

/** client_data_hook(handler) - a handler of each player's client data. */
static int32_t w_clientDataHook(wasm_exec_env_t env, int32_t fn)
{
	(void)env;
	g_clientDataPoint.attach = ClientDataAttach;
	return AddOtherHook(g_clientDataPoint, fn, 0);
}

// The fields client_data_get and client_data_set read and write, by number.
enum ClientDataField {
	CLIENT_NEXT_ATTACK = 0,
	CLIENT_FOV = 1,
	CLIENT_WEAPON_ANIM = 2,
	CLIENT_MAX_SPEED = 3,
	CLIENT_VELOCITY = 4,     // 4..6
	CLIENT_PUNCH_ANGLE = 7,  // 7..9
	CLIENT_VIEW_OFFSET = 10, // 10..12
	CLIENT_ORIGIN = 13,      // 13..15
	CLIENT_FLAGS = 16,
};

/** The vector a client data field number falls in, NULL for another field; `axis` gets its x, y or z. */
static float *ClientDataVector(clientdata_t *cd, int32_t field, int *axis)
{
	float *vectors[4] = { cd->velocity, cd->punchangle, cd->view_ofs, cd->origin };
	int i = field - CLIENT_VELOCITY;
	if (i < 0 || i >= 12)
		return NULL;
	*axis = i % 3;
	return vectors[i / 3];
}

/** client_data_get(field) - a field of the client data being sent, as a number. */
static double w_clientDataGet(wasm_exec_env_t env, int32_t field)
{
	(void)env;
	clientdata_t *cd = g_clientData;
	if (!cd)
		return 0;
	int axis;
	if (float *vector = ClientDataVector(cd, field, &axis))
		return vector[axis];
	switch (field) {
		case CLIENT_NEXT_ATTACK: return cd->m_flNextAttack;
		case CLIENT_FOV:         return cd->fov;
		case CLIENT_WEAPON_ANIM: return cd->weaponanim;
		case CLIENT_MAX_SPEED:   return cd->maxspeed;
		case CLIENT_FLAGS:       return cd->flags;
	}
	return 0;
}

/** client_data_set(field, value) - writes a field of the client data being sent: what the client has, not the player. */
static void w_clientDataSet(wasm_exec_env_t env, int32_t field, double value)
{
	(void)env;
	clientdata_t *cd = g_clientData;
	if (!cd)
		return;
	int axis;
	if (float *vector = ClientDataVector(cd, field, &axis)) {
		vector[axis] = (float)value;
		return;
	}
	switch (field) {
		case CLIENT_NEXT_ATTACK: cd->m_flNextAttack = (float)value; break;
		case CLIENT_FOV:         cd->fov = (float)value; break;
		case CLIENT_WEAPON_ANIM: cd->weaponanim = Whole(value); break;
		case CLIENT_MAX_SPEED:   cd->maxspeed = (float)value; break;
		case CLIENT_FLAGS:       cd->flags = Whole(value); break;
	}
}

/** view_body_get(weapon) - the weapon's viewBody, 0 when none is set. */
static int32_t w_viewBodyGet(wasm_exec_env_t env, int32_t weapon)
{
	(void)env;
	const edict_t *edict = (const edict_t *)EdictOf(weapon);
	if (!edict || weapon >= (int32_t)g_viewBodies.size())
		return 0;
	const ViewBody &view = g_viewBodies[weapon];
	return view.set && view.serial == edict->serialnumber ? view.body : 0;
}

/** view_body_set(weapon, body) - holds the weapon's view model at `body` (0 a body too) in its holder's hands; its pev->body too. */
static void w_viewBodySet(wasm_exec_env_t env, int32_t weapon, int32_t body)
{
	(void)env;
	edict_t *edict = (edict_t *)EdictOf(weapon);
	if (!edict || weapon <= 0)
		return;
	if (weapon >= (int32_t)g_viewBodies.size())
		g_viewBodies.resize(g_maxEdicts, ViewBody());
	ViewBody &view = g_viewBodies[weapon];
	g_viewBodyCount += !view.set;
	view.set = true;
	view.serial = edict->serialnumber;
	view.body = body;
	edict->v.body = body;
	ClientDataHooks();
}

/**
 * The game DLL's UpdateClientData, after it: what `ent` is sent of himself.
 * A viewBody in his hands keeps his client from running the weapon and in
 * step with it; then the listeners get (player), the client data read and
 * written.
 */
static ALIGNED_ENTRY void UpdateClientData_Post(const edict_t *ent, int sendweapons, clientdata_t *cd)
{
	if (!ent || !cd)
		RETURN_META(MRES_IGNORED);
	if (g_viewBodyCount)
		HoldWeaponAnim(ent, sendweapons, cd);
	if (g_clientDataHooked && g_clientDataPoint.attached) {
		static const unsigned char roles[1] = { ROLE_EDICT };
		clientdata_t *outer = g_clientData;
		g_clientData = cd;
		{
			ChainCall call(g_clientDataPoint, roles, 1);
			call.Edict(0, ent);
			call.Pre();
		}
		g_clientData = outer;
	}
	RETURN_META(MRES_IGNORED);
}

/**
 * The engine's CanSkipPlayer, as the game asks it before an animation it
 * would leave to the client: no, for a viewBody in his hands his client data
 * has had. A deploy's own draw is left to his client: on spawn the knife and
 * the pistol are deployed in one frame, and the knife's draw would play on
 * the pistol; the redraw sends it with the body if the weapon is still his.
 * Each animation asked about is counted for his in-eye spectators, whatever
 * the answer: a bot's, too.
 */
static ALIGNED_ENTRY qboolean CanSkipPlayer(const edict_t *player)
{
	int weapon = 0;
	int id = ENTINDEX((edict_t *)player);
	if (id >= 1 && id < CLIENT_SLOTS && ActiveViewBody(player, &weapon)) {
		HeldAnim &held = g_heldAnims[id];
		held.played++;
		if (held.weapon == weapon && held.serial == g_viewBodies[weapon].serial)
			RETURN_META_VALUE(MRES_SUPERCEDE, 0);
	}
	RETURN_META_VALUE(MRES_IGNORED, 0);
}
