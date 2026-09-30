#if defined _universal_config_included
    #endinput
#endif
#define _universal_config_included

/**
 * Universal Config System — public API include
 * Version: 1.6.1
 * Author: kukson777
 *
 * A flexible configuration system for parsing, managing and writing INI-like
 * files with support for nested sections, key-value pairs and block structures.
 */

/**
 * Configuration file handle.
 */
enum ConfigFile {
    CFG_FILE_INVALID = -1
}

/**
 * Configuration section handle.
 */
enum ConfigSection {
    CFG_SECTION_INVALID = -1
}

/**
 * Entry structure type used inside a config section.
 */
enum EntryType {
    CFG_ENTRY_SIMPLE,   // Simple key = value entry
    CFG_ENTRY_BRACKET   // Block entry:  key { ... }
}

/**
 * Content type of an entry's value.
 */
enum ContentType {
    CFG_CONTENT_SIMPLE = 0,  // Single value
    CFG_CONTENT_STRINGS,     // Array of strings
    CFG_CONTENT_ENTRIES      // Array of nested entries
}

// ============================================================
// Loading and section lookup
// ============================================================

/**
 * Loads a configuration file.
 *
 * @param fileName  File name (e.g. "menu.ini"). If no extension is given,
 *                  ".ini" is appended automatically.
 * @return          A ConfigFile handle on success, CFG_FILE_INVALID on failure.
 */
native ConfigFile:cfg_load_file(const fileName[]);

/**
 * Retrieves a section handle by name from a loaded configuration.
 *
 * @param cfg           ConfigFile handle returned by cfg_load_file.
 * @param sectionName   Name of the section to look up.
 * @return              A ConfigSection handle on success,
 *                      CFG_SECTION_INVALID if not found.
 */
native ConfigSection:cfg_get_section(ConfigFile:cfg, const sectionName[]);

// ============================================================
// Reading values
// ============================================================

/**
 * Retrieves a string value from a section.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path (e.g. "key" or "block/subkey").
 * @param value     Output buffer (recommended size: 512).
 * @param len       Maximum buffer length.
 * @param index     Value index for multi-value keys (default: 0).
 * @return          true if the value was found and written, false otherwise.
 */
native bool:cfg_get_value(ConfigSection:section, const key[], value[], len, index = 0);

/**
 * Retrieves a string value by its hierarchical path.
 *
 * @param section       ConfigSection handle.
 * @param path          Path to the value (e.g. "MAIN/HUD").
 * @param value         Output buffer.
 * @param len           Maximum buffer length.
 * @param index         Value index (default: 0).
 * @param lineIndex     Line index within a block (default: 0).
 * @return              true if the value was found, false otherwise.
 */
native bool:cfg_get_value_by_path(ConfigSection:section, const path[], value[], len, index = 0, lineIndex = 0);

/**
 * Retrieves an integer value from a section.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path.
 * @param index     Value index (default: 0).
 * @return          Integer value, or 0 if not found.
 */
native cfg_get_int(ConfigSection:section, const key[], index = 0);

/**
 * Retrieves a float value from a section.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path.
 * @param index     Value index (default: 0).
 * @return          Float value, or 0.0 if not found.
 */
native Float:cfg_get_float(ConfigSection:section, const key[], index = 0);

/**
 * Retrieves a boolean value from a section.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path.
 * @param index     Value index (default: 0).
 * @return          true if the value is non-zero, false if not found or zero.
 */
native bool:cfg_get_bool(ConfigSection:section, const key[], index = 0);

/**
 * Returns a dynamic array of string tokens split from a single config line
 * (space-delimited, quote-aware).
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path.
 * @param index     Line index for multi-value keys (default: 0).
 * @return          Array handle with string tokens, or Invalid_Array on failure.
 *                  The caller is responsible for destroying the array.
 */
native Array:cfg_get_value_array(ConfigSection:section, const key[], index = 0);

/**
 * Returns a dynamic array of float values parsed from a single config line.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path.
 * @param index     Line index for multi-value keys (default: 0).
 * @return          Array handle with Float values, or Invalid_Array on failure.
 *                  The caller is responsible for destroying the array.
 */
native Array:cfg_get_float_array(ConfigSection:section, const key[], index = 0);

/**
 * Returns a dynamic array of tokens split from a value found by hierarchical path.
 *
 * @param section       ConfigSection handle.
 * @param path          Path to the block (e.g. "MAIN/HUD").
 * @param index         Part index within the value (default: 0).
 * @param lineIndex     Line index within a block (default: 0).
 * @return              Array handle with string tokens, or Invalid_Array on failure.
 */
native Array:cfg_get_value_array_by_path(ConfigSection:section, const path[], index = 0, lineIndex = 0);

/**
 * Returns a dynamic array containing all top-level key names in a section.
 *
 * @param section   ConfigSection handle.
 * @return          Array handle with key strings, or Invalid_Array if empty.
 */
native Array:cfg_get_top_level_keys(ConfigSection:section);

/**
 * Returns the raw section data as an array.
 * The array contains three sub-arrays: keys, values and pair-index mappings.
 *
 * @param section   ConfigSection handle.
 * @return          Array handle, or Invalid_Array if the section is empty.
 */
native Array:cfg_get_section_data(ConfigSection:section);

/**
 * Returns the number of values associated with a key.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name or path.
 * @return          Value count, or 0 if the key is not found.
 */
native cfg_get_array_size(ConfigSection:section, const key[]);

// ============================================================
// Writing values
// ============================================================

/**
 * Sets a string value for a key.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name.
 * @param value     String value to set.
 * @param index     Value index (default: 0).
 * @return          true on success, false otherwise.
 */
native bool:cfg_set_value(ConfigSection:section, const key[], const value[], index = 0, lineIndex = 0);

/**
 * Sets an integer value for a key.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name.
 * @param value     Integer value.
 * @param index     Value index (default: 0).
 * @return          true on success, false otherwise.
 */
native bool:cfg_set_int(ConfigSection:section, const key[], value, index = 0);

/**
 * Sets a float value for a key.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name.
 * @param value     Float value.
 * @param index     Value index (default: 0).
 * @return          true on success, false otherwise.
 */
native bool:cfg_set_float(ConfigSection:section, const key[], Float:value, index = 0);

/**
 * Sets a boolean value for a key.
 *
 * @param section   ConfigSection handle.
 * @param key       Key name.
 * @param value     Boolean value.
 * @param index     Value index (default: 0).
 * @return          true on success, false otherwise.
 */
native bool:cfg_set_bool(ConfigSection:section, const key[], bool:value, index = 0);

// ============================================================
// Key and section management
// ============================================================

/**
 * Deletes a key from a section.
 *
 * @param section   ConfigSection handle.
 * @param key       Key to delete.
 * @return          true if deleted, false if not found or section is invalid.
 */
native bool:cfg_delete_key(ConfigSection:section, const key[]);

/**
 * Checks whether a key exists in a section.
 *
 * @param section   ConfigSection handle.
 * @param key       Key to check.
 * @return          true if the key exists, false otherwise.
 */
native bool:cfg_has_key(ConfigSection:section, const key[]);

/**
 * Creates a new in-memory section (not backed by a file).
 *
 * @param sectionName   Name of the new section.
 * @return              ConfigSection handle on success, CFG_SECTION_INVALID on failure.
 */
native ConfigSection:cfg_create_section(ConfigFile:cfg, const sectionName[]);

/**
 * Sets the EntryType for a key in a section.
 *
 * @param section       ConfigSection handle.
 * @param key           Key name.
 * @param entryType     CFG_ENTRY_SIMPLE or CFG_ENTRY_BRACKET.
 * @return              true on success, false otherwise.
 */
native bool:cfg_set_entry_type(ConfigSection:section, const key[], EntryType:entryType);

/**
 * Sets the ContentType for a key in a section.
 *
 * @param section       ConfigSection handle.
 * @param key           Key name.
 * @param contentType   CFG_CONTENT_SIMPLE, CFG_CONTENT_STRINGS or CFG_CONTENT_ENTRIES.
 * @return              true on success, false otherwise.
 */
native bool:cfg_set_entry_content_type(ConfigSection:section, const key[], ContentType:contentType);

// ============================================================
// Saving and writing
// ============================================================

/**
 * Writes a section to a file.
 * Can be called with 2 arguments (fileName, sectionName) or with 3 arguments
 * (ConfigFile:cfg, fileName, sectionName) when you need to target a specific
 * loaded file handle.
 *
 * @param fileName      Destination file name (e.g. "core.ini").
 * @param sectionName   Section name to write.
 * @return              true on success, false otherwise.
 */
native bool:cfg_write_file(ConfigFile:cfg, const fileName[], const sectionName[]);

/**
 * Saves a loaded configuration back to its source file.
 *
 * ';' comment lines are round-tripped: a comment block is re-emitted before the
 * element it preceded in the source (section / top-level key / bracket row).
 * Only comments that were present in the loaded file survive — elements created
 * programmatically (e.g. via cfg_set_value) carry no comment unless one already
 * existed on that row. Pass fileName explicitly for multi-section files.
 *
 * @param cfg   ConfigFile handle returned by cfg_load_file.
 * @return      true on success, false otherwise.
 */
native bool:cfg_save_config(ConfigFile:cfg, const fileName[] = "");

// ============================================================
// Utility
// ============================================================

/**
 * Sets the base directory used when resolving relative config file names.
 *
 * @param dir   Path to the directory (e.g. "addons/amxmodx/configs/jbe").
 */
native cfg_set_base_dir(const dir[]);

/**
 * Returns the total number of sections currently loaded in memory.
 *
 * @return  Section count.
 */
native cfg_get_sections_count();

/**
 * Returns the name of a loaded section by its sequential index.
 *
 * @param index     Zero-based section index (0 .. cfg_get_sections_count() - 1).
 * @param name      Output buffer for the section name.
 * @param len       Maximum buffer length.
 * @return          1 on success, 0 if the index is out of range.
 */
native cfg_get_section_name(index, name[], len);

/**
 * Sets the leading "; ..." comment of a bracket-block row (e.g. the column hint
 * shown above the first data row). Mirrors what a file round-trip preserves, so
 * blocks created programmatically can carry the same in-block hint.
 *
 * @param section   Section handle (cfg_get_section / cfg_create_section).
 * @param key       Top-level bracket key holding the rows (e.g. "3x3", "CVARS").
 * @param row       Zero-based row index inside the block.
 * @param comment   Single comment line incl. leading ';'; "" clears it.
 * @return          true on success, false if the row/key was not found.
 */
native bool:cfg_set_row_comment(ConfigSection:section, const key[], row, const comment[]);
