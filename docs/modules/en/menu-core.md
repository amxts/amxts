---
title: "Menus: menu-core"
---

Menus described in a file - INI, YAML or JSON - or built in code: pages,
keys, the way back, countdowns, and items that are shown, hidden or greyed
out depending on who looks. It is a [shared module](../../en/5.modules/01.shared-modules.md) a
TypeScript plugin uses as `menus`, without an import line
([auto-imports](../../en/2.core/01.plugin.md#auto-imports)), and it gives Pawn plugins the
`mc_*` natives of `menu_core.inc`.

## From TypeScript

A menu is an object: `create()` makes one, its methods fill it and open it,
and what an item says, what it does, when it is shown and when it can be
chosen are right on the item, as functions where they depend on who looks.

```ts
const shop = menus.create("SHOP", { title: ({ player }) => `Shop for ${player.name}` });

shop.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	visible: ({ player }) => player.health < 100,
	onSelect: ({ player }) => {
		player.health = 100;
	},
});
shop.addItem({
	title: "Armor",
	enabled: ({ player }) => player.armor < 100,
	message: ({ player }) => `(${player.armor} already)`,
	onSelect: ({ player }) => {
		player.armor = 100;
	},
});
// Greyed out while one says no: the first that does gives its message.
shop.addItem({
	title: "Buy AWP",
	enabled: [
		{ when: ({ player }) => player.isAlive, message: "Only while alive" },
		{ when: ({ player }) => player.money >= 4750, message: ({ player }) => `Need $${4750 - player.money} more` },
	],
	onSelect: ({ player }) => {
		player.money = player.money - 4750;
		player.give("weapon_awp");
	},
});
shop.addItem({ title: "Close", action: "CLOSE_MENU", spaceBefore: 1 });

server.addCommand("/shop", ({ player }) => shop.show(player));
```

Every function of a menu gets one object, the menu's context:

- `player` — the player the menu is shown to: who looks at it, and who
  chooses;
- `target` — the player the menu is about: the row's in a list menu, the one
  `show(player, { target })` was given otherwise, and `player` himself when
  there is none;
- `row` — the row's number in a list menu, as `menus.listRow()` gave it: an
  entity, an index of a list of your own — or a player's `id` in a list of
  players; in a menu of items, the target's `id`, `0` without one;
- `menu` — the menu.

Text — the title, an item, the `message` of a greyed-out item — is the text
itself, or a function that gives it for the context. It is read each time the
menu is drawn. A plain string that is a lang key is translated for the
player.

An item says when it is shown and when it can be chosen:

- `visible` — is it shown at all; while it says no, the item is left out and
  takes no slot.
- `enabled` — can it be chosen; while it says no, the item is greyed out with
  `message` beside it. Or a list of requirements, `{ when, message }` each:
  the first that fails gives its message, and one without a message of its
  own has the item's.

In code a requirement is a function, which the editor checks. Names —
`IS_ALIVE`, `FLAG_d`, a restriction a plugin registered — are for menu files,
which cannot hold a function.

Colours are tags, the same letters as in chat ([colours](../../en/2.core/01.plugin.md#colours)):
`!y` yellow, `!r` red, `!d` grey, `!w` white, `!R` aligns the rest of the line
right — `"Armor!R!y100$"`. Chat's own `!g`, `!b` and `!t` are dropped from a
menu.

- `menus.create(name, options)` — a menu in code; the one already there when
  the name is taken. A name starting with `LIST_` makes a list menu. Options:
  `title`, `time`, `hideBack`, `hideExit`, `locked`, and `activeWhen` — the
  menu opens only while it says yes.
- `menu.addItem(item)` / `menu.addFixedItem(slot, item)` — `title` is the
  item's text; `onSelect` runs when the item is chosen, and the menu is drawn
  again after it while it stays open; `visible` leaves the item out (it takes
  no slot) while it says no; `enabled` — a test, or a list of
  `{ when, message }` — greys it out, with `message` beside it. Also
  `spaceBefore`, `spaceAfter`, `at`, and for a menu that names what plugins
  register, `action` and `placeholder`.
- `menu.show(player, options)` — false when it does not open; options:
  `time`, `target` (a player), `resetHistory`, `force`, `skipHistory`.
- `menu.runActions(player, line, target?)` — runs an action line,
  `"GIVE_HP CLOSE_MENU"`, as a choice in the menu does.
- `menu.refresh()`, `menu.close()` — for whoever looks at it;
  `menu.setTimer(seconds)`, `menu.cancelTimer()` — the shared countdown;
  `menu.clearItems()`.
- `menu.addEventListener("open" | "close" | "show", listener)` — this menu's
  events; `"show"` comes before it opens, and `event.preventDefault()` stops
  it.
- Fields: `name`, `kind`, `title`, `time`, `hideBack`, `hideExit`, `locked`,
  `sharedTimer`, `countdown`, and the menu.ini names `activeOn` and
  `onTimeout`.

A list menu has a row per player, drawn with its first item: its functions
get the row's player as `target`.

```ts
const kick = menus.create("LIST_KICK", { title: "Kick a player" });
kick.addFilter(({ player, target }) => target.id != player.id, "Nobody to kick");
kick.addItem({
	title: ({ target }) => `${target.name} (${target.health} HP)`,
	onSelect: ({ player, target }) => target.kick(`Kicked by ${player.name}`),
});
```

`menu.addFilter(test, message)` leaves out the rows `test` says no to, and
with none left the menu does not open and the player gets `message`.
`menu.setListSource(rows)` gives rows of its own instead of the players:
`menus.listRow(row, text)` and `menus.textRow(text)`. A row of something
that is not a player — a map, an item of a shop — is told by its number,
`row`:

```ts
const maps = ["de_dust2", "de_inferno", "de_nuke"];

const vote = menus.create("LIST_MAPS", { title: "Next map" });
vote.setListSource(() => maps.map((map, index) => menus.listRow(index, map)));
vote.addItem({
	title: ({ row }) => maps[row],
	onSelect: ({ player, row }) => server.print(`${player.name} votes for ${maps[row]}`),
});
```

For the player, whatever menu he looks at: `menus.close(player)`,
`menus.activeMenu(player)`, `menus.lock(player)`, `menus.show(player, name)`
for a menu by its name.

Keys: 1-7 choose, 8 is the next page, 9 the previous page or back to the menu
this one was opened from, 0 closes.

::: warning Showing the menu a player is on
From a command or a timer, `show()` opens it anew, at its first page. From
one of its own items it stays on its page - and after an item's action the
menu is drawn again by itself. `setPage(player, page)` is the page the next
`show()` draws.
:::

## Names: for menu files and Pawn plugins

Menu files and Pawn plugins name what they need — a condition, an action, a
restriction, and `%name%` in their text for a placeholder — and a TypeScript
plugin answers those names with functions:

```ts
menus.addActions({ RESET_SCORE: resetScore, SPECTATE: (player) => player.joinTeam("SPECTATOR") });
menus.addPlaceholders({ hp: (player) => `${player.health}`, nick: ({ target }) => target.name });   // %hp%, %nick% in a menu file
menus.addCondition("IS_ALIVE", (player) => player.isAlive);
menus.addRestriction("VIP", ({ player }) => player.access.includes("reservation"), "VIP only");
menus.setListSource("LIST_FPS_CHECK", rows);        // a list menu of the file, by name
menus.conditionChanged("IS_ALIVE");                  // draw again the menus that use it
```

`addActions` and `addPlaceholders` register several at once, each by its name :since{v="0.3"};
`addAction(name, handler)` and `addPlaceholder(name, value)` one. An action or
a placeholder is a function of the player who chose it or reads it,
`(player) => ...` :since{v="0.3"}, or of the menu's context, `({ player, target, menu,
name }) => ...`. An action, a placeholder and a restriction get the menu's context, and the
`name` they are asked by — a restriction's whole `"NAME:param"`. A condition
is a fact about a player, `(player, viewer, name)`: in a list menu it is asked
of the row's player, with `viewer` the one who looks.

A restriction's message is said beside an item it greys out, unless the item
or the requirement has its own. Also `menu.addPlaceholder(name, value)` for one menu's `%name%`,
`addActionCheck` (its test gets the context, with the item's action as
`name`), `addConditionFilter`, `menus.addEventListener` for every menu's
events, `refresh("A B")`. In code, text is a function instead of a
placeholder.

## From any plugin: one menu-core for the server

The server has one instance of `@amxts/menu-core`: the menu-core
plugin's. Any plugin of yours that uses it calls that instance, with the
same functions and types (see [Shared modules](../../en/5.modules/01.shared-modules.md)). So a
menu that several plugins fill — a main menu that Pawn plugins add their
items to through `mc_*` — is one menu, and a player has one open menu
whoever opened it.

```ts
menus.register("MAIN_MENU", "ADMIN_MENU");
menus.addCondition("IS_ALIVE", (player) => player.isAlive);
menus.addActions({ RESET_SCORE: resetScore });
menus.setListSource("LIST_FPS_CHECK", rows);   // rows({ player }) returns menus.listRow(row, text) rows
menus.show(player, "MAIN_MENU", { resetHistory: true });
```

A project lists menu-core in `amxts.config.ts`, and config-core right after
it: menu-core reads its menus through `@amxts/config-core` — the
config-core plugin's. `npx amxts module add menu-core` installs both and
lists both. The build puts both plugins in `plugins.ini`, config-core first.

```ts
// amxts.config.ts
export default defineConfig({
	modules: [
		"@amxts/menu-core",
		"@amxts/config-core", // needed by menu-core
	],
	menus: { file: "myplugin/menu" },     // configs/myplugin/menu.ini, .yaml or .json
});
```

## Menus in the file

A menu is read from the file the first time it is asked for: by `register(name)`, or by `show` of a name Menu Core does not know yet. The file is INI, YAML or JSON: `menus: { file: "menu" }` reads the first of `menu.ini`, `menu.yaml`, `menu.yml`, `menu.json` and `menu.jsonc` that is there, and a menu means the same in each of them — except that INI cannot hide an item ([INI's columns](#inis-columns)).

A plugin can point at another file itself: `setConfigFile("myplugin/menu")` reads `configs/myplugin/menu.ini`, `.yaml`, `.yml`, `.json` or `.jsonc`.

```yaml
# configs/menu.yaml
chatPrefix: MYPLUGIN_CHAT_PREFIX   # chat prefix of the "nothing to list" message
labels:
  exit: MYPLUGIN_MENU_EXIT         # the buttons: a lang key or the text itself
  number: MYPLUGIN_MENU_NUMBER     # "!y[%d]!w" unless the dictionary says otherwise

menus:
  MAIN_MENU:
    title: MYPLUGIN_MENU_MAIN_TITLE
    hideBack: true
    items:
      - name: MYPLUGIN_MENU_MAIN_ADMIN
        visible: IS_ADMIN                  # left out for everyone else
        enabled: FLAG_d                    # greyed out, the message beside it
        message: MYPLUGIN_MENU_NEEDS_FLAG_D
        action: SHOW_ADMIN_MENU
      - name: MYPLUGIN_MENU_MAIN_AWP
        enabled:                           # the first that fails gives its message
          - when: VIP
            message: MYPLUGIN_MENU_VIP_ONLY
          - when: LEVEL:5
            message: MYPLUGIN_MENU_LEVEL_5
        action: BUY_AWP
      - variants:                          # the first whose "when" holds is shown
          - { name: MYPLUGIN_MENU_MAIN_SPECTATE, when: "!IS_SPECTATOR", action: JOIN_SPECTATE }
          - { name: MYPLUGIN_MENU_MAIN_JOIN, when: IS_SPECTATOR, action: JOIN_TEAM }

  LIST_SPECTATORS_MENU:
    title: MYPLUGIN_MENU_SPECTATORS_TITLE
    activeOn: IS_ROUND_RUNNING
    filters:
      - { when: IS_SPECTATOR, message: MYPLUGIN_CHAT_NO_SPECTATORS }
    view:
      name: "%name%"
      action: SWAP_WITH_SPECTATOR
```

```jsonc
// configs/menu.json
{
  "chatPrefix": "MYPLUGIN_CHAT_PREFIX",
  "labels": { "exit": "MYPLUGIN_MENU_EXIT", "number": "MYPLUGIN_MENU_NUMBER" },
  "menus": {
    "MAIN_MENU": {
      "title": "MYPLUGIN_MENU_MAIN_TITLE",
      "hideBack": true,
      "items": [
        { "name": "MYPLUGIN_MENU_MAIN_ADMIN", "visible": "IS_ADMIN", "enabled": "FLAG_d", "message": "MYPLUGIN_MENU_NEEDS_FLAG_D", "action": "SHOW_ADMIN_MENU" },
        {
          "name": "MYPLUGIN_MENU_MAIN_AWP",
          "enabled": [
            { "when": "VIP", "message": "MYPLUGIN_MENU_VIP_ONLY" },
            { "when": "LEVEL:5", "message": "MYPLUGIN_MENU_LEVEL_5" }
          ],
          "action": "BUY_AWP"
        },
        {
          "variants": [
            { "name": "MYPLUGIN_MENU_MAIN_SPECTATE", "when": "!IS_SPECTATOR", "action": "JOIN_SPECTATE" },
            { "name": "MYPLUGIN_MENU_MAIN_JOIN", "when": "IS_SPECTATOR", "action": "JOIN_TEAM" }
          ]
        }
      ]
    },
    "LIST_SPECTATORS_MENU": {
      "title": "MYPLUGIN_MENU_SPECTATORS_TITLE",
      "activeOn": "IS_ROUND_RUNNING",
      "filters": [{ "when": "IS_SPECTATOR", "message": "MYPLUGIN_CHAT_NO_SPECTATORS" }],
      "view": { "name": "%name%", "action": "SWAP_WITH_SPECTATOR" }
    }
  }
}
```

```ini
; configs/menu.ini
[MAIN]
PREFIX = MYPLUGIN_CHAT_PREFIX
KEY = {
	EXIT = MYPLUGIN_MENU_EXIT
	NUMBER = MYPLUGIN_MENU_NUMBER
}

[MAIN_MENU]
TITLE = MYPLUGIN_MENU_MAIN_TITLE
HIDE_BACK = YES
ITEMS = {
	; name | placeholder | condition | action | restriction | message | spacing
	"MYPLUGIN_MENU_MAIN_ADMIN" "" "IS_ADMIN" "SHOW_ADMIN_MENU" "FLAG_d" "MYPLUGIN_MENU_NEEDS_FLAG_D" ""
	"MYPLUGIN_MENU_MAIN_AWP" "" "" "BUY_AWP" "VIP LEVEL:5" "VIP:MYPLUGIN_MENU_VIP_ONLY|MYPLUGIN_MENU_LEVEL_5" ""
	"MYPLUGIN_MENU_MAIN_SPECTATE|MYPLUGIN_MENU_MAIN_JOIN" "" "!IS_SPECTATOR|IS_SPECTATOR" "JOIN_SPECTATE|JOIN_TEAM" "" "" ""
}

[LIST_SPECTATORS_MENU]
TITLE = MYPLUGIN_MENU_SPECTATORS_TITLE
ACTIVE_ON = IS_ROUND_RUNNING
FILTER = {
	"IS_SPECTATOR" "MYPLUGIN_CHAT_NO_SPECTATORS"
}
VIEW = {
	; name | condition | action | restriction | message
	"%name%" "" "SWAP_WITH_SPECTATOR" "" ""
}
```

### The fields

| YAML, JSON | INI | What it is |
| --- | --- | --- |
| `chatPrefix` | `[MAIN]` `PREFIX` | The chat prefix of Menu Core's messages. The Pawn menu_core's `[Основное]` is read as `[MAIN]` :since{v="0.3"}. |
| `labels`: `exit`, `back`, `next`, `number`, `disabled`, `page`, `time` | `[MAIN]` `KEY = { ... }` | The words of the buttons, the page and the countdown. |
| `menus`: `{ NAME: menu }` | `[NAME]` | The menus; a name starting with `LIST_` is a list menu. |
| `title` | `TITLE` | The title; a menu has one. |
| `activeOn` | `ACTIVE_ON` | Conditions the menu opens only under. |
| `hideBack` · `hideExit` | `HIDE_BACK` · `HIDE_EXIT` | `true` (INI: `YES`) leaves the button out. |
| `time` · `onTimeout` | `TIME` · `ON_TIMEOUT` | A countdown in seconds, and the actions run when it ends. |
| `locked` · `sharedTimer` | `LOCKED` · `GLOBAL` | Items cannot be chosen; one countdown for everyone. |
| `items` | `ITEMS` | An items menu's items. |
| `fixedItems` | `FIXED_ITEMS` | Items that keep their `slot`, 1–7, on every page. |
| `view` · `filters` | `VIEW` · `FILTER` | A list menu's row, and the filters its rows pass: `when`, `message`. |

An item — in `items`, `fixedItems` or as the `view` — has a `name`, and:

| Key | What it is |
| --- | --- |
| `placeholder` | Text after the name, placeholders and all: `"%hp%"`. |
| `action` | The actions run when it is chosen. |
| `visible` | Names it is shown under; while they do not hold, it is left out and takes no slot (a fixed item leaves its slot blank). Not in a `view`: a list menu leaves rows out with `filters`. |
| `enabled` | Names it can be chosen under, with `message` beside it while they do not hold — or a list of requirements, each a line of names or `{ when, message }`: the first that fails gives its message. |
| `message` | The text beside it while a requirement without a message of its own greys it out. |
| `spaceBefore` · `spaceAfter` | Blank lines before and after it. |
| `variants` | Several faces, `[{ name, when, action }, ...]`: the first whose `when` holds is shown; a variant without `when` always holds, and when none does, the first is shown greyed out. |

The message beside a greyed-out item goes from general to specific: the one a restriction was registered with (`addRestriction(name, test, message)`), the item's `message`, the requirement's own. Each is text or a lang key.

A `visible`, `when`, `enabled`, `activeOn`, `action` or `onTimeout` is a name, several space-separated, or a list: `activeOn: [IS_ALIVE, "!IS_SPECTATOR"]`. In YAML, quote a value that starts with `!` or `%`.

- **Names** in `visible`, `enabled` and `when` — a restriction a plugin registered, a condition, or else the `"*"` restriction's. `!NAME` turns one around; several must all hold. `NAME:param` hands the restriction's test the whole token and takes the rest of the line with it: `VIP:Only for VIP` is one name, so write it last. An unknown name does not hold.
- **Conditions:** `activeOn` names conditions only. These are built in, answered by Menu Core while no plugin registers the name (a plugin that does answers instead):

  | Condition | Holds when the player |
  | --- | --- |
  | `IS_ALIVE` · `IS_DEAD` | is alive · is not (a spectator too) |
  | `TEAM_CT` · `TEAM_TERRORIST` · `TEAM_SPECTATOR` · `TEAM_UNASSIGNED` | is in that team |
  | `IS_BOT` | is a bot |
  | `IS_ADMIN` | has any access but a plain user's `z` — AMX Mod X's `is_user_admin` |
  | `FLAG_<letters>` | has any of those `users.ini` letters: `FLAG_ab` |

  In a list menu, a condition of the view or a filter is asked of the row's player, and a restriction gets the row as its target. The names are case-insensitive.
- **Built-in actions:** `SHOW_<MENU>` opens that menu, `CLOSE_MENU` closes; an action line may list several.
- **Placeholders:** `%name%` (a list row's text), `%target%`, `%time%`, and any registered one.
- **List menus** draw their view per player, or per row of their list source, leaving out rows that fail a filter. With none left the menu does not open, and the player gets the filter's message.

::: warning In a menu file
- **Flags** of an INI menu — `HIDE_BACK`, `HIDE_EXIT`, `LOCKED`, `GLOBAL` — are `YES` or `NO`: `true`, `1` or `yes` is warned of, with the word to write, and is `NO`. In YAML `yes` is text: a flag there is `true` or `false`.
- **Text with spaces** in an INI menu is quoted: `TITLE = "Main menu"`. Unquoted, only its first word is read.
- **An item's name in YAML or JSON is not split on `|`:** its faces are written with `variants`.
- **Colours** are tags in a menu file too: `!y`, `!r`, `!d`, `!w`, `!R`. Pawn's codes (`\y`, `\r`) are warned of, with the tag to write, and left out. Text from Pawn — a Pawn plugin's items and titles, a lang dictionary — keeps its codes, and menu-core reads them as the tags.
- **`%time%` and `%target%` are lower case:** `%TIME%` and `%s` are left as written.
- **`ADMIN` and `ACCESS_ADMIN` are not built in:** a plugin registers them, or the file writes `IS_ADMIN` (any admin) or `FLAG_<letters>` (`FLAG_d`).
:::

### INI's columns

INI is the format Pawn plugins read too, so its columns are fixed. An item's row is `name | placeholder | condition | action | restriction | message | spacing`:

| INI | YAML, JSON |
| --- | --- |
| `"A\|B"` names, `"C1\|C2"` conditions, `"X\|Y"` actions | `variants: [{ name: A, when: C1, action: X }, { name: B, when: C2, action: Y }]` |
| a condition, one variant | `enabled: C` — greyed out without a reason |
| a restriction and a message | `enabled: R`, `message: M` — greyed out with the message |
| `"NAME:message\|NAME2:message"` | `enabled: [{ when: NAME, message: ... }, { when: NAME2, message: ... }]` |
| — | `visible` — INI has nothing that hides an item |

A condition column asks conditions only, and a restriction column asks restrictions first, then conditions. The `mc_*` natives add items the same way.

::: tip
A `menu.ini` written for Pawn colours its text with codes (`\y`, `\r`). menu-core's script rewrites them as tags, in INI, YAML and JSON: `bun node_modules/@amxts/menu-core/scripts/menu-colors.ts configs/menu.ini` (`--dry-run` says what it would change).
:::

### Checks

What does not fit a menu file is said in the server console with the file and the line — and the column in YAML and JSON — and left out; the rest of the menu is read.

- **When the file is read:** an unknown key, with the one it may be — `visible` or `enabled` for an item's `condition` or `restriction`, `when` for a variant's or a filter's `condition`; a value of the wrong kind (`hideBack: yes` — YAML's `yes` is text, the field takes `true`; `HIDE_BACK = 1` — an INI flag is `YES` or `NO`); a colour code (`\y`) where a menu file writes the tag, with the tag to write — the code is left out; a menu without a title, an item without a name, `items` in a list menu, a slot outside 1–7. An item with no action is noted, not warned of: choosing it does nothing. An empty block, `ITEMS = { }`, is fine.
- **On the server's first frame:** every name, action and placeholder the file uses that nobody registered — TypeScript plugins, Pawn plugins through the `mc_*` natives, or Menu Core itself. By then every plugin has run `plugin_init` and `plugin_cfg`, so a name a Pawn plugin registers after the file was read is not taken for a mistake. A file read later — `setConfigFile()` — is checked as it is read. Then too, a line of names that says less than it seems: a name listed twice, case aside (`IS_ADMIN is listed more than once`), a name and its opposite (`IS_ALIVE and !IS_ALIVE together can never hold`) — each requirement, and each variant, on its own.

```
[MenuCore] addons/amxmodx/configs/menu.yaml:12:9: MAIN_MENU: the condition "IS_SPECTATR" is not registered - did you mean "IS_SPECTATOR"?
[MenuCore] addons/amxmodx/configs/menu.yaml:14:9: MAIN_MENU: SHOW_ADMN_MENU opens the menu "ADMN_MENU", which is not there - did you mean "ADMIN_MENU"?
```

### Editor support

The amxts extension for VS Code helps in a menu file while you type, before
anything is built. Write `menus.addCondition("MY_VIP", ...)` in a plugin and
`MY_VIP` is offered in `menu.ini`, `menu.yaml` or `menu.json` at once, even
before the plugin is saved.

- **Completion:** the keys of each level; the conditions, actions,
  restrictions and placeholders your plugins register — TypeScript, Pawn
  (`mc_register_*`) and installed modules — with where each is registered;
  `SHOW_<MENU>`, `CLOSE_MENU`, the built-in conditions; `%placeholders%`
  after `%`.
- **The checks above as you type,** in the same words, with a quick fix for
  "did you mean". A name nothing in the workspace registers is a warning:
  a Pawn plugin that is only on the server may still register it. An INI
  column's name used as a key — `condition`, `restriction` — gets the key to
  write: `visible`, `enabled` or `when`.
- **Hover and go to definition** on a name lead to its registration and its
  JSDoc; **Find all references** on `"MY_VIP"` in a plugin lists the menu
  files that use it.

The menu file is the one `amxts.config.ts` names (`menus.file`, `"menu"` by
default), or any file that looks like a menu file. The extension is
installed from its `.vsix`, with
`code --install-extension amxts-vscode-<version>.vsix`, or in VS Code under
**Extensions** → `...` → **Install from VSIX**.

::: warning
The extension knows only names written as a string in the workspace:
`menus.addAction(name, ...)` with the name in a variable, and a Pawn plugin
that is not in the workspace, are unknown to it - a warning in the editor.
The server's check on its first frame is the one that counts.
:::

## For Pawn plugins

A project whose TypeScript plugins do not use menu-core keeps it for its Pawn
plugins with `pawn: ["@amxts/menu-core"]` in `amxts.config.ts`: a module no
plugin uses is otherwise left out of the build
([only what is used is built](../../en/2.core/01.plugin.md#only-what-is-used-is-built)).

The menu-core plugin gives Pawn plugins the 30 natives of `menu_core.inc` —
`mc_register_action`, `mc_show_menu`, `mc_add_menu_item` and the rest — with
their signatures, so compiled `.amxx` plugins work against it unchanged; a
Pawn plugin writes `#include <menu_core>`. Only one plugin on a server can
give these natives: if another Pawn plugin in `plugins.ini` registers `mc_*`
natives too, comment it out. It reads its menus through
`@amxts/config-core`, so config-core comes before it in the amxts
`plugins.ini` — the build puts it there.

A Pawn plugin names its callbacks by public name, and menu-core calls them
with callfunc, the calling plugin's id taken from the native call.

The generated `menu_core.inc` (deploying copies it into the server's
`addons/amxmodx/scripting/include`) declares:

- the menu properties as `enum MenuProperty { MP_LOCKED = 0, ... MP_FILTER }`,
  which the three property natives take as `MenuProperty:property`;
- `mc_add_list_text(aItems, ...)`, without the `Array:` tag;
- `mc_get_menu_text(id, out[], len)`: what the player's menu shows, for tests
  and logs.

A plugin compiled against it gets a tag warning for a bare number where
`MenuProperty:` is expected, and for an `Array:` passed to
`mc_add_list_text`. The values a compiled plugin passes are the same either
way.

## How the natives behave

- No length limits: names, titles and placeholders are as long as they are
  written, a menu keeps every item, the way back is as long as it gets, and
  a menu longer than 500 bytes (Cyrillic reaches it quickly) is sent whole.
- `mc_get_menu_property_string(idx, MP_SECTION)` gives the menu's section.
- A condition filter applies wherever the condition is asked.
- A restriction's `message` (`mc_register_restriction`) is shown beside an
  item it greys out when the item has no message of its own.
- Closing a menu because another opens over it tells the close callbacks its
  name.
- A locked menu greys out the items of any menu, not only list rows.
- `mc_show_menu` of a section nobody registered reads it from the file.
- `ADMIN` and `ACCESS_ADMIN` are not built in: a menu that uses them needs a
  plugin that registers them (`mc_register_condition`,
  `mc_register_restriction`), or the check says they are not registered.
  Without a plugin, write `IS_ADMIN` (any admin) or `FLAG_<letters>`
  (`FLAG_dluy`: ban, rcon, admin or menu access).
- `isCritical` of `mc_register_action` is accepted and does nothing.

## Testing

Menu Core ships a test kit for the fake server ([testing](../../en/7.testing/01.index.md)):
`setup()` installs it, and `menusOf(server)`, from `@amxts/menu-core/testing`,
gives what it adds — what a player's menu shows, the keys he presses, fake
Pawn plugins that register and answer through the `mc_*` natives, and a
dictionary:

```ts
import { setup } from "@amxts/core/test-utils";
import { menusOf } from "@amxts/menu-core/testing";

const server = await setup({ files });
const menus = menusOf(server);
const admin = menus.pawnPlugin("admin.amxx", {
	OnKick: (_id: number, target: number) => kicked.push(target),
	Hp: (_id: number, _target: number, value: PawnArray) => value.set("100"),
});

admin.native("mc_register_action", "KICK", "OnKick");      // called from admin.amxx
admin.native("mc_show_menu", player.id, "LIST_KICK");
menus.screen(player)?.text;                                  // what he sees, keys too
menus.press(player, 1);
menus.translate({ MYPLUGIN_MENU_EXIT: "Exit" });
```
