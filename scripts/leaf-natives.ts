/**
 * The natives that never run a plugin's code while they run - leaf natives -
 * read from the sources of AMX Mod X 1.10 and its stock modules.
 *
 * A native is on the list when nothing it does, directly or through what it
 * calls, can reach a plugin: it executes no forward and no callback
 * (ExecuteForward, MF_ExecuteForward, callfunc, a comparator, a parser's
 * reader), calls no game function (MDLL_*, the game's entity functions,
 * ReGameDLL) and no engine function that runs the game's code or that a
 * ReHLDS hookchain, Hamsandwich or ReAPI hooks - no cvar written, no command
 * executed, no message sent, no entity made or removed, nothing precached.
 * What it does is read and write its own memory and AMX Mod X's: its
 * arguments, AMX Mod X's tables (players, tries, arrays, vaults, the
 * dictionary, the plugin list), entity fields, cvar values, info buffers, a
 * command's words, files.
 *
 * Its one way out is an error: LogError runs the error filter of the AMX it
 * was called with, and the natives' image sets none.
 *
 * Every one reads and writes its arguments with get_amxaddr, get_amxstring
 * and set_amxstring (no bounds check), and writes none it declares `const`.
 *
 * What a leaf native allows:
 * - its import is marked `@leaf`: a plugin keeps no shadow-stack frame for
 *   a call to it, as no collection can run while it does;
 * - a string it takes that is the plugin's static text - a literal, which
 *   never changes - crosses as cells made once a map and kept in the natives'
 *   image (the module's KeptText), not converted on every call;
 * - the text it fills is copied back without asking where the plugin's
 *   memory is again, as the memory cannot grow while it runs.
 *
 * A native left off - one that may call back, such as ExecuteForward,
 * callfunc_*, set_cvar_*, server_cmd or a Pawn plugin's native - goes the
 * copy way. A wrong entry would let the collector free what a plugin still
 * holds, so a native is added only after its source is read.
 */
/** The names in `text`, apart by white space. */
function names(text: string): string[] {
	return text.split(/\s+/).filter(Boolean);
}

export const LEAF_NATIVES: ReadonlySet<string> = new Set([
	// Text and numbers: string.cpp and amxmodx.cpp work on their arguments alone.
	...names(`add argparse contain containi copy copyc equal equali float_to_str format_time get_char_bytes
		get_time hash_file hash_string is_string_category mb_strtolower mb_strtotitle mb_strtoupper
		mb_ucfirst md5 num_to_str num_to_word parse_loguser parse_time replace replace_string
		replace_stringex setc split_string str_to_float str_to_num strcmp strfind strlen strncmp strtof
		strtok strtok2 strtol`),
	// Files, vaults and data packs: the C runtime and the engine's file system.
	...names(`delete_file dir_exists fgets file_exists file_size fopen fputs GetFileTime LoadFileForMe mkdir
		next_file open_dir read_dir read_file rename_file rmdir SetFilePermissions unlink write_file
		get_vaultdata remove_vaultdata set_vaultdata vaultdata_exists nvault_lookup nvault_open
		nvault_pset nvault_remove nvault_set nvault_touch ReadPackString WritePackString`),
	// Cvars read, never written: writing one runs Cvar_DirectSet and its hooks.
	...names(`cvar_exists get_cvar_flags get_cvar_float get_cvar_num get_cvar_pointer get_cvar_string
		get_pcvar_string`),
	// The server's and the players' state read: AMX Mod X's player table, info
	// buffers, a command's words, the message and weapon tables. Not
	// get_user_authid, nor get_players, which asks for it: the engine finds
	// the id through ReHLDS's SV_GetIDString hookchain.
	...names(`get_amxx_verstring get_flags get_localinfo get_mapname get_modname get_user_index get_user_info
		get_user_ip get_user_msgid get_user_msgname get_user_name get_weaponid get_weaponname
		get_xvar_id is_map_valid read_args read_argv read_flags read_logargv read_logdata xvar_exists`),
	// Plugins, modules, libraries and the dictionary: AMX Mod X's own lists.
	...names(`AddTranslation CreateLangKey find_plugin_byfile GetLangTransKey is_module_loaded
		is_plugin_loaded lang_exists LibraryExists LookupLangKey module_exists register_dictionary`),
	// Tries and arrays: AMX Mod X's memory. Not ArraySort or SortCustom*, which call a plugin back.
	...names(`ArrayFindString ArrayGetString ArrayInsertStringAfter ArrayInsertStringBefore ArrayPushString
		ArraySetString TrieDeleteKey TrieGetArray TrieGetCell TrieGetString TrieKeyExists TrieSetArray
		TrieSetCell TrieSetString TrieSnapshotGetKey`),
	// Entities and game data read: fields, private data, the engine's search
	// of entities by a field. Not lookup_sequence, which may load a model
	// through a hookchain, nor cs_find_ent_*, which call the game.
	...names(`copy_infokey_buffer cs_get_item_id cs_get_translated_item_alias cs_get_user_model eng_get_string
		entity_get_string find_ent_by_class find_ent_by_model find_ent_by_owner find_ent_by_target
		find_ent_by_tname find_ent_data_info find_gamerules_info find_sphere_class GameConfGetAddress
		GameConfGetClassOffset GameConfGetKeyValue GameConfGetOffset get_ent_data_string
		get_gamerules_string get_global_string get_info_keybuffer get_keyvalue get_pdata_string
		has_map_ent_class`),
	// GeoIP: lookups in the databases in memory.
	...names(`geoip_city geoip_code2 geoip_code2_ex geoip_code3 geoip_code3_ex geoip_continent_code
		geoip_continent_name geoip_country geoip_country_ex geoip_latitude geoip_longitude
		geoip_region_code geoip_region_name geoip_timezone`),
]);
