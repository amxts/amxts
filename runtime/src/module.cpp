// amxts runtime — AssemblyScript compiled to WebAssembly, run AOT inside an
// AMX Mod X module.
//
// The idea is unchanged from the QuickJS runtime this replaces: instead of a
// binding per native, resolve natives by name in one native table. The table
// is the natives' image's: a generated script that holds no logic, which the
// module carries and loads with AMX Mod X's LoadAmxScript every map
// (LoadImage). AMX Mod X binds there what every module and every Pawn plugin
// gives; everything else - the forwards, the commands, the hooks - the module
// does itself, so a server installs the module alone.
//
// What changed is the engine. A plugin is now a .aot file produced by
// `asc` and `wamrc`, so its code is machine code by the time the server loads
// it, and a call into a host native is a direct call rather than an
// interpreter round trip.
// The network client's headers come first: curl's winsock2.h before anything
// that brings windows.h in, and <thread> before amxxmodule.h, whose `#define
// execv _execv` breaks the process.h it reads on Windows.
#include <curl/curl.h>
#include <mutex>
#include <thread>
#include "amxxmodule.h"
#include "usercmd.h"
#include <resdk/engine/rehlds_api.h>
#include "wasm_export.h"

// The Half-Life SDK's min and max macros break the C++ library's headers.
#undef min
#undef max

#include <ctype.h>
#include <stdarg.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#include <intrin.h>
#else
#include <dlfcn.h>
#include <pthread.h>
#include <elf.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/mman.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <set>
#include <unordered_map>
#include <algorithm>
#include <utility>

// ---------------------------------------------------------------- amx layout

// amxxmodule.h declares AMX but not the .amx header format. Copied from amxmodx/amx.h.
#pragma pack(push, 1)
struct AmxHeader {
	int32_t  size;
	uint16_t magic;
	char     file_version;
	char     amx_version;
	int16_t  flags;
	int16_t  defsize;
	int32_t  cod, dat, hea, stp, cip;
	int32_t  publics, natives, libraries, pubvars, tags, nametable;
};
struct FuncStub   { ucell address; char name[20]; };  // sEXPMAX + 1
struct FuncStubNT { ucell address; ucell nameofs; };
#pragma pack(pop)

// ---------------------------------------------------------------- state

// The natives' image's AMX while a map runs, NULL between maps (LoadImage).
static AMX *g_image = NULL;

// Whether the image has every native the map will have: loaded once the
// plugins are, not the one the first map's plugins load with (OnAmxxAttach).
static bool g_imageComplete = false;

#include "coroutine.h"

// What a plugin of the list is now (amxts_plugins): running; unloaded by
// amxts_unload, until amxts_load or the map changes; refused - it did not
// compile or load, and Plugin.reason says why; waiting - a new entry nothing
// has loaded yet; or loading - LoadEntry is on it, and its top level or
// init() may be running.
#define PLUGIN_RUNNING  0
#define PLUGIN_UNLOADED 1
#define PLUGIN_REFUSED  2
#define PLUGIN_WAITING  3
#define PLUGIN_LOADING  4

struct Plugin {
	// The plugins.ini line - "shop.ts" - or what amxts_load was given.
	std::string          name;
	// The .aot: the line's file, or for a .ts the build beside the list.
	std::string          path;
	// The .ts this was compiled from, when it was written as one. The watcher
	// follows whichever file the author edits: the source if there is one, the
	// .aot if the author builds elsewhere and drops the result in.
	std::string          source;
	time_t               sourceStamp = 0;
	// When the .aot was last written.
	time_t               stamp = 0;
	// Named in plugins.ini, rather than loaded by hand with amxts_load.
	bool                 listed = true;
	int                  state = PLUGIN_WAITING;
	std::string          reason;
	unsigned char       *file = NULL;
	wasm_module_t        module = NULL;
	wasm_module_inst_t   inst = NULL;
	wasm_exec_env_t      env = NULL;
	// The function table the plugin exports (asc --exportTable), for reading
	// a handler's parameter types before calling it. See Fire.
	wasm_table_inst_t    table;
	bool                 hasTable = false;
	// What plugin() declared, for the listing. AMX Mod X has no entry for an
	// amxts plugin, so this is the only place their names exist.
	std::string          title;
	std::string          version;
	std::string          author;
	std::string          description;
	// The shared modules this plugin calls another plugin for (w_owner): the
	// plugins that go with an owner when it is reloaded, and keep it loaded.
	// Their owners hear when it stops (TellOwners).
	std::vector<std::string> uses;
	// This run of the plugin: a number no other load has had, 0 while none
	// runs. A function it hands another plugin is called back by it (w_rpc),
	// so a call to a run that has ended is refused rather than reaching
	// whatever runs at its index now.
	int32_t              run = 0;
	// It called a function of a run that has ended, and was told so: once a run.
	bool                 toldGone = false;
	// Coroutines - async functions parked at an await; see "coroutines" below.
	// A plugin that never makes a Promise has none of this in use.
	int                  depth = 0;          // this plugin's wasm calls on the native stack
	bool                 wake = false;       // it has jobs, to run once depth is 0
	bool                 entering = false;   // co_spawn is calling an async function's body
	uint32_t             stackTop = 0;       // __stack_pointer with nothing running; 0 without async
	std::map<int32_t, Coroutine> coroutines;
	std::vector<int32_t> running;        // coroutines being run, innermost last
	// The facade's table of the slots a new player took, in the plugin's
	// memory (player_slots); 0 until it gives one.
	int32_t              playerSlots = 0;
	// Its table of each slot's count of name changes (player_names); 0 until
	// it gives one.
	int32_t              playerNames = 0;
};

/**
 * Every plugin of the list, and every one loaded by hand, whatever its state:
 * an index into it is how a handler, a slot or a native names its plugin, so
 * an entry stays where it is for as long as the plugins are not all reloaded
 * - a plugin unloaded or loaded again keeps its index. A failed one is here
 * too, because the watcher walks this list: without it, fixing the mistake in
 * the editor would do nothing at all until the next map change, which is the
 * moment an author is most likely to be watching for something to happen.
 *
 * A deque, so that an entry stays where it is in memory as well: Fire, w_rpc
 * and InitPlugin hold their plugin's entry across its call, and the call can
 * add an entry - amxts_load of a plugin the list does not name, run with
 * server_exec. A vector would move every entry then, and the `depth--` after
 * the call would land in freed memory, leaving the plugin's async functions
 * asleep for good. Nothing takes one entry out; only a reload of every plugin
 * replaces them all, and it is refused while any of them has a call on the
 * stack (ReloadPlugins).
 */
static std::deque<Plugin> g_plugins;

// LoadScripts is loading every plugin: one that amxts_load starts meanwhile
// hears plugin_init with the rest, not on its own (StartPlugins).
static bool g_loadingAll = false;

// Which plugin a host native is running on behalf of. wasm_exec_env_t carries
// the module instance, so this is only needed where a native has to hand a
// callback back to the right plugin.
static int g_currentPlugin = -1;

/**
 * What the handler now running wants AMX Mod X to do, if it said anything.
 *
 * A handler used to return this, which meant every one of them ended in
 * `return Continue;` - a line about the bridge rather than about the plugin.
 * Saying it out of band means a handler returns nothing at all, and the one
 * in ten that wants to stop an event calls handled() instead.
 */
static cell g_outcome = 0;
static bool g_outcomeSaid = false;

// A handler is a function table index inside one plugin's module.
//
// Two shapes exist, because call_indirect needs the exact type and most
// handlers want neither the extra arguments nor the returning:
//
//   NARROW  (i32) -> void       a player id, nothing to say back
//   WIDE    (i32 x4) -> i32     up to four cells, and PLUGIN_HANDLED
#define SHAPE_NARROW 0
#define SHAPE_WIDE   1

#define MAX_EVENT_ARGS 4

// Set on what w_slot returns when the name is one the plugin already had
// before a reload, and the registration with it. The facade declares the same
// value; it is the difference between "here is your public" and "your public
// is already registered, do not register it twice". A bit above every index
// the table reaches, so it cannot be mistaken for one.
#define SLOT_REUSED 0x40000000

// Set on a public's index (PawnFunction) when the name is a publicFor name:
// the module calls its handler itself.
#define PUBLIC_FOR 0x20000000

// The most arguments an AMX Mod X forward carries (FORWARD_MAX_PARAMS in
// amxmodx/CForward.h).
#define MAX_FORWARD_ARGS 32

struct Handler {
	int      plugin;
	uint32_t fn;
	int      shape;
	/**
	 * Nonzero for a closure: fn is then the plugin's dispatcher for the shape,
	 * called with this number first, and the dispatcher finds the closure by
	 * it. A closure is a table entry and its variables together, and the entry
	 * alone would run without them. See w_tag and hostIndex in as/facade.ts.
	 */
	int32_t  tag = 0;
	/**
	 * on_cell's filter: the forward reaches the handler only when its argument
	 * at whereArg is whereValue - compared here, so a forward that fires on
	 * every shot (pfn_playbackevent) crosses into the plugin for its one event
	 * alone. -1 for none.
	 */
	int      whereArg = -1;
	cell     whereValue = 0;
	/**
	 * A command's admin flags (get_user_flags' bits): a player with none of
	 * them does not reach the handler. 0 for everyone.
	 */
	int      access = 0;
	/**
	 * What Fire calls, looked up once, when the handler is registered (Bind):
	 * the function and the kinds of its parameters. NULL when the plugin
	 * exports no table; Fire then calls it by its index.
	 */
	wasm_function_inst_t func = NULL;
	uint32_t       count = 0;
	wasm_valkind_t kinds[MAX_EVENT_ARGS + 1];
	/**
	 * The function's machine code, when Fire calls it itself (CallDirect):
	 * every parameter an i32, or every one an f64 - a plugin's `number` -
	 * and no fraction answered, which the x87 would keep. NULL for any other
	 * shape, which goes through WAMR's call.
	 */
	void          *entry = NULL;
	bool           doubles = false;
};

/** Looks up what Fire calls for `h` (Handler.func): once, as its plugin registers it. */
static void Bind(Handler &h)
{
	h.func = NULL;
	h.entry = NULL;
	if (h.plugin < 0 || (size_t)h.plugin >= g_plugins.size())
		return;
	Plugin &p = g_plugins[h.plugin];
	if (!p.inst || !p.hasTable)
		return;

	// A timer binds the same function at every arm: the last one bound is
	// kept, by the run of its plugin, which no other load shares.
	static Handler last;
	static int32_t lastRun = 0;
	if (p.run == lastRun && h.fn == last.fn) {
		h.func = last.func;
		h.count = last.count;
		memcpy(h.kinds, last.kinds, sizeof(h.kinds));
		h.entry = last.entry;
		h.doubles = last.doubles;
		return;
	}

	wasm_function_inst_t func = wasm_table_get_func_inst(p.inst, &p.table, h.fn);
	// More parameters than Fire passes: called by its index, it traps on its type.
	if (!func || wasm_func_get_param_count(func, p.inst) > (uint32_t)(MAX_EVENT_ARGS + 1))
		return;

	h.count = wasm_func_get_param_count(func, p.inst);
	wasm_func_get_param_types(func, p.inst, h.kinds);
	h.func = func;

	uint32_t ints = 0, doubles = 0;
	for (uint32_t i = 0; i < h.count; i++) {
		ints += h.kinds[i] == WASM_I32;
		doubles += h.kinds[i] == WASM_F64;
	}
	uint32_t results = wasm_func_get_result_count(func, p.inst);
	wasm_valkind_t result = WASM_I32;
	if (results == 1)
		wasm_func_get_result_types(func, p.inst, &result);
	bool shape = ints == h.count || (doubles == h.count && h.count <= MAX_EVENT_ARGS);
	if (shape && results <= 1 && (result == WASM_I32 || result == WASM_I64))
		h.entry = wasm_runtime_direct_entry(func);
	h.doubles = doubles > 0;
	last = h;
	lastRun = p.run;
}

/**
 * Calls `h`'s machine code itself (Handler.entry), its cells given as its
 * parameters take them: the call WAMR's wasm_runtime_call_wasm makes, less
 * what it asks of a function it has not seen. Whether it ended without a trap.
 */
static bool CallDirect(const Handler &h, wasm_exec_env_t env, const uint32_t *call)
{
	void *mark;
	if (!wasm_runtime_direct_begin(env, h.func, &mark))
		return wasm_runtime_direct_end(env, mark);

	typedef wasm_exec_env_t E;
	const int32_t *c = (const int32_t *)call;
	void *fn = h.entry;
	if (h.doubles) {
		switch (h.count) {
			case 1: ((void (*)(E, double))fn)(env, c[0]); break;
			case 2: ((void (*)(E, double, double))fn)(env, c[0], c[1]); break;
			case 3: ((void (*)(E, double, double, double))fn)(env, c[0], c[1], c[2]); break;
			default: ((void (*)(E, double, double, double, double))fn)(env, c[0], c[1], c[2], c[3]); break;
		}
	}
	else {
		switch (h.count) {
			case 0: ((void (*)(E))fn)(env); break;
			case 1: ((void (*)(E, int32_t))fn)(env, c[0]); break;
			case 2: ((void (*)(E, int32_t, int32_t))fn)(env, c[0], c[1]); break;
			case 3: ((void (*)(E, int32_t, int32_t, int32_t))fn)(env, c[0], c[1], c[2]); break;
			case 4: ((void (*)(E, int32_t, int32_t, int32_t, int32_t))fn)(env, c[0], c[1], c[2], c[3]); break;
			default: ((void (*)(E, int32_t, int32_t, int32_t, int32_t, int32_t))fn)(env, c[0], c[1], c[2], c[3], c[4]); break;
		}
	}
	return wasm_runtime_direct_end(env, mark);
}

/**
 * Forward.subscribe(): a TypeScript plugin listening to a forward by name.
 *
 * The handler is the facade's trampoline, called with the tag alone: it says
 * which Forward object of that plugin it is for - a trampoline cannot capture
 * its Forward - and the Forward reads the arguments, as many as there are,
 * from the call's context (CallArgs): a number as it is, a string or an array
 * where it lies in the AMX that carries it. Reached three ways: Dispatch,
 * when the forward is one the module raises itself (g_forwards); a Pawn
 * plugin's ExecuteForward, which the module stands in for
 * (DeliverToSubscribers); and emit_local, when a TypeScript plugin fires one.
 */
struct Subscription {
	Handler handler;
	int32_t tag;
};

/**
 * The listeners of one forward the module raises: its handlers (on) and its
 * Forward subscribers (subscribe).
 *
 * A dispatch walks the lists in place, by index, up to the length they had
 * when it began, so a handler added meanwhile waits for the next call. One
 * taken off meanwhile is only marked (HANDLER_GONE) and passed over, and the
 * lists lose their marks when the outermost dispatch returns: erasing it
 * then and there would move the next one under the walk's index.
 */
struct Forward {
	std::vector<Handler>      handlers;
	std::vector<Subscription> subscribers;
	int                       depth = 0;
	bool                      holes = false;
};

// A handler taken off its forward during a dispatch of it (Forward).
#define HANDLER_GONE (-1)

// g_forwardNames and FORWARD_*: the forwards of AMX Mod X and its modules
// the module raises itself, from its own hooks, by number.
#include "forwards.h"

static Forward g_forwards[FORWARD_COUNT];

// The subscribers of every other forward: a Pawn plugin's, which its
// ExecuteForward delivers (DeliverToSubscribers), and a TypeScript plugin's
// (emit_local).
static std::map<std::string, std::vector<Subscription> > g_subscriptions;

// Moves on whenever g_subscriptions may have a name more or fewer, so that
// what a Pawn forward found there (PawnForward) is looked up again.
static unsigned g_subscriptionNames = 1;

/**
 * A handler a plugin hands on by a public's name (publicFor): "__amxts_cb<n>",
 * n its index here. No script has such a public: the natives that take one
 * from a TypeScript plugin are the module's own (register_menucmd, a
 * PawnFunction's call), and find the handler by the name. Each map starts the
 * table empty.
 */
struct Slot : Handler {
	/**
	 * What the caller gets when the handler says nothing.
	 *
	 * It is not one value for everyone: a command wants PLUGIN_HANDLED, a
	 * fakemeta forward FMRES_IGNORED - and FMRES_IGNORED is 1, so answering
	 * PLUGIN_CONTINUE there would be read as something else. So whoever takes
	 * the name says what silence means.
	 */
	cell     fallback;
	// What this name was registered for: "think:myplugin_box", a menu's. A
	// registration is not undone, so on a reload the plugin takes its own
	// names back by this key rather than registering a second time.
	std::string key;
};

// What a name or an exported native becomes when the plugin holding it is
// reloaded away: a registration outlives the handler and has to land
// somewhere harmless.
#define SLOT_ORPHANED (-6)

static std::vector<Slot> g_slots;

// The prefix of a publicFor name; the index follows.
#define PUBLIC_PREFIX "__amxts_cb"

/** The index of a publicFor name in g_slots; -1 when `name` is not one. */
static int SlotOf(const char *name)
{
	size_t prefix = sizeof(PUBLIC_PREFIX) - 1;
	if (!name || strncmp(name, PUBLIC_PREFIX, prefix) || !isdigit((unsigned char)name[prefix]))
		return -1;
	char *end = NULL;
	long index = strtol(name + prefix, &end, 10);
	return *end || index < 0 || (size_t)index >= g_slots.size() ? -1 : (int)index;
}

// The most arguments an exported native reads, as the author's docs say:
// AMX Mod X's limit for a native a plugin registers (CALLFUNC_MAXPARAMS).
#define MAX_NATIVE_ARGS  64

/**
 * A native a plugin exports for other plugins to call.
 *
 * The exported natives are the module's own: one list given to MF_AddNatives
 * (g_exportedList), which AMX Mod X takes only in AMXX_Attach - so it is
 * given once a process, with room - but keeps by its pointer and reads again
 * as each plugin loads. A name goes into it the first time a plugin exports
 * it and stays for the process: a plugin that loads later binds it, and a
 * name added mid-map reaches the Pawn plugins of the next map. The entry at
 * slot k is ExportedEntry<k>, so a call knows its native by its function
 * alone; g_exported[k] is that native's handler, the plugin that exports it
 * now, or none (SLOT_ORPHANED) - a call then answers 0.
 */
struct Exported : Handler {
	std::string name;
};

static std::vector<Exported> g_exported;
static std::map<std::string, size_t> g_exportedByName;

// The names the list has room for over the process.
#define MAX_EXPORTED 4096

static AMX_NATIVE_INFO g_exportedList[MAX_EXPORTED + 1];

static cell CallExported(size_t slot, AMX *amx, cell *params);

template <size_t K>
static cell AMX_NATIVE_CALL ExportedEntry(AMX *amx, cell *params)
{
	return CallExported(K, amx, params);
}

template <size_t... K>
static const AMX_NATIVE *ExportedEntries(std::index_sequence<K...>)
{
	static const AMX_NATIVE entries[] = { ExportedEntry<K>... };
	return entries;
}

static const AMX_NATIVE *const g_exportedEntries = ExportedEntries(std::make_index_sequence<MAX_EXPORTED>());

/**
 * A forward a Pawn plugin made with CreateMultiForward, which a TypeScript
 * Forward hears by its name. AMX Mod X calls a forward's publics in plugins
 * only, so the module stands in for the natives that make and execute one in
 * every Pawn plugin's native table (InterposeNatives): CreateMultiForward
 * notes the forward by its id, PrepareArray where an array lies, and
 * ExecuteForward, once AMX Mod X has run the Pawn plugins' publics, hands the
 * call to the TypeScript subscribers. A forward lives one map, as AMX Mod X's.
 */
struct PawnForward {
	std::string name;
	// FP_* for each parameter.
	std::vector<cell> types;
	// The forward's TypeScript subscribers, NULL for none, as g_subscriptions
	// had them when g_subscriptionNames was `seen`.
	const std::vector<Subscription> *subscribers = NULL;
	unsigned seen = 0;
};

// By id >> 1: the ids of AMX Mod X's forwards for every plugin are even.
static std::vector<PawnForward> g_pawnForwards;

/**
 * A native of the image's table: its function, its index there, and the AMX
 * it is called with - the image's, or for a native a Pawn plugin registers a
 * loaded Pawn plugin's (Carrier).
 */
struct Resolved {
	AMX_NATIVE fn;
	int        index;
	AMX       *amx;
};

static std::map<std::string, Resolved> g_nativeCache;

/**
 * Which image the resolved natives belong to.
 *
 * The module loads the image anew every map, so a pointer harvested from the
 * old one is a call into freed memory. Each thunk keeps its own resolved
 * pointer and compares this number rather than asking again, which is the
 * difference between a call and a std::map lookup keyed by a string:
 * measured on the live server, a thousand calls took 57 microseconds with the
 * lookup.
 */
static int g_nativeGeneration = 0;

// ---------------------------------------------------------------- native lookup

/** How many natives an AMX image's table holds. */
static int NativeCount(AMX *amx)
{
	AmxHeader *hdr = (AmxHeader *)amx->base;
	return (hdr->libraries - hdr->natives) / hdr->defsize;
}

/** The entry `index` of an AMX image's native table: the name, and the function in `fn`. */
static const char *NativeEntry(AMX *amx, int index, AMX_NATIVE *fn)
{
	AmxHeader *hdr = (AmxHeader *)amx->base;
	unsigned char *e = amx->base + hdr->natives + index * hdr->defsize;
	// address is the first field in both record layouts
	if (fn)
		*fn = (AMX_NATIVE)(void *)((FuncStubNT *)e)->address;
	return hdr->defsize == sizeof(FuncStubNT)
		? (const char *)(amx->base + ((FuncStubNT *)e)->nameofs)
		: ((FuncStub *)e)->name;
}

/** Points entry `index` of an AMX image's native table at `fn`: what its call instruction runs from then on. */
static void SetNativeEntry(AMX *amx, int index, AMX_NATIVE fn)
{
	AmxHeader *hdr = (AmxHeader *)amx->base;
	((FuncStubNT *)(amx->base + hdr->natives + index * hdr->defsize))->address = (ucell)(size_t)(void *)fn;
}

/**
 * Binds `native` in every loaded script whose entry of its name is unbound,
 * as AMX Mod X binds a module's list when a plugin loads. On the first map
 * the TypeScript plugins load before any Pawn plugin (OnAmxxAttach), and AMX
 * Mod X finds the name in the list as each Pawn plugin loads; on a later map
 * they load after the Pawn plugins are finalized, where an unbound entry is a
 * plugin's that failed to load, and one a native filter took points
 * elsewhere: a name added then reaches the next map. The image is bound here.
 */
static void BindLoaded(const AMX_NATIVE_INFO &native)
{
	for (int i = 0; AMX *amx = MF_GetScriptAmx(i); i++) {
		for (int k = 0, count = NativeCount(amx); k < count; k++) {
			AMX_NATIVE fn = NULL;
			if (!strcmp(NativeEntry(amx, k, &fn), native.name) && !fn)
				SetNativeEntry(amx, k, native.func);
		}
	}
}

// A native the module does itself in place of the one in the image's table (g_ownNatives).
static AMX_NATIVE OwnNative(const char *name, AMX_NATIVE fn);

// A native that needs the Pawn plugin calling it: NULL, or for some of its calls a guard (g_needsPlugin).
static AMX_NATIVE NeedsPlugin(const char *name, AMX_NATIVE fn);

/**
 * Each loaded Pawn plugin's AMX, by its AMX Mod X id; NULL for an id that is
 * not a plugin's. Read every map once the plugins have loaded (FindPlugins),
 * as get_plugin(-1) answers in each script - AMX Mod X loads plugins only as
 * a map starts.
 */
static std::vector<AMX *> g_pluginAmx;

/** Whether `fn` is code of a loaded module (a DLL or a shared object), not code AMX Mod X made at run time. */
static bool InLoadedLibrary(AMX_NATIVE fn)
{
#ifdef _WIN32
	HMODULE module = NULL;
	return GetModuleHandleExA(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
	                          (LPCSTR)(void *)fn, &module) != 0;
#else
	Dl_info info;
	return dladdr((void *)fn, &info) != 0 && info.dli_fname;
#endif
}

/**
 * The AMX a native a Pawn plugin registers is called with: a loaded Pawn
 * plugin's, the one with the most room on its heap, where the call's strings
 * and arrays cross. AMX Mod X hands such a native's handler the calling
 * plugin's id without asking whether there is one, so the image, which is
 * not a plugin, cannot call it. NULL when no Pawn plugin is loaded.
 */
static AMX *Carrier()
{
	AMX *best = NULL;
	for (AMX *amx : g_pluginAmx)
		if (amx && (!best || amx->stk - amx->hea > best->stk - best->hea))
			best = amx;
	return best;
}

static Resolved FindNative(const char *name)
{
	Resolved none = { NULL, 0, NULL };
	if (!g_image)
		return none;

	std::map<std::string, Resolved>::iterator c = g_nativeCache.find(name);
	if (c != g_nativeCache.end())
		return c->second;

	int count = NativeCount(g_image);
	for (int i = 0; i < count; i++) {
		AMX_NATIVE fn = NULL;
		if (strcmp(NativeEntry(g_image, i, &fn), name))
			continue;

		// A native no module or plugin gives - a module the server does not
		// load - stays unbound: its calls answer 0, said once. Not on the first
		// map's first image, which has the modules loaded so far alone.
		static std::set<std::string> missing;
		if (!fn && g_imageComplete && missing.insert(name).second)
			MF_PrintSrvConsole("[amxts] %s is not on this server: the module or plugin that provides it is not loaded. Its calls do nothing and answer 0\n", name);

		Resolved found = { NeedsPlugin(name, OwnNative(name, fn)), i, g_image };
		// Made at run time: a native a Pawn plugin registered (register_native).
		if (found.fn && !InLoadedLibrary(found.fn)) {
			found.amx = Carrier();
			if (!found.amx) {
				MF_PrintSrvConsole("[amxts] %s is a Pawn plugin's native, called with a loaded Pawn plugin, and none is loaded: its calls answer 0\n", name);
				found.fn = NULL;
			}
		}
		g_nativeCache[name] = found;
		return found;
	}

	MF_PrintSrvConsole("[amxts] native %s is not in the natives' image - regenerate amxts_natives.sma\n", name);
	g_nativeCache[name] = none;
	return none;
}

// What every thunk does on its way to a native, written into each thunk:
// left to the compiler, which sees a thousand callers, it stays a call.
#ifdef _MSC_VER
#define ALWAYS_INLINE __forceinline
#else
#define ALWAYS_INLINE inline __attribute__((always_inline))
#endif

// amxmodx/amx.h: the usertags slot that holds the native being run.
#define UT_NATIVE 3

/**
 * Calls a native of the image's table the way the AMX's own call instruction
 * does.
 *
 * AMX Mod X names the native in a run time error by usertags[UT_NATIVE],
 * which its call instruction sets before every native. A call from here goes
 * around that instruction, so the slot is set here: without it the error
 * names whichever native ran last, and which module is missing is anyone's
 * guess. The slot is the image's: a Pawn plugin's native, called with
 * another AMX (Carrier), has no entry of its own to name there.
 */
static ALWAYS_INLINE cell Invoke(const Resolved &native, cell *params)
{
	long running = g_image->usertags[UT_NATIVE];
	g_image->usertags[UT_NATIVE] = native.index;
	cell result = native.fn(native.amx, params);
	g_image->usertags[UT_NATIVE] = running;
	return result;
}

// ---------------------------------------------------------------- marshalling

// The longest text AMX Mod X reads out of a plugin, and so the most any string
// or array crossing into the AMX heap carries: get_amxstring's buffers are
// MAX_BUFFER_LENGTH (16384) bytes, the terminator included. What a native
// does with the text after that - a formatted line stops at 4095 bytes, a
// chat message at the game's 192 - is the native's and the game's.
#define MAX_CROSSING_CELLS 16384

// amx_Allot's own margin between the heap and the stack (STKMARGIN in amx.h).
#define HEAP_MARGIN (16 * (long)sizeof(cell))

// The start of amx.h's AMX_HEADER, which the module SDK leaves out: where an
// AMX's data begins. Each field is at its natural alignment, as packed.
struct AmxHeaderStart {
	int32_t size;
	uint16_t magic;
	char fileVersion, amxVersion;
	int16_t flags, defsize;
	int32_t cod, dat;
};

/** The cells at `addr` in `amx`'s data, as amx_GetAddr finds them: for an address this module took from the heap. */
static cell *HeapAt(AMX *amx, cell addr)
{
	unsigned char *data = amx->data ? amx->data : amx->base + ((const AmxHeaderStart *)amx->base)->dat;
	return (cell *)(data + addr);
}

/**
 * Takes `cells` cells of `amx`'s heap; NULL when the heap would run into the
 * stack. amx_Allot checks that too, but in unsigned arithmetic: a request
 * larger than what is left wraps around, passes, and the heap grows over the
 * stack of the call that is running.
 */
static cell *HeapCells(AMX *amx, int cells, cell *addr)
{
	if (!amx || cells < 0
	    || (long)amx->stk - (long)amx->hea - (long)cells * (long)sizeof(cell) < HEAP_MARGIN) {
		MF_PrintSrvConsole("[amxts] %d cells do not fit in the %s heap\n", cells, amx == g_image ? "natives' image's" : "Pawn plugin's");
		*addr = 0;
		return NULL;
	}
	// amx_Allot's own work, without its call through AMX Mod X: a native's
	// call takes the heap once for each buffer.
	*addr = amx->hea;
	amx->hea += cells * (cell)sizeof(cell);
	return HeapAt(amx, *addr);
}

/** `cells` cells of the image's heap, for a native the module calls itself. */
static cell *HeapCells(int cells, cell *addr)
{
	return HeapCells(g_image, cells, addr);
}

static cell PushString(const char *s)
{
	cell addr;
	int len = (int)strlen(s);
	if (!HeapCells(len + 1, &addr))
		return 0;
	MF_SetAmxString(g_image, addr, s, len);
	return addr;
}

/** Text into the image's heap as a Pawn string, a UTF-8 byte a cell; 0 when it does not fit. */
static cell PushText(const std::string &text)
{
	int n = (int)text.size();
	if (n > MAX_CROSSING_CELLS - 1)
		n = MAX_CROSSING_CELLS - 1;
	cell addr;
	cell *phys = HeapCells(n + 1, &addr);
	if (!phys)
		return 0;
	for (int i = 0; i < n; i++)
		phys[i] = (cell)(unsigned char)text[i];
	phys[n] = 0;
	return addr;
}

/**
 * Reads an AssemblyScript string out of a plugin's linear memory.
 *
 * AssemblyScript stores strings as UTF-16 code units with the byte length in
 * the u32 immediately before the pointer — part of the common object header,
 * the same under every --runtime setting. AMX Mod X and the game take UTF-8 -
 * the facade reads a player's name back as UTF-8 - so that is what comes out.
 * It used to be Latin-1 with '?' above U+00FF, which turned every Cyrillic
 * console line and chat message into question marks.
 */
static std::string AsString(wasm_module_inst_t inst, int32_t ptr)
{
	std::string out;

	if (ptr <= 4 || !wasm_runtime_validate_app_addr(inst, (uint64_t)(ptr - 4), 4))
		return out;

	uint32_t *header = (uint32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)(ptr - 4));
	uint32_t bytes = *header;

	// A length that does not fit the instance's memory means the pointer was
	// not a string: refuse it rather than walk off the end.
	if (bytes > 64u * 1024u || !wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, bytes))
		return out;

	uint16_t *chars = (uint16_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
	uint32_t n = bytes / 2;

	out.reserve(n);
	for (uint32_t i = 0; i < n; i++) {
		uint32_t c = chars[i];

		// A surrogate pair is one character; a lone half is not one at all.
		if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n && chars[i + 1] >= 0xDC00 && chars[i + 1] <= 0xDFFF)
			c = 0x10000 + ((c - 0xD800) << 10) + (chars[++i] - 0xDC00);
		else if (c >= 0xD800 && c <= 0xDFFF)
			c = 0xFFFD;

		if (c < 0x80) {
			out += (char)c;
		} else if (c < 0x800) {
			out += (char)(0xC0 | (c >> 6));
			out += (char)(0x80 | (c & 0x3F));
		} else if (c < 0x10000) {
			out += (char)(0xE0 | (c >> 12));
			out += (char)(0x80 | ((c >> 6) & 0x3F));
			out += (char)(0x80 | (c & 0x3F));
		} else {
			out += (char)(0xF0 | (c >> 18));
			out += (char)(0x80 | ((c >> 12) & 0x3F));
			out += (char)(0x80 | ((c >> 6) & 0x3F));
			out += (char)(0x80 | (c & 0x3F));
		}
	}

	return out;
}

// Writes bytes into a buffer the plugin owns. Returns what was written.
static int32_t WriteBytes(wasm_module_inst_t inst, int32_t ptr, int32_t max, const char *s)
{
	if (ptr <= 0 || max <= 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, (uint64_t)max))
		return 0;

	char *dst = (char *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
	int len = (int)strlen(s);
	if (len > max - 1)
		len = max - 1;

	memcpy(dst, s, len);
	dst[len] = 0;
	return len;
}

// ---------------------------------------------------------------- wasm -> pawn
//
// The module's own imports, written by hand; the thunks for the natives in
// includes/*.inc are generated into natives.h by scripts/generate-wasm-api.ts.
// Each one is registered with its signature so wamrc emits a direct call.

static wasm_module_inst_t Inst(wasm_exec_env_t env)
{
	return wasm_runtime_get_module_inst(env);
}

/**
 * One call frame for a native.
 *
 * Pawn substitutes default parameter values at the call site, but we call the
 * native directly, so a native that reads an optional parameter reads whatever
 * is on the stack behind the arguments it was given. set_task's fourth to
 * seventh parameters are exactly that, and the server died on the first call
 * before this existed. Zero doubles as the empty string such a parameter
 * expects, which is why the generated natives' image reserves DAT+0 — see
 * __amxts_null in scripts/generate-image.ts.
 */
struct Args {
	cell p[32];

	// Only the count and the arguments are cleared: clearing all 32 cells was
	// a measurable part of a call. So every call passes every parameter its
	// native declares, the defaults too: AMX Mod X's natives read some of
	// theirs without looking at the count - register_srvcmd its info[],
	// set_task its repeat - and would read what an earlier call left here.
	Args(int argc)
	{
		memset(p, 0, (argc + 1) * sizeof(cell));
		p[0] = argc * sizeof(cell);
	}

	cell &operator[](int i) { return p[i]; }
	operator cell *() { return p; }
};

/** A native a thunk has already resolved, and the image it came from. */
struct Cached {
	Resolved native;
	int      generation;
};

/**
 * The same call, without asking who it is every time.
 *
 * This is what the generated thunks use. The name is only read once per map,
 * which is what keeps a native call at the couple of nanoseconds the direct
 * call was worth having.
 */
static ALWAYS_INLINE cell CallCached(Cached &cached, const char *name, cell *params)
{
	if (cached.generation != g_nativeGeneration) {
		cached.native = FindNative(name);
		cached.generation = g_nativeGeneration;
	}

	if (!cached.native.fn)
		return 0;

	return Invoke(cached.native, params);
}

/**
 * The AMX a thunk's strings and arrays cross into, for the native it has
 * resolved: the image's, or a Pawn plugin's for a native a Pawn plugin
 * registers (Carrier). The thunk then calls it with CallResolved.
 */
static ALWAYS_INLINE AMX *Resolve(Cached &cached, const char *name)
{
	if (cached.generation != g_nativeGeneration) {
		cached.native = FindNative(name);
		cached.generation = g_nativeGeneration;
	}
	return cached.native.amx ? cached.native.amx : g_image;
}

static ALWAYS_INLINE cell CallResolved(const Cached &cached, cell *params)
{
	return cached.native.fn ? Invoke(cached.native, params) : 0;
}


/**
 * A native of the image's table by its name, a literal: each call site keeps
 * it resolved (Cached), as a thunk does, so the name is looked up once a map
 * rather than in a std::map on every call.
 */
#define CallNative(name, params) \
	([](cell *p) { static Cached cached = { { NULL, 0, NULL }, 0 }; return CallCached(cached, "" name, p); }(params))


/**
 * The arguments of the callback that is running, for arg() and argText().
 *
 * A handler is handed four cells, because call_indirect needs one fixed type
 * and four covers nearly everything. The rest are not lost, only not pushed:
 * they are still here, and so is the AMX whose memory a string among them
 * lives in - the natives' image for a forward or a publicFor name, the
 * calling plugin for an exported native. Whoever fires a handler sets these and puts
 * back what was there, because one handler can start another.
 */
static cell *g_callArgs = NULL;
static int   g_callArgc = 0;
static AMX  *g_callAmx = NULL;
// Whether the call is an exported native's (CALLER_OF_AMX), whose caller()
// is the plugin of g_callAmx, or -1 for anything else.
#define CALLER_OF_AMX (-2)
static int   g_caller = -1;
// How many cells each array argument has, -1 where nobody said: a forward's,
// for arg_length(). NULL for a call that carries no sizes.
static const int32_t *g_callLengths = NULL;
// A hooked game function's call (gamehooks.h), when that is the context:
// its cells are g_callArgs, and its texts, vectors and answer are its own.
struct ChainCall;
static ChainCall *g_chain = NULL;
static cell ChainResult();
static const char *ChainText(int32_t index);
static float *ChainVector(int32_t index);
static void ChainAnswered();
// An entity's function run with { hooks: false } (ExecuteHam, ham_bypass):
// the module's hook of it on that entity passes the call straight on, once,
// before the native returns. -1 for none.
static int g_hamQuiet = -1;
static int g_hamQuietId = 0;

struct CallArgs {
	cell *args; int argc; AMX *amx; int caller; const int32_t *lengths; ChainCall *chain;

	CallArgs(cell *a, int n, AMX *x, int from = -1, const int32_t *sizes = NULL)
		: args(g_callArgs), argc(g_callArgc), amx(g_callAmx), caller(g_caller), lengths(g_callLengths), chain(g_chain)
	{
		g_callArgs = a; g_callArgc = n; g_callAmx = x; g_caller = from; g_callLengths = sizes; g_chain = NULL;
	}

	~CallArgs()
	{
		g_callArgs = args; g_callArgc = argc; g_callAmx = amx; g_caller = caller; g_callLengths = lengths; g_chain = chain;
	}
};

/**
 * A native's call frame on the AMX side: what a buffer parameter is copied
 * into, the AMX whose heap that is (Resolve), and the heap mark that releases
 * all of it when the call returns.
 *
 * A buffer is copied in both directions regardless of what the native does
 * with it. Whether a given array is read or filled is not written down
 * anywhere in the .inc files — the JavaScript wrapper generator carries a page
 * of heuristics to guess it — and here the guess is unnecessary: the plugin
 * owns its side of the memory, so copying twice is always correct. Text is
 * the exception, because its direction is known: a `const` string is read
 * from the plugin's own string, and the text a typed wrapper asks for comes
 * back only up to its end.
 *
 * The AMX the native gets is the image's, and the buffers are in its heap,
 * not in the plugin's memory: the memory moves when it grows, which it can
 * while a native runs code of the same plugin, and a native keeps the AMX it
 * was called with for its callbacks.
 */
struct Frame {
	wasm_module_inst_t inst;
	AMX *amx;
	cell mark;

	Frame(wasm_exec_env_t env, AMX *to)
	{
		inst = wasm_runtime_get_module_inst(env);
		amx = to;
		mark = amx ? amx->hea : 0;
	}

	~Frame()
	{
		if (amx)
			amx->hea = mark;
	}

	// A buffer's length arrives from the plugin, so it is input at a trust
	// boundary: it is clamped, and the range is checked against the plugin's
	// own memory before anything is read.
	int Cells(int32_t ptr, int32_t cells)
	{
		if (ptr <= 0 || cells <= 0)
			return 0;
		if (cells > MAX_CROSSING_CELLS)
			cells = MAX_CROSSING_CELLS;
		if (!wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, (uint64_t)cells * 4))
			return 0;
		return cells;
	}

	/**
	 * How many of a guessed `cells` lie in the plugin's memory from `ptr`:
	 * a buffer whose length the declaration does not give is copied up to a
	 * guess, which can reach past the end of the memory when the buffer sits
	 * there - get_players' 33 cells against 128. The thunk copies that many
	 * in and the same number back; -1 when `ptr` is not in the memory.
	 * validate_app_addr is not asked: refusing, it also leaves the instance
	 * an "out of bounds memory access", which fails the plugin's call as
	 * soon as the native returns.
	 */
	int32_t fits(int32_t ptr, int32_t cells)
	{
		uint64_t start = 0, end = 0;
		if (ptr <= 0 || !wasm_runtime_get_app_addr_range(inst, (uint64_t)ptr, &start, &end))
			return -1;
		uint64_t room = (end - (uint64_t)ptr) / 4;
		return room < (uint64_t)cells ? (int32_t)room : cells;
	}

	/**
	 * The plugin's own string, as a Pawn string in the AMX heap: its UTF-16
	 * (the byte length is the u32 before it, as AsString reads it) written
	 * as UTF-8, a byte a cell, in one pass - the plugin makes nothing for
	 * it. Cut at MAX_CROSSING_CELLS - 1 bytes, never inside a letter. 0 when
	 * the pointer is not a string, or the heap has no room.
	 */
	cell inText(int32_t ptr)
	{
		uint64_t start = 0, end = 0;
		if (ptr <= 4 || !wasm_runtime_get_app_addr_range(inst, (uint64_t)(ptr - 4), &start, &end))
			return 0;
		const uint8_t *at = (const uint8_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)(ptr - 4));
		uint32_t bytes = *(const uint32_t *)at;
		if (bytes > end - (uint64_t)ptr)
			return 0;

		const uint16_t *chars = (const uint16_t *)(at + 4);
		uint32_t n = bytes / 2;

		// Three bytes at most for each unit (a pair's four are two units'),
		// then given back down to what the text took.
		uint32_t room = (uint64_t)n * 3 < MAX_CROSSING_CELLS - 1 ? n * 3 : MAX_CROSSING_CELLS - 1;
		cell addr;
		cell *phys = HeapCells(amx, (int)room + 1, &addr);
		if (!phys)
			return 0;

		// ASCII first, most text: a unit a cell, and the room holds them all.
		cell *dst = phys, *stop = phys + room;
		uint32_t i = 0;
		for (uint32_t ascii = n < room ? n : room; i < ascii && chars[i] < 0x80; i++)
			*dst++ = (cell)chars[i];

		for (; i < n; i++) {
			uint32_t c = chars[i];
			if (c < 0x80) {
				if (dst == stop)
					break;
				*dst++ = (cell)c;
				continue;
			}

			// A surrogate pair is one character; a lone half is not one at all.
			if (c >= 0xD800 && c <= 0xDBFF && i + 1 < n && chars[i + 1] >= 0xDC00 && chars[i + 1] <= 0xDFFF)
				c = 0x10000 + ((c - 0xD800) << 10) + (chars[++i] - 0xDC00);
			else if (c >= 0xD800 && c <= 0xDFFF)
				c = 0xFFFD;

			int size = c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
			if (stop - dst < size)
				break;
			if (size == 2) {
				*dst++ = (cell)(0xC0 | (c >> 6));
			} else if (size == 3) {
				*dst++ = (cell)(0xE0 | (c >> 12));
				*dst++ = (cell)(0x80 | ((c >> 6) & 0x3F));
			} else {
				*dst++ = (cell)(0xF0 | (c >> 18));
				*dst++ = (cell)(0x80 | ((c >> 12) & 0x3F));
				*dst++ = (cell)(0x80 | ((c >> 6) & 0x3F));
			}
			*dst++ = (cell)(0x80 | (c & 0x3F));
		}
		*dst = 0;

		// Nothing was taken after it, so the heap's top comes back to its end.
		amx->hea = addr + (cell)((dst - phys + 1) * sizeof(cell));
		return addr;
	}

	/**
	 * A string the native fills: `cells` cells of the heap, empty, for a
	 * plugin's buffer of `cells` + 1 bytes - nothing is copied in, as the
	 * wrapper's buffer holds nothing yet. 0 when it cannot cross.
	 */
	cell outText(int32_t ptr, int32_t cells)
	{
		if (ptr <= 0 || cells < 0)
			return 0;
		if (cells > MAX_CROSSING_CELLS)
			cells = MAX_CROSSING_CELLS;
		if (!wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, (uint64_t)cells + 1))
			return 0;

		cell addr;
		cell *phys = HeapCells(amx, cells + 1, &addr);
		if (!phys)
			return 0;
		phys[0] = 0;
		phys[cells] = 0;
		return addr;
	}

	/** What the native wrote, back as bytes up to its end and a zero byte. */
	void backText(int32_t ptr, int32_t cells, cell addr)
	{
		if (cells > MAX_CROSSING_CELLS)
			cells = MAX_CROSSING_CELLS;
		const cell *phys = HeapAt(amx, addr);
		// Asked again: the plugin's memory can move while the native runs.
		unsigned char *dst = (unsigned char *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
		int i = 0;
		for (; i < cells && phys[i]; i++)
			dst[i] = (unsigned char)phys[i];

		// A native that cut the text at its length may have cut a letter in
		// two: its first bytes alone are no letter, so they are left out.
		int lead = i;
		while (lead > 0 && (dst[lead - 1] & 0xC0) == 0x80)
			lead--;
		if (lead > 0 && dst[lead - 1] >= 0xC0) {
			int size = dst[lead - 1] >= 0xF0 ? 4 : dst[lead - 1] >= 0xE0 ? 3 : 2;
			if (i - (lead - 1) < size)
				i = lead - 1;
		}
		dst[i] = 0;
	}

	/**
	 * Copies cells out of the plugin and returns the amx address holding
	 * them; 0 when they cannot cross, and then the native is not called:
	 * handed address 0, it would write into the AMX's own data.
	 *
	 * A length of 0 crosses as the terminator cell alone - a Pawn native
	 * given 0 does nothing with its buffer, or writes an empty string into
	 * it, and ArrayPushArray still adds an item. A negative one does not
	 * cross: natives read -1 as "the whole item" or "no end" and fill a
	 * buffer as long as they like, and how long the plugin's is is not known
	 * here.
	 */
	cell in(int32_t ptr, int32_t cells)
	{
		int n = Cells(ptr, cells);
		if (!n && (cells || ptr <= 0))
			return 0;

		// One cell more than asked: a native handed `buffer, len` writes len
		// characters and then the terminator, as set_amxstring does, so a
		// buffer of exactly len cells lost its last cell to whatever the AMX
		// heap held next. Only the n cells are copied back.
		cell addr;
		cell *phys = HeapCells(amx, n + 1, &addr);
		if (!phys)
			return 0;

		int32_t *src = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
		for (int i = 0; i < n; i++)
			phys[i] = (cell)src[i];
		phys[n] = 0;

		return addr;
	}

	/** Copies them back, for whatever the native wrote. */
	void out(int32_t ptr, int32_t cells, cell addr)
	{
		int n = Cells(ptr, cells);
		if (!n || !addr)
			return;

		const cell *phys = HeapAt(amx, addr);
		int32_t *dst = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
		for (int i = 0; i < n; i++)
			dst[i] = (int32_t)phys[i];
	}
};

// Every native in includes/*.inc that has a signature WAMR can express.
#include "natives.h"

// The API a plugin imports, carried inside the module so it cannot be a
// different generation from the thunks above.
#include "embedded.h"

// The natives' image, compiled (`bun run image`): loaded every map (LoadImage).
#include "image.h"

/** Says once a process that a native needs the Pawn plugin calling it, and what to write instead. */
static void TellNeedsPlugin(const NeedsPluginInfo &info)
{
	static std::set<std::string> told;
	if (told.insert(info.name).second)
		MF_PrintSrvConsole("[amxts] %s%s looks for the Pawn plugin calling it, and a TypeScript plugin's call has none: it answers 0 - use %s\n",
		                   info.name, info.arg ? " with this argument" : "", info.instead);
}

#define NEEDS_PLUGIN_COUNT (sizeof(g_needsPlugin) / sizeof(g_needsPlugin[0]))

// What each guarded native stands in for (NeedsPluginGuard).
static AMX_NATIVE g_guarded[NEEDS_PLUGIN_COUNT];

/** A native that needs the calling plugin for some of its calls: those answer 0, the rest go on to it. */
template <size_t K>
static cell AMX_NATIVE_CALL NeedsPluginGuard(AMX *amx, cell *params)
{
	const NeedsPluginInfo &info = g_needsPlugin[K];
	if (params[0] >= (cell)(info.arg * sizeof(cell)) && (info.value < 0 ? params[info.arg] != 0 : params[info.arg] == info.value)) {
		TellNeedsPlugin(info);
		return 0;
	}
	return g_guarded[K](amx, params);
}

template <size_t... K>
static const AMX_NATIVE *NeedsPluginGuards(std::index_sequence<K...>)
{
	static const AMX_NATIVE guards[] = { NeedsPluginGuard<K>... };
	return guards;
}

static AMX_NATIVE NeedsPlugin(const char *name, AMX_NATIVE fn)
{
	for (size_t k = 0; fn && k < NEEDS_PLUGIN_COUNT; k++) {
		const NeedsPluginInfo &info = g_needsPlugin[k];
		if (strcmp(info.name, name))
			continue;
		if (!info.arg) {
			TellNeedsPlugin(info);
			return NULL;
		}
		g_guarded[k] = fn;
		return NeedsPluginGuards(std::make_index_sequence<NEEDS_PLUGIN_COUNT>())[k];
	}
	return fn;
}

/**
 * Set by amxts_trace in the server console.
 *
 * Off costs a branch and prints nothing. On, every handler call and every
 * message written says so, which is how the crash behind a say command was
 * cornered: the last line before the silence names what was running.
 */
static bool g_trace = false;

/** The team name a player is on, as TeamInfo spells it. */
static std::string TeamOf(int id)
{
	cell mark = g_image->hea;
	cell addr;
	cell *phys = HeapCells(16, &addr);
	if (!phys)
		return std::string();
	phys[0] = 0;

	Args params(3);
	params[1] = id;
	params[2] = addr;
	params[3] = 15;
	CallNative("get_user_team", params);

	int len = 0;
	const char *name = MF_GetAmxString(g_image, addr, 0, &len);
	std::string out = name ? name : "";

	g_image->hea = mark;
	return out;
}

/** One message of one byte and one string, to one player. */
static bool WriteTo(int id, int message, int sender, const char *text)
{
	cell mark = g_image->hea;

	Args begin(4);
	begin[1] = 1;                     // MSG_ONE
	begin[2] = message;
	begin[3] = 0;                     // MSG_ONE ignores the origin
	begin[4] = id;

	// If this fails - an unknown message id, a player who is not there - the
	// writes that follow would land outside any message, and writing outside a
	// message crashes the engine rather than failing.
	if (g_trace) MF_PrintSrvConsole("[amxts] TRACE begin msg=%d to=%d\n", message, id);

	if (!CallNative("message_begin", begin)) {
		if (g_trace) MF_PrintSrvConsole("[amxts] TRACE begin refused\n");
		g_image->hea = mark;
		return false;
	}

	Args byte(1);
	byte[1] = sender;
	CallNative("write_byte", byte);
	if (g_trace) MF_PrintSrvConsole("[amxts] TRACE byte written\n");

	Args str(1);
	str[1] = PushString(text);
	CallNative("write_string", str);
	if (g_trace) MF_PrintSrvConsole("[amxts] TRACE string written\n");

	Args end(0);
	CallNative("message_end", end);
	if (g_trace) MF_PrintSrvConsole("[amxts] TRACE message ended\n");

	g_image->hea = mark;
	return true;
}

static int g_msgSayText = 0;
static int g_msgTeamInfo = 0;

static int MessageId(const char *name)
{
	cell mark = g_image->hea;
	Args params(1);
	params[1] = PushString(name);
	int id = (int)CallNative("get_user_msgid", params);
	g_image->hea = mark;
	return id;
}

/**
 * A chat line to one player, in the colour the tags asked for.
 *
 * The colours are the facade's doing - it turns !g and friends into the bytes
 * the client reads. What cannot be done there is this: 0x03 is "the sender's
 * team colour", so red is reached by telling the recipient's client that the
 * sender is a terrorist, writing the line, and telling it the truth again.
 * Three messages for one line, and the truth has to go back or the scoreboard
 * lies for the rest of the round.
 */
static void SendChat(int id, const std::string &line, const std::string &swapTo)
{
	if (!g_msgSayText) g_msgSayText = MessageId("SayText");
	if (!g_msgTeamInfo) g_msgTeamInfo = MessageId("TeamInfo");

	if (!g_msgSayText)
		return;

	// The client renders a SayText through printf, so a lone % would be
	// swallowed as a conversion. Doubled, exactly one is shown.
	std::string text;
	for (size_t i = 0; i < line.size(); i++) {
		text += line[i];
		if (line[i] == '%') text += '%';
	}

	std::string team = swapTo.empty() ? std::string() : TeamOf(id);

	// Without a team to put back there is nothing to swap safely: the client
	// would be left believing something that is not so.
	bool swapping = !swapTo.empty() && !team.empty() && g_msgTeamInfo != 0;

	if (swapping && !WriteTo(id, g_msgTeamInfo, id, swapTo.c_str()))
		swapping = false;

	WriteTo(id, g_msgSayText, id, text.c_str());

	if (swapping)
		WriteTo(id, g_msgTeamInfo, id, team.c_str());
}

/**
 * say_text(id, text, swapTo) - the chat line the facade has already painted.
 *
 * id 0 is everyone, each told about his own sender separately, because the
 * team swap is about the recipient's view of the world.
 */
static void w_say_text(wasm_exec_env_t env, int32_t id, int32_t text, int32_t swapTo)
{
	std::string line = AsString(Inst(env), text);
	std::string swap = AsString(Inst(env), swapTo);

	if (id > 0) {
		SendChat(id, line, swap);
		return;
	}

	int players = (int)CallNative("get_maxplayers", Args(0));
	for (int i = 1; i <= players; i++) {
		Args connected(1);
		connected[1] = i;
		if (CallNative("is_user_connected", connected))
			SendChat(i, line, swap);
	}
}

static void w_print_client(wasm_exec_env_t env, int32_t id, int32_t channel, int32_t msg)
{
	cell mark = g_image->hea;
	std::string s = AsString(Inst(env), msg);

	Args params(4);
	params[1] = id;
	params[2] = channel;
	params[3] = PushString("%s");
	params[4] = PushString(s.c_str());

	CallNative("client_print", params);
	g_image->hea = mark;
}

static int32_t w_get_name(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	cell mark = g_image->hea;
	cell addr;
	cell *phys = HeapCells(64, &addr);
	if (!phys)
		return WriteBytes(Inst(env), out, max, "");
	phys[0] = 0;

	Args params(3);
	params[1] = id;
	params[2] = addr;
	params[3] = 63;

	CallNative("get_user_name", params);

	int len = 0;
	const char *name = MF_GetAmxString(g_image, addr, 0, &len);
	int32_t written = WriteBytes(Inst(env), out, max, name ? name : "");

	g_image->hea = mark;
	return written;
}

// fields.h's: an entvar's four bytes where the game keeps them, of an
// entity and of a player in the game.
static char *EntvarAt(int32_t id, int32_t offset);
static char *PlayerEntvarAt(int32_t id, int32_t offset);

/** Every slot a client can take, 0 unused. */
#define CLIENT_SLOTS 33

/**
 * AMX Mod X's view of each client, kept the same way: connected
 * (CPlayer::initialized, from client_connect) and in the game (ingame, from
 * client_putinserver), until the slot is let go.
 */
static bool g_connected[CLIENT_SLOTS];
static bool g_inGame[CLIENT_SLOTS];

/** Whether the client in slot `id` is in the game, as MF_IsPlayerIngame says, without its call. */
static bool InGame(int32_t id)
{
	return id > 0 && id < CLIENT_SLOTS && g_inGame[id];
}

// pev->health's place in entvars_t (scripts/entvars.ts checks the layout).
#define ENTVAR_HEALTH 352

/**
 * A player's health as get_user_health gives it - pev->health, truncated -
 * read where the game keeps it rather than through the native and its name.
 * A slot nobody is in goes to the native, which says so as it does in Pawn.
 */
static int32_t w_get_health(wasm_exec_env_t env, int32_t id)
{
	char *at = PlayerEntvarAt(id, ENTVAR_HEALTH);
	if (at)
		return (int32_t)*(float *)at;

	static Cached cached = { { NULL, 0 }, 0 };
	Args params(1);
	params[1] = id;
	return (int32_t)CallCached(cached, "get_user_health", params);
}

/** set_user_health's: above 0 the field is written; 0 or less kills, which the native does. */
static void w_set_health(wasm_exec_env_t env, int32_t id, int32_t hp)
{
	char *at = hp > 0 ? PlayerEntvarAt(id, ENTVAR_HEALTH) : NULL;
	if (at) {
		*(float *)at = (float)hp;
		return;
	}

	static Cached cached = { { NULL, 0 }, 0 };
	Args params(2);
	params[1] = id;
	params[2] = hp;
	CallCached(cached, "set_user_health", params);
}

/**
 * console.log and the rest of it.
 *
 * AssemblyScript's standard library already has a global `console`, and it
 * imports env."console.log" and friends. Registering those names is all it
 * takes for `console.log("...")` to work in a plugin with nothing imported at
 * all - which is how it is written in every other TypeScript file anyone has
 * ever read.
 *
 * All nine are registered, not only the three that get used: an unregistered
 * one is not a compile error but a plugin that fails to instantiate, and
 * "unknown import env.console.time" is a poor way to learn that.
 */
// handled() and its neighbours: what this handler wants done about the event.
static void w_outcome(wasm_exec_env_t env, int32_t value)
{
	g_outcome = (cell)value;
	g_outcomeSaid = true;
}

/**
 * `text` on the console, `prefix` before its first line: a line at a time,
 * since AMX Mod X cuts what it prints at 384 bytes - a stack is longer.
 */
static void PrintLines(const char *prefix, const std::string &text)
{
	size_t at = 0;
	do {
		size_t end = text.find('\n', at);
		std::string line = text.substr(at, end == std::string::npos ? std::string::npos : end - at);
		MF_PrintSrvConsole("%s%s\n", at ? "" : prefix, line.c_str());
		at = end == std::string::npos ? std::string::npos : end + 1;
	} while (at != std::string::npos);
}

static void w_console_log(wasm_exec_env_t env, int32_t msg)
{
	PrintLines("[amxts] ", AsString(Inst(env), msg));
}

static void w_console_error(wasm_exec_env_t env, int32_t msg)
{
	PrintLines("[amxts] error: ", AsString(Inst(env), msg));
}

static void w_console_warn(wasm_exec_env_t env, int32_t msg)
{
	PrintLines("[amxts] warning: ", AsString(Inst(env), msg));
}

static void w_console_assert(wasm_exec_env_t env, int32_t condition, int32_t msg)
{
	if (!condition)
		MF_PrintSrvConsole("[amxts] assertion failed: %s\n", AsString(Inst(env), msg).c_str());
}

// console.time's labels, and when each was started.
static std::map<std::string, int64_t> g_timers;

#ifdef _WIN32
static int64_t Now()
{
	LARGE_INTEGER counter;
	QueryPerformanceCounter(&counter);
	return (int64_t)counter.QuadPart;
}

static double MillisecondsSince(int64_t start)
{
	LARGE_INTEGER frequency;
	QueryPerformanceFrequency(&frequency);
	return (double)(Now() - start) * 1000.0 / (double)frequency.QuadPart;
}

static int64_t ProcessId()
{
	return (int64_t)GetCurrentProcessId();
}
#else
// The monotonic clock, in nanoseconds: what QueryPerformanceCounter is on Windows.
static int64_t Now()
{
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec;
}

static double MillisecondsSince(int64_t start)
{
	return (double)(Now() - start) / 1000000.0;
}

static int64_t ProcessId()
{
	return (int64_t)getpid();
}
#endif

// performance.now() counts from the module's start, as a page's does from its.
static int64_t g_started = Now();

/** Date.now(): milliseconds since 1970, as JavaScript counts them. */
static double w_date_now(wasm_exec_env_t env)
{
#ifdef _WIN32
	FILETIME ft;
	GetSystemTimePreciseAsFileTime(&ft);
	ULARGE_INTEGER t;
	t.LowPart = ft.dwLowDateTime;
	t.HighPart = ft.dwHighDateTime;
	// A FILETIME counts 100 ns from 1601; 11644473600 s lie between the two.
	return (double)(t.QuadPart / 10000ULL) - 11644473600000.0;
#else
	struct timespec now;
	clock_gettime(CLOCK_REALTIME, &now);
	return (double)now.tv_sec * 1000.0 + (double)(now.tv_nsec / 1000000);
#endif
}

/**
 * Date#getTimezoneOffset(): minutes from the server's local time to UTC at
 * that moment, summer time included, as JavaScript counts them - UTC+4 is
 * -240. The local getters (getHours, ...) are the UTC ones shifted by it.
 */
static int32_t w_date_timezone_offset(wasm_exec_env_t env, double time)
{
	// Whole seconds, rounded down: a moment before 1970 too.
	time_t seconds = (time_t)(time / 1000.0);
	if ((double)seconds * 1000.0 > time) seconds--;
	struct tm local;
#ifdef _WIN32
	if (localtime_s(&local, &seconds) != 0) return 0;
	// The local wall clock read as if it were UTC, minus the moment itself.
	return (int32_t)((seconds - _mkgmtime(&local)) / 60);
#else
	if (!localtime_r(&seconds, &local)) return 0;
	return (int32_t)(-local.tm_gmtoff / 60);
#endif
}

/** performance.now(): milliseconds, to the microsecond, for measuring. */
static double w_performance_now(wasm_exec_env_t env)
{
	return MillisecondsSince(g_started);
}

/** Math.random's seed, asked once per plugin: different on every run. */
static double w_seed(wasm_exec_env_t env)
{
	return (double)(Now() ^ ProcessId() << 32);
}

static void w_console_time(wasm_exec_env_t env, int32_t label)
{
	g_timers[AsString(Inst(env), label)] = Now();
}

/**
 * Prints how long a label has been running, to a thousandth of a millisecond.
 *
 * A game server is exactly where someone wants this: a plugin has about 2 ms
 * of frame to itself, and the difference between 0.2 and 2 ms is the whole
 * subject of this project. The monotonic clock (QueryPerformanceCounter,
 * CLOCK_MONOTONIC) rather than the engine's own tickcount(), which rounds to
 * a millisecond and would report every measurement worth making as zero.
 */
static void w_console_timeLog(wasm_exec_env_t env, int32_t label)
{
	std::string name = AsString(Inst(env), label);
	std::map<std::string, int64_t>::iterator it = g_timers.find(name);

	if (it == g_timers.end()) {
		MF_PrintSrvConsole("[amxts] timer \"%s\" does not exist\n", name.c_str());
		return;
	}

	MF_PrintSrvConsole("[amxts] %s: %.3f ms\n", name.c_str(), MillisecondsSince(it->second));
}

static void w_console_timeEnd(wasm_exec_env_t env, int32_t label)
{
	w_console_timeLog(env, label);
	g_timers.erase(AsString(Inst(env), label));
}

// ---------------------------------------------------------------- registration

/** Takes out of `list` every entry `belongs` names. */
template <typename T, typename Belongs>
static void DropFrom(std::vector<T> &list, Belongs belongs)
{
	list.erase(std::remove_if(list.begin(), list.end(), belongs), list.end());
}

/** Which handler of the plugin's a forward's list holds (Forward). */
static Handler &HandlerOf(Handler &h) { return h; }
static Handler &HandlerOf(Subscription &s) { return s.handler; }

/**
 * Takes out of a list of `f` every entry `belongs` names; during a dispatch
 * of `f` it only marks them, and the dispatch takes them out (Forward).
 */
template <typename T, typename Belongs>
static void DropFrom(Forward &f, std::vector<T> &list, Belongs belongs)
{
	if (!f.depth) {
		DropFrom(list, belongs);
		return;
	}
	for (size_t i = 0; i < list.size(); i++) {
		if (belongs(list[i])) {
			HandlerOf(list[i]).plugin = HANDLER_GONE;
			f.holes = true;
		}
	}
}

/** The number of a forward the module raises (FORWARD_*), or -1 for any other. */
static int ForwardIndex(const std::string &name)
{
	for (int i = 0; i < FORWARD_COUNT; i++)
		if (name == g_forwardNames[i])
			return i;
	return -1;
}

// on_cell(event, handler, shape, arg, value) - on, for the calls whose
// argument `arg` is `value` alone.
static void w_on_cell(wasm_exec_env_t env, int32_t name, int32_t fn, int32_t shape, int32_t arg, int32_t value)
{
	int forward = ForwardIndex(AsString(Inst(env), name));
	if (g_currentPlugin < 0 || forward < 0)
		return;

	Handler h;
	h.plugin = g_currentPlugin;
	h.fn = (uint32_t)fn;
	h.shape = shape;
	h.whereArg = arg;
	h.whereValue = value;
	Bind(h);
	g_forwards[forward].handlers.push_back(h);
}

// on(event, handler, shape) - a forward the module raises.
static void w_on(wasm_exec_env_t env, int32_t name, int32_t fn, int32_t shape)
{
	w_on_cell(env, name, fn, shape, -1, 0);
}

// off(event, handler) - the plugin's handler of a forward taken off again,
// once its event has no listener left: the forward stops reaching it.
static void w_off(wasm_exec_env_t env, int32_t name, int32_t fn)
{
	int forward = ForwardIndex(AsString(Inst(env), name));
	if (forward < 0)
		return;
	int plugin = g_currentPlugin;
	Forward &f = g_forwards[forward];
	DropFrom(f, f.handlers, [plugin, fn](const Handler &h) { return h.plugin == plugin && h.fn == (uint32_t)fn; });
}

// subscribe(forward, trampoline, tag) - see Subscription.
static void w_subscribe(wasm_exec_env_t env, int32_t name, int32_t fn, int32_t tag)
{
	if (g_currentPlugin < 0)
		return;

	std::string forward = AsString(Inst(env), name);

	Subscription s;
	s.handler.plugin = g_currentPlugin;
	s.handler.fn = (uint32_t)fn;
	s.handler.shape = SHAPE_NARROW;   // the tag; the arguments are in the context
	s.tag = tag;
	Bind(s.handler);

	int index = ForwardIndex(forward);
	if (index < 0)
		g_subscriptionNames++;
	(index >= 0 ? g_forwards[index].subscribers : g_subscriptions[forward]).push_back(s);
}

static cell Fire(Handler h, uint32_t *argv, int argc, cell fallback);

/** A dispatch of `f` has returned: the outermost takes out what was marked during it (Forward). */
static void EndDispatch(Forward &f)
{
	if (--f.depth > 0 || !f.holes)
		return;
	f.holes = false;
	DropFrom(f.handlers, [](const Handler &h) { return h.plugin == HANDLER_GONE; });
	DropFrom(f.subscribers, [](const Subscription &s) { return s.handler.plugin == HANDLER_GONE; });
}

/**
 * A forward to its subscribers, then to its handlers, each list walked in
 * place (Forward); the highest a handler answered. The arguments are the
 * call's context, which the caller has set (CallArgs): the first cells, a
 * player event's id, go in as a handler's parameters too, and the rest it
 * reads from there.
 */
static cell Dispatch(Forward &f, const cell *args, int argc)
{
	f.depth++;

	for (size_t k = 0, end = f.subscribers.size(); k < end; k++) {
		uint32_t tag = (uint32_t)f.subscribers[k].tag;
		Fire(f.subscribers[k].handler, &tag, 1, 0);
	}

	uint32_t argv[MAX_EVENT_ARGS] = { 0 };
	int n = argc > MAX_EVENT_ARGS ? MAX_EVENT_ARGS : argc;
	for (int i = 0; i < n; i++)
		argv[i] = (uint32_t)(int32_t)args[i];

	cell result = 0;
	for (size_t h = 0, end = f.handlers.size(); h < end; h++) {
		const Handler &handler = f.handlers[h];
		int where = handler.whereArg;
		if (where >= 0 && (where >= argc || args[where] != handler.whereValue))
			continue;
		cell one = Fire(handler, argv, n, 0);
		if (one > result)
			result = one;
	}

	EndDispatch(f);
	return result;
}

/**
 * Calls every subscriber of a forward the module does not raise. The arguments
 * are the call's context, which whoever delivers has set (CallArgs): a
 * subscriber reads them from there.
 */
static void DeliverToSubscribers(const std::string &forward)
{
	std::map<std::string, std::vector<Subscription> >::iterator it = g_subscriptions.find(forward);
	if (it == g_subscriptions.end())
		return;

	// A copy: a subscriber that subscribes again must not move this loop's floor.
	std::vector<Subscription> subscribers = it->second;
	for (size_t k = 0; k < subscribers.size(); k++) {
		uint32_t tag = (uint32_t)subscribers[k].tag;
		Fire(subscribers[k].handler, &tag, 1, 0);
	}
}

/**
 * An array argument a plugin lays out for a forward: its count, then its
 * cells - the facade's forwardCells(). NULL when the pointer does not hold one.
 */
static int32_t *ForwardArray(wasm_module_inst_t inst, int32_t ptr, int32_t *count)
{
	*count = 0;
	if (ptr <= 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, 4))
		return NULL;
	int32_t *cells = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
	int32_t n = cells[0];
	if (n < 0 || n > MAX_CROSSING_CELLS || !wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, (uint64_t)(n + 1) * 4))
		return NULL;
	*count = n;
	return cells + 1;
}

/**
 * emit_local(forward, mask, cells, argc) - a TypeScript plugin fired a forward;
 * AMX Mod X hands it to the Pawn plugins' publics, and its TypeScript
 * subscribers hear it here.
 *
 * `mask` has a letter per argument: `n` and `f` a cell, `s` a string in the
 * emitting plugin's memory, `a` an array laid out as ForwardArray reads it.
 * Strings and arrays are copied into the image's heap for as long as the
 * subscribers run, so they read them as they read a forward from Pawn.
 */
static void w_emit_local(wasm_exec_env_t env, int32_t name, int32_t mask, int32_t cellsPtr, int32_t argc)
{
	wasm_module_inst_t inst = Inst(env);
	std::string forward = AsString(inst, name);
	if (!g_image || g_subscriptions.find(forward) == g_subscriptions.end())
		return;

	std::string types = AsString(inst, mask);
	if (argc < 0 || argc > MAX_FORWARD_ARGS || argc > (int32_t)types.size()
	    || !wasm_runtime_validate_app_addr(inst, (uint64_t)cellsPtr, (uint64_t)argc * 4))
		return;

	int32_t *cells = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)cellsPtr);
	cell args[MAX_FORWARD_ARGS] = { 0 };
	int32_t lengths[MAX_FORWARD_ARGS];
	cell mark = g_image->hea;

	for (int i = 0; i < argc; i++) {
		lengths[i] = -1;
		if (types[i] == 's') {
			args[i] = PushText(AsString(inst, cells[i]));
		}
		else if (types[i] == 'a') {
			int32_t count = 0;
			int32_t *values = ForwardArray(inst, cells[i], &count);
			cell addr = 0;
			cell *phys = HeapCells(count + 1, &addr);
			if (phys && values) {
				memcpy(phys, values, (size_t)count * sizeof(cell));
				phys[count] = 0;
				lengths[i] = count;
			}
			args[i] = addr;
		}
		else {
			args[i] = (cell)cells[i];
		}
	}

	{
		CallArgs context(args, argc, g_image, -1, lengths);
		DeliverToSubscribers(forward);
	}
	g_image->hea = mark;
}

/**
 * tag(n) - the closure number the next registration is for (Handler.tag).
 * The plugin says it right before the call that takes the function; that
 * call takes it, so it never outlives one registration.
 */
static int32_t g_pendingTag = 0;

static void w_tag(wasm_exec_env_t env, int32_t tag)
{
	(void)env;
	g_pendingTag = tag;
}

/** The tag said for this registration, taken so the next one starts clean. */
static int32_t TakeTag()
{
	int32_t tag = g_pendingTag;
	g_pendingTag = 0;
	return tag;
}

/** Gives a wasm function a publicFor name (g_slots) and returns its index; -1 outside a plugin's call. */
static int TakeSlot(int32_t fn, int32_t shape, const char *key, bool *reused, cell fallback)
{
	int32_t tag = TakeTag();
	if (reused)
		*reused = false;

	if (g_currentPlugin < 0)
		return -1;

	// A reload leaves the registration made and the name orphaned. If this is
	// the same registration coming back, take it over: registering again would
	// leave the orphan in front of it, swallowing the call before the live
	// handler ever saw it.
	size_t index = g_slots.size();
	for (size_t i = 0; key && *key && i < g_slots.size(); i++)
		if (g_slots[i].plugin == SLOT_ORPHANED && g_slots[i].key == key)
			index = i;
	if (index == g_slots.size()) {
		g_slots.push_back(Slot());
		g_slots[index].key = key ? key : "";
	} else if (reused) {
		*reused = true;
	}

	Slot &slot = g_slots[index];
	slot.plugin = g_currentPlugin;
	slot.fn = (uint32_t)fn;
	slot.tag = tag;
	slot.shape = shape;
	slot.fallback = fallback;
	Bind(slot);
	return (int)index;
}

// Whether plugin_init has come this map: the watcher looks at the plugins'
// files from then on.
static bool g_amxxReady = false;

/**
 * The commands plugins added, by name in lower case: the players' and the
 * server's. Each name's handlers are a Forward's, walked in place in the
 * order they were added, so a plugin stopping in a command takes its own
 * out safely (DropFrom). The module hears them itself - a player's in
 * Metamod's ClientCommand, the server's through the engine's
 * AddServerCommand - so there is no slot and no AMX Mod X timing to wait for.
 */
static std::map<std::string, Forward> g_clientCommands;
static std::map<std::string, Forward> g_serverCommands;

static std::string Lower(const char *text)
{
	std::string lower = text ? text : "";
	for (size_t i = 0; i < lower.size(); i++)
		lower[i] = (char)tolower((unsigned char)lower[i]);
	return lower;
}

/** A plugin's handler of the command `lower`, its name in lower case. */
static void AddCommand(std::map<std::string, Forward> &commands, const std::string &lower, int32_t fn, int32_t shape, int access)
{
	Handler h;
	h.plugin = g_currentPlugin;
	h.fn = (uint32_t)fn;
	h.shape = shape;
	h.tag = TakeTag();
	h.access = access;
	Bind(h);
	commands[lower].handlers.push_back(h);
}

/**
 * Runs a command's handlers in order, as AMX Mod X runs its own: a player's
 * id, the command's flags and 0, as register_clcmd's handler gets them. One
 * that answers PLUGIN_HANDLED takes the command; PLUGIN_HANDLED_MAIN keeps
 * it from the game and lets the rest have it. A handler that says nothing
 * has handled it. What the handlers answered, or'ed.
 */
static cell RunCommand(Forward &f, int id)
{
	f.depth++;
	cell result = 0;
	int flags = -1;
	for (size_t i = 0, end = f.handlers.size(); i < end && !(result & 1); i++) {
		const Handler &h = f.handlers[i];
		if (h.plugin == HANDLER_GONE)
			continue;
		if (h.access) {
			if (flags < 0)
				flags = MF_GetPlayerFlags(id);
			if (!(flags & h.access))
				continue;
		}
		uint32_t argv[MAX_EVENT_ARGS] = { (uint32_t)id, (uint32_t)h.access, 0, 0 };
		result |= Fire(h, argv, MAX_EVENT_ARGS, 1);   // PLUGIN_HANDLED
	}
	EndDispatch(f);
	return result;
}

// clcmd(name, handler, flags, shape) - a player's command, heard in ClientCommand.
static void w_clcmd(wasm_exec_env_t env, int32_t name, int32_t fn, int32_t flags, int32_t shape)
{
	AddCommand(g_clientCommands, Lower(AsString(Inst(env), name).c_str()), fn, shape, flags);
}

static void ServerCommand();

/**
 * The names the module gave the engine as server commands. The engine keeps
 * a name's pointer and cannot take a command back, so a name is handed to it
 * once a process and lives as long as the module; one callback answers them
 * all (ServerCommand), and a name whose plugin stopped answers nothing.
 */
static std::set<std::string> g_engineCommands;

static void AddEngineCommand(const std::string &name)
{
	std::pair<std::set<std::string>::iterator, bool> added = g_engineCommands.insert(name);
	if (added.second)
		REG_SVR_COMMAND((char *)added.first->c_str(), ServerCommand);
}

// srvcmd(name, handler, shape) - a server command, the engine's.
static void w_srvcmd(wasm_exec_env_t env, int32_t name, int32_t fn, int32_t shape)
{
	std::string lower = Lower(AsString(Inst(env), name).c_str());
	AddEngineCommand(lower);
	AddCommand(g_serverCommands, lower, fn, shape, 0);
}

/**
 * arg(index) - a cell of the callback that is running, beyond the four it was
 * handed.
 *
 * A handler's shape is fixed at four arguments because call_indirect needs one
 * type, and a hooked game function or a message handler sometimes carries more.
 * Those arguments were never lost, only not pushed; this reads them where they
 * are. Index 0 is the first argument, the same one the handler got as `a`.
 */
static int32_t w_arg(wasm_exec_env_t env, int32_t index)
{
	(void)env;
	if (index == -1 && g_chain)
		return (int32_t)ChainResult();
	if (!g_callArgs || index < 0 || index >= g_callArgc)
		return 0;

	return (int32_t)g_callArgs[index];
}

/**
 * argText(index) - the same cell read as the string it points at.
 *
 * A string argument reaches a callback as an address in the AMX that made the
 * call, which is memory this side can read and the plugin cannot. So it is
 * read here and written into the plugin's own buffer, as UTF-8, the way every
 * other string leaves this module.
 */
static int32_t w_argText(wasm_exec_env_t env, int32_t index, int32_t out, int32_t max)
{
	if (g_chain) {
		const char *text = ChainText(index);
		return WriteBytes(Inst(env), out, max, text ? text : "");
	}
	if (!g_callArgs || !g_callAmx || index < 0 || index >= g_callArgc)
		return WriteBytes(Inst(env), out, max, "");

	int len = 0;
	const char *text = MF_GetAmxString(g_callAmx, g_callArgs[index], 0, &len);
	return WriteBytes(Inst(env), out, max, text ? text : "");
}

/**
 * argc() - how many arguments the call that is running actually carried.
 *
 * A handler is always handed four cells, padded with zeros, so a native whose
 * later arguments are optional cannot tell a zero that was passed from one
 * that was not. Pawn's own `params` is this number.
 */
static int32_t w_argc(wasm_exec_env_t env)
{
	(void)env;
	return g_callArgc;
}

/**
 * caller() - which plugin called the exported native that is running: its
 * AMX Mod X id, as get_plugin(-1) answers it in that plugin, asked only here.
 * get_plugin writes the plugin's texts wherever it is told, so it is told one
 * empty cell of that plugin's heap.
 */
static int32_t w_caller(wasm_exec_env_t env)
{
	(void)env;
	if (g_caller != CALLER_OF_AMX)
		return -1;
	Resolved getPlugin = FindNative("get_plugin");
	cell mark = g_callAmx->hea;
	cell addr = 0;
	cell *phys = NULL;
	if (!getPlugin.fn || MF_AmxAllot(g_callAmx, 1, &addr, &phys) != AMX_ERR_NONE)
		return -1;

	// get_plugin(-1, name, 0, title, 0, version, 0, author, 0, status, 0)
	cell params[12] = { 11 * sizeof(cell), -1 };
	for (int i = 2; i < 12; i += 2)
		params[i] = addr;
	cell id = getPlugin.fn(g_callAmx, params);
	g_callAmx->hea = mark;
	return id;
}

/**
 * setArg(index, value) - write back through an argument passed by reference.
 *
 * Pawn's `&value` is an address like a string's, so what arrives is a cell to
 * write through rather than a number to read.
 */
static int32_t w_setArg(wasm_exec_env_t env, int32_t index, int32_t value)
{
	(void)env;
	if (!g_callArgs || !g_callAmx || index < 0 || index >= g_callArgc)
		return 0;

	cell *slot = MF_GetAmxAddr(g_callAmx, g_callArgs[index]);
	if (!slot)
		return 0;

	*slot = (cell)value;
	return 1;
}

/**
 * setArgText(index, text, max) - write back through a string argument.
 *
 * Some callbacks are handed a buffer to fill rather than text to read: a
 * menu_core placeholder, a hookchain argument a plugin means to change. The
 * cell is an address in the caller's memory, so the text goes there, capped at
 * the length the caller said the buffer has.
 */
static int32_t w_setArgText(wasm_exec_env_t env, int32_t index, int32_t text, int32_t max)
{
	if (!g_callArgs || !g_callAmx || index < 0 || index >= g_callArgc)
		return 0;

	if (max <= 0)
		return 0;

	// set_amxstring stops at `max` bytes wherever that is, and half of a
	// Cyrillic letter is not a character: cut before the one that does not fit.
	std::string value = AsString(Inst(env), text);
	if ((int)value.size() > max) {
		int cut = max;
		while (cut > 0 && ((unsigned char)value[cut] & 0xC0) == 0x80)
			cut--;
		value.resize(cut);
	}
	return MF_SetAmxString(g_callAmx, g_callArgs[index], value.c_str(), max);
}

/**
 * The cells an argument points at in the caller's memory, and how many of them
 * there are before the end of its data - the most any read may take.
 */
static cell *CallerCells(int32_t index, int32_t *room)
{
	*room = 0;
	if (g_chain) {
		// A hooked call's vector, where the game keeps it: three floats, as cells.
		cell *vector = (cell *)ChainVector(index);
		*room = vector ? 3 : 0;
		return vector;
	}
	if (!g_callArgs || !g_callAmx || index < 0 || index >= g_callArgc)
		return NULL;

	cell addr = g_callArgs[index];
	if (addr < 0 || addr >= g_callAmx->stp)
		return NULL;

	cell *cells = MF_GetAmxAddr(g_callAmx, addr);
	if (cells)
		*room = (int32_t)((g_callAmx->stp - addr) / (cell)sizeof(cell));
	return cells;
}

/**
 * argString(index, out, max) - a string argument, whole, as UTF-8.
 *
 * Returns its length in bytes; copies as much of it as fits in `max` bytes to
 * `out`, without a terminator. The plugin asks with `max` 0 first and then
 * with a buffer of that size, so a string is never cut at some fixed length -
 * MF_GetAmxString would stop at its own static buffer.
 */
static int32_t w_argString(wasm_exec_env_t env, int32_t index, int32_t out, int32_t max)
{
	int32_t room = 0;
	cell *cells = CallerCells(index, &room);
	if (!cells)
		return 0;

	int32_t length = 0;
	while (length < room && cells[length] != 0)
		length++;

	if (out > 0 && max > 0) {
		wasm_module_inst_t inst = Inst(env);
		int32_t n = length < max ? length : max;
		if (!wasm_runtime_validate_app_addr(inst, (uint64_t)out, (uint64_t)n))
			return 0;

		unsigned char *dst = (unsigned char *)wasm_runtime_addr_app_to_native(inst, (uint64_t)out);
		for (int32_t i = 0; i < n; i++)
			dst[i] = (unsigned char)(cells[i] & 0xFF);
	}

	return length;
}

/**
 * argArray(index, out, count) - `count` cells of an array argument, into the
 * plugin's `out`. Also what a hooked call's vector argument is read with,
 * where the game keeps it (ChainCall), and its answer's at -1.
 */
static int32_t w_argArray(wasm_exec_env_t env, int32_t index, int32_t out, int32_t count)
{
	int32_t room = 0;
	cell *cells = CallerCells(index, &room);
	if (!cells || count <= 0)
		return 0;

	if (count > room)
		count = room;

	wasm_module_inst_t inst = Inst(env);
	if (!wasm_runtime_validate_app_addr(inst, (uint64_t)out, (uint64_t)count * 4))
		return 0;

	int32_t *dst = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)out);
	for (int32_t i = 0; i < count; i++)
		dst[i] = (int32_t)cells[i];
	return count;
}

/**
 * argLength(index) - how many cells an array argument of a forward has: what
 * the emitting plugin sent, or the size the include declares. -1 when nobody
 * says - an unsized array a Pawn plugin raised.
 */
static int32_t w_argLength(wasm_exec_env_t env, int32_t index)
{
	(void)env;
	if (!g_callLengths || index < 0 || index >= g_callArgc)
		return -1;
	return g_callLengths[index];
}

/**
 * setArgArray(index, cells, count) - writes `count` cells from the plugin into
 * an array argument: an exported native's `out[]`, filled up to the `max` the
 * caller gave (the facade has already capped `count` at it).
 */
static int32_t w_setArgArray(wasm_exec_env_t env, int32_t index, int32_t src, int32_t count)
{
	int32_t room = 0;
	cell *cells = CallerCells(index, &room);
	if (!cells || count <= 0)
		return 0;

	if (count > room)
		count = room;

	wasm_module_inst_t inst = Inst(env);
	if (!wasm_runtime_validate_app_addr(inst, (uint64_t)src, (uint64_t)count * 4))
		return 0;

	int32_t *from = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)src);
	for (int32_t i = 0; i < count; i++)
		cells[i] = (cell)from[i];
	if (g_chain && index == -1)
		ChainAnswered();
	return count;
}

// ---------------------------------------------------------------- calling a Pawn plugin's public

/**
 * A PawnFunction's call: get_func_id, callfunc_begin_i, callfunc_push_*,
 * callfunc_end - the module's own natives in the image's table - and
 * callfunc_text, callfunc_buffer and callfunc_finish, which the facade calls
 * for a string and an array.
 *
 * AMX Mod X's callfunc natives look up the calling plugin, and the image is
 * not one. So the module keeps the call and runs it in callfunc_end, with
 * AMX Mod X's callfunc natives called with the target plugin's own AMX: a
 * string and an array lie on that plugin's heap until the call returns, and
 * an array comes back into the TypeScript plugin's memory in callfunc_finish.
 * A publicFor name's handler (get_func_id answers its index with PUBLIC_FOR)
 * is called here instead, its arguments on the image's heap. A call started
 * inside the called function keeps its own: the calls nest.
 */
struct PawnCallArg {
	cell value;
	// For an array: the TypeScript plugin's cells, and how many; 0 for a number or a string.
	int32_t ptr;
	int32_t cells;
	bool text;
};

struct PawnCall {
	AMX *amx;
	int plugin;
	int index;
	cell mark;
	std::vector<PawnCallArg> args;
};

static std::vector<PawnCall> g_pawnCalls;

// AMX Mod X's own callfunc natives, which the module's stand in for (g_ownNatives).
static AMX_NATIVE g_callfuncBeginI = NULL;
static AMX_NATIVE g_callfuncPushInt = NULL;
static AMX_NATIVE g_callfuncPushStr = NULL;
static AMX_NATIVE g_callfuncPushArray = NULL;
static AMX_NATIVE g_callfuncEnd = NULL;

/** The Pawn plugin with AMX Mod X id `plugin`'s AMX; NULL for none. */
static AMX *PluginAmx(cell plugin)
{
	return plugin >= 0 && (size_t)plugin < g_pluginAmx.size() ? g_pluginAmx[plugin] : NULL;
}

// get_func_id(const funcName[], pluginId = -1)
static cell AMX_NATIVE_CALL n_getFuncId(AMX *amx, cell *params)
{
	int len = 0;
	const char *name = MF_GetAmxString(amx, params[1], 0, &len);
	int slot = SlotOf(name);
	if (slot >= 0)
		return PUBLIC_FOR | slot;

	int index = -1;
	AMX *target = PluginAmx(params[2]);
	if (!target || MF_AmxFindPublic(target, name, &index) != AMX_ERR_NONE)
		return -1;
	return index;
}

// callfunc_begin_i(func, plugin = -1)
static cell AMX_NATIVE_CALL n_callfuncBeginI(AMX *amx, cell *params)
{
	(void)amx;
	int index = (int)params[1];
	AMX *target = (index & PUBLIC_FOR) ? g_image : PluginAmx(params[2]);
	if (!target || index < 0)
		return -1;
	PawnCall call = { target, (int)params[2], index, target->hea, {} };
	g_pawnCalls.push_back(call);
	return 1;
}

// callfunc_push_int(value), callfunc_push_float(Float:value)
static cell AMX_NATIVE_CALL n_callfuncPushInt(AMX *amx, cell *params)
{
	(void)amx;
	if (g_pawnCalls.empty())
		return 0;
	g_pawnCalls.back().args.push_back({ params[1], 0, 0, false });
	return 1;
}

/** `cells` cells onto the heap of the call being made, from `from`; their address, 0 when they do not fit. */
static cell PawnCallCells(const cell *from, int cells)
{
	PawnCall &call = g_pawnCalls.back();
	cell addr = 0;
	cell *phys = HeapCells(call.amx, cells, &addr);
	if (phys)
		memcpy(phys, from, (size_t)cells * sizeof(cell));
	return addr;
}

// callfunc_push_str(const value[], bool:copyback = false): a string going in.
static cell AMX_NATIVE_CALL n_callfuncPushStr(AMX *amx, cell *params)
{
	if (g_pawnCalls.empty())
		return 0;
	int len = 0;
	const char *text = MF_GetAmxString(amx, params[1], 0, &len);
	std::vector<cell> cells(len + 1, 0);
	for (int i = 0; i < len; i++)
		cells[i] = (cell)(unsigned char)text[i];
	g_pawnCalls.back().args.push_back({ PawnCallCells(cells.data(), (int)cells.size()), 0, 0, true });
	return 1;
}

// callfunc_push_array(const value[], array_size, bool:copyback = true): an array that does not come back.
static cell AMX_NATIVE_CALL n_callfuncPushArray(AMX *amx, cell *params)
{
	const cell *from = MF_GetAmxAddr(amx, params[1]);
	int cells = (int)params[2];
	if (g_pawnCalls.empty() || !from || cells <= 0 || cells > MAX_CROSSING_CELLS)
		return 0;
	g_pawnCalls.back().args.push_back({ PawnCallCells(from, cells), 0, 0, false });
	return 1;
}

/** callfunc_text(text) - the text, whole and as UTF-8, as the next argument. */
static int32_t w_callfuncText(wasm_exec_env_t env, int32_t text)
{
	if (g_pawnCalls.empty())
		return 0;
	std::string s = AsString(Inst(env), text);
	int n = (int)s.size() < MAX_CROSSING_CELLS - 1 ? (int)s.size() : MAX_CROSSING_CELLS - 1;
	std::vector<cell> cells(n + 1, 0);
	for (int i = 0; i < n; i++)
		cells[i] = (cell)(unsigned char)s[i];
	g_pawnCalls.back().args.push_back({ PawnCallCells(cells.data(), n + 1), 0, 0, true });
	return 1;
}

/** callfunc_buffer(cells, count) - `count` cells the function may fill, copied back by callfunc_finish. */
static int32_t w_callfuncBuffer(wasm_exec_env_t env, int32_t ptr, int32_t count)
{
	wasm_module_inst_t inst = Inst(env);
	if (g_pawnCalls.empty() || count <= 0 || count > MAX_CROSSING_CELLS
	    || !wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, (uint64_t)count * 4))
		return 0;
	const int32_t *src = (const int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
	std::vector<cell> cells(src, src + count);
	cell addr = PawnCallCells(cells.data(), count);
	g_pawnCalls.back().args.push_back({ addr, addr ? ptr : 0, addr ? count : 0, false });
	return 1;
}

/** Runs the call on top: a publicFor name's handler, or the plugin's public through AMX Mod X's callfunc. */
static cell RunPawnCall(PawnCall &call)
{
	std::vector<cell> cells;
	for (const PawnCallArg &arg : call.args)
		cells.push_back(arg.value);

	size_t slot = (size_t)(call.index & ~PUBLIC_FOR);
	if (call.index & PUBLIC_FOR) {
		if (slot >= g_slots.size() || g_slots[slot].plugin == SLOT_ORPHANED)
			return 0;
		int argc = (int)cells.size();
		int n = argc > MAX_EVENT_ARGS ? MAX_EVENT_ARGS : argc;
		uint32_t argv[MAX_EVENT_ARGS] = { 0, 0, 0, 0 };
		for (int i = 0; i < n; i++)
			argv[i] = (uint32_t)cells[i];
		CallArgs context(cells.data(), argc, call.amx);
		return Fire(g_slots[slot], argv, n, g_slots[slot].fallback);
	}

	// Resolving them gives AMX Mod X's own (OwnNative).
	for (const char *name : { "callfunc_begin_i", "callfunc_push_int", "callfunc_push_str", "callfunc_push_array", "callfunc_end" })
		FindNative(name);
	cell begin[3] = { 2 * sizeof(cell), call.index, call.plugin };
	if (!g_callfuncBeginI || !g_callfuncPushInt || !g_callfuncPushStr || !g_callfuncPushArray || !g_callfuncEnd
	    || g_callfuncBeginI(call.amx, begin) != 1)
		return 0;
	for (const PawnCallArg &arg : call.args) {
		// A string goes in; an array of the TypeScript plugin's comes back (copyback 1).
		cell text[3] = { 2 * sizeof(cell), arg.value, 0 };
		cell array[4] = { 3 * sizeof(cell), arg.value, arg.cells, 1 };
		cell number[2] = { sizeof(cell), arg.value };
		if (arg.text) g_callfuncPushStr(call.amx, text);
		else if (arg.ptr) g_callfuncPushArray(call.amx, array);
		else g_callfuncPushInt(call.amx, number);
	}
	cell none[1] = { 0 };
	return g_callfuncEnd(call.amx, none);
}

// callfunc_end(): the call, its heap let go. What callfunc_finish does, for a raw call.
static cell AMX_NATIVE_CALL n_callfuncEnd(AMX *amx, cell *params)
{
	(void)amx; (void)params;
	if (g_pawnCalls.empty())
		return 0;
	PawnCall call = g_pawnCalls.back();
	g_pawnCalls.pop_back();
	cell result = RunPawnCall(call);
	call.amx->hea = call.mark;
	return result;
}

/** callfunc_finish() - callfunc_end, the arrays copied back, the heap released. What the function returned. */
static int32_t w_callfuncFinish(wasm_exec_env_t env)
{
	if (g_pawnCalls.empty())
		return 0;
	PawnCall call = g_pawnCalls.back();
	g_pawnCalls.pop_back();
	cell result = RunPawnCall(call);

	wasm_module_inst_t inst = Inst(env);
	for (const PawnCallArg &arg : call.args) {
		cell *phys = arg.ptr ? MF_GetAmxAddr(call.amx, arg.value) : NULL;
		if (!phys || !wasm_runtime_validate_app_addr(inst, (uint64_t)arg.ptr, (uint64_t)arg.cells * 4))
			continue;
		int32_t *dst = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)arg.ptr);
		for (int32_t k = 0; k < arg.cells; k++)
			dst[k] = (int32_t)phys[k];
	}
	call.amx->hea = call.mark;
	return (int32_t)result;
}

/**
 * slot(handler, shape, key, fallback) - a publicFor name for a wasm function,
 * "__amxts_cb<n>", for the natives that take a public's name from a
 * TypeScript plugin: register_menucmd, a PawnFunction of a module's native
 * (menu-core's registrars).
 *
 * Returns n. A name taken back on a reload returns it with SLOT_REUSED set,
 * because the registration made with it stays: the plugin must not register
 * the name a second time, or the handler fires twice.
 */
static int32_t w_slot(wasm_exec_env_t env, int32_t fn, int32_t shape, int32_t key, int32_t fallback)
{
	std::string name = AsString(Inst(env), key);

	bool reused = false;
	int slot = TakeSlot(fn, shape, name.c_str(), &reused, fallback);
	if (slot < 0)
		return -1;

	return reused ? (slot | SLOT_REUSED) : slot;
}

// ---------------------------------------------------------------- timers
//
// setTimeout, setInterval and sleep: a slot each, and a binary heap of the
// armed slots by due time, walked once a frame (RunTimers, from StartFrame).
// task hands the plugin its timer's slot, which the plugin keeps the timer
// by: arming takes a free slot and pushes it, clearing takes it out of the
// heap and frees it, firing calls the plugin directly. No AMX Mod X task, so
// no limit.

struct Timer {
	Handler  handler;
	double   due;
	double   every;     // a repeating timer's period in seconds; < 0 fires once
	uint64_t order;     // arming order: two timers due together fire as armed
	uint32_t serial;    // counts the slot's timers: one cleared and armed again is another
	int32_t  heapAt;    // its place in g_timerHeap, -1 while it is not there
	int32_t  nextFree;  // the next free slot, while this one is free
	bool     armed;
};

static std::vector<Timer> g_timerSlots;
static std::vector<int32_t> g_timerHeap;   // armed slots, the earliest due on top
static int32_t g_freeTimer = -1;
static uint64_t g_timerOrder = 0;

// When the frame looks at the plugins' files next (WatchPlugins).
static float g_nextWatch = 0;

/** Whether slot `a` fires before slot `b`: the earlier due, then the earlier armed. */
static bool Earlier(int32_t a, int32_t b)
{
	const Timer &x = g_timerSlots[a], &y = g_timerSlots[b];
	return x.due != y.due ? x.due < y.due : x.order < y.order;
}

static void PlaceTimer(size_t at, int32_t slot)
{
	g_timerHeap[at] = slot;
	g_timerSlots[slot].heapAt = (int32_t)at;
}

/** Moves the slot at `at` up or down the heap, to where its due puts it. */
static void SiftTimer(size_t at)
{
	int32_t slot = g_timerHeap[at];
	while (at > 0 && Earlier(slot, g_timerHeap[(at - 1) / 2])) {
		PlaceTimer(at, g_timerHeap[(at - 1) / 2]);
		at = (at - 1) / 2;
	}
	for (size_t n = g_timerHeap.size(), child; (child = 2 * at + 1) < n; at = child) {
		if (child + 1 < n && Earlier(g_timerHeap[child + 1], g_timerHeap[child]))
			child++;
		if (!Earlier(g_timerHeap[child], slot))
			break;
		PlaceTimer(at, g_timerHeap[child]);
	}
	PlaceTimer(at, slot);
}

static void QueueTimer(int32_t slot, double due)
{
	g_timerSlots[slot].due = due;
	g_timerSlots[slot].order = g_timerOrder++;
	g_timerHeap.push_back(slot);
	SiftTimer(g_timerHeap.size() - 1);
}

static void UnqueueTimer(int32_t slot)
{
	size_t at = (size_t)g_timerSlots[slot].heapAt;
	g_timerSlots[slot].heapAt = -1;
	int32_t last = g_timerHeap.back();
	g_timerHeap.pop_back();
	if (at < g_timerHeap.size()) {
		PlaceTimer(at, last);
		SiftTimer(at);
	}
}

static void FreeTimer(int32_t slot)
{
	Timer &t = g_timerSlots[slot];
	if (t.heapAt >= 0)
		UnqueueTimer(slot);
	t.armed = false;
	t.nextFree = g_freeTimer;
	g_freeTimer = slot;
}

/**
 * task(seconds, handler, repeat) - fires `handler(slot)` after `seconds`, and
 * every `seconds` after that when `repeat` is set; returns the timer's slot,
 * -1 outside a plugin's call. The slot is the timer's until it has fired
 * once, or until stop_task, and then the next timer's.
 *
 * The delay arrives as the bit pattern of a 32-bit float rather than as an f32
 * parameter: keeping every signature to `i` means the table wamrc reads
 * cannot disagree with the module about anything but arity.
 */
static int32_t w_task(wasm_exec_env_t env, int32_t secondsBits, int32_t fn, int32_t repeat)
{
	(void)env;
	int32_t tag = TakeTag();
	if (g_currentPlugin < 0 || !gpGlobals)
		return -1;

	float seconds;
	memcpy(&seconds, &secondsBits, sizeof(seconds));
	if (!(seconds > 0))
		seconds = 0;

	int32_t slot = g_freeTimer;
	if (slot >= 0) {
		g_freeTimer = g_timerSlots[slot].nextFree;
	}
	else {
		slot = (int32_t)g_timerSlots.size();
		g_timerSlots.push_back(Timer());
	}

	Timer &t = g_timerSlots[slot];
	t.handler = Handler();
	t.handler.plugin = g_currentPlugin;
	t.handler.fn = (uint32_t)fn;
	t.handler.shape = SHAPE_NARROW;
	t.handler.tag = tag;
	Bind(t.handler);
	t.every = repeat ? seconds : -1;
	t.serial++;
	t.heapAt = -1;
	t.armed = true;

	QueueTimer(slot, gpGlobals->time + seconds);
	return slot;
}

/** stop_task(slot) - the calling plugin's timer there does not fire again; 1 if it was armed. */
static int32_t w_stopTask(wasm_exec_env_t env, int32_t slot)
{
	(void)env;
	if (slot < 0 || (size_t)slot >= g_timerSlots.size() || !g_timerSlots[slot].armed
	    || g_timerSlots[slot].handler.plugin != g_currentPlugin)
		return 0;
	FreeTimer(slot);
	return 1;
}

/**
 * Fires every timer that is due. What is due is taken off the heap first, so
 * a timer armed or repeated by a handler waits for a later frame, even with
 * no delay. Precision: one frame.
 */
static void RunTimers()
{
	if (g_timerHeap.empty() || g_timerSlots[g_timerHeap[0]].due > gpGlobals->time)
		return;

	struct Due { int32_t slot; uint32_t serial; };
	// Kept from frame to frame, so a frame allocates nothing; a handler
	// never runs a frame, so this is never walked twice at once.
	static std::vector<Due> due;
	due.clear();
	double now = gpGlobals->time;
	while (!g_timerHeap.empty() && g_timerSlots[g_timerHeap[0]].due <= now) {
		int32_t slot = g_timerHeap[0];
		UnqueueTimer(slot);
		due.push_back({ slot, g_timerSlots[slot].serial });
	}

	for (size_t i = 0; i < due.size(); i++) {
		Timer &t = g_timerSlots[due[i].slot];
		if (!t.armed || t.serial != due[i].serial)
			continue;   // cleared by a handler before it, and maybe armed again

		// A copy: the handler may clear this timer or arm others.
		Handler h = t.handler;
		if (t.every < 0)
			FreeTimer(due[i].slot);
		else
			QueueTimer(due[i].slot, now + t.every);

		uint32_t argv[1] = { (uint32_t)due[i].slot };
		Fire(h, argv, 1, 0);
	}
}

/** A stopped plugin's timers go. */
static void DropTimers(int plugin)
{
	for (size_t slot = 0; slot < g_timerSlots.size(); slot++)
		if (g_timerSlots[slot].armed && g_timerSlots[slot].handler.plugin == plugin)
			FreeTimer((int32_t)slot);
}

// The most arguments one dispatched call carries: a forward's 32 after
// ExecuteForward's handle and result, and room to spare.
#define MAX_CALL_ARGS 64

/**
 * amxts_call(nativeId, argsPtr, maskPtr, argc) - every native with a `...` tail.
 *
 * WebAssembly fixes an import's arity, so a variadic native cannot be imported
 * at all and gets none of the generated thunks. The plugin lays its arguments
 * out as cells instead and says, one byte each, what they are; this builds the
 * AMX frame from that. `Call` in as/facade.ts is the other half.
 *
 *   n  the cell as it stands
 *   s  a pointer to a zero-terminated string, in cells, in plugin memory
 *   b  a pointer to cells whose length is the next argument - its value, or
 *      what it points at when it is an `r`; copied back
 *   v  a pointer to three cells, a vector; copied back
 *   r  a pointer to one cell, passed to the native by address and copied back
 *   a  an array for a forward: a pointer to its count and then its cells,
 *      handed to PrepareArray, whose handle goes by address as `r` does
 *
 * `r` is what a `...` tail needs: Pawn pushes the ADDRESS of every argument in
 * a tail, never its value, so a plain number there has to be given a cell of
 * its own to live in. Getting that wrong is what made `server_print("%d", 42)`
 * print whatever sat at DAT+42 in the JavaScript runtime.
 */
static int32_t w_call(wasm_exec_env_t env, int32_t id, int32_t argsPtr, int32_t maskPtr, int32_t argc)
{
	int count = (int)(sizeof(g_dispatchedNatives) / sizeof(g_dispatchedNatives[0]));
	if (id < 0 || id >= count) {
		MF_PrintSrvConsole("[amxts] amxts_call: no native with id %d\n", id);
		return 0;
	}

	static Cached natives[sizeof(g_dispatchedNatives) / sizeof(g_dispatchedNatives[0])];
	Frame f(env, Resolve(natives[id], g_dispatchedNatives[id]));

	if (argc < 0 || argc > MAX_CALL_ARGS)
		return 0;

	if (!wasm_runtime_validate_app_addr(f.inst, (uint64_t)argsPtr, (uint64_t)argc * 4)
	    || !wasm_runtime_validate_app_addr(f.inst, (uint64_t)maskPtr, (uint64_t)argc))
		return 0;

	int32_t *args = (int32_t *)wasm_runtime_addr_app_to_native(f.inst, (uint64_t)argsPtr);
	unsigned char *mask = (unsigned char *)wasm_runtime_addr_app_to_native(f.inst, (uint64_t)maskPtr);

	struct Back { int32_t ptr; int32_t cells; cell addr; };
	Back back[MAX_CALL_ARGS];
	int backCount = 0;

	// The frame: the count, then the arguments, zeros behind them for a native
	// that reads an optional parameter it was not given (see Args).
	cell p[MAX_CALL_ARGS + 1] = { 0 };
	p[0] = argc * sizeof(cell);

	// A buffer's length is the argument after it. One longer than what
	// crosses is copied only that far, so the native is told that far too
	// (-1: the next argument is no clamped length).
	int32_t clamped = -1;

	for (int i = 0; i < argc; i++) {
		int32_t cells = 0;
		int32_t length = clamped;
		clamped = -1;
		switch (mask[i]) {
			case 's':
				p[i + 1] = f.inText(args[i]);
				continue;

			case 'b':
				if (i + 1 < argc)
					cells = mask[i + 1] == 'r' && f.Cells(args[i + 1], 1)
						? *(int32_t *)wasm_runtime_addr_app_to_native(f.inst, (uint64_t)args[i + 1])
						: args[i + 1];
				if (cells > MAX_CROSSING_CELLS)
					clamped = cells = MAX_CROSSING_CELLS;
				break;

			// A vector in a `...` tail: three cells at the address, and the
			// length is not an argument of its own, as a buffer's would be.
			case 'v':
				cells = 3;
				break;

			case 'r':
				cells = 1;
				break;

			// The array lives on the heap until the frame ends, after the
			// native: PrepareArray keeps a pointer to it, which ExecuteForward reads.
			case 'a': {
				int32_t n = 0;
				int32_t *values = ForwardArray(f.inst, args[i], &n);
				Args prepare(3);
				cell *phys = values ? HeapCells(f.amx, n + 1, &prepare[1]) : NULL;
				if (phys)
					memcpy(phys, values, (size_t)n * sizeof(cell));
				prepare[2] = phys ? n : 0;
				cell *handle = HeapCells(f.amx, 1, &p[i + 1]);
				if (handle)
					*handle = CallNative("PrepareArray", prepare);
				continue;
			}

			default:
				p[i + 1] = length >= 0 ? length : args[i];
				continue;
		}

		p[i + 1] = f.in(args[i], cells);
		if (!p[i + 1])
			return 0;
		if (length >= 0)
			*MF_GetAmxAddr(f.amx, p[i + 1]) = length;
		back[backCount].ptr = args[i];
		back[backCount].cells = cells;
		back[backCount].addr = p[i + 1];
		backCount++;
	}

	cell r = CallResolved(natives[id], p);
	g_hamQuiet = -1;

	for (int i = 0; i < backCount; i++)
		f.out(back[i].ptr, back[i].cells, back[i].addr);

	return (int32_t)r;
}

// plugin(name, version, author, description) - what the listing shows.
static void w_meta(wasm_exec_env_t env, int32_t name, int32_t version, int32_t author, int32_t description)
{
	if (g_currentPlugin < 0 || (size_t)g_currentPlugin >= g_plugins.size())
		return;

	Plugin &p = g_plugins[g_currentPlugin];
	wasm_module_inst_t inst = Inst(env);

	p.title = AsString(inst, name);
	p.version = AsString(inst, version);
	p.author = AsString(inst, author);
	p.description = AsString(inst, description);
}

/**
 * export(name, handler) - a native for other plugins to call: nativeFn, and
 * every `export function` of a plugin's entry file (scripts/plugin-natives.ts
 * writes a wrapper for each and registers it here).
 *
 * Every argument crosses as a cell, which is what Pawn pushes, and the handler
 * says what it returns with ret(). A string or an array argument is an address
 * in the calling plugin, read there with argString / argArray and written
 * with setArgText / setArgArray.
 */
static int32_t w_export(wasm_exec_env_t env, int32_t name, int32_t fn)
{
	if (g_currentPlugin < 0)
		return -1;

	std::string wanted = AsString(Inst(env), name);
	int32_t tag = TakeTag();

	// A name the list has - from this map, an earlier one or a plugin before a
	// reload - is this plugin's now.
	std::map<std::string, size_t>::iterator it = g_exportedByName.find(wanted);
	size_t slot = it != g_exportedByName.end() ? it->second : g_exported.size();
	if (slot == MAX_EXPORTED) {
		MF_PrintSrvConsole("[amxts] no room for the native %s: the server has %d exported natives' names until it restarts\n", wanted.c_str(), MAX_EXPORTED);
		return -1;
	}
	if (slot == g_exported.size()) {
		g_exported.push_back(Exported());
		g_exported[slot].name = wanted;
		g_exportedByName[wanted] = slot;
		// AMX Mod X keeps the name's pointer for the process: it is never freed.
		g_exportedList[slot].name = strdup(wanted.c_str());
		g_exportedList[slot].func = g_exportedEntries[slot];
		BindLoaded(g_exportedList[slot]);
	}

	Exported &exported = g_exported[slot];
	exported.plugin = g_currentPlugin;
	exported.fn = (uint32_t)fn;
	exported.shape = SHAPE_WIDE;
	exported.tag = tag;
	Bind(exported);
	return (int32_t)slot;
}

// ---------------------------------------------------------------- player fields

/**
 * The fields plugins add to Player, by slot and field name, shared by every
 * plugin - a TS plugin through the imports below (the accessors on Player are
 * generated by scripts/player-fields.ts), a Pawn one through the
 * amxts_*_player_data natives.
 *
 * A value is a number or a text; a boolean is the number 1 or 0. A field
 * never written - or read as the other kind - is 0 or "". A slot is cleared
 * when its player leaves (client_disconnected, after the plugins have heard
 * it), and every slot when a map starts: the plugins start over with the map,
 * and what they share starts over with them. amxts_reload keeps it - the
 * players are still there.
 */
#define PLAYER_DATA_SLOTS 33

struct PlayerValue {
	bool text;
	/** A text that is a list of player ids, "3,5": the ids of those who leave are taken out. */
	bool players;
	double number;
	std::string value;
};

static std::map<std::string, PlayerValue> g_playerData[PLAYER_DATA_SLOTS];

/**
 * The playerchange listeners: per plugin, the fields it listens for ("" for
 * every one) and its trampoline, which hands the change to its listeners.
 * Filtered here, so a plugin listening for "ghost" is not called for "vip".
 * A field is the name the plugin declared, or an object field's member,
 * "glow.enabled" - which "glow" also hears.
 */
struct FieldListener : Handler {
	std::vector<std::string> fields;
};

static std::vector<FieldListener> g_fieldListeners;

/** The change being told, which the player_change_* imports read; NULL outside one. */
struct FieldChange {
	std::string key;
	PlayerValue previous;
	PlayerValue value;
};

static const FieldChange *g_fieldChange = NULL;

static bool FieldMatches(const std::vector<std::string> &fields, const std::string &key)
{
	for (size_t i = 0; i < fields.size(); i++) {
		const std::string &field = fields[i];
		if (field.empty() || field == key)
			return true;
		if (key.size() > field.size() && key[field.size()] == '.' && key.compare(0, field.size(), field) == 0)
			return true;
	}
	return false;
}

static cell Fire(Handler h, uint32_t *argv, int argc, cell fallback);

/**
 * A write changed player `id`'s `key`: every plugin listening for it hears
 * it, once, in the writer's call - any plugin's write, or Pawn's through the
 * natives. Nothing is told when a player leaves or the map changes.
 */
static void FieldChanged(int id, const std::string &key, const PlayerValue &previous)
{
	if (g_fieldListeners.empty())
		return;

	FieldChange change = { key, previous, g_playerData[id][key] };
	const FieldChange *outer = g_fieldChange;
	g_fieldChange = &change;

	// A copy: a listener that adds one must not move this loop's floor.
	std::vector<FieldListener> listeners = g_fieldListeners;
	for (size_t i = 0; i < listeners.size(); i++) {
		if (!FieldMatches(listeners[i].fields, key))
			continue;
		uint32_t slot = (uint32_t)id;
		Fire(listeners[i], &slot, 1, 0);
	}

	g_fieldChange = outer;
}

static PlayerValue *FindPlayerValue(int id, const std::string &key)
{
	if (id < 0 || id >= PLAYER_DATA_SLOTS)
		return NULL;
	std::map<std::string, PlayerValue>::iterator it = g_playerData[id].find(key);
	return it == g_playerData[id].end() ? NULL : &it->second;
}

static double PlayerNumber(int id, const std::string &key)
{
	PlayerValue *found = FindPlayerValue(id, key);
	return found && !found->text ? found->number : 0.0;
}

static std::string PlayerText(int id, const std::string &key)
{
	PlayerValue *found = FindPlayerValue(id, key);
	return found && found->text ? found->value : std::string();
}

/** What `key` holds for `id` - a copy, empty when never written. */
static PlayerValue PlayerValueOf(int id, const std::string &key)
{
	PlayerValue *found = FindPlayerValue(id, key);
	return found ? *found : PlayerValue();
}

static void SetPlayerNumber(int id, const std::string &key, double number)
{
	if (id < 0 || id >= PLAYER_DATA_SLOTS)
		return;
	PlayerValue previous = PlayerValueOf(id, key);
	bool changed = PlayerNumber(id, key) != number || !PlayerText(id, key).empty();
	PlayerValue &slot = g_playerData[id][key];
	slot.text = false;
	slot.players = false;
	slot.number = number;
	slot.value.clear();
	if (changed)
		FieldChanged(id, key, previous);
}

/** A text; `players` marks it a list of ids. A list stays one when Pawn writes it as text. */
static void SetPlayerText(int id, const std::string &key, const std::string &text, bool players = false)
{
	if (id < 0 || id >= PLAYER_DATA_SLOTS)
		return;
	PlayerValue previous = PlayerValueOf(id, key);
	bool changed = PlayerText(id, key) != text || PlayerNumber(id, key) != 0.0;
	PlayerValue &slot = g_playerData[id][key];
	slot.players = players || (slot.text && slot.players);
	slot.text = true;
	slot.number = 0.0;
	slot.value = text;
	if (changed)
		FieldChanged(id, key, previous);
}

/** "3,5,7" without `id`; the same text when he is not in it. */
static std::string WithoutPlayer(const std::string &list, int id)
{
	std::string out;
	size_t from = 0;
	while (from <= list.size()) {
		size_t comma = list.find(',', from);
		if (comma == std::string::npos)
			comma = list.size();
		std::string one = list.substr(from, comma - from);
		if (!one.empty() && atoi(one.c_str()) != id) {
			if (!out.empty())
				out += ',';
			out += one;
		}
		from = comma + 1;
	}
	return out;
}

/**
 * He left, or the map changed: his fields go, and he goes from everyone's
 * lists of players. Nobody is told - a plugin hears "disconnected".
 */
static void ClearPlayerData(int id)
{
	if (id < 0 || id >= PLAYER_DATA_SLOTS)
		return;

	g_playerData[id].clear();

	for (int other = 0; other < PLAYER_DATA_SLOTS; other++) {
		for (std::map<std::string, PlayerValue>::iterator it = g_playerData[other].begin(); it != g_playerData[other].end(); ++it) {
			if (it->second.text && it->second.players)
				it->second.value = WithoutPlayer(it->second.value, id);
		}
	}
}

/** The text's UTF-8 length; with a buffer, as much of it as fits (no terminator). */
static int32_t CopyText(wasm_module_inst_t inst, const std::string &text, int32_t out, int32_t max)
{
	int32_t length = (int32_t)text.size();

	if (out > 0 && max > 0) {
		int32_t n = length < max ? length : max;
		if (!wasm_runtime_validate_app_addr(inst, (uint64_t)out, (uint64_t)n))
			return 0;
		memcpy(wasm_runtime_addr_app_to_native(inst, (uint64_t)out), text.data(), n);
	}

	return length;
}

static double w_playerDataGet(wasm_exec_env_t env, int32_t id, int32_t key)
{
	return PlayerNumber(id, AsString(Inst(env), key));
}

static void w_playerDataSet(wasm_exec_env_t env, int32_t id, int32_t key, double value)
{
	SetPlayerNumber(id, AsString(Inst(env), key), value);
}

static int32_t w_playerDataGetText(wasm_exec_env_t env, int32_t id, int32_t key, int32_t out, int32_t max)
{
	wasm_module_inst_t inst = Inst(env);
	return CopyText(inst, PlayerText(id, AsString(inst, key)), out, max);
}

static void w_playerDataSetText(wasm_exec_env_t env, int32_t id, int32_t key, int32_t value)
{
	wasm_module_inst_t inst = Inst(env);
	SetPlayerText(id, AsString(inst, key), AsString(inst, value));
}

/** A Player[] field: the ids as text, "3,5". */
static void w_playerDataSetPlayers(wasm_exec_env_t env, int32_t id, int32_t key, int32_t value)
{
	wasm_module_inst_t inst = Inst(env);
	SetPlayerText(id, AsString(inst, key), AsString(inst, value), true);
}

/** player_change_listen(field, fn): this plugin hears `field` ("" for every one) through `fn`. */
static void w_playerChangeListen(wasm_exec_env_t env, int32_t field, int32_t fn)
{
	if (g_currentPlugin < 0)
		return;

	std::string name = AsString(Inst(env), field);
	for (size_t i = 0; i < g_fieldListeners.size(); i++) {
		FieldListener &listener = g_fieldListeners[i];
		if (listener.plugin != g_currentPlugin)
			continue;
		if (std::find(listener.fields.begin(), listener.fields.end(), name) == listener.fields.end())
			listener.fields.push_back(name);
		return;
	}

	FieldListener listener;
	listener.plugin = g_currentPlugin;
	listener.fn = (uint32_t)fn;
	listener.shape = SHAPE_NARROW;
	listener.fields.push_back(name);
	Bind(listener);
	g_fieldListeners.push_back(listener);
}

/** The value of the change being told: 1 before it, 2 after; a number, 0 for a text. */
static const PlayerValue *ChangedValue(int32_t which)
{
	if (!g_fieldChange)
		return NULL;
	return which == 1 ? &g_fieldChange->previous : &g_fieldChange->value;
}

/** player_change_get(which): the number before (1) or after (2) the change. */
static double w_playerChangeGet(wasm_exec_env_t env, int32_t which)
{
	(void)env;
	const PlayerValue *value = ChangedValue(which);
	return value && !value->text ? value->number : 0.0;
}

/** player_change_get_text(which, out, max): 0 the key that changed, 1 the text before, 2 after. */
static int32_t w_playerChangeGetText(wasm_exec_env_t env, int32_t which, int32_t out, int32_t max)
{
	const PlayerValue *value = ChangedValue(which);
	std::string text = !g_fieldChange ? std::string()
		: which == 0 ? g_fieldChange->key
		: value->text ? value->value : std::string();
	return CopyText(Inst(env), text, out, max);
}

// ---------------------------------------------------------------- plugins

/** Which plugin a module instance is - or, while it is being loaded, the current one. */
static int PluginOf(wasm_module_inst_t inst)
{
	for (size_t i = 0; i < g_plugins.size(); i++)
		if (g_plugins[i].inst == inst)
			return (int)i;
	return g_currentPlugin;
}

/**
 * player_slots(at): the facade's table of PLAYER_DATA_SLOTS cells, one a
 * player id, where the module writes 1 when a new player takes that slot
 * (NewPlayer).
 */
static void w_playerSlots(wasm_exec_env_t env, int32_t at)
{
	wasm_module_inst_t inst = Inst(env);
	int index = PluginOf(inst);
	if (index < 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)at, PLAYER_DATA_SLOTS * sizeof(int32_t)))
		return;
	g_plugins[index].playerSlots = at;
}

/**
 * player_names(at): the facade's table of PLAYER_DATA_SLOTS cells, one a
 * player id, where the module counts the changes of that player's name, as
 * get_user_name reads it (NameChanges). The facade keeps a name while the
 * count is the one it read it at.
 */
static void w_playerNames(wasm_exec_env_t env, int32_t at)
{
	wasm_module_inst_t inst = Inst(env);
	int index = PluginOf(inst);
	if (index < 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)at, PLAYER_DATA_SLOTS * sizeof(int32_t)))
		return;
	g_plugins[index].playerNames = at;
}

/** Plugin `p`'s table at `at` (player_slots, player_names), or NULL before it gives one. */
static int32_t *PlayerTable(Plugin &p, int32_t at)
{
	return p.inst && at ? (int32_t *)wasm_runtime_addr_app_to_native(p.inst, (uint64_t)at) : NULL;
}

// A name change under way in some slot: the next frame ends it (NameChanges).
static bool g_namesChanging = false;

/**
 * Counts a change of a player's name in each plugin's table (player_names):
 * `step` 2 for a new player in the slot, whose name AMX Mod X already has;
 * 1 to make the count odd, from client_infochanged on - AMX Mod X takes the
 * new name as the forward returns, whoever set it, set_user_info from Pawn
 * too - until the next frame, which makes it even again. A name read while
 * the count is odd is not kept.
 */
static void NameChanges(int id, int step)
{
	for (size_t i = 0; i < g_plugins.size(); i++) {
		int32_t *count = PlayerTable(g_plugins[i], g_plugins[i].playerNames);
		if (count && (step == 2 || !(count[id] & 1)))
			count[id] += step;
	}
	if (step == 1)
		g_namesChanging = true;
}

/** The frame after a name change: every odd count goes even (NameChanges). */
static void NamesChanged()
{
	g_namesChanging = false;
	for (size_t i = 0; i < g_plugins.size(); i++) {
		int32_t *count = PlayerTable(g_plugins[i], g_plugins[i].playerNames);
		for (int id = 0; count && id < PLAYER_DATA_SLOTS; id++)
			count[id] += count[id] & 1;
	}
}

/**
 * A player is connecting to slot `id`: each plugin's Player of the slot is
 * the one who left, and its facade makes a new one for him.
 */
static void NewPlayer(int id)
{
	if (id < 0 || id >= PLAYER_DATA_SLOTS)
		return;

	for (size_t i = 0; i < g_plugins.size(); i++) {
		int32_t *slots = PlayerTable(g_plugins[i], g_plugins[i].playerSlots);
		if (slots)
			slots[id] = 1;
	}
	NameChanges(id, 2);
}

static const char *PluginName(int index)
{
	return index >= 0 && (size_t)index < g_plugins.size() ? g_plugins[index].name.c_str() : "?";
}

// ---------------------------------------------------------------- errors

// A failed call's stack, in the plugin's TypeScript: abort, Failed, and the
// natives of an Error's stack.
#include "stack.h"

// ---------------------------------------------------------------- coroutines

// async functions: co_spawn, co_suspend and the rest, and DrainJobs.
#include "coroutines.h"

// ---------------------------------------------------------------- shared modules

/**
 * A module one plugin runs for all of them (scripts/shared-modules.ts): the
 * owner serves it by name, and every other plugin's proxy calls it here.
 *
 * A call is bytes both ways (as/remote.ts writes and reads them): the caller
 * hands its request to amxts_rpc, which calls the target's __amxts_rpc(length,
 * from); the target takes the request with amxts_rpc_take, and gives its answer
 * with amxts_rpc_reply before it returns. The caller then copies the answer out
 * with amxts_rpc_result, the target's run (Plugin.run) in front - a function in
 * the answer is called back there. A call inside a call - a condition the owner
 * asks the caller about while showing a menu - is a call like any other: the
 * request is taken before anything else runs, and the answer is kept on the
 * native stack until the outer call has its own.
 *
 * A plugin is named to the other side by its run, not its index: an owner
 * keeps the functions a plugin gave it, and once that plugin is unloaded or
 * reloaded, its index names another run, in which the same function number is
 * another function or none. A call to a run that has ended is refused, and the
 * owners hear that the run ended (TellOwners) to drop what it gave them.
 */
struct Service {
	std::string name;
	int32_t     hash;
	int         plugin;
};

static std::vector<Service> g_services;
static std::vector<uint8_t> g_rpcRequest;
static std::vector<uint8_t> g_rpcReply;
static std::vector<uint8_t> g_rpcResult;

static void w_serve(wasm_exec_env_t env, int32_t name, int32_t hash)
{
	std::string wanted = AsString(Inst(env), name);
	for (size_t i = 0; i < g_services.size(); i++) {
		if (g_services[i].name == wanted) {
			g_services[i].plugin = g_currentPlugin;
			g_services[i].hash = hash;
			return;
		}
	}
	Service service = { wanted, hash, g_currentPlugin };
	g_services.push_back(service);
}

/**
 * The service's number for amxts_rpc; -1 when nobody serves it, -2 when its
 * owner was built from another version. A proxy asks once as its plugin
 * starts, which notes that the plugin uses the module (Plugin.uses).
 */
static int32_t w_owner(wasm_exec_env_t env, int32_t name, int32_t hash)
{
	std::string wanted = AsString(Inst(env), name);
	int user = PluginOf(Inst(env));
	if (user >= 0 && (size_t)user < g_plugins.size()) {
		std::vector<std::string> &uses = g_plugins[user].uses;
		if (std::find(uses.begin(), uses.end(), wanted) == uses.end())
			uses.push_back(wanted);
	}
	for (size_t i = 0; i < g_services.size(); i++) {
		if (g_services[i].name != wanted) continue;
		if (g_services[i].plugin < 0) return -1;
		return g_services[i].hash == hash ? (int32_t)i : -2;
	}
	return -1;
}

// What a request is, its first four bytes - as/remote.ts's KIND_*.
#define RPC_GONE 2

/** The plugin running `run`; -1 when that run has ended. */
static int PluginOfRun(int32_t run)
{
	for (size_t i = 0; i < g_plugins.size(); i++)
		if (run > 0 && g_plugins[i].run == run)
			return (int)i;
	return -1;
}

/** The run of the plugin `index`; 0 for none - the module itself. */
static int32_t RunOf(int index)
{
	return index >= 0 && (size_t)index < g_plugins.size() ? g_plugins[index].run : 0;
}

/**
 * Runs the request in g_rpcRequest in `target`'s __amxts_rpc, as asked by the
 * run `from`; the answer is in g_rpcReply. false when the target has no
 * __amxts_rpc or the call failed.
 */
static bool RunRequest(int target, int32_t from)
{
	Plugin &p = g_plugins[target];
	wasm_function_inst_t fn = wasm_runtime_lookup_function(p.inst, "__amxts_rpc");
	if (!fn) return false;

	g_rpcReply.clear();
	int prev = g_currentPlugin;
	g_currentPlugin = target;
	bool saidBefore = g_outcomeSaid;
	cell before = g_outcome;
	g_outcomeSaid = false;

	p.depth++;
	uint32_t argv[2] = { (uint32_t)g_rpcRequest.size(), (uint32_t)from };
	bool called = wasm_runtime_call_wasm(p.env, fn, 2, argv);
	p.depth--;
	if (!called)
		Failed(target, p.inst);

	g_outcomeSaid = saidBefore;
	g_outcome = before;
	g_currentPlugin = prev;

	if (p.depth == 0 && p.wake)
		DrainJobs(target);
	return called;
}

/** Runs a request in `service`'s owner, or in the run `plugin` when service is -1. The answer's length, or -1. */
static int32_t w_rpc(wasm_exec_env_t env, int32_t service, int32_t plugin, int32_t data, int32_t length)
{
	wasm_module_inst_t inst = Inst(env);
	if (length < 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length))
		return -1;

	// Who is asking - by instance rather than g_currentPlugin, which a
	// coroutine's resumption does not always set; while a plugin's top level
	// runs it has no instance yet, and the plugin being loaded is current.
	// A function passed in the request is called back there.
	int from = PluginOf(inst);

	int target = service >= 0
		? ((size_t)service < g_services.size() ? g_services[service].plugin : -1)
		: PluginOfRun(plugin);
	if (service < 0 && target < 0 && from >= 0 && !g_plugins[from].toldGone) {
		g_plugins[from].toldGone = true;
		MF_PrintSrvConsole("[amxts] %s called back a function of a plugin that was unloaded or reloaded since - the call answers nothing\n",
		                   g_plugins[from].name.c_str());
	}
	if (target < 0 || (size_t)target >= g_plugins.size() || !g_plugins[target].inst)
		return -1;

	const uint8_t *bytes = (const uint8_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)data);
	g_rpcRequest.assign(bytes, bytes + length);
	if (!RunRequest(target, RunOf(from)))
		return -1;

	int32_t run = g_plugins[target].run;
	std::vector<uint8_t> answer(4 + g_rpcReply.size());
	memcpy(answer.data(), &run, 4);
	if (!g_rpcReply.empty()) memcpy(answer.data() + 4, g_rpcReply.data(), g_rpcReply.size());
	g_rpcResult.swap(answer);
	return (int32_t)g_rpcResult.size();
}

/**
 * The plugin at `index` has stopped - unloaded, reloaded, or its load failed:
 * the owners of the modules it called (`uses`) hear that its run ended, and
 * drop what it gave them - a menu it made, the functions it handed over.
 */
static void TellOwners(int index, const std::vector<std::string> &uses, int32_t run)
{
	for (size_t u = 0; u < uses.size(); u++) {
		for (size_t i = 0; i < g_services.size(); i++) {
			int owner = g_services[i].plugin;
			if (g_services[i].name != uses[u] || owner < 0 || owner == index || !g_plugins[owner].inst)
				continue;
			int32_t request[2] = { RPC_GONE, 0 };
			g_rpcRequest.assign((const uint8_t *)request, (const uint8_t *)request + sizeof(request));
			RunRequest(owner, run);
		}
	}
}

static void w_rpcTake(wasm_exec_env_t env, int32_t to)
{
	wasm_module_inst_t inst = Inst(env);
	if (!g_rpcRequest.empty() && wasm_runtime_validate_app_addr(inst, (uint64_t)to, (uint64_t)g_rpcRequest.size()))
		memcpy(wasm_runtime_addr_app_to_native(inst, (uint64_t)to), g_rpcRequest.data(), g_rpcRequest.size());
	g_rpcRequest.clear();
}

static void w_rpcReply(wasm_exec_env_t env, int32_t data, int32_t length)
{
	wasm_module_inst_t inst = Inst(env);
	g_rpcReply.clear();
	if (length <= 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length))
		return;
	const uint8_t *bytes = (const uint8_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)data);
	g_rpcReply.assign(bytes, bytes + length);
}

static void w_rpcResult(wasm_exec_env_t env, int32_t to)
{
	wasm_module_inst_t inst = Inst(env);
	if (!g_rpcResult.empty() && wasm_runtime_validate_app_addr(inst, (uint64_t)to, (uint64_t)g_rpcResult.size()))
		memcpy(wasm_runtime_addr_app_to_native(inst, (uint64_t)to), g_rpcResult.data(), g_rpcResult.size());
	g_rpcResult.clear();
}

// ---------------------------------------------------------------- network

// fetch's and the kit's requests, run on a worker thread: net_open and the rest, and NetFrame.
#include "network.h"

// ---------------------------------------------------------------- fields

// Entity fields and the game's members, read in memory: ent_get and the rest.
#include "fields.h"

// ---------------------------------------------------------------- the game's functions

// The engine's ReHLDS API (FindRehlds), once a process; NULL on plain HLDS.
static IRehldsApi *g_rehlds = NULL;

/**
 * Plain HLDS: an engine function taken over at its first five bytes, a jump
 * to the module's. The module calls the original by putting the bytes back
 * for the length of the call, so no instruction of it is moved; what goes
 * back is what was there - the function's own start, or AMX Mod X's jump to
 * its own detour of it, which is then inside the module's.
 */
struct EntryHook {
	unsigned char *at;
	void          *to;
	unsigned char  saved[5];
	unsigned char  jump[5];
	bool           on;
};

static void WriteCode(unsigned char *at, const unsigned char *bytes)
{
#ifdef _WIN32
	DWORD was;
	VirtualProtect(at, 5, PAGE_EXECUTE_READWRITE, &was);
	memcpy(at, bytes, 5);
	VirtualProtect(at, 5, was, &was);
	FlushInstructionCache(GetCurrentProcess(), at, 5);
#else
	uintptr_t page = (uintptr_t)sysconf(_SC_PAGESIZE);
	unsigned char *start = (unsigned char *)((uintptr_t)at & ~(page - 1));
	size_t length = (size_t)(at + 5 - start);
	mprotect(start, length, PROT_READ | PROT_WRITE | PROT_EXEC);
	memcpy(at, bytes, 5);
	mprotect(start, length, PROT_READ | PROT_EXEC);
#endif
}

static void HookOn(EntryHook &h)
{
	if (!h.at || h.on)
		return;
	memcpy(h.saved, h.at, 5);
	int32_t offset = (int32_t)((unsigned char *)h.to - (h.at + 5));
	h.jump[0] = 0xE9; // jmp rel32
	memcpy(h.jump + 1, &offset, 4);
	WriteCode(h.at, h.jump);
	h.on = true;
}

/** Puts back what was there, unless something wrote over the jump since: AMX Mod X turning its own detour off at a map's end. */
static void HookOff(EntryHook &h)
{
	if (h.on && !memcmp(h.at, h.jump, 5))
		WriteCode(h.at, h.saved);
	h.on = false;
}

static int ClientId(const edict_t *e);
static void MessagesAttach(bool on);

// ---------------------------------------------------------------- menus

/**
 * The menu a plugin's Menu shows each player (menu_open): the plugin's
 * handler of its keys and the keys it takes, none while it shows nothing.
 * AMX Mod X's show_menu draws it, under a title no Pawn menu is registered
 * by, so AMX Mod X closes the player's Pawn menu - its close callback fires
 * - and passes the key on: the module hears `menuselect` in ClientCommand,
 * after AMX Mod X. A menu shown over it closes it: a Pawn plugin's
 * show_menu or menu_display (InterposeNatives), the game's ShowMenu or
 * VGUIMenu (MenuMessage, heard while a menu is open), the kit's showMenu.
 */
struct ShownMenu : Handler {
	int keys = 0;
};

static ShownMenu g_menus[CLIENT_SLOTS];
static int       g_menusShown = 0;
static int       g_msgShowMenu = 0;
static int       g_msgVGUIMenu = 0;

static void CloseMenu(int id)
{
	if (!g_menus[id].keys)
		return;
	g_menus[id].keys = 0;
	if (--g_menusShown == 0)
		MessagesAttach(false);
}

/** Closes player `id`'s menu, or every player's for 0. */
static void CloseMenus(int id)
{
	if (id > 0 && id < CLIENT_SLOTS) {
		CloseMenu(id);
		return;
	}
	for (int i = 1; id == 0 && i < CLIENT_SLOTS; i++)
		CloseMenu(i);
}

/** Player `id` sees a menu whose `keys` go to `h`. */
static void OpenMenu(int id, const Handler &h, int keys)
{
	CloseMenus(id);
	if (!(keys & 0x3ff))
		return;
	ShownMenu &menu = g_menus[id];
	(Handler &)menu = h;
	menu.keys = keys & 0x3ff;
	if (!g_msgShowMenu) g_msgShowMenu = GET_USER_MSG_ID(PLID, "ShowMenu", NULL);
	if (!g_msgVGUIMenu) g_msgVGUIMenu = GET_USER_MSG_ID(PLID, "VGUIMenu", NULL);
	if (g_menusShown++ == 0)
		MessagesAttach(true);
}

/**
 * menu_open(id, keys, handler) - player `id` sees a menu of the calling
 * plugin that takes `keys` (show_menu's bits), and a key of it goes to
 * `handler(id, key)`, the key 0 for 1 and 9 for 0; no keys for no menu, an id
 * of 0 for every player. Said right after show_menu has drawn it.
 */
static void w_menu_open(wasm_exec_env_t env, int32_t id, int32_t keys, int32_t fn)
{
	(void)env;
	Handler h;
	h.plugin = g_currentPlugin;
	h.fn = (uint32_t)fn;
	h.shape = SHAPE_WIDE;
	h.tag = TakeTag();
	if (id < 0 || id >= CLIENT_SLOTS)
		return;
	if (!id) {
		CloseMenus(0);
		return;
	}
	Bind(h);
	OpenMenu(id, h, keys);
}

/**
 * A register_menucmd a TypeScript plugin made, with a publicFor name: the
 * module's own (n_registerMenucmd), as AMX Mod X's looks for the calling
 * plugin, and dispatched as a Menu's keys - once show_menu shows a menu of
 * that id (n_showMenu), its keys go to the name's handler. One map long.
 */
struct MenuCommand {
	int    menu;
	int    keys;
	size_t slot;
};

static std::vector<MenuCommand> g_menuCommands;

// register_menucmd(menuid, keys, const function[])
static cell AMX_NATIVE_CALL n_registerMenucmd(AMX *amx, cell *params)
{
	int len = 0;
	const char *name = MF_GetAmxString(amx, params[3], 0, &len);
	int slot = SlotOf(name);
	if (slot < 0) {
		MF_PrintSrvConsole("[amxts] register_menucmd from a TypeScript plugin takes a publicFor name, not \"%s\"\n", name ? name : "");
		return 0;
	}
	MenuCommand command = { (int)params[1], (int)params[2], (size_t)slot };
	g_menuCommands.push_back(command);
	return 1;
}

/** After show_menu: player `id`'s menu is a register_menucmd's of a TypeScript plugin, which then takes its keys. */
static void OpenMenuCommand(int id)
{
	int menu = MF_GetPlayerMenu(id);
	for (const MenuCommand &command : g_menuCommands) {
		const Slot &slot = g_slots[command.slot];
		if (command.menu == menu && menu > 0 && slot.plugin != SLOT_ORPHANED) {
			OpenMenu(id, slot, MF_GetPlayerKeys(id) & command.keys);
			return;
		}
	}
}

/** A message the game begins: its own menu, ShowMenu or VGUIMenu, takes the player's keys, as AMX Mod X takes them from a Pawn menu. */
static void MenuMessage(int type, edict_t *ed)
{
	if (g_menusShown && ed && type > 0 && (type == g_msgShowMenu || type == g_msgVGUIMenu))
		CloseMenu(ClientId(ed));
}

// Hookchains and Ham Sandwich's functions, hooked by the module: hook, ham and the rest.
#include "gamehooks.h"

// Messages, the log, cvars, touches and fakemeta's functions, through Metamod.
#include "enginehooks.h"

static void w_botCmd(wasm_exec_env_t env, int32_t id, int32_t line);

static NativeSymbol g_wasmNatives[] = {
	{ "abort",        (void *)w_abort,        "(iiii)", NULL },
	{ "stack_frames", (void *)w_stack_frames, "(ii)i",  NULL },
	{ "stack_text",   (void *)w_stack_text,   "(iiii)i", NULL },
	{ "print_client", (void *)w_print_client, "(iii)",  NULL },
	{ "say_text",     (void *)w_say_text,     "(iii)",  NULL },
	{ "get_name",     (void *)w_get_name,     "(iii)i", NULL },
	{ "get_health",   (void *)w_get_health,   "(i)i",   NULL },
	{ "set_health",   (void *)w_set_health,   "(ii)",   NULL },
	{ "outcome",         (void *)w_outcome,         "(i)",  NULL },
	{ "export",          (void *)w_export,          "(ii)i", NULL },
	{ "slot",            (void *)w_slot,            "(iiii)i", NULL },
	{ "menu_open",       (void *)w_menu_open,       "(iii)", NULL },
	{ "arg",             (void *)w_arg,             "(i)i", NULL },
	{ "arg_text",        (void *)w_argText,         "(iii)i", NULL },
	{ "set_arg_text",    (void *)w_setArgText,      "(iii)i", NULL },
	{ "set_arg",         (void *)w_setArg,          "(ii)i", NULL },
	{ "caller",          (void *)w_caller,          "()i", NULL },
	{ "argc",            (void *)w_argc,            "()i", NULL },
	{ "arg_string",      (void *)w_argString,       "(iii)i", NULL },
	{ "arg_array",       (void *)w_argArray,        "(iii)i", NULL },
	{ "arg_length",      (void *)w_argLength,       "(i)i", NULL },
	{ "set_arg_array",   (void *)w_setArgArray,     "(iii)i", NULL },
	{ "callfunc_text",   (void *)w_callfuncText,    "(i)i", NULL },
	{ "callfunc_buffer", (void *)w_callfuncBuffer,  "(ii)i", NULL },
	{ "callfunc_finish", (void *)w_callfuncFinish,  "()i", NULL },
	{ "console.log",     (void *)w_console_log,     "(i)",  NULL },
	{ "console.info",    (void *)w_console_log,     "(i)",  NULL },
	{ "console.debug",   (void *)w_console_log,     "(i)",  NULL },
	{ "console.warn",    (void *)w_console_warn,    "(i)",  NULL },
	{ "console.error",   (void *)w_console_error,   "(i)",  NULL },
	{ "console.assert",  (void *)w_console_assert,  "(ii)", NULL },
	{ "console.time",    (void *)w_console_time,    "(i)",  NULL },
	{ "console.timeLog", (void *)w_console_timeLog, "(i)",  NULL },
	{ "console.timeEnd", (void *)w_console_timeEnd, "(i)",  NULL },
	{ "Date.now",        (void *)w_date_now,        "()F",  NULL },
	{ "Date.getTimezoneOffset", (void *)w_date_timezone_offset, "(F)i", NULL },
	{ "performance.now", (void *)w_performance_now, "()F",  NULL },
	{ "seed",            (void *)w_seed,            "()F",  NULL },
	{ "on",           (void *)w_on,           "(iii)",  NULL },
	{ "on_cell",      (void *)w_on_cell,      "(iiiii)", NULL },
	{ "off",          (void *)w_off,          "(ii)",   NULL },
	{ "subscribe",    (void *)w_subscribe,    "(iii)",  NULL },
	{ "emit_local",   (void *)w_emit_local,   "(iiii)", NULL },
	{ "clcmd",        (void *)w_clcmd,        "(iiii)", NULL },
	{ "srvcmd",       (void *)w_srvcmd,       "(iii)", NULL },
	{ "bot_cmd",      (void *)w_botCmd,       "(ii)", NULL },
	{ "task",         (void *)w_task,         "(iii)i",  NULL },
	{ "stop_task",    (void *)w_stopTask,     "(i)i", NULL },
	{ "tag",          (void *)w_tag,          "(i)",  NULL },
	{ "call",         (void *)w_call,         "(iiii)i", NULL },
	{ "hook",         (void *)w_hook,         "(iii)i", NULL },
	{ "ham",          (void *)w_ham,          "(iiii)i", NULL },
	{ "hook_on",      (void *)w_hook_on,      "(ii)",   NULL },
	{ "chain_set",    (void *)w_chain_set,    "(ii)",   NULL },
	{ "chain_set_text", (void *)w_chain_set_text, "(ii)", NULL },
	{ "game_api",     (void *)w_game_api,     "()i",    NULL },
	{ "ham_bypass",   (void *)w_ham_bypass,   "(ii)",   NULL },
	{ "chain_dispatch", (void *)w_chain_dispatch, "(iiiii)i", NULL },
	{ "plugin",       (void *)w_meta,         "(iiii)", NULL },
	{ "co_entered",   (void *)w_co_entered,   "()i",    NULL },
	{ "co_spawn",     (void *)w_co_spawn,     "(iiiii)i", NULL },
	{ "co_suspend",   (void *)w_co_suspend,   "(i)",    NULL },
	{ "co_wake",      (void *)w_co_wake,      "()",     NULL },
	{ "player_data_get",      (void *)w_playerDataGet,     "(ii)F",   NULL },
	{ "player_data_set",      (void *)w_playerDataSet,     "(iiF)",   NULL },
	{ "player_data_get_text", (void *)w_playerDataGetText, "(iiii)i", NULL },
	{ "player_data_set_text", (void *)w_playerDataSetText, "(iii)",   NULL },
	{ "player_data_set_players", (void *)w_playerDataSetPlayers, "(iii)", NULL },
	{ "player_slots",           (void *)w_playerSlots,         "(i)",     NULL },
	{ "player_names",           (void *)w_playerNames,         "(i)",     NULL },
	{ "player_change_listen",   (void *)w_playerChangeListen,  "(ii)",    NULL },
	{ "player_change_get",      (void *)w_playerChangeGet,     "(i)F",    NULL },
	{ "player_change_get_text", (void *)w_playerChangeGetText, "(iii)i",  NULL },
	FIELD_NATIVES
	ENGINE_HOOK_NATIVES
	{ "amxts_serve",      (void *)w_serve,     "(ii)",    NULL },
	{ "amxts_owner",      (void *)w_owner,     "(ii)i",   NULL },
	{ "amxts_rpc",        (void *)w_rpc,       "(iiii)i", NULL },
	{ "amxts_rpc_take",   (void *)w_rpcTake,   "(i)",     NULL },
	{ "amxts_rpc_reply",  (void *)w_rpcReply,  "(ii)",    NULL },
	{ "amxts_rpc_result", (void *)w_rpcResult, "(i)",     NULL },
	{ "net_open",      (void *)w_net_open,      "(i)i",    NULL },
	{ "net_option",    (void *)w_net_option,    "(iii)i",  NULL },
	{ "net_body",      (void *)w_net_body,      "(iii)",   NULL },
	{ "net_send",      (void *)w_net_send,      "(ii)i",   NULL },
	{ "net_cancel",    (void *)w_net_cancel,    "(i)",     NULL },
	{ "net_close",     (void *)w_net_close,     "(i)",     NULL },
	{ "net_status",    (void *)w_net_status,    "(i)i",    NULL },
	{ "net_redirects", (void *)w_net_redirects, "(i)i",    NULL },
	{ "net_text",      (void *)w_net_text,      "(iiii)i", NULL },
	{ "net_size",      (void *)w_net_size,      "(i)i",    NULL },
	{ "net_read",      (void *)w_net_read,      "(iii)i",  NULL },
	{ "net_reply",     (void *)w_net_reply,     "(i)i",    NULL }
};

// ---------------------------------------------------------------- pawn -> wasm

/**
 * Calls one handler by its function table index.
 *
 * A narrow handler takes the first cell and returns nothing, which is what a
 * player event and a command both want. A wide one takes four and returns
 * PLUGIN_HANDLED or PLUGIN_CONTINUE. call_indirect checks the type, so the
 * shape recorded at registration is what decides.
 */
static cell Fire(Handler h, uint32_t *argv, int argc, cell fallback)
{
	// An orphaned slot, one belonging to the module rather than a plugin, or a
	// plugin that is not running.
	if (h.plugin < 0 || (size_t)h.plugin >= g_plugins.size() || !g_plugins[h.plugin].inst)
		return fallback;

	Plugin &p = g_plugins[h.plugin];

	// A closure's dispatcher takes its tag before the cells (Handler.tag).
	int first = h.tag ? 1 : 0;
	uint32_t call[MAX_EVENT_ARGS + 1] = { 0 };
	int n = ((h.shape == SHAPE_WIDE) ? MAX_EVENT_ARGS : 1) + first;

	if (first)
		call[0] = (uint32_t)h.tag;
	for (int i = first; i < n && i - first < argc; i++)
		call[i] = argv[i - first];

	int prev = g_currentPlugin;
	g_currentPlugin = h.plugin;

	// Whatever the last handler said is not this one's business.
	bool saidBefore = g_outcomeSaid;
	cell before = g_outcome;
	g_outcomeSaid = false;

	cell result = fallback;

	if (g_trace) MF_PrintSrvConsole("[amxts] TRACE fire plugin=%d fn=%u n=%d a0=%d\n", h.plugin, h.fn, n, (int)call[0]);

	bool called;

	// Counted so that the plugin's jobs run when the last of its calls on the
	// native stack returns, and never inside one of them - see DrainJobs.
	p.depth++;

	// A plugin's `number` is JavaScript's - an f64 - and every argument here
	// is a cell, an i32. Passed as raw cells, a handler declared
	// `tick(handle: number)` read the i32 1000 as the bits of a double: a
	// denormal next to zero, so clearTimeout(handle) stopped nothing and a
	// countdown ran on into the negatives. So the handler's own parameter
	// types decide how each cell goes in: as it is to an i32, converted by
	// value to an f64 (or f32, i64) where that is what the function takes.
	if (h.entry) {
		called = CallDirect(h, p.env, call);
	}
	else if (h.func) {
		// Laid out in cells as WAMR reads them.
		uint32_t cells[2 * (MAX_EVENT_ARGS + 1)];
		uint32_t used = 0;
		for (uint32_t i = 0; i < h.count; i++) {
			int32_t cellValue = (int32_t)call[i];
			switch (h.kinds[i]) {
				case WASM_F64: { double v = cellValue; memcpy(&cells[used], &v, 8); used += 2; break; }
				case WASM_I64: { int64_t v = cellValue; memcpy(&cells[used], &v, 8); used += 2; break; }
				case WASM_F32: { float v = (float)cellValue; memcpy(&cells[used], &v, 4); used++; break; }
				default:       cells[used++] = (uint32_t)cellValue; break;
			}
		}
		called = wasm_runtime_call_wasm(p.env, h.func, used, cells);
	}
	else {
		called = wasm_runtime_call_indirect(p.env, h.fn, n, call);
	}

	p.depth--;

	if (!called) {
		Failed(h.plugin, p.inst);
	}
	else if (g_outcomeSaid) {
		result = g_outcome;
	}

	if (g_trace) MF_PrintSrvConsole("[amxts] TRACE fire done\n");

	g_outcomeSaid = saidBefore;
	g_outcome = before;
	g_currentPlugin = prev;

	// What this event settled - a timer, a response, a player leaving - may
	// resume a coroutine; the answer to the game has already been given.
	if (p.depth == 0 && p.wake)
		DrainJobs(h.plugin);
	return result;
}

/** When a file was last written, or 0 if it cannot be read. */
static time_t FileStamp(const char *path)
{
#ifdef _WIN32
	struct _stat info;
	return _stat(path, &info) == 0 ? info.st_mtime : 0;
#else
	struct stat info;
	return stat(path, &info) == 0 ? info.st_mtime : 0;
#endif
}

// ---------------------------------------------------------------- installing

/**
 * The plugin list, relative to the game folder: addons/amxts/plugins.ini, or
 * the file `+localinfo amxts_plugins <file>` names on the command line.
 *
 * The plugins it names are looked for in plugins/ beside it, and a .ts is
 * built into build/ beside it, so a list elsewhere brings its own folder: the
 * second server `bun run test:server` starts from the same install loads only
 * its test plugins, and the server that owns the install is not touched.
 *
 * Read once, when the module attaches (ReadListFile), and kept. The engine
 * answers a localinfo lookup from four buffers it takes in turn, and AMX Mod
 * X holds a pointer into one - its plugins folder - while it loads the
 * plugins in plugins.ini; a lookup in the middle of that loop would move
 * the buffers on, and every Pawn plugin after it would fail with "Plugin file
 * open error".
 */
static std::string g_listFile;

static void ReadListFile()
{
	const char *custom = MF_GetLocalInfo("amxts_plugins", "");
	g_listFile = custom ? custom : "";
}

static std::string ListFile()
{
	return g_listFile.empty() ? std::string("addons/amxts/plugins.ini") : g_listFile;
}

/** Whether the command line named a plugin list of its own. */
static bool HasOwnList()
{
	return !g_listFile.empty();
}

/** The folder the plugin list is in: addons/amxts unless moved. */
static std::string ListHome()
{
	std::string list = ListFile();
	size_t slash = list.find_last_of("/\\");
	return slash == std::string::npos ? std::string(".") : list.substr(0, slash);
}

static void EnsureDirectory(const char *relative)
{
	std::string path = MF_BuildPathname("%s", relative);
#ifdef _WIN32
	CreateDirectoryA(path.c_str(), NULL);
#else
	mkdir(path.c_str(), 0755);
#endif
}

/**
 * Lays out addons/amxts beside the module, on every start.
 *
 * A server owner installs one file - the module - and the rest appears: the
 * folders, the API a plugin imports, the editor's files, the signature table
 * the compiler reads, and an example to edit - the list
 * scripts/server-files.ts makes (embedded.h).
 *
 * The API is rewritten every time rather than only when missing. It is not
 * the author's: it is this module's own, and a copy left over from an older
 * build is exactly the failure this avoids - a plugin that compiles against
 * natives the module has no thunk for. plugins.ini and the example are the
 * author's, so those are written once and then left alone.
 */
/** A file's bytes, empty when it cannot be read. */
static std::string ReadWhole(const char *path)
{
	std::string text;
	FILE *f = fopen(path, "rb");
	if (!f)
		return text;

	char buffer[16384];
	size_t got;
	while ((got = fread(buffer, 1, sizeof(buffer), f)) > 0)
		text.append(buffer, got);

	fclose(f);
	return text;
}

static void InstallFiles()
{
	// A server given a list of its own is a test server borrowing this
	// install: what is laid out here belongs to the server that owns it.
	if (HasOwnList())
		return;

	EnsureDirectory("addons/amxts");
	EnsureDirectory("addons/amxts/build");

	for (size_t i = 0; i < sizeof(g_embedded) / sizeof(g_embedded[0]); i++) {
		const EmbeddedFile &file = g_embedded[i];
		std::string relative = std::string("addons/amxts/") + file.path;
		std::string path = MF_BuildPathname("%s", relative.c_str());

		// The author's, once it exists.
		if (file.keep && FileStamp(path.c_str()) != 0)
			continue;

		std::string text;
		for (int c = 0; c < file.count; c++)
			text += file.chunks[c];

		// Already this module's: a map change writes nothing.
		if (ReadWhole(path.c_str()) == text)
			continue;

		// Its folders, outermost first: plugins/, plugins/modules/.
		for (size_t slash = relative.find('/', strlen("addons/amxts/")); slash != std::string::npos; slash = relative.find('/', slash + 1))
			EnsureDirectory(relative.substr(0, slash).c_str());

		FILE *f = fopen(path.c_str(), "wb");
		if (!f) {
			MF_PrintSrvConsole("[amxts] cannot write %s\n", path.c_str());
			continue;
		}

		fwrite(text.data(), 1, text.size(), f);
		fclose(f);
	}
}

// ---------------------------------------------------------------- the natives' image

static AMX   g_imageAmx;
static void *g_imageCode = NULL;

/** Lets the image go, and with it every native resolved from it. */
static void UnloadImage()
{
	if (g_image)
		MF_UnloadAmxScript(&g_imageAmx, &g_imageCode);
	g_image = NULL;
	g_imageCode = NULL;
	g_imageComplete = false;
	g_nativeCache.clear();
	g_nativeGeneration++;
}

/**
 * Loads the natives' image (image.h) with AMX Mod X's LoadAmxScript: a
 * script, not a plugin, whose native table is where every native is resolved
 * (FindNative). AMX Mod X binds there the natives of every module loaded and
 * the core's; once the plugins are finalized, the natives Pawn plugins
 * registered too, and it loads the modules the image's library entries name
 * as a plugin's includes have it load them - the image's module filter lets
 * one be missing. Those it loads then are bound in the next image only, so
 * that moment loads it twice. A native no list has stays unbound, and AMX Mod
 * X answers the load with an error for it; the image is loaded all the same.
 *
 * LoadAmxScript reads a file: the image is written into AMX Mod X's data
 * folder for the length of the load.
 */
static void LoadImage()
{
	UnloadImage();

	std::string data = MF_GetLocalInfo("amxx_datadir", "addons/amxmodx/data");
	std::string path = MF_BuildPathname("%s/amxts_natives.amxx", data.c_str());
	FILE *f = fopen(path.c_str(), "wb");
	bool written = f && fwrite(g_nativesImage, 1, sizeof(g_nativesImage), f) == sizeof(g_nativesImage);
	if (f)
		written = fclose(f) == 0 && written;
	if (!written) {
		MF_PrintSrvConsole("[amxts] cannot write %s - without it no native can be called\n", path.c_str());
		return;
	}

	char error[128] = "";
	int status = MF_LoadAmxScriptEx(&g_imageAmx, &g_imageCode, path.c_str(), error, sizeof(error), 0);
	remove(path.c_str());
	if (status != AMX_ERR_NONE && status != AMX_ERR_NOTFOUND) {
		MF_PrintSrvConsole("[amxts] the natives' image did not load (%s) - no native can be called\n", error);
		return;
	}
	g_image = &g_imageAmx;
}

/**
 * Each loaded Pawn plugin's AMX by its id (g_pluginAmx), as get_plugin(-1)
 * answers in each script: what a Pawn plugin's native is called with
 * (Carrier) and what a PawnFunction runs in.
 */
static void FindPlugins()
{
	g_pluginAmx.clear();
	Resolved getPlugin = FindNative("get_plugin");
	if (!getPlugin.fn)
		return;

	for (int i = 0; AMX *amx = MF_GetScriptAmx(i); i++) {
		cell mark = amx->hea, addr = 0, *phys = NULL;
		if (amx == g_image || MF_AmxAllot(amx, 1, &addr, &phys) != AMX_ERR_NONE)
			continue;
		// get_plugin(-1, name, 0, title, 0, version, 0, author, 0, status, 0)
		cell params[12] = { 11 * sizeof(cell), -1 };
		for (int k = 2; k < 12; k += 2)
			params[k] = addr;
		cell id = getPlugin.fn(amx, params);
		amx->hea = mark;
		if (id < 0 || id > 4096)
			continue;
		if ((size_t)id >= g_pluginAmx.size())
			g_pluginAmx.resize(id + 1, NULL);
		g_pluginAmx[id] = amx;
	}
	// A Pawn plugin's native resolved before is resolved again with them.
	g_nativeCache.clear();
	g_nativeGeneration++;
}

// ---------------------------------------------------------------- boot

/**
 * Stops one plugin and takes back what it registered; its entry stays at its
 * index, for the caller to say what it is now.
 *
 * Its hooks of the game's functions go (DropGameHooks). What it registered
 * by a publicFor name - register_menucmd - has no undo, so the name stays:
 * it becomes an orphan, which answers PLUGIN_CONTINUE and calls nothing,
 * until the same registration comes back and takes its name again. Its
 * commands, its menus, its listeners, its subscriptions and its requests go; its
 * natives and the modules it serves stay registered, answering nothing
 * until a plugin claims them again. The owners of the modules it called
 * hear that its run ended (TellOwners), once it is gone.
 */
static void ReleasePlugin(int index)
{
	Plugin &p = g_plugins[index];
	std::vector<std::string> uses;
	uses.swap(p.uses);
	int32_t run = p.run;
	p.run = 0;
	if (p.inst)
		NetForget(p.inst);
	DropTimers(index);
	if (!p.coroutines.empty())
		MF_PrintSrvConsole("[amxts] %s: %d async function(s) were still waiting, and are dropped\n",
		                   p.name.c_str(), (int)p.coroutines.size());
	if (p.env)    wasm_runtime_destroy_exec_env(p.env);
	if (p.inst)   wasm_runtime_deinstantiate(p.inst);
	if (p.module) wasm_runtime_unload(p.module);
	free(p.file);

	p.file = NULL;
	p.module = NULL;
	p.inst = NULL;
	p.env = NULL;
	p.hasTable = false;
	p.playerSlots = 0;
	p.playerNames = 0;
	p.title = p.version = p.author = p.description = "";
	p.depth = 0;
	p.wake = false;
	p.entering = false;
	p.stackTop = 0;
	p.coroutines.clear();
	p.running.clear();

	for (Forward &f : g_forwards) {
		DropFrom(f, f.handlers, [index](const Handler &h) { return h.plugin == index; });
		DropFrom(f, f.subscribers, [index](const Subscription &s) { return s.handler.plugin == index; });
	}
	for (std::map<std::string, std::vector<Subscription> >::iterator it = g_subscriptions.begin(); it != g_subscriptions.end(); ++it)
		DropFrom(it->second, [index](const Subscription &s) { return s.handler.plugin == index; });
	DropFrom(g_fieldListeners, [index](const FieldListener &l) { return l.plugin == index; });
	for (std::map<std::string, Forward> *commands : { &g_clientCommands, &g_serverCommands })
		for (std::map<std::string, Forward>::iterator it = commands->begin(); it != commands->end(); ++it)
			DropFrom(it->second, it->second.handlers, [index](const Handler &h) { return h.plugin == index; });

	for (size_t i = 0; i < g_services.size(); i++)
		if (g_services[i].plugin == index)
			g_services[i].plugin = -1;
	DropGameHooks(index);
	for (int id = 1; id < CLIENT_SLOTS; id++)
		if (g_menus[id].plugin == index)
			CloseMenu(id);

	for (Slot &slot : g_slots)
		if (slot.plugin == index)
			slot.plugin = SLOT_ORPHANED;

	// The names stay in the list (Exported): w_export gives each one to
	// whichever plugin claims it again, and until then a call answers 0.
	for (size_t i = 0; i < g_exported.size(); i++)
		if (g_exported[i].plugin == index)
			g_exported[i].plugin = SLOT_ORPHANED;

	TellOwners(index, uses, run);
}

/**
 * Drops every plugin and what it registered with AMX Mod X (ReleasePlugin),
 * for a reload of them all. The entries let go, for LoadScripts to keep what
 * the commands said.
 */
static std::deque<Plugin> UnloadPlugins()
{
	for (size_t i = 0; i < g_plugins.size(); i++)
		ReleasePlugin((int)i);

	std::deque<Plugin> before;
	before.swap(g_plugins);
	for (Forward &f : g_forwards)
		f = Forward();
	g_subscriptions.clear();
	g_subscriptionNames++;
	g_services.clear();
	g_fieldListeners.clear();
	g_timers.clear();
	return before;
}

/**
 * Ends a map: every plugin and what lives with them goes, for the next map to
 * start over - AMX Mod X keeps the module loaded across maps
 * (OnPluginsUnloaded) - and the natives' image with every native resolved
 * from it. What lives as long as the process stays: WAMR, the network
 * thread, the gamedata and its members, the plugin list's file.
 */
static void Teardown()
{
	for (size_t i = 0; i < g_plugins.size(); i++) {
		Plugin &p = g_plugins[i];
		// Their requests are let go; the worker goes on for the next map.
		if (p.inst)   NetForget(p.inst);
		if (p.env)    wasm_runtime_destroy_exec_env(p.env);
		if (p.inst)   wasm_runtime_deinstantiate(p.inst);
		if (p.module) wasm_runtime_unload(p.module);
		free(p.file);
	}

	g_plugins.clear();
	for (Forward &f : g_forwards)
		f = Forward();
	g_subscriptions.clear();
	g_subscriptionNames++;
	g_services.clear();
	g_fieldListeners.clear();
	CloseMenus(0);
	TeardownGameHooks();
	ForgetOtherPoints();

	g_slots.clear();
	g_menuCommands.clear();

	// The exported natives' names stay in the list for the next map's plugins;
	// a call answers 0 until a plugin exports the name again.
	for (Exported &e : g_exported)
		e.plugin = SLOT_ORPHANED;
	g_pawnForwards.clear();

	// Raw AMX_NATIVE pointers harvested from an AMX image that is about to be
	// let go. Keeping them across a map change is a call into freed memory.
	UnloadImage();
	g_pluginAmx.clear();
	g_currentPlugin = -1;
	g_pawnCalls.clear();
	g_msgSayText = g_msgTeamInfo = 0;

	g_amxxReady = false;
	g_clientCommands.clear();
	g_serverCommands.clear();

	g_timers.clear();
	g_timerHeap.clear();
	g_timerSlots.clear();
	g_freeTimer = -1;
	g_nextWatch = 0;
	g_trace = false;
	g_namesChanging = false;
	ForgetEdicts();

	// The players' fields start over with the plugins.
	for (int i = 0; i < PLAYER_DATA_SLOTS; i++)
		ClearPlayerData(i);
}

// The on-server compiler's file name in addons/amxts/tools.
#ifdef _WIN32
#define COMPILER_FILE "amxts-compile.exe"
#else
#define COMPILER_FILE "amxts-compile"
#endif

// Not forever: a compiler that never returns would take the server with it,
// and a game server hanging on a plugin author's typo is a worse failure than
// a plugin that does not load.
#define COMPILE_TIMEOUT_MS 120000

/**
 * Runs `tool args...` with its output going to `log`, and waits for it.
 * Returns its exit code, or -1 when it could not start or did not finish,
 * which it has said on the console.
 */
#ifdef _WIN32
static int RunCompiler(const std::string &tool, const std::vector<std::string> &args, const std::string &log)
{
	SECURITY_ATTRIBUTES inherit;
	inherit.nLength = sizeof(inherit);
	inherit.lpSecurityDescriptor = NULL;
	inherit.bInheritHandle = TRUE;

	HANDLE out = CreateFileA(log.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &inherit,
	                         CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);

	std::string command = "\"" + tool + "\"";
	for (size_t i = 0; i < args.size(); i++)
		command += " \"" + args[i] + "\"";
	std::vector<char> line(command.begin(), command.end());
	line.push_back(0);

	STARTUPINFOA start;
	memset(&start, 0, sizeof(start));
	start.cb = sizeof(start);
	start.dwFlags = STARTF_USESTDHANDLES;
	// With STARTF_USESTDHANDLES all three have to be real handles, so stdin
	// gets the null device rather than NULL.
	HANDLE nothing = CreateFileA("NUL", GENERIC_READ, FILE_SHARE_READ, &inherit,
	                             OPEN_EXISTING, 0, NULL);

	start.hStdOutput = out;
	start.hStdError = out;
	start.hStdInput = nothing;

	PROCESS_INFORMATION process;
	memset(&process, 0, sizeof(process));

	BOOL started = CreateProcessA(NULL, &line[0], NULL, NULL, TRUE, CREATE_NO_WINDOW,
	                              NULL, NULL, &start, &process);

	if (out != INVALID_HANDLE_VALUE)
		CloseHandle(out);
	if (nothing != INVALID_HANDLE_VALUE)
		CloseHandle(nothing);

	if (!started) {
		MF_PrintSrvConsole("[amxts] could not run %s\n", tool.c_str());
		return -1;
	}

	DWORD waited = WaitForSingleObject(process.hProcess, COMPILE_TIMEOUT_MS);

	if (waited != WAIT_OBJECT_0) {
		MF_PrintSrvConsole("[amxts] the compiler did not finish in %ds\n", COMPILE_TIMEOUT_MS / 1000);
		TerminateProcess(process.hProcess, 1);
		CloseHandle(process.hProcess);
		CloseHandle(process.hThread);
		return -1;
	}

	DWORD code = 1;
	GetExitCodeProcess(process.hProcess, &code);
	CloseHandle(process.hProcess);
	CloseHandle(process.hThread);
	return (int)code;
}
#else
extern char **environ;

static int RunCompiler(const std::string &tool, const std::vector<std::string> &args, const std::string &log)
{
	// An upload over FTP or a panel's file manager drops the execute bit; the
	// compiler and the wamrc beside it get it back rather than fail with EACCES.
	std::string wamrc = tool.substr(0, tool.find_last_of('/') + 1) + "wamrc";
	const char *tools[] = { tool.c_str(), wamrc.c_str() };
	for (int i = 0; i < 2; i++)
		if (access(tools[i], X_OK) != 0)
			chmod(tools[i], 0755);

	posix_spawn_file_actions_t files;
	posix_spawn_file_actions_init(&files);
	posix_spawn_file_actions_addopen(&files, 0, "/dev/null", O_RDONLY, 0);
	posix_spawn_file_actions_addopen(&files, 1, log.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
	posix_spawn_file_actions_adddup2(&files, 1, 2);

	// hlds_run puts the server's own folder first on LD_LIBRARY_PATH, with a
	// 32-bit libstdc++ in it; the compiler is a 64-bit program of its own and
	// has no use for the server's libraries.
	std::vector<std::string> keep;
	for (char **at = environ; at && *at; at++) {
		if (!strncmp(*at, "LD_LIBRARY_PATH=", 16) || !strncmp(*at, "LD_PRELOAD=", 11))
			continue;
		keep.push_back(*at);
	}
	std::vector<char *> env;
	for (size_t i = 0; i < keep.size(); i++)
		env.push_back(&keep[i][0]);
	env.push_back(NULL);

	std::vector<std::string> words(1, tool);
	words.insert(words.end(), args.begin(), args.end());
	std::vector<char *> argv;
	for (size_t i = 0; i < words.size(); i++)
		argv.push_back(&words[i][0]);
	argv.push_back(NULL);

	pid_t pid;
	int failed = posix_spawn(&pid, tool.c_str(), &files, NULL, &argv[0], &env[0]);
	posix_spawn_file_actions_destroy(&files);

	if (failed) {
		MF_PrintSrvConsole("[amxts] could not run %s: %s\n", tool.c_str(), strerror(failed));
		return -1;
	}

	// Polled rather than waited for, so that a compiler that hangs can be
	// stopped: waitpid has no timeout.
	int status = 0;
	for (int waited = 0;; waited += 10) {
		pid_t done = waitpid(pid, &status, WNOHANG);
		if (done == pid)
			break;
		if (done < 0 && errno != EINTR) {
			MF_PrintSrvConsole("[amxts] lost the compiler: %s\n", strerror(errno));
			return -1;
		}
		if (waited >= COMPILE_TIMEOUT_MS) {
			MF_PrintSrvConsole("[amxts] the compiler did not finish in %ds\n", COMPILE_TIMEOUT_MS / 1000);
			kill(pid, SIGKILL);
			waitpid(pid, &status, 0);
			return -1;
		}
		struct timespec pause = { 0, 10 * 1000000L };
		nanosleep(&pause, NULL);
	}

	if (WIFEXITED(status))
		return WEXITSTATUS(status);
	MF_PrintSrvConsole("[amxts] the compiler was stopped by signal %d\n", WIFSIGNALED(status) ? WTERMSIG(status) : 0);
	return -1;
}
#endif

/**
 * Compiles a plugin's source, the way AMX Mod X compiles a .sma on the server.
 *
 * amxts-compile is asc and wamrc in one executable, so a plugin author needs
 * nothing but a text editor: they write TypeScript, drop it in
 * addons/amxts/plugins, and the server turns it into machine code. It lives in
 * addons/amxts/tools with wamrc and the signature table beside it, and all
 * three belong to this module - the thunks, the imports and the signatures are
 * three faces of one list. It compiles for the system it runs on, which is
 * this server's.
 *
 * ponytail: this waits for the compiler, which takes a second or two, and the
 * server waits with it. At a map change that is invisible; on a reload in the
 * middle of a round it is a freeze. Spawning it without waiting and picking
 * the result up in the watcher is the fix if it ever matters.
 *
 * The compiler's own output is what says why a plugin failed, so it goes to a
 * file and from there to the console; nothing is run through a shell (on
 * Windows, cmd.exe would flash a window on every build).
 */
/** The first line of a file, without its line ending; "" when there is none. */
static std::string FirstLine(const std::string &file)
{
	char text[256] = "";
	FILE *f = fopen(file.c_str(), "r");
	if (f) {
		if (!fgets(text, sizeof(text), f))
			text[0] = 0;
		fclose(f);
	}
	text[strcspn(text, "\r\n")] = 0;
	return text;
}

/**
 * The build amxts-compile says it is of (`--version`), asked once a file:
 * "" for one too old to say - it takes the flag for a source and answers with
 * its usage.
 */
static std::string CompilerBuild(const std::string &tool, const std::string &log)
{
	static time_t asked = 0;
	static std::string build;

	time_t stamp = FileStamp(tool.c_str());
	if (stamp != asked) {
		asked = stamp;
		std::vector<std::string> args(1, "--version");
		build = RunCompiler(tool, args, log) == 0 ? FirstLine(log) : "";
	}
	return build;
}

/** Why the last CompilePlugin or LoadPlugin failed, in a few words: what amxts_plugins shows. */
static std::string g_refusal;

static bool CompilePlugin(const std::string &source, const std::string &output)
{
	std::string tool = MF_BuildPathname("addons/amxts/tools/" COMPILER_FILE);

	if (FileStamp(tool.c_str()) == 0) {
		MF_PrintSrvConsole("[amxts] %s is missing - a .ts plugin needs the compiler beside the module\n", tool.c_str());
		g_refusal = "the compiler is missing";
		return false;
	}

	std::string log = MF_BuildPathname("addons/amxts/build/compile.log");

	// The module writes the API a plugin imports, and a compiler of another
	// build reads it with another AssemblyScript: its errors would say nothing
	// of why. So one of another build compiles nothing.
	std::string build = CompilerBuild(tool, log);
	if (build != AMXTS_BUILD) {
		MF_PrintSrvConsole("[amxts] %s is not compiled: amxts-compile is %s%s, the module %s - take both from the same release\n",
		                   source.c_str(), build.empty() ? "of an older release" : "", build.c_str(), AMXTS_BUILD);
		g_refusal = "the compiler is of another build";
		return false;
	}

	MF_PrintSrvConsole("[amxts] compiling %s\n", source.c_str());

	std::vector<std::string> args;
	args.push_back(source);
	args.push_back(output);
	int code = RunCompiler(tool, args, log);

	if (code < 0) {
		g_refusal = "the compiler did not finish";
		return false;
	}

	MF_PrintSrvConsole("[amxts] compiler exited with %d\n", code);

	if (code != 0) {
		MF_PrintSrvConsole("[amxts] %s did not compile:\n", source.c_str());

		FILE *f = fopen(log.c_str(), "r");
		if (f) {
			char text[256];
			while (fgets(text, sizeof(text), f))
				MF_PrintSrvConsole("  %s", text);
			fclose(f);
		}

		g_refusal = "it does not compile";
		return false;
	}

	return true;
}

#ifdef _WIN32
#define THIS_SYSTEM "Windows"
#else
#define THIS_SYSTEM "Linux"
#endif

/**
 * The system an .aot was compiled for, when it is not this one; NULL when it
 * is, or when the file is not an .aot at all (the loader says so).
 *
 * wamrc writes the machine code as the target system's object format - COFF
 * for Windows, ELF for Linux - and the loader of each system knows only its
 * own relocations. Without this, a plugin built for the other system fails
 * with "invalid relocation type", which says nothing useful.
 *
 * The file starts with "\0aot" and a version, then the target-info section:
 * its id and size, then bin_type (load_target_info_section in aot_loader.c).
 */
static const char *AotBuiltForOtherSystem(const unsigned char *data, size_t size)
{
	if (size < 18 || memcmp(data, "\0aot", 4) != 0)
		return NULL;
	uint16_t binType = (uint16_t)(data[16] | data[17] << 8);
	bool coff = binType == 4 || binType == 6;   // BIN_TYPE_COFF32, BIN_TYPE_COFF64
#ifdef _WIN32
	return coff ? NULL : "Linux";
#else
	return coff ? "Windows" : NULL;
#endif
}

// The custom section that holds the ABI a plugin was compiled against
// (scripts/build-identity.ts).
#define ABI_SECTION "amxts.abi"

static uint32_t ReadU32(const unsigned char *at)
{
	return at[0] | at[1] << 8 | at[2] << 16 | (uint32_t)at[3] << 24;
}

/**
 * The ABI an .aot was compiled against - its custom section amxts.abi, which
 * scripts/compile.ts writes and wamrc copies - or "" when it has none: a
 * plugin built before plugins carried one.
 *
 * It is read off the file before WAMR sees it: a plugin of another ABI calls
 * imports this module does not have, or has with other types, and crashes
 * the server. After the header ("\0aot" and a version) the file is a list of
 * sections, each at a 4-byte boundary: its type and its size, then its body.
 * A custom one (type 100) is a kind (0, raw), its name - a 16-bit length
 * that counts the terminator, then the bytes - and its content
 * (aot_emit_custom_sections in WAMR's aot_emit_aot_file.c).
 */
static std::string AotAbi(const unsigned char *data, size_t size)
{
	const size_t nameLength = sizeof(ABI_SECTION);
	size_t at = 8;
	while (at + 8 <= size) {
		uint32_t type = ReadU32(data + at);
		size_t length = ReadU32(data + at + 4);
		const unsigned char *body = data + at + 8;
		if (length > size - at - 8)
			break;
		if (type == 100 && length >= 6 + nameLength && ReadU32(body) == 0
		    && (size_t)(body[4] | body[5] << 8) == nameLength && memcmp(body + 6, ABI_SECTION, nameLength) == 0)
			return std::string((const char *)body + 6 + nameLength, length - 6 - nameLength);
		at = (at + 8 + length + 3) & ~(size_t)3;
	}
	return "";
}

/** The ABI of the .aot at `path`, "" when it has none or is not there. */
static std::string FileAbi(const std::string &path)
{
	FILE *f = fopen(path.c_str(), "rb");
	if (!f)
		return "";
	std::vector<unsigned char> data;
	unsigned char chunk[65536];
	size_t got;
	while ((got = fread(chunk, 1, sizeof(chunk), f)) > 0)
		data.insert(data.end(), chunk, chunk + got);
	fclose(f);
	return data.empty() ? "" : AotAbi(&data[0], data.size());
}

/** The line of an ABI's version, major.minor: 0.3 of 0.3.1+abi.1a2b3c4d. */
static std::string AbiLine(const std::string &abi)
{
	std::string version = abi.substr(0, abi.find('+'));
	size_t dot = version.find('.');
	return version.substr(0, dot == std::string::npos ? dot : version.find('.', dot + 1));
}

/**
 * Whether a plugin of the ABI `abi` loads here: one of this module's line and
 * hash - any patch of 0.3 of the same hood, 0.3.0+abi.1a2b3c4d under
 * 0.3.1+abi.1a2b3c4d (scripts/build-identity.ts).
 */
static bool AbiFits(const std::string &abi)
{
	std::string ours = AMXTS_ABI;
	size_t at = abi.find('+');
	return at != std::string::npos && AbiLine(abi) == AbiLine(ours) && abi.substr(at) == ours.substr(ours.find('+'));
}

/**
 * Whether a plugin is of this module's ABI; when not, one line says so. It
 * names the lines when they differ, and the whole ABIs when only the hood
 * does.
 */
static bool OfThisAbi(const char *name, const unsigned char *data, size_t size)
{
	std::string abi = AotAbi(data, size);
	if (AbiFits(abi))
		return true;
	std::string ours = AMXTS_ABI;
	bool sameLine = AbiLine(abi) == AbiLine(ours);
	std::string built = abi.empty() ? "an older amxts" : "amxts " + (sameLine ? abi : AbiLine(abi));
	MF_PrintSrvConsole("[amxts] %s was built for %s, this is %s - build it again\n",
	                   name, built.c_str(), (sameLine ? ours : AbiLine(ours)).c_str());
	g_refusal = "built for " + built;
	return false;
}

/**
 * Binds what plugin `index` registered at its top level (Bind): it ran
 * before the plugin had its instance and its table to look them up in.
 */
static void BindAll(int index)
{
	for (Forward &f : g_forwards) {
		for (Handler &h : f.handlers)
			if (h.plugin == index) Bind(h);
		for (Subscription &s : f.subscribers)
			if (s.handler.plugin == index) Bind(s.handler);
	}
	for (std::map<std::string, std::vector<Subscription> >::iterator it = g_subscriptions.begin(); it != g_subscriptions.end(); ++it)
		for (Subscription &s : it->second)
			if (s.handler.plugin == index) Bind(s.handler);
	for (Slot &slot : g_slots)
		if (slot.plugin == index) Bind(slot);
	for (Exported &e : g_exported)
		if (e.plugin == index) Bind(e);
	for (FieldListener &l : g_fieldListeners)
		if (l.plugin == index) Bind(l);
	for (Timer &t : g_timerSlots)
		if (t.armed && t.handler.plugin == index) Bind(t.handler);
	for (std::map<std::string, Forward> *commands : { &g_clientCommands, &g_serverCommands })
		for (std::map<std::string, Forward>::iterator it = commands->begin(); it != commands->end(); ++it)
			for (Handler &h : it->second.handlers)
				if (h.plugin == index) Bind(h);
	BindGameHooks(index);
}

/**
 * Loads the .aot of the plugin at `index` - an entry of the list or of
 * amxts_load, not running - and runs its top level. false, with g_refusal
 * saying why, when it cannot; what it took is then ReleasePlugin's to free.
 */
static bool LoadPlugin(int index)
{
	const std::string name = g_plugins[index].name;
	const std::string path = g_plugins[index].path;
	g_plugins[index].stamp = FileStamp(path.c_str());

	FILE *f = fopen(path.c_str(), "rb");
	if (!f) {
		MF_PrintSrvConsole("[amxts] missing %s\n", path.c_str());
		g_refusal = "its file is missing";
		return false;
	}

	fseek(f, 0, SEEK_END);
	long len = ftell(f);
	fseek(f, 0, SEEK_SET);

	unsigned char *file = (unsigned char *)malloc(len);
	g_plugins[index].file = file;
	size_t got = fread(file, 1, len, f);
	fclose(f);

	const char *other = AotBuiltForOtherSystem(file, got);
	if (other) {
		MF_PrintSrvConsole("[amxts] %s was compiled for a %s server, and this one runs %s - build it for this server (amxts build picks the system from AMXTS_SERVER, or --os)\n",
		                   name.c_str(), other, THIS_SYSTEM);
		g_refusal = std::string("built for a ") + other + " server";
		return false;
	}

	if (!OfThisAbi(name.c_str(), file, got))
		return false;

	char err[192];
	wasm_module_t module = wasm_runtime_load(file, (uint32_t)got, err, sizeof(err));
	g_plugins[index].module = module;
	if (!module) {
		MF_PrintSrvConsole("[amxts] %s: %s\n", name.c_str(), err);
		g_refusal = err;
		return false;
	}

	// The plugin is made current for its instantiation, because a plugin
	// registers at the top level of its file and WebAssembly runs that during
	// instantiation. Anything registered there has to know which plugin it
	// belongs to, and the index is what says so.
	int previous = g_currentPlugin;
	g_currentPlugin = index;
	// A run of its own, before its top level hands any function over.
	static int32_t runs = 0;
	g_plugins[index].run = ++runs;
	g_plugins[index].toldGone = false;

	// 64 KB of stack, and no app heap at all.
	//
	// The app heap is WAMR's, for a host that wants to allocate inside a
	// module's memory with wasm_runtime_module_malloc. Nothing here does:
	// every buffer crossing the bridge is copied into the AMX heap instead.
	// Asking for one is not free - WAMR puts it at the end of the linear
	// memory, and memory.grow would move it, so the growth is refused. The
	// AssemblyScript allocator grows the linear memory for every string it
	// makes, so what that refusal buys is a plugin that runs until it has
	// allocated a few thousand strings and then traps with "unreachable",
	// naming nothing. Sixteen unused kilobytes were the whole ceiling.
	// Its top level may call an async function, whose jobs wait for DrainJobs
	// below rather than running inside the start function.
	g_plugins[index].depth = 1;
	wasm_module_inst_t inst = wasm_runtime_instantiate(module, 64 * 1024, 0, err, sizeof(err));
	g_plugins[index].depth = 0;

	g_currentPlugin = previous;

	if (!inst) {
		// Its top level failed, or WAMR refused it: an abort's frames are kept.
		Failure failure = TakeFailure(index, NULL, err);
		PrintFailure(index, failure);
		g_refusal = "its top level failed: " + failure.message;
		return false;
	}

	Plugin &p = g_plugins[index];
	p.inst = inst;
	// The exported function table, for Fire to read handler signatures from.
	p.hasTable = wasm_runtime_get_export_table_inst(inst, "table", &p.table);
	BindAll(index);

	p.env = wasm_runtime_create_exec_env(inst, 64 * 1024);
	if (!p.env) {
		MF_PrintSrvConsole("[amxts] %s: cannot create exec env\n", name.c_str());
		g_refusal = "no exec env for it";
		return false;
	}

	p.state = PLUGIN_RUNNING;
	p.reason = "";

	// A plugin with async functions: where its shadow stack starts, for
	// DrainJobs. Its top level has returned, so nothing is on it.
	if (wasm_runtime_lookup_function(inst, "__co_stack"))
		p.stackTop = CoCall(p.env, "__co_stack");

	DrainJobs(index);
	return true;
}

// Runs a plugin's exported init(), which is where it registers everything.
static void InitPlugin(int index)
{
	Plugin &p = g_plugins[index];

	// A plugin that registers at the top level of its file has nothing left to
	// do here, and that is the ordinary shape. init() is for work that has to
	// happen after the whole file has been read.
	wasm_function_inst_t init = wasm_runtime_lookup_function(p.inst, "init");
	if (!init) {
		MF_PrintSrvConsole("[amxts] loaded %s\n", p.name.c_str());
		return;
	}

	// A plugin whose top level or handler loaded this one, with amxts_load run
	// by server_exec, goes on registering after it.
	int previous = g_currentPlugin;
	g_currentPlugin = index;

	p.depth++;
	if (!wasm_runtime_call_wasm(p.env, init, 0, NULL)) {
		Failed(index, p.inst);
	} else {
		MF_PrintSrvConsole("[amxts] loaded %s\n", p.name.c_str());
	}
	p.depth--;

	g_currentPlugin = previous;
	DrainJobs(index);
}

/**
 * Compiles the plugin at `index` when its .ts is newer than its build, or the
 * build is of another ABI, then loads it and runs its init(). Its entry says
 * how that went: running, or refused and why.
 */
static bool LoadEntry(int index)
{
	Plugin &p = g_plugins[index];
	p.state = PLUGIN_LOADING;
	g_refusal = "";

	// Built from an older source, or by an amxts of another ABI: compiled again.
	bool loaded = false;
	if (!p.source.empty()) {
		p.sourceStamp = FileStamp(p.source.c_str());
		bool stale = FileStamp(p.path.c_str()) < p.sourceStamp || !AbiFits(FileAbi(p.path));
		loaded = (!stale || CompilePlugin(p.source, p.path)) && LoadPlugin(index);
	} else {
		loaded = LoadPlugin(index);
	}

	if (!loaded) {
		ReleasePlugin(index);
		g_plugins[index].state = PLUGIN_REFUSED;
		g_plugins[index].reason = g_refusal;
		return false;
	}

	InitPlugin(index);
	return true;
}

/** A plugin's name without its .ts or .aot: what a command may call it by. */
static std::string Stem(const std::string &name)
{
	size_t dot = name.find_last_of('.');
	bool known = dot != std::string::npos && (name.compare(dot, std::string::npos, ".ts") == 0 || name.compare(dot, std::string::npos, ".aot") == 0);
	return known ? name.substr(0, dot) : name;
}

/** The entry of `list` whose line is `name`; -1 for none. */
static int Named(const std::deque<Plugin> &list, const std::string &name)
{
	for (size_t i = 0; i < list.size(); i++)
		if (list[i].name == name)
			return (int)i;
	return -1;
}

/** The entry a command names, by its line ("shop.ts") or without the extension ("shop"); -1 for none. */
static int FindPlugin(const std::string &wanted)
{
	for (size_t i = 0; i < g_plugins.size(); i++)
		if (g_plugins[i].name == wanted || Stem(g_plugins[i].name) == wanted)
			return (int)i;
	return -1;
}

/**
 * A new entry, not loaded yet, for `line`: a plugin's file in plugins/ beside
 * the list. A .ts is built into build/ beside it, and the result kept there
 * so that a server restart does not compile it again. Its index.
 */
static int AddPlugin(const std::string &line, bool listed)
{
	const std::string home = ListHome();
	std::string file = MF_BuildPathname("%s/plugins/%s", home.c_str(), line.c_str());
	bool isSource = Stem(line) + ".ts" == line;

	Plugin p;
	p.name = line;
	p.listed = listed;
	p.source = isSource ? file : "";
	p.path = isSource ? std::string(MF_BuildPathname("%s/build/%s.aot", home.c_str(), Stem(line).c_str())) : file;
	g_plugins.push_back(p);
	return (int)g_plugins.size() - 1;
}

/** The lines of the plugin list: a file of plugins/ each, without blanks and comments. */
static std::vector<std::string> ReadList()
{
	std::vector<std::string> lines;
	std::string listPath = MF_BuildPathname("%s", ListFile().c_str());
	FILE *f = fopen(listPath.c_str(), "r");
	if (!f) {
		MF_PrintSrvConsole("[amxts] no plugin list at %s\n", listPath.c_str());
		return lines;
	}

	if (HasOwnList())
		MF_PrintSrvConsole("[amxts] plugin list %s\n", listPath.c_str());

	char line[256];
	while (fgets(line, sizeof(line), f)) {
		char *p = line;
		while (*p == ' ' || *p == '\t') p++;
		char *end = p + strlen(p);
		while (end > p && (end[-1] == '\n' || end[-1] == '\r' || end[-1] == ' '))
			*--end = 0;
		if (*p && *p != ';' && *p != '#')
			lines.push_back(p);
	}

	fclose(f);
	return lines;
}

/**
 * Loads the plugins of the list, in its order, then those amxts_load added.
 * `before` is the entries a reload of every plugin let go, whose commands it
 * keeps: a plugin unloaded stays unloaded, one loaded by hand comes back.
 *
 * Meanwhile a plugin's top level or init() can run amxts_load with
 * server_exec (in a reload: at a map's start the command is not registered
 * yet). That loads the plugin there and then, and this walk passes over it:
 * it loads an entry only while the entry is waiting, and an entry amxts_load
 * adds lies past the end it took. plugin_init comes to every plugin together
 * once they are all loaded (g_loadingAll).
 */
static void LoadScripts(const std::deque<Plugin> &before = std::deque<Plugin>())
{
	std::vector<std::string> lines = ReadList();
	for (size_t i = 0; i < lines.size(); i++)
		AddPlugin(lines[i], true);

	for (size_t i = 0; i < before.size(); i++)
		if (!before[i].listed && Named(g_plugins, before[i].name) < 0)
			AddPlugin(before[i].name, false);

	g_loadingAll = true;
	for (size_t i = 0, count = g_plugins.size(); i < count; i++) {
		if (g_plugins[i].state != PLUGIN_WAITING)
			continue;
		int was = Named(before, g_plugins[i].name);
		if (was >= 0 && before[was].state == PLUGIN_UNLOADED)
			g_plugins[i].state = PLUGIN_UNLOADED;
		else
			LoadEntry((int)i);
	}
	g_loadingAll = false;
}

/**
 * Tells the plugins that the server is up - every plugin, or the one at
 * `only`, loaded once the server was.
 *
 * Fired from plugin_init, and again after a reload or a load: a plugin's top
 * level runs when it is loaded, but everything it may not do that early -
 * read a config, register a command, put its menus up - waits for this. A
 * reload that skipped it left a plugin half awake, which is a strange thing
 * to debug.
 */
static void FireInit(int only = -1)
{
	Forward &f = g_forwards[FORWARD_PLUGIN_INIT];
	f.depth++;
	for (size_t i = 0, end = f.handlers.size(); i < end; i++)
		if (only < 0 || f.handlers[i].plugin == only)
			Fire(f.handlers[i], NULL, 0, 0);
	EndDispatch(f);
}



/** Whether `p` calls a module the plugin at `owner` serves. */
static bool UsesModuleOf(const Plugin &p, int owner)
{
	for (size_t i = 0; i < g_services.size(); i++)
		if (g_services[i].plugin == owner && std::find(p.uses.begin(), p.uses.end(), g_services[i].name) != p.uses.end())
			return true;
	return false;
}

/**
 * The running plugins that call a module the plugin at `index` serves, and
 * those that call theirs, in the list's order: what holds handles and
 * functions of its instance, which mean nothing to another.
 */
static std::vector<int> Dependents(int index)
{
	std::vector<int> found(1, index);
	for (size_t k = 0; k < found.size(); k++)
		for (size_t i = 0; i < g_plugins.size(); i++)
			if (g_plugins[i].state == PLUGIN_RUNNING && std::find(found.begin(), found.end(), (int)i) == found.end()
			    && UsesModuleOf(g_plugins[i], found[k]))
				found.push_back((int)i);

	found.erase(found.begin());
	std::sort(found.begin(), found.end());
	return found;
}

/** The plugins' names, "shop.ts, vip.ts". */
static std::string Names(const std::vector<int> &plugins)
{
	std::string names;
	for (size_t i = 0; i < plugins.size(); i++)
		names += (i ? ", " : "") + g_plugins[plugins[i]].name;
	return names;
}

/**
 * Whether one of these plugins is in the middle of a call - a command run
 * with server_exec from its own handler - and cannot be stopped under it;
 * the console says so.
 */
static bool Busy(const std::vector<int> &plugins)
{
	for (size_t i = 0; i < plugins.size(); i++) {
		if (g_plugins[plugins[i]].depth > 0) {
			MF_PrintSrvConsole("[amxts] %s is running a call - try again from the console\n", g_plugins[plugins[i]].name.c_str());
			return true;
		}
	}
	return false;
}

/**
 * amxts_reload: every plugin starts over from disk. It replaces every entry
 * of g_plugins, so it is refused while any of them has a call on the stack -
 * the entry under the call would be gone when the call returns.
 */
static void ReloadPlugins()
{
	std::vector<int> all(g_plugins.size());
	for (size_t i = 0; i < all.size(); i++)
		all[i] = (int)i;
	if (Busy(all))
		return;

	MF_PrintSrvConsole("[amxts] reloading\n");
	LoadScripts(UnloadPlugins());
	FireInit();
}

/** The entry a command names, or -1 with a line in the console. */
static int PluginFor(const std::string &wanted)
{
	int index = FindPlugin(wanted);
	if (index < 0)
		MF_PrintSrvConsole("[amxts] no plugin %s - amxts_plugins lists them\n", wanted.c_str());
	return index;
}

/**
 * Loads these plugins in place, then tells them the server is up - unless
 * LoadScripts is loading every plugin: they hear it with the rest then.
 */
static void StartPlugins(const std::vector<int> &plugins)
{
	for (size_t i = 0; i < plugins.size(); i++)
		LoadEntry(plugins[i]);
	if (g_loadingAll)
		return;
	for (size_t i = 0; i < plugins.size(); i++)
		if (g_plugins[plugins[i]].state == PLUGIN_RUNNING)
			FireInit(plugins[i]);
}

/**
 * amxts_unload <plugin>: stops it, and what it registered with it, until
 * amxts_load or the map changes. A plugin whose module others call stays:
 * they hold handles and functions of it.
 */
static void UnloadOne(const std::string &wanted)
{
	int index = PluginFor(wanted);
	if (index < 0)
		return;

	const std::string name = g_plugins[index].name;
	if (g_plugins[index].state != PLUGIN_RUNNING) {
		MF_PrintSrvConsole("[amxts] %s is not running\n", name.c_str());
		return;
	}

	std::vector<int> dependents = Dependents(index);
	if (!dependents.empty()) {
		MF_PrintSrvConsole("[amxts] %s stays: its module is in use - unload first %s\n", name.c_str(), Names(dependents).c_str());
		return;
	}

	if (Busy(std::vector<int>(1, index)))
		return;

	ReleasePlugin(index);
	g_plugins[index].state = PLUGIN_UNLOADED;
	MF_PrintSrvConsole("[amxts] unloaded %s\n", name.c_str());
}

/**
 * An entry for a plugin amxts_load names and the list does not: its file in
 * plugins/, `<name>`, `<name>.ts` or `<name>.aot`. -1 when there is none.
 */
static int AddByHand(const std::string &wanted)
{
	const std::string home = ListHome();
	const char *endings[] = { "", ".ts", ".aot" };
	for (int i = 0; i < 3; i++) {
		std::string line = wanted + endings[i];
		if (Stem(line) != line && FileStamp(MF_BuildPathname("%s/plugins/%s", home.c_str(), line.c_str())))
			return AddPlugin(line, false);
	}

	MF_PrintSrvConsole("[amxts] no plugin %s in %s/plugins\n", wanted.c_str(), home.c_str());
	return -1;
}

/**
 * amxts_load <plugin>: one unloaded, refused or not loaded yet, or a file of
 * plugins/ the list does not name.
 */
static void LoadOne(const std::string &wanted)
{
	int index = FindPlugin(wanted);
	if (index >= 0 && g_plugins[index].state == PLUGIN_RUNNING) {
		MF_PrintSrvConsole("[amxts] %s is running - amxts_reload %s starts it over\n", g_plugins[index].name.c_str(), wanted.c_str());
		return;
	}
	if (index >= 0 && g_plugins[index].state == PLUGIN_LOADING) {
		MF_PrintSrvConsole("[amxts] %s is loading\n", g_plugins[index].name.c_str());
		return;
	}

	if (index < 0)
		index = AddByHand(wanted);
	if (index >= 0)
		StartPlugins(std::vector<int>(1, index));
}

/**
 * amxts_reload <plugin>: starts it over from disk, compiled again when its
 * .ts changed. The plugins that call its module start over after it: they
 * hold handles and functions of the old instance.
 */
static void ReloadOne(const std::string &wanted)
{
	int index = PluginFor(wanted);
	if (index < 0)
		return;

	std::vector<int> dependents = Dependents(index);
	std::vector<int> group(1, index);
	group.insert(group.end(), dependents.begin(), dependents.end());
	if (Busy(group))
		return;

	if (dependents.empty())
		MF_PrintSrvConsole("[amxts] reloading %s\n", g_plugins[index].name.c_str());
	else
		MF_PrintSrvConsole("[amxts] reloading %s, and what uses its module: %s\n", g_plugins[index].name.c_str(), Names(dependents).c_str());
	for (size_t i = group.size(); i-- > 0;)
		ReleasePlugin(group[i]);
	StartPlugins(group);
}

/**
 * Reloads when a plugin's .aot has been written since it was loaded.
 *
 * A rebuild is the only thing that changes that file, so this is what makes
 * `bun run plugins --deploy` land on a running server without a map change or
 * anyone typing a command. It runs from the frame (StartFrame_Post), with no
 * wasm frame underneath - the one place where throwing the instances away is
 * safe.
 *
 * The new time is taken before the reload, not after, so a plugin that fails
 * to load is not retried every second.
 */
static void WatchPlugins()
{
	bool changed = false;

	for (size_t i = 0; i < g_plugins.size(); i++) {
		Plugin &p = g_plugins[i];

		// An unloaded plugin stays as it is until amxts_load.
		if (p.state == PLUGIN_UNLOADED)
			continue;

		// A plugin written as TypeScript is watched by its source: the .aot is
		// a build product, and waiting for that one would mean waiting for a
		// compile that nothing has started. A refused one is watched as well,
		// so that saving the fix is all it takes; compiling it here rather than
		// at the reload keeps a plugin that is still broken from restarting
		// the ones that are not.
		if (!p.source.empty()) {
			time_t now = FileStamp(p.source.c_str());
			if (!now || now == p.sourceStamp)
				continue;

			MF_PrintSrvConsole("[amxts] %s changed, compiling\n", p.name.c_str());
			p.sourceStamp = now;
			changed = CompilePlugin(p.source, p.path) || changed;
			continue;
		}

		time_t now = FileStamp(p.path.c_str());
		if (now && now != p.stamp) {
			MF_PrintSrvConsole("[amxts] %s changed on disk\n", p.name.c_str());
			p.stamp = now;
			changed = true;
		}
	}

	if (changed)
		ReloadPlugins();
}

static void ListPlugins()
{
	static const char *const STATES[] = { "running", "unloaded", "refused", "waiting", "loading" };

	int counts[5] = { 0, 0, 0, 0, 0 };
	int width = 0;
	for (size_t i = 0; i < g_plugins.size(); i++) {
		counts[g_plugins[i].state]++;
		if ((int)g_plugins[i].name.size() > width)
			width = (int)g_plugins[i].name.size();
	}

	MF_PrintSrvConsole("[amxts] %d plugin(s): %d running, %d unloaded, %d refused\n",
	                   (int)g_plugins.size(), counts[PLUGIN_RUNNING], counts[PLUGIN_UNLOADED], counts[PLUGIN_REFUSED]);

	for (size_t i = 0; i < g_plugins.size(); i++) {
		const Plugin &p = g_plugins[i];
		std::string about = p.state == PLUGIN_REFUSED ? p.reason
			: p.state == PLUGIN_UNLOADED ? std::string()
			: p.title.empty() ? std::string("(no plugin() call)")
			: p.title + " " + p.version + "  by " + (p.author.empty() ? "-" : p.author) + (p.description.empty() ? "" : " - " + p.description);
		std::string state = STATES[p.state];
		if (!about.empty())
			state += std::string(10 - state.size(), ' ') + about;
		MF_PrintSrvConsole("  %-*s  %s\n", width, p.name.c_str(), state.c_str());
	}
}

// ---------------------------------------------------------------- a map's start

/**
 * Lays out addons/amxts and loads the plugins, which is earlier than it
 * looks: a plugin exports its natives by running, and AMX Mod X binds a Pawn
 * plugin's natives from the module's list as it loads the plugin. On the
 * first map this runs as the module attaches, before AMX Mod X loads any Pawn
 * plugin, with an image that has the natives of the modules loaded so far;
 * on a later map the module stays attached, and it runs in
 * AMXX_PluginsLoaded, where a name a plugin exports for the first time
 * reaches the next map's Pawn plugins.
 */
// Whether this map's plugins loaded as the module attached: the first map's.
static bool g_mapStarted = false;

static void StartMap()
{
	if (g_image)
		MF_PrintSrvConsole("[amxts] natives' image: %d entries\n", NativeCount(g_image));
	InstallFiles();
	LoadScripts();
}

/**
 * A call of the exported native at `slot` (ExportedEntry): from a Pawn
 * plugin's call instruction, or from the image's table for a TypeScript plugin
 * calling another's native (Invoke).
 *
 * The arguments are the call's own cells, read in place: a string or an
 * array among them is an address in the calling AMX, which is where
 * argString() and argArray() read it.
 */
static cell CallExported(size_t slot, AMX *amx, cell *params)
{
	int given = (int)(params[0] / sizeof(cell));
	if (given > MAX_NATIVE_ARGS) given = MAX_NATIVE_ARGS;

	CallArgs context(params + 1, given, amx, CALLER_OF_AMX);

	// nativeFn's handler takes the first four as parameters; a generated
	// wrapper takes none and reads every one itself.
	int n = given > MAX_EVENT_ARGS ? MAX_EVENT_ARGS : given;
	uint32_t argv[MAX_EVENT_ARGS];
	for (int i = 0; i < n; i++)
		argv[i] = (uint32_t)(int32_t)params[i + 1];

	// Whatever the handler said with ret(); nothing said is nothing returned.
	return Fire(g_exported[slot], argv, n, 0);
}

// ---- Pawn's forwards to TypeScript

// amxmodx/CForward.h's ForwardParam: how a forward passes a parameter.
#define FP_STRING   2
#define FP_STRINGEX 3
#define FP_ARRAY    4

/**
 * The array behind each PrepareArray handle - the calling plugin's address
 * and size - for the ExecuteForward that takes it: AMX Mod X numbers them from
 * 0 again after every forward, up to a forward's parameters.
 */
static struct { cell addr; int32_t size; } g_prepared[MAX_FORWARD_ARGS];

// AMX Mod X's own CreateMultiForward, PrepareArray and ExecuteForward.
static AMX_NATIVE g_createMultiForward = NULL;
static AMX_NATIVE g_prepareArray = NULL;
static AMX_NATIVE g_executeForward = NULL;

// CreateMultiForward(const name[], stop_type, ...)
static cell AMX_NATIVE_CALL n_createMultiForward(AMX *amx, cell *params)
{
	cell id = g_createMultiForward(amx, params);
	if (id < 0 || (id & 1))
		return id;

	PawnForward forward;
	int len = 0;
	forward.name = MF_GetAmxString(amx, params[1], 0, &len);
	for (int i = 3, count = (int)(params[0] / sizeof(cell)); i <= count; i++) {
		cell *type = MF_GetAmxAddr(amx, params[i]);
		forward.types.push_back(type ? *type : 0);
	}

	size_t index = (size_t)id >> 1;
	if (g_pawnForwards.size() <= index)
		g_pawnForwards.resize(index + 1);
	g_pawnForwards[index] = forward;
	return id;
}

// PrepareArray(const array[], size, copyback = 0)
static cell AMX_NATIVE_CALL n_prepareArray(AMX *amx, cell *params)
{
	cell handle = g_prepareArray(amx, params);
	if (handle >= 0 && handle < MAX_FORWARD_ARGS) {
		g_prepared[handle].addr = params[1];
		g_prepared[handle].size = (int32_t)params[2];
	}
	return handle;
}

/**
 * ExecuteForward(forward, &ret, ...) - the Pawn plugins' publics first, as
 * AMX Mod X runs them, then the TypeScript subscribers of the forward's
 * name. Pawn passes every argument after `ret` by its address: a number is
 * read through it, a string stays the address it is, an array is the one its
 * PrepareArray handle names.
 */
static cell AMX_NATIVE_CALL n_executeForward(AMX *amx, cell *params)
{
	cell sent = g_executeForward(amx, params);
	size_t index = (size_t)params[1] >> 1;
	if (!sent || (params[1] & 1) || index >= g_pawnForwards.size())
		return sent;

	PawnForward &forward = g_pawnForwards[index];
	if (forward.seen != g_subscriptionNames) {
		std::map<std::string, std::vector<Subscription> >::iterator it = g_subscriptions.find(forward.name);
		forward.subscribers = it == g_subscriptions.end() ? NULL : &it->second;
		forward.seen = g_subscriptionNames;
	}
	if (!forward.subscribers || forward.subscribers->empty())
		return sent;

	const std::vector<cell> &types = forward.types;
	int argc = (int)(params[0] / sizeof(cell)) - 2;
	if (argc > (int)types.size()) argc = (int)types.size();
	if (argc > MAX_FORWARD_ARGS) argc = MAX_FORWARD_ARGS;

	cell args[MAX_FORWARD_ARGS];
	int32_t lengths[MAX_FORWARD_ARGS];
	for (int i = 0; i < argc; i++) {
		lengths[i] = -1;
		args[i] = params[i + 3];
		if (types[i] == FP_STRING || types[i] == FP_STRINGEX)
			continue;
		cell *phys = MF_GetAmxAddr(amx, params[i + 3]);
		args[i] = phys ? *phys : 0;
		if (types[i] != FP_ARRAY)
			continue;
		cell handle = args[i];
		bool prepared = handle >= 0 && handle < MAX_FORWARD_ARGS;
		args[i] = prepared ? g_prepared[handle].addr : 0;
		lengths[i] = prepared ? g_prepared[handle].size : -1;
	}

	// A copy: a subscriber may make a forward of its own, and g_pawnForwards grows.
	std::string name = forward.name;
	CallArgs context(args, argc, amx, -1, lengths);
	DeliverToSubscribers(name);
	return sent;
}

// AMX Mod X's own show_menu and menu_display.
static AMX_NATIVE g_showMenu = NULL;
static AMX_NATIVE g_menuDisplay = NULL;

// show_menu(index, keys, const menu[], time = -1, const title[] = "") - a
// menu over the player's Menu, or every player's for 0: it takes the keys,
// and a menu a TypeScript plugin's register_menucmd hears gets them
// (OpenMenuCommand). A Pawn plugin's, and the image's for a TypeScript one.
static cell AMX_NATIVE_CALL n_showMenu(AMX *amx, cell *params)
{
	cell shown = g_showMenu(amx, params);
	int id = (int)params[1];
	CloseMenus(id);
	for (int i = id ? id : 1; !g_menuCommands.empty() && i < CLIENT_SLOTS && (i == id || !id); i++)
		OpenMenuCommand(i);
	return shown;
}

// menu_display(id, menu, page = 0, time = -1)
static cell AMX_NATIVE_CALL n_menuDisplay(AMX *amx, cell *params)
{
	cell shown = g_menuDisplay(amx, params);
	if (params[1] > 0)
		CloseMenus((int)params[1]);
	return shown;
}

/**
 * Stands in for CreateMultiForward, PrepareArray and ExecuteForward, and for
 * show_menu and menu_display, in the native table of every script but the
 * image's, whose natives the module calls itself (Forward.emit reaches its
 * TypeScript subscribers through emit_local; the image's show_menu is the
 * module's own, g_ownNatives). Every map, in AMXX_PluginsLoaded: AMX Mod X loads the plugins
 * anew and has bound their natives, and they make their forwards from
 * plugin_precache on. A call instruction reads the entry on every call, with
 * the JIT too.
 */
static void InterposeNatives()
{
	const struct { const char *name; AMX_NATIVE *original; AMX_NATIVE own; } natives[] = {
		{ "CreateMultiForward", &g_createMultiForward, n_createMultiForward },
		{ "PrepareArray",       &g_prepareArray,       n_prepareArray       },
		{ "ExecuteForward",     &g_executeForward,     n_executeForward     },
		{ "show_menu",          &g_showMenu,           n_showMenu           },
		{ "menu_display",       &g_menuDisplay,        n_menuDisplay        },
	};

	for (int i = 0; AMX *amx = MF_GetScriptAmx(i); i++) {
		if (amx == g_image)
			continue;
		for (int k = 0, count = NativeCount(amx); k < count; k++) {
			AMX_NATIVE fn = NULL;
			const char *name = NativeEntry(amx, k, &fn);
			for (const auto &native : natives) {
				if (fn && fn != native.own && !strcmp(name, native.name)) {
					*native.original = fn;
					SetNativeEntry(amx, k, native.own);
				}
			}
		}
	}
}

/**
 * How deep the module is in a command's dispatch, a player's (ClientCommand)
 * or the server's (ServerCommand): while it is, the line the engine split
 * is that command's, and a bot's command sent from a handler puts it back
 * after its own (w_botCmd).
 */
static int g_commandDepth = 0;

struct InCommand {
	InCommand() { g_commandDepth++; }
	~InCommand() { g_commandDepth--; }
};

/**
 * Every server command the module gave the engine: its own amxts_*, then a
 * plugin's (g_serverCommands). The engine calls it with the line split.
 */
static void ServerCommand()
{
	InCommand dispatch;
	// No map is running: no plugin to answer or to act on.
	if (!g_image)
		return;

	std::string name = Lower(CMD_ARGV(0));
	std::string arg = CMD_ARGC() > 1 ? CMD_ARGV(1) : "";
	if (name == "amxts_reload") {
		if (arg.empty())
			ReloadPlugins();
		else
			ReloadOne(arg);
	} else if (name == "amxts_load" || name == "amxts_unload") {
		if (arg.empty())
			MF_PrintSrvConsole("[amxts] %s <plugin> - amxts_plugins lists them\n", name.c_str());
		else if (name == "amxts_load")
			LoadOne(arg);
		else
			UnloadOne(arg);
	} else if (name == "amxts_plugins") {
		ListPlugins();
	} else if (name == "amxts_trace") {
		g_trace = !g_trace;
		MF_PrintSrvConsole("[amxts] tracing %s\n", g_trace ? "on" : "off");
	} else {
		std::map<std::string, Forward>::iterator it = g_serverCommands.find(name);
		if (it != g_serverCommands.end())
			RunCommand(it->second, 0);
	}
}

/**
 * plugin_init's part, from ServerActivate's post, after AMX Mod X's. The
 * plugins are already running: amxts_natives loaded them. What is left is the
 * module's own commands, the watcher, and telling the plugins that the
 * server is up.
 */
static void StartServer()
{
	g_amxxReady = true;

	AddEngineCommand("amxts_reload");
	AddEngineCommand("amxts_unload");
	AddEngineCommand("amxts_load");
	AddEngineCommand("amxts_plugins");
	AddEngineCommand("amxts_trace");

	FireInit();
}

// ---------------------------------------------------------------- the clients and the server

// AMX Mod X fires its forwards from its own Metamod hooks, and AMX Mod X is
// ahead of the module in Metamod's list, so the module's hook of the same
// function and phase comes after it: Pawn plugins hear each event first.
// The engine module's forwards
// (client_kill, client_impulse, client_cmdStart) are heard in the post,
// after every pre hook: that module is loaded when a plugin needs it, after
// the module in the list, and a pre would come before it.

/** Whether anything listens to forward `index`: when nothing does, an event costs this check. */
static bool Heard(int index)
{
	const Forward &f = g_forwards[index];
	return g_image && (!f.handlers.empty() || !f.subscribers.empty());
}

/**
 * Forward `index` to its listeners, with `args` as the call's context
 * (CallArgs). A string argument is pushed onto the image's heap by the
 * caller, which an ImageHeap takes back.
 */
static cell Raise(int index, cell *args, int argc)
{
	CallArgs context(args, argc, g_image);
	return Dispatch(g_forwards[index], args, argc);
}

static void Raise(int index)
{
	if (Heard(index))
		Raise(index, NULL, 0);
}

/** A player's event: the player's id its one argument. */
static cell RaiseFor(int index, int id)
{
	cell args[1] = { id };
	return Heard(index) ? Raise(index, args, 1) : 0;
}

/** What is pushed onto the image's heap while it lives goes when it does. */
struct ImageHeap {
	cell mark;
	ImageHeap() : mark(g_image->hea) {}
	~ImageHeap() { g_image->hea = mark; }
};

/** Whether the map has started (ServerActivate) and not ended (ServerDeactivate). */
static bool g_activated = false;

/** Whether this map's precache has been raised: at the first spawn, the world's. */
static bool g_precached = false;

/** Whether the precache event is running: the one time the game takes a precache. */
static bool g_precaching = false;

// Whether VoiceTranscoder last said the client speaks (PollSpeaking).
static bool g_speaking[CLIENT_SLOTS];

// ---- the configs

/**
 * OnConfigsExecuted's clock, AMX Mod X's: its task tick, every 0.1 s of the
 * game's time from ServerActivate's post. The first tick at or after 6.1 s
 * queues the map's configs, and the next fires the forward, after the
 * engine has run them. The module keeps the same tick from the same moment,
 * so its event comes in the same frame as AMX Mod X's forward, after it.
 */
static float g_configTick = 0;
static float g_configsDue = 0;
static int   g_configTicks = 0; // ticks at or after g_configsDue, up to 2

static void ConfigTick()
{
	if (!g_activated || g_configTicks >= 2 || gpGlobals->time < g_configTick)
		return;
	g_configTick = gpGlobals->time + 0.1f;
	if (gpGlobals->time >= g_configsDue && ++g_configTicks == 2)
		Raise(FORWARD_ONCONFIGSEXECUTED);
}

// ---- client_authorized

/**
 * The clients AMX Mod X has authorized and is about to tell its plugins
 * about: it calls the module's function (MF_RegAuthFunc) right before the
 * forward, at all three places it fires it - a client's connect, its 0.7 s
 * check, a bot's info. The module's own hook of the same function, after
 * AMX Mod X's, raises them, so Pawn plugins hear it first.
 */
static std::vector<std::pair<int, std::string> > g_authorized;

static void OnAuthorized(int id, const char *authid)
{
	if (id > 0 && id < CLIENT_SLOTS)
		g_authorized.push_back(std::make_pair(id, std::string(authid ? authid : "")));
}

static void RaiseAuthorized()
{
	if (g_authorized.empty())
		return;
	std::vector<std::pair<int, std::string> > now;
	now.swap(g_authorized);
	for (size_t i = 0; i < now.size() && Heard(FORWARD_CLIENT_AUTHORIZED); i++) {
		ImageHeap heap;
		cell args[2] = { now[i].first, PushString(now[i].second.c_str()) };
		Raise(FORWARD_CLIENT_AUTHORIZED, args, 2);
	}
}

// ---- a client comes

static void Connected(int id)
{
	g_connected[id] = true;
	NewPlayer(id);
	RaiseFor(FORWARD_CLIENT_CONNECT, id);
}

static void PutInServer(int id)
{
	g_inGame[id] = true;
	RaiseFor(FORWARD_CLIENT_PUTINSERVER, id);
}

/** A slot's edict as an id, 0 for an edict that is not a client's. */
static int ClientId(const edict_t *e)
{
	int id = e ? ENTINDEX((edict_t *)e) : 0;
	return id > 0 && id < CLIENT_SLOTS && id <= gpGlobals->maxClients ? id : 0;
}

// ---- a client leaves

/**
 * client_disconnected, then the player's fields go - after every plugin has
 * heard him go, so a listener of the leave can still read them.
 */
static void Disconnected(int id, bool dropped, const char *reason)
{
	if (Heard(FORWARD_CLIENT_DISCONNECTED)) {
		ImageHeap heap;
		cell args[4] = { id, dropped, PushString(reason), (cell)strlen(reason) };
		Raise(FORWARD_CLIENT_DISCONNECTED, args, 4);
	}
	g_speaking[id] = false;
	ClearPlayerData(id);
}

/** The slot is let go: client_remove, for a client that had it. */
static void Removed(int id, bool dropped, const char *reason)
{
	bool had = g_connected[id] || g_inGame[id];
	g_connected[id] = g_inGame[id] = false;
	CloseMenu(id);
	if (had && Heard(FORWARD_CLIENT_REMOVE)) {
		ImageHeap heap;
		cell args[3] = { id, dropped, PushString(reason) };
		Raise(FORWARD_CLIENT_REMOVE, args, 3);
	}
}

/**
 * A client the engine's SV_DropClient is taking off the server - a kick, a
 * timeout, a quit - with the reason it gives: the one place the reason is
 * known. The module's hook of it is outside AMX Mod X's, so a Pawn plugin's
 * client_disconnected comes first, inside; the game's ClientDisconnect,
 * which SV_DropClient calls for a client in the game, is where the module
 * raises its own, and its client_remove comes once SV_DropClient returns,
 * after AMX Mod X's. A client that was not in the game yet hears both then.
 * `id` is 0 until known: plain HLDS's hook sees only the engine's client.
 */
struct Drop {
	int         id;
	const char *reason;
	bool        heard;
	Drop       *outer;
};

static Drop *g_drop = NULL;

/** A client SV_DropClient has let go and whose ClientDisconnect did not come: its edict no longer has a user id. */
static int Gone()
{
	for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++)
		if (g_connected[id] && GETPLAYERUSERID(INDEXENT(id)) == -1)
			return id;
	return 0;
}

static void Dropped(Drop &d)
{
	g_drop = d.outer;
	int id = d.id ? d.id : Gone();
	if (!id)
		return;
	if (!d.heard && g_connected[id])
		Disconnected(id, true, d.reason);
	Removed(id, true, d.reason);
}

// ReHLDS: SV_DropClient's hookchain, ahead of AMX Mod X's hook in it.

static void DropClient_RH(IRehldsHook_SV_DropClient *chain, IGameClient *client, bool crash, const char *reason)
{
	Drop d = { ClientId(client->GetEdict()), reason, false, g_drop };
	g_drop = &d;
	chain->callNext(client, crash, reason);
	Dropped(d);
}

/** The engine's ReHLDS API, or NULL on plain HLDS or a ReHLDS too old for it. */
static IRehldsApi *FindRehlds()
{
#ifdef _WIN32
	HMODULE engine = GetModuleHandleA("swds.dll");
	CreateInterfaceFn create = engine ? (CreateInterfaceFn)GetProcAddress(engine, CREATEINTERFACE_PROCNAME) : NULL;
#else
	void *engine = dlopen("engine_i486.so", RTLD_NOW | RTLD_NOLOAD);
	CreateInterfaceFn create = engine ? (CreateInterfaceFn)dlsym(engine, CREATEINTERFACE_PROCNAME) : NULL;
	if (engine)
		dlclose(engine);
#endif
	IRehldsApi *api = create ? (IRehldsApi *)create(VREHLDS_HLDS_API_VERSION, NULL) : NULL;
	if (!api || api->GetMajorVersion() != REHLDS_API_VERSION_MAJOR || api->GetMinorVersion() < REHLDS_API_VERSION_MINOR)
		return NULL;
	return api;
}

static EntryHook g_dropClient = { NULL, NULL, { 0 }, { 0 }, false };

typedef void (*DropClientFn)(void *client, int crash, const char *format, ...);

// void SV_DropClient(client_t *cl, qboolean crash, const char *fmt, ...)
static void DropClient_Hooked(void *client, int crash, const char *format, ...)
{
	char reason[1024];
	va_list ap;
	va_start(ap, format);
	vsnprintf(reason, sizeof(reason), format, ap);
	va_end(ap);

	Drop d = { 0, reason, false, g_drop };
	g_drop = &d;
	HookOff(g_dropClient);
	((DropClientFn)g_dropClient.at)(client, crash, "%s", reason);
	HookOn(g_dropClient);
	Dropped(d);
}

/** SV_DropClient's hook: ReHLDS's hookchain, else the gamedata's signature of it. */
static void HookDrops()
{
	g_rehlds = FindRehlds();
	if (g_rehlds) {
		g_rehlds->GetHookchains()->SV_DropClient()->registerHook(DropClient_RH, HC_PRIORITY_DEFAULT + 1);
		return;
	}

	void *address = NULL;
	if (g_entityData && g_entityData->GetMemSig("SV_DropClient", &address) && address) {
		g_dropClient.at = (unsigned char *)address;
		g_dropClient.to = (void *)DropClient_Hooked;
		return;
	}
	MF_PrintSrvConsole("[amxts] SV_DropClient was not found (no ReHLDS, no signature in the gamedata): \"disconnected\" comes without the reason\n");
}

static void UnhookDrops()
{
	if (g_rehlds)
		g_rehlds->GetHookchains()->SV_DropClient()->unregisterHook(DropClient_RH);
	HookOff(g_dropClient);
	g_rehlds = NULL;
}

// ---- cstrike's buying and a bot's commands

#include "cstrike.h"

// ---- the natives the module does itself

/**
 * precache_model, precache_sound and precache_generic: AMX Mod X's refuse
 * outside its own plugin_precache, which comes before the module's precache
 * event. The engine takes a precache only while the map loads, and a late
 * one stops the server, so these refuse outside the event too.
 */
static cell Precache(AMX *amx, cell *params, int (*precache)(char *))
{
	if (!g_precaching) {
		MF_LogError(amx, AMX_ERR_NATIVE, "Precaching not allowed");
		return 0;
	}
	int length = 0;
	const char *path = MF_GetAmxString(amx, params[1], 0, &length);
	return precache((char *)STRING(ALLOC_STRING(path)));
}

static int PrecacheModelNow(char *path) { return PRECACHE_MODEL(path); }
static int PrecacheSoundNow(char *path) { return PRECACHE_SOUND(path); }
static int PrecacheGenericNow(char *path) { return PRECACHE_GENERIC(path); }

static cell AMX_NATIVE_CALL n_precacheModel(AMX *amx, cell *params) { return Precache(amx, params, PrecacheModelNow); }
static cell AMX_NATIVE_CALL n_precacheSound(AMX *amx, cell *params) { return Precache(amx, params, PrecacheSoundNow); }
static cell AMX_NATIVE_CALL n_precacheGeneric(AMX *amx, cell *params) { return Precache(amx, params, PrecacheGenericNow); }

/** The command a cmdStart event is about, while its listeners run. */
static usercmd_t *g_cmd = NULL;

// engine_const.inc's usercmd_* entries.
enum {
	USERCMD_FORWARDMOVE = 1, USERCMD_SIDEMOVE, USERCMD_UPMOVE,
	USERCMD_LERP_MSEC = 6, USERCMD_MSEC, USERCMD_LIGHTLEVEL, USERCMD_BUTTONS, USERCMD_IMPULSE, USERCMD_WEAPONSELECT, USERCMD_IMPACT_INDEX,
	USERCMD_VIEWANGLES = 15, USERCMD_IMPACT_POSITION,
};

/** The floats of an entry: one for a move, three for a vector; NULL for a whole number's. */
static float *CmdFloats(usercmd_t *c, int type, int *count)
{
	*count = type >= USERCMD_VIEWANGLES ? 3 : 1;
	switch (type) {
		case USERCMD_FORWARDMOVE:     return &c->forwardmove;
		case USERCMD_SIDEMOVE:        return &c->sidemove;
		case USERCMD_UPMOVE:          return &c->upmove;
		case USERCMD_VIEWANGLES:      return (float *)&c->viewangles;
		case USERCMD_IMPACT_POSITION: return (float *)&c->impact_position;
		default:                      return NULL;
	}
}

/**
 * get_usercmd(type, ...) and set_usercmd(type, ...) on the command of the
 * cmdStart event that is running: a whole number is returned (get) or read
 * from the second argument (set), a float and a vector go through it. 0
 * outside the event, as the engine module answers outside its forward.
 */
static cell Usercmd(AMX *amx, cell *params, bool set)
{
	if (!g_cmd)
		return 0;
	int type = (int)params[1];
	cell *value = params[0] >= (cell)(2 * sizeof(cell)) ? MF_GetAmxAddr(amx, params[2]) : NULL;
	int count = 0;
	float *floats = CmdFloats(g_cmd, type, &count);
	if (floats) {
		if (!value)
			return 0;
		for (int i = 0; i < count; i++) {
			if (set) memcpy(&floats[i], &value[i], 4);
			else memcpy(&value[i], &floats[i], 4);
		}
		return 1;
	}

	int number = set && value ? (int)*value : 0;
	switch (type) {
		case USERCMD_LERP_MSEC:    if (set) g_cmd->lerp_msec = (short)number; else return g_cmd->lerp_msec; break;
		case USERCMD_MSEC:         if (set) g_cmd->msec = (byte)number; else return g_cmd->msec; break;
		case USERCMD_LIGHTLEVEL:   if (set) g_cmd->lightlevel = (byte)number; else return g_cmd->lightlevel; break;
		case USERCMD_BUTTONS:      if (set) g_cmd->buttons = (unsigned short)number; else return g_cmd->buttons; break;
		case USERCMD_IMPULSE:      if (set) g_cmd->impulse = (byte)number; else return g_cmd->impulse; break;
		case USERCMD_WEAPONSELECT: if (set) g_cmd->weaponselect = (byte)number; else return g_cmd->weaponselect; break;
		case USERCMD_IMPACT_INDEX: if (set) g_cmd->impact_index = number; else return g_cmd->impact_index; break;
		default:                   return 0;
	}
	return 1;
}

static cell AMX_NATIVE_CALL n_getUsercmd(AMX *amx, cell *params) { return Usercmd(amx, params, false); }
static cell AMX_NATIVE_CALL n_setUsercmd(AMX *amx, cell *params) { return Usercmd(amx, params, true); }

/** The key and value the game gives an entity of the map, while the `keyValue` event runs (DispatchKeyValue). */
static KeyValueData *g_keyValue = NULL;

// copy_keyvalue(szClassName[], sizea, szKeyName[], sizeb, szValue[], sizec)
static cell AMX_NATIVE_CALL n_copyKeyvalue(AMX *amx, cell *params)
{
	if (!g_keyValue)
		return 0;
	MF_SetAmxString(amx, params[1], g_keyValue->szClassName ? g_keyValue->szClassName : "", (int)params[2]);
	MF_SetAmxString(amx, params[3], g_keyValue->szKeyName ? g_keyValue->szKeyName : "", (int)params[4]);
	MF_SetAmxString(amx, params[5], g_keyValue->szValue ? g_keyValue->szValue : "", (int)params[6]);
	return 1;
}

/**
 * create_cvar(name, string, flags, ...) and register_cvar(name, string,
 * flags, ...) for a TypeScript plugin: the engine's cvar, made as AMX Mod X
 * makes one, whose natives look for the calling plugin to own it. The cvar
 * lives as long as the process, as the engine keeps it; a name it has
 * already is answered with that cvar. The description and the bounds are
 * AMX Mod X's own and not kept.
 */
static cell AMX_NATIVE_CALL n_createCvar(AMX *amx, cell *params)
{
	int len = 0;
	const char *name = MF_GetAmxString(amx, params[1], 0, &len);
	cvar_t *cvar = name && *name ? CVAR_GET_POINTER(name) : NULL;
	if (!cvar && name && *name) {
		const char *value = MF_GetAmxString(amx, params[2], 1, &len);
		cvar_t *made = new cvar_t();
		made->name = strdup(name);
		made->string = strdup(value ? value : "");
		made->flags = params[0] >= (cell)(3 * sizeof(cell)) ? (int)params[3] : 0;
		made->value = (float)atof(made->string);
		CVAR_REGISTER(made);
		cvar = CVAR_GET_POINTER(name);
	}
	return (cell)(size_t)cvar;
}

/**
 * Natives of the image's table the module does itself, in place of the
 * module that registers them: what they work on is the module's event now,
 * or AMX Mod X's own looks for the calling plugin (FindNative). `original`,
 * when there is one, gets the native it stands in for.
 */
struct OwnNativeInfo {
	const char *name;
	AMX_NATIVE  own;
	AMX_NATIVE *original;
};

static const OwnNativeInfo g_ownNatives[] = {
	{ "precache_model",   n_precacheModel,   NULL },
	{ "precache_sound",   n_precacheSound,   NULL },
	{ "precache_generic", n_precacheGeneric, NULL },
	{ "get_usercmd",      n_getUsercmd,      NULL },
	{ "set_usercmd",      n_setUsercmd,      NULL },
	{ "copy_keyvalue",    n_copyKeyvalue,    NULL },
	{ "read_logdata",     n_readLogdata,     NULL },
	{ "read_logargc",     n_readLogargc,     NULL },
	{ "read_logargv",     n_readLogargv,     NULL },
	{ "create_cvar",      n_createCvar,      NULL },
	{ "register_cvar",    n_createCvar,      NULL },
	{ "register_menucmd", n_registerMenucmd, NULL },
	{ "show_menu",        n_showMenu,        &g_showMenu },
	{ "get_func_id",         n_getFuncId,         NULL },
	{ "callfunc_begin_i",    n_callfuncBeginI,    &g_callfuncBeginI },
	{ "callfunc_push_int",   n_callfuncPushInt,   &g_callfuncPushInt },
	{ "callfunc_push_float", n_callfuncPushInt,   NULL },
	{ "callfunc_push_str",   n_callfuncPushStr,   &g_callfuncPushStr },
	{ "callfunc_push_array", n_callfuncPushArray, &g_callfuncPushArray },
	{ "callfunc_end",        n_callfuncEnd,       &g_callfuncEnd },
};

static AMX_NATIVE OwnNative(const char *name, AMX_NATIVE fn)
{
	for (const OwnNativeInfo &own : g_ownNatives) {
		if (strcmp(own.name, name))
			continue;
		if (own.original)
			*own.original = fn;
		return own.original && !fn ? NULL : own.own;
	}
	return fn;
}

// ---- Metamod's hooks

// Metamod-R's call of a hook with a variable list of arguments does not keep
// the stack aligned as GCC's i386 code expects, which AddressSanitizer's
// frames are laid out by: the hook aligns it itself.
#ifdef _WIN32
#define ALIGNED_ENTRY
#else
#define ALIGNED_ENTRY __attribute__((force_align_arg_pointer))
#endif

static ALIGNED_ENTRY void AlertMessage(ALERT_TYPE type, const char *format, ...);

/**
 * An entity's spawn: the world's, the first of a map's, after the plugins
 * have loaded (amxts_natives), is when they precache; then `entitySpawn`.
 * The engine module, after the module in Metamod's list, hears it after it,
 * as it hears an entity's think, key and played event.
 */
int DispatchSpawn(edict_t *e)
{
	if (!g_precached) {
		g_precached = true;
		g_precaching = true;
		Raise(FORWARD_PLUGIN_PRECACHE);
		g_precaching = false;
	}
	// Blocked, the entity is not spawned, and the engine frees it.
	if (RaiseFor(FORWARD_PFN_SPAWN, ENTINDEX(e)) > 0)
		RETURN_META_VALUE(MRES_SUPERCEDE, -1);
	RETURN_META_VALUE(MRES_IGNORED, 0);
}

/**
 * The map has loaded: plugin_init, plugin_cfg and OnAutoConfigsBuffered, as
 * AMX Mod X fires them in its post before this; its configs are queued, not
 * run, so they run after all three. AMX Mod X's task tick starts here.
 */
void ServerActivate_Post(edict_t *edicts, int count, int clients)
{
	if (g_activated)
		RETURN_META(MRES_IGNORED);
	g_activated = true;
	HookOn(g_dropClient);
	HookOn(g_cvarSet);
	// Metamod gives the module its tables after AMX Mod X attached it, on some builds.
	if (g_pengfuncsTable)
		g_pengfuncsTable->pfnAlertMessage = AlertMessage;
	MessageHooks(g_messagesHooked > 0);

	g_configTick = gpGlobals->time;
	g_configsDue = gpGlobals->time + 6.1f;
	g_configTicks = 0;

	if (g_image)
		StartServer();
	Raise(FORWARD_PLUGIN_CFG);
	Raise(FORWARD_ONAUTOCONFIGSBUFFERED);
	RETURN_META(MRES_IGNORED);
}

/** The map ends: every client leaves it, as AMX Mod X tells its plugins, then plugin_end. */
void ServerDeactivate()
{
	if (!g_activated)
		RETURN_META(MRES_IGNORED);

	for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++) {
		if (g_connected[id])
			Disconnected(id, false, "");
		if (g_inGame[id])
			Removed(id, false, "");
		g_connected[id] = g_inGame[id] = false;
	}

	g_authorized.clear();
	g_activated = false;
	g_precached = false;
	HookOff(g_dropClient);
	HookOff(g_cvarSet);
	SettleCstrike(false);
	Raise(FORWARD_PLUGIN_END);
	RETURN_META(MRES_IGNORED);
}

/** client_connectex: the place to turn a client away, unless a Pawn plugin did. */
BOOL ClientConnect(edict_t *e, const char *name, const char *address, char reason[128])
{
	int id = ClientId(e);
	if (!id || META_RESULT_STATUS >= MRES_SUPERCEDE || !Heard(FORWARD_CLIENT_CONNECTEX))
		RETURN_META_VALUE(MRES_IGNORED, TRUE);

	ImageHeap heap;
	cell args[4] = { id, PushString(name), PushString(address), PushString(reason) };
	if (Raise(FORWARD_CLIENT_CONNECTEX, args, 4) > 0)
		RETURN_META_VALUE(MRES_SUPERCEDE, FALSE);
	RETURN_META_VALUE(MRES_IGNORED, TRUE);
}

/** client_connect for a client that is not a bot (a bot's comes with its info), then client_authorized if AMX Mod X fired it. */
BOOL ClientConnect_Post(edict_t *e, const char *name, const char *address, char reason[128])
{
	int id = ClientId(e);
	if (id && !MF_IsPlayerBot(id))
		Connected(id);
	RaiseAuthorized();
	RETURN_META_VALUE(MRES_IGNORED, TRUE);
}

void ClientPutInServer_Post(edict_t *e)
{
	int id = ClientId(e);
	if (id && !MF_IsPlayerBot(id))
		PutInServer(id);
	RETURN_META(MRES_IGNORED);
}

/**
 * client_infochanged; for a bot not in the game yet, its connect,
 * authorized and putinserver too, as AMX Mod X makes them up for a bot here.
 */
void ClientUserInfoChanged_Post(edict_t *e, char *info)
{
	int id = ClientId(e);
	if (!id)
		RETURN_META(MRES_IGNORED);

	NameChanges(id, 1);
	RaiseFor(FORWARD_CLIENT_INFOCHANGED, id);
	if (!g_inGame[id] && MF_IsPlayerBot(id)) {
		Connected(id);
		RaiseAuthorized();
		PutInServer(id);
	}
	RETURN_META(MRES_IGNORED);
}

/** The game's ClientDisconnect: SV_DropClient's own call (Drop), or a client leaving another way. */
void ClientDisconnect(edict_t *e)
{
	int id = ClientId(e);
	if (!id)
		RETURN_META(MRES_IGNORED);

	Drop *d = g_drop;
	if (d && !d->heard && (!d->id || d->id == id)) {
		d->id = id;
		d->heard = true;
		if (g_connected[id])
			Disconnected(id, true, d->reason);
		RETURN_META(MRES_IGNORED);
	}

	if (g_connected[id])
		Disconnected(id, false, "");
	Removed(id, false, "");
	RETURN_META(MRES_IGNORED);
}

/** client_kill, unless a Pawn plugin blocked it: the status a post sees is the pre's. */
void ClientKill_Post(edict_t *e)
{
	int id = ClientId(e);
	if (id && META_RESULT_STATUS < MRES_SUPERCEDE)
		RaiseFor(FORWARD_CLIENT_KILL, id);
	RETURN_META(MRES_IGNORED);
}

/**
 * client_impulse, unless a Pawn plugin took the impulse (it is 0 then), and
 * client_cmdStart. The game takes the command's impulse and moves the player
 * after CmdStart, so a listener still changes them.
 */
void CmdStart_Post(const edict_t *player, const struct usercmd_s *cmd, unsigned int seed)
{
	// Every player's every frame: what nobody listens to costs these checks.
	bool impulse = cmd->impulse && Heard(FORWARD_CLIENT_IMPULSE);
	int id = impulse || Heard(FORWARD_CLIENT_CMDSTART) ? ClientId(player) : 0;
	if (!id)
		RETURN_META(MRES_IGNORED);

	usercmd_t *outer = g_cmd;
	g_cmd = (usercmd_t *)cmd;
	if (impulse) {
		cell args[2] = { id, g_cmd->impulse };
		if (Raise(FORWARD_CLIENT_IMPULSE, args, 2) > 0)
			g_cmd->impulse = 0;
	}
	RaiseFor(FORWARD_CLIENT_CMDSTART, id);
	g_cmd = outer;
	RETURN_META(MRES_IGNORED);
}

/** server_changelevel: the map the game changes to, unless a Pawn plugin stopped it. */
void ChangeLevel(const char *map, const char *landmark)
{
	if (META_RESULT_STATUS >= MRES_SUPERCEDE || !Heard(FORWARD_SERVER_CHANGELEVEL))
		RETURN_META(MRES_IGNORED);

	ImageHeap heap;
	cell args[1] = { PushString(map) };
	if (Raise(FORWARD_SERVER_CHANGELEVEL, args, 1) > 0)
		RETURN_META(MRES_SUPERCEDE);
	RETURN_META(MRES_IGNORED);
}

/**
 * A line of the game's log: the log events that take it, as AMX Mod X walks
 * its own before its plugin_log, then the `log` event, unless a Pawn
 * plugin's plugin_log blocked the line; handled() there keeps it out of the
 * log. read_logdata, read_logargc and read_logargv read it while they run.
 */
static ALIGNED_ENTRY void AlertMessage(ALERT_TYPE type, const char *format, ...)
{
	if (type != at_logged || (!g_logHooked && !Heard(FORWARD_PLUGIN_LOG)))
		RETURN_META(MRES_IGNORED);

	char text[1024];
	va_list ap;
	va_start(ap, format);
	vsnprintf(text, sizeof(text), format, ap);
	va_end(ap);

	LogLine line;
	line.text = text;
	if (!line.text.empty() && line.text[line.text.size() - 1] == '\n')
		line.text.erase(line.text.size() - 1);
	SplitLog(line);

	LogLine *outer = g_log;
	g_log = &line;
	HearLog(line);
	cell blocked = META_RESULT_STATUS < MRES_SUPERCEDE && Heard(FORWARD_PLUGIN_LOG) ? Raise(FORWARD_PLUGIN_LOG, NULL, 0) : 0;
	g_log = outer;
	RETURN_META(blocked > 0 ? MRES_SUPERCEDE : MRES_IGNORED);
}

/** entityThink: blocked, the entity does not think this time. */
void DispatchThink(edict_t *e)
{
	if (RaiseFor(FORWARD_PFN_THINK, ENTINDEX(e)) > 0)
		RETURN_META(MRES_SUPERCEDE);
	RETURN_META(MRES_IGNORED);
}

/** keyValue: a key of an entity of the map, which copy_keyvalue reads; blocked, the entity does not get it. */
void DispatchKeyValue(edict_t *e, KeyValueData *kvd)
{
	if (!Heard(FORWARD_PFN_KEYVALUE) || !kvd)
		RETURN_META(MRES_IGNORED);
	KeyValueData *outer = g_keyValue;
	g_keyValue = kvd;
	cell blocked = RaiseFor(FORWARD_PFN_KEYVALUE, ENTINDEX(e));
	g_keyValue = outer;
	RETURN_META(blocked > 0 ? MRES_SUPERCEDE : MRES_IGNORED);
}

/** A vector onto the image's heap, three cells and a zero after them; 0 for none. */
static cell PushVector(const float *v)
{
	cell addr = 0;
	cell *cells = HeapCells(4, &addr);
	if (!cells)
		return 0;
	static const float zero[3] = { 0, 0, 0 };
	memcpy(cells, v ? v : zero, 3 * sizeof(cell));
	cells[3] = 0;
	return addr;
}

/** playbackEvent: an event the engine plays to the clients - every shot - so what nobody hears costs a check. */
void PlaybackEvent(int flags, const edict_t *invoker, unsigned short index, float delay, float *origin, float *angles,
                   float f1, float f2, int i1, int i2, int b1, int b2)
{
	if (!Heard(FORWARD_PFN_PLAYBACKEVENT))
		RETURN_META(MRES_IGNORED);
	ImageHeap heap;
	cell args[12] = { flags, invoker ? (cell)ENTINDEX(invoker) : 0, index, 0, PushVector(origin), PushVector(angles), 0, 0, i1, i2, b1, b2 };
	memcpy(&args[3], &delay, sizeof(cell));
	memcpy(&args[6], &f1, sizeof(cell));
	memcpy(&args[7], &f2, sizeof(cell));
	if (Raise(FORWARD_PFN_PLAYBACKEVENT, args, 12) > 0)
		RETURN_META(MRES_SUPERCEDE);
	RETURN_META(MRES_IGNORED);
}

/**
 * inconsistentFile: a client's file differs from the server's, and the game
 * would kick him - AMX Mod X, ahead in Metamod's list, has asked the game and
 * its own plugins already, and answers for them. Blocked, he stays.
 */
int InconsistentFile(const edict_t *player, const char *file, char *reason)
{
	int id = ClientId(player);
	if (!id || !Heard(FORWARD_INCONSISTENT_FILE) || META_RESULT_STATUS < MRES_SUPERCEDE || !META_RESULT_OVERRIDE_RET(int))
		RETURN_META_VALUE(MRES_IGNORED, 0);
	ImageHeap heap;
	cell args[3] = { id, PushString(file ? file : ""), PushString(reason ? reason : "") };
	if (Raise(FORWARD_INCONSISTENT_FILE, args, 3) > 0)
		RETURN_META_VALUE(MRES_SUPERCEDE, FALSE);
	RETURN_META_VALUE(MRES_IGNORED, 0);
}

/**
 * VTC_OnClientStartSpeak and VTC_OnClientStopSpeak: VoiceTranscoder tells
 * ReAPI alone, so while a plugin subscribes the module asks its
 * VTC_IsClientSpeaking about each player once a frame - a start or a stop is
 * heard on the frame it is seen (g_speaking).
 */
static void PollSpeaking()
{
	if (!Heard(FORWARD_VTC_ONCLIENTSTARTSPEAK) && !Heard(FORWARD_VTC_ONCLIENTSTOPSPEAK))
		return;
	for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++) {
		cell params[2] = { sizeof(cell), id };
		bool speaking = g_inGame[id] && CallNative("VTC_IsClientSpeaking", params) != 0;
		if (speaking == g_speaking[id])
			continue;
		g_speaking[id] = speaking;
		RaiseFor(speaking ? FORWARD_VTC_ONCLIENTSTARTSPEAK : FORWARD_VTC_ONCLIENTSTOPSPEAK, id);
	}
}

/**
 * A key of player `id`'s menu (g_menus) that `menuselect` presses, 0 for 1
 * and 9 for 0; -1 for none. A key the menu takes closes it, as the client
 * hides it, whoever takes the key; another leaves it open, as AMX Mod X does.
 */
static int MenuKey(int id, ShownMenu &menu)
{
	if (!g_menus[id].keys || strcmp(CMD_ARGV(0), "menuselect"))
		return -1;
	int key = atoi(CMD_ARGV(1)) - 1;
	if (key < 0 || key > 9 || !(g_menus[id].keys & (1 << key)))
		return -1;
	menu = g_menus[id];
	CloseMenu(id);
	return key;
}

/**
 * A player's command, after AMX Mod X's: the `command` event, the plugins'
 * commands of its name, then a key of the menu a plugin shows him - unless a
 * Pawn plugin took it, in client_command, a register_clcmd handler or a menu
 * of its own. `say` and `say_team` are commands like any other; the facade
 * reads the chat line.
 */
void ClientCommand(edict_t *e)
{
	InCommand dispatch;
	int id = ClientId(e);
	if (!id)
		RETURN_META(MRES_IGNORED);
	ShownMenu menu;
	int key = MenuKey(id, menu);
	if (META_RESULT_STATUS >= MRES_SUPERCEDE)
		RETURN_META(MRES_IGNORED);
	if (RaiseFor(FORWARD_CLIENT_COMMAND, id) > 0)
		RETURN_META(MRES_SUPERCEDE);

	if (!g_clientCommands.empty()) {
		std::map<std::string, Forward>::iterator it = g_clientCommands.find(Lower(CMD_ARGV(0)));
		if (it != g_clientCommands.end() && RunCommand(it->second, id))
			RETURN_META(MRES_SUPERCEDE);
	}
	if (key < 0)
		RETURN_META(MRES_IGNORED);
	uint32_t argv[MAX_EVENT_ARGS] = { (uint32_t)id, (uint32_t)key, 0, 0 };
	Fire(menu, argv, MAX_EVENT_ARGS, 0);
	RETURN_META(MRES_SUPERCEDE);
}

/**
 * A line a bot sends, as a client's command comes in from the network: the
 * engine splits it and the game's ClientCommand is called through Metamod's
 * table, so AMX Mod X, the module and the game hear it in their order.
 * ReHLDS gives both through its API; plain HLDS on Linux has them in its
 * file's symbol table (EngineSymbol).
 * NULL where neither is found (plain HLDS on Windows).
 */
typedef void (*TokenizeFn)(char *line);
static TokenizeFn     g_tokenize = NULL;
static DLL_FUNCTIONS *g_entityApi = NULL;

#ifndef _WIN32
/**
 * The address of a symbol of the engine's own table (.symtab): plain HLDS
 * keeps Cmd_TokenizeString and gEntityInterface local, so dlsym does not see
 * them. The file is the one the engine's functions were loaded from, the
 * address its load base plus the symbol's value. NULL when it is not there.
 */
static void *EngineSymbol(const char *name)
{
	Dl_info info;
	if (!dladdr((void *)g_engfuncs.pfnPrecacheModel, &info) || !info.dli_fname)
		return NULL;
	FILE *f = fopen(info.dli_fname, "rb");
	if (!f)
		return NULL;
	std::vector<char> file;
	fseek(f, 0, SEEK_END);
	file.resize((size_t)ftell(f));
	fseek(f, 0, SEEK_SET);
	bool read = !file.empty() && fread(&file[0], 1, file.size(), f) == file.size();
	fclose(f);
	if (!read || file.size() < sizeof(Elf32_Ehdr))
		return NULL;

	const Elf32_Ehdr *header = (const Elf32_Ehdr *)&file[0];
	if (header->e_shoff + (size_t)header->e_shnum * sizeof(Elf32_Shdr) > file.size())
		return NULL;
	const Elf32_Shdr *sections = (const Elf32_Shdr *)&file[header->e_shoff];
	for (int i = 0; i < header->e_shnum; i++) {
		if (sections[i].sh_type != SHT_SYMTAB || sections[i].sh_link >= header->e_shnum)
			continue;
		const Elf32_Shdr &strings = sections[sections[i].sh_link];
		size_t count = sections[i].sh_size / sizeof(Elf32_Sym);
		if (sections[i].sh_offset + sections[i].sh_size > file.size() || strings.sh_offset + strings.sh_size > file.size())
			return NULL;
		const Elf32_Sym *symbols = (const Elf32_Sym *)&file[sections[i].sh_offset];
		for (size_t k = 0; k < count; k++)
			if (symbols[k].st_name < strings.sh_size && !strcmp(&file[strings.sh_offset + symbols[k].st_name], name))
				return (char *)info.dli_fbase + symbols[k].st_value;
	}
	return NULL;
}
#endif

static bool FindClientCommandPath()
{
	if (g_rehlds) {
		g_tokenize = g_rehlds->GetFuncs()->TokenizeString;
		g_entityApi = g_rehlds->GetFuncs()->GetEntityInterface();
	}
#ifndef _WIN32
	else {
		g_tokenize = (TokenizeFn)EngineSymbol("Cmd_TokenizeString");
		g_entityApi = (DLL_FUNCTIONS *)EngineSymbol("gEntityInterface");
	}
#endif
	return g_tokenize && g_entityApi;
}

/** The lowest address of this thread's stack, as far as it is reserved; 0 when it cannot be told. */
static const char *StackLow()
{
#ifdef _WIN32
	return (const char *)((NT_TIB *)NtCurrentTeb())->StackLimit;
#else
	static const char *low = NULL;
	pthread_attr_t attr;
	if (!low && pthread_getattr_np(pthread_self(), &attr) == 0) {
		void *at = NULL;
		size_t size = 0;
		pthread_attr_getstack(&attr, &at, &size);
		pthread_attr_destroy(&attr);
		low = (const char *)at;
	}
	return low;
#endif
}

// The top of the frame of the function it is written in: its locals lie below.
#ifdef _MSC_VER
#define FRAME_TOP() ((const char *)_AddressOfReturnAddress())
#else
#define FRAME_TOP() ((const char *)__builtin_frame_address(0))
#endif

// bot_cmd(id, line) - the bot sends `line`.
static void w_botCmd(wasm_exec_env_t env, int32_t id, int32_t line)
{
	if (id < 1 || id > gpGlobals->maxClients)
		return;
	if (!g_tokenize || !g_entityApi) {
		static bool said = false;
		if (!said)
			MF_PrintSrvConsole("[amxts] a bot's command is not sent on this server: it needs ReHLDS, or HLDS on Linux\n");
		said = true;
		return;
	}

	// The line being run - a command whose handler sends this - is put back
	// after, for whatever reads it next. The engine's Cmd_Args points into
	// the line it split until it splits another, so the line put back lives
	// on: one a depth, for a bot's command sent while another is handled
	// (a deque, whose strings stay where they are as it grows).
	// The engine's Cmd_Args is NULL for a command with no argument.
	// Outside a command's dispatch the engine's line is whatever was split
	// last, by anyone, and inside one a game or bot's code may have split a
	// line of its own on the stack since: Cmd_Args then points into a frame
	// that has returned - at or below this one - and the line is not read.
	// An empty line goes back instead.
	static std::deque<std::string> restored;
	static size_t depth = 0;
	const char *args = g_commandDepth > 0 && CMD_ARGC() > 0 ? CMD_ARGS() : NULL;
	bool gone = args && args >= StackLow() && args < FRAME_TOP();
	std::string outer = g_commandDepth > 0 && CMD_ARGC() > 0 && !gone ? std::string(CMD_ARGV(0)) + " " + (args ? args : "") : "";
	std::string text = AsString(Inst(env), line);
	g_tokenize(&text[0]);
	depth++;
	g_entityApi->pfnClientCommand(INDEXENT(id));
	depth--;
	if (restored.size() <= depth)
		restored.resize(depth + 1);
	restored[depth].swap(outer);
	g_tokenize(&restored[depth][0]);
}

// ---------------------------------------------------------------- the frame

/**
 * Metamod's StartFrame, after the game's: once a server frame. What came in
 * since the last frame goes to the plugins first - the clients AMX Mod X's
 * 0.7 s check authorized, the names that changed, the responses - then the
 * timers that are due, AMX Mod X's task tick for the configs, then the
 * frame's listeners.
 * The watcher last, since a reload throws the instances away.
 */
void StartFrame_Post()
{
	RaiseAuthorized();
	if (g_namesChanging)
		NamesChanged();
	NetFrame();
	RunTimers();
	ConfigTick();
	CompareCvars();
	PollSpeaking();
	SettleCstrike(g_activated);

	Forward &f = g_forwards[FORWARD_SERVER_FRAME];
	if (!f.handlers.empty() || !f.subscribers.empty()) {
		CallArgs context(NULL, 0, NULL);
		Dispatch(f, NULL, 0);
	}

	// Every tenth of a second, from plugin_init on, as the module's commands.
	if (g_amxxReady && gpGlobals->time >= g_nextWatch) {
		g_nextWatch = gpGlobals->time + 0.1f;
		WatchPlugins();
	}

	RETURN_META(MRES_IGNORED);
}

// ---------------------------------------------------------------- player fields for Pawn
//
// The fields plugins add to Player, by name (docs/api/players.md). A number field is
// read whole by amxts_get_player_data and as a Float by the _float pair; a
// boolean is 1 or 0; a text field has the _string pair. The other kind, or a
// field never written, reads 0 or "".

/** The key argument: a field name, as the plugin wrote it. */
static std::string PawnKey(AMX *amx, cell addr)
{
	int len = 0;
	const char *key = MF_GetAmxString(amx, addr, 0, &len);
	return key ? key : "";
}

// amxts_get_player_data(id, const key[])
static cell AMX_NATIVE_CALL n_getPlayerData(AMX *amx, cell *params)
{
	double value = PlayerNumber((int)params[1], PawnKey(amx, params[2]));
	if (!(value > -2147483648.0 && value < 2147483648.0))
		return 0;
	return (cell)value;
}

// amxts_set_player_data(id, const key[], value)
static cell AMX_NATIVE_CALL n_setPlayerData(AMX *amx, cell *params)
{
	SetPlayerNumber((int)params[1], PawnKey(amx, params[2]), (double)params[3]);
	return 1;
}

// Float:amxts_get_player_data_float(id, const key[])
static cell AMX_NATIVE_CALL n_getPlayerDataFloat(AMX *amx, cell *params)
{
	float value = (float)PlayerNumber((int)params[1], PawnKey(amx, params[2]));
	cell bits;
	memcpy(&bits, &value, sizeof(bits));
	return bits;
}

// amxts_set_player_data_float(id, const key[], Float:value)
static cell AMX_NATIVE_CALL n_setPlayerDataFloat(AMX *amx, cell *params)
{
	float value;
	memcpy(&value, &params[3], sizeof(value));
	SetPlayerNumber((int)params[1], PawnKey(amx, params[2]), (double)value);
	return 1;
}

// amxts_get_player_data_string(id, const key[], out[], len) - the bytes written
static cell AMX_NATIVE_CALL n_getPlayerDataString(AMX *amx, cell *params)
{
	std::string text = PlayerText((int)params[1], PawnKey(amx, params[2]));
	int max = (int)params[4];
	if (max < 0)
		max = 0;

	// Half of a Cyrillic letter is not a character: cut before the one that
	// does not fit.
	if ((int)text.size() > max) {
		int cut = max;
		while (cut > 0 && ((unsigned char)text[cut] & 0xC0) == 0x80)
			cut--;
		text.resize(cut);
	}
	return MF_SetAmxString(amx, params[3], text.c_str(), max);
}

// amxts_set_player_data_string(id, const key[], const value[])
static cell AMX_NATIVE_CALL n_setPlayerDataString(AMX *amx, cell *params)
{
	int len = 0;
	const char *value = MF_GetAmxString(amx, params[3], 1, &len);
	SetPlayerText((int)params[1], PawnKey(amx, params[2]), value ? value : "");
	return 1;
}

AMX_NATIVE_INFO g_natives[] = {
	{ "amxts_get_player_data",        n_getPlayerData       },
	{ "amxts_set_player_data",        n_setPlayerData       },
	{ "amxts_get_player_data_float",  n_getPlayerDataFloat  },
	{ "amxts_set_player_data_float",  n_setPlayerDataFloat  },
	{ "amxts_get_player_data_string", n_getPlayerDataString },
	{ "amxts_set_player_data_string", n_setPlayerDataString },
	{ NULL, NULL }
};

void OnAmxxAttach()
{
	RuntimeInitArgs init;
	memset(&init, 0, sizeof(init));
	init.mem_alloc_type = Alloc_With_Allocator;
	init.mem_alloc_option.allocator.malloc_func = (void *)malloc;
	init.mem_alloc_option.allocator.realloc_func = (void *)realloc;
	init.mem_alloc_option.allocator.free_func = (void *)free;
	init.native_module_name = "env";
	init.native_symbols = g_wasmNatives;
	init.n_native_symbols = sizeof(g_wasmNatives) / sizeof(g_wasmNatives[0]);

	if (!wasm_runtime_full_init(&init)) {
		MF_PrintSrvConsole("[amxts] wasm runtime failed to start\n");
		return;
	}

	if (!wasm_runtime_register_natives("env", g_generatedNatives,
			sizeof(g_generatedNatives) / sizeof(g_generatedNatives[0])))
		MF_PrintSrvConsole("[amxts] generated natives failed to register\n");

	MF_AddNatives(g_natives);
	MF_AddNatives(g_exportedList);
	if (g_pengfuncsTable)
		g_pengfuncsTable->pfnAlertMessage = AlertMessage;
	MessageHooks(false);
	MF_RegAuthFunc(OnAuthorized);
	FieldsAttach();
	HookDrops();
	FindChains();
	FindCvarSet();
	FindCstrike();
	FindClientCommandPath();
	ReadListFile();

	// The first map: the plugins load now, before AMX Mod X loads the Pawn
	// plugins (StartMap).
	LoadImage();
	StartMap();
	g_mapStarted = true;
}

/**
 * Every Pawn plugin has loaded and its natives are bound. The image is
 * loaded again - twice, for the modules its first load had AMX Mod X load -
 * and has every native now: the modules', the core's, the Pawn plugins'. On
 * a map after the first the plugins load here, before precache.
 */
void OnPluginsLoaded()
{
	if (!g_mapStarted)
		Teardown();
	LoadImage();
	LoadImage();
	g_imageComplete = g_image != NULL;
	FindPlugins();
	InterposeNatives();
	if (!g_mapStarted)
		StartMap();
	g_mapStarted = false;
}

/** The map is over: AMX Mod X has let its plugins go. */
void OnPluginsUnloaded()
{
	Teardown();
}

void OnAmxxDetach()
{
	MF_UnregAuthFunc(OnAuthorized);
	ForgetCstrike();
	UnhookCvars();
	UnhookDrops();
	FieldsDetach();
	Teardown();
	// The worker stops before WAMR goes; its requests are deleted with it.
	NetShutdown();
	wasm_runtime_destroy();
}
