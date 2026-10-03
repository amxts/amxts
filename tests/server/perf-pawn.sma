// The Pawn side of the speed check (perf.ts): the same operations as Pawn
// plugins write them, each the best of three runs, timed with perf.ts's
// clock and handed back to it. Run by amxts_perf_pawn <player id>, which
// perf.ts sends.
#include <amxmodx>
#include <fun>
#include <reapi>
#include <perf>

#define TRIES 3
#define MANY 1000000
#define FEW 100000
#define FRAMES 10000

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
	HOT_PATH
}

new HookChain:g_hook;
new g_sink;
new Float:g_fsink;
new g_writes;

// What the hot path keeps about each player between frames.
new Float:g_x[33], Float:g_y[33], Float:g_speed[33], Float:g_top[33], Float:g_travelled[33];

public plugin_init()
{
	register_plugin("amxts test: perf", "1.0", "amxts");
	register_srvcmd("amxts_perf_pawn", "measure");
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
	new Float:origin[3];
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

	new Float:before = best(RESET, id, FEW);
	EnableHookChain(g_hook);
	new Float:heard = best(RESET, id, FEW);
	DisableHookChain(g_hook);
	perf_report("event", (heard - before) * 1000000.0 / float(FEW));

	perf_report("remainder", best(REMAINDER, id, 1));
	perf_report("fractions", best(FRACTIONS, id, 1));
	perf_report("hot path", best(HOT_PATH, id, 1));
	perf_report("hot path writes", float(g_writes));
}
