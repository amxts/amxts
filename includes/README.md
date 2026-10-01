# includes

The Pawn includes the core generates its API from (`bun run generate`) and
compiles the host plugin with (`bun run host`), besides AMX Mod X's own in
`amxmodx/base/include`.

## Kept here

| file | what |
| --- | --- |
| `order.txt` | which includes the host plugin pulls in, in what order, and which it only parses (`-name`) |
| `sources.json` | the third-party includes, pinned: release, URL, sha256, license |
| `menu_core.inc` | the original Menu Core's natives: `~/natives` has them for a plugin that calls Menu Core as a Pawn plugin would, and the menu-core module stays call-compatible with it (its own contract is the include it generates, `include/menu_core.inc` in its package) |
| `universal_config.inc` | the original Universal Config's natives, the contract config-core implements; the same file as `include/universal_config.inc` in config-core's package |

Both originals are the author's own Pawn plugins, which the official modules
replace, and are under this repository's license.

## Fetched into `vendor/`

`vendor/` is git-ignored. `bun run setup` - also the first step of
`bun run generate` - downloads what `sources.json` pins, checks each file's
sha256 and puts the includes there:

| source | version | license | files |
| --- | --- | --- | --- |
| [ReAPI](https://github.com/rehlds/ReAPI) | 5.29.0.358 | GPL-3.0 | `reapi*.inc` and ReGameDLL's `cssdk_const.inc`, from the release archive |
| [ReSemiclip AMXX](https://github.com/Next21Team/resemiclip-amxx) | 2.3.9-amxx | GPL-2.0 | `resemiclip.inc`, from the tag |

A source already fetched is not fetched again (`vendor/sources.lock.json`).
The downloads are kept in `vendor/.download/`; without a connection, a file
put there by hand under its URL's name is used instead, after the same check.

The ReAPI release matters: hookchain ids and member ids are computed from its
headers, and an include from another release can renumber a region, so a hook
registers something else without a word. A new release is a change to
`sources.json` - its URL and sha256 - and a new generated API.

## Where a build looks

A project looks in its own `includes/` first, then in its server's
(`addons/amxmodx/scripting/include` beside `AMXTS_SERVER`, or, without a
server, what the `amxts` command fetched into `.amxts/include`), then here and
in AMX Mod X's. `vendor/` is the core's own: a project sees what its server
has.
