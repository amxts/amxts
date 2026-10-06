// What the cstrike module raises its forwards from, heard by the module:
// CS_InternalCommand - a command the game runs for a bot, past Metamod -
// and CS_OnBuyAttempt and CS_OnBuy, a purchase asked for and one about to
// be made. On ReGameDLL a bot's command is its InternalCommand hookchain,
// and the purchases are its own hookchains (the game events of as/hooks.ts),
// so the two buying forwards are raised only on plain HLDS, for the
// backends of those events there (as/hlds.ts).
//
// On plain HLDS every one of them is a function of the game's, taken over at
// the gamedata's signature of it (EntryHook, modules.games): the game's
// ClientCommand, which the game calls itself for a bot, and the functions a
// purchase goes through - CanBuyThis for a gun or the shield, CanPlayerBuy
// for night vision and the defuser, GiveNamedItem for the rest, with
// AddAccount and BuyGunAmmo kept from taking the money or giving the ammo of
// one a listener blocked. Which item a command buys is the game's own words
// for it: an alias in the buy zone (`ak47`), or a number in a buy menu.
//
// Included by module.cpp, after the clients' events.

// ---- a bot's command on ReGameDLL

typedef re::IVoidHookChain<edict_t *, const char *, const char *> InternalCommandChain;
typedef re::IVoidHookChainRegistry<edict_t *, const char *, const char *> InternalCommandRegistry;

/** A bot's command, inside the cstrike module's hook of it: a Pawn plugin that took it keeps it from TypeScript. */
static void InternalCommand_RG(InternalCommandChain *chain, edict_t *e, const char *command, const char *arg)
{
	int id = ClientId(e);
	if (id && command && Heard(FORWARD_CS_INTERNALCOMMAND) && MF_IsPlayerAlive(id)) {
		HostHeap heap;
		cell args[2] = { id, PushString(command) };
		if (Raise(FORWARD_CS_INTERNALCOMMAND, args, 2) > 0)
			return;
	}
	chain->callNext(e, command, arg);
}

// ---- plain HLDS

// The items, as cstrike numbers them (CSI_*).
enum {
	ITEM_P228 = 1, ITEM_SCOUT = 3, ITEM_HEGRENADE, ITEM_XM1014, ITEM_C4, ITEM_MAC10, ITEM_AUG,
	ITEM_SMOKEGRENADE, ITEM_ELITE, ITEM_FIVESEVEN, ITEM_UMP45, ITEM_SG550, ITEM_GALIL, ITEM_FAMAS,
	ITEM_USP, ITEM_GLOCK18, ITEM_AWP, ITEM_MP5NAVY, ITEM_M249, ITEM_M3, ITEM_M4A1, ITEM_TMP,
	ITEM_G3SG1, ITEM_FLASHBANG, ITEM_DEAGLE, ITEM_SG552, ITEM_AK47, ITEM_KNIFE, ITEM_P90,
	ITEM_VEST, ITEM_VESTHELM, ITEM_DEFUSER, ITEM_NVGS, ITEM_SHIELD, ITEM_PRIAMMO, ITEM_SECAMMO,
	ITEM_COUNT
};

/** What each item costs, by its number: the game's prices. */
static const int g_itemPrices[ITEM_COUNT] = {
	0, 600, 0, 2750, 300, 3000, 0, 1400, 3500, 300, 800, 750, 1700, 4200, 2000, 2250, 500, 400,
	4750, 1500, 5750, 1700, 3100, 1250, 5000, 200, 650, 3500, 2500, 0, 2350, 650, 1000, 200,
	1250, 2200, 0, 0,
};

/** The buy commands, by the names the game takes for each item. */
static const struct { const char *alias; int item; } g_buyAliases[] = {
	{ "p228", ITEM_P228 }, { "228compact", ITEM_P228 }, { "glock", ITEM_GLOCK18 }, { "9x19mm", ITEM_GLOCK18 },
	{ "usp", ITEM_USP }, { "km45", ITEM_USP }, { "deagle", ITEM_DEAGLE }, { "nighthawk", ITEM_DEAGLE },
	{ "elites", ITEM_ELITE }, { "fn57", ITEM_FIVESEVEN }, { "fiveseven", ITEM_FIVESEVEN },
	{ "m3", ITEM_M3 }, { "12gauge", ITEM_M3 }, { "xm1014", ITEM_XM1014 }, { "autoshotgun", ITEM_XM1014 },
	{ "mac10", ITEM_MAC10 }, { "tmp", ITEM_TMP }, { "mp", ITEM_TMP }, { "mp5", ITEM_MP5NAVY }, { "smg", ITEM_MP5NAVY },
	{ "ump45", ITEM_UMP45 }, { "p90", ITEM_P90 }, { "c90", ITEM_P90 },
	{ "galil", ITEM_GALIL }, { "defender", ITEM_GALIL }, { "famas", ITEM_FAMAS }, { "clarion", ITEM_FAMAS },
	{ "ak47", ITEM_AK47 }, { "cv47", ITEM_AK47 }, { "m4a1", ITEM_M4A1 }, { "sg552", ITEM_SG552 }, { "krieg552", ITEM_SG552 },
	{ "aug", ITEM_AUG }, { "bullpup", ITEM_AUG }, { "scout", ITEM_SCOUT }, { "awp", ITEM_AWP }, { "magnum", ITEM_AWP },
	{ "g3sg1", ITEM_G3SG1 }, { "d3au1", ITEM_G3SG1 }, { "sg550", ITEM_SG550 }, { "krieg550", ITEM_SG550 },
	{ "m249", ITEM_M249 }, { "vest", ITEM_VEST }, { "vesthelm", ITEM_VESTHELM }, { "flash", ITEM_FLASHBANG },
	{ "hegren", ITEM_HEGRENADE }, { "sgren", ITEM_SMOKEGRENADE }, { "nvgs", ITEM_NVGS }, { "defuser", ITEM_DEFUSER },
	{ "shield", ITEM_SHIELD }, { "buyammo1", ITEM_PRIAMMO }, { "primammo", ITEM_PRIAMMO },
	{ "buyammo2", ITEM_SECAMMO }, { "secammo", ITEM_SECAMMO },
};

// The buy menus (the player's m_iMenu, from Menu_Buy on): each number's item, a terrorist's and a counter-terrorist's.
#define MENU_BUY      4
#define MENU_BUY_ITEM 10
static const unsigned char g_buyMenus[2][MENU_BUY_ITEM - MENU_BUY + 1][9] = {
	{
		{ 0, 0, 0, 0, 0, 0, ITEM_PRIAMMO, ITEM_SECAMMO, 0 },
		{ 0, ITEM_GLOCK18, ITEM_USP, ITEM_P228, ITEM_DEAGLE, ITEM_ELITE, 0, 0, 0 },
		{ 0, ITEM_GALIL, ITEM_AK47, ITEM_SCOUT, ITEM_SG552, ITEM_AWP, ITEM_G3SG1, 0, 0 },
		{ 0, ITEM_M249, 0, 0, 0, 0, 0, 0, 0 },
		{ 0, ITEM_M3, ITEM_XM1014, 0, 0, 0, 0, 0, 0 },
		{ 0, ITEM_MAC10, ITEM_MP5NAVY, ITEM_UMP45, ITEM_P90, 0, 0, 0, 0 },
		{ 0, ITEM_VEST, ITEM_VESTHELM, ITEM_FLASHBANG, ITEM_HEGRENADE, ITEM_SMOKEGRENADE, ITEM_NVGS, 0, 0 },
	},
	{
		{ 0, 0, 0, 0, 0, 0, ITEM_PRIAMMO, ITEM_SECAMMO, 0 },
		{ 0, ITEM_GLOCK18, ITEM_USP, ITEM_P228, ITEM_DEAGLE, ITEM_FIVESEVEN, 0, 0, 0 },
		{ 0, ITEM_FAMAS, ITEM_SCOUT, ITEM_M4A1, ITEM_AUG, ITEM_SG550, ITEM_AWP, 0, 0 },
		{ 0, ITEM_M249, 0, 0, 0, 0, 0, 0, 0 },
		{ 0, ITEM_M3, ITEM_XM1014, 0, 0, 0, 0, 0, 0 },
		{ 0, ITEM_TMP, ITEM_MP5NAVY, ITEM_UMP45, ITEM_P90, 0, 0, 0, 0 },
		{ 0, ITEM_VEST, ITEM_VESTHELM, ITEM_FLASHBANG, ITEM_HEGRENADE, ITEM_SMOKEGRENADE, ITEM_NVGS, ITEM_DEFUSER, ITEM_SHIELD },
	},
};

#define TEAM_T  1
#define TEAM_CT 2

// The player's members a purchase is checked against, and the game rules'.
static int g_menuOffset = -1, g_teamOffset = -1, g_signalsOffset = -1, g_moneyOffset = -1;
static int g_nightVisionOffset = -1, g_defuserOffset = -1, g_bombTargetOffset = -1;

// A bot's command: the game's own flag and words for it.
static bool        *g_useBotArgs = NULL;
static const char **g_botArgs = NULL;

static EntryHook g_clientCommand = { NULL, NULL, { 0 }, { 0 }, false };
static EntryHook g_canBuyThis    = { NULL, NULL, { 0 }, { 0 }, false };
static EntryHook g_canPlayerBuy  = { NULL, NULL, { 0 }, { 0 }, false };
static EntryHook g_giveNamedItem = { NULL, NULL, { 0 }, { 0 }, false };
static EntryHook g_addAccount    = { NULL, NULL, { 0 }, { 0 }, false };
static EntryHook g_buyGunAmmo    = { NULL, NULL, { 0 }, { 0 }, false };

// The item the command being run buys, and what a blocked one keeps back.
static int  g_buying = 0;
static bool g_keepMoney = false;
static bool g_keepAmmo = false;

template <typename T>
static T FieldOf(const void *object, int offset)
{
	return *(const T *)((const char *)object + offset);
}

/** The game's object of player `id`, NULL for none. */
static void *PlayerObject(int id)
{
	edict_t *e = id >= 1 && id <= gpGlobals->maxClients ? INDEXENT(id) : NULL;
	return e && !e->free ? e->pvPrivateData : NULL;
}

static int ItemOfAlias(const char *command)
{
	char lower[32];
	size_t i = 0;
	for (; command[i] && i < sizeof(lower) - 1; i++)
		lower[i] = (char)tolower((unsigned char)command[i]);
	lower[i] = '\0';
	for (const auto &alias : g_buyAliases)
		if (!strcmp(alias.alias, lower))
			return alias.item;
	return 0;
}

/** The item a player's command buys: a number of the buy menu open, or an alias in the buy zone; 0 for none. */
static int ItemOfCommand(const void *player, const char *command, const char *arg)
{
	if (!strcmp(command, "menuselect")) {
		int slot = atoi(arg);
		int menu = FieldOf<int>(player, g_menuOffset);
		int team = FieldOf<int>(player, g_teamOffset);
		if (slot < 1 || slot > 8 || menu < MENU_BUY || menu > MENU_BUY_ITEM || (team != TEAM_T && team != TEAM_CT))
			return 0;
		return g_buyMenus[team - 1][menu - MENU_BUY][slot];
	}
	// CUnifiedSignals: the signals of this frame, then the state - SIGNAL_BUY the buy zone.
	return (FieldOf<int>(player, g_signalsOffset + 4) & 1) ? ItemOfAlias(command) : 0;
}

/** CS_OnBuy for the item being bought, by an alive player: whether a listener blocked it. */
static bool BuyBlocked(int id)
{
	if (!MF_IsPlayerAlive(id))
		return false;
	cell args[2] = { id, g_buying };
	return Raise(FORWARD_CS_ONBUY, args, 2) > 0;
}

/** Calls the function a hook took over: the bytes put back for the call. */
#define CALL_ORIGINAL(hook, type, ...) \
	(HookOff(hook), CallOriginal<type>(hook, __VA_ARGS__))

template <typename F, typename... Args>
static auto CallOriginal(EntryHook &hook, Args... args) -> decltype(((F)NULL)(args...))
{
	struct On { EntryHook &h; ~On() { HookOn(h); } } on = { hook };
	return ((F)hook.at)(args...);
}

typedef void (*ClientCommandFn)(edict_t *e);

/** The game's ClientCommand, a player's command and a bot's alike. */
static void ClientCommand_Hooked(edict_t *e)
{
	int id = ClientId(e);
	void *player = id ? PlayerObject(id) : NULL;
	bool internal = g_useBotArgs && *g_useBotArgs;
	const char *command = internal ? g_botArgs[0] : CMD_ARGV(0);
	const char *arg = internal ? g_botArgs[1] : CMD_ARGV(1);
	int item = 0;

	if (player && command && MF_IsPlayerAlive(id)) {
		if (internal && Heard(FORWARD_CS_INTERNALCOMMAND)) {
			HostHeap heap;
			cell args[2] = { id, PushString(command) };
			if (Raise(FORWARD_CS_INTERNALCOMMAND, args, 2) > 0)
				return;
		}
		if (g_menuOffset >= 0 && (Heard(FORWARD_CS_ONBUY) || Heard(FORWARD_CS_ONBUYATTEMPT)))
			item = ItemOfCommand(player, command, arg ? arg : "");
		cell args[2] = { id, item };
		if (item && Heard(FORWARD_CS_ONBUYATTEMPT) && Raise(FORWARD_CS_ONBUYATTEMPT, args, 2) > 0)
			return;
	}

	int outer = g_buying;
	g_buying = item;
	CALL_ORIGINAL(g_clientCommand, ClientCommandFn, e);
	g_buying = outer;
	g_keepMoney = g_keepAmmo = false;
}

#ifdef _WIN32
// A member function: thiscall, `this` in ECX - __fastcall's first, with EDX unused.
#define MEMBER_HOOK(type, name, ...) type __fastcall name(void *self, int, __VA_ARGS__)
#define MEMBER_TYPE(type, ...) type (__fastcall *)(void *, int, __VA_ARGS__)
#define MEMBER_ARGS(...) self, 0, __VA_ARGS__
#else
#define MEMBER_HOOK(type, name, ...) type name(void *self, __VA_ARGS__)
#define MEMBER_TYPE(type, ...) type (*)(void *, __VA_ARGS__)
#define MEMBER_ARGS(...) self, __VA_ARGS__
#endif

typedef bool (*CanBuyThisFn)(void *player, int weapon);

/** A gun or the shield: the game's checks first, then whether the player can pay for it. */
static bool CanBuyThis_Hooked(void *player, int weapon)
{
	bool can = CALL_ORIGINAL(g_canBuyThis, CanBuyThisFn, player, weapon);
	int item = g_buying;
	bool gun = item >= ITEM_P228 && item <= ITEM_P90 && item != ITEM_HEGRENADE && item != ITEM_C4
	           && item != ITEM_SMOKEGRENADE && item != ITEM_FLASHBANG && item != ITEM_KNIFE;
	if (!can || !(gun || item == ITEM_SHIELD) || FieldOf<int>(player, g_moneyOffset) < g_itemPrices[item])
		return can;
	return !BuyBlocked(ClientId(FieldOf<entvars_t *>(player, g_pevOffset)->pContainingEntity));
}

using CanPlayerBuyFn = MEMBER_TYPE(bool, bool);

/** Night vision and the defuser: the game's checks first, then whether the player can have and pay for it. */
static MEMBER_HOOK(bool, CanPlayerBuy_Hooked, bool display)
{
	bool can = CALL_ORIGINAL(g_canPlayerBuy, CanPlayerBuyFn, MEMBER_ARGS(display));
	int item = g_buying;
	if (!can || (item != ITEM_NVGS && item != ITEM_DEFUSER))
		return can;
	bool fits = FieldOf<int>(self, g_moneyOffset) >= g_itemPrices[item];
	if (item == ITEM_NVGS)
		fits = fits && !FieldOf<bool>(self, g_nightVisionOffset);
	else
		fits = fits && !FieldOf<bool>(self, g_defuserOffset) && FieldOf<int>(self, g_teamOffset) == TEAM_CT
		       && g_rulesAddress && *g_rulesAddress && g_bombTargetOffset >= 0 && FieldOf<bool>(*g_rulesAddress, g_bombTargetOffset);
	if (!fits)
		return can;
	return !BuyBlocked(ClientId(FieldOf<entvars_t *>(self, g_pevOffset)->pContainingEntity));
}

using GiveNamedItemFn = MEMBER_TYPE(void, const char *);

/** Armour, a grenade and ammo: given by name; one blocked is not given, nor paid for. */
static MEMBER_HOOK(void, GiveNamedItem_Hooked, const char *name)
{
	int item = g_buying;
	bool given = item == ITEM_VEST || item == ITEM_VESTHELM || item == ITEM_FLASHBANG || item == ITEM_HEGRENADE
	             || item == ITEM_SMOKEGRENADE || item == ITEM_PRIAMMO || item == ITEM_SECAMMO;
	if (given && BuyBlocked(ClientId(FieldOf<entvars_t *>(self, g_pevOffset)->pContainingEntity))) {
		g_keepAmmo = item == ITEM_PRIAMMO || item == ITEM_SECAMMO;
		g_keepMoney = true;
		return;
	}
	CALL_ORIGINAL(g_giveNamedItem, GiveNamedItemFn, MEMBER_ARGS(name));
}

using AddAccountFn = MEMBER_TYPE(void, int, bool);

static MEMBER_HOOK(void, AddAccount_Hooked, int amount, bool track)
{
	if (g_keepMoney) {
		g_keepMoney = false;
		return;
	}
	CALL_ORIGINAL(g_addAccount, AddAccountFn, MEMBER_ARGS(amount, track));
}

typedef bool (*BuyGunAmmoFn)(void *player, void *weapon, bool blink);

static bool BuyGunAmmo_Hooked(void *player, void *weapon, bool blink)
{
	bool bought = CALL_ORIGINAL(g_buyGunAmmo, BuyGunAmmoFn, player, weapon, blink);
	if (bought && g_keepAmmo) {
		g_keepAmmo = false;
		return false;
	}
	return bought;
}

static int OffsetOf(IGameConfig *config, const char *className, const char *member)
{
	TypeDescription type;
	return config && config->GetOffsetByClass(className, member, &type) ? type.fieldOffset : -1;
}

static void FoundAt(IGameConfig *config, EntryHook &hook, const char *name, void *to)
{
	void *address = NULL;
	if (config && config->GetMemSig(name, &address) && address) {
		hook.at = (unsigned char *)address;
		hook.to = to;
	}
}

static IGameConfig *g_cstrikeData = NULL; // modules.games

/**
 * The game's functions and members of a purchase and a bot's command, once a
 * process: ReGameDLL's InternalCommand hookchain, else the gamedata's
 * signatures - Counter-Strike and Condition Zero alone.
 */
static void FindCstrike()
{
	if (g_regameChains) {
		((InternalCommandRegistry *)g_regameChains->InternalCommand())->registerHook(InternalCommand_RG, CHAIN_PRIORITY);
		return;
	}
	std::string mod = MF_GetModname();
	IGameConfigManager *manager = MF_GetConfigManager();
	char error[256] = "";
	if ((mod != "cstrike" && mod != "czero") || !manager || !manager->LoadGameConfigFile("modules.games", &g_cstrikeData, error, sizeof(error)))
		return;

	g_menuOffset = OffsetOf(g_entityData, "CBasePlayer", "m_iMenu");
	g_teamOffset = OffsetOf(g_entityData, "CBasePlayer", "m_iTeam");
	g_signalsOffset = OffsetOf(g_entityData, "CBasePlayer", "m_signals");
	g_moneyOffset = OffsetOf(g_entityData, "CBasePlayer", "m_iAccount");
	g_nightVisionOffset = OffsetOf(g_entityData, "CBasePlayer", "m_bHasNightVision");
	g_defuserOffset = OffsetOf(g_entityData, "CBasePlayer", "m_bHasDefuser");
	g_bombTargetOffset = OffsetOf(g_rulesData, "CHalfLifeMultiplay", "m_bMapHasBombTarget");

	void *command = gpGamedllFuncs && gpGamedllFuncs->dllapi_table ? (void *)gpGamedllFuncs->dllapi_table->pfnClientCommand : NULL;
	if (command) {
		g_clientCommand.at = (unsigned char *)command;
		g_clientCommand.to = (void *)ClientCommand_Hooked;
	}
#ifdef _WIN32
	// The flag and the words are read by ClientCommand's code at these offsets in it.
	TypeDescription type;
	if (command && g_cstrikeData->GetOffset("UseBotArgs", &type))
		g_useBotArgs = *(bool **)((char *)command + type.fieldOffset);
	if (command && g_cstrikeData->GetOffset("BotArgs", &type))
		g_botArgs = *(const char ***)((char *)command + type.fieldOffset);
#else
	void *address = NULL;
	if (g_cstrikeData->GetMemSig("UseBotArgs", &address))
		g_useBotArgs = (bool *)address;
	if (g_cstrikeData->GetMemSig("BotArgs", &address))
		g_botArgs = (const char **)address;
#endif
	if (!g_useBotArgs || !g_botArgs)
		g_useBotArgs = NULL;

	if (g_menuOffset < 0 || g_teamOffset < 0 || g_signalsOffset < 0 || g_moneyOffset < 0 || g_nightVisionOffset < 0 || g_defuserOffset < 0)
		return;
	FoundAt(g_cstrikeData, g_canBuyThis, "CanBuyThis", (void *)CanBuyThis_Hooked);
	FoundAt(g_cstrikeData, g_canPlayerBuy, "CanPlayerBuy", (void *)CanPlayerBuy_Hooked);
	FoundAt(g_cstrikeData, g_giveNamedItem, "GiveNamedItem", (void *)GiveNamedItem_Hooked);
	FoundAt(g_cstrikeData, g_addAccount, "AddAccount", (void *)AddAccount_Hooked);
	FoundAt(g_cstrikeData, g_buyGunAmmo, "BuyGunAmmo", (void *)BuyGunAmmo_Hooked);
	if (!g_canBuyThis.at || !g_canPlayerBuy.at || !g_giveNamedItem.at || !g_addAccount.at || !g_buyGunAmmo.at)
		g_menuOffset = -1;
}

/**
 * The hooks in the game's way while their forwards are listened to, checked
 * each frame and taken out at a map's end: the cstrike module turns its own
 * detours of the same functions on and off in ServerActivate, so the module's
 * jump goes on after it and comes off before it, as SV_DropClient's does.
 */
static void SettleCstrike(bool active)
{
	bool command = active && (Heard(FORWARD_CS_INTERNALCOMMAND) || Heard(FORWARD_CS_ONBUY) || Heard(FORWARD_CS_ONBUYATTEMPT));
	bool buying = active && g_menuOffset >= 0 && Heard(FORWARD_CS_ONBUY);
	EntryHook *buys[] = { &g_canBuyThis, &g_canPlayerBuy, &g_giveNamedItem, &g_addAccount, &g_buyGunAmmo };
	if (command)
		HookOn(g_clientCommand);
	else
		HookOff(g_clientCommand);
	for (EntryHook *hook : buys) {
		if (buying)
			HookOn(*hook);
		else
			HookOff(*hook);
	}
}

static void ForgetCstrike()
{
	SettleCstrike(false);
	if (g_regameChains)
		((InternalCommandRegistry *)g_regameChains->InternalCommand())->unregisterHook(InternalCommand_RG);
	IGameConfigManager *manager = MF_GetConfigManager();
	if (manager && g_cstrikeData)
		manager->CloseGameConfigFile(g_cstrikeData);
	g_cstrikeData = NULL;
}
