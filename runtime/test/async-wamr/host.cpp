// The coroutine scheduler of runtime/src/module.cpp, under WAMR AOT i386
// without a game server.
//
//   host.exe <plugin.aot> <step>...
//
// A step is an export to call, a number of milliseconds to move the clock on
// (firing the plugin's set_task timers on the way), `leave:<id>` - the
// client_disconnected forward for that player - or `hooks`, which runs every
// pre hookchain handler the plugin registered. Everything the plugin prints,
// and everything the scheduler says, goes to stdout a line each; tests/
// async-wamr.test.ts runs this on tests/as/async.ts and reads it.
//
// The scheduler is not copied: coroutines.h is the file module.cpp includes.
// What is here is the rest of a host, cut down to what that file needs.
#include "wasm_export.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <algorithm>
#include <map>
#include <string>
#include <vector>

#include "coroutine.h"

typedef int32_t cell;

struct Plugin {
	std::string                  name;
	wasm_module_inst_t           inst;
	wasm_exec_env_t              env;
	int                          depth;
	bool                         wake;
	bool                         entering;
	uint32_t                     stackTop;
	std::map<int32_t, Coroutine> coroutines;
	std::vector<int32_t>         running;
};

static std::vector<Plugin> g_plugins;
static int  g_currentPlugin = -1;
static cell g_outcome = 0;
static bool g_outcomeSaid = false;

static void MF_PrintSrvConsole(const char *format, ...)
{
	char line[1024];
	va_list args;
	va_start(args, format);
	vsnprintf(line, sizeof(line), format, args);
	va_end(args);
	printf("host: %s", line);
	if (!*line || line[strlen(line) - 1] != '\n')
		printf("\n");
	fflush(stdout);
}

static wasm_module_inst_t Inst(wasm_exec_env_t env)
{
	return wasm_runtime_get_module_inst(env);
}

static int PluginOf(wasm_module_inst_t inst)
{
	for (size_t i = 0; i < g_plugins.size(); i++)
		if (g_plugins[i].inst == inst)
			return (int)i;
	return g_currentPlugin;
}

static const char *PluginName(int index)
{
	return index >= 0 && (size_t)index < g_plugins.size() ? g_plugins[index].name.c_str() : "?";
}

// The module's report of a failed call (runtime/src/stack.h), without the
// stack: this host keeps no plugin's map.
struct Failure {
	std::string message;
};

static Failure TakeFailure(int index, wasm_module_inst_t inst, const char *ex)
{
	Failure failure;
	failure.message = ex ? ex : "call failed";
	if (inst)
		wasm_runtime_clear_exception(inst);
	return failure;
}

static void PrintFailure(int index, const Failure &failure, const char *context = "")
{
	MF_PrintSrvConsole("[amxts] %s: %s%s\n", PluginName(index), failure.message.c_str(), context);
}

#include "coroutines.h"

// ---------------------------------------------------------------- the rest of a host

struct Task {
	double   at;
	uint32_t fn;
	int32_t  slot;
	int      order;
};

static std::vector<Task> g_tasks;
static std::map<std::string, std::vector<uint32_t> > g_events;
static std::vector<uint32_t> g_preHooks;
static double g_now = 0;
static int g_order = 0;

/** An AssemblyScript string: UTF-16, its byte length in the word before it. */
static std::string Text(wasm_module_inst_t inst, int32_t pointer)
{
	if (!pointer || !wasm_runtime_validate_app_addr(inst, (uint32_t)pointer - 4, 4))
		return "";
	uint32_t bytes = *(uint32_t *)wasm_runtime_addr_app_to_native(inst, (uint32_t)pointer - 4);
	if (!wasm_runtime_validate_app_addr(inst, (uint32_t)pointer, bytes))
		return "";
	const uint16_t *units = (const uint16_t *)wasm_runtime_addr_app_to_native(inst, (uint32_t)pointer);
	std::string out;
	for (uint32_t i = 0; i < bytes / 2; i++)
		out += units[i] < 128 ? (char)units[i] : '?';
	return out;
}

static void w_abort(wasm_exec_env_t env, int32_t message, int32_t file, int32_t line, int32_t column)
{
	std::string what = "abort: " + Text(Inst(env), message) + " at " + Text(Inst(env), file);
	wasm_runtime_set_exception(Inst(env), what.c_str());
}

static void w_log(wasm_exec_env_t env, int32_t message)
{
	printf("log: %s\n", Text(Inst(env), message).c_str());
	fflush(stdout);
}

static void w_error(wasm_exec_env_t env, int32_t message)
{
	printf("log: error: %s\n", Text(Inst(env), message).c_str());
	fflush(stdout);
}

// An error's stack: the module's frames; this host keeps none, so `stack` is the first line.
static int32_t w_stackFrames(wasm_exec_env_t env, int32_t out, int32_t max)
{
	return 0;
}

static int32_t w_stackText(wasm_exec_env_t env, int32_t frames, int32_t count, int32_t out, int32_t max)
{
	return 0;
}

/** The lowest slot no task has, as the module reuses them. */
static int32_t FreeSlot()
{
	for (int32_t slot = 0;; slot++) {
		bool taken = false;
		for (const Task &task : g_tasks)
			taken = taken || task.slot == slot;
		if (!taken)
			return slot;
	}
}

static int32_t w_task(wasm_exec_env_t env, int32_t secondsBits, int32_t fn, int32_t repeat)
{
	float seconds;
	memcpy(&seconds, &secondsBits, 4);
	Task task = { g_now + (double)(int)(seconds * 1000.0f + 0.5f), (uint32_t)fn, FreeSlot(), g_order++ };
	g_tasks.push_back(task);
	return task.slot;
}

static int32_t w_stopTask(wasm_exec_env_t env, int32_t slot)
{
	size_t before = g_tasks.size();
	for (size_t i = g_tasks.size(); i-- > 0;)
		if (g_tasks[i].slot == slot)
			g_tasks.erase(g_tasks.begin() + i);
	return (int32_t)(before - g_tasks.size());
}

static void w_on(wasm_exec_env_t env, int32_t name, int32_t fn, int32_t shape)
{
	g_events[Text(Inst(env), name)].push_back((uint32_t)fn);
}

// A hookchain handler, and what it tells the game: handled() is outcome(1),
// the answer chain_set(-1, cell).
static int32_t w_hook(wasm_exec_env_t env, int32_t id, int32_t fn, int32_t post)
{
	if (!post)
		g_preHooks.push_back((uint32_t)fn);
	return (int32_t)g_preHooks.size();
}

static void w_outcome(wasm_exec_env_t env, int32_t value)
{
	printf("log: outcome %d\n", value);
	fflush(stdout);
}

static void w_chainSet(wasm_exec_env_t env, int32_t index, int32_t value)
{
	printf("log: chain_set %d %d\n", index, value);
	fflush(stdout);
}

// A server with ReGameDLL's and ReHLDS's hookchains: the chains are hooked.
static int32_t w_gameApi(wasm_exec_env_t env)
{
	return 3;
}

static int32_t w_call(wasm_exec_env_t env, int32_t native, int32_t args, int32_t mask, int32_t count)
{
	printf("log: native with %d argument(s)\n", count);
	fflush(stdout);
	return 0;
}

// A server with every library.
static int32_t w_libraryExists(wasm_exec_env_t env, int32_t name, int32_t type)
{
	return 1;
}

static NativeSymbol g_natives[] = {
	{ "abort",         (void *)w_abort,      "(iiii)",   NULL },
	{ "console.log",   (void *)w_log,        "(i)",      NULL },
	{ "console.error", (void *)w_error,      "(i)",      NULL },
	{ "stack_frames",  (void *)w_stackFrames, "(ii)i",   NULL },
	{ "stack_text",    (void *)w_stackText,  "(iiii)i",  NULL },
	{ "task",          (void *)w_task,       "(iii)i",   NULL },
	{ "stop_task",     (void *)w_stopTask,   "(i)i",     NULL },
	{ "on",            (void *)w_on,         "(iii)",    NULL },
	{ "hook",          (void *)w_hook,       "(iii)i",   NULL },
	{ "outcome",       (void *)w_outcome,    "(i)",      NULL },
	{ "chain_set",     (void *)w_chainSet,   "(ii)",     NULL },
	{ "game_api",      (void *)w_gameApi,    "()i",      NULL },
	{ "call",          (void *)w_call,       "(iiii)i",  NULL },
	{ "LibraryExists", (void *)w_libraryExists, "(ii)i", NULL },
	{ "co_entered",    (void *)w_co_entered, "()i",      NULL },
	{ "co_spawn",      (void *)w_co_spawn,   "(iiiii)i", NULL },
	{ "co_suspend",    (void *)w_co_suspend, "(i)",      NULL },
	{ "co_wake",       (void *)w_co_wake,    "()",       NULL },
};

/** module.cpp's Fire, cut down: a handler by table index, its cells converted to its parameters. */
static void Fire(uint32_t fn, const int32_t *cells, int count)
{
	Plugin &p = g_plugins[0];
	wasm_table_inst_t table;
	if (!wasm_runtime_get_export_table_inst(p.inst, "table", &table))
		return;
	wasm_function_inst_t func = wasm_table_get_func_inst(p.inst, &table, fn);
	if (!func)
		return;

	wasm_valkind_t kinds[8];
	wasm_val_t args[8];
	uint32_t params = wasm_func_get_param_count(func, p.inst);
	if (params > 8) params = 8;
	wasm_func_get_param_types(func, p.inst, kinds);
	for (uint32_t i = 0; i < params; i++) {
		int32_t value = (int)i < count ? cells[i] : 0;
		args[i].kind = kinds[i];
		if (kinds[i] == WASM_F64) args[i].of.f64 = value;
		else if (kinds[i] == WASM_F32) args[i].of.f32 = (float)value;
		else if (kinds[i] == WASM_I64) args[i].of.i64 = value;
		else { args[i].kind = WASM_I32; args[i].of.i32 = value; }
	}

	g_currentPlugin = 0;
	p.depth++;
	bool called = wasm_runtime_call_wasm_a(p.env, func, 0, NULL, params, args);
	p.depth--;
	if (!called) {
		MF_PrintSrvConsole("%s: %s", p.name.c_str(), wasm_runtime_get_exception(p.inst));
		wasm_runtime_clear_exception(p.inst);
	}
	if (p.depth == 0 && p.wake)
		DrainJobs(0);
}

static void Call(const char *name)
{
	Plugin &p = g_plugins[0];
	wasm_function_inst_t func = wasm_runtime_lookup_function(p.inst, name);
	if (!func) {
		MF_PrintSrvConsole("no export %s", name);
		return;
	}
	g_currentPlugin = 0;
	p.depth++;
	if (!wasm_runtime_call_wasm(p.env, func, 0, NULL)) {
		MF_PrintSrvConsole("%s: %s", p.name.c_str(), wasm_runtime_get_exception(p.inst));
		wasm_runtime_clear_exception(p.inst);
	}
	p.depth--;
	DrainJobs(0);
}

static void Advance(double ms)
{
	double until = g_now + ms;
	for (;;) {
		int due = -1;
		for (size_t i = 0; i < g_tasks.size(); i++) {
			if (g_tasks[i].at > until) continue;
			if (due < 0 || g_tasks[i].at < g_tasks[due].at
			    || (g_tasks[i].at == g_tasks[due].at && g_tasks[i].order < g_tasks[due].order))
				due = (int)i;
		}
		if (due < 0) break;
		Task task = g_tasks[due];
		g_tasks.erase(g_tasks.begin() + due);
		if (task.at > g_now) g_now = task.at;
		Fire(task.fn, &task.slot, 1);
	}
	g_now = until;
}

int main(int argc, char **argv)
{
	if (argc < 2) {
		fprintf(stderr, "usage: host <plugin.aot> <step>...\n");
		return 2;
	}

	RuntimeInitArgs init;
	memset(&init, 0, sizeof(init));
	init.mem_alloc_type = Alloc_With_Allocator;
	init.mem_alloc_option.allocator.malloc_func = (void *)malloc;
	init.mem_alloc_option.allocator.realloc_func = (void *)realloc;
	init.mem_alloc_option.allocator.free_func = (void *)free;
	init.native_module_name = "env";
	init.native_symbols = g_natives;
	init.n_native_symbols = sizeof(g_natives) / sizeof(g_natives[0]);
	if (!wasm_runtime_full_init(&init)) {
		fprintf(stderr, "runtime failed to start\n");
		return 1;
	}

	FILE *f = fopen(argv[1], "rb");
	if (!f) {
		fprintf(stderr, "no %s\n", argv[1]);
		return 1;
	}
	fseek(f, 0, SEEK_END);
	long size = ftell(f);
	fseek(f, 0, SEEK_SET);
	std::vector<uint8_t> file((size_t)size);
	fread(&file[0], 1, (size_t)size, f);
	fclose(f);

	char error[256];
	wasm_module_t module = wasm_runtime_load(&file[0], (uint32_t)size, error, sizeof(error));
	if (!module) {
		fprintf(stderr, "load: %s\n", error);
		return 1;
	}

	Plugin plugin;
	plugin.name = "fixture";
	plugin.inst = NULL;
	plugin.env = NULL;
	plugin.depth = 1;
	plugin.wake = false;
	plugin.entering = false;
	plugin.stackTop = 0;
	g_plugins.push_back(plugin);
	g_currentPlugin = 0;

	// As module.cpp: 64 KB of stack and no app heap.
	wasm_module_inst_t inst = wasm_runtime_instantiate(module, 64 * 1024, 0, error, sizeof(error));
	if (!inst) {
		fprintf(stderr, "instantiate: %s\n", error);
		return 1;
	}
	g_plugins[0].inst = inst;
	g_plugins[0].env = wasm_runtime_create_exec_env(inst, 64 * 1024);
	g_plugins[0].stackTop = CoCall(g_plugins[0].env, "__co_stack");
	g_plugins[0].depth = 0;
	DrainJobs(0);

	for (int i = 2; i < argc; i++) {
		const char *step = argv[i];
		if (step[0] >= '0' && step[0] <= '9') {
			Advance(atof(step));
		}
		else if (strcmp(step, "hooks") == 0) {
			int32_t cells[4] = { 0, 0, 0, 0 };
			std::vector<uint32_t> handlers = g_preHooks;
			for (size_t k = 0; k < handlers.size(); k++)
				Fire(handlers[k], cells, 4);
		}
		else if (strncmp(step, "leave:", 6) == 0) {
			int32_t cells[4] = { atoi(step + 6), 0, 0, 0 };
			std::vector<uint32_t> handlers = g_events["client_disconnected"];
			for (size_t k = 0; k < handlers.size(); k++)
				Fire(handlers[k], cells, 4);
		}
		else {
			Call(step);
		}
		printf("step: %s parked=%d\n", step, (int)g_plugins[0].coroutines.size());
		fflush(stdout);
	}

	wasm_runtime_destroy_exec_env(g_plugins[0].env);
	wasm_runtime_deinstantiate(inst);
	wasm_runtime_unload(module);
	wasm_runtime_destroy();
	return 0;
}
