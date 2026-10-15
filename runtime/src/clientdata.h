// What the server sends a player of himself each frame - the game DLL's
// UpdateClientData, clientdata_t - for game.addEventListener("clientData",
// ...), and a weapon's viewBody: the body its view model is drawn with.
//
// A client with cl_lw 1 predicts his weapon's animations himself, drawn with
// body 0, and the game sends him none of them (SendWeaponAnim skips a player
// the engine's CanSkipPlayer says predicts). While the weapon in his hands
// has a viewBody, the module says he does not - so the game sends every
// animation, with the weapon's pev->body - and writes clientdata_t's
// m_flNextAttack: the seconds until his next attack, which his client counts
// down and runs the weapon's code (and its animations) only at 0 or less.
// His client also replays clientdata_t's weaponanim with a body of its own
// whenever it is not the last animation it played itself, so the module
// holds weaponanim at the deploy's and sends the deploy's again with the body
// once his client has replayed it.
// Both hooks are in Metamod's tables only while a listener or a viewBody
// needs them: a server without either pays nothing.
//
// Included by module.cpp, after entitystate.h.

static HookPoint g_clientDataPoint;
static int g_clientDataHooked = 0;
// The client data the listeners are reading, while they run.
static clientdata_t *g_clientData = NULL;

/** A weapon's viewBody, by its edict: the body, and the edict's serial number when it was set. */
struct ViewBody {
	int serial;
	int body;
};

static std::vector<ViewBody> g_viewBodies;
// The weapons with a viewBody; one removed with it keeps it counted till the map's end.
static int g_viewBodyCount = 0;

/** The weapon with a viewBody in a player's hands as his client data last had it, by his id: its edict and serial, the animation held for his client, and whether its redraw is still to be sent. */
struct HeldAnim {
	int weapon;
	int serial;
	int anim;
	bool redraw;
};

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

/** The viewBody of the weapon in a player's hands, 0 for none; `weapon` gets its edict's index. */
static int ActiveViewBody(const edict_t *player, int *weapon = NULL)
{
	// CBasePlayer::m_pActiveItem's offset, looked up once; -1 when the gamedata has none.
	static int active = -2;
	if (active == -2) {
		TypeDescription type;
		active = g_entityData && g_entityData->GetOffsetByClass("CBasePlayer", "m_pActiveItem", &type) ? type.fieldOffset : -1;
	}
	if (active < 0 || !player || !player->pvPrivateData)
		return 0;
	FindEdicts();
	int index = IndexOfObject(*(void **)((char *)player->pvPrivateData + active));
	if (index <= 0 || index >= (int)g_viewBodies.size())
		return 0;
	const ViewBody &view = g_viewBodies[index];
	const edict_t *edict = (const edict_t *)EdictOf(index);
	if (weapon)
		*weapon = index;
	return view.body && edict && view.serial == edict->serialnumber ? view.body : 0;
}

/**
 * The client data of a player who predicts his weapon (cl_lw 1), while the
 * weapon in his hands has a viewBody: his client runs no weapon code, and
 * weaponanim is held at the animation it last played itself - the deploy's,
 * which it replays once with its own body, the server's draw still in the
 * same packet. The deploy's is sent again with the body on his next client
 * data: like the deploy's own it is reliable, and the netchan sends a
 * reliable only once the last is acknowledged, so it reaches his client
 * after the replay at any ping.
 */
static void HoldWeaponAnim(const edict_t *ent, int sendweapons, clientdata_t *cd)
{
	int id = ENTINDEX((edict_t *)ent);
	if (id < 1 || id >= CLIENT_SLOTS)
		return;
	HeldAnim &held = g_heldAnims[id];
	int weapon = 0;
	int body = sendweapons ? ActiveViewBody(ent, &weapon) : 0;
	if (!body) {
		held.weapon = 0;
		return;
	}
	// The value Pawn plugins write: far beyond any ping, counted down from each frame's.
	cd->m_flNextAttack = gpGlobals->time + 0.001f;
	int serial = g_viewBodies[weapon].serial;
	if (held.weapon != weapon || held.serial != serial) {
		held.weapon = weapon;
		held.serial = serial;
		held.anim = cd->weaponanim;
		held.redraw = true;
	} else if (held.redraw) {
		held.redraw = false;
		MESSAGE_BEGIN(MSG_ONE, SVC_WEAPONANIM, NULL, (edict_t *)ent);
		WRITE_BYTE(held.anim);
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
};

/** client_data_get(field) - a field of the client data being sent, as a number. */
static double w_clientDataGet(wasm_exec_env_t env, int32_t field)
{
	(void)env;
	clientdata_t *cd = g_clientData;
	if (!cd)
		return 0;
	switch (field) {
		case CLIENT_NEXT_ATTACK: return cd->m_flNextAttack;
		case CLIENT_FOV:         return cd->fov;
		case CLIENT_WEAPON_ANIM: return cd->weaponanim;
		case CLIENT_MAX_SPEED:   return cd->maxspeed;
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
	switch (field) {
		case CLIENT_NEXT_ATTACK: cd->m_flNextAttack = (float)value; break;
		case CLIENT_FOV:         cd->fov = (float)value; break;
		case CLIENT_WEAPON_ANIM: cd->weaponanim = Whole(value); break;
		case CLIENT_MAX_SPEED:   cd->maxspeed = (float)value; break;
	}
}

/** view_body_get(weapon) - the weapon's viewBody, 0 for none. */
static int32_t w_viewBodyGet(wasm_exec_env_t env, int32_t weapon)
{
	(void)env;
	const edict_t *edict = (const edict_t *)EdictOf(weapon);
	if (!edict || weapon >= (int32_t)g_viewBodies.size())
		return 0;
	const ViewBody &view = g_viewBodies[weapon];
	return view.serial == edict->serialnumber ? view.body : 0;
}

/** view_body_set(weapon, body) - draws the weapon's view model with `body`, 0 the game's own way; its pev->body too. */
static void w_viewBodySet(wasm_exec_env_t env, int32_t weapon, int32_t body)
{
	(void)env;
	edict_t *edict = (edict_t *)EdictOf(weapon);
	if (!edict || weapon <= 0)
		return;
	if (weapon >= (int32_t)g_viewBodies.size())
		g_viewBodies.resize(g_maxEdicts, ViewBody());
	ViewBody &view = g_viewBodies[weapon];
	g_viewBodyCount += (body != 0) - (view.body != 0);
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

/** The engine's CanSkipPlayer, as the game asks it before an animation it would leave to the client: no, for a viewBody in his hands. */
static ALIGNED_ENTRY qboolean CanSkipPlayer(const edict_t *player)
{
	if (ActiveViewBody(player))
		RETURN_META_VALUE(MRES_SUPERCEDE, 0);
	RETURN_META_VALUE(MRES_IGNORED, 0);
}
