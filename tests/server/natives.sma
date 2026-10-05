// The Pawn side of the natives from exports.ts: calls them as any AMX Mod X
// plugin would and checks what it got. Run by the amxts_test_natives
// command; log lines are in the same form as Checks writes them.
#include <amxmodx>
#include <exports>

// Two of the two hundred natives exports.ts registers through nativeFn.
native xt_many_0();
native xt_many_199();

new g_ok, g_failed;

// What came into the forward xt_on_many from exports.ts.
new g_fwId, g_fwWord[32], g_fwCount, Float:g_fwSpeed, bool:g_fwFlag, g_fwList[3], Float:g_fwAt[3], g_fwLong;

// A forward of this plugin's own, which exports.ts subscribes to.
new g_fromPawn;

public plugin_init()
{
	register_plugin("amxts test: natives", "1.0", "amxts");
	register_srvcmd("amxts_test_natives", "run");
	g_fromPawn = CreateMultiForward("xt_from_pawn", ET_IGNORE, FP_CELL, FP_STRING, FP_FLOAT, FP_ARRAY);
}

public run()
{
	g_ok = 0;
	g_failed = 0;
	server_print("[natives] --- run");

	expect_int("integers: xt_sum(2, 40)", xt_sum(2, 40), 42);
	expect_int("the default value: xt_default()", xt_default(), 5);
	expect_int("xt_default(9)", xt_default(9), 9);
	expect_bool("bool: xt_is_even(10)", xt_is_even(10), true);
	expect_bool("bool: xt_is_even(7)", xt_is_even(7), false);
	expect_float("Float: xt_half(5.0)", xt_half(5.0), 2.5);

	new text[64];
	xt_greet("amxts", text, charsmax(text));
	// Cyrillic on purpose: UTF-8 reaches Pawn whole, a letter is not cut in half.
	expect_text("a string in out[]", text, "Привет, amxts!");

	new small[8];
	xt_greet("amxts", small, charsmax(small));
	// Cyrillic on purpose: UTF-8 reaches Pawn whole, a letter is not cut in half.
	expect_text("a short buffer does not cut a letter in half", small, "При");

	// Cyrillic on purpose: UTF-8 reaches Pawn whole, a letter is not cut in half.
	expect_int("Cyrillic arrives whole: xt_length", xt_length("Ёлка"), 4);

	new values[] = { 1, 2, 3, 4 };
	expect_int("an array: xt_total", xt_total(values, sizeof(values)), 10);

	new Float:floats[] = { 1.0, 2.5, -4.0 };
	new Float:scaled[3];
	new written = xt_scaled(floats, sizeof(floats), 2.0, scaled, sizeof(scaled));
	expect_int("an array in out[]: how many are written", written, 3);
	expect_float("scaled[1]", scaled[1], 5.0);
	expect_float("scaled[2]", scaled[2], -8.0);

	new found[32];
	expect_bool("string | null: the key is there", xt_find("map", found, charsmax(found)), true);
	expect_text("string | null: the value", found, "c21_kitty");
	expect_bool("string | null: no key", xt_find("nothing", found, charsmax(found)), false);

	expect_int("a native of two hundred: xt_many_0", xt_many_0(), 0);
	expect_int("a native beyond 128: xt_many_199", xt_many_199(), 199);

	forwardOfEveryKind();
	forwardFromPawn();

	server_print("[natives] %d ok, %d failed", g_ok, g_failed);
	return PLUGIN_HANDLED;
}

// A forward from TypeScript with eight arguments of every kind - to Pawn and to a
// TypeScript subscriber; a string longer than 511 bytes arrives whole.
forwardOfEveryKind()
{
	new heard[128];
	xt_emit_many(heard, charsmax(heard));

	expect_int("forward: a number", g_fwId, 7);
	// Cyrillic on purpose: the forward's strings are UTF-8.
	expect_text("forward: a string", g_fwWord, "раз два");
	expect_int("forward: the third argument", g_fwCount, 42);
	expect_float("forward: Float", g_fwSpeed, 2.5);
	expect_bool("forward: boolean", g_fwFlag, true);
	expect_int("forward: array [2]", g_fwList[2], 3);
	expect_float("forward: Vector [1]", g_fwAt[1], 2.5);
	expect_int("forward: a long string", g_fwLong, 2000);
	expect_text("forward: what the subscriber heard", heard, "7 раз два 42 2.5 true 1,2,3 1.5,2.5,3.5 2000");
}

// A forward this plugin makes and raises, to exports.ts's TypeScript subscriber.
forwardFromPawn()
{
	new list[] = { 4, 5, 6 };
	new ret;
	// Cyrillic on purpose: the forward's strings are UTF-8.
	ExecuteForward(g_fromPawn, ret, 9, "слово", 1.5, PrepareArray(list, sizeof(list)));

	new heard[64];
	xt_heard_from_pawn(heard, charsmax(heard));
	// Cyrillic on purpose: the forward's strings are UTF-8.
	expect_text("a Pawn plugin's forward reaches a TypeScript subscriber", heard, "9 слово 1.5 4,5,6");
}

public xt_on_many(id, const word[], count, Float:speed, bool:flag, const list[], const Float:at[], const long[])
{
	g_fwId = id;
	copy(g_fwWord, charsmax(g_fwWord), word);
	g_fwCount = count;
	g_fwSpeed = speed;
	g_fwFlag = flag;
	for (new i = 0; i < 3; i++) {
		g_fwList[i] = list[i];
		g_fwAt[i] = at[i];
	}
	g_fwLong = strlen(long);
}

expect_int(const what[], got, expected)
{
	if (got == expected) {
		g_ok++;
		server_print("[natives] ok   %s: %d", what, got);
		return;
	}
	g_failed++;
	server_print("[natives] FAIL %s: got %d, expected %d", what, got, expected);
}

expect_bool(const what[], bool:got, bool:expected)
{
	expect_int(what, _:got, _:expected);
}

expect_float(const what[], Float:got, Float:expected)
{
	if (floatabs(got - expected) < 0.001) {
		g_ok++;
		server_print("[natives] ok   %s: %f", what, got);
		return;
	}
	g_failed++;
	server_print("[natives] FAIL %s: got %f, expected %f", what, got, expected);
}

expect_text(const what[], const got[], const expected[])
{
	if (equal(got, expected)) {
		g_ok++;
		server_print("[natives] ok   %s: %s", what, got);
		return;
	}
	g_failed++;
	server_print("[natives] FAIL %s: got %s, expected %s", what, got, expected);
}
