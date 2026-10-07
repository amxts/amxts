// The game's own functions, hooked by the module: ReGameDLL's and ReHLDS's
// hookchains, reached through their APIs, and Ham Sandwich's functions, in
// the entities' vtables at the offsets of AMX Mod X's gamedata. A game event
// goes from the game to the plugins' listeners with no AMX Mod X forward in
// between: the module's hook (hookchains.h, generated) hands the listeners
// the call's arguments as cells, calls what is next in the chain with what
// they left, and answers the game with what they answered.
//
// Included by module.cpp, after Fire and the fields' helpers.

#include <pm_defs.h>
#include "hookchains-api.h"

// The most arguments a hooked function has, `this` included.
#define MAX_CHAIN_ARGS 12

// What a listener says (outcome): the game's function does not run; and it
// does not, nor does any listener after this one (HC_BREAK).
#define OUTCOME_SUPERCEDE 1
#define OUTCOME_BREAK     2

/**
 * Where the module's hook sits in a chain: inside ReAPI's, which registers at
 * the default priority, so a Pawn plugin's pre handler runs first and one
 * that blocks the function keeps it from TypeScript's listeners, as with
 * every other event; the post handlers then come in the other order.
 */
#define CHAIN_PRIORITY (HC_PRIORITY_DEFAULT - 1)

/** What an argument is to the listeners: how it becomes a cell and back. */
enum ArgRole : unsigned char {
	ROLE_INT, ROLE_BOOL, ROLE_FLOAT, ROLE_FLOAT_REF, ROLE_TEXT, ROLE_VECTOR,
	ROLE_CBASE, ROLE_PEV, ROLE_EDICT, ROLE_CLIENT, ROLE_POINTER,
};

/** A plugin's handler of a hooked function, switched off by it while it has no listener (hook_on). */
struct GameHandler : Handler {
	int  reg = 0;
	bool off = false;
};

/**
 * The handlers of one phase, before the game's function or after it,
 * walked in place as a Forward's are: one added meanwhile waits for the next
 * call, one taken off meanwhile is marked and passed over.
 */
struct HookList {
	std::vector<GameHandler> handlers;
	// How many of them are switched on: a phase with none is not walked.
	int  on = 0;
	int  depth = 0;
	bool holes = false;
};

/**
 * One function the module hooks: a hookchain, a Ham Sandwich function in
 * one class's vtable, or one of the engine's and the game's that Metamod
 * gives (enginehooks.h). It is in the game's way only while a handler of it
 * is switched on; a change while a call of it runs waits for the call's end.
 */
struct HookPoint {
	HookList phase[2];
	int   on = 0;
	int   calls = 0;
	bool  dirty = false;
	bool  attached = false;
	// In g_otherPoints, for a plugin's stop and the map's end.
	bool  listed = false;
	// A hookchain's registration with the game, or what counts the points
	// of one Metamod hook in its way; NULL for a Ham Sandwich function.
	void (*attach)(bool on) = NULL;
	// A Ham Sandwich function's slot in a vtable, and what was there.
	int    ham = -1;
	void **vtable = NULL;
	int    slot = 0;
	void  *original = NULL;
};

static void SettleHook(HookPoint &point);

/** A cell for an entity, as reapi gives it: its index, -1 for none. */
static cell CellOfEdict(const edict_t *e)
{
	if (!e)
		return -1;
	FindEdicts();
	return IndexOf(e);
}

static cell CellOfPev(const entvars_t *pev)
{
	return pev ? CellOfEdict(pev->pContainingEntity) : -1;
}

static cell CellOfCbase(const void *object)
{
	return object ? CellOfPev(*(entvars_t **)((const char *)object + g_pevOffset)) : -1;
}

static edict_t *EdictOfCell(cell id)
{
	return id < 0 ? NULL : (edict_t *)EdictOf(id);
}

/** The player a movement chain is about: the playermove the game moves him with, or ReGameDLL's. */
static re::IReGameApi *g_regame;
static int PmovePlayer(playermove_t *pmove)
{
	if (!pmove && g_regame)
		pmove = g_regame->GetPlayerMove();
	return pmove ? pmove->player_index + 1 : 0;
}

/**
 * One call of a hooked function: its arguments as cells, for the listeners
 * to read (arg, arg_text, arg_array) and write (chain_set, chain_set_text,
 * set_arg_array), and its answer. It is the call context while it lasts,
 * as CallArgs is for a forward, and puts back the one it stood in for.
 */
struct ChainCall {
	HookPoint           &point;
	const unsigned char *roles;
	int                  argc;
	cell                 cells[MAX_CHAIN_ARGS];
	// Where a text, a vector or a float passed by reference lies.
	void                *refs[MAX_CHAIN_ARGS];
	// The texts listeners wrote, by argument; made on the first.
	std::string         *texts = NULL;
	unsigned             changed = 0;
	// The function's answer: what a listener answered, or what the game did.
	cell                 result = 0;
	bool                 answered = false;
	const char          *returnedText = NULL;
	float                vector[3] = { 0, 0, 0 };
	bool                 superceded = false;
	bool                 broken = false;
	// Run with { hooks: false }: no listener hears it (HamQuiet).
	bool                 quiet = false;

	CallContext    context;
	CallContext   *saved;

	ALWAYS_INLINE ChainCall(HookPoint &p, const unsigned char *r, int n)
		: point(p), roles(r), argc(n), saved(g_call)
	{
		context.args = cells; context.argc = n; context.chain = this;
		g_call = &context;
		point.calls++;
	}

	ALWAYS_INLINE ~ChainCall()
	{
		g_call = saved;
		if (texts)
			delete[] texts;
		if (--point.calls == 0 && point.dirty)
			SettleHook(point);
	}

	void Int(int i, cell value)           { cells[i] = value; }
	void Bool(int i, bool value)          { cells[i] = value ? 1 : 0; }
	void Float(int i, float value)        { memcpy(&cells[i], &value, sizeof(cell)); }
	void FloatRef(int i, float *value)    { refs[i] = value; Float(i, *value); }
	void Text(int i, const char *value)   { refs[i] = (void *)value; cells[i] = 0; }
	void Vec(int i, void *value)          { refs[i] = value; cells[i] = 0; }
	void Cbase(int i, const void *value)  { cells[i] = CellOfCbase(value); }
	void Pev(int i, const entvars_t *v)   { cells[i] = CellOfPev(v); }
	void Edict(int i, const edict_t *v)   { cells[i] = CellOfEdict(v); }
	void Client(int i, IGameClient *v)    { cells[i] = v ? v->GetId() + 1 : -1; }
	void Pointer(int i, const void *v)    { cells[i] = (cell)(intptr_t)v; }

	bool Changed(int i) const { return (changed & (1u << i)) != 0; }

	// An argument going on to the next hook: what a listener wrote, or as it
	// came. -1 is the answer.
	cell CellAt(int i) const { return i < 0 ? result : cells[i]; }
	bool Written(int i) const { return i < 0 || Changed(i); }

	float FloatAt(int i) const
	{
		float value;
		memcpy(&value, &cells[i], sizeof(float));
		return value;
	}

	const char *TextAt(int i, const char *came) const { return Changed(i) ? texts[i].c_str() : came; }

	void *CbaseAt(int i, void *came) const
	{
		if (!Written(i))
			return came;
		edict_t *e = EdictOfCell(CellAt(i));
		return e ? e->pvPrivateData : NULL;
	}

	entvars_t *PevAt(int i, entvars_t *came) const
	{
		if (!Written(i))
			return came;
		edict_t *e = EdictOfCell(CellAt(i));
		return e ? &e->v : NULL;
	}

	edict_t *EdictAt(int i, edict_t *came) const { return Written(i) ? EdictOfCell(CellAt(i)) : came; }
	void *PointerAt(int i, void *came) const { return Written(i) ? (void *)(intptr_t)CellAt(i) : came; }

	/** The listeners of one phase; a pre listener's outcome blocks the function, a break stops the rest. */
	NO_STACK_COOKIE void Walk(HookList &list, bool pre)
	{
		list.depth++;
		uint32_t argv[MAX_EVENT_ARGS] = { 0 };
		for (int i = 0; i < MAX_EVENT_ARGS && i < argc; i++)
			argv[i] = (uint32_t)cells[i];
		for (size_t i = 0, end = list.handlers.size(); i < end; i++) {
			if (list.handlers[i].off || list.handlers[i].plugin == HANDLER_GONE)
				continue;
			cell outcome = Fire(list.handlers[i], argv, MAX_EVENT_ARGS, 0);
			if (outcome == OUTCOME_BREAK) {
				broken = true;
				break;
			}
			if (outcome != 0 && pre)
				superceded = true;
		}
		if (--list.depth == 0 && list.holes) {
			list.holes = false;
			DropFrom(list.handlers, [](const GameHandler &h) { return h.plugin == HANDLER_GONE; });
		}
	}

	/** The listeners before the game; whether its function runs. */
	bool Pre()
	{
		if (quiet)
			return true;
		if (point.phase[0].on)
			Walk(point.phase[0], true);
		return !superceded && !broken;
	}

	/** The listeners after it, unless one stopped the event. */
	void Post()
	{
		if (!quiet && !broken && point.phase[1].on)
			Walk(point.phase[1], false);
	}

	// What the game answered, kept unless a listener answered first.
	void Returned(cell value)
	{
		if (!answered)
			result = value;
	}

	void ReturnedFloat(float value)
	{
		cell bits;
		memcpy(&bits, &value, sizeof(cell));
		Returned(bits);
	}

	void ReturnedText(const char *value)
	{
		if (!answered)
			returnedText = value;
	}

	void ReturnedVector(const Vector &value)
	{
		if (!answered) {
			vector[0] = value.x;
			vector[1] = value.y;
			vector[2] = value.z;
		}
	}

	float ResultFloat() const
	{
		float value;
		memcpy(&value, &result, sizeof(float));
		return value;
	}

	/**
	 * The text answered: the game's, or a listener's, which outlives the
	 * call in one of a few buffers taken in turn - the game reads it after
	 * the hook has returned.
	 */
	const char *ResultText() const
	{
		if (!answered || !texts)
			return returnedText;
		static std::string kept[4];
		static int next = 0;
		std::string &out = kept[next++ % 4];
		out = texts[MAX_CHAIN_ARGS - 1];
		return out.c_str();
	}

	/**
	 * A function that answers a Vector by reference (FireBullets3): the
	 * game's own, or a listener's in one of a few vectors taken in turn.
	 */
	Vector *returnedVector = NULL;

	void ReturnedVectorRef(Vector *value)
	{
		if (answered)
			return;
		returnedVector = value;
		ReturnedVector(*value);
	}

	Vector *ResultVectorRef() const
	{
		if (!answered && returnedVector)
			return returnedVector;
		static Vector kept[4];
		static int next = 0;
		Vector *out = &kept[next++ % 4];
		ResultVector(out);
		return out;
	}

	void ResultVector(Vector *out) const
	{
		out->x = vector[0];
		out->y = vector[1];
		out->z = vector[2];
	}

	std::string &TextSlot(int i)
	{
		if (!texts)
			texts = new std::string[MAX_CHAIN_ARGS];
		return texts[i];
	}
};

// ---------------------------------------------------------------- the APIs

static re::IReGameHookchains *g_regameChains = NULL;
static re::IRehldsHookchains *g_rehldsChains = NULL;

/** The handle of a library the process has loaded, by its path. */
static void *LoadedLibrary(const char *path)
{
#ifdef _WIN32
	return path ? (void *)GetModuleHandleA(path) : NULL;
#else
	void *handle = path ? dlopen(path, RTLD_NOW | RTLD_NOLOAD) : NULL;
	if (handle)
		dlclose(handle);
	return handle;
#endif
}

static CreateInterfaceFn InterfaceOf(void *library)
{
#ifdef _WIN32
	return library ? (CreateInterfaceFn)GetProcAddress((HMODULE)library, CREATEINTERFACE_PROCNAME) : NULL;
#else
	return library ? (CreateInterfaceFn)dlsym(library, CREATEINTERFACE_PROCNAME) : NULL;
#endif
}

/**
 * ReGameDLL's and ReHLDS's hookchains, asked for once a process: the game
 * DLL's CreateInterface and the engine's (FindRehlds), each of the major
 * version the headers are and at least their minor - as ReAPI asks for them.
 */
static void FindChains()
{
	const char *game = GET_GAME_INFO(PLID, GINFO_REALDLL_FULLPATH);
	CreateInterfaceFn create = InterfaceOf(LoadedLibrary(game));
	re::IReGameApi *api = create ? (re::IReGameApi *)create(VRE_GAMEDLL_API_VERSION, NULL) : NULL;
	if (api && api->GetMajorVersion() == REGAMEDLL_API_VERSION_MAJOR && api->GetMinorVersion() >= REGAMEDLL_API_VERSION_MINOR) {
		g_regame = api;
		g_regameChains = api->GetHookchains();
	}
	else if (api) {
		MF_PrintSrvConsole("[amxts] ReGameDLL's API is %d.%d, and amxts needs %d.%d or later: its game events are heard as on a server without ReGameDLL\n",
		                   api->GetMajorVersion(), api->GetMinorVersion(), REGAMEDLL_API_VERSION_MAJOR, REGAMEDLL_API_VERSION_MINOR);
	}

	if (g_rehlds && g_rehlds->GetMajorVersion() == CHAINS_REHLDS_MAJOR && g_rehlds->GetMinorVersion() >= CHAINS_REHLDS_MINOR)
		g_rehldsChains = (re::IRehldsHookchains *)g_rehlds->GetHookchains();
	else if (g_rehlds)
		MF_PrintSrvConsole("[amxts] ReHLDS's API is %d.%d, and amxts needs %d.%d or later for its engine events\n",
		                   g_rehlds->GetMajorVersion(), g_rehlds->GetMinorVersion(), CHAINS_REHLDS_MAJOR, CHAINS_REHLDS_MINOR);
}

// ---------------------------------------------------------------- Ham Sandwich

/**
 * Ham Sandwich's offsets in the format of AMX Mod X before 1.10, which has no
 * virtual.games in its gamedata: configs/hamdata.ini, a section a game and a
 * system, a mirror game taking another's (`@mirror cstrike czero`).
 */
static std::map<std::string, int> ReadHamData()
{
	std::map<std::string, int> offsets;
	std::string configs = MF_GetLocalInfo("amxx_configsdir", "addons/amxmodx/configs");
	FILE *file = fopen(MF_BuildPathname("%s/hamdata.ini", configs.c_str()), "rt");
	if (!file)
		return offsets;
#ifdef _WIN32
	const char *system = "windows";
#else
	const char *system = "linux";
#endif
	std::string game = MF_GetModname();
	bool in = false;
	char line[256];
	while (fgets(line, sizeof(line), file)) {
		char a[64] = "", b[64] = "", c[64] = "";
		int n = sscanf(line, "%63s %63s %63s", a, b, c);
		if (n <= 0 || a[0] == ';')
			continue;
		if (!strcmp(a, "@mirror") && n >= 3 && game == c)
			game = b;
		else if (!strcmp(a, "@section"))
			in = n >= 3 && game == b && !strcmp(c, system);
		else if (!strcmp(a, "@end"))
			in = false;
		else if (in && n >= 2)
			offsets[a] = (int)strtol(b, NULL, 0);
	}
	fclose(file);
	return offsets;
}

/** A Ham Sandwich function's offset - or "base", "pev" - from the gamedata, else from hamdata.ini. */
static bool HamOffset(const char *key, int *offset)
{
	TypeDescription type;
	if (g_entityData && g_entityData->GetOffset(key, &type)) {
		*offset = type.fieldOffset;
		return true;
	}
	static std::map<std::string, int> legacy = ReadHamData();
	std::map<std::string, int>::iterator it = legacy.find(key);
	if (it == legacy.end())
		return false;
	*offset = it->second;
	return true;
}

/** A game object's vtable: at Ham Sandwich's "base" in it. */
static void **VtableOfObject(const void *object)
{
	static int base = -1;
	if (base < 0 && !HamOffset("base", &base))
		base = 0;
	return *(void ***)((const char *)object + base);
}

/** A class's vtable, from an entity of it made for the moment, as Ham Sandwich finds it; NULL for no such class. */
static void **VtableOf(const std::string &classname)
{
	static std::map<std::string, void **> found;
	std::map<std::string, void **>::iterator it = found.find(classname);
	if (it != found.end())
		return it->second;

	void **vtable = NULL;
	edict_t *e = CREATE_NAMED_ENTITY(ALLOC_STRING(classname.c_str()));
	if (e && e->pvPrivateData)
		vtable = VtableOfObject(e->pvPrivateData);
	if (e)
		REMOVE_ENTITY(e);
	found[classname] = vtable;
	return vtable;
}

/** A slot of a vtable written: the module's function in, or what was there back. */
static void WriteSlot(void **slot, void *value)
{
#ifdef _WIN32
	DWORD was;
	VirtualProtect(slot, sizeof(void *), PAGE_EXECUTE_READWRITE, &was);
	*slot = value;
	VirtualProtect(slot, sizeof(void *), was, &was);
#else
	uintptr_t page = (uintptr_t)sysconf(_SC_PAGESIZE);
	void *start = (void *)((uintptr_t)slot & ~(page - 1));
	mprotect(start, page * 2, PROT_READ | PROT_WRITE | PROT_EXEC);
	*slot = value;
#endif
}

#include "hookchains.h"

/** Each Ham Sandwich function's points, one per vtable it is in. */
static std::deque<HookPoint>  g_hamPoints;
static std::vector<HookPoint *> g_hamByFunction[HAM_COUNT];

/**
 * The point a Ham Sandwich hook was called for: the one of the object's
 * vtable. Something else that hooked the slot after the module - Ham
 * Sandwich itself, for a Pawn plugin - calls the module's hook as the
 * original, with the same object.
 */
static HookPoint *HamPoint(int ham, void *self)
{
	void **vtable = VtableOfObject(self);
	std::vector<HookPoint *> &points = g_hamByFunction[ham];
	for (size_t i = 0; i < points.size(); i++)
		if (points[i]->vtable == vtable)
			return points[i];
	// A vtable the module never wrote cannot reach its hook, so there is one.
	return points[0];
}

// ---------------------------------------------------------------- registrations

/** A plugin's registration with a point (hook, ham): its handle is its place here plus one. */
struct HookReg {
	HookPoint *point;
	int        post;
	int        plugin;
};

static std::vector<HookReg> g_hookRegs;

// The points of the engine's and the game's functions Metamod gives
// (enginehooks.h) a plugin has added a handler to.
static std::vector<HookPoint *> g_otherPoints;

/** Puts the point in the game's way, or takes it out, as its handlers say - later, if a call of it runs. */
static void SettleHook(HookPoint &point)
{
	if (point.calls > 0) {
		point.dirty = true;
		return;
	}
	point.dirty = false;
	bool want = point.on > 0;
	if (want == point.attached)
		return;
	point.attached = want;
	if (point.attach) {
		point.attach(want);
		return;
	}
	if (point.ham < 0)
		return;
	void **slot = point.vtable + point.slot;
	if (want) {
		if (*slot != g_hamInfo[point.ham].hook)
			point.original = *slot;
		WriteSlot(slot, g_hamInfo[point.ham].hook);
	}
	// Only the module's own function goes: one written over it since calls it as its original.
	else if (*slot == g_hamInfo[point.ham].hook) {
		WriteSlot(slot, point.original);
	}
	else {
		point.attached = true;
	}
}

/** A plugin's handler added to a point; its handle. */
static int32_t AddHook(HookPoint &point, int32_t fn, int32_t post)
{
	GameHandler h;
	h.plugin = g_currentPlugin;
	h.fn = (uint32_t)fn;
	h.shape = SHAPE_WIDE;
	h.tag = TakeTag();
	Bind(h);
	HookReg reg = { &point, post ? 1 : 0, g_currentPlugin };
	g_hookRegs.push_back(reg);
	h.reg = (int)g_hookRegs.size();
	point.phase[reg.post].handlers.push_back(h);
	point.phase[reg.post].on++;
	point.on++;
	SettleHook(point);
	return h.reg;
}

/**
 * hook(chain, handler, post) - a handler of a ReGameDLL or ReHLDS hookchain,
 * by reapi's number of it (as/constants.ts). 0 when the server has not the
 * API the chain is of.
 */
static int32_t w_hook(wasm_exec_env_t env, int32_t id, int32_t fn, int32_t post)
{
	(void)env;
	for (int i = 0; i < CHAIN_COUNT; i++) {
		if (g_chainInfo[i].id != id)
			continue;
		if (!(g_chainInfo[i].rehlds ? (void *)g_rehldsChains : (void *)g_regameChains)) {
			TakeTag();
			return 0;
		}
		g_chainPoints[i].attach = g_chainInfo[i].attach;
		return AddHook(g_chainPoints[i], fn, post);
	}
	TakeTag();
	return 0;
}

/**
 * ham(function, class, handler, post) - a handler of a Ham Sandwich function
 * on one class, by its Ham_* number: the module's hook goes into the class's
 * vtable at the gamedata's offset of it. 0 for a class or a function the
 * game does not have.
 */
static int32_t w_ham(wasm_exec_env_t env, int32_t id, int32_t entityClass, int32_t fn, int32_t post)
{
	std::string classname = AsString(Inst(env), entityClass);
	int ham = -1;
	for (int i = 0; i < HAM_COUNT; i++)
		if (g_hamInfo[i].id == id)
			ham = i;
	int offset = 0;
	void **vtable = ham >= 0 ? VtableOf(classname) : NULL;
	if (!vtable || !HamOffset(g_hamInfo[ham].key, &offset)) {
		TakeTag();
		MF_PrintSrvConsole("[amxts] %s cannot be hooked on \"%s\": %s\n", ham >= 0 ? g_hamInfo[ham].key : "a function",
		                   classname.c_str(), !vtable ? "the game has no such class" : "neither the gamedata nor hamdata.ini has its offset");
		return 0;
	}

	HookPoint *point = NULL;
	for (HookPoint *p : g_hamByFunction[ham])
		if (p->vtable == vtable)
			point = p;
	if (!point) {
		g_hamPoints.push_back(HookPoint());
		point = &g_hamPoints.back();
		point->ham = ham;
		point->vtable = vtable;
		point->slot = offset;
		g_hamByFunction[ham].push_back(point);
	}
	return AddHook(*point, fn, post);
}

/** hook_on(handle, on) - a registration switched off while its plugin has no listener for it, and back on. */
static void w_hook_on(wasm_exec_env_t env, int32_t handle, int32_t on)
{
	(void)env;
	if (handle <= 0 || handle > (int32_t)g_hookRegs.size() || g_hookRegs[handle - 1].plugin != g_currentPlugin)
		return;
	HookReg &reg = g_hookRegs[handle - 1];
	for (GameHandler &h : reg.point->phase[reg.post].handlers) {
		if (h.reg != handle || h.off == !on)
			continue;
		h.off = !on;
		reg.point->phase[reg.post].on += on ? 1 : -1;
		reg.point->on += on ? 1 : -1;
		SettleHook(*reg.point);
	}
}

/**
 * hook_direct(handle, listener, env, event object) - a registration's
 * handler calls its one listener itself, with the event's object
 * (Handler.via); listener 0 has the handler called again.
 */
static void w_hook_direct(wasm_exec_env_t env, int32_t handle, int32_t target, int32_t closure, int32_t arg)
{
	(void)env;
	if (handle <= 0 || handle > (int32_t)g_hookRegs.size() || g_hookRegs[handle - 1].plugin != g_currentPlugin)
		return;
	HookReg &reg = g_hookRegs[handle - 1];
	for (GameHandler &h : reg.point->phase[reg.post].handlers)
		if (h.reg == handle)
			Direct(h, target, closure, arg, false);
}

/**
 * chain_set(index, cell) - an argument of the hooked call written, as reapi's
 * SetHookChainArg: the next hook gets it. -1 is the answer: the function's
 * result, and what it answers when it is blocked.
 */
static void w_chain_set(wasm_exec_env_t env, int32_t index, int32_t value)
{
	(void)env;
	ChainCall *call = g_call->chain;
	if (!call || index < -1 || index >= call->argc)
		return;
	if (index < 0) {
		call->result = value;
		call->answered = true;
		return;
	}
	call->cells[index] = value;
	call->changed |= 1u << index;
	if (call->roles[index] == ROLE_FLOAT_REF)
		memcpy(call->refs[index], &value, sizeof(float));
}

/** chain_set_text(index, text) - a text argument written, or the text answered (-1). */
static void w_chain_set_text(wasm_exec_env_t env, int32_t index, int32_t text)
{
	ChainCall *call = g_call->chain;
	if (!call || index < -1 || index >= call->argc)
		return;
	call->TextSlot(index < 0 ? MAX_CHAIN_ARGS - 1 : index) = AsString(Inst(env), text);
	if (index < 0)
		call->answered = true;
	else
		call->changed |= 1u << index;
}

/**
 * chain_dispatch(chain, post, cells, count, result) - one phase of a
 * hookchain's listeners run for a call the game did not make: game.endRound's
 * dispatch, which ReAPI's rg_round_end hands its own forwards alone. `cells`
 * are the arguments, read back as the listeners left them; `result` is the
 * answer a post listener reads. 1 when a pre listener blocked the call, 2
 * when one stopped it.
 */
static int32_t w_chain_dispatch(wasm_exec_env_t env, int32_t id, int32_t post, int32_t cellsPtr, int32_t count, int32_t result)
{
	static const unsigned char roles[MAX_CHAIN_ARGS] = { ROLE_INT };
	wasm_module_inst_t inst = Inst(env);
	if (count < 0 || count > MAX_CHAIN_ARGS || !wasm_runtime_validate_app_addr(inst, (uint64_t)cellsPtr, (uint64_t)count * 4))
		return 0;
	HookPoint *point = NULL;
	for (int i = 0; i < CHAIN_COUNT; i++)
		if (g_chainInfo[i].id == id)
			point = &g_chainPoints[i];
	if (!point)
		return 0;
	int32_t *cells = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)cellsPtr);
	ChainCall call(*point, roles, count);
	memcpy(call.cells, cells, (size_t)count * sizeof(cell));
	call.result = result;
	if (post)
		call.Post();
	else
		call.Pre();
	memcpy(cells, call.cells, (size_t)count * sizeof(cell));
	return (call.superceded ? 1 : 0) | (call.broken ? 2 : 0);
}

/** game_api() - what the server has: 1 ReGameDLL's hookchains, 2 ReHLDS's. */
static int32_t w_game_api(wasm_exec_env_t env)
{
	(void)env;
	return (g_regameChains ? 1 : 0) | (g_rehldsChains ? 2 : 0);
}

/** The running hooked call's answer as a cell (arg(-1)). */
static cell ChainResult()
{
	return g_call->chain->result;
}

/** A listener answered the running hooked call with a vector (set_arg_array(-1)). */
static void ChainAnswered()
{
	g_call->chain->answered = true;
}

/** A hooked call's text argument, or the text it answers (-1); NULL for none. */
static const char *ChainText(int32_t index)
{
	ChainCall *call = g_call->chain;
	if (index < 0)
		return call->answered && call->texts ? call->texts[MAX_CHAIN_ARGS - 1].c_str() : call->returnedText;
	if (index >= call->argc || call->roles[index] != ROLE_TEXT)
		return NULL;
	return call->TextAt(index, (const char *)call->refs[index]);
}

/** A hooked call's vector argument, or the vector it answers (-1); NULL for none. */
static float *ChainVector(int32_t index)
{
	ChainCall *call = g_call->chain;
	if (index < 0)
		return call->vector;
	if (index >= call->argc || call->roles[index] != ROLE_VECTOR)
		return NULL;
	return (float *)call->refs[index];
}

/** Whether the Ham Sandwich function's call on `self` is the one { hooks: false } runs: it is, once. */
static bool HamQuiet(int ham, void *self)
{
	if (g_hamQuiet != ham || CellOfCbase(self) != g_hamQuietId)
		return false;
	g_hamQuiet = -1;
	return true;
}

/** ham_bypass(function, entity) - the native about to run calls the entity's function without the listeners. */
static void w_ham_bypass(wasm_exec_env_t env, int32_t id, int32_t entity)
{
	(void)env;
	g_hamQuiet = -1;
	for (int i = 0; i < HAM_COUNT; i++)
		if (g_hamInfo[i].id == id)
			g_hamQuiet = i;
	g_hamQuietId = entity;
}

/** A plugin that stops takes its handlers along (ReleasePlugin). */
static void DropGameHooks(int plugin)
{
	auto drop = [plugin](HookPoint &point) {
		for (HookList &list : point.phase) {
			for (GameHandler &h : list.handlers) {
				if (h.plugin != plugin)
					continue;
				if (!h.off) {
					list.on--;
					point.on--;
				}
				h.off = true;
				h.plugin = HANDLER_GONE;
				list.holes = true;
			}
			if (list.depth == 0 && list.holes) {
				list.holes = false;
				DropFrom(list.handlers, [](const GameHandler &h) { return h.plugin == HANDLER_GONE; });
			}
		}
		SettleHook(point);
	};
	for (HookPoint &point : g_chainPoints)
		drop(point);
	for (HookPoint &point : g_hamPoints)
		drop(point);
	for (HookPoint *point : g_otherPoints)
		drop(*point);
	for (HookReg &reg : g_hookRegs)
		if (reg.plugin == plugin)
			reg.plugin = SLOT_ORPHANED;
}

/** A plugin's handlers it added before it had its instance - at its top level - bound (BindAll). */
static void BindGameHooks(int plugin)
{
	auto bind = [plugin](HookPoint &point) {
		for (HookList &list : point.phase)
			for (GameHandler &h : list.handlers)
				if (h.plugin == plugin) Bind(h);
	};
	for (HookPoint &point : g_chainPoints)
		bind(point);
	for (HookPoint &point : g_hamPoints)
		bind(point);
	for (HookPoint *point : g_otherPoints)
		bind(*point);
}

/** A map's end: every handler goes with the plugins, and the module is out of the game's way. */
static void TeardownGameHooks()
{
	auto clear = [](HookPoint &point) {
		point.phase[0].handlers.clear();
		point.phase[1].handlers.clear();
		point.phase[0].on = point.phase[1].on = 0;
		point.on = 0;
		SettleHook(point);
	};
	for (HookPoint &point : g_chainPoints)
		clear(point);
	for (HookPoint &point : g_hamPoints)
		clear(point);
	for (HookPoint *point : g_otherPoints) {
		clear(*point);
		point->listed = false;
	}
	g_otherPoints.clear();
	g_hookRegs.clear();
}
