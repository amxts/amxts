// The forwards of a C++ module reach a TypeScript subscriber: the suites' own
// module (runtime/test/test-module) makes and executes them through AMX Mod
// X's functions for modules, this plugin hears them as any Pawn plugin and
// modfw.ts subscribes. Loading the module by its library here attaches it
// after the amxts module. Run by the amxts_test_module_forwards command; log
// lines are in the same form as Checks writes them.
#include <amxmodx>
#include <modfw>

#pragma reqlib testmodule
#if !defined AMXMODX_NOAUTOLOAD
	#pragma loadlib testmodule
#endif

native testmodule_raise_args();
native testmodule_raise(which, n);

new g_ok, g_failed;

public plugin_init()
{
	register_plugin("amxts test: module forwards", "1.0", "amxts");
	register_srvcmd("amxts_test_module_forwards", "run");
}

public run()
{
	g_ok = 0;
	g_failed = 0;
	server_print("[module-forwards] --- run");

	new heard[128];
	expect_int("a module's forward answers ET_IGNORE's 0", testmodule_raise_args(), 0);
	modfw_heard_args(heard, charsmax(heard));
	// count and text are what this plugin's public left in them.
	expect_text("a module's forward reaches a TypeScript subscriber", heard, "7 1.5 word 4,5,6 97,98,99 12 2.5 changed");

	expect_int("ET_STOP: stopped by PLUGIN_HANDLED", testmodule_raise(0, 1), PLUGIN_HANDLED);
	expect_int("ET_STOP: through", testmodule_raise(0, 2), 0);
	expect_int("ET_STOP2: stopped by PLUGIN_HANDLED", testmodule_raise(1, 1), PLUGIN_HANDLED);
	expect_int("ET_STOP2: through, the biggest answer", testmodule_raise(1, 3), 3);
	expect_int("ET_CONTINUE: never stopped", testmodule_raise(2, 1), 1);
	modfw_heard_stops(heard, charsmax(heard));
	expect_text("a forward a Pawn public stops does not reach a TypeScript subscriber", heard, "stop:2 stop2:3 continue:1");

	server_print("[module-forwards] %d ok, %d failed", g_ok, g_failed);
	return PLUGIN_HANDLED;
}

public testmodule_args(id, Float:speed, const word[], const numbers[], const bytes[], &count, &Float:rate, text[])
{
	count = 12;
	copy(text, 127, "changed");
}

public testmodule_stop(n)
{
	return n == 1 ? PLUGIN_HANDLED : PLUGIN_CONTINUE;
}

public testmodule_stop2(n)
{
	return n;
}

public testmodule_continue(n)
{
	return n;
}

expect_int(const what[], got, expected)
{
	if (got == expected) {
		g_ok++;
		server_print("[module-forwards] ok   %s: %d", what, got);
		return;
	}
	g_failed++;
	server_print("[module-forwards] FAIL %s: got %d, expected %d", what, got, expected);
}

expect_text(const what[], const got[], const expected[])
{
	if (equal(got, expected)) {
		g_ok++;
		server_print("[module-forwards] ok   %s: %s", what, got);
		return;
	}
	g_failed++;
	server_print("[module-forwards] FAIL %s: got %s, expected %s", what, got, expected);
}
