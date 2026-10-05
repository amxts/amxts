#ifndef MODULECONFIG_H
#define MODULECONFIG_H

#define MODULE_NAME    "amxts Runtime"
#define MODULE_VERSION "0.1"
#define MODULE_AUTHOR  "amxts"
#define MODULE_URL     ""
#define MODULE_LOGTAG  "AMXTS"
#define MODULE_LIBRARY "amxts"
#define MODULE_LIBCLASS ""
#define MODULE_DATE __DATE__

// A Metamod plugin too: AMX Mod X loads it into Metamod, keeps it loaded
// across map changes, and the engine's functions and gpGlobals are its. What
// lives one map starts as the host plugin loads the plugins and ends in
// AMXX_PluginsUnloaded (Teardown).
#define USE_METAMOD

#define FN_AMXX_ATTACH OnAmxxAttach
#define FN_AMXX_DETACH OnAmxxDetach
#define FN_AMXX_PLUGINSLOADED OnPluginsLoaded
#define FN_AMXX_PLUGINSUNLOADED OnPluginsUnloaded

// The frame: the timers, the responses, the watcher and the `frame` event.
#define FN_StartFrame_Post StartFrame_Post
// The clients' and the server's events, heard where AMX Mod X hears them, after it.
#define FN_DispatchSpawn DispatchSpawn
#define FN_ServerActivate_Post ServerActivate_Post
#define FN_ServerDeactivate ServerDeactivate
#define FN_ClientConnect ClientConnect
#define FN_ClientConnect_Post ClientConnect_Post
#define FN_ClientDisconnect ClientDisconnect
#define FN_ClientPutInServer_Post ClientPutInServer_Post
#define FN_ClientUserInfoChanged_Post ClientUserInfoChanged_Post
#define FN_ClientKill_Post ClientKill_Post
#define FN_CmdStart_Post CmdStart_Post
#define FN_ChangeLevel ChangeLevel

#endif
