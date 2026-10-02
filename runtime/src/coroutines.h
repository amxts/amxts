// The coroutine scheduler: how a host runs an async function of a plugin as a
// coroutine, parks it at an await and resumes it. runtime/src/module.cpp is
// the host on a server; runtime/test/async-wamr is the same code under a
// small host of its own, which is how it is run without one.
//
// Included after the host has declared, as module.cpp does:
//   struct Plugin { name, inst, env, depth, wake, entering, coroutines, running }
//   std::vector<Plugin> g_plugins;  int g_currentPlugin;
//   cell g_outcome; bool g_outcomeSaid;  MF_PrintSrvConsole(fmt, ...);
//   wasm_module_inst_t Inst(wasm_exec_env_t);
#pragma once

#include "coroutine.h"

// An async function runs as a coroutine of its own; as/promise.ts tells the
// whole story. The plugin's side asks the host for three things:
//
//   co_spawn    run this async function's body now, as a coroutine
//   co_suspend  park the running one: Asyncify unwinds it back to co_spawn
//   co_wake     there are jobs, to run once the plugin's stack is empty
//
// and the host resumes a parked one from DrainJobs - at the end of the Fire
// whose event settled what it was waiting for, when nothing of the plugin is
// left on the native stack. Resuming puts its shadow stack back where it was
// (__co_restore) and rewinds it by calling the same table entry with the same
// arguments. A plugin that never makes a Promise exports none of this and
// pays nothing for it.

// Task ids for sleep() and AbortSignal.timeout(), one sequence for every
// plugin: remove_task finds a task by id alone, so two plugins counting from
// the same number would stop each other's timers.
static int32_t g_nextCoId = 0x60000000;

/**
 * Calls one of the scheduler's exports, or Asyncify's, with up to three i32
 * arguments. Returns the i32 it gives back; `ok` says whether it trapped.
 */
static uint32_t CoCall(wasm_exec_env_t env, const char *name, uint32_t argc = 0,
                       uint32_t a = 0, uint32_t b = 0, uint32_t c = 0, bool *ok = NULL)
{
	wasm_module_inst_t inst = wasm_runtime_get_module_inst(env);
	wasm_function_inst_t f = wasm_runtime_lookup_function(inst, name);
	uint32_t argv[3] = { a, b, c };
	bool called = f && wasm_runtime_call_wasm(env, f, argc, argv);
	if (ok) *ok = called;
	if (called)
		return argv[0];

	int index = PluginOf(inst);
	std::string context = std::string(" (in ") + name + ")";
	PrintFailure(index, TakeFailure(index, inst, f ? wasm_runtime_get_exception(inst) : "missing export"), context.c_str());
	return 0;
}

/**
 * One call into a coroutine: its first run from co_spawn, or a resume from
 * DrainJobs. Whatever happens inside, the shadow stack pointer comes back to
 * where it was - a resumed body returns to the base it was started at, which
 * may be deeper than the top level it is resumed from.
 */
static int RunCoroutine(int index, wasm_exec_env_t env, int32_t id, bool rewind)
{
	std::map<int32_t, Coroutine>::iterator found = g_plugins[index].coroutines.find(id);
	if (found == g_plugins[index].coroutines.end())
		return CO_FINISHED;
	Coroutine co = found->second;
	wasm_module_inst_t inst = wasm_runtime_get_module_inst(env);

	uint32_t outer = CoCall(env, "__co_stack");

	if (rewind) {
		uint32_t low = co.base - CoCall(env, "__co_saved", 1, (uint32_t)id);
		// Between the coroutine's base and the top lie words from frames that
		// have long returned; the collector scans up to the top, so they must
		// read as nothing rather than as stale pointers.
		if (outer > co.base && wasm_runtime_validate_app_addr(inst, co.base, outer - co.base))
			memset(wasm_runtime_addr_app_to_native(inst, co.base), 0, outer - co.base);
		CoCall(env, "__co_stack_set", 1, low);
		CoCall(env, "__co_restore", 2, (uint32_t)id, low);
		CoCall(env, "asyncify_start_rewind", 1, (uint32_t)co.buffer);
	}
	else {
		g_plugins[index].entering = true;
	}

	g_plugins[index].running.push_back(id);
	int prev = g_currentPlugin;
	g_currentPlugin = index;

	std::vector<uint32_t> argv(co.cells);
	if (argv.size() < 2)
		argv.resize(2);
	bool called = wasm_runtime_call_indirect(env, co.fn, (uint32_t)co.cells.size(), &argv[0]);

	g_currentPlugin = prev;
	g_plugins[index].running.pop_back();
	g_plugins[index].entering = false;

	if (!called) {
		Failure failure = TakeFailure(index, inst, wasm_runtime_get_exception(inst));
		uint32_t state = CoCall(env, "asyncify_get_state");
		if (state == 1) {
			MF_PrintSrvConsole("[amxts] %s: an async function needs more than %d bytes to wait in (%s); it was dropped\n",
			                   PluginName(index), CO_BUFFER, failure.message.c_str());
			CoCall(env, "asyncify_stop_unwind");
		}
		else {
			PrintFailure(index, failure, " - in an async function, which was dropped; the plugin runs on");
			if (state == 2)
				CoCall(env, "asyncify_stop_rewind");
		}
		CoCall(env, "__co_stack_set", 1, outer);
		g_plugins[index].coroutines.erase(id);
		return CO_TRAPPED;
	}

	if (CoCall(env, "asyncify_get_state") != 1) {
		CoCall(env, "__co_stack_set", 1, outer);
		g_plugins[index].coroutines.erase(id);
		return CO_FINISHED;
	}

	CoCall(env, "asyncify_stop_unwind");
	std::map<int32_t, Coroutine>::iterator after = g_plugins[index].coroutines.find(id);
	bool drop = after == g_plugins[index].coroutines.end() || after->second.drop;

	if (drop) {
		CoCall(env, "__co_stack_set", 1, outer);
		g_plugins[index].coroutines.erase(id);
		return CO_DROPPED;
	}

	// Parked: its frames lie between the stack pointer and its base.
	CoCall(env, "__co_save", 3, (uint32_t)id, CoCall(env, "__co_stack"), co.base);
	CoCall(env, "__co_stack_set", 1, outer);
	return CO_PARKED;
}

/**
 * Runs a plugin's jobs - the reactions to promises that have settled, and the
 * coroutines they resume - once none of its wasm is on the native stack.
 *
 * Whatever a resumed handler says with handled() is nobody's answer: the
 * event it was handling was answered when it first parked. So the outcome of
 * the Fire around this is kept aside.
 */
static void DrainJobs(int index)
{
	if (index < 0 || (size_t)index >= g_plugins.size())
		return;
	if (!g_plugins[index].wake || g_plugins[index].depth > 0 || !g_plugins[index].env)
		return;

	g_plugins[index].wake = false;
	wasm_exec_env_t env = g_plugins[index].env;

	bool saidBefore = g_outcomeSaid;
	cell before = g_outcome;
	int prev = g_currentPlugin;
	g_currentPlugin = index;
	g_plugins[index].depth++;

	// Nothing of the plugin is running, so its shadow stack is empty: the
	// pointer goes back to the top, where a trap that left it lower (a trap
	// skips the epilogues that raise it) would leave stale frames that the
	// collector scans.
	uint32_t top = g_plugins[index].stackTop;
	if (top)
		CoCall(env, "__co_stack_set", 1, top);
	else
		top = CoCall(env, "__co_stack");

	for (;;) {
		g_outcomeSaid = false;
		bool ok = true;
		int32_t id = (int32_t)CoCall(env, "__co_next", 0, 0, 0, 0, &ok);
		if (!ok) {
			// A .then callback trapped: it has been said, and the next job goes on.
			CoCall(env, "__co_stack_set", 1, top);
			continue;
		}
		if (id == 0)
			break;

		int outcome = RunCoroutine(index, env, id, true);
		CoCall(env, "__co_done", 1, (uint32_t)outcome);
	}

	g_plugins[index].depth--;
	g_currentPlugin = prev;
	g_outcomeSaid = saidBefore;
	g_outcome = before;
}

// co_entered() - whether co_spawn is calling this async function's body.
static int32_t w_co_entered(wasm_exec_env_t env)
{
	int index = PluginOf(Inst(env));
	if (index < 0)
		return 0;
	bool entering = g_plugins[index].entering;
	g_plugins[index].entering = false;
	return entering ? 1 : 0;
}

// co_spawn(fn, args, cells, id, buffer) - an async function was called: run
// its body now, through the table, as the coroutine `id`.
static int32_t w_co_spawn(wasm_exec_env_t env, int32_t fn, int32_t args, int32_t cells, int32_t id, int32_t buffer)
{
	wasm_module_inst_t inst = Inst(env);
	int index = PluginOf(inst);
	if (index < 0 || cells < 0 || cells > CO_MAX_CELLS
	    || !wasm_runtime_validate_app_addr(inst, (uint32_t)args, (uint32_t)cells * 4))
		return CO_TRAPPED;

	const uint32_t *from = (const uint32_t *)wasm_runtime_addr_app_to_native(inst, (uint32_t)args);

	Coroutine co;
	co.id = id;
	co.fn = (uint32_t)fn;
	co.cells.assign(from, from + cells);
	co.buffer = buffer;
	co.base = CoCall(env, "__co_stack");
	co.drop = false;
	g_plugins[index].coroutines[id] = co;

	return RunCoroutine(index, env, id, false);
}

// co_suspend(drop) - park the running coroutine, or, rewinding, arrive back
// where it parked. With drop it is not parked but let go: it gave up.
static void w_co_suspend(wasm_exec_env_t env, int32_t drop)
{
	if (CoCall(env, "asyncify_get_state") == 2) {
		CoCall(env, "asyncify_stop_rewind");
		return;
	}

	int index = PluginOf(Inst(env));
	if (index < 0 || g_plugins[index].running.empty()) {
		wasm_runtime_set_exception(Inst(env), "await outside an async function");
		return;
	}

	int32_t id = g_plugins[index].running.back();
	std::map<int32_t, Coroutine>::iterator co = g_plugins[index].coroutines.find(id);
	if (co == g_plugins[index].coroutines.end()) {
		wasm_runtime_set_exception(Inst(env), "await in a coroutine the host does not know");
		return;
	}

	co->second.drop = drop != 0;
	CoCall(env, "asyncify_start_unwind", 1, (uint32_t)co->second.buffer);
}

// co_wake() - jobs are queued: run them when this plugin's stack is empty.
static void w_co_wake(wasm_exec_env_t env)
{
	int index = PluginOf(Inst(env));
	if (index >= 0)
		g_plugins[index].wake = true;
}

// co_id() - a task id no other plugin has.
static int32_t w_co_id(wasm_exec_env_t env)
{
	(void)env;
	if (g_nextCoId >= 0x7fff0000)
		g_nextCoId = 0x60000000;
	return g_nextCoId++;
}
