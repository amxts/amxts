// amxts runtime — AssemblyScript compiled to WebAssembly, run AOT inside an
// AMX Mod X module.
//
// The idea is unchanged from the QuickJS runtime this replaces: instead of a
// binding per native, resolve natives by name in the host plugin's native
// table. The host plugin is generated and holds no logic — it only pulls
// natives into its table, relays AMXX forwards, and keeps a pool of publics
// for plugin callbacks. The module carries it and has AMX Mod X load it
// (InstallHost), so a server installs the module alone.
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
#include "wasm_export.h"

// The Half-Life SDK's min and max macros break the C++ library's headers.
#undef min
#undef max

#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#else
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/wait.h>
#include <unistd.h>
#endif
#include <string>
#include <vector>
#include <deque>
#include <map>
#include <unordered_map>
#include <algorithm>

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

// Must match CALLBACK_SLOTS in scripts/generate-host.ts, which writes one
// public per slot. 128 was enough until a plugin registered a menu piece per
// section, a command per cvar and a task per player: the port ran out during
// plugin_init and the menus it had not reached simply were not there.
#define MAX_CALLBACK_SLOTS 512
#define MAX_CALLBACK_ARGS  8    // must match amxts_callback's arity in scripts/generate-host.ts

static AMX *g_host = NULL;      // host plugin's AMX: natives are resolved from it

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
	// What plugin() declared, for the listing. AMX Mod X has one entry per
	// .amxx file and every plugin here shares the host's, so this is the only
	// place their names exist.
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

// Set on what w_slot returns when the slot is one the plugin already had
// before a reload, and the AMXX-side registration with it. A slot number is
// 0..MAX_CALLBACK_SLOTS-1, so this bit is free. The facade declares the same
// value; it is the difference between "here is your public" and "your public
// is already registered, do not register it twice".
// A bit above every slot number, so it cannot be mistaken for one. It used to
// be 0x100, which put a ceiling of 256 slots on the whole thing and would
// have been a quiet collision rather than a loud one.
#define SLOT_REUSED 0x10000

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
	 * What Fire calls, looked up once, when the handler is registered (Bind):
	 * the function, the kinds of its parameters, and whether every one is an
	 * i32 and takes its cell as it is. NULL when the plugin exports no table;
	 * Fire then calls it by its index.
	 */
	wasm_function_inst_t func = NULL;
	uint32_t       count = 0;
	bool           cells = false;
	wasm_valkind_t kinds[MAX_EVENT_ARGS + 1];
};

/** Looks up what Fire calls for `h` (Handler.func): once, as its plugin registers it. */
static void Bind(Handler &h)
{
	h.func = NULL;
	if (h.plugin < 0 || (size_t)h.plugin >= g_plugins.size())
		return;
	Plugin &p = g_plugins[h.plugin];
	if (!p.inst || !p.hasTable)
		return;

	wasm_function_inst_t func = wasm_table_get_func_inst(p.inst, &p.table, h.fn);
	// More parameters than Fire passes: called by its index, it traps on its type.
	if (!func || wasm_func_get_param_count(func, p.inst) > (uint32_t)(MAX_EVENT_ARGS + 1))
		return;

	h.count = wasm_func_get_param_count(func, p.inst);
	wasm_func_get_param_types(func, p.inst, h.kinds);
	h.cells = true;
	for (uint32_t i = 0; i < h.count; i++)
		h.cells = h.cells && h.kinds[i] == WASM_I32;
	h.func = func;
}

/**
 * Forward.subscribe(): a TypeScript plugin listening to a forward by name.
 *
 * The handler is the facade's trampoline, called with the tag alone: it says
 * which Forward object of that plugin it is for - a trampoline cannot capture
 * its Forward - and the Forward reads the arguments, as many as there are,
 * from the call's context (CallArgs): a number as it is, a string or an array
 * where it lies in the AMX that carries it. Reached two ways: n_event, when
 * the forward is one the host plugin has a public for (a Pawn plugin fired it,
 * or anyone did through AMX Mod X), and emit_local, when a TypeScript plugin
 * fired one it has no public for.
 */
struct Subscription {
	Handler handler;
	int32_t tag;
};

/**
 * The listeners of one forward the host relays: its handlers (on) and its
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

// g_forwardNames and FORWARD_*: the forwards the host relays, by the number
// its publics hand amxts_event.
#include "forwards.h"

static Forward g_forwards[FORWARD_COUNT];

// The subscribers of the forwards the host has no public for, which only
// emit_local delivers.
static std::map<std::string, std::vector<Subscription> > g_subscriptions;

// A callback slot is one public in the host plugin (__amxts_cb0 .. __amxts_cb511).
// AMXX natives take a callback as the name of a public, so registering one
// means parking the wasm function here and passing the public's name along.
// The handler's fields are the slot's: its plugin, or one of the SLOT_*
// owners below for the module's own.
struct Slot : Handler {
	bool     used;
	/**
	 * What the caller gets when the handler says nothing.
	 *
	 * It is not one value for everyone: a command wants PLUGIN_HANDLED, a
	 * reapi hookchain wants HC_CONTINUE - and HC_SUPERCEDE is 1, so answering
	 * PLUGIN_HANDLED to a hookchain blocks the function it hooks. Ham's
	 * HAM_IGNORED is 1 again. So whoever takes the slot says what silence means.
	 */
	cell     fallback;
	// What this slot was registered for: "clcmd:say /hp", "hook:3072". AMX Mod
	// X cannot unregister any of them, so on a reload the plugin takes its own
	// slots back by this key rather than registering a second time.
	std::string key;
	// What the registration returned, for a hookchain handle that has to
	// survive the reload that reuses it.
	cell     handle;
	// The natives that switch the registration off and on by its handle -
	// DisableHookChain and EnableHookChain, DisableHamForward and
	// EnableHamForward - or NULL for one that cannot be. A reload switches it
	// off; the plugin registering it again switches it back on (TakeSlot).
	const char *disable;
	const char *enable;
	/**
	 * Switched off by its plugin while what it delivers has no listener
	 * (w_slotOn): a call answers the fallback without entering the plugin.
	 * For the registrations AMX Mod X cannot switch off - a message, a touch,
	 * a log line, a command.
	 */
	bool     off;
};

// A slot whose plugin is one of these is the module's own: a server command it
// registered for itself, not a plugin's callback. ORPHANED is what a slot
// becomes when the plugin holding it is reloaded away - register_clcmd cannot
// be undone, so the registration outlives the handler and has to land
// somewhere harmless.
#define SLOT_RELOAD   (-2)
#define SLOT_LIST     (-3)
#define SLOT_TRACE   (-7)
#define SLOT_ORPHANED (-6)
#define SLOT_LOAD     (-8)
#define SLOT_UNLOAD   (-9)

static Slot g_slots[MAX_CALLBACK_SLOTS];
static int  g_slotCount = 0;

// The most arguments an exported native reads: AMX Mod X's own limit for a
// dynamic native (CALLFUNC_MAXPARAMS), past which get_param has nothing.
#define MAX_NATIVE_ARGS  64

/**
 * A native a plugin exports for other plugins to call.
 *
 * AMX Mod X implements a native as a public, so exporting one from
 * WebAssembly means telling register_native about the host plugin's one
 * public for all of them, __amxts_native. Which native a call is for is read
 * off the caller (ExportedFor), so there is one entry per name and no limit
 * but memory. The name is kept because register_native cannot be undone: on a
 * reload the same plugin takes its own entry back rather than registering the
 * name twice.
 */
struct Exported : Handler {
	std::string name;
};

static std::vector<Exported> g_exported;
static std::map<std::string, size_t> g_exportedByName;

/** A native of the host's table: its function, and its index there. */
struct Resolved {
	AMX_NATIVE fn;
	int        index;
};

static std::map<std::string, Resolved> g_nativeCache;

/**
 * Which AMX image the resolved natives belong to.
 *
 * AMX Mod X rebuilds the host plugin on every map change, so a pointer
 * harvested from the old image is a call into freed memory. Each thunk keeps
 * its own resolved pointer and compares this number rather than asking again,
 * which is the difference between a call and a std::map lookup keyed by a
 * string: measured on the live server, a thousand calls took 57 microseconds
 * with the lookup.
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

static Resolved FindNative(const char *name)
{
	Resolved none = { NULL, 0 };
	if (!g_host)
		return none;

	std::map<std::string, Resolved>::iterator c = g_nativeCache.find(name);
	if (c != g_nativeCache.end())
		return c->second;

	int count = NativeCount(g_host);
	for (int i = 0; i < count; i++) {
		AMX_NATIVE fn = NULL;
		if (!strcmp(NativeEntry(g_host, i, &fn), name)) {
			Resolved found = { fn, i };
			g_nativeCache[name] = found;
			return found;
		}
	}

	MF_PrintSrvConsole("[amxts] native %s is not in the host plugin table - regenerate amxts_host.sma\n", name);
	g_nativeCache[name] = none;
	return none;
}

// amxmodx/amx.h: the usertags slot that holds the native being run.
#define UT_NATIVE 3

/**
 * The host's native this module is calling right now, by its index in the
 * host's table; -1 for none. usertags[UT_NATIVE] says the same only until
 * the host runs another native: a native another TypeScript plugin exported
 * runs the host's __amxts_native, whose call to amxts_native overwrites it
 * before n_native can read which native it was (ExportedFor).
 */
static int g_invoked = -1;

/**
 * Calls a native of the host's table the way the AMX's own call instruction
 * does.
 *
 * AMX Mod X names the native in a run time error - and hands a native filter
 * the name of a native that is not there - by usertags[UT_NATIVE], which its
 * call instruction sets before every native. A call from here goes around
 * that instruction, so the slot is set here: without it the error names
 * whichever of the host's own natives was running, amxts_init or
 * amxts_event, and which module is missing is anyone's guess.
 */
static cell Invoke(const Resolved &native, cell *params)
{
	long running = g_host->usertags[UT_NATIVE];
	int invoked = g_invoked;
	g_host->usertags[UT_NATIVE] = native.index;
	g_invoked = native.index;
	cell result = native.fn(g_host, params);
	g_host->usertags[UT_NATIVE] = running;
	g_invoked = invoked;
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

/**
 * Takes `cells` cells of the host's heap; NULL when the heap would run into
 * the stack. amx_Allot checks that too, but in unsigned arithmetic: a request
 * larger than what is left wraps around, passes, and the heap grows over the
 * stack of the call that is running.
 */
static cell *HeapCells(int cells, cell *addr)
{
	cell *phys = NULL;
	if (!g_host || cells < 0
	    || (long)g_host->stk - (long)g_host->hea - (long)cells * (long)sizeof(cell) < HEAP_MARGIN
	    || MF_AmxAllot(g_host, cells, addr, &phys) != AMX_ERR_NONE) {
		MF_PrintSrvConsole("[amxts] %d cells do not fit in the host plugin's heap\n", cells);
		*addr = 0;
		return NULL;
	}
	return phys;
}

static cell PushString(const char *s)
{
	cell addr;
	int len = (int)strlen(s);
	if (!HeapCells(len + 1, &addr))
		return 0;
	MF_SetAmxString(g_host, addr, s, len);
	return addr;
}

/** Text into the host's heap as a Pawn string, a UTF-8 byte a cell; 0 when it does not fit. */
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
 * expects, which is why the generated host plugin reserves DAT+0 — see
 * __amxts_null in scripts/generate-host.ts.
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
static cell CallCached(Cached &cached, const char *name, cell *params)
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
 * A native of the host's table by a name known only as the module runs - the
 * switch a slot keeps (Slot.disable), a field's native: looked up each call.
 */
static cell CallByName(const char *name, cell *params)
{
	Resolved native = FindNative(name);
	if (!native.fn)
		return 0;
	return Invoke(native, params);
}

/**
 * A native of the host's table by its name, a literal: each call site keeps
 * it resolved (Cached), as a thunk does, so the name is looked up once a map
 * rather than in a std::map on every call.
 */
#define CallNative(name, params) \
	([](cell *p) { static Cached cached = { { NULL, 0 }, 0 }; return CallCached(cached, "" name, p); }(params))

/** A native that takes one handle: DisableHookChain(handle) and its like. */
static cell CallWithHandle(const char *name, cell handle)
{
	Args params(1);
	params[1] = handle;
	return CallByName(name, params);
}

/**
 * The arguments of the callback that is running, for arg() and argText().
 *
 * A handler is handed four cells, because call_indirect needs one fixed type
 * and four covers nearly everything. The rest are not lost, only not pushed:
 * they are still here, and so is the AMX whose memory a string among them
 * lives in - the host plugin for a command, a hook or a forward, the calling
 * plugin for an exported native. Whoever fires a handler sets these and puts
 * back what was there, because one handler can start another.
 */
static cell *g_callArgs = NULL;
static int   g_callArgc = 0;
static AMX  *g_callAmx = NULL;
// The plugin that called an exported native, or -1 for anything else. The
// core's own natives file their caller's cvars under it.
static int   g_caller = -1;
// How many cells each array argument has, -1 where nobody said: a forward's,
// for arg_length(). NULL for a call that carries no sizes.
static const int32_t *g_callLengths = NULL;

struct CallArgs {
	cell *args; int argc; AMX *amx; int caller; const int32_t *lengths;

	CallArgs(cell *a, int n, AMX *x, int from = -1, const int32_t *sizes = NULL)
		: args(g_callArgs), argc(g_callArgc), amx(g_callAmx), caller(g_caller), lengths(g_callLengths)
	{
		g_callArgs = a; g_callArgc = n; g_callAmx = x; g_caller = from; g_callLengths = sizes;
	}

	~CallArgs()
	{
		g_callArgs = args; g_callArgc = argc; g_callAmx = amx; g_caller = caller; g_callLengths = lengths;
	}
};

/**
 * A native's call frame on the AMX side: what a buffer parameter is copied
 * into, and the heap mark that releases all of it when the call returns.
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
 * The AMX the native gets is the host's, and the buffers are in its heap,
 * not in the plugin's memory: the memory moves when it grows, which it can
 * while a native runs code of the same plugin, and a native keeps the AMX it
 * was called with for its callbacks.
 */
struct Frame {
	wasm_module_inst_t inst;
	cell mark;

	Frame(wasm_exec_env_t env)
	{
		inst = wasm_runtime_get_module_inst(env);
		mark = g_host ? g_host->hea : 0;
	}

	~Frame()
	{
		if (g_host)
			g_host->hea = mark;
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
		uint32_t bytes = *(uint32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)(ptr - 4));
		if (bytes > end - (uint64_t)ptr)
			return 0;

		const uint16_t *chars = (const uint16_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
		uint32_t n = bytes / 2;

		// Three bytes at most for each unit (a pair's four are two units'),
		// then given back down to what the text took.
		uint32_t room = (uint64_t)n * 3 < MAX_CROSSING_CELLS - 1 ? n * 3 : MAX_CROSSING_CELLS - 1;
		cell addr;
		cell *phys = HeapCells((int)room + 1, &addr);
		if (!phys)
			return 0;

		cell *dst = phys, *stop = phys + room;
		for (uint32_t i = 0; i < n; i++) {
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
		g_host->hea = addr + (cell)((dst - phys + 1) * sizeof(cell));
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
		cell *phys = HeapCells(cells + 1, &addr);
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
		const cell *phys = MF_GetAmxAddr(g_host, addr);
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
	 * handed address 0, it would write into the host plugin's own data.
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
		cell *phys = HeapCells(n + 1, &addr);
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

		cell *phys = MF_GetAmxAddr(g_host, addr);
		if (!phys)
			return;

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

// The host plugin, compiled (`bun run host`): written out for AMX Mod X on
// every start (InstallHost).
#include "host.h"

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
	cell mark = g_host->hea;
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
	const char *name = MF_GetAmxString(g_host, addr, 0, &len);
	std::string out = name ? name : "";

	g_host->hea = mark;
	return out;
}

/** One message of one byte and one string, to one player. */
static bool WriteTo(int id, int message, int sender, const char *text)
{
	cell mark = g_host->hea;

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
		g_host->hea = mark;
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

	g_host->hea = mark;
	return true;
}

static int g_msgSayText = 0;
static int g_msgTeamInfo = 0;

static int MessageId(const char *name)
{
	cell mark = g_host->hea;
	Args params(1);
	params[1] = PushString(name);
	int id = (int)CallNative("get_user_msgid", params);
	g_host->hea = mark;
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
	cell mark = g_host->hea;
	std::string s = AsString(Inst(env), msg);

	Args params(4);
	params[1] = id;
	params[2] = channel;
	params[3] = PushString("%s");
	params[4] = PushString(s.c_str());

	CallNative("client_print", params);
	g_host->hea = mark;
}

static int32_t w_get_name(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	cell mark = g_host->hea;
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
	const char *name = MF_GetAmxString(g_host, addr, 0, &len);
	int32_t written = WriteBytes(Inst(env), out, max, name ? name : "");

	g_host->hea = mark;
	return written;
}

// fields.h's: an entvar's four bytes where the game keeps them.
static char *EntvarAt(int32_t id, int32_t offset);

// pev->health's place in entvars_t (scripts/entvars.ts checks the layout).
#define ENTVAR_HEALTH 352

/**
 * A player's health as get_user_health gives it - pev->health, truncated -
 * read where the game keeps it rather than through the native and its name.
 * A slot nobody is in goes to the native, which says so as it does in Pawn.
 */
static int32_t w_get_health(wasm_exec_env_t env, int32_t id)
{
	char *at = MF_IsPlayerIngame(id) ? EntvarAt(id, ENTVAR_HEALTH) : NULL;
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
	char *at = hp > 0 && MF_IsPlayerIngame(id) ? EntvarAt(id, ENTVAR_HEALTH) : NULL;
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

/** The number of a forward the host relays (FORWARD_*), or -1 for one it does not. */
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

// on(event, handler, shape) - a forward the generated host plugin relays.
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

/** Whether the host plugin has a public for this forward, so AMX Mod X delivers it. */
static bool HostRelays(const char *forward)
{
	int index = 0;
	return g_host && MF_AmxFindPublic(g_host, forward, &index) == AMX_ERR_NONE;
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
 * Calls every subscriber of a forward the host does not relay. The arguments
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
 * its TypeScript subscribers hear it here unless AMX Mod X will hand it to the
 * host plugin, which delivers it through n_event instead.
 *
 * `mask` has a letter per argument: `n` and `f` a cell, `s` a string in the
 * emitting plugin's memory, `a` an array laid out as ForwardArray reads it.
 * Strings and arrays are copied into the host's heap for as long as the
 * subscribers run, so they read them as they read a forward from Pawn.
 */
static void w_emit_local(wasm_exec_env_t env, int32_t name, int32_t mask, int32_t cellsPtr, int32_t argc)
{
	wasm_module_inst_t inst = Inst(env);
	std::string forward = AsString(inst, name);
	if (!g_host || HostRelays(forward.c_str()) || g_subscriptions.find(forward) == g_subscriptions.end())
		return;

	std::string types = AsString(inst, mask);
	if (argc < 0 || argc > MAX_FORWARD_ARGS || argc > (int32_t)types.size()
	    || !wasm_runtime_validate_app_addr(inst, (uint64_t)cellsPtr, (uint64_t)argc * 4))
		return;

	int32_t *cells = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)cellsPtr);
	cell args[MAX_FORWARD_ARGS] = { 0 };
	int32_t lengths[MAX_FORWARD_ARGS];
	cell mark = g_host->hea;

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
		CallArgs context(args, argc, g_host, -1, lengths);
		DeliverToSubscribers(forward);
	}
	g_host->hea = mark;
}

/**
 * Parks a wasm function in a callback slot and returns the slot number, whose
 * public in the host plugin is what the AMXX native is actually given.
 *
 * A free slot, not the next one: a plugin that arms one per round would
 * otherwise run out after 32 and stop responding for the rest of the map.
 */
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

static int TakeSlot(int32_t fn, int32_t shape, const char *key, bool *reused, cell fallback)
{
	int32_t tag = TakeTag();
	if (reused)
		*reused = false;

	if (g_currentPlugin < 0)
		return -1;

	// A reload leaves the AMX Mod X side registered and the slot orphaned. If
	// this is the same registration coming back, take it over: registering
	// again would leave the orphan in front of it, answering PLUGIN_HANDLED and
	// swallowing the command before the live handler ever saw it.
	if (key && *key) {
		for (int i = 0; i < MAX_CALLBACK_SLOTS; i++) {
			if (g_slots[i].used && g_slots[i].plugin == SLOT_ORPHANED
			    && g_slots[i].key == key) {
				g_slots[i].plugin = g_currentPlugin;
				g_slots[i].fn = (uint32_t)fn;
				g_slots[i].tag = tag;
				g_slots[i].shape = shape;
				g_slots[i].fallback = fallback;
				g_slots[i].off = false;
				Bind(g_slots[i]);
				if (g_slots[i].enable && g_slots[i].handle)
					CallWithHandle(g_slots[i].enable, g_slots[i].handle);
				if (reused)
					*reused = true;
				return i;
			}
		}
	}

	int slot = -1;
	for (int i = 0; i < MAX_CALLBACK_SLOTS; i++) {
		if (!g_slots[i].used) { slot = i; break; }
	}

	if (slot < 0) {
		MF_PrintSrvConsole("[amxts] out of callback slots (%d)\n", MAX_CALLBACK_SLOTS);
		return -1;
	}

	g_slots[slot].used = true;
	g_slots[slot].plugin = g_currentPlugin;
	g_slots[slot].fn = (uint32_t)fn;
	g_slots[slot].tag = tag;
	g_slots[slot].shape = shape;
	g_slots[slot].fallback = fallback;
	g_slots[slot].key = key ? key : "";
	g_slots[slot].handle = 0;
	g_slots[slot].disable = NULL;
	g_slots[slot].enable = NULL;
	g_slots[slot].off = false;
	Bind(g_slots[slot]);
	if (slot >= g_slotCount)
		g_slotCount = slot + 1;

	return slot;
}

/**
 * A command a plugin asked for before AMX Mod X was ready to hear it.
 *
 * A plugin's top level runs during plugin_natives, which is where it has to
 * run - that is when AMX Mod X asks for natives, and a plugin exports its own
 * by running. It is also too early to register a command: a register_concmd
 * issued there crashed the server the moment the command was typed, with
 * nothing in any log. So the registrations are kept here and made from
 * plugin_init, and a plugin author never has to know.
 */
struct PendingCommand {
	std::string pattern;
	std::string info;
	int slot;
	int flags;
};

static std::vector<PendingCommand> g_pendingCommands;
static bool g_amxxReady = false;

static void RegisterClientCommand(const char *pattern, int slot, int flags, const char *info)
{
	char pub[32];
	snprintf(pub, sizeof(pub), "__amxts_cb%d", slot);

	cell mark = g_host->hea;
	// register_clcmd(client_cmd[], function[], flags, info[], FlagManager, bool:info_ml)
	Args params(6);
	params[1] = PushString(pattern);
	params[2] = PushString(pub);
	params[3] = flags;
	params[4] = PushString(info);
	params[5] = -1;
	params[6] = 0;

	CallNative("register_clcmd", params);
	g_host->hea = mark;
}

// cmd(pattern, handler, flags, info, shape) - register_clcmd through a slot.
static int32_t w_clcmd(wasm_exec_env_t env, int32_t pattern, int32_t fn, int32_t flags, int32_t info, int32_t shape)
{
	std::string key = "clcmd:" + AsString(Inst(env), pattern);

	bool reused = false;
	int slot = TakeSlot(fn, shape, key.c_str(), &reused, 1);   // PLUGIN_HANDLED
	if (slot < 0)
		return -1;

	// Already registered with AMX Mod X before the reload; the slot is enough.
	if (reused)
		return slot;

	std::string text = AsString(Inst(env), pattern);
	std::string help = AsString(Inst(env), info);

	if (!g_amxxReady) {
		PendingCommand pending;
		pending.pattern = text;
		pending.info = help;
		pending.slot = slot;
		pending.flags = flags;
		g_pendingCommands.push_back(pending);
		return slot;
	}

	RegisterClientCommand(text.c_str(), slot, flags, help.c_str());
	return slot;
}

/**
 * slot(handler, shape, key, fallback) - a host public standing in for a wasm
 * function, with the registering left to the plugin.
 *
 * w_clcmd, w_hook and w_ham each park a function in a slot and then
 * call the one AMXX native they were built for. Every other AMXX facility that
 * takes a callback by name - register_message, register_touch, query_client_cvar,
 * set_native_filter, menu_core's registrars - would need another
 * wrapper each. This is the same first half with no second half: the plugin
 * gets the slot and passes "__amxts_cb<n>" to whatever native it likes.
 *
 * Returns the slot, or -1 for no slot left. A slot taken back on a reload
 * returns it with SLOT_REUSED set, because none of those registrations can be
 * undone either: the plugin must not register the name a second time, or the
 * handler fires twice.
 */
/**
 * arg(index) - a cell of the callback that is running, beyond the four it was
 * handed.
 *
 * A handler's shape is fixed at four arguments because call_indirect needs one
 * type, and a reapi hookchain or a message handler sometimes carries more.
 * Those arguments were never lost, only not pushed; this reads them where they
 * are. Index 0 is the first argument, the same one the handler got as `a`.
 */
static int32_t w_arg(wasm_exec_env_t env, int32_t index)
{
	(void)env;
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

/** caller() - which plugin called the exported native that is running. */
static int32_t w_caller(wasm_exec_env_t env)
{
	(void)env;
	return g_caller;
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
 * plugin's `out`. Also what a hookchain's vector argument is read with: the
 * cell is an address in the host plugin, where reapi pushed the vector.
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
	return count;
}

// ---------------------------------------------------------------- callfunc with arguments that stay

/**
 * callfunc_text / callfunc_buffer / callfunc_finish - calling another
 * plugin's public with a string or an array it fills (menu_core's
 * placeholders: `public callback(id, targetId, value[], len)`).
 *
 * The generated callfunc_push_str / callfunc_push_array thunks cannot do it.
 * A thunk's Frame puts the argument on the host heap for the length of that
 * one native and releases it, so every push lands at the same address; AMX
 * Mod X knows a by-reference argument by that address, takes the second one
 * for the first (CALLFUNC_FLAG_BYREF_REUSED), and callfunc_end copies an
 * array back to memory that is no longer the plugin's. These keep each
 * argument on the host heap until callfunc_finish: callfunc_end runs, the
 * arrays are copied back into the plugin, and the heap goes back to where the
 * first push found it.
 *
 * A callfunc started inside the called function (the callee calls a native
 * that runs wasm that calls again) keeps its own list: callfunc_finish takes
 * this one's before callfunc_end runs.
 */
struct CallfuncBuffer {
	int32_t ptr;
	int32_t cells;
	cell addr;
};

static std::vector<CallfuncBuffer> g_callfuncBuffers;
static cell g_callfuncMark = -1;

static cell *CallfuncAllot(int cells, cell *addr)
{
	if (g_callfuncMark < 0)
		g_callfuncMark = g_host->hea;

	return HeapCells(cells, addr);
}

/** callfunc_text(text) - the text, whole and as UTF-8, as the next argument. */
static int32_t w_callfuncText(wasm_exec_env_t env, int32_t text)
{
	if (!g_host)
		return 0;

	std::string s = AsString(Inst(env), text);
	int n = (int)s.size();

	cell addr;
	cell *phys = CallfuncAllot(n + 1, &addr);
	if (!phys)
		return 0;

	for (int i = 0; i < n; i++)
		phys[i] = (cell)(unsigned char)s[i];
	phys[n] = 0;

	Args p(2);
	p[1] = addr;
	p[2] = 0;                           // no copy back: a string going in
	return (int32_t)CallNative("callfunc_push_str", p);
}

/** callfunc_buffer(cells, count) - `count` cells the function may fill, copied back by callfunc_finish. */
static int32_t w_callfuncBuffer(wasm_exec_env_t env, int32_t ptr, int32_t count)
{
	wasm_module_inst_t inst = Inst(env);
	if (!g_host || count <= 0 || count > 4096 || !wasm_runtime_validate_app_addr(inst, (uint64_t)ptr, (uint64_t)count * 4))
		return 0;

	cell addr;
	cell *phys = CallfuncAllot(count, &addr);
	if (!phys)
		return 0;

	int32_t *src = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ptr);
	for (int32_t i = 0; i < count; i++)
		phys[i] = (cell)src[i];

	CallfuncBuffer buffer = { ptr, count, addr };
	g_callfuncBuffers.push_back(buffer);

	Args p(3);
	p[1] = addr;
	p[2] = count;
	p[3] = 1;                           // copy back into addr, which stays ours
	return (int32_t)CallNative("callfunc_push_array", p);
}

/** callfunc_finish() - callfunc_end, the buffers copied back, the heap released. What the function returned. */
static int32_t w_callfuncFinish(wasm_exec_env_t env)
{
	if (!g_host)
		return 0;

	std::vector<CallfuncBuffer> buffers;
	buffers.swap(g_callfuncBuffers);
	cell mark = g_callfuncMark;
	g_callfuncMark = -1;

	Args none(0);
	cell result = CallNative("callfunc_end", none);

	wasm_module_inst_t inst = Inst(env);
	for (size_t i = 0; i < buffers.size(); i++) {
		const CallfuncBuffer &b = buffers[i];
		cell *phys = MF_GetAmxAddr(g_host, b.addr);
		if (!phys || !wasm_runtime_validate_app_addr(inst, (uint64_t)b.ptr, (uint64_t)b.cells * 4))
			continue;
		int32_t *dst = (int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)b.ptr);
		for (int32_t k = 0; k < b.cells; k++)
			dst[k] = (int32_t)phys[k];
	}

	if (mark >= 0)
		g_host->hea = mark;

	return (int32_t)result;
}

static int32_t w_slot(wasm_exec_env_t env, int32_t fn, int32_t shape, int32_t key, int32_t fallback)
{
	std::string name = AsString(Inst(env), key);

	bool reused = false;
	int slot = TakeSlot(fn, shape, name.c_str(), &reused, fallback);
	if (slot < 0)
		return -1;

	return reused ? (slot | SLOT_REUSED) : slot;
}

/**
 * slot_on(slot, on) - switches one of the plugin's slots off while what it
 * delivers has no listener, and back on: switched off, AMX Mod X still calls
 * the public, and the call answers its fallback here.
 */
static void w_slotOn(wasm_exec_env_t env, int32_t slot, int32_t on)
{
	(void)env;
	if (slot < 0 || slot >= g_slotCount || !g_slots[slot].used || g_slots[slot].plugin != g_currentPlugin)
		return;
	g_slots[slot].off = !on;
}

// ---------------------------------------------------------------- timers
//
// setTimeout, setInterval and sleep: a binary heap by due time, walked once a
// frame (RunTimers, from StartFrame). Arming is a push, clearing takes the
// timer out of g_armed - its entry in the heap is dropped when it comes up -
// and firing calls the plugin directly. No AMX Mod X task, so no limit.

struct TimerEntry {
	double   due;
	uint64_t order;   // arming order: two timers due together fire as armed
	int32_t  id;
};

struct ArmedTimer {
	Handler handler;
	double  every;    // a repeating timer's period in seconds; < 0 fires once
};

/** The earliest due on top of the heap, then the earliest armed. */
static bool LaterTimer(const TimerEntry &a, const TimerEntry &b)
{
	return a.due != b.due ? a.due > b.due : a.order > b.order;
}

static std::vector<TimerEntry> g_timerHeap;
static std::unordered_map<int32_t, ArmedTimer> g_armed;
static uint64_t g_timerOrder = 0;

// When the frame looks at the plugins' files next (WatchPlugins).
static float g_nextWatch = 0;

static void QueueTimer(double due, int32_t id)
{
	TimerEntry e = { due, g_timerOrder++, id };
	g_timerHeap.push_back(e);
	std::push_heap(g_timerHeap.begin(), g_timerHeap.end(), LaterTimer);
}

/**
 * task(seconds, handler, id, repeat) - fires `handler(id)` after `seconds`,
 * and every `seconds` after that when `repeat` is set. The ids are the
 * module's own (co_id), so no other plugin's timer has one.
 *
 * The delay arrives as the bit pattern of a 32-bit float rather than as an f32
 * parameter: keeping every signature to `i` means the table wamrc reads
 * cannot disagree with the host about anything but arity.
 */
static int32_t w_task(wasm_exec_env_t env, int32_t secondsBits, int32_t fn, int32_t id, int32_t repeat)
{
	(void)env;
	int32_t tag = TakeTag();
	if (g_currentPlugin < 0 || !gpGlobals)
		return -1;

	float seconds;
	memcpy(&seconds, &secondsBits, sizeof(seconds));
	if (!(seconds > 0))
		seconds = 0;

	ArmedTimer &t = g_armed[id];
	t.handler = Handler();
	t.handler.plugin = g_currentPlugin;
	t.handler.fn = (uint32_t)fn;
	t.handler.shape = SHAPE_NARROW;
	t.handler.tag = tag;
	Bind(t.handler);
	t.every = repeat ? seconds : -1;

	QueueTimer(gpGlobals->time + seconds, id);
	return 0;
}

/** stopTask(id) - the timer does not fire again; 1 if it was armed. */
static int32_t w_stopTask(wasm_exec_env_t env, int32_t id)
{
	(void)env;
	return g_armed.erase(id) ? 1 : 0;
}

/**
 * Fires every timer that is due. What is due is taken off the heap first, so
 * a timer armed or repeated by a handler waits for a later frame, even with
 * no delay. Precision: one frame.
 */
static void RunTimers()
{
	if (g_timerHeap.empty())
		return;

	double now = gpGlobals->time;
	std::vector<int32_t> due;
	while (!g_timerHeap.empty() && g_timerHeap.front().due <= now) {
		std::pop_heap(g_timerHeap.begin(), g_timerHeap.end(), LaterTimer);
		due.push_back(g_timerHeap.back().id);
		g_timerHeap.pop_back();
	}

	for (size_t i = 0; i < due.size(); i++) {
		std::unordered_map<int32_t, ArmedTimer>::iterator it = g_armed.find(due[i]);
		if (it == g_armed.end())
			continue;   // cleared, or its plugin is gone

		// A copy: the handler may clear this timer or arm others.
		Handler h = it->second.handler;
		if (it->second.every < 0)
			g_armed.erase(it);
		else
			QueueTimer(now + it->second.every, due[i]);

		uint32_t argv[1] = { (uint32_t)due[i] };
		Fire(h, argv, 1, 0);
	}
}

/** A stopped plugin's timers go; their entries in the heap are dropped as they come up. */
static void DropTimers(int plugin)
{
	for (std::unordered_map<int32_t, ArmedTimer>::iterator it = g_armed.begin(); it != g_armed.end(); )
		it = it->second.handler.plugin == plugin ? g_armed.erase(it) : ++it;
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
	Frame f(env);

	int count = (int)(sizeof(g_dispatchedNatives) / sizeof(g_dispatchedNatives[0]));
	if (id < 0 || id >= count) {
		MF_PrintSrvConsole("[amxts] amxts_call: no native with id %d\n", id);
		return 0;
	}

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
				cell *phys = values ? HeapCells(n + 1, &prepare[1]) : NULL;
				if (phys)
					memcpy(phys, values, (size_t)n * sizeof(cell));
				prepare[2] = phys ? n : 0;
				cell *handle = HeapCells(1, &p[i + 1]);
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
			*MF_GetAmxAddr(g_host, p[i + 1]) = length;
		back[backCount].ptr = args[i];
		back[backCount].cells = cells;
		back[backCount].addr = p[i + 1];
		backCount++;
	}

	static Cached natives[sizeof(g_dispatchedNatives) / sizeof(g_dispatchedNatives[0])];
	cell r = CallCached(natives[id], g_dispatchedNatives[id], p);

	for (int i = 0; i < backCount; i++)
		f.out(back[i].ptr, back[i].cells, back[i].addr);

	return (int32_t)r;
}

/**
 * hook(hookchainId, handler, post) - reapi's RegisterHookChain.
 *
 * Same shape as a command: the AMXX side takes the name of a public, so the
 * wasm function goes into a slot and the slot's public is what gets
 * registered. The handler is always wide, because a hookchain hands over the
 * entity and its arguments and expects HC_CONTINUE or HC_SUPERCEDE back.
 *
 * The id comes from as/constants.ts - RG_CBasePlayer_Spawn and the rest are
 * numbers the generator computed out of reapi's own includes, so an include
 * from a different reapi release renumbers them and this registers something
 * else. Take the includes from the release the server runs.
 */
static int32_t w_hook(wasm_exec_env_t env, int32_t id, int32_t fn, int32_t post)
{
	char key[64];
	snprintf(key, sizeof(key), "hook:%d:%d", id, post);

	bool reused = false;
	int slot = TakeSlot(fn, SHAPE_WIDE, key, &reused, 0);      // HC_CONTINUE
	if (slot < 0)
		return 0;

	// Registering the same chain twice would call the plugin twice.
	if (reused)
		return (int32_t)g_slots[slot].handle;

	char pub[32];
	snprintf(pub, sizeof(pub), "__amxts_cb%d", slot);

	cell mark = g_host->hea;
	Args params(3);
	params[1] = id;
	params[2] = PushString(pub);
	params[3] = post;

	cell handle = CallNative("RegisterHookChain", params);
	g_host->hea = mark;

	g_slots[slot].handle = handle;
	g_slots[slot].disable = "DisableHookChain";
	g_slots[slot].enable = "EnableHookChain";
	return (int32_t)handle;
}

// ham(hamId, entityClass, handler, post) - Ham Sandwich's RegisterHam.
static int32_t w_ham(wasm_exec_env_t env, int32_t id, int32_t entityClass, int32_t fn, int32_t post)
{
	std::string key = "ham:" + AsString(Inst(env), entityClass) + ":";
	char suffix[32];
	snprintf(suffix, sizeof(suffix), "%d:%d", id, post);
	key += suffix;

	bool reused = false;
	int slot = TakeSlot(fn, SHAPE_WIDE, key.c_str(), &reused, 1);  // HAM_IGNORED
	if (slot < 0)
		return 0;

	if (reused)
		return (int32_t)g_slots[slot].handle;

	char pub[32];
	snprintf(pub, sizeof(pub), "__amxts_cb%d", slot);

	cell mark = g_host->hea;
	// RegisterHam(Ham:function, EntityClass[], Callback[], Post, bool:specialbot)
	Args params(5);
	params[1] = id;
	params[2] = PushString(AsString(Inst(env), entityClass).c_str());
	params[3] = PushString(pub);
	params[4] = post;
	params[5] = 0;

	cell handle = CallNative("RegisterHam", params);
	g_host->hea = mark;

	g_slots[slot].handle = handle;
	g_slots[slot].disable = "DisableHamForward";
	g_slots[slot].enable = "EnableHamForward";
	return (int32_t)handle;
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

	// The same plugin coming back after a reload takes its own entry: AMX Mod X
	// has no way to unregister a native, so the name is already taken - by us.
	std::map<std::string, size_t>::iterator it = g_exportedByName.find(wanted);
	if (it != g_exportedByName.end()) {
		Exported &again = g_exported[it->second];
		again.plugin = g_currentPlugin;
		again.fn = (uint32_t)fn;
		again.tag = tag;
		Bind(again);
		return (int32_t)it->second;
	}

	Exported exported;
	exported.plugin = g_currentPlugin;
	exported.fn = (uint32_t)fn;
	exported.shape = SHAPE_WIDE;
	exported.tag = tag;
	exported.name = wanted;
	Bind(exported);
	g_exported.push_back(exported);
	g_exportedByName[wanted] = g_exported.size() - 1;

	// Every exported native is the host's one public: n_native tells them apart.
	cell mark = g_host->hea;
	Args params(3);
	params[1] = PushString(wanted.c_str());
	params[2] = PushString("__amxts_native");
	params[3] = 0;

	CallNative("register_native", params);
	g_host->hea = mark;

	return (int32_t)(g_exported.size() - 1);
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
	{ "slot_on",         (void *)w_slotOn,          "(ii)", NULL },
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
	{ "clcmd",        (void *)w_clcmd,        "(iiiii)i", NULL },
	{ "task",         (void *)w_task,         "(iiii)i", NULL },
	{ "stop_task",    (void *)w_stopTask,     "(i)i", NULL },
	{ "tag",          (void *)w_tag,          "(i)",  NULL },
	{ "call",         (void *)w_call,         "(iiii)i", NULL },
	{ "hook",         (void *)w_hook,         "(iii)i", NULL },
	{ "ham",          (void *)w_ham,          "(iiii)i", NULL },
	{ "plugin",       (void *)w_meta,         "(iiii)", NULL },
	{ "co_entered",   (void *)w_co_entered,   "()i",    NULL },
	{ "co_spawn",     (void *)w_co_spawn,     "(iiiii)i", NULL },
	{ "co_suspend",   (void *)w_co_suspend,   "(i)",    NULL },
	{ "co_wake",      (void *)w_co_wake,      "()",     NULL },
	{ "co_id",        (void *)w_co_id,        "()i",    NULL },
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

	if (h.func && h.cells) {
		// Every parameter an i32: the cells go in as they are, and `call` has
		// room for the result.
		called = wasm_runtime_call_wasm(p.env, h.func, h.count, call);
	}
	else if (h.func) {
		// A plugin's `number` is JavaScript's - an f64 - and every argument
		// here is a cell, an i32. Passed as raw cells, a handler declared
		// `tick(handle: number)` read the i32 1000 as the bits of a double: a
		// denormal next to zero, so clearTimeout(handle) stopped nothing and
		// a countdown ran on into the negatives. So the handler's own
		// parameter types decide how each cell goes in: converted by value to
		// f64 (or f32, i64) where that is what the function takes, laid out
		// in cells as WAMR reads them.
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
 * plugins in plugins.ini. The host's plugin_natives, and with it LoadScripts,
 * runs in the middle of that loop; a lookup there moved the buffers on, and
 * every Pawn plugin after amxts_host.amxx failed with "Plugin file open error".
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
 * scripts/server-files.ts makes (embedded.h). The host plugin is written
 * apart from these (InstallHost), on a test server too.
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

// ---------------------------------------------------------------- the host plugin

#define HOST_FILE "amxts_host.amxx"

/**
 * The host plugin as AMX Mod X loads it, and the list that names it, both
 * under AMX Mod X's own folders (InstallHost).
 *
 * The host has to be a plugin in AMX Mod X's list. The module API loads a
 * script (LoadAmxScript) and even binds the natives plugins registered, but
 * the script is not a plugin: AMX Mod X finds the plugin behind an AMX by
 * userdata only a plugin sets, so set_task, register_srvcmd, register_event,
 * RegisterHookChain and their like find none, and a forward - plugin_init,
 * client_putinserver, one a Pawn plugin creates - reaches the publics of the
 * plugins in the list only. The module API has no way to add one.
 *
 * So the module writes the plugin into the plugins folder and names it in
 * configs/plugins-amxts.ini. AMX Mod X reads every configs/plugins-*.ini
 * after plugins.ini, before the map's own lists, so the host loads after the
 * plugins of plugins.ini; natives are bound once every plugin has loaded,
 * whichever list named it. Windows' AMX Mod X passes over the first *.ini its
 * search of the folder finds, which is modules.ini or another before
 * "plugins-" on a server. Both files are written when the module attaches,
 * once a process - before AMX Mod X first reads its lists; they stay for every
 * map after - and removed when it detaches, so a server whose module is taken
 * out does not load a host nobody serves.
 */
static std::string g_hostFile;
static std::string g_hostList;

static bool WriteWhole(const std::string &path, const void *data, size_t size)
{
	FILE *f = fopen(path.c_str(), "wb");
	if (!f)
		return false;
	bool written = fwrite(data, 1, size, f) == size;
	return fclose(f) == 0 && written;
}

/**
 * Says that plugins.ini can lose its line for the host - an install from
 * before the module carried it - once a server's run.
 *
 * The line does no harm: AMX Mod X loads a plugin of one name once, so the
 * host loads at that line, from the file InstallHost has just written, and
 * plugins-amxts.ini's line is passed over.
 */
static void NoteHostLine(const std::string &pluginsIni)
{
	FILE *f = fopen(pluginsIni.c_str(), "r");
	if (!f)
		return;

	// Read as AMX Mod X reads it: a ';' ends a line, and `disabled` after the
	// name keeps the plugin out (the host too, which OnPluginsLoaded says).
	bool named = false;
	char line[512];
	while (!named && fgets(line, sizeof(line), f)) {
		char *comment = strchr(line, ';');
		if (comment)
			*comment = 0;
		char name[256] = "", flag[256] = "";
		sscanf(line, "%255s %255s", name, flag);
		named = !strcmp(name, HOST_FILE) && strcmp(flag, "disabled") != 0;
	}
	fclose(f);

	if (!named)
		return;

	MF_PrintSrvConsole("[amxts] %s names " HOST_FILE ": the amxts_amxx module loads the host plugin itself, so that line can go\n",
	                   pluginsIni.c_str());
}

static void InstallHost()
{
	// Copied at once: the engine answers a localinfo lookup from four buffers
	// it takes in turn.
	std::string plugins = MF_GetLocalInfo("amxx_pluginsdir", "addons/amxmodx/plugins");
	std::string configs = MF_GetLocalInfo("amxx_configsdir", "addons/amxmodx/configs");
	std::string pluginsIni = MF_GetLocalInfo("amxx_plugins", "addons/amxmodx/configs/plugins.ini");

	g_hostFile = MF_BuildPathname("%s/" HOST_FILE, plugins.c_str());
	g_hostList = MF_BuildPathname("%s/plugins-amxts.ini", configs.c_str());

	static const char list[] =
		"; Written by the amxts_amxx module when it starts, and removed when it stops:\n"
		"; the host plugin the module carries. Nothing here is to be edited.\n"
		HOST_FILE "\n";

	if (!WriteWhole(g_hostFile, g_hostPlugin, sizeof(g_hostPlugin)))
		MF_PrintSrvConsole("[amxts] cannot write %s - without it no amxts plugin runs\n", g_hostFile.c_str());
	if (!WriteWhole(g_hostList, list, sizeof(list) - 1))
		MF_PrintSrvConsole("[amxts] cannot write %s - without it no amxts plugin runs\n", g_hostList.c_str());

	NoteHostLine(MF_BuildPathname("%s", pluginsIni.c_str()));
}

static void RemoveHost()
{
	if (!g_hostList.empty())
		remove(g_hostList.c_str());
	if (!g_hostFile.empty())
		remove(g_hostFile.c_str());
}

// ---------------------------------------------------------------- boot

/**
 * Stops one plugin and takes back what it registered with AMX Mod X; its
 * entry stays at its index, for the caller to say what it is now.
 *
 * A task is removed and its slot given back. A hookchain or a Ham hook is
 * switched off, and its slot kept under its key for the plugin to take back
 * and switch on when it registers it again (TakeSlot); one it does not take
 * back is given back once the load is done (FreeSwitchedOff). The rest -
 * register_clcmd, register_srvcmd, register_message, register_menucmd - have
 * no undo, so their publics stay bound to their slots: those become orphans,
 * which answer PLUGIN_CONTINUE and call nothing, until the same registration
 * comes back and reuses its slot. An orphan whose registration never comes
 * back - a command the new code no longer adds - stays spent, one of the
 * MAX_CALLBACK_SLOTS, until the map changes. Its listeners, its subscriptions
 * and its requests go; its natives and the modules it serves stay registered,
 * answering nothing until a plugin claims them again. The owners of the
 * modules it called hear that its run ended (TellOwners), once it is gone.
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

	for (size_t i = 0; i < g_services.size(); i++)
		if (g_services[i].plugin == index)
			g_services[i].plugin = -1;

	for (int i = 0; i < MAX_CALLBACK_SLOTS; i++) {
		Slot &slot = g_slots[i];
		if (!slot.used || slot.plugin != index)
			continue;
		if (slot.disable && slot.handle)
			CallWithHandle(slot.disable, slot.handle);
		slot.plugin = SLOT_ORPHANED;
	}

	// AMX Mod X has no way to take a native back, so the entries are kept and
	// w_export gives each one to whichever plugin claims its name again.
	// Until then, calling one answers 0.
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
	g_services.clear();
	g_fieldListeners.clear();
	g_timers.clear();
	return before;
}

/**
 * Ends a map: every plugin and what lives with them goes, for the next map to
 * start over - AMX Mod X keeps the module loaded across maps
 * (OnPluginsUnloaded), and its host plugin, with every native and public the
 * module took from it, is gone. What lives as long as the process stays:
 * WAMR, the network thread, the gamedata and its members, the plugin list's
 * file and the host's.
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
	g_services.clear();
	g_fieldListeners.clear();

	for (int i = 0; i < MAX_CALLBACK_SLOTS; i++)
		g_slots[i].used = false;
	g_slotCount = 0;

	// register_native cannot be undone either, but the AMX image holding those
	// publics is going away with everything else, so there is nothing to keep.
	g_exported.clear();
	g_exportedByName.clear();

	// Raw AMX_NATIVE pointers harvested from an AMX image that is about to be
	// replaced. Keeping them across a map change is a call into freed memory.
	g_nativeCache.clear();
	g_nativeGeneration++;
	g_host = NULL;
	g_currentPlugin = -1;
	g_callfuncBuffers.clear();
	g_callfuncMark = -1;
	g_msgSayText = g_msgTeamInfo = 0;

	// Commands wait for the next map's plugin_init.
	g_amxxReady = false;
	g_pendingCommands.clear();

	g_timers.clear();
	g_timerHeap.clear();
	g_armed.clear();
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
	for (int i = 0; i < g_slotCount; i++)
		if (g_slots[i].used && g_slots[i].plugin == index) Bind(g_slots[i]);
	for (Exported &e : g_exported)
		if (e.plugin == index) Bind(e);
	for (FieldListener &l : g_fieldListeners)
		if (l.plugin == index) Bind(l);
	for (std::pair<const int32_t, ArmedTimer> &t : g_armed)
		if (t.second.handler.plugin == index) Bind(t.second.handler);
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
 * Registers a server command that the module answers itself.
 *
 * It goes through the same pool of publics as a plugin's callbacks - AMX Mod X
 * has no other way to name a handler - with the slot marked as the module's
 * own, so n_callback knows not to look for a wasm function.
 */
/** Takes a slot for the module itself, or -1 when none is free. */
static int TakeModuleSlot(int owner)
{
	int slot = -1;
	for (int i = 0; i < MAX_CALLBACK_SLOTS; i++) {
		if (!g_slots[i].used) { slot = i; break; }
	}

	if (slot < 0)
		return -1;

	g_slots[slot].used = true;
	g_slots[slot].plugin = owner;
	g_slots[slot].fn = 0;
	g_slots[slot].shape = SHAPE_NARROW;
	g_slots[slot].fallback = 1;
	g_slots[slot].key = "";
	g_slots[slot].handle = 0;
	if (slot >= g_slotCount)
		g_slotCount = slot + 1;

	return slot;
}

static void RegisterServerCommand(const char *command, int owner, const char *info)
{
	int slot = TakeModuleSlot(owner);
	if (slot < 0)
		return;

	char pub[32];
	snprintf(pub, sizeof(pub), "__amxts_cb%d", slot);

	// register_srvcmd(server_cmd[], function[], flags, info[], bool:info_ml):
	// ADMIN_ALL, so it is listed with its info.
	cell mark = g_host->hea;
	Args params(5);
	params[1] = PushString(command);
	params[2] = PushString(pub);
	params[3] = 0;
	params[4] = PushString(info);
	params[5] = 0;

	CallNative("register_srvcmd", params);
	g_host->hea = mark;
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


/** The hooks a reload switched off and the reloaded plugins did not take back: they stay off. */
static void FreeSwitchedOff()
{
	for (int i = 0; i < MAX_CALLBACK_SLOTS; i++)
		if (g_slots[i].used && g_slots[i].plugin == SLOT_ORPHANED && g_slots[i].disable)
			g_slots[i].used = false;
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
	FreeSwitchedOff();
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
	FreeSwitchedOff();
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

/** A server command's argument `n`, as typed. */
static std::string CommandArgument(int n)
{
	cell mark = g_host->hea;
	cell addr;
	cell *phys = HeapCells(128, &addr);
	if (!phys)
		return std::string();
	phys[0] = 0;

	Args params(3);
	params[1] = n;
	params[2] = addr;
	params[3] = 127;
	CallNative("read_argv", params);

	int len = 0;
	const char *text = MF_GetAmxString(g_host, addr, 0, &len);
	std::string out = text ? text : "";

	g_host->hea = mark;
	return out;
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

	int used = 0;
	for (int i = 0; i < g_slotCount; i++)
		if (g_slots[i].used)
			used++;

	int counts[5] = { 0, 0, 0, 0, 0 };
	int width = 0;
	for (size_t i = 0; i < g_plugins.size(); i++) {
		counts[g_plugins[i].state]++;
		if ((int)g_plugins[i].name.size() > width)
			width = (int)g_plugins[i].name.size();
	}

	MF_PrintSrvConsole("[amxts] %d plugin(s): %d running, %d unloaded, %d refused; %d of %d callback slots in use\n",
	                   (int)g_plugins.size(), counts[PLUGIN_RUNNING], counts[PLUGIN_UNLOADED], counts[PLUGIN_REFUSED], used, MAX_CALLBACK_SLOTS);

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

// ---------------------------------------------------------------- amxx natives

/**
 * amxts_natives() - called from the host plugin's plugin_natives.
 *
 * This is where plugins are loaded, which is earlier than it looks: AMX Mod X
 * asks every plugin for its natives before it initialises any of them, and a
 * plugin here exports one by running. Loading in plugin_init instead would put
 * every export after the first plugin that wanted to call it.
 */
static cell AMX_NATIVE_CALL n_natives(AMX *amx, cell *params)
{
	Teardown();
	g_host = amx;
	g_nativeGeneration++;

	AmxHeader *hdr = (AmxHeader *)amx->base;
	MF_PrintSrvConsole("[amxts] host native table: %d entries\n",
		(hdr->libraries - hdr->natives) / hdr->defsize);

	InstallFiles();
	LoadScripts();
	return 1;
}

/**
 * Which exported native a call through the host's __amxts_native is for.
 *
 * AMX Mod X runs a dynamic native inside the caller's call instruction, and
 * that instruction set usertags[UT_NATIVE] of the calling AMX to the native's
 * index in its table (amx_Callback) - which names it. When the caller is the
 * host itself - a TypeScript plugin calling a native another one exports -
 * the host's slot has been overwritten on the way here, and Invoke kept the
 * index instead (g_invoked).
 */
static Exported *ExportedFor(AMX *caller)
{
	if (!caller)
		return NULL;

	int index = caller == g_host ? g_invoked : (int)caller->usertags[UT_NATIVE];
	if (index < 0 || index >= NativeCount(caller))
		return NULL;

	std::map<std::string, size_t>::iterator it = g_exportedByName.find(NativeEntry(caller, index, NULL));
	return it == g_exportedByName.end() ? NULL : &g_exported[it->second];
}

/**
 * amxts_native(caller, argc) - a native a plugin exported.
 *
 * `caller` is the plugin that made the call, which the host public is handed
 * and which nothing else here can work out. It says which native this is
 * (ExportedFor), and it matters for a string or an array argument: what
 * arrives is an address, and the memory it points into is that plugin's, so
 * argString() and argArray() have to be told where to look.
 *
 * The arguments themselves are read here, with get_param, while this is still
 * the native AMX Mod X is running - not pushed through the host public, which
 * used to cap them at eight. They are copied first: the handler may call
 * another dynamic native, and get_param would then answer for that one.
 */
static cell AMX_NATIVE_CALL n_native(AMX *amx, cell *params)
{
	int caller = (int)params[1];
	AMX *from = MF_GetScriptAmx(caller);
	Exported *exported = ExportedFor(from);
	if (!exported)
		return 0;

	int given = (int)params[2];
	if (given > MAX_NATIVE_ARGS) given = MAX_NATIVE_ARGS;
	if (given < 0) given = 0;

	cell args[MAX_NATIVE_ARGS];
	for (int i = 0; i < given; i++) {
		cell mark = g_host->hea;
		Args p(1);
		p[1] = i + 1;
		args[i] = CallNative("get_param", p);
		g_host->hea = mark;
	}

	int n = given > MAX_EVENT_ARGS ? MAX_EVENT_ARGS : given;

	// A string argument points into the calling plugin's memory, not the
	// host's, so that is the AMX argText() reads from.
	CallArgs context(args, given, from, caller);

	// nativeFn's handler takes the first four as parameters; a generated
	// wrapper takes none and reads every one itself.
	uint32_t argv[MAX_EVENT_ARGS];
	for (int i = 0; i < n; i++)
		argv[i] = (uint32_t)(int32_t)args[i];

	// Whatever the handler said with ret(); nothing said is nothing returned.
	return Fire(*exported, argv, n, 0);
}

// amxts_init() — called from the host plugin's plugin_init
static cell AMX_NATIVE_CALL n_init(AMX *amx, cell *params)
{
	// The plugins are already running: amxts_natives loaded them. What is left
	// is the part that belongs to plugin_init - the module's own commands, the
	// watcher, and telling the plugins that the server is up.
	g_amxxReady = true;

	for (size_t i = 0; i < g_pendingCommands.size(); i++) {
		const PendingCommand &c = g_pendingCommands[i];
		RegisterClientCommand(c.pattern.c_str(), c.slot, c.flags, c.info.c_str());
	}
	if (!g_pendingCommands.empty())
		MF_PrintSrvConsole("[amxts] %d client commands registered\n", (int)g_pendingCommands.size());

	g_pendingCommands.clear();

	RegisterServerCommand("amxts_reload", SLOT_RELOAD, "[plugin] - reload one amxts plugin from disk, or every one");
	RegisterServerCommand("amxts_unload", SLOT_UNLOAD, "<plugin> - stop an amxts plugin until amxts_load or the map changes");
	RegisterServerCommand("amxts_load", SLOT_LOAD, "<plugin> - load an amxts plugin: an unloaded one, or a file of plugins/");
	RegisterServerCommand("amxts_plugins", SLOT_LIST, "list the amxts plugins and what each is doing");
	RegisterServerCommand("amxts_trace", SLOT_TRACE, "log every handler call, for cornering a crash");

	FireInit();
	return 1;
}

/**
 * amxts_event(index, const types[], ...) - a forward the host plugin
 * relays, to the plugins' listeners and Forward subscribers. `index` is its
 * number in g_forwardNames, which the host's public passes.
 *
 * `types` has a letter per argument - `n` a cell, `f` a float, `s` a string,
 * `a` an array with its size after it when the include gives one: "na3s".
 * A listener reads the arguments from the call's context (CallArgs), all of
 * them, so a forward is not cut at some count of its arguments. amxts_event
 * is variadic, and Pawn pushes the ADDRESS of every argument in a `...` tail,
 * so a number is read back through it here, and a string or an array stays
 * the address it is.
 */
static cell AMX_NATIVE_CALL n_event(AMX *amx, cell *params)
{
	int forward = (int)params[1];
	if (forward < 0 || forward >= FORWARD_COUNT)
		return 0;

	// A player who left takes his fields with him - after every plugin
	// has heard him go, so a listener of the leave can still read it.
	struct ClearOnReturn {
		int id;
		~ClearOnReturn() { if (id > 0) ClearPlayerData(id); }
	} leaver = { 0 };
	if (forward == FORWARD_CLIENT_DISCONNECTED && params[0] >= (cell)(3 * sizeof(cell))) {
		cell *id = MF_GetAmxAddr(amx, params[3]);
		leaver.id = id ? (int)*id : 0;
	}

	if (forward == FORWARD_CLIENT_CONNECT && params[0] >= (cell)(3 * sizeof(cell))) {
		cell *id = MF_GetAmxAddr(amx, params[3]);
		if (id)
			NewPlayer((int)*id);
	}

	if (forward == FORWARD_CLIENT_INFOCHANGED && params[0] >= (cell)(3 * sizeof(cell))) {
		cell *id = MF_GetAmxAddr(amx, params[3]);
		if (id && *id >= 0 && *id < PLAYER_DATA_SLOTS)
			NameChanges((int)*id, 1);
	}

	// Most forwards the host relays - a frame, a player thinking - nobody
	// listens to: they cost this much and no more. Before amxts_init, as AMX
	// Mod X dispatches plugin_natives and plugin_modules, nothing listens yet.
	Forward &f = g_forwards[forward];
	if (f.handlers.empty() && f.subscribers.empty())
		return 0;

	int argc = (int)(params[0] / sizeof(cell)) - 2;
	if (argc > MAX_FORWARD_ARGS)
		argc = MAX_FORWARD_ARGS;

	int len = 0;
	const char *types = MF_GetAmxString(amx, params[2], 1, &len);
	cell args[MAX_FORWARD_ARGS];
	int32_t lengths[MAX_FORWARD_ARGS];

	for (int i = 0; i < argc; i++) {
		char type = (types && *types) ? *types++ : 'n';
		lengths[i] = -1;
		if (type == 'a' && types && *types >= '0' && *types <= '9') {
			char *after = NULL;
			lengths[i] = (int32_t)strtol(types, &after, 10);
			types = after;
		}

		if (type == 's' || type == 'a') {
			args[i] = params[i + 3];
			continue;
		}
		cell *phys = MF_GetAmxAddr(amx, params[i + 3]);
		args[i] = phys ? *phys : 0;
	}

	CallArgs context(args, argc, amx, -1, lengths);
	return Dispatch(f, args, argc);
}

// ---------------------------------------------------------------- the frame

/**
 * Metamod's StartFrame, after the game's: once a server frame. What came in
 * since the last frame goes to the plugins first - the responses, the names
 * that changed - then the timers that are due, then the frame's listeners.
 * The watcher last, since a reload throws the instances away.
 */
void StartFrame_Post()
{
	if (g_namesChanging)
		NamesChanged();
	NetFrame();
	RunTimers();

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

// amxts_callback(slot, numargs, a .. h) - the host plugin's pool of publics.
static cell AMX_NATIVE_CALL n_callback(AMX *amx, cell *params)
{
	int slot = (int)params[1];
	if (slot < 0 || slot >= g_slotCount || !g_slots[slot].used)
		return 1;

	if (g_slots[slot].plugin == SLOT_RELOAD) {
		std::string name = CommandArgument(1);
		if (name.empty())
			ReloadPlugins();
		else
			ReloadOne(name);
		return 1;
	}

	if (g_slots[slot].plugin == SLOT_UNLOAD || g_slots[slot].plugin == SLOT_LOAD) {
		bool load = g_slots[slot].plugin == SLOT_LOAD;
		std::string name = CommandArgument(1);
		if (name.empty())
			MF_PrintSrvConsole("[amxts] %s <plugin> - amxts_plugins lists them\n", load ? "amxts_load" : "amxts_unload");
		else if (load)
			LoadOne(name);
		else
			UnloadOne(name);
		return 1;
	}

	if (g_slots[slot].plugin == SLOT_LIST) {
		ListPlugins();
		return 1;
	}

	if (g_slots[slot].plugin == SLOT_TRACE) {
		g_trace = !g_trace;
		MF_PrintSrvConsole("[amxts] tracing %s\n", g_trace ? "on" : "off");
		return 1;
	}

	// An orphan is a registration whose plugin is gone. PLUGIN_CONTINUE, so
	// that AMX Mod X passes the command to whoever is alive - answering
	// PLUGIN_HANDLED here is what made `say /hp` go quiet after a reload.
	if (g_slots[slot].plugin == SLOT_ORPHANED)
		return 0;

	if (g_slots[slot].off)
		return g_slots[slot].fallback;

	// The host plugin says how many arguments it pushed; never read past what
	// actually arrived.
	// The host public says how many arguments it was actually given; the cells
	// after that are the padding it pushed to keep one call shape.
	int given = (int)params[2];
	int argc = (int)(params[0] / sizeof(cell)) - 2;
	if (given > argc) given = argc;
	if (given < 0) given = 0;

	int n = given > MAX_EVENT_ARGS ? MAX_EVENT_ARGS : given;

	// The arguments of this call, for arg() and argText() - all of them, not
	// only the four about to be pushed. They live in the host plugin, which is
	// where a string among them lives too.
	CallArgs context(&params[3], given, g_host);

	// A callback's arguments arrive by value: the public was declared with
	// parameters, so params[3] is the first one itself.
	uint32_t argv[MAX_EVENT_ARGS];
	for (int i = 0; i < n; i++)
		argv[i] = (uint32_t)(int32_t)params[i + 3];

	// What silence means was decided when the slot was taken: PLUGIN_HANDLED
	// for a command, HC_CONTINUE for a hookchain. One value for both would
	// have a hook handler that says nothing block the function it hooks.
	return Fire(g_slots[slot], argv, n, g_slots[slot].fallback);
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
	{ "amxts_natives",  n_natives  },
	{ "amxts_native",   n_native   },
	{ "amxts_init",     n_init     },
	{ "amxts_event",    n_event    },
	{ "amxts_callback", n_callback },
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
	FieldsAttach();
	ReadListFile();
	InstallHost();
}

/**
 * Every plugin has loaded, the host among them - unless AMX Mod X did not
 * load it: a `disabled` line for it in plugins.ini, a plugins folder it could
 * not write, a configs folder whose plugins-amxts.ini AMX Mod X did not read.
 * Its log names the reason; this says what it costs.
 */
void OnPluginsLoaded()
{
	if (!g_host)
		MF_PrintSrvConsole("[amxts] AMX Mod X did not load the host plugin (%s, named in %s), and no amxts plugin runs without it - AMX Mod X's log says why\n",
		                   g_hostFile.c_str(), g_hostList.c_str());
}

/** The map is over: AMX Mod X has let its plugins go, the host among them. */
void OnPluginsUnloaded()
{
	Teardown();
}

void OnAmxxDetach()
{
	FieldsDetach();
	Teardown();
	// The worker stops before WAMR goes; its requests are deleted with it.
	NetShutdown();
	RemoveHost();
	wasm_runtime_destroy();
}
