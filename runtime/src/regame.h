// The game's own actions, run by the module with no AMX Mod X native and no
// ReAPI: what a player is given, how he respawns, which side he is on, the
// round restarted. On ReGameDLL through its API - every player has a
// CCSPlayer of ReGameDLL's API beside his CBasePlayer, and the game rules are
// the object its GetGameRules gives - so ReGameDLL's hookchains hear each
// action, as they hear the game's own. On plain HLDS through what the game
// has there: its virtual functions at the gamedata's offsets, the engine's
// functions, and a client command run as if the player had sent it.
//
// Included by module.cpp, after the game's hooks (gamehooks.h, enginehooks.h)
// and the client command path (ClientCommandLine).

// ---------------------------------------------------------------- ReGameDLL's API classes

// ReGameDLL's API classes, as far as the module calls them: the virtual
// functions of CCSEntity (regamedll/public/regamedll/API/CSEntity.h) and of
// CCSPlayer (CSPlayer.h), in the order those headers declare them, so the
// compiler lays out the table as ReGameDLL's own build does - one slot for
// the destructor on MSVC, two on GCC. A function the module does not call is
// a placeholder of its slot. CCSDelay, CCSAnimating, CCSToggle and CCSMonster
// between the two add no function. CSENTITY_API_INTERFACE_VERSION003.
namespace re {

class CSEntity {
public:
	virtual ~CSEntity() = 0;
	virtual void FireBullets() = 0;
	virtual void FireBuckshots() = 0;
	virtual void FireBullets3() = 0;
#define RESERVE(n) virtual void reserve##n() = 0;
	RESERVE(1) RESERVE(2) RESERVE(3) RESERVE(4) RESERVE(5) RESERVE(6) RESERVE(7) RESERVE(8) RESERVE(9) RESERVE(10)
	RESERVE(11) RESERVE(12) RESERVE(13) RESERVE(14) RESERVE(15) RESERVE(16) RESERVE(17) RESERVE(18) RESERVE(19) RESERVE(20)
	RESERVE(21) RESERVE(22) RESERVE(23) RESERVE(24) RESERVE(25) RESERVE(26) RESERVE(27) RESERVE(28) RESERVE(29) RESERVE(30)
#undef RESERVE
};

class CSPlayer : public CSEntity {
public:
	virtual bool IsConnected() const = 0;
	virtual void SetAnimation(int anim) = 0;
	virtual void AddAccount(int amount, int type, bool track) = 0;
	virtual void *GiveNamedItem(const char *name) = 0;
	virtual void *GiveNamedItemEx(const char *name) = 0;
	virtual void GiveDefaultItems() = 0;
	virtual void GiveShield(bool deploy) = 0;
	virtual void *DropShield(bool deploy) = 0;
	virtual void *DropPlayerItem(const char *name) = 0;
	virtual bool RemoveShield() = 0;
	virtual void RemoveAllItems(bool removeSuit) = 0;
	virtual bool RemovePlayerItem(const char *name) = 0;
	virtual void SetPlayerModel(bool hasC4) = 0;
	virtual void SetPlayerModelEx(const char *model) = 0;
	virtual void SetNewPlayerModel(const char *model) = 0;
	virtual void ClientCommand(const char *cmd, const char *arg1, const char *arg2, const char *arg3) = 0;
	virtual void SetProgressBarTime(int time) = 0;
	virtual void SetProgressBarTime2(int time, float elapsed) = 0;
	virtual edict_t *EntSelectSpawnPoint() = 0;
	virtual void SetBombIcon(bool flash) = 0;
	virtual void SetScoreAttrib(void *dest) = 0;
	virtual void SendItemStatus() = 0;
	virtual void ReloadWeapons(void *weapon, bool forceReload, bool forceRefill) = 0;
	virtual void Observer_SetMode(int mode) = 0;
	virtual bool SelectSpawnSpot(const char *classname, void *&spot) = 0;
	virtual bool SwitchWeapon(void *weapon) = 0;
	virtual void SwitchTeam() = 0;
	virtual bool JoinTeam(int team) = 0;
	virtual void StartObserver(float *origin, float *angles) = 0;
	virtual void TeamChangeUpdate() = 0;
	virtual void DropSecondary() = 0;
	virtual void DropPrimary() = 0;
	virtual bool HasPlayerItem(void *item) = 0;
	virtual bool HasNamedPlayerItem(const char *name) = 0;
	virtual void *GetItemById(int weaponId) = 0;
	virtual void *GetItemByName(const char *name) = 0;
	virtual void Disappear() = 0;
	virtual void MakeVIP() = 0;
	virtual bool MakeBomber() = 0;
	virtual void ResetSequenceInfo() = 0;
	virtual void StartDeathCam() = 0;
	virtual bool RemovePlayerItemEx(const char *name, bool removeAmmo) = 0;
};

// The game rules' virtual functions: CGameRules' 63 (regamedll/dlls/gamerules.h),
// then those CHalfLifeMultiplay adds, in the order of the original game's
// table. ReGameDLL's CGameRules has a virtual destructor first, which the
// original game's has not: its table starts with RefreshSkillData.
#define RULES_BASE(n) virtual void base##n() = 0;
#define RULES_FUNCTIONS \
	RULES_BASE(1) RULES_BASE(2) RULES_BASE(3) RULES_BASE(4) RULES_BASE(5) RULES_BASE(6) RULES_BASE(7) RULES_BASE(8) RULES_BASE(9) \
	RULES_BASE(10) RULES_BASE(11) RULES_BASE(12) RULES_BASE(13) RULES_BASE(14) RULES_BASE(15) RULES_BASE(16) RULES_BASE(17) \
	RULES_BASE(18) RULES_BASE(19) RULES_BASE(20) RULES_BASE(21) RULES_BASE(22) RULES_BASE(23) RULES_BASE(24) RULES_BASE(25) \
	RULES_BASE(26) RULES_BASE(27) RULES_BASE(28) RULES_BASE(29) RULES_BASE(30) RULES_BASE(31) RULES_BASE(32) RULES_BASE(33) \
	RULES_BASE(34) RULES_BASE(35) RULES_BASE(36) RULES_BASE(37) RULES_BASE(38) RULES_BASE(39) RULES_BASE(40) RULES_BASE(41) \
	RULES_BASE(42) RULES_BASE(43) RULES_BASE(44) RULES_BASE(45) RULES_BASE(46) RULES_BASE(47) RULES_BASE(48) RULES_BASE(49) \
	RULES_BASE(50) RULES_BASE(51) RULES_BASE(52) RULES_BASE(53) RULES_BASE(54) RULES_BASE(55) RULES_BASE(56) RULES_BASE(57) \
	RULES_BASE(58) RULES_BASE(59) RULES_BASE(60) RULES_BASE(61) RULES_BASE(62) RULES_BASE(63) \
	virtual void CleanUpMap() = 0; \
	virtual void RestartRound() = 0; \
	virtual void CheckWinConditions() = 0; \
	virtual void RemoveGuns() = 0; \
	virtual void *GiveC4() = 0; \
	virtual void ChangeLevel() = 0; \
	virtual void GoToIntermission() = 0;

class RegameRules {
public:
	virtual ~RegameRules() = 0;
	RULES_FUNCTIONS
};

class OriginalRules {
public:
	RULES_FUNCTIONS
};

#undef RULES_FUNCTIONS
#undef RULES_BASE

}  // namespace re

/** Whether the server's ReGameDLL gives its API classes as the module declares them; asked once. */
static bool RegameClasses()
{
	static int here = -1;
	if (here < 0)
		here = g_regame && g_regame->BGetICSEntity("CSENTITY_API_INTERFACE_VERSION003") ? 1 : 0;
	return here == 1;
}

/**
 * A player's CCSPlayer on ReGameDLL, NULL elsewhere: ReGameDLL keeps it in
 * the member the original game called current_ammo, which it gave up for
 * this, at that member's offset in the gamedata.
 */
static re::CSPlayer *CSPlayerOf(int32_t id)
{
	static int offset = -2;
	if (offset == -2) {
		TypeDescription type;
		offset = g_entityData && g_entityData->GetOffsetByClass("CBaseEntity", "current_ammo", &type) ? type.fieldOffset : -1;
	}
	char *object = RegameClasses() && offset >= 0 && InGame(id) ? ObjectOf(id) : NULL;
	return object ? *(re::CSPlayer **)(object + offset) : NULL;
}

/** ReGameDLL's game rules; NULL on another server, or before a map has them. */
static re::RegameRules *RegameRulesObject()
{
	return g_regame && g_regame->BGetIGameRules("GAMERULES_API_INTERFACE_VERSION001") ? (re::RegameRules *)g_regame->GetGameRules() : NULL;
}

/** The original game's rules, where the gamedata finds them; NULL on ReGameDLL, or before a map has them. */
static re::OriginalRules *OriginalRulesObject()
{
	return !g_regame && g_rulesAddress ? (re::OriginalRules *)*g_rulesAddress : NULL;
}

// ---------------------------------------------------------------- the game's virtual functions

#ifdef _WIN32
typedef void (__fastcall *VoidMethod)(void *self, int);
#define CALL_VOID(fn, self) ((VoidMethod)(fn))(self, 0)
#else
typedef void (*VoidMethod)(void *self);
#define CALL_VOID(fn, self) ((VoidMethod)(fn))(self)
#endif

/**
 * Runs a game object's virtual function of no arguments, by Ham Sandwich's
 * key for it in the gamedata (cstrike_roundrespawn): through the object's
 * table, so whatever hooks the slot - a plugin's listener, Ham Sandwich, the
 * game's chain - hears it as it hears the game's own call. false when the
 * gamedata has no such function.
 */
static bool RunVirtual(void *object, const char *key)
{
	int slot = 0;
	if (!object || !HamOffset(key, &slot))
		return false;
	CALL_VOID(VtableOfObject(object)[slot], object);
	return true;
}

/** Says a line in the console once a process, under `key`. */
static void SayOnce(const char *key, const char *line)
{
	static std::set<std::string> said;
	if (said.insert(key).second)
		MF_PrintSrvConsole("[amxts] %s\n", line);
}

/** A message the game registers, begun to `to` (NULL: everyone) through the engine as the game's own; false when it is not. */
static bool BeginMessage(const char *name, edict_t *to)
{
	if (!g_hookedEngine)
		GET_HOOK_TABLES(PLID, &g_hookedEngine, NULL, NULL);
	int type = GET_USER_MSG_ID(PLID, name, NULL);
	if (!g_hookedEngine || type < 1)
		return false;
	g_hookedEngine->pfnMessageBegin(to ? MSG_ONE : MSG_ALL, type, NULL, to);
	return true;
}

/** TeamInfo to everyone: the side the scoreboard shows the player on. */
static void SendTeamInfo(int32_t id, const char *team)
{
	if (!BeginMessage("TeamInfo", NULL))
		return;
	g_hookedEngine->pfnWriteByte(id);
	g_hookedEngine->pfnWriteString(team);
	g_hookedEngine->pfnMessageEnd();
}

/** A HUD icon of the player's hidden (StatusIcon). */
static void HideStatusIcon(int32_t id, const char *icon)
{
	if (!BeginMessage("StatusIcon", INDEXENT(id)))
		return;
	g_hookedEngine->pfnWriteByte(0);
	g_hookedEngine->pfnWriteString(icon);
	g_hookedEngine->pfnMessageEnd();
}

// ---------------------------------------------------------------- the player's actions

// The places in m_rgpPlayerItems: the five slots a player carries his items in.
#define ITEM_SLOTS 6
// pev->weapons' bit of the suit (WEAPON_SUIT).
#define WEAPON_SUIT_BIT (1u << 31)
// pev->spawnflags' bit for an item given rather than placed (SF_NORESPAWN).
#define SPAWN_NO_RESPAWN (1 << 30)

/**
 * Whether the game has entities of the class: the game's library exports a
 * function by every class name it can make, which CREATE_NAMED_ENTITY finds.
 * True when the library cannot be asked.
 */
static bool GameHasClass(const char *classname)
{
	void *inGame = gpGamedllFuncs && gpGamedllFuncs->dllapi_table ? (void *)gpGamedllFuncs->dllapi_table->pfnSpawn : NULL;
	if (!inGame)
		return true;
#ifdef _WIN32
	HMODULE game = NULL;
	if (!GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT, (LPCSTR)inGame, &game))
		return true;
	return GetProcAddress(game, classname) != NULL;
#else
	Dl_info info;
	void *game = dladdr(inGame, &info) && info.dli_fname ? dlopen(info.dli_fname, RTLD_NOW | RTLD_NOLOAD) : NULL;
	if (!game)
		return true;
	bool has = dlsym(game, classname) != NULL;
	dlclose(game);
	return has;
#endif
}

/**
 * player_give(id, classname) - gives the player a weapon or an item, as the
 * game does: ReGameDLL's GiveNamedItemEx, else what the original
 * GiveNamedItem does - the entity made where he stands, spawned and touched
 * by him. The entity's index, 0 when he did not take it (one left behind is
 * removed), -1 for a name the game has no class of.
 */
static int32_t w_playerGive(wasm_exec_env_t env, int32_t id, int32_t name)
{
	std::string classname = AsString(Inst(env), name);
	if (!GameHasClass(classname.c_str()))
		return -1;
	if (!InGame(id))
		return 0;

	re::CSPlayer *player = CSPlayerOf(id);
	if (player) {
		void *item = player->GiveNamedItemEx(classname.c_str());
		return item ? IndexOfObject(item) : 0;
	}

	edict_t *owner = INDEXENT(id);
	edict_t *item = CREATE_NAMED_ENTITY(ALLOC_STRING(classname.c_str()));
	if (!item || !ENTINDEX(item))
		return 0;
	if (!item->pvPrivateData) {
		REMOVE_ENTITY(item);
		return 0;
	}
	item->v.origin = owner->v.origin;
	item->v.spawnflags |= SPAWN_NO_RESPAWN;
	MDLL_Spawn(item);
	int solid = item->v.solid;
	MDLL_Touch(item, owner);
	// Taken: a weapon becomes his and stops being solid; an item is used up.
	if (item->free || item->v.solid != solid || (item->v.flags & FL_KILLME) || item->v.owner == owner)
		return item->free ? id : IndexOf(item);
	REMOVE_ENTITY(item);
	return 0;
}

/**
 * player_strip(id, suit) - takes every weapon: ReGameDLL's RemoveAllItems,
 * else the game's player_weaponstrip used on him, which runs the original
 * RemoveAllItems; the suit too when `suit`.
 */
static void w_playerStrip(wasm_exec_env_t env, int32_t id, int32_t suit)
{
	(void)env;
	if (!InGame(id))
		return;
	re::CSPlayer *player = CSPlayerOf(id);
	if (player) {
		player->RemoveAllItems(suit != 0);
		return;
	}

	edict_t *owner = INDEXENT(id);
	edict_t *strip = CREATE_NAMED_ENTITY(ALLOC_STRING("player_weaponstrip"));
	if (!strip || !ENTINDEX(strip))
		return;
	MDLL_Spawn(strip);
	MDLL_Use(strip, owner);
	REMOVE_ENTITY(strip);
	if (suit)
		owner->v.weapons &= ~WEAPON_SUIT_BIT;
}

/** player_respawn(id) - the game's RoundRespawn: back into this round, at a spawn point. */
static void w_playerRespawn(wasm_exec_env_t env, int32_t id)
{
	(void)env;
	if (InGame(id) && !RunVirtual(ObjectOf(id), "cstrike_roundrespawn"))
		SayOnce("respawn", "player.respawn() needs the game's RoundRespawn, which this server's gamedata does not have");
}

/** player_speed(id) - the game's ResetMaxSpeed: his speed from the weapon in his hands. */
static void w_playerSpeed(wasm_exec_env_t env, int32_t id)
{
	(void)env;
	if (InGame(id) && !RunVirtual(ObjectOf(id), "cstrike_player_resetmaxspeed"))
		SayOnce("speed", "player.resetMaxSpeed() needs the game's ResetMaxSpeed, which this server's gamedata does not have");
}

/**
 * player_switch(id, classname) - puts a weapon he carries into his hands:
 * ReGameDLL's SwitchWeapon, else the weapon's own command, which the game
 * takes as his choice of it. 1 when he has it, 0 when he does not.
 */
static int32_t w_playerSwitch(wasm_exec_env_t env, int32_t id, int32_t name)
{
	std::string classname = AsString(Inst(env), name);
	if (!InGame(id))
		return 0;
	re::CSPlayer *player = CSPlayerOf(id);
	if (player) {
		void *item = player->GetItemByName(classname.c_str());
		return item && player->SwitchWeapon(item) ? 1 : 0;
	}
	ClientCommandLine(id, classname);
	return 1;
}

/**
 * player_join(id, team) - the game's JoinTeam on ReGameDLL: 1 joined, 0
 * refused; -1 elsewhere, where the facade sends the team menu's commands.
 */
static int32_t w_playerJoin(wasm_exec_env_t env, int32_t id, int32_t team)
{
	(void)env;
	re::CSPlayer *player = CSPlayerOf(id);
	if (!player)
		return -1;
	return player->JoinTeam(team) ? 1 : 0;
}

/**
 * player_observe(id, mode) - the game's Observer_SetMode on ReGameDLL: 1;
 * -1 elsewhere, where the facade takes its steps.
 */
static int32_t w_playerObserve(wasm_exec_env_t env, int32_t id, int32_t mode)
{
	(void)env;
	re::CSPlayer *player = CSPlayerOf(id);
	if (!player)
		return -1;
	player->Observer_SetMode(mode);
	return 1;
}

// The models a side's player takes, by m_iModelName: CT_URBAN 1 ... SPETSNAZ 11.
static const char *const g_modelNames[] = {
	"", "urban", "terror", "leet", "arctic", "gsg9", "gign", "sas", "guerilla", "vip", "militia", "spetsnaz",
};
static const int g_terroristModels[] = { 2, 3, 4, 8 };
static const int g_ctModels[] = { 1, 5, 6, 7 };

static int MemberOffset(const char *className, const char *member)
{
	TypeDescription type;
	return g_entityData && g_entityData->GetOffsetByClass(className, member, &type) ? type.fieldOffset : -1;
}

template <typename T>
static T *PlayerMember(char *object, const char *member)
{
	int offset = MemberOffset("CBasePlayer", member);
	return object && offset >= 0 ? (T *)(object + offset) : NULL;
}

/**
 * player_team(id, team) - moves the player to another side as ReAPI's
 * rg_set_user_team does with its defaults: the side's counts kept, a bomb or
 * a defuse kit he cannot keep taken, a model of the new side, the scoreboard
 * and AMX Mod X told; win conditions left to the caller. On ReGameDLL with
 * its own functions; on plain HLDS the same steps in memory and messages.
 */
static void w_playerTeam(wasm_exec_env_t env, int32_t id, int32_t team)
{
	(void)env;
	char *object = InGame(id) ? ObjectOf(id) : NULL;
	int *current = PlayerMember<int>(object, "m_iTeam");
	if (!current)
		return;
	int previous = *current;
	*current = team;

	int *terrorists = RulesMember("m_iNumTerrorist");
	int *cts = RulesMember("m_iNumCT");
	if (previous != team && terrorists && cts) {
		if (team == TEAM_T)
			(*terrorists)++;
		if (team == TEAM_CT)
			(*cts)++;
		if (previous == TEAM_T)
			(*terrorists)--;
		if (previous == TEAM_CT)
			(*cts)--;
	}

	// A terrorist leaving with the bomb hands it on, as the game does at a
	// round's start; with no terrorist left, or while the round restarts, he
	// drops it if he can.
	re::CSPlayer *player = CSPlayerOf(id);
	re::RegameRules *rules = RegameRulesObject();
	bool *hasC4 = PlayerMember<bool>(object, "m_bHasC4");
	bool *defuser = PlayerMember<bool>(object, "m_bHasDefuser");
	float *restarting = (float *)RulesMember("m_flRestartRoundTime");
	bool *bombTarget = (bool *)RulesMember("m_bMapHasBombTarget");
	edict_t *e = INDEXENT(id);
	if (previous != team && previous == TEAM_T && hasC4 && *hasC4 && player && rules) {
		if (terrorists && *terrorists > 0 && restarting && *restarting == 0 && bombTarget && *bombTarget && player->RemovePlayerItem("weapon_c4")) {
			*hasC4 = false;
			e->v.body = 0;
			player->SetBombIcon(false);
			player->SetProgressBarTime(0);
			rules->GiveC4();
		}
		else if (e->v.deadflag == DEAD_NO) {
			player->DropPlayerItem("weapon_c4");
		}
	}
	if (previous != team && previous == TEAM_CT && defuser && *defuser) {
		*defuser = false;
		e->v.body = 0;
		HideStatusIcon(id, "defuser");
		if (player)
			player->SendItemStatus();
	}

	int *model = PlayerMember<int>(object, "m_iModelName");
	if (model && (team == TEAM_T || team == TEAM_CT)) {
		*model = team == TEAM_T ? g_terroristModels[RANDOM_LONG(0, 3)] : g_ctModels[RANDOM_LONG(0, 3)];
		if (player)
			player->SetPlayerModel(hasC4 && *hasC4);
		else
			SET_CLIENT_KEYVALUE(id, GET_INFOKEYBUFFER(e), "model", (char *)g_modelNames[*model]);
	}

	static const char *const teamNames[] = { "UNASSIGNED", "TERRORIST", "CT", "SPECTATOR" };
	const char *name = team >= 0 && team < 4 ? teamNames[team] : "UNASSIGNED";
	if (player)
		player->TeamChangeUpdate();
	else
		SendTeamInfo(id, name);
	MF_SetPlayerTeamInfo(id, team, name);
	if (player && team == 3 && e->v.deadflag != DEAD_NO)
		player->StartDeathCam();
}

// ---------------------------------------------------------------- what a player carries

#ifdef _WIN32
typedef int (__fastcall *ItemMethod)(void *self, int, void *item);
#define CALL_ITEM(fn, self, item) ((ItemMethod)(fn))(self, 0, item)
#else
typedef int (*ItemMethod)(void *self, void *item);
#define CALL_ITEM(fn, self, item) ((ItemMethod)(fn))(self, item)
#endif

/**
 * Takes an item from the player as the original game does when it replaces
 * one, with the ammo it takes: his bit of it off pev->weapons, the game's
 * RemovePlayerItem, the item killed; the bomb's mark and icon with the bomb.
 */
static bool RemoveItemHere(int32_t id, char *player, char *item)
{
	int remove = 0;
	int idOffset = MemberOffset("CBasePlayerItem", "m_iId");
	int ammoOffset = MemberOffset("CBasePlayerWeapon", "m_iPrimaryAmmoType");
	if (!HamOffset("removeplayeritem", &remove) || idOffset < 0)
		return false;
	edict_t *e = INDEXENT(id);
	edict_t *itemEdict = (*(entvars_t **)(item + g_pevOffset))->pContainingEntity;
	int *ammo = PlayerMember<int>(player, "m_rgAmmo");
	int type = ammoOffset >= 0 ? *(int *)(item + ammoOffset) : -1;
	if (ammo && type > 0 && type < 32)
		ammo[type] = 0;
	if (!strcmp(STRING(itemEdict->v.classname), "weapon_c4")) {
		bool *hasC4 = PlayerMember<bool>(player, "m_bHasC4");
		if (hasC4)
			*hasC4 = false;
		e->v.body = 0;
		HideStatusIcon(id, "c4");
	}
	e->v.weapons &= ~(1u << *(int *)(item + idOffset));
	bool removed = CALL_ITEM(VtableOfObject(player)[remove], player, item) != 0;
	RunVirtual(item, "item_kill");
	return removed;
}

/**
 * player_remove_slot(id, slot) - takes every item of one of the player's
 * slots (1 primary ... 5 the bomb), with its ammo: ReGameDLL's
 * RemovePlayerItemEx for each, else the original game's steps. 1 when every
 * one went.
 */
static int32_t w_playerRemoveSlot(wasm_exec_env_t env, int32_t id, int32_t slot)
{
	(void)env;
	char *player = InGame(id) ? ObjectOf(id) : NULL;
	char **items = PlayerMember<char *>(player, "m_rgpPlayerItems");
	int next = MemberOffset("CBasePlayerItem", "m_pNext");
	if (!items || next < 0 || slot < 1 || slot >= ITEM_SLOTS)
		return 0;

	// The slot's items first: removing one unlinks it from the list walked.
	std::vector<char *> list;
	for (char *item = items[slot]; item && list.size() < 32; item = *(char **)(item + next))
		list.push_back(item);

	re::CSPlayer *cs = CSPlayerOf(id);
	bool all = true;
	for (char *item : list) {
		edict_t *itemEdict = (*(entvars_t **)(item + g_pevOffset))->pContainingEntity;
		bool removed = cs ? cs->RemovePlayerItemEx(STRING(itemEdict->v.classname), true) : RemoveItemHere(id, player, item);
		all = removed && all;
	}
	return all ? 1 : 0;
}

/** player_drop(id, classname) - the player drops a weapon he carries, as the game's drop does. */
static void w_playerDrop(wasm_exec_env_t env, int32_t id, int32_t name)
{
	std::string classname = AsString(Inst(env), name);
	if (!InGame(id))
		return;
	re::CSPlayer *player = CSPlayerOf(id);
	if (player)
		player->DropPlayerItem(classname.c_str());
	else
		ClientCommandLine(id, "drop " + classname);
}

// ---------------------------------------------------------------- what the server knows of a player

#define STAT_USER_ID   1
#define STAT_PING      2
#define STAT_LOSS      3
#define STAT_CONNECTED 4

/** When each client connected, by the server's clock: what player.connectedSeconds counts from. */
static float g_connectedAt[CLIENT_SLOTS];

/**
 * player_stat(id, what) - the player's user id, ping or packet loss as the
 * engine tells them, or the seconds since he connected; 0 for a slot nobody
 * is in.
 */
static int32_t w_playerStat(wasm_exec_env_t env, int32_t id, int32_t what)
{
	(void)env;
	if (id < 1 || id >= CLIENT_SLOTS || !g_connected[id])
		return 0;
	edict_t *e = INDEXENT(id);
	int ping = 0, loss = 0;
	switch (what) {
		case STAT_USER_ID:   return GETPLAYERUSERID(e);
		case STAT_PING:      g_engfuncs.pfnGetPlayerStats(e, &ping, &loss); return ping;
		case STAT_LOSS:      g_engfuncs.pfnGetPlayerStats(e, &ping, &loss); return loss;
		case STAT_CONNECTED: return Whole(gpGlobals->time - g_connectedAt[id]);
		default:             return 0;
	}
}

/** info_get(id, key, out, max) - a key of the player's userinfo, as UTF-8 text; its length. */
static int32_t w_userInfo(wasm_exec_env_t env, int32_t id, int32_t key, int32_t out, int32_t max)
{
	std::string name = AsString(Inst(env), key);
	const char *value = id >= 1 && id < CLIENT_SLOTS && g_connected[id] ? INFOKEY_VALUE(GET_INFOKEYBUFFER(INDEXENT(id)), name.c_str()) : "";
	return WriteBytes(Inst(env), out, max, value ? value : "");
}

/** info_set(id, key, value) - writes a key of the player's userinfo, which his game and the game hear. */
static void w_setUserInfo(wasm_exec_env_t env, int32_t id, int32_t key, int32_t value)
{
	if (id < 1 || id >= CLIENT_SLOTS || !g_connected[id])
		return;
	std::string name = AsString(Inst(env), key);
	std::string text = AsString(Inst(env), value);
	edict_t *e = INDEXENT(id);
	SET_CLIENT_KEYVALUE(id, GET_INFOKEYBUFFER(e), (char *)name.c_str(), (char *)text.c_str());
}

// Players whose steps make no sound, kept so by the module each frame on a
// server without ReGameDLL, which keeps its own member so itself.
static bool g_silentSteps[CLIENT_SLOTS];
static int  g_silentCount = 0;

// How long the engine waits before a step's next sound, pev->flTimeStepSound: never, in practice.
#define SILENT_STEP_TIME 999

/** player_silent(id, on) - his steps silent or not; -1 reads which. */
static int32_t w_playerSilent(wasm_exec_env_t env, int32_t id, int32_t on)
{
	(void)env;
	if (id < 1 || id >= CLIENT_SLOTS || !InGame(id))
		return 0;
	if (on < 0)
		return g_silentSteps[id] ? 1 : 0;
	if (g_silentSteps[id] != (on != 0))
		g_silentCount += on ? 1 : -1;
	g_silentSteps[id] = on != 0;
	edict_t *e = INDEXENT(id);
	e->v.flTimeStepSound = on ? SILENT_STEP_TIME : 400;
	float *time = RegameHere() ? PlayerMember<float>(ObjectOf(id), "m_flTimeStepSound") : NULL;
	if (time)
		*time = on ? SILENT_STEP_TIME : 0;
	return 1;
}

/** Each frame: the silent players' next step put off again, where the game does not keep it so. */
static void KeepStepsSilent()
{
	if (!g_silentCount || RegameHere())
		return;
	for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++)
		if (g_silentSteps[id] && InGame(id))
			INDEXENT(id)->v.flTimeStepSound = SILENT_STEP_TIME;
}

// ---------------------------------------------------------------- player.model

/**
 * The model a player wears by a plugin's say (player.model), with his user id
 * - a later player in the slot wears his own - and the model's precache
 * index for its hitboxes, 0 for the game's. `due`: his game sent another
 * model in its userinfo, to be written back at the next frame - not inside
 * the engine's own userinfo call, which would run it again.
 */
struct WornModel {
	std::string name;
	int userId = 0;
	int index = 0;
	bool due = false;
};

static WornModel g_worn[CLIENT_SLOTS];
// How many slots hold one: with none, the userinfo hook and the frame do nothing.
static int g_wornCount = 0;

static bool Wears(int id)
{
	return id >= 1 && id < CLIENT_SLOTS && !g_worn[id].name.empty() && InGame(id) && g_worn[id].userId == GETPLAYERUSERID(INDEXENT(id));
}

/**
 * The game writing a key of a player's userinfo - the team's model at spawn
 * and team change, on the original game: a model over the one he wears does
 * not go in. In Metamod's table only while someone wears one.
 */
static ALIGNED_ENTRY void ModelKeyValue(int id, char *info, const char *key, const char *value)
{
	if (key && value && !strcmp(key, "model") && Wears(id) && g_worn[id].name != value)
		RETURN_META(MRES_SUPERCEDE);
	RETURN_META(MRES_IGNORED);
}

static void HookModelKeys()
{
	if (g_pengfuncsTable)
		g_pengfuncsTable->pfnSetClientKeyValue = g_wornCount > 0 ? ModelKeyValue : NULL;
}

static void Unwear(int id)
{
	if (!g_worn[id].name.empty())
		g_wornCount--;
	g_worn[id] = WornModel();
	HookModelKeys();
}

/**
 * player_model(id, model, index) - he wears `model` (models/player/<model>/
 * <model>.mdl) from now on, through respawns and team changes: ReGameDLL's
 * SetPlayerModelEx keeps it there, the module's userinfo hook on any game.
 * `index` is the model's precache index, for its own hitboxes; 0 keeps the
 * game's. An empty model gives him back the game's.
 */
static void w_playerModel(wasm_exec_env_t env, int32_t id, int32_t name, int32_t index)
{
	std::string model = AsString(Inst(env), name);
	if (!InGame(id))
		return;
	edict_t *e = INDEXENT(id);
	char *object = ObjectOf(id);
	re::CSPlayer *player = CSPlayerOf(id);
	Unwear(id);

	if (model.empty()) {
		if (player) {
			bool *hasC4 = PlayerMember<bool>(object, "m_bHasC4");
			player->SetPlayerModelEx("");
			player->SetPlayerModel(hasC4 && *hasC4);
		}
		else {
			int *kind = PlayerMember<int>(object, "m_iModelName");
			if (kind && *kind > 0 && *kind < (int)(sizeof(g_modelNames) / sizeof(g_modelNames[0])))
				SET_CLIENT_KEYVALUE(id, GET_INFOKEYBUFFER(e), "model", (char *)g_modelNames[*kind]);
		}
		int *own = PlayerMember<int>(object, "m_modelIndexPlayer");
		if (own && *own > 0)
			e->v.modelindex = *own;
		return;
	}

	WornModel &worn = g_worn[id];
	worn.name = model;
	worn.userId = GETPLAYERUSERID(e);
	worn.index = index;
	g_wornCount++;
	HookModelKeys();
	if (player)
		player->SetPlayerModelEx(model.c_str());
	SET_CLIENT_KEYVALUE(id, GET_INFOKEYBUFFER(e), "model", (char *)model.c_str());
	if (index > 0)
		e->v.modelindex = index;
}

/** player_model_get(id, out, max) - the model he wears by a plugin's say, as UTF-8; "" for the game's. */
static int32_t w_playerModelGet(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	return WriteBytes(Inst(env), out, max, Wears(id) ? g_worn[id].name.c_str() : "");
}

/** A player's userinfo changed: a model other than the one he wears is written back at the next frame. */
static void ModelUserInfoChanged(int id, char *info)
{
	if (!g_wornCount || !Wears(id))
		return;
	const char *now = INFOKEY_VALUE(info, "model");
	if (!now || g_worn[id].name != now)
		g_worn[id].due = true;
}

/** Each frame: the models the game wrote over put back, and the hitboxes of a model worn with its own. */
static void KeepModels()
{
	if (!g_wornCount)
		return;
	for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++) {
		if (!Wears(id))
			continue;
		WornModel &worn = g_worn[id];
		edict_t *e = INDEXENT(id);
		if (worn.due) {
			worn.due = false;
			SET_CLIENT_KEYVALUE(id, GET_INFOKEYBUFFER(e), "model", (char *)worn.name.c_str());
		}
		if (worn.index > 0 && e->v.modelindex != worn.index)
			e->v.modelindex = worn.index;
	}
}

/** A player's slot let go or taken anew: nothing of the last one's stays. */
static void PlayerSlotReset(int id)
{
	if (id < 1 || id >= CLIENT_SLOTS)
		return;
	Unwear(id);
	if (g_silentSteps[id])
		g_silentCount--;
	g_silentSteps[id] = false;
	g_connectedAt[id] = gpGlobals->time;
}

/**
 * player_switch_team(id) - the player to the other side, as the game swaps
 * sides: ReGameDLL's SwitchTeam, else player_team's steps. A spectator stays.
 */
static void w_playerSwitchTeam(wasm_exec_env_t env, int32_t id)
{
	re::CSPlayer *player = CSPlayerOf(id);
	if (player) {
		player->SwitchTeam();
		return;
	}
	int *team = PlayerMember<int>(InGame(id) ? ObjectOf(id) : NULL, "m_iTeam");
	if (team && (*team == TEAM_T || *team == TEAM_CT))
		w_playerTeam(env, id, *team == TEAM_T ? TEAM_CT : TEAM_T);
}

// ---------------------------------------------------------------- the game rules' actions

#ifndef _WIN32
/** A virtual function's place in its class's table, from a pointer to it: GCC keeps 1 + its offset there. */
template <typename Method>
static int VirtualIndex(Method method)
{
	union { Method method; uintptr_t at; } u;
	u.method = method;
	return (int)((u.at - 1) / sizeof(void *));
}
#endif

/**
 * Whether the original game's rules have `method` where OriginalRules does.
 * On Linux, whose game library names its functions (in its symbol table,
 * not the dynamic one), the place is checked against the name once, and a
 * function found elsewhere is not called; a Windows game has no names.
 */
template <typename Method>
static bool OriginalSlotChecked(re::OriginalRules *rules, Method method, const char *symbol)
{
#ifdef _WIN32
	(void)rules;
	(void)method;
	(void)symbol;
	return true;
#else
	static std::map<std::string, bool> checked;
	std::map<std::string, bool>::iterator it = checked.find(symbol);
	if (it != checked.end())
		return it->second;
	void **table = *(void ***)rules;
	void *named = LibrarySymbol(table, symbol);
	bool same = !named || table[VirtualIndex(method)] == named;
	checked[symbol] = same;
	if (!same)
		MF_PrintSrvConsole("[amxts] the game rules' %s is not where amxts expects it in this game: it is not called\n", symbol);
	return same;
#endif
}

#define RULES_RESTART_ROUND 1
#define RULES_CHECK_WIN     2

/**
 * game_rules_run(action) - the game rules' RestartRound or
 * CheckWinConditions, at once: ReGameDLL's through its API, so its
 * hookchains hear it, the original game's through its own table. 0 when
 * the game has no rules yet, or its function is not where it is expected.
 */
static int32_t w_gameRulesRun(wasm_exec_env_t env, int32_t action)
{
	(void)env;
	if (action != RULES_RESTART_ROUND && action != RULES_CHECK_WIN)
		return 0;
	if (re::RegameRules *rules = RegameRulesObject()) {
		if (action == RULES_RESTART_ROUND)
			rules->RestartRound();
		else
			rules->CheckWinConditions();
		return 1;
	}

	re::OriginalRules *rules = OriginalRulesObject();
	if (!rules)
		return 0;
	if (action == RULES_RESTART_ROUND) {
		if (!OriginalSlotChecked(rules, &re::OriginalRules::RestartRound, "_ZN18CHalfLifeMultiplay12RestartRoundEv"))
			return 0;
		rules->RestartRound();
		return 1;
	}
	if (!OriginalSlotChecked(rules, &re::OriginalRules::CheckWinConditions, "_ZN18CHalfLifeMultiplay18CheckWinConditionsEv"))
		return 0;
	rules->CheckWinConditions();
	return 1;
}

// ---------------------------------------------------------------- Reunion

// Reunion's API, which it gives other plugins through ReHLDS
// (GetPluginApi("reunion")), as far as the module calls it: its version, then
// the client's protocol, the kind of game that proved who he is and its key -
// a client by his index from 0. API 1.x, at least 1.4.
namespace re {

class Reunion {
public:
	int major;
	int minor;
	virtual int GetClientProtocol(int index) = 0;
	virtual int GetClientAuthtype(int index) = 0;
	virtual size_t GetClientAuthdata(int index, void *data, int maxlen) = 0;
};

}  // namespace re

/** Reunion on this server, asked once; NULL without it, or with an API of another major version. */
static re::Reunion *ReunionApi()
{
	static re::Reunion *api = NULL;
	static bool asked = false;
	if (!asked && g_rehlds) {
		asked = true;
		re::Reunion *found = (re::Reunion *)g_rehlds->GetFuncs()->GetPluginApi("reunion");
		api = found && found->major == 1 && found->minor >= 4 ? found : NULL;
	}
	return api;
}

#define REUNION_PROTOCOL 1
#define REUNION_AUTH     2

/**
 * reunion(what, id) - the client's protocol (REUNION_PROTOCOL) or the kind of
 * game that proved who he is (REUNION_AUTH), from Reunion; -1 without it.
 */
static int32_t w_reunion(wasm_exec_env_t env, int32_t what, int32_t id)
{
	(void)env;
	re::Reunion *api = ReunionApi();
	if (!api || id < 1 || id > gpGlobals->maxClients)
		return -1;
	return what == REUNION_PROTOCOL ? api->GetClientProtocol(id - 1) : api->GetClientAuthtype(id - 1);
}

/** reunion_key(id, out, max) - the client's key from Reunion, as UTF-8 text; its length, 0 without one. */
static int32_t w_reunionKey(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	re::Reunion *api = ReunionApi();
	char key[256] = "";
	size_t size = api && id >= 1 && id <= gpGlobals->maxClients ? api->GetClientAuthdata(id - 1, key, sizeof(key) - 1) : 0;
	key[size < sizeof(key) ? size : sizeof(key) - 1] = '\0';
	return WriteBytes(Inst(env), out, max, key);
}
