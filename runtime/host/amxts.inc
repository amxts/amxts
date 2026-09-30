// amxts for Pawn plugins: the natives the amxts_amxx module gives every plugin.
//
// #include <amxts>

#if defined _amxts_included
	#endinput
#endif
#define _amxts_included

#pragma reqlib amxts

/*
 * Player fields - what plugins keep on a player, shared by every plugin, TS
 * and Pawn alike. The key is the field's name as the TS plugin that declares it
 * writes it: "spawnProtected", "hideTimer". A number field reads whole here
 * and as a Float from the _float pair; a boolean is 1 or 0; a text field has
 * the _string pair. A field never written, or read as the other kind, is 0 or "".
 * A player's fields are cleared when he leaves, and everyone's when the map
 * changes.
 */

/**
 * A number or boolean field, whole.
 *
 * @param id    Player index.
 * @param key   Field name.
 *
 * @return      The value, 0 when never written.
 */
native amxts_get_player_data(id, const key[]);

/**
 * Sets a number or boolean field.
 *
 * @param id    Player index.
 * @param key   Field name.
 * @param value The value: 1 or 0 for a boolean.
 *
 * @noreturn
 */
native amxts_set_player_data(id, const key[], value);

/**
 * A number field as a Float.
 *
 * @param id    Player index.
 * @param key   Field name.
 *
 * @return      The value, 0.0 when never written.
 */
native Float:amxts_get_player_data_float(id, const key[]);

/**
 * Sets a number field from a Float.
 *
 * @param id    Player index.
 * @param key   Field name.
 * @param value The value.
 *
 * @noreturn
 */
native amxts_set_player_data_float(id, const key[], Float:value);

/**
 * A text field.
 *
 * @param id    Player index.
 * @param key   Field name.
 * @param out   Buffer for the text, cut where a UTF-8 character starts.
 * @param len   Most bytes to write.
 *
 * @return      Bytes written.
 */
native amxts_get_player_data_string(id, const key[], out[], len);

/**
 * Sets a text field.
 *
 * @param id    Player index.
 * @param key   Field name.
 * @param value The text.
 *
 * @noreturn
 */
native amxts_set_player_data_string(id, const key[], const value[]);
