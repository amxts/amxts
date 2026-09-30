#if defined _menu_core_included
    #endinput
#endif
#define _menu_core_included

/**
 * Menu Core System — public API include
 *
 * Menu property constants for mc_set_menu_property / mc_set_menu_property_string
 */
#define MP_LOCKED         0   // bool:  lock menu item selection
#define MP_GLOBAL_TIMER   1   // bool:  use global countdown timer
#define MP_TIMER_DURATION 2   // int:   timer duration in seconds
#define MP_HIDE_BACK      3   // bool:  hide the Back button
#define MP_HIDE_EXIT      4   // bool:  hide the Exit button
#define MP_SECTION        5   // string (read via mc_get_menu_property_string)
#define MP_ON_TIMEOUT     5   // string (write via mc_set_menu_property_string): action on timer expiry
#define MP_ACTIVE_ON      6   // string (write via mc_set_menu_property_string): condition for menu visibility
#define MP_FILTER         7   // string (write via mc_set_menu_property_string): list filter "CONDITION|MSG_KEY"

/**
 * Registers a condition that can be referenced in menu configs to control
 * item visibility or availability.
 *
 * @param name      Condition name (e.g. "IS_CHIEF", "IS_ALIVE").
 * @param callback  Name of the evaluator function.
 *                  Signature: public callback(id)
 *                  Returns true if the condition is met, false otherwise.
 * @return          Condition ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_condition(const name[], const callback[]);

/**
 * Built-in actions (handled by the menu system — do NOT register these):
 *   - "SHOW_<SECTION>" — opens the menu section named by the suffix. The system
 *     strips the "SHOW_" prefix and calls mc_show_menu on the rest, so a menu item
 *     with action "SHOW_ADMIN_MENU" opens the "ADMIN_MENU" section automatically.
 *     Use this to chain into sub-menus instead of writing a wrapper action whose
 *     only job is to call mc_show_menu.
 *   - "CLOSE_MENU" — closes the player's current menu.
 * Both work in STRICT and LIST menus and may be combined with other actions in a
 * space-separated action list (e.g. "REPLACE_PLAYER_GAME CLOSE_MENU").
 *
 * Registers an action that is executed when a menu item is selected.
 *
 * @param name      Action name (e.g. "GET_WEAPON_M4A1", "PLAYER_HEAL").
 * @param callback  Name of the handler function. Signature depends on menu type:
 *                  - MENU_TYPE_STRICT: public callback(id, const key[])
 *                  - MENU_TYPE_LIST:   public callback(id, targetId)
 * @param isCritical Prevents concurrent execution of other critical actions
 *                   for the same player (default: false).
 * @return          Action ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_action(const name[], const callback[], bool:isCritical = false);

/**
 * Registers a placeholder for dynamic text substitution in LIST-menu VIEW fields.
 *
 * @param name      Placeholder name without surrounding '%' characters
 *                  (e.g. "name", "health").
 * @param callback  Name of the value provider function.
 *                  Signature: public callback(id, targetId, value[], len)
 * @return          Placeholder ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_placeholder(const name[], const callback[]);

/**
 * Registers a menu section defined in the configuration file.
 *
 * @param section   Section name in the config file (e.g. "CHOOSE_TEAM").
 * @return          Menu ID (>= 0) on success, -1 if the section is invalid
 *                  or the menu limit is reached.
 */
native mc_register_menu(const section[]);

/**
 * Displays a menu to a player.
 *
 * @param id            Player index.
 * @param section       Menu section name.
 * @param time          Optional. Display duration in seconds; -1 uses config value.
 * @param targetId      Optional. Target player for LIST-type menus (default: 0).
 * @param resetHistory  Optional. Reset navigation history before showing (default: false).
 * @param forceOpen     Optional. Force open, bypassing active-menu locks (default: false).
 * @param ignoreHistory Optional. Do not add this menu to the navigation history (default: false).
 * @return              1 on success, 0 if the player is invalid, the section is not
 *                      registered, or the ACTIVE_ON condition is not met.
 */
native mc_show_menu(id, const section[], time = -1, targetId = 0, bool:resetHistory = false, bool:forceOpen = false, bool:ignoreHistory = false);

/**
 * Sets or updates the countdown timer for an active menu.
 *
 * @param section   Menu section name.
 * @param time      New duration in seconds.
 * @return          1 on success, 0 if the section is invalid or no timer is active.
 */
native mc_set_menu_timer(const section[], time);

/**
 * Notifies the menu system that a condition value has changed, triggering a
 * refresh of all menus that depend on it.
 *
 * @param condition Condition name that has changed (e.g. "IS_CHIEF").
 */
native mc_notify_condition_changed(const condition[]);

/**
 * Refreshes one or more menus for players currently viewing them.
 *
 * @param sections  Space-separated list of section names to refresh
 *                  (e.g. "CHOOSE_TEAM LIST_PLAYER_HEAL").
 * @return          Number of menu views refreshed, 0 if none were refreshed.
 */
native mc_refresh_menu(const sections[]);

/**
 * Registers a restriction validator used in menu item access checks.
 *
 * @param name      Restriction name (e.g. "ADMIN", "VIP").
 *                  Use "*" as a wildcard to handle all restriction names.
 * @param callback  Name of the validator function.
 *                  Signature: public callback(id, const restrictName[])
 *                  Returns true if the player passes the restriction.
 * @param message   Optional default message shown when the restriction is not met.
 * @return          Restriction ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_restriction(const name[], const callback[], const message[] = "");

/**
 * Registers an action condition validator.
 * If the validator returns false, the menu item with this action will be rendered disabled (grayed out).
 *
 * @param menuSection Name of the menu section (e.g. "CHIEF_MENU"). If empty (""), matches all menus.
 * @param actionName  Name of the action (e.g. "CLOSE_CELLS"). If empty (""), matches all actions.
 * @param callback    Name of the callback function.
 *                    Signature: public callback(id, const menuSection[], const actionName[])
 *                    Returns true if the condition is met, false to disable/gray out.
 * @return            1 on success.
 */
native mc_register_action_condition(const menuSection[], const actionName[], const callback[]);

/**
 * Registers a condition filter — a post-processor that can OVERRIDE the boolean result of a named
 * condition (one registered via mc_register_condition) without owning that condition. Whenever the
 * condition is evaluated during menu rendering, every filter registered for that condition name is
 * called in turn, each receiving the running result, so a plugin can veto or extend another plugin's
 * condition (e.g. forcing IS_TRAINING_ENABLED to false while a mix is in progress).
 *
 * @param condition Name of the condition to filter (must match a registered condition name).
 * @param callback  Name of the filter function.
 *                  Signature: public bool:callback(id, viewerId, const condition[], bool:currentVal)
 *                  Returns the (possibly overridden) value. Return currentVal to leave it unchanged.
 * @return          Filter ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_condition_filter(const condition[], const callback[]);

/**
 * Registers a custom data source for a LIST-type menu.
 * Allows LIST menus to display arbitrary entities (weapons, items, etc.)
 * instead of the default player list.
 *
 * @param menuName  Name of the LIST menu section (e.g. "LIST_GUARD_WEAPONS").
 * @param callback  Name of the data provider function.
 *                  Signature: public callback(id, Array:items)
 *                    id    — player viewing the menu
 *                    items — dynamic array to fill with item data
 *
 *                  Each item is a 289-cell array with the following layout:
 *                    item[0]        = Entity ID passed to action callbacks as targetId;
 *                                     use -2 to insert a display-only text row.
 *                    item[1..64]    = Action key / entity identifier (e.g. "weapon_ak47").
 *                    item[65..128]  = Display language key or raw text.
 *                    item[129..160] = Restriction name, or empty string for none.
 *                    item[161..288] = Message shown when the item is disabled by a restriction.
 * @return          Data source ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_list_data_source(const menuName[], const callback[]);

/**
 * Registers a callback invoked when a menu is opened for a player.
 *
 * @param callback  Name of the handler function.
 *                  Signature: public callback(id, const section[])
 * @return          Callback ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_menu_open_callback(const callback[]);

/**
 * Registers a callback invoked when a menu is closed for a player.
 *
 * @param callback  Name of the handler function.
 *                  Signature: public callback(id, bool:isTimeout, const section[])
 * @return          Callback ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_menu_close_callback(const callback[]);

/**
 * Registers a show filter — a global veto invoked at the start of mc_show_menu, before the menu
 * renders. If the callback returns false, the menu does NOT open (mc_show_menu returns 0). Use this
 * to centrally gate ALL menu openings from one place (any command, key or sub-menu) and show the
 * player a reason, instead of guarding every individual entry point.
 *
 * @param callback  Name of the handler function.
 *                  Signature: public bool:callback(id, const section[])
 *                  Returns true to allow opening, false to block it (and typically notify the player).
 * @return          Filter ID (>= 0) on success, -1 if the limit is reached.
 */
native mc_register_show_filter(const callback[]);

/**
 * Cancels an active menu timer and closes the menu for all players viewing it.
 *
 * @param section   Menu section name.
 * @return          1 on success (timer was active and cancelled),
 *                  0 if the section is invalid or no timer is active.
 */
native mc_cancel_menu_timer(const section[]);

/**
 * Locks or unlocks the menu for a player.
 * When locked the player cannot select any items.
 *
 * @param id    Player index.
 * @param lock  true to lock, false to unlock (default: true).
 */
native mc_lock_menu(id, bool:lock = true);

/**
 * Hides the currently open menu for a player and resets their menu state.
 *
 * @param id    Player index.
 */
native mc_hide_menu(id);

/**
 * Returns whether the menu is locked for a player.
 *
 * @param id    Player index.
 * @return      true if locked, false otherwise.
 */
native bool:mc_is_menu_locked(id);

/**
 * Returns the index of the player's currently active menu.
 *
 * @param id    Player index.
 * @return      Menu index (>= 0) if a menu is open, -1 if no menu is active.
 */
native mc_get_active_menu(id);

/**
 * Reads a string property of a menu by its runtime index.
 *
 * @param menuIdx   Menu index (returned by mc_get_active_menu).
 * @param property  Property identifier (MP_SECTION, etc.).
 * @param value     Output buffer.
 * @param len       Maximum buffer length.
 * @return          1 on success, 0 if the index or property is invalid.
 */
native mc_get_menu_property_string(menuIdx, property, value[], len);

/**
 * Sets an integer or boolean property of a menu.
 *
 * @param section   Menu section name.
 * @param property  Property identifier (MP_LOCKED, MP_HIDE_BACK, etc.).
 * @param value     New value.
 * @return          1 on success, 0 if the section is not found or the property
 *                  is invalid.
 */
native mc_set_menu_property(const section[], property, value);

/**
 * Sets a string property of a menu.
 *
 * @param section   Menu section name.
 * @param property  Property identifier (MP_ON_TIMEOUT, etc.).
 * @param value     New string value.
 * @return          1 on success, 0 if the section is not found or the property
 *                  is invalid.
 */
native mc_set_menu_property_string(const section[], property, const value[]);

/**
 * Programmatically adds an item to a menu section (without editing the config).
 *
 * @param section       Menu section name.
 * @param name          Display name or language key. Supports variant syntax via "|".
 * @param placeholder   Placeholder text (default: "").
 * @param condition     Visibility condition name, or empty for always visible.
 * @param action        Action name on selection, or empty.
 * @param restriction   Restriction name, or empty for unrestricted.
 * @param restrictMsg   Message shown when the restriction blocks the item.
 * @param iPosition     Insertion index in the items list, or -1 to append to the end.
 * @param emptyBefore   Number of blank lines to insert before this item.
 * @param emptyAfter    Number of blank lines to insert after this item.
 * @return              1 on success, 0 if the section is not found or the item
 *                      data is invalid.
 */
native mc_add_menu_item(const section[], const name[], const placeholder[] = "", const condition[] = "", const action[] = "", const restriction[] = "", const restrictMsg[] = "", iPosition = -1, emptyBefore = 0, emptyAfter = 0);

/**
 * Adds a fixed-slot item to a menu section (always displayed at a specific slot).
 *
 * @param section       Menu section name.
 * @param slot          Slot number (1–7).
 * @param name          Display name or language key.
 * @param placeholder   Placeholder text (default: "").
 * @param action        Action name on selection.
 * @param condition     Visibility condition name, or empty.
 * @param restriction   Restriction name, or empty.
 * @param emptyBefore   Number of blank lines to insert before this item.
 * @param emptyAfter    Number of blank lines to insert after this item.
 * @return              1 on success, 0 if the section is not found or the item
 *                      data is invalid.
 */
native mc_add_fixed_menu_item(const section[], slot, const name[], const placeholder[] = "", const action[] = "", const condition[] = "", const restriction[] = "", emptyBefore = 0, emptyAfter = 0);

/**
 * Inserts a display-only text row (separator / header) into a LIST-menu item array.
 * Call this inside a data source callback.
 *
 * @param aItems    The Array:items handle provided by the data source callback.
 * @param text      Text or language key to display.
 * @param centered  Center the text within the menu width (default: false).
 * @return          1 on success.
 */
native mc_add_list_text(Array:aItems, const text[], bool:centered = false);

/**
 * Clears all items (regular and fixed) from a menu section.
 *
 * @param section   Menu section name.
 * @return          1 on success, 0 if the section is not found.
 */
native mc_clear_menu_items(const section[]);

/**
 * Creates a menu entirely in code (without a config file entry).
 * The section name prefix "LIST_" automatically sets the type to MENU_TYPE_LIST.
 *
 * @param section   Unique section name for the new menu.
 * @param title     Menu title (raw string or language key).
 * @return          1 on success, 0 if a section with that name already exists.
 */
native mc_create_menu(const section[], const title[]);

/**
 * Sets the current page of a menu for a player.
 *
 * @param id    Player index.
 * @param page  Zero-based page number.
 */
native mc_set_menu_page(id, page);
