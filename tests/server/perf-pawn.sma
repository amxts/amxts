// The Pawn side of the speed check (perf.ts): the same operations as Pawn
// plugins write them, each the best of three runs, timed with perf.ts's
// clock and handed back to it. Run by amxts_perf_pawn <player id>, which
// perf.ts sends, amxts_perf_pawn_timers, once a round of timers, and
// amxts_perf_pawn_commands, for how many commands its handler got, and
// amxts_perf_pawn_menu <player id>, which opens its menu on the bot. What
// only Pawn can time on perf.ts's side - a forward reaching it, a call of its
// native - is timed here too and handed back with perf_ours.
#include <amxmodx>
#include <fun>
#include <reapi>
#include <perf>

#define TRIES 3
#define MANY 1000000
#define FEW 100000
#define FRAMES 10000
#define TIMERS 300
#define TASK_ID 7300

// The native perf-lib.sma registers.
native perf_lib_echo(value);

enum
{
	NATIVE,
	MONEY_READ,
	HEALTH_READ,
	HEALTH_WRITE,
	MONEY_HUD,
	ORIGIN_READ,
	RESET,
	REMAINDER,
	FRACTIONS,
	HOT_PATH,
	STRING_IN,
	STRING_OUT,
	TIMER_ARMED,
	FORWARD_RELAYED,
	FORWARD_PAWN,
	FORWARD_NOBODY,
	ECHO_OURS,
	ECHO_PAWN
}

new HookChain:g_hook;
new g_sink;
new Float:g_fsink;
new g_writes;
new g_commands;
new g_choices;

// The menu perf.ts's bot chooses from: its handler shows it again.
new g_menu;

// Three forwards: client_impulse, which no plugin has a public for - the
// module hears a player's impulse in the game's CmdStart itself, so a
// forward of that name costs what one nobody hears does; one to a public of
// this plugin's; one nobody hears.
new g_impulse, g_heard, g_nobody;

// The timers armed at once: how many have fired this round, when the first
// did, and the best round, in milliseconds from the first to the last.
new g_fired;
new Float:g_firstFired;
new Float:g_firing = 1000000.0;

// What the hot path keeps about each player between frames.
new Float:g_x[33], Float:g_y[33], Float:g_speed[33], Float:g_top[33], Float:g_travelled[33];

public plugin_init()
{
	register_plugin("amxts test: perf", "1.0", "amxts");
	register_srvcmd("amxts_perf_pawn", "measure");
	register_srvcmd("amxts_perf_pawn_timers", "arm_timers");
	register_srvcmd("amxts_perf_pawn_commands", "report_commands");
	register_clcmd("amxts_perf_pawn_command", "on_command");
	register_srvcmd("amxts_perf_pawn_menu", "show_menu_to");
	g_menu = menu_create("Perf", "on_menu");
	menu_additem(g_menu, "choose");
	g_impulse = CreateMultiForward("client_impulse", ET_IGNORE, FP_CELL, FP_CELL);
	g_heard = CreateMultiForward("perf_heard", ET_IGNORE, FP_CELL, FP_CELL);
	g_nobody = CreateMultiForward("perf_nobody", ET_IGNORE, FP_CELL, FP_CELL);
	if (!LibraryExists("reapi", LibType_Library)) return;
	g_hook = RegisterHookChain(RG_CBasePlayer_ResetMaxSpeed, "on_reset", false);
	DisableHookChain(g_hook);
}

// perf.ts, whose natives these are, is built only when its suite runs, and
// plain HLDS has no ReAPI: this plugin loads without either, and is asked to
// measure only where both are.
public plugin_natives()
{
	set_module_filter("perf_modules");
	set_native_filter("perf_natives");
}

public perf_modules(const module[], LibType:type)
{
	return PLUGIN_HANDLED;
}

public perf_natives(const name[], index, trap)
{
	return PLUGIN_HANDLED;
}

public on_reset(id)
{
	g_sink++;
	return HC_CONTINUE;
}

public perf_heard(id, impulse)
{
	g_sink++;
}

public on_command(id)
{
	g_commands++;
	return PLUGIN_HANDLED;
}

public show_menu_to()
{
	menu_display(read_argv_int(1), g_menu);
	return PLUGIN_HANDLED;
}

public on_menu(id, menu, item)
{
	if (item < 0) return PLUGIN_HANDLED;
	g_choices++;
	menu_display(id, g_menu);
	return PLUGIN_HANDLED;
}

// perf.ts sends the bot's commands, to this plugin's handler and its own, last.
public report_commands()
{
	perf_report("commands", float(g_commands));
	perf_report("choices", float(g_choices));
}

// A task that is removed before it runs.
public idle()
{
}

public arm_timers()
{
	for (new i = 0; i < TIMERS; i++) set_task(0.1, "on_timer");
}

// One of the timers armed at once: the first and the last of a round read the clock.
public on_timer()
{
	g_fired++;
	if (g_fired == 1) g_firstFired = perf_now();
	if (g_fired < TIMERS) return;
	g_firing = floatmin(g_firing, perf_now() - g_firstFired);
	g_fired = 0;
	perf_report("timer firing", g_firing * 1000000.0 / float(TIMERS - 1));
}

count_primes(below)
{
	new count = 0;
	for (new n = 2; n < below; n++)
	{
		new bool:prime = true;
		for (new d = 2; d * d <= n; d++)
		{
			if (n % d == 0)
			{
				prime = false;
				break;
			}
		}
		if (prime) count++;
	}
	return count;
}

Float:sum_distances(count)
{
	new Float:total = 0.0;
	for (new i = 0; i < count; i++)
	{
		new Float:fi = float(i);
		new Float:dx = fi * 0.5 - 100.0;
		new Float:dy = fi * 0.25 + 3.0;
		new Float:dz = 64.0 - fi * 0.125;
		total += floatsqroot(dx * dx + dy * dy + dz * dz);
	}
	return total;
}

hot_path()
{
	arrayset(g_x, 0, sizeof(g_x));
	arrayset(g_y, 0, sizeof(g_y));
	arrayset(g_speed, 0, sizeof(g_speed));
	arrayset(g_top, 0, sizeof(g_top));
	arrayset(g_travelled, 0, sizeof(g_travelled));
	new writes = 0;
	new Float:origin[3], Float:velocity[3];
	for (new frame = 0; frame < FRAMES; frame++)
	{
		for (new id = 1; id <= MaxClients; id++)
		{
			if (!is_user_alive(id)) continue;
			get_entvar(id, var_origin, origin);
			get_entvar(id, var_velocity, velocity);
			new Float:speed = floatsqroot(velocity[0] * velocity[0] + velocity[1] * velocity[1]);
			new Float:dx = origin[0] - g_x[id];
			new Float:dy = origin[1] - g_y[id];
			g_travelled[id] += floatsqroot(dx * dx + dy * dy);
			g_x[id] = origin[0];
			g_y[id] = origin[1];
			g_speed[id] = speed;
			if (speed > g_top[id]) g_top[id] = speed;
			if ((frame + id) % 2500 == 0)
			{
				set_user_health(id, 100);
				writes++;
			}
		}
	}
	return writes;
}

// One run of a measure: `count` operations, or the whole of one.
run(what, id, count)
{
	new Float:origin[3], name[32], ret;
	switch (what)
	{
		case NATIVE: for (new i = 0; i < count; i++) g_sink += is_user_alive(id);
		case MONEY_READ: for (new i = 0; i < count; i++) g_sink += get_member(id, m_iAccount);
		case HEALTH_READ: for (new i = 0; i < count; i++) g_sink += get_user_health(id);
		case HEALTH_WRITE: for (new i = 0; i < count; i++) set_user_health(id, 100);
		case MONEY_HUD: for (new i = 0; i < count; i++) rg_add_account(id, 800, AS_SET);
		case ORIGIN_READ:
		{
			for (new i = 0; i < count; i++)
			{
				get_entvar(id, var_origin, origin);
				g_fsink += origin[0];
			}
		}
		case RESET: for (new i = 0; i < count; i++) rg_reset_maxspeed(id);
		case REMAINDER: g_sink += count_primes(200000);
		case FRACTIONS: g_fsink += sum_distances(MANY);
		case HOT_PATH: g_writes = hot_path();
		case STRING_IN: for (new i = 0; i < count; i++) g_sink += strlen("hello, world");
		case STRING_OUT: for (new i = 0; i < count; i++) g_sink += get_user_name(id, name, charsmax(name));
		case TIMER_ARMED:
		{
			for (new i = 0; i < count; i++)
			{
				set_task(1.0, "idle", TASK_ID);
				remove_task(TASK_ID);
			}
		}
		case FORWARD_RELAYED: for (new i = 0; i < count; i++) ExecuteForward(g_impulse, ret, id, 0);
		case FORWARD_PAWN: for (new i = 0; i < count; i++) ExecuteForward(g_heard, ret, id, 0);
		case FORWARD_NOBODY: for (new i = 0; i < count; i++) ExecuteForward(g_nobody, ret, id, 0);
		case ECHO_OURS: for (new i = 0; i < count; i++) g_sink += perf_echo(i);
		case ECHO_PAWN: for (new i = 0; i < count; i++) g_sink += perf_lib_echo(i);
	}
}

// The best of three runs, in milliseconds.
Float:best(what, id, count)
{
	new Float:fastest = 1000000.0;
	for (new t = 0; t < TRIES; t++)
	{
		new Float:start = perf_now();
		run(what, id, count);
		fastest = floatmin(fastest, perf_now() - start);
	}
	return fastest;
}

// Nanoseconds an operation, reported under `name`.
report_each(const name[], what, id, count)
{
	perf_report(name, best(what, id, count) * 1000000.0 / float(count));
}

// The same for perf.ts's side.
report_ours(const name[], what, id, count)
{
	perf_ours(name, best(what, id, count) * 1000000.0 / float(count));
}

public measure()
{
	new arg[8];
	read_argv(1, arg, charsmax(arg));
	new id = str_to_num(arg);

	report_each("native", NATIVE, id, MANY);
	report_each("money read", MONEY_READ, id, MANY);
	report_each("health read", HEALTH_READ, id, MANY);
	report_each("health write", HEALTH_WRITE, id, MANY);
	report_each("money with its HUD", MONEY_HUD, id, FEW);
	report_each("origin read", ORIGIN_READ, id, FEW);
	report_each("origin into a vector", ORIGIN_READ, id, MANY);
	report_each("string in", STRING_IN, id, FEW);
	// player.name is get_user_name on perf.ts's side.
	report_each("string out", STRING_OUT, id, FEW);
	report_each("player.name", STRING_OUT, id, FEW);
	report_each("timer armed", TIMER_ARMED, id, FEW);

	report_each("relay with no listener", FORWARD_NOBODY, id, FEW);
	report_ours("relay with no listener", FORWARD_RELAYED, id, FEW);
	// perf.ts times its own listener, on a bot's impulse.
	report_each("forward to a listener", FORWARD_PAWN, id, FEW);

	report_each("Pawn calls a plugin", ECHO_PAWN, id, FEW);
	report_ours("Pawn calls a plugin", ECHO_OURS, id, FEW);


	new Float:before = best(RESET, id, FEW);
	EnableHookChain(g_hook);
	new Float:heard = best(RESET, id, FEW);
	DisableHookChain(g_hook);
	// One hookchain listener against both layers of perf.ts's: its raw hook and its event listener.
	perf_report("raw hook", (heard - before) * 1000000.0 / float(FEW));
	perf_report("event", (heard - before) * 1000000.0 / float(FEW));

	perf_report("remainder", best(REMAINDER, id, 1));
	perf_report("fractions", best(FRACTIONS, id, 1));
	perf_report("hot path", best(HOT_PATH, id, 1));
	perf_report("hot path writes", float(g_writes));
}
