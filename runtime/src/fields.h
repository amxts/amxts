// Entity fields and the game's members, read and written where the game
// keeps them. module.cpp includes this once, after the native calls and the
// string helpers it uses.
//
// A property - `entity.origin`, `player.account`, `game.numCtWins` - is a
// field in memory: an entvar inside the entity's edict, a member inside the
// C++ object the game made for it, a member of the game rules. reapi's
// get_entvar and get_member read the same memory, behind a call through
// AMX Mod X; on a server without reapi there was nothing at all. Here a plugin's read is one call into the module and a load.
//
// - An entvar is at its place in entvars_t, which the facade passes: the
//   layout is the engine's, the same on every server and both systems
//   (scripts/entvars.ts works it out from reapi's include).
// - A member is at the offset AMX Mod X's gamedata gives its class and name -
//   the data fakemeta's get_ent_data reads - looked up once per name
//   (member_slot), with its type, which says how many bytes it is and whether
//   it points at an entity.
// - The game rules are the object g_pGameRules points at; the gamedata finds
//   that variable in the game's library. The gamedata lays the rules out as
//   the original game does, which ReGameDLL's do not (their base class has a
//   member more), so on a server with reapi the facade reads them through
//   reapi instead.
//
// The engine's edict array is found once per map, from the engine's
// functions Metamod gives the module: it starts at the world's edict
// (INDEXENT(0)) and is gpGlobals->maxEntities long. The engine makes it anew
// for every map (Teardown forgets it).

// The engine's edict_t on i386, Windows and Linux alike: 128 bytes of the
// engine's own, then entvars_t (676 bytes).
#define EDICT_SIZE         804
#define EDICT_SERIAL       4    // int serialnumber
#define EDICT_PRIVATE      124  // void *pvPrivateData - the game's object
#define EDICT_ENTVARS      128  // entvars_t v
#define ENTVARS_SIZE       676
#define ENTVARS_CONTAINING 520  // edict_t *pContainingEntity, inside entvars_t

// The id a plugin passes for the game rules rather than an entity.
#define RULES_ID           (-1)

static IGameConfig *g_entityData = NULL; // common.games
static IGameConfig *g_rulesData = NULL;  // common.games/gamerules.games
static void       **g_rulesAddress = NULL;
static int          g_pevOffset = 4;     // CBaseEntity::pev

static char *g_edicts = NULL;
static int   g_maxEdicts = 0;
static bool  g_edictsSaid = false;

struct Member {
	std::string     name;   // "CBasePlayer::m_iAccount", for the console
	TypeDescription type;   // FIELD_NONE: not in the gamedata
};

static std::vector<Member>         g_members;
static std::map<std::string, int>  g_memberSlots;

/** The gamedata, and where the game keeps its rules. */
static void FieldsAttach()
{
	IGameConfigManager *manager = MF_GetConfigManager();
	char error[256] = "";

	if (!manager || !manager->LoadGameConfigFile("common.games", &g_entityData, error, sizeof(error))) {
		MF_PrintSrvConsole("[amxts] AMX Mod X's gamedata (common.games) did not load%s%s: players', weapons' and the game's fields read 0\n", error[0] ? ": " : "", error);
		g_entityData = NULL;
		return;
	}

	TypeDescription pev;
	if (g_entityData->GetOffsetByClass("CBaseEntity", "pev", &pev) && pev.fieldOffset > 0)
		g_pevOffset = pev.fieldOffset;

	error[0] = '\0';
	if (!manager->LoadGameConfigFile("common.games/gamerules.games", &g_rulesData, error, sizeof(error)))
		g_rulesData = NULL;

	void *address = NULL;
	if (g_entityData->GetAddress("g_pGameRules", &address) && address) {
#ifdef _WIN32
		// The signature is an instruction that reads the variable: the address is its operand.
		g_rulesAddress = *(void ***)address;
#else
		g_rulesAddress = (void **)address;
#endif
	}
}

static void FieldsDetach()
{
	IGameConfigManager *manager = MF_GetConfigManager();
	if (manager && g_entityData)
		manager->CloseGameConfigFile(g_entityData);
	if (manager && g_rulesData)
		manager->CloseGameConfigFile(g_rulesData);
	g_entityData = g_rulesData = NULL;
}

/** The engine's edict array, found once per map. */
static bool FindEdicts()
{
	if (g_edicts)
		return true;

	// Without Metamod's engine functions - a module AMX Mod X could not load
	// into Metamod - there is no way to it.
	edict_t *world = gpGlobals && g_engfuncs.pfnPEntityOfEntIndex ? INDEXENT(0) : NULL;
	if (!world || gpGlobals->maxEntities <= 0) {
		if (!g_edictsSaid) {
			g_edictsSaid = true;
			MF_PrintSrvConsole("[amxts] entity fields read 0 on this map: the engine's edicts were not found\n");
		}
		return false;
	}

	g_edicts = (char *)world;
	g_maxEdicts = gpGlobals->maxEntities;
	return true;
}

/** A new map: the engine makes its edicts anew. */
static void ForgetEdicts()
{
	g_edicts = NULL;
	g_maxEdicts = 0;
	g_edictsSaid = false;
}

static char *EdictOf(int id)
{
	if (id < 0 || !FindEdicts() || id >= g_maxEdicts)
		return NULL;
	char *edict = g_edicts + id * EDICT_SIZE;
	return *(int *)edict ? NULL : edict; // free
}

/** An edict's index, 0 for none or for a pointer that is no edict. */
static int IndexOf(const void *edict)
{
	if (!edict || !g_edicts)
		return 0;
	ptrdiff_t at = (const char *)edict - g_edicts;
	if (at < 0 || at % EDICT_SIZE || at / EDICT_SIZE >= g_maxEdicts)
		return 0;
	return (int)(at / EDICT_SIZE);
}

/** The entity an entvars_t belongs to. */
static int IndexOfEntvars(const void *pev)
{
	return pev ? IndexOf(*(void **)((const char *)pev + ENTVARS_CONTAINING)) : 0;
}

/** The entity a game object (CBaseEntity *) is. */
static int IndexOfObject(const void *object)
{
	return object ? IndexOfEntvars(*(void **)((const char *)object + g_pevOffset)) : 0;
}

static char *ObjectOf(int index)
{
	char *edict = index > 0 ? EdictOf(index) : NULL;
	return edict ? *(char **)(edict + EDICT_PRIVATE) : NULL;
}

// ---------------------------------------------------------------- entvars

/** The entvar's four bytes at `offset`: a whole number, or a float's bits. */
static char *EntvarAt(int32_t id, int32_t offset)
{
	if (offset < 0 || offset > ENTVARS_SIZE - 4 || offset % 4)
		return NULL;
	char *edict = EdictOf(id);
	return edict ? edict + EDICT_ENTVARS + offset : NULL;
}

static int32_t w_entGet(wasm_exec_env_t env, int32_t id, int32_t offset)
{
	char *at = EntvarAt(id, offset);
	return at ? *(int32_t *)at : 0;
}

static void w_entSet(wasm_exec_env_t env, int32_t id, int32_t offset, int32_t cell)
{
	char *at = EntvarAt(id, offset);
	if (at)
		*(int32_t *)at = cell;
}

/** A vector entvar's three floats into the plugin's three numbers at `out`; zeros for none. */
static void w_entVector(wasm_exec_env_t env, int32_t id, int32_t offset, int32_t out)
{
	wasm_module_inst_t inst = Inst(env);
	if (!wasm_runtime_validate_app_addr(inst, (uint64_t)out, 3 * sizeof(double)))
		return;
	double *to = (double *)wasm_runtime_addr_app_to_native(inst, (uint64_t)out);
	const float *at = offset <= ENTVARS_SIZE - 12 ? (const float *)EntvarAt(id, offset) : NULL;
	for (int i = 0; i < 3; i++)
		to[i] = at ? at[i] : 0.0;
}

/** An edict_t * entvar - owner, enemy, aiment - as the entity's index. */
static int32_t w_entEntity(wasm_exec_env_t env, int32_t id, int32_t offset)
{
	char *at = EntvarAt(id, offset);
	return at ? IndexOf(*(void **)at) : 0;
}

/** Points an edict_t * entvar at an entity; 0 or less is none. */
static void w_entSetEntity(wasm_exec_env_t env, int32_t id, int32_t offset, int32_t index)
{
	char *at = EntvarAt(id, offset);
	if (at)
		*(void **)at = index > 0 ? EdictOf(index) : NULL;
}

// ---------------------------------------------------------------- members

/** True for the game rules' classes, whose members are in the gamerules gamedata. */
static bool IsRulesClass(const std::string &name)
{
	return name == "CGameRules" || name == "CHalfLifeMultiplay";
}

/**
 * A member's slot, by its class and its name in AMX Mod X's gamedata: what
 * member_get and the rest take. Looked up once; one the gamedata does not
 * have is a slot too, which reads 0 and writes nothing, said once here.
 */
static int32_t w_memberSlot(wasm_exec_env_t env, int32_t classPtr, int32_t namePtr)
{
	std::string className = AsString(Inst(env), classPtr);
	std::string memberName = AsString(Inst(env), namePtr);
	std::string key = className + "::" + memberName;

	std::map<std::string, int>::iterator found = g_memberSlots.find(key);
	if (found != g_memberSlots.end())
		return found->second;

	Member member;
	member.name = key;
	IGameConfig *data = IsRulesClass(className) ? g_rulesData : g_entityData;
	if (!data || !data->GetOffsetByClass(className.c_str(), memberName.c_str(), &member.type) || member.type.fieldOffset < 0) {
		member.type.reset();
		MF_PrintSrvConsole("[amxts] %s is not in AMX Mod X's gamedata on this server: it reads 0 and writes nothing\n", key.c_str());
	}

	int slot = (int)g_members.size();
	g_members.push_back(member);
	g_memberSlots[key] = slot;
	return slot;
}

/** The object a member is read from: an entity's, or the game rules for RULES_ID. */
static char *MemberObject(int32_t id)
{
	if (id == RULES_ID)
		return g_rulesAddress ? (char *)*g_rulesAddress : NULL;
	return ObjectOf(id);
}

/** Where element `element` of a slot's member is in `object`, and its type; NULL for none. */
static char *MemberAt(int32_t id, int32_t slot, int32_t element, const TypeDescription **type)
{
	if (slot < 0 || slot >= (int32_t)g_members.size())
		return NULL;
	const TypeDescription &t = g_members[slot].type;
	if (t.fieldType == FieldType::FIELD_NONE || element < 0)
		return NULL;

	// A vector's element is a component; anything else's an array's element.
	int size = 4;
	int count = t.fieldSize > 0 ? t.fieldSize : 1;
	switch (t.fieldType) {
		case FieldType::FIELD_VECTOR:    count *= 3; break;
		case FieldType::FIELD_EHANDLE:   size = 8; break;
		case FieldType::FIELD_SHORT:     size = 2; break;
		case FieldType::FIELD_CHARACTER:
		case FieldType::FIELD_BOOLEAN:   size = 1; break;
		case FieldType::FIELD_STRING:    size = 0; count = 1; break;
		default: break;
	}
	if (element >= count)
		return NULL;

	char *object = MemberObject(id);
	if (!object)
		return NULL;
	*type = &t;
	return object + t.fieldOffset + element * size;
}

static int32_t w_memberGet(wasm_exec_env_t env, int32_t id, int32_t slot, int32_t element)
{
	const TypeDescription *t = NULL;
	char *at = MemberAt(id, slot, element, &t);
	if (!at)
		return 0;

	switch (t->fieldType) {
		case FieldType::FIELD_SHORT:     return t->fieldUnsigned ? *(uint16_t *)at : *(int16_t *)at;
		case FieldType::FIELD_CHARACTER: return t->fieldUnsigned ? *(uint8_t *)at : *(int8_t *)at;
		case FieldType::FIELD_BOOLEAN:   return *(bool *)at ? 1 : 0;
		case FieldType::FIELD_CLASSPTR:  return IndexOfObject(*(void **)at);
		case FieldType::FIELD_ENTVARS:   return IndexOfEntvars(*(void **)at);
		case FieldType::FIELD_EDICT:     return IndexOf(*(void **)at);
		case FieldType::FIELD_EHANDLE: {
			// An EHANDLE holds the edict and the serial number it had: a freed
			// and reused edict has another, and the handle is empty.
			char *edict = *(char **)at;
			return edict && *(int *)(edict + EDICT_SERIAL) == *(int *)(at + 4) ? IndexOf(edict) : 0;
		}
		case FieldType::FIELD_CLASS:
		case FieldType::FIELD_STRUCTURE: return (int32_t)(intptr_t)at;
		default:                         return *(int32_t *)at;
	}
}

static void w_memberSet(wasm_exec_env_t env, int32_t id, int32_t slot, int32_t element, int32_t cell)
{
	const TypeDescription *t = NULL;
	char *at = MemberAt(id, slot, element, &t);
	if (!at)
		return;

	switch (t->fieldType) {
		case FieldType::FIELD_SHORT:     *(int16_t *)at = (int16_t)cell; break;
		case FieldType::FIELD_CHARACTER: *(int8_t *)at = (int8_t)cell; break;
		case FieldType::FIELD_BOOLEAN:   *(bool *)at = cell != 0; break;
		case FieldType::FIELD_CLASSPTR:  *(void **)at = cell > 0 ? ObjectOf(cell) : NULL; break;
		case FieldType::FIELD_ENTVARS: {
			char *edict = cell > 0 ? EdictOf(cell) : NULL;
			*(void **)at = edict ? edict + EDICT_ENTVARS : NULL;
			break;
		}
		case FieldType::FIELD_EDICT:     *(void **)at = cell > 0 ? EdictOf(cell) : NULL; break;
		case FieldType::FIELD_EHANDLE: {
			char *edict = cell > 0 ? EdictOf(cell) : NULL;
			*(void **)at = edict;
			*(int *)(at + 4) = edict ? *(int *)(edict + EDICT_SERIAL) : 0;
			break;
		}
		// An object or a structure in place is not a number to write.
		case FieldType::FIELD_CLASS:
		case FieldType::FIELD_STRUCTURE:
		case FieldType::FIELD_STRINGPTR:
		case FieldType::FIELD_STRING:    break;
		default:                         *(int32_t *)at = cell; break;
	}
}

/** A text member into the plugin's buffer, as UTF-8; its length. */
static int32_t w_memberText(wasm_exec_env_t env, int32_t id, int32_t slot, int32_t out, int32_t max)
{
	const TypeDescription *t = NULL;
	char *at = MemberAt(id, slot, 0, &t);
	if (!at)
		return WriteBytes(Inst(env), out, max, "");

	if (t->fieldType == FieldType::FIELD_STRING) {
		std::string text(at, strnlen(at, t->fieldSize > 0 ? t->fieldSize : 1));
		return WriteBytes(Inst(env), out, max, text.c_str());
	}
	if (t->fieldType == FieldType::FIELD_STRINGPTR) {
		const char *text = *(const char **)at;
		return WriteBytes(Inst(env), out, max, text ? text : "");
	}
	return WriteBytes(Inst(env), out, max, "");
}

/** Writes a text member that is an array of its own; the rest are the game's to allocate. */
static void w_memberSetText(wasm_exec_env_t env, int32_t id, int32_t slot, int32_t text)
{
	const TypeDescription *t = NULL;
	char *at = MemberAt(id, slot, 0, &t);
	if (!at || t->fieldType != FieldType::FIELD_STRING || t->fieldSize <= 0)
		return;

	std::string value = AsString(Inst(env), text);
	size_t length = value.size() < (size_t)t->fieldSize - 1 ? value.size() : (size_t)t->fieldSize - 1;
	memcpy(at, value.c_str(), length);
	at[length] = '\0';
}

/** 1 when the game rules are read here, 0 when this server's gamedata cannot find them. */
static int32_t w_gameRules(wasm_exec_env_t env)
{
	return g_rulesAddress && g_rulesData ? 1 : 0;
}

#define FIELD_NATIVES \
	{ "ent_get",         (void *)w_entGet,        "(ii)i",    NULL }, \
	{ "ent_set",         (void *)w_entSet,        "(iii)",    NULL }, \
	{ "ent_vector",      (void *)w_entVector,     "(iii)",    NULL }, \
	{ "ent_entity",      (void *)w_entEntity,     "(ii)i",    NULL }, \
	{ "ent_set_entity",  (void *)w_entSetEntity,  "(iii)",    NULL }, \
	{ "member_slot",     (void *)w_memberSlot,    "(ii)i",    NULL }, \
	{ "member_get",      (void *)w_memberGet,     "(iii)i",   NULL }, \
	{ "member_set",      (void *)w_memberSet,     "(iiii)",   NULL }, \
	{ "member_text",     (void *)w_memberText,    "(iiii)i",  NULL }, \
	{ "member_set_text", (void *)w_memberSetText, "(iii)",    NULL }, \
	{ "game_rules",      (void *)w_gameRules,     "()i",      NULL },
