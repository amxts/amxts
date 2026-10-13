// A module of the server suites' own: it makes forwards and executes them
// through AMX Mod X's functions for modules (MF_RegisterForward,
// MF_PrepareCellArray, MF_ExecuteForward), as any module does, for
// tests/server/module-forwards.sma and modfw.ts. A Pawn suite loads it by its
// library, after the amxts module has attached.
#include "amxxmodule.h"

static int g_args = -1;
// testmodule_stop, _stop2 and _continue: one cell, stopped by ET_STOP and
// ET_STOP2, and never.
static int g_byStop[3] = { -1, -1, -1 };

void OnPluginsLoaded()
{
	g_args = MF_RegisterForward("testmodule_args", ET_IGNORE, FP_CELL, FP_FLOAT, FP_STRING, FP_ARRAY, FP_ARRAY,
	                            FP_CELL_BYREF, FP_FLOAT_BYREF, FP_STRINGEX, FP_DONE);
	g_byStop[0] = MF_RegisterForward("testmodule_stop", ET_STOP, FP_CELL, FP_DONE);
	g_byStop[1] = MF_RegisterForward("testmodule_stop2", ET_STOP2, FP_CELL, FP_DONE);
	g_byStop[2] = MF_RegisterForward("testmodule_continue", ET_CONTINUE, FP_CELL, FP_DONE);
}

// testmodule_raise_args() - executes testmodule_args with an argument of every kind.
static cell AMX_NATIVE_CALL testmodule_raise_args(AMX *amx, cell *params)
{
	cell numbers[3] = { 4, 5, 6 };
	char bytes[3] = { 'a', 'b', 'c' };
	cell count = 11;
	float speed = 2.5f;
	char text[128] = "ex";
	return MF_ExecuteForward(g_args, (cell)7, 1.5f, "word", MF_PrepareCellArray(numbers, 3), MF_PrepareCharArray(bytes, 3),
	                         &count, &speed, text);
}

// testmodule_raise(which, n) - executes testmodule_stop (0), _stop2 (1) or _continue (2) with n; its answer.
static cell AMX_NATIVE_CALL testmodule_raise(AMX *amx, cell *params)
{
	cell which = params[1];
	return which >= 0 && which < 3 ? MF_ExecuteForward(g_byStop[which], params[2]) : -1;
}

static AMX_NATIVE_INFO g_natives[] = {
	{ "testmodule_raise_args", testmodule_raise_args },
	{ "testmodule_raise", testmodule_raise },
	{ NULL, NULL }
};

void OnAmxxAttach()
{
	MF_AddNatives(g_natives);
}
