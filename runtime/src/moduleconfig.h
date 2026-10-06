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
// lives one map starts as the plugins load - as the module attaches on the
// first map, in AMXX_PluginsLoaded on the rest - and ends in
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
// The players' commands: the `command` event and the plugins' commands.
#define FN_ClientCommand ClientCommand
#define FN_CmdStart_Post CmdStart_Post
#define FN_ChangeLevel ChangeLevel
// The engine module's forwards and a client's file that differs; the log's
// hook goes into Metamod's table at attach (AlertMessage in module.cpp).
#define FN_DispatchThink DispatchThink
#define FN_DispatchKeyValue DispatchKeyValue
#define FN_PlaybackEvent PlaybackEvent
#define FN_InconsistentFile InconsistentFile
// What enginehooks.h hears: messages, touches, and fakemeta's functions.
#define FN_MessageBegin MessageBegin
#define FN_MessageEnd MessageEnd
#define FN_WriteByte WriteByte
#define FN_WriteChar WriteChar
#define FN_WriteShort WriteShort
#define FN_WriteLong WriteLong
#define FN_WriteAngle WriteAngle
#define FN_WriteCoord WriteCoord
#define FN_WriteString WriteString
#define FN_WriteEntity WriteEntity
#define FN_DispatchTouch DispatchTouch
#define FN_SetModel SetModel
#define FN_EmitSound EmitSound
#define FN_Voice_SetClientListening Voice_SetClientListening
#define FN_PrecacheModel PrecacheModel
#define FN_PrecacheSound PrecacheSound
#define FN_PrecacheGeneric PrecacheGeneric
#define FN_PrecacheModel_Post PrecacheModel_Post
#define FN_PrecacheSound_Post PrecacheSound_Post
#define FN_PrecacheGeneric_Post PrecacheGeneric_Post
#define FN_GetGameDescription GetGameDescription

#endif
