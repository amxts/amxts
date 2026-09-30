// Pawn-сторона нативов из exports.ts: вызывает их так, как вызвал бы любой
// плагин AMX Mod X, и сверяет, что получила. Запускается командой
// amxts_test_natives; строки лога - в том же виде, что у Checks.
#include <amxmodx>
#include <exports>

// Два из двухсот нативов, которые exports.ts регистрирует через nativeFn.
native xt_many_0();
native xt_many_199();

new g_ok, g_failed;

// Что пришло в форвард xt_on_many из exports.ts.
new g_fwId, g_fwWord[32], g_fwCount, Float:g_fwSpeed, bool:g_fwFlag, g_fwList[3], Float:g_fwAt[3], g_fwLong;

public plugin_init()
{
	register_plugin("amxts test: natives", "1.0", "amxts");
	register_srvcmd("amxts_test_natives", "run");
}

public run()
{
	g_ok = 0;
	g_failed = 0;
	server_print("[natives] --- run");

	expect_int("целые: xt_sum(2, 40)", xt_sum(2, 40), 42);
	expect_int("значение по умолчанию: xt_default()", xt_default(), 5);
	expect_int("xt_default(9)", xt_default(9), 9);
	expect_bool("bool: xt_is_even(10)", xt_is_even(10), true);
	expect_bool("bool: xt_is_even(7)", xt_is_even(7), false);
	expect_float("Float: xt_half(5.0)", xt_half(5.0), 2.5);

	new text[64];
	xt_greet("amxts", text, charsmax(text));
	expect_text("строка в out[]", text, "Привет, amxts!");

	new small[8];
	xt_greet("amxts", small, charsmax(small));
	expect_text("короткий буфер не режет букву пополам", small, "При");

	expect_int("кириллица приходит целиком: xt_length", xt_length("Ёлка"), 4);

	new values[] = { 1, 2, 3, 4 };
	expect_int("массив: xt_total", xt_total(values, sizeof(values)), 10);

	new Float:floats[] = { 1.0, 2.5, -4.0 };
	new Float:scaled[3];
	new written = xt_scaled(floats, sizeof(floats), 2.0, scaled, sizeof(scaled));
	expect_int("массив в out[]: сколько записано", written, 3);
	expect_float("scaled[1]", scaled[1], 5.0);
	expect_float("scaled[2]", scaled[2], -8.0);

	new found[32];
	expect_bool("string | null: ключ есть", xt_find("map", found, charsmax(found)), true);
	expect_text("string | null: значение", found, "c21_kitty");
	expect_bool("string | null: ключа нет", xt_find("nothing", found, charsmax(found)), false);

	expect_int("натив из двухсот: xt_many_0", xt_many_0(), 0);
	expect_int("натив сверх 128: xt_many_199", xt_many_199(), 199);

	forwardOfEveryKind();

	server_print("[natives] %d ok, %d failed", g_ok, g_failed);
	return PLUGIN_HANDLED;
}

// Форвард из TypeScript с восемью аргументами всех видов - в Pawn и в
// TypeScript-подписчика; строка длиннее 511 байт приходит целиком.
forwardOfEveryKind()
{
	new heard[128];
	xt_emit_many(heard, charsmax(heard));

	expect_int("форвард: число", g_fwId, 7);
	expect_text("форвард: строка", g_fwWord, "раз два");
	expect_int("форвард: третий аргумент", g_fwCount, 42);
	expect_float("форвард: Float", g_fwSpeed, 2.5);
	expect_bool("форвард: boolean", g_fwFlag, true);
	expect_int("форвард: массив [2]", g_fwList[2], 3);
	expect_float("форвард: Vector [1]", g_fwAt[1], 2.5);
	expect_int("форвард: длинная строка", g_fwLong, 2000);
	expect_text("форвард: что услышал подписчик", heard, "7 раз два 42 2.5 true 1,2,3 1.5,2.5,3.5 2000");
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
