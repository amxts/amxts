---
title: "Configs: config-core"
---

Config files in INI, YAML or JSON, read into a typed object shaped like its
defaults, and written back in their own format with their comments. A file
whose shape is not known beforehand reads as a tree of values. A TypeScript
plugin uses it as `configs`, without an import line
([auto-imports](../../en/2.core/01.plugin.md#auto-imports)). Pawn plugins read INI files
through the `cfg_*` natives of `universal_config.inc`.

## From TypeScript

```ts
const settings = configs.load("settings", {      // configs/settings.yaml, .yml, .json, .jsonc or .ini
	chat: { prefix: "[Server]" },
	round: { time: 2.5, mode: "normal" },
	maps: ["de_dust2"],
});

settings.chat.prefix;                             // from the file, or "[Server]" when the file does not set it
settings.round.time = 3;
configs.save(settings);                           // in the file's format, comments kept
```

The defaults say the object's shape: each field is typed as its default is,
and the editor completes `settings.round.time` and refuses
`settings.round.tme`. What the file has replaces the default, value by value;
what it leaves out stays the default.

With an interface the fields get descriptions, optional ones and unions of
names:

```ts
type Mode = "normal" | "dm" | "knife";

interface Settings {
	/** The text before every chat message. */
	chat: { prefix: string };
	round: { time: number; mode: Mode };
	maps: string[];
	/** Shown on join; left out, nothing is shown. */
	motd?: string;
}

const settings = configs.load<Settings>("settings", {
	chat: { prefix: "[Server]" },
	round: { time: 2.5, mode: "normal" },
	maps: [],
});

if (settings.motd !== undefined) print(player, settings.motd);
```

```yaml
# configs/settings.yaml
chat:
  prefix: "[Server]"
round:
  time: 2.5
  mode: normal
maps: [de_dust2, de_inferno]
motd: Welcome!
```

- A name without an extension reads the first of `name.ini`, `name.yaml`,
  `name.yml`, `name.json` and `name.jsonc` that is there; two of them are an
  error in the server console, and the first is read. With an extension it
  reads that file. A file that is not there reads as the defaults, and
  `save()` writes it as `name.yaml`.
- `save(settings)` writes every field of the object into the file it was
  read from: the values it changed in place, with their comments, and the
  ones the file did not have after them. An optional field left out is
  removed from the file.
- `load()` gives a copy: changing the object does not change the defaults.
  A second `load()` reads the file again.

### What the file says, checked

A value that is not what the object holds keeps its default, and the server
console says where it is and what is wrong — the admin sees the mistake at
start-up rather than a setting silently ignored:

```
[ConfigCore] configs/settings.yaml:5:9: "time" is text ("soon"), not a number - the default stays
[ConfigCore] configs/settings.yaml:6:9: "mode" is "dmm", not one of "normal", "dm", "knife" - did you mean "dm"? - the default stays
[ConfigCore] configs/settings.yaml:2:3: unknown key "prefx" in "chat" - did you mean "prefix"?
```

- A number may be written as text (`"2.5"`, and every INI value is text); a
  boolean as `true`/`false`, `yes`/`no`, `on`/`off` or `1`/`0`.
- An item of a list that is not of its kind is left out; a single value where
  a list goes is a list of one.
- An empty value (`key:` in YAML, `null` in JSON) keeps the default. In INI
  `key =` is empty text, or an empty list.
- An object made from the file — an item of a list of objects, an optional
  object the defaults leave out — takes a field the file leaves out as empty
  (`""`, `0`, `false`, the union's first name, `[]`), and the console says so.

### What an object holds

| In the object | In the file |
| --- | --- |
| `string`, `number`, `boolean` | a value; a boolean is `true`/`false`, `yes`/`no`, `on`/`off` in any case, or a number (`0` is false) |
| a union of names, `"normal" \| "dm"` | one of them — another is said, with the nearest name |
| `string[]`, `number[]`, `boolean[]`, a list of names | a list |
| an object, `{ prefix: string }`, nested as deep as needed | an object |
| a list of objects, `Item[]` | a list of objects |
| a list of lists, `string[][]` (of text, numbers, booleans or names) | a list of lists: rows of values |
| `Map<string, number>` (of text, numbers, booleans or names) | an object whose keys are the map's |
| `field?: T` | may be left out: `undefined` until the file or the code sets it |

::: warning
The build reads the shape from the source, so it has to be written there:
the defaults as an object literal (with a value in every list), or a type
given — `configs.load<Settings>(...)`, or a `const defaults: Settings`. A
list of lists of lists or of objects, a union that is not of names (`number | string`), a generic
interface and one that `extends` another are refused with the place and the
fix. The object of `configs.load(name, { ... })` without a type goes to a
function as `typeof settings`, or as an interface of the same fields.
:::

### INI files

An INI file is sections of values: `[chat]` with `prefix = [Server]` is
`chat.prefix`.

```ini
; configs/settings.ini
[chat]
prefix = [Server]

[round]
time = 2.5
mode = normal
modes = normal dm
```

- Each object at the top of the object is a section; its fields are the
  section's keys, found in any case (`PREFIX = ...` is `prefix`). A section's
  name is as written: `[CHAT]` is not `chat`, and the console says so.
- A list is a line of values (`modes = normal dm`); an object inside a
  section is a `key = { ... }` block; a boolean is written `1` or `0`.
- A text with spaces is quoted: `title = "Main menu"`. Unquoted it is a list
  of words, and a text field keeps its default and says why.
- A list of lists is a block of rows in quotes: `CVARS = { "mp_timelimit" "30" }`
  is `[["mp_timelimit", "30"]]`. Saved, it stays a block — rows of one value
  too — with the comments above its rows.
- A `Map` at the top is a section of its own: `[prices]` with
  `de_dust2 = 3`.

::: warning
An INI file has no place for a value at the top of the object that is not an
object, and no lists of objects. Such a field stays its default when the file
is INI, and the console says so once. Write that config in YAML or JSON.
:::

### Formats

- **YAML:** mappings and lists, indented or in `{ }` and `[ ]`; plain and
  quoted text with its escapes; `|` and `>` blocks; numbers, `true`/`false`
  and `null` as YAML 1.2 reads them (`yes` is text); `#` comments; `---` and
  `...` around the document.
- **JSON:** as JSON is written, plus `//` and `/* */` comments and a comma
  after the last member or item (JSONC), in `.json` files too.
- **INI:** a `[section]` is an object; a line of several values is a list; a
  block is an object, or a list of rows. Keys in a section are found in any
  case.
- Saving keeps comments on lines of their own and blank lines, and JSON's
  indentation; a comment after a value on its line is dropped.

::: warning
YAML's anchors and aliases (`&`, `*`), tags (`!`), complex keys (`?`),
directives and several documents in one file are not read. A file with one of
them — or any mistake — reads as an empty object, and the server console says
where: `configs/settings.yaml:4:9: anchors and aliases (& and *) are not supported - write the value out`.
The whole list, with what saving keeps, is on
[Limitations](../../en/1.getting-started/06.limitations.md#configs).
:::

### Files of unknown shape

A file whose keys are not known beforehand — a list of maps with their own
settings, a file another plugin writes — reads as a tree of values:

```ts
const maps = configs.read("maps");                // configs/maps.yaml, .json or .ini

for (const map of maps.values()) {
	console.log(`${map.key}: ${map.getNumber("rounds", 30)} rounds`);
}

maps.setNumber("de_dust2.rounds", 20);
maps.save();
```

- A value is a `ConfigNode`: `kind` (`"object"`, `"array"`, `"string"`,
  `"number"`, `"boolean"`, `"null"`), `key`, and `file`, `line`, `column` —
  where it was read. `get(path)`, `keys(path)` and `values(path)` lead into
  it; a path is `chat.prefix` or `items[0].name` — an item of a list is `[0]`.
- `getString`, `getNumber`, `getBoolean` and `getStrings` take a fallback for
  a value that is not there or not of its kind; `set`, `setNumber`,
  `setBoolean` and `setStrings` make the objects (and the lists, before an
  item `[0]`) on the path, and return false
  where it goes through text or a number. `parse(text, format)` reads a text
  the same way.

The base folder can also be the project's, in `amxts.config.ts`:

```ts
export default defineConfig({
	modules: ["@amxts/config-core"],
	configs: { baseDir: "myplugin" },    // configs/myplugin/
});
```

## From any plugin: one config-core for the server

The server has one instance of `@amxts/config-core`: the
config-core plugin's. Any other plugin that uses it calls that
instance, with the same functions and types (see
[Shared modules](../../en/5.modules/01.shared-modules.md)): the base folder is one for the whole
server (menu-core reads its menus from it too). A `ConfigNode` is the
owner's object: each of its methods runs in the owner,
so reading a file value by value from another plugin is a call a value -
fine at start-up, worth keeping out of a frame. An object `configs.load()`
gives is the plugin's own: `load()` and `save()` read and write the file
through the owner, and between them `settings.round.time` is a field like any
other.

## For Pawn plugins

A project whose TypeScript plugins do not use config-core keeps it for its
Pawn plugins with `pawn: ["@amxts/config-core"]` in `amxts.config.ts`: a
module no plugin uses is otherwise left out of the build
([only what is used is built](../../en/2.core/01.plugin.md#only-what-is-used-is-built)).

The config-core plugin gives Pawn plugins the 28 natives of
`universal_config.inc` — `cfg_load_file`, `cfg_get_value`, `cfg_set_int` and
the rest — with their signatures, so compiled `.amxx` plugins work against it
unchanged. Pawn plugins write `#include <universal_config>`.

config-core takes the place of `universal_config.amxx`: comment that one out
in `plugins.ini`, since two plugins cannot give the same natives.

## How the natives behave

No Pawn limits: a key or a value is as long as it is
written, a section keeps every entry, blocks nest as deep as they are
written, any number of files loads. A number reads as `parseFloat` reads it
(`1e5` is 100000) and is written as the number it is (`2.5`, not
`2.500000`). `CFG_CONTENT_SIMPLE` and `CFG_CONTENT_STRINGS` are one content:
a block of either holds a line of values.
