// A player's own movement variables - player.movement: the server moves him
// by them, and his client is sent them to predict his move by.
//
// The engine moves every player by one set, its movevars, which it fills
// from the sv_* cvars each frame and sends every client when they change
// (svc_newmovevars). For a player of his own, PM_Move puts his values into
// that set for his move and takes them back after it, on any server; and
// his client gets the set with his values - when they are set, and the
// frame after the server's changed, past the engine's own message to
// everyone.
//
// Included by module.cpp, after the client helpers and the engine's hooks.

#include <cmath>
#include <cstddef>
#include <pm_movevars.h>

#define SVC_NEWMOVEVARS 44 // the engine's, which the SDK's util.h leaves out

/** A movement variable a player can have his own of: its place in the set, and the cvar the server's comes from. */
struct MovementField {
	size_t offset;
	const char *cvar;
};

// In player.movement's order (as/facade.ts's MOVEMENT_FIELDS).
static const MovementField g_movementFields[] = {
	{ offsetof(movevars_t, accelerate), "sv_accelerate" },
	{ offsetof(movevars_t, airaccelerate), "sv_airaccelerate" },
	{ offsetof(movevars_t, wateraccelerate), "sv_wateraccelerate" },
	{ offsetof(movevars_t, friction), "sv_friction" },
	{ offsetof(movevars_t, edgefriction), "edgefriction" },
	{ offsetof(movevars_t, waterfriction), "sv_waterfriction" },
	{ offsetof(movevars_t, stopspeed), "sv_stopspeed" },
	{ offsetof(movevars_t, stepsize), "sv_stepsize" },
};
#define MOVEMENT_FIELDS (int)(sizeof(g_movementFields) / sizeof(g_movementFields[0]))

static float &MovementIn(movevars_t *vars, int field)
{
	return *(float *)((char *)vars + g_movementFields[field].offset);
}

// All zero is a player of the server's set: a slot nobody has set.
struct Movement {
	float own[MOVEMENT_FIELDS];
	unsigned mine; // a bit a field: his own value, not the server's
	int sendIn;    // frames until his set goes to his client; 0: none waiting
};

static Movement g_movement[CLIENT_SLOTS];
// Players with a field of their own: while 0, PM_Move does nothing else.
static int g_movementOwners;
// A player's set waits to go.
static bool g_movementSending;
// The engine's movevars, from PM_Move once a player has his own.
static movevars_t *g_movevars;
// The server's set as last seen at a frame's start.
static movevars_t g_serverMovevars;
// The server's values of the player PM_Move is moving now, while his are in the set.
static float g_movementSaved[MOVEMENT_FIELDS];
static bool g_movementSwapped;

/** His fields of his own: `mine`, kept counted in g_movementOwners. */
static void OwnMovement(int id, unsigned mine)
{
	Movement &m = g_movement[id];
	if ((m.mine != 0) != (mine != 0))
		g_movementOwners += mine ? 1 : -1;
	m.mine = mine;
}

/** As he is put in the server: a client starts with the server's set, which the engine sent him as he connected. */
static void ResetMovement(int id)
{
	OwnMovement(id, 0);
	g_movement[id].sendIn = 0;
}

/** player_movement(id, field, value) - his own value of the field; NaN gives him the server's. */
static void w_playerMovement(wasm_exec_env_t env, int32_t id, int32_t field, double value)
{
	(void)env;
	if (!InGame(id) || field < 0 || field >= MOVEMENT_FIELDS)
		return;
	Movement &m = g_movement[id];
	m.own[field] = (float)value;
	unsigned bit = 1u << field;
	OwnMovement(id, std::isnan(value) ? m.mine & ~bit : m.mine | bit);
	m.sendIn = 1;
	g_movementSending = true;
}

/** player_movement_get(id, field) - his value of the field: his own, else the server's. */
static double w_playerMovementGet(wasm_exec_env_t env, int32_t id, int32_t field)
{
	(void)env;
	if (field < 0 || field >= MOVEMENT_FIELDS)
		return 0;
	if (InGame(id) && (g_movement[id].mine & (1u << field)))
		return g_movement[id].own[field];
	return CVAR_GET_FLOAT(g_movementFields[field].cvar);
}

static int FloatBits(float value)
{
	int bits;
	memcpy(&bits, &value, sizeof(bits));
	return bits;
}

/** The set his client predicts by: the server's, with his own values. */
static void SendMovement(int id)
{
	movevars_t vars = *g_movevars;
	for (int i = 0; i < MOVEMENT_FIELDS; i++)
		if (g_movement[id].mine & (1u << i))
			MovementIn(&vars, i) = g_movement[id].own[i];

	// SV_WriteMovevarsToClient's order: a float goes as its four bytes.
	const float before[] = {
		vars.gravity, vars.stopspeed, vars.maxspeed, vars.spectatormaxspeed, vars.accelerate,
		vars.airaccelerate, vars.wateraccelerate, vars.friction, vars.edgefriction, vars.waterfriction,
		vars.entgravity, vars.bounce, vars.stepsize, vars.maxvelocity, vars.zmax, vars.waveHeight,
	};
	const float after[] = {
		vars.rollangle, vars.rollspeed, vars.skycolor_r, vars.skycolor_g, vars.skycolor_b,
		vars.skyvec_x, vars.skyvec_y, vars.skyvec_z,
	};
	MESSAGE_BEGIN(MSG_ONE, SVC_NEWMOVEVARS, NULL, INDEXENT(id));
	for (float value : before)
		WRITE_LONG(FloatBits(value));
	WRITE_BYTE(vars.footsteps != 0);
	for (float value : after)
		WRITE_LONG(FloatBits(value));
	WRITE_STRING(vars.skyName);
	MESSAGE_END();
}

/**
 * Each frame, from StartFrame: the sets that wait go out. A change of the
 * server's set seen here the engine sends everyone at this frame's end, so
 * the players of their own get theirs the next frame, after it.
 */
static void MovementFrame()
{
	if (!g_movevars || (!g_movementOwners && !g_movementSending))
		return;

	bool changed = memcmp(&g_serverMovevars, g_movevars, sizeof(movevars_t)) != 0;
	if (changed)
		g_serverMovevars = *g_movevars;

	g_movementSending = false;
	for (int id = 1; id <= gpGlobals->maxClients; id++) {
		Movement &m = g_movement[id];
		if (changed && m.mine)
			m.sendIn = 2;
		if (m.sendIn == 0)
			continue;
		if (--m.sendIn > 0) {
			g_movementSending = true;
			continue;
		}
		if (InGame(id) && !(INDEXENT(id)->v.flags & FL_FAKECLIENT))
			SendMovement(id);
	}
}

/**
 * The move event's listeners without ReGameDLL (STOCK_PM_MOVE), the player's
 * index: false when one before the game blocked his move.
 */
static bool MoveHeard(playermove_t *pm, int post)
{
	if (!StockHeard(STOCK_PM_MOVE, post))
		return true;
	static const unsigned char roles[1] = { ROLE_INT };
	g_pmoveHeard = pm;
	ChainCall call(g_stockPoints[STOCK_PM_MOVE], roles, 1);
	call.Int(0, pm->player_index + 1);
	bool moves = true;
	if (post)
		call.Post();
	else
		moves = call.Pre();
	g_pmoveHeard = NULL;
	return moves;
}

/**
 * The game's PM_Move: a player of his own moves by his set, and the move
 * event is heard here on a server without ReGameDLL, whose own chain hears
 * it otherwise. Nothing else while neither is wanted.
 */
void PM_Move(playermove_t *pm, int server)
{
	(void)server;
	if (!g_movementOwners && !g_stocksHooked[STOCK_PM_MOVE])
		RETURN_META(MRES_IGNORED);

	int id = pm->player_index + 1;
	if (g_movementOwners)
		g_movevars = pm->movevars;
	if (g_movementOwners && id >= 1 && id < CLIENT_SLOTS && g_movement[id].mine) {
		for (int i = 0; i < MOVEMENT_FIELDS; i++) {
			float &value = MovementIn(pm->movevars, i);
			g_movementSaved[i] = value;
			if (g_movement[id].mine & (1u << i))
				value = g_movement[id].own[i];
		}
		g_movementSwapped = true;
	}
	RETURN_META(MoveHeard(pm, 0) ? MRES_IGNORED : MRES_SUPERCEDE);
}

/** After it: the server's set back, which the engine sends and the next player moves by. */
void PM_Move_Post(playermove_t *pm, int server)
{
	(void)server;
	if (!g_movementSwapped && !g_stocksHooked[STOCK_PM_MOVE])
		RETURN_META(MRES_IGNORED);

	if (g_movementSwapped) {
		for (int i = 0; i < MOVEMENT_FIELDS; i++)
			MovementIn(pm->movevars, i) = g_movementSaved[i];
		g_movementSwapped = false;
	}
	MoveHeard(pm, 1);
	RETURN_META(MRES_IGNORED);
}
