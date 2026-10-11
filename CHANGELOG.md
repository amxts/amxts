# Changelog

## v0.3.0

> v0.3.0 is the next minor release.

### 📣 Some news

#### 🧱 amxts is one module now

In 0.2, amxts was two pieces: the `amxts_amxx` module, and a host plugin, `amxts_host.amxx`, that sat in AMX Mod X's `plugins.ini` and passed the game's events on to TypeScript. Every event took a detour through Pawn on its way to your plugin.

👉 **In 0.3, the host plugin is gone.**

The module is a Metamod plugin as well, and it hears the game itself: the players' commands, the messages, the cvars, the log, the menus, and ReGameDLL's and ReHLDS's hookchains through its own hooks. Nothing goes in `plugins.ini` any more, and there is no Pawn between the game and your code.

It made amxts faster, too. I check every release against Pawn twins of the same plugins, measure by measure, and **a TypeScript plugin now runs at least as fast as Pawn on every measure the suite runs, and faster on most.**

#### 🚫 No ReAPI needed

What ReAPI's `rg_*` natives did for the API, the module now does itself, through ReGameDLL's own API, and through the game's functions on Valve's HLDS. Giving and taking weapons, switching teams, respawning, models, the HUD, text menus, `game.restartRound()` and `game.checkWinConditions()` all work the same on:

- ReHLDS + ReGameDLL, with or without ReAPI;
- Valve's own HLDS with metamod-p.

ReAPI's natives are still there in `@amxts/core/natives`, for when your server has it and you want one.

#### 🖥️ The server only loads, your machine builds

A server never compiles anything now: it loads the `.aot` files a project builds. You build with `npx amxts build` and upload, or let `amxts dev` / `build --deploy` do it, the same way a `.sma` is compiled at home and an `.amxx` uploaded. The server kit is a fraction of its old size as a result, and a `plugins.ini` line that says `name.ts` simply loads `name.aot`.

#### 🔗 One line, one ABI

A plugin built with 0.3.0 loads on every 0.3 module: 0.3.1, 0.3.2 and so on. The official modules ship prebuilt plugins that serve the whole line, so a patch release of the core never makes you (or a module's author) rebuild.

### 👀 Highlights

#### 🔐 Secrets with `env()`

A token or an API key shouldn't be in your code, and it shouldn't be in the `.aot` either: anything compiled into a plugin can be read back out of it. `env()` reads it on the server instead:

```ts
const token = env("MYPLUGIN_TOKEN");          // required: text
const maxRecords = env("MYPLUGIN_MAX", 100);  // a number
const debug = env("MYPLUGIN_DEBUG", false);   // on/off: 1/0, true/false, yes/no, on/off
```

The values live in the server's `addons/amxts/.env`, and the server process's environment wins over the file, so a game panel or Docker can pass them without any file on the server at all. The default gives the type. A call without one is required: the plugin doesn't start until the value is there, and the console says which one it needs, in one line. `amxts dev` warns you before it deploys.

#### 💬 `player.print` and `server.print`

Printing to one player or to everyone reads the way it says:

```ts
player.print(`Welcome back, ${player.name}!`);
player.print("Round restarted", "center");
server.print("Map changes in 30 seconds");
```

Chat goes through the engine directly, so a chat message is as cheap as in Pawn.

#### ⌨️ Commands, the way you'd write them

One command can have several names, and its handler gets the player:

```ts
function checkpoint(player: Player) {
	player.print("Checkpoint saved");
}

server.addCommand(["/cp", "cp"], checkpoint);   // in chat and in the console
server.addCommand(["/kz", "chooseteam"], (player) => openMenu(player));
```

And every command a player types reaches the `"command"` event, with its name, words and text, where `preventDefault()` stops it:

```ts
server.addEventListener("command", (event) => {
	if (event.command == "chooseteam" && !event.player.isAlive) event.preventDefault();
});
```

#### 👁️ What each player sees

`"entityState"` is what the server sends one player about one entity, every frame. Change it, and only that player sees the change:

```ts
game.addEventListener("entityState", (event) => {
	if (event.player.team != "CT") {
		event.preventDefault();              // a marker only the CTs see
		return;
	}
	event.renderFx = "glowShell";            // and it glows for them
	event.renderColor = [0, 160, 255];
}, { classname: "myplugin_marker" });
```

#### 🧩 Plugins that manage plugins

`server.plugins` lists every plugin on the server, TypeScript and Pawn alike, and lets you stop, start and reload one, load one the list doesn't name, or call a Pawn plugin's public function:

```ts
const shop = server.plugins.find(plugin => plugin.file == "shop.aot");
shop?.reload();
```

#### 💾 Storage that keeps your types

`new Storage<T>(name)` keeps any interface, saved as JSON, and a missing key reads as `undefined`, the same as `Map.get`:

```ts
interface Profile { kills: number; title: string }

const profiles = new Storage<Profile>("myplugin_profiles");
profiles.set(player.steamId, { kills: 10, title: "Rookie" });
```

A new Storage takes over AMX Mod X's nVault file of the same name once, so nothing is lost when you move a Pawn plugin over.

#### 📦 Files, downloads and archives

Files can be read and written as bytes, and `fs.extract` unpacks a zip archive, so a plugin can download a map and put it in place:

```ts
import * as fs from "@amxts/core/fs";

const response = await fetch(`https://maps.example.com/${name}.zip`);
for (const entry of fs.extract(await response.arrayBuffer())) {
	fs.writeFileSync(entry.path, entry.data);
}
```

#### 🏃 Movement events: touches and frame time

The player's movement events (`move`, `airMove`, `jumpMovement`, `duckMovement`, `ladderMove` and the rest) have `event.touchCount` and `event.frameTime`. That's enough for jump stats without ReAPI's `get_pmove`.

#### 🛠️ And more

- **traces:** `trace.line`, `player.aim` (what a player is aiming at), `canSee`;
- **messages by name:** `player.send` and `server.send`;
- **player:** `player.model`, `player.info`, `player.country`, `player.showMotd`, and a light style for one player;
- **screen:** `player.screen.hint` and `HudLine.showAll`;
- **shots:** stop a shot, or play it to only some players;
- **between plugins:** a `Record<string, T>` and a rest parameter can cross, and `Array#flatMap` compiles;
- **typecheck:** `amxts typecheck` points at an event name kept in a variable, and at `const rows = []` without its element type.

#### 🖥️ The command, 0.3.0

`amxts dev` has a panel: the server's map, players and FPS, each plugin's state and the last rebuild, with keys to rebuild, change the map or restart the round. `amxts rcon` sends a command to the server, and the command tells you when a newer amxts is out.

### 🩹 Important fixes

- A template string's parts stay alive until they are joined, so a collection in the middle of one no longer corrupts the heap ([950eef68](https://github.com/amxts/amxts/commit/950eef68)), and a closure kept in a global stays alive ([ea55f8ea](https://github.com/amxts/amxts/commit/ea55f8ea)).
- A menu message a plugin blocks leaves the menu's keys working ([87d2ab2a](https://github.com/amxts/amxts/commit/87d2ab2a)).
- A `.aot` uploaded while the server reads it is no longer loaded half-written ([a16271d2](https://github.com/amxts/amxts/commit/a16271d2)).
- A bot's command works on plain HLDS for Linux, and never reads a stale command line ([bef4a16b](https://github.com/amxts/amxts/commit/bef4a16b), [56c5dc63](https://github.com/amxts/amxts/commit/56c5dc63)).
- `viewModel` and `weaponModel` are the model's file, as text ([25a13ffc](https://github.com/amxts/amxts/commit/25a13ffc)).
- The fake server records every engine message (`SVC_NEWMOVEVARS`, `SVC_LIGHTSTYLE`, …), not only temporary effects ([609d07b2](https://github.com/amxts/amxts/commit/609d07b2)).

### ⚠️ Breaking changes

Each with what to write instead; **upgrade** says what `npx amxts upgrade` does for you.

| 0.2 | 0.3 | upgrade |
| --- | --- | --- |
| `print(player, text)`, `print(player.id, text)` | `player.print(text)` | rewrites it, and drops `print` from the core's import once none is left |
| `print(0, text)` | `server.print(text)` | rewrites it |
| `print({ id, variant }, text)` | `player.print(text, variant)` | rewrites it; another field is listed |
| `print(5, text)` (a number) | `player.print(text)` | lists it |
| `storage.get(key)` gives `null` for a missing key | `undefined`, as `Map.get`; a Storage is `data/amxts/storage/<name>.json`, and a new one takes AMX Mod X's nVault file of its name once | rewrites `== null` and a `string \| null` annotation of its value |
| `player.give(name as ItemName)` | `player.give(name)`: any text | drops the cast, and its import when nothing else names the type |
| `player.removeAllItems(true)` | `player.removeAllItems({ suit: true })` | rewrites it |
| `viewModel` / `weaponModel` a number | the model's file, text (`"models/v_knife.mdl"`) | `0` becomes `""`; another number is listed |
| a test's `server.vault(name)` | `server.storage(name)` | rewrites it |
| `cmd(name, handler, flag, info)`, `cmdWide(...)` | no `info` | drops it |
| the server events `"pause"`, `"unpause"`, `"modules"` | gone: AMX Mod X raises them for a Pawn plugin about itself alone | lists the listener |
| reapi's `DisableHookChain(handle)` of a `hook()` handle | `unhook(handle)` | lists it |
| a raw native's const string as `cells("h")` | the string as it is: `"h"` | lists it |
| a raw native that registers for its calling plugin - `set_task`, `register_clcmd`, `register_event`, `register_message`, `RegisterHam`, `RegisterHookChain`, `menu_create`, `log_amx`... | answers 0 from TypeScript: use the API's timers, commands, events and `Menu` | - |
| `.ts` files on the server, built there | `npx amxts build` and upload the `.aot`, or `build --deploy` / `amxts dev`; a `plugins.ini` line `name.ts` loads `name.aot` | builds the project; the server step puts the module in |
| `amxts_host.amxx` in AMX Mod X | nothing: amxts is the module alone | the server step takes the line, the plugin and its list out |
| `addons/amxts/tools/` and `build/` of an older kit | not used | - delete them |
| the `changeYaw` event's answer | a number of degrees, a float, as the game's function returns | - |
| a command's `description` in `amx_help` / `amxx cmds` | listed by `server.commands` alone | - |

### ✅ Upgrading

First update the command with your project's own package manager. A 0.2 project's `amxts` is the one its core came with:

```sh
npm install -D @amxts/cli@latest   # pnpm add -D, yarn add -D, bun add -d
```

Then run:

```sh
npx amxts upgrade
```

It moves `@amxts/core` to 0.3.0 and each official module to its version for it (`menu-core` 0.3.0, `config-core` 0.2.0, `resemiclip` 0.1.3, `ftp` 0.1.1), rewrites your code (the table above), builds, and puts the 0.3.0 module on the server in `AMXTS_SERVER`. Stop a running Windows server first, or run `npx amxts upgrade --server-only` after.

Then read its "to check by hand" list and run `npx amxts test`. For any other server, upload the `.aot` files, and delete an old kit's `addons/amxts/tools/` and `addons/amxts/build/`.

> [!NOTE]
> Known issues: `Infinity | 0` and `Infinity >>> 0` give `-1` and `4294967295` instead of `0`. A plugin named like a file of the core's API (`facade.ts`, `constants.ts`, `hooks.ts`, …) takes that file's place in the build, so name it otherwise. A Pawn plugin's `amxclient_cmd` reaches no TypeScript command.

### 👉 Changelog

[compare changes](https://github.com/amxts/amxts/compare/v0.2.4...v0.3.0)

### 🚀 Enhancements

- **abi:** A plugin loads on any patch of its line ([897763dc](https://github.com/amxts/amxts/commit/897763dc))
- **modules:** A prebuilt module serves its whole line ([6c317ecf](https://github.com/amxts/amxts/commit/6c317ecf))
- **runtime:** The module stays loaded as a Metamod plugin ([d60d29dc](https://github.com/amxts/amxts/commit/d60d29dc))
- **commands:** ⚠️  Commands in the module, `bot.command` ([c1e439af](https://github.com/amxts/amxts/commit/c1e439af))
- **forwards:** A Pawn plugin's forward reaches subscribe ([be62510d](https://github.com/amxts/amxts/commit/be62510d))
- **events:** ⚠️  Game events through the module's own hooks ([487725b6](https://github.com/amxts/amxts/commit/487725b6))
- **events:** ⚠️  Messages, log and cvars through the module ([277d3e96](https://github.com/amxts/amxts/commit/277d3e96))
- **menus:** Menus dispatched by the module ([d6e302b4](https://github.com/amxts/amxts/commit/d6e302b4))
- **runtime:** ⚠️  The module alone, without the host plugin ([289aaa59](https://github.com/amxts/amxts/commit/289aaa59))
- **players:** A player's actions without ReAPI ([e4be9385](https://github.com/amxts/amxts/commit/e4be9385))
- **game:** `game.restartRound`() and `checkWinConditions`() ([7c34005f](https://github.com/amxts/amxts/commit/7c34005f))
- **api:** ⚠️  The `0.3` API - plugins, storage, traces, messages ([c4aa1d13](https://github.com/amxts/amxts/commit/c4aa1d13))
- **api:** `player.model`, HUD from the module, `entityState` ([9fa8eee9](https://github.com/amxts/amxts/commit/9fa8eee9))
- **abi:** A plugin checked by the imports it uses ([fb66f493](https://github.com/amxts/amxts/commit/fb66f493))
- **compiler:** Array#`flatMap` ([9aa7d20d](https://github.com/amxts/amxts/commit/9aa7d20d))
- **testing:** `mp_freezetime` and `mp_round_infinite` by default ([dd4143c6](https://github.com/amxts/amxts/commit/dd4143c6))
- **events:** A console command's name, words and text ([d11b8021](https://github.com/amxts/amxts/commit/d11b8021))
- **commands:** Several names, a handler of the player ([829ec644](https://github.com/amxts/amxts/commit/829ec644))
- **modules:** A Record and a rest parameter cross between plugins ([06b86ef7](https://github.com/amxts/amxts/commit/06b86ef7))
- **server:** ⚠️  A server loads only `.aot` ([b94dbe87](https://github.com/amxts/amxts/commit/b94dbe87))
- **fs:** Files as bytes, and unzip ([f6f2d48f](https://github.com/amxts/amxts/commit/f6f2d48f))
- **screen:** A light style for one player ([7a04a13b](https://github.com/amxts/amxts/commit/7a04a13b))
- **cli:** Typecheck reports an event name in a variable ([8efeee8d](https://github.com/amxts/amxts/commit/8efeee8d))
- **events:** Stop a shot, or play it to some players ([7e9d3cdf](https://github.com/amxts/amxts/commit/7e9d3cdf))
- **fs:** Extract an archive, its kind read off its first bytes ([eae2e08a](https://github.com/amxts/amxts/commit/eae2e08a))
- **api:** ⚠️  `player.print`, no free print ([d7fcf7a7](https://github.com/amxts/amxts/commit/d7fcf7a7))
- **events:** `preventDefault`() stops a player's command ([9ecf3eca](https://github.com/amxts/amxts/commit/9ecf3eca))
- **runtime:** `env`() and the server's `.env` ([db01c7d7](https://github.com/amxts/amxts/commit/db01c7d7))
- **events:** `touchCount` and `frameTime` of the movement ([0b4d3865](https://github.com/amxts/amxts/commit/0b4d3865))

### 🩹 Fixes

- **natives:** Array sizes the includes name by a define ([1930200a](https://github.com/amxts/amxts/commit/1930200a))
- **testing:** Strings cross a native as the module passes them ([4d716e0e](https://github.com/amxts/amxts/commit/4d716e0e))
- **testing:** The fake server records every engine message ([609d07b2](https://github.com/amxts/amxts/commit/609d07b2))
- **runtime:** A bot's command on plain HLDS for Linux ([bef4a16b](https://github.com/amxts/amxts/commit/bef4a16b))
- **runtime:** Align the log hook's stack on Linux ([bc24500c](https://github.com/amxts/amxts/commit/bc24500c))
- **runtime:** Keep the line a bot's command puts back ([ac4e62b8](https://github.com/amxts/amxts/commit/ac4e62b8))
- **runtime:** Bind a hook made at a plugin's top level ([65ed6ab3](https://github.com/amxts/amxts/commit/65ed6ab3))
- **runtime:** A bot's command reads no stale command line ([56c5dc63](https://github.com/amxts/amxts/commit/56c5dc63))
- **runtime:** No command line from a frame that has returned ([7aa39838](https://github.com/amxts/amxts/commit/7aa39838))
- **compiler:** Objects in a frame are no roots to visit ([84cbb7c7](https://github.com/amxts/amxts/commit/84cbb7c7))
- **natives:** Kept literals in the image's data, not its heap ([b44f3977](https://github.com/amxts/amxts/commit/b44f3977))
- **entities:** `viewModel` and `weaponModel` are text ([25a13ffc](https://github.com/amxts/amxts/commit/25a13ffc))
- **compiler:** Null given to a setter runs the setter ([78e96fdb](https://github.com/amxts/amxts/commit/78e96fdb))
- **runtime:** A plugin's cvar in the module's memory ([037babd9](https://github.com/amxts/amxts/commit/037babd9))
- **compiler:** A closure kept in a global stays alive ([ea55f8ea](https://github.com/amxts/amxts/commit/ea55f8ea))
- **compiler:** A returned object literal is its interface ([70c3112e](https://github.com/amxts/amxts/commit/70c3112e))
- **entities:** `player.fallVelocity` sets the game's own too ([b2c113f9](https://github.com/amxts/amxts/commit/b2c113f9))
- **build:** Reuse linked modules on the second build ([dcaa1352](https://github.com/amxts/amxts/commit/dcaa1352))
- **player:** Motd listeners do not hear `showMotd` ([44e48de4](https://github.com/amxts/amxts/commit/44e48de4))
- **cli:** `amxts` check in a project names typecheck and build ([4cab6433](https://github.com/amxts/amxts/commit/4cab6433))
- **compiler:** A template's parts live until it is joined ([950eef68](https://github.com/amxts/amxts/commit/950eef68))
- **messages:** A blocked menu message leaves the menu's keys ([87d2ab2a](https://github.com/amxts/amxts/commit/87d2ab2a))
- **chat:** A line that does not start with a colour starts yellow ([47d7f4cb](https://github.com/amxts/amxts/commit/47d7f4cb))
- **server:** A reload raises end, then the map's start ([79b23d10](https://github.com/amxts/amxts/commit/79b23d10))
- **lang:** Sort orders by the sign of the comparator's number ([c16c50ae](https://github.com/amxts/amxts/commit/c16c50ae))
- **server:** A `.aot` read while it is written ([a16271d2](https://github.com/amxts/amxts/commit/a16271d2))
- **fs:** A byte write the editor reads without an error ([b83e8e32](https://github.com/amxts/amxts/commit/b83e8e32))
- **lang:** Languages are the plugin's dictionaries' ([36879f84](https://github.com/amxts/amxts/commit/36879f84))
- **lang:** An empty array without its type is reported ([d0046f69](https://github.com/amxts/amxts/commit/d0046f69))
- **upgrade:** A model's 0 is the empty file name ([eb2ada5d](https://github.com/amxts/amxts/commit/eb2ada5d))
- **upgrade:** Drop the type import a give cast no longer needs ([01fe96ca](https://github.com/amxts/amxts/commit/01fe96ca))
- **upgrade:** Drop the core's print import once no print is left ([533ae8c5](https://github.com/amxts/amxts/commit/533ae8c5))
- **upgrade:** Cmd's info goes; `0.3`'s other breaks are listed ([56e4ff90](https://github.com/amxts/amxts/commit/56e4ff90))
- **upgrade:** No blank first line where an import went ([92bb4871](https://github.com/amxts/amxts/commit/92bb4871))

### 🔥 Performance

- **natives:** ⚠️  Strings cross a native without copies ([c0bcd0df](https://github.com/amxts/amxts/commit/c0bcd0df))
- **events:** No list copy or new Player per dispatch ([fff7f2b7](https://github.com/amxts/amxts/commit/fff7f2b7))
- **events:** An event's written fields made on first write ([9185dc15](https://github.com/amxts/amxts/commit/9185dc15))
- **runtime:** Forwards and handlers by number ([c23e2fbd](https://github.com/amxts/amxts/commit/c23e2fbd))
- **players:** `player.name` read once until it changes ([9a28e9bf](https://github.com/amxts/amxts/commit/9a28e9bf))
- **runtime:** Timers and the frame on Metamod's StartFrame ([4c66bd65](https://github.com/amxts/amxts/commit/4c66bd65))
- **wamrc:** A number made a cell through SSE2 on i386 ([1edfe6f9](https://github.com/amxts/amxts/commit/1edfe6f9))
- **runtime:** Client and server events from Metamod ([ef0751f5](https://github.com/amxts/amxts/commit/ef0751f5))
- **natives:** Exported natives are the module's own ([c5e2c6bf](https://github.com/amxts/amxts/commit/c5e2c6bf))
- **runtime:** Call a plugin's handler directly ([6560dbea](https://github.com/amxts/amxts/commit/6560dbea))
- **runtime:** Bind a timer's function once ([0627a22d](https://github.com/amxts/amxts/commit/0627a22d))
- **runtime:** Optimise the module and WAMR as one ([784095e8](https://github.com/amxts/amxts/commit/784095e8))
- **events:** One object a game event, its walk inlined ([321eccfb](https://github.com/amxts/amxts/commit/321eccfb))
- **timers:** A timer is its handler, no object ([999c0e7a](https://github.com/amxts/amxts/commit/999c0e7a))
- **vector:** X, y and z as loads and stores ([e27e692f](https://github.com/amxts/amxts/commit/e27e692f))
- **entities:** A vector field in one call into the module ([1e8f8ea1](https://github.com/amxts/amxts/commit/1e8f8ea1))
- **players:** A kept name read without a call ([451efb0f](https://github.com/amxts/amxts/commit/451efb0f))
- **natives:** A buffer takes the AMX heap without a call ([25b4d13d](https://github.com/amxts/amxts/commit/25b4d13d))
- **natives:** Text a native gives again is one string ([8f13bf70](https://github.com/amxts/amxts/commit/8f13bf70))
- **build:** A full build inlines small functions ([8a5c996b](https://github.com/amxts/amxts/commit/8a5c996b))
- **build:** The engine hooks' imports as direct calls ([4bd58373](https://github.com/amxts/amxts/commit/4bd58373))
- **players:** A field's HUD message without AMX Mod X's natives ([2e0492d0](https://github.com/amxts/amxts/commit/2e0492d0))
- **runtime:** Small blocks on free lists, rarer collections ([37c7d0cf](https://github.com/amxts/amxts/commit/37c7d0cf))
- **timers:** A timer is a slot the module hands out ([22c2beea](https://github.com/amxts/amxts/commit/22c2beea))
- **players:** Health read without AMX Mod X's call ([8e3307f1](https://github.com/amxts/amxts/commit/8e3307f1))
- **natives:** Thunks hand their cells straight on ([e256878d](https://github.com/amxts/amxts/commit/e256878d))
- **compiler:** Calls keep only the frames and checks they need ([ee0d89d8](https://github.com/amxts/amxts/commit/ee0d89d8))
- **runtime:** Less between a hooked call and the plugin ([1f689378](https://github.com/amxts/amxts/commit/1f689378))
- **events:** A server event is one object, read from its call ([1f5132d4](https://github.com/amxts/amxts/commit/1f5132d4))
- **natives:** Text comes back counted, a field's message in one call ([1067755b](https://github.com/amxts/amxts/commit/1067755b))
- **compiler:** A vector in one allocation, in its frame ([b91d8d11](https://github.com/amxts/amxts/commit/b91d8d11))
- **natives:** Text crosses a native four bytes at a time ([62e6db69](https://github.com/amxts/amxts/commit/62e6db69))
- **commands:** A command's words read when asked ([6111021a](https://github.com/amxts/amxts/commit/6111021a))
- **menus:** The page drawn last is sent again ([c525a0ea](https://github.com/amxts/amxts/commit/c525a0ea))
- **fields:** A vector read in a call that collects nothing ([dfa33ca0](https://github.com/amxts/amxts/commit/dfa33ca0))
- **compiler:** An empty frame dropped, objects zeroed once ([4973eb28](https://github.com/amxts/amxts/commit/4973eb28))
- **natives:** Leaf natives take literals as kept cells ([9bdebb4b](https://github.com/amxts/amxts/commit/9bdebb4b))
- **commands:** A command found and run with less work ([90ad0b6a](https://github.com/amxts/amxts/commit/90ad0b6a))
- **module:** A forward's one listener called from its hook ([bf797e65](https://github.com/amxts/amxts/commit/bf797e65))
- **natives:** Variadic calls built without allocating ([588cd96e](https://github.com/amxts/amxts/commit/588cd96e))
- **commands:** A command run without its closure or `read_argc` ([78b635b2](https://github.com/amxts/amxts/commit/78b635b2))
- **api:** Text the game cannot have changed is kept ([aa375be4](https://github.com/amxts/amxts/commit/aa375be4))
- **commands:** A handler declared by name called directly ([02b17048](https://github.com/amxts/amxts/commit/02b17048))
- **wamr:** A whole-number check as one cvttsd2si ([2259e9c5](https://github.com/amxts/amxts/commit/2259e9c5))
- **compiler:** An options literal in the caller's frame ([70d16418](https://github.com/amxts/amxts/commit/70d16418))
- **compiler:** A literal's fields stored, its object zeroed in part ([4d1b0c76](https://github.com/amxts/amxts/commit/4d1b0c76))
- **linux:** The module optimised across files, as on Windows ([825e3211](https://github.com/amxts/amxts/commit/825e3211))
- **menus:** A Menu shown again rebuilds nothing ([84cbace4](https://github.com/amxts/amxts/commit/84cbace4))
- **compiler:** Whole numbers kept in i32 ([6820f5a6](https://github.com/amxts/amxts/commit/6820f5a6))
- **menus:** A Menu's key read off its page ([ea50e297](https://github.com/amxts/amxts/commit/ea50e297))
- **linux:** Numbers made whole without the x87's rounding ([79fa59be](https://github.com/amxts/amxts/commit/79fa59be))
- **hooks:** An event's objects made on its first listener ([ec5b0684](https://github.com/amxts/amxts/commit/ec5b0684))
- **api:** A chat message through the engine ([74163bbe](https://github.com/amxts/amxts/commit/74163bbe))

### 💅 Refactors

- **natives:** A bot's move crosses as cells ([c914f9ad](https://github.com/amxts/amxts/commit/c914f9ad))

### 📖 Documentation

- One module, no host plugin ([98990e6a](https://github.com/amxts/amxts/commit/98990e6a))
- **pawn:** The "From Pawn" page ([b3cc7fc7](https://github.com/amxts/amxts/commit/b3cc7fc7))
- **api:** The Pawn natives `trace.line` and `plugin.call` stand for ([f4236f44](https://github.com/amxts/amxts/commit/f4236f44))
- **players:** `authKey` through Reunion's API ([c0d96c9f](https://github.com/amxts/amxts/commit/c0d96c9f))
- **menus:** Several menus, actions and placeholders at once ([2714a170](https://github.com/amxts/amxts/commit/2714a170))
- **menus:** Showing the menu a player is on ([51a6b9d3](https://github.com/amxts/amxts/commit/51a6b9d3))
- **menus:** ADMIN and `ACCESS_ADMIN` are built in ([434c1803](https://github.com/amxts/amxts/commit/434c1803))
- **pawn:** The From Pawn pages as the coverage writes them ([9cba3b49](https://github.com/amxts/amxts/commit/9cba3b49))
- **cli:** The dev panel, `amxts` rcon and the update line ([eea6c15f](https://github.com/amxts/amxts/commit/eea6c15f))
- **modules:** A Record and a rest parameter cross between plugins ([b605647a](https://github.com/amxts/amxts/commit/b605647a))

#### ⚠️ Breaking Changes

- **commands:** ⚠️  Commands in the module, `bot.command` ([c1e439af](https://github.com/amxts/amxts/commit/c1e439af))
- **events:** ⚠️  Game events through the module's own hooks ([487725b6](https://github.com/amxts/amxts/commit/487725b6))
- **events:** ⚠️  Messages, log and cvars through the module ([277d3e96](https://github.com/amxts/amxts/commit/277d3e96))
- **runtime:** ⚠️  The module alone, without the host plugin ([289aaa59](https://github.com/amxts/amxts/commit/289aaa59))
- **api:** ⚠️  The `0.3` API - plugins, storage, traces, messages ([c4aa1d13](https://github.com/amxts/amxts/commit/c4aa1d13))
- **server:** ⚠️  A server loads only `.aot` ([b94dbe87](https://github.com/amxts/amxts/commit/b94dbe87))
- **api:** ⚠️  `player.print`, no free print ([d7fcf7a7](https://github.com/amxts/amxts/commit/d7fcf7a7))
- **natives:** ⚠️  Strings cross a native without copies ([c0bcd0df](https://github.com/amxts/amxts/commit/c0bcd0df))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.2.4

[compare changes](https://github.com/amxts/amxts/compare/v0.2.3...v0.2.4)

### Summary

A fix for a project that began on an amxts whose API lived in the plugins folder: its `plugins/` still held that API's files (`constants.ts`, `facade.ts` and the rest), and the build took each for a plugin, so `npx amxts upgrade` ended with `constants does not compile`. The upgrade removes those copies and names them; the build leaves them out with a warning. An author's own file of such a name is kept.

### ⬆️ Upgrade guide

`npx amxts upgrade` in the project, with the server stopped: it moves `@amxts/core` to 0.2.4, removes the old API copies from `plugins/`, builds the plugins again and puts the 0.2.4 module on the server named in `.env`. A server installed by hand takes the module (and `amxts-compile`, where it has one) from this release, and its plugins are built again.

### 🩹 Fixes

- **build:** Old copies of amxts's API are not plugins - the build leaves them out of `plugins/` and says to delete them, and the modules stay prebuilt ([22303d7](https://github.com/amxts/amxts/commit/22303d7), [7ec565c](https://github.com/amxts/amxts/commit/7ec565c))
- **upgrade:** `npx amxts upgrade` removes the old copies of amxts's API from `plugins/`, after rewriting the imports of them ([634912c](https://github.com/amxts/amxts/commit/634912c))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.2.3

[compare changes](https://github.com/amxts/amxts/compare/v0.2.2...v0.2.3)

### Summary

A fix for a plugin that gives items on `playerSpawn`: when a bot took the slot of a player who had left the map, the game spawned it before it counted it in again, so the listener ran for a player ReAPI still counted out. Every ReAPI native it called then failed with `player N is not connected`, which the server log showed as run time errors of `amxts_host.amxx`. Such a spawn no longer reaches the listeners; the bot's next spawn does, as before.

A plugin's tests on the fake server run under Node with Vitest as well as under `bun test`: `@amxts/core/test-utils` loaded only under Bun.

### ⬆️ Upgrade guide

`npx amxts upgrade` in the project, with the server stopped: it moves `@amxts/core` to 0.2.3, builds the plugins again and puts the 0.2.3 module on the server named in `.env`. A server installed by hand takes the module (and `amxts-compile`, where it has one) from this release, and its plugins are built again.

To run an existing project's tests on Node: `npm i -D vitest`, import `test` and `expect` from `vitest` instead of `bun:test`, and `npx amxts test` (`@amxts/cli` 0.2.1) runs Vitest.

### 🩹 Fixes

- **hooks:** No `playerSpawn` for a player counted out - a bot that takes the slot of one who left the map no longer reaches the listeners while ReAPI's natives refuse it ([0d7ce9f](https://github.com/amxts/amxts/commit/0d7ce9f))
- **testing:** A plugin's tests run under Node - `@amxts/core/test-utils` loads under Vitest as under `bun test` ([4917b15](https://github.com/amxts/amxts/commit/4917b15))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.2.2

[compare changes](https://github.com/amxts/amxts/compare/v0.2.1...v0.2.2)

### Summary

A fix for a server that crashed at start on some AMX Mod X builds: the module registered its server commands with fewer arguments than AMX Mod X reads, and AMX Mod X read a command's description from leftover memory. Whether it crashed depended on the AMX Mod X build and the plugins loaded - most often with one or two plugins. The server suites run on AMX Mod X 1.9 and the newest 1.10 as well from now on.

### ⬆️ Upgrade guide

`npx amxts upgrade` in the project, with the server stopped: it moves `@amxts/core` to 0.2.2, builds the plugins again and puts the 0.2.2 module on the server named in `.env`. A server installed by hand takes the module (and `amxts-compile`, where it has one) from this release, and its plugins are built again.

### 🩹 Fixes

- **runtime:** No crash at start on some AMX Mod X builds: every native the module calls - `register_srvcmd`, `register_clcmd`, `set_task`, `RegisterHam` - gets all its parameters ([c02eb1e](https://github.com/amxts/amxts/commit/c02eb1e))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.2.1

[compare changes](https://github.com/amxts/amxts/compare/v0.2.0...v0.2.1)

### Summary

Fixes for 0.2.0: a plugin's call could fail at random when a native wrote into a buffer near the end of its memory, a build after an upgrade could keep plugins of the old version that the new module refuses, `amxts upgrade` rewrote the module's own files when the project lives in the server's folder, and the editor marked `error.message` in a `catch` as an error.

### ⬆️ Upgrade guide

`npx amxts upgrade` in the project: it moves `@amxts/core` to 0.2.1, builds the plugins again and puts the 0.2.1 module on the server named in `.env`. A server installed by hand takes the module (and `amxts-compile`, where it has one) from this release; the plugins are built again, since the module loads only plugins of its own release.

### 🩹 Fixes

- **module:** Start on a server with an older Visual C++ runtime: the network thread's lock crashed Windows servers whose `msvcp140.dll` predates Visual Studio 2022 17.10 ([04dbe6b](https://github.com/amxts/amxts/commit/04dbe6b))
- **runtime:** A native whose array size the include does not give - `get_players`, which `server.players` calls, among them - no longer fails the plugin's call when the array lies near the end of the plugin's memory ([e5dee94](https://github.com/amxts/amxts/commit/e5dee94))
- **editor:** `catch (error)` reads `error.message` without a cast, as the compiler and the docs do ([d2875cf](https://github.com/amxts/amxts/commit/d2875cf))
- **build:** A plugin is compiled again when the core's version changes: after an upgrade the build cache could hand back a plugin of the old version, which the new module refuses ([7abae6c](https://github.com/amxts/amxts/commit/7abae6c))
- **upgrade:** The module's own files are left alone - the API it writes into `addons/amxts/plugins/` - when the project lives in the server's folder ([c400c24](https://github.com/amxts/amxts/commit/c400c24))
- **testing:** The test server raises `configsQueued` and `configsExecuted` when the map starts, as AMX Mod X does ([2be9123](https://github.com/amxts/amxts/commit/2be9123))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.2.0

[compare changes](https://github.com/amxts/amxts/compare/v0.1.0...v0.2.0)

### Summary

0.2.0 makes a server one module to install and runs it on Valve's own HLDS as well as ReHLDS. Plugins get commands with typed arguments, menus, `fetch`, FTP and SFTP, bots, game messages by name, errors that point at their TypeScript, and names in the player's words. A 0.1.0 project moves over with `amxts upgrade`.

### ✨ Highlights

#### One module to install

A server needs the `addons/` folder of the server kit and one line in `modules.ini`:

```
amxts_amxx
```

Nothing goes into `plugins.ini`: the module brings its host plugin itself, writes it next to AMX Mod X's plugins when it starts, and removes it when it stops. An install from 0.1.0 can drop its `amxts_host.amxx` line; the console says so once.

#### Plain HLDS

amxts runs on Valve's own HLDS as well as on ReHLDS. The same plugin works on both, unchanged:

- every property of an entity and a player;
- the game events Ham Sandwich shares with ReAPI - `takeDamage`, `spawn`, `killed`, `jump` and more;
- rounds (`newRound`, `roundStart`, `roundEnd`), spawns, purchases, money and the bomb, heard through the game's own log lines and messages - after the fact, so `preventDefault()` on them says once that it cannot stop them.

What plain HLDS cannot give at all - ReGameDLL's own functions - prints one line in the console when a plugin listens for it, and a project with `target: "hlds"` does not build with such a listener. Each event's page says how it behaves on plain HLDS.

#### Faster properties

`entity.origin`, `player.health`, `player.money` and every other field are read and written where the game keeps them, on both servers, without a native call. A field the player sees on the HUD - `money`, the armor type, the flashlight's battery, night vision, the defuse kit - is sent to the player as the game sends it.

#### Commands with typed arguments

The usage is the command's help and its parser at once: `<name>` is required, `[name]` optional, and the interface you name says what each one is.

```ts
interface KickArgs {
	target: Player;
	reason?: string;
}

server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
	target.kick(reason ?? `Kicked by ${player.name}`);
}, { access: "Kick", description: "Kick a player" });
```

- a `Player` is found by `#userid`, by the whole name or by a part of it;
- a `number` is parsed, a union of words is one of them, the last text argument takes the rest of the line;
- a player nobody's name matches, several whose do, or a word too many answers the one who typed it with the usage, and the handler does not run;
- without the type argument every argument is text.

`player` is always the one who typed the command. `server.commands` lists every command with its usage, description and access, for a `/help` of your own.

#### Menus

`Menu` is AMX Mod X's own menu - number keys, pages with Back and More, Exit - written as objects. Each item has a title, and may say when it is shown (`visible`) and when it can be chosen (`enabled`, drawn grey otherwise); both are asked again at every `show`, for the player it is shown to. Choosing an item runs its `onSelect` and closes the menu.

```ts
const shop = new Menu("Shop");

shop.addItem({
	title: "Armor - $1000",
	enabled: ({ player }) => player.money >= 1000,
	onSelect: ({ player }) => {
		player.armor = 100;
		player.money -= 1000;
	},
});

shop.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	visible: ({ player }) => player.isAlive,
	onSelect: ({ player }) => {
		player.health = 100;
	},
});

server.addCommand("/shop", ({ player }) => shop.show(player));
```

A menu of the players on the server is a loop over `server.players`, one item for each. The official `@amxts/menu-core` takes the same shape in code - `menus.create(...)`, `addItem({ title, visible, enabled, onSelect })` with `({ player })` - and adds menus read from INI, YAML or JSON files, named conditions and actions, and lists with a row per player (`({ player, target })`).

#### `fetch` and `useFetch`, as in the browser

HTTPS, redirects, timeouts and retries, on a thread of their own, so the game never waits. `useFetch` never throws: it gives back `data` (the JSON, read as the type you name), `error` and `status`.

```ts
interface Weather {
	temperature: number;
}

server.addCommand("/weather", async ({ player }) => {
	const { data } = await useFetch<Weather>("https://api.example.com/weather", {
		query: { city: "Riga" },
		timeout: 5000,
		retry: 2,
	});

	if (data) print(player, `${data.temperature}°`);
	else print(player, "The weather service is not answering");
});
```

`fetch` is the browser's own beneath it, for a raw `Response`, headers and streams.

#### `@amxts/ftp`

A new official module: FTP, FTPS and SFTP, since game hosts give access to a server by those. Every call is a promise on the same network thread as `fetch`; files go between the game folder and the other server whole, binary included (maps, demos), without passing through the plugin.

```ts
import { ftp } from "@amxts/ftp";

const client = await ftp.connect("sftp://backup@example.com", { password: settings.password });
await client.upload("addons/amxmodx/logs/today.log", "logs/today.log");
await client.download("/maps/de_dust2.bsp", "maps/de_dust2.bsp");
const entries = await client.list("/configs");
await client.close();
```

SFTP takes a password or an RSA key, and can check the host's key. Keep the password in a config, not in the code.

#### Bots

A fake client is a player like any other: it is in `server.players`, it joins a team, it can be kicked. It has no AI of its own; `move` drives it, one frame at a time.

```ts
const bot = server.addBot("Spectator");   // Player | null when the server is full
bot?.joinTeam("SPECTATOR");

const runner = server.addBot("Runner");
server.addEventListener("frame", () => runner?.move({ forward: 250, buttons: ["jump"], angles: [0, 90, 0] }));
```

The natives with a `...` tail - `engfunc`, `dllfunc`, `pev`, `ExecuteHam` and the rest - take text, floats and vectors as well as numbers, and what a native writes back is read through `Ref`:

```ts
const id = engfunc(EngFunc_CreateFakeClient, "Dummy");
const reason = new Ref("");
dllfunc(DLLFunc_ClientConnect, id, "Dummy", "127.0.0.1", reason);
```

#### Game messages by name

A message the game sends a player is heard by its name, in the player's words, with typed fields:

```ts
server.addMessageListener("death", (event) => {
	if (event.headshot) print(0, `${event.killer?.name} - headshot - ${event.victim?.name}`);
});

server.addMessageListener("progressBar", (event) => {
	console.log(`a bar for ${event.seconds} s, from ${event.startPercent}%`);
});
```

Every message has a description, with the game's own name (`DeathMsg`, `BarTime`) beside it, so a Pawn author finds it. Where the game sends one thing in several messages, one name hears them all: `progressBar` (from zero or from a percent), `spectatedHealth` (the health of the player a spectator watches), `hint` (the hint box, with or without texts put into it). `player.screen.progressBar(5, { startPercent: 40 })` shows one.

#### Errors that point at your code

When a call fails - a `null` read with `!`, an error nobody catches, a stack overflow - the console prints the TypeScript stack, file, line and column, with the source line itself:

```
[amxts] shop.aot: TypeError: Unexpected 'null'
    at price (plugins/shop/shop.ts:26:9)
      26 |   return item!.price;
    at onSelect (plugins/shop/shop.ts:30:15)
```

`console.error(error)` and `error.stack` give the same stack. The map from the plugin's code to its TypeScript travels inside each `.aot`; the source line appears where the `.ts` is next to the plugin, as in `amxts dev`.

#### Names in the player's words

The API speaks the way players and plugin authors do, not the way the game's source does:

| 0.1.0 | 0.2.0 |
| --- | --- |
| `Player.all()` | `server.players` |
| `player.account` | `player.money` |
| `restartRound`, `onRoundFreezeEnd` | `newRound`, `roundStart` |
| `flPlayerFallDamage`, `fPlayerCanTakeDamage` | `fallDamage`, `canTakeDamage` |
| `fireBullets3` | `shoot` |
| `game.c4Guy`, `game.numCtWins` | `game.bomber`, `game.ctWins` |
| `server.addEventListener("message:DeathMsg", ...)` | `server.addMessageListener("death", ...)` |
| `buttons: ["Jump"]`, access `"Kick"` | `buttons: ["jump"]`, access `"kick"` |

Game messages have named, typed fields too: `event.killer`, `event.victim`, `event.headshot` on `DeathMsg`. Fields that mean nothing to a plugin - the AI members of a player, Condition Zero's career - are left to `@amxts/core/natives`.

`amxts upgrade` rewrites a 0.1.0 project: imports, command handlers, `Player.all` and every renamed field and event. What it cannot be sure of, it lists.

### ⚠️ Breaking changes

- `Player.all(filter)` is `server.players`; filter it with `.filter(...)`.
- Renamed fields and events: `player.account` is `player.money`; `restartRound`, `onRoundFreezeEnd` and `addAccount` are `newRound`, `roundStart` and `addMoney`; `fireBullets3` is `shoot`; about a hundred more follow the same rule (the full list is in `amxts upgrade`'s output). Internal fields left the API and are reached through `@amxts/core/natives`.
- A command's handler takes one object: `({ player }) => ...`, not `(player, args) => ...`.
- `@amxts/core/http` is gone: `fetch` and `useFetch` are globals. easy_http is no longer needed on the server.
- The core's API is imported by its package name (`@amxts/core/natives`, `/fs`, ...); `~/` is the project's own files only.
- Game messages are heard with `server.addMessageListener(name, ...)`, by their new names; the `message:` prefix of `addEventListener` is gone.
- The names of every flag set are lowerCamelCase: `"jump"`, `"muzzleFlash"`, `"kick"`.
- `@amxts/menu-core`'s code API takes one options object and one context: `addItem({ title, onSelect: ({ player }) => ... })`.
- The module and `amxts-compile` must come from the same release: the module refuses a compiler of another build.
- A plugin's id is `steamId`, not `authid`; server events are named as authors say them: `putInServer`, `configsExecuted`, `pluginsLoaded`, `changeLevel`.
- A plugin built by 0.1.0 is not loaded: the console names it and says to build it again.

### ⬆️ Upgrade guide

From 0.1.0, update the command first, with the package manager the project uses: `npm install @amxts/cli@latest`, `bun add @amxts/cli@latest`, `pnpm add @amxts/cli@latest` or `yarn add @amxts/cli@latest`. Then run `npx amxts upgrade` in the project: it updates the packages, rewrites the code, builds, and updates the server named in `.env`.

### 🧭 Known issues

- On plain HLDS, rounds, purchases, money and the bomb are heard after the fact; `preventDefault()` on them says once that it cannot stop them. ReGameDLL's own functions are not heard at all.
- A stack shows the source line only where the plugin's `.ts` is next to it; in a full build, small functions are inlined and a frame may show its caller's name.
- SFTP keys are RSA in PEM; Ed25519 and ECDSA keys are not read.

### 🚀 Enhancements

- One module to install: the host plugin comes inside `amxts_amxx`
- Plain HLDS: fields read in memory, a player's events through Ham Sandwich, rounds, spawns, purchases, money and the bomb through the game's own logs and messages
- `target: "hlds"` stops a build that listens for what plain HLDS cannot hear
- **commands:** Typed arguments, and `server.commands` for a `/help`
- **menus:** `Menu` over AMX Mod X's menus
- **fetch:** `fetch` and `useFetch` as globals, over libcurl and mbedTLS inside the module
- **kit:** `request` over HTTP, FTP, FTPS and SFTP, for modules
- **modules:** Library packages, compiled into each plugin that imports them
- `@amxts/ftp` among the official modules
- **messages:** Every known game message's arguments typed and named
- **events:** Enum arguments of game events as names; a game event's vector arguments writable
- **players:** `server.players` replaces `Player.all`
- **api:** Fields and events in the player's words; internal ones left to `@amxts/core/natives`
- **runtime:** A failed call prints the TypeScript stack, from a map carried in each plugin
- **module:** A reload removes the old plugin's timers and hooks
- **module:** A compiler of another build is refused, with one clear line
- **module:** A plugin built for another amxts is refused, not run
- **players:** `server.addBot` and `bot.move`; a fake client joins the spectators on both servers
- **natives:** A native's `...` tail takes text, floats, vectors and players; `Ref` reads what it writes back
- **messages:** `server.addMessageListener` by the player's names, with a description for each
- **entities:** A field the HUD shows is sent to the player when written
- **build:** `AMXTS_SERVER` may name the server's root or its `cstrike` folder
- **server:** `amxts_load`, `amxts_unload` and `amxts_reload <plugin>` for one plugin; `amxts_plugins` shows each one's state
- **dev:** Saving a plugin reloads only the plugins that changed, and a menu it made stays open through the reload
- **natives:** Reunion, VTC, ReChecker and GeoIP natives; `player.authType`, `protocol` and `authKey` from Reunion
- **modules:** A shared module hears when a plugin that uses it stops (`onPluginStop`), and drops what it gave
- **menu-core:** The code API in the same shape as `Menu`
- The core's API by its package name: `@amxts/core/natives`, `/constants`, `/fs`, `/os`, `/kit`, `/check`
- **upgrade:** `amxts upgrade` rewrites imports, command handlers, `Player.all` and every renamed field and event
- **docker:** The server image is `ghcr.io/amxts/server`

### 🔥 Performance

- **build:** Modules from npm come with their analysis, not compiled again
- **build:** Plugins compile in parallel
- **build:** Each file is read once per build

### 🩹 Fixes

- **module:** The API files are written only when they changed ([#1](https://github.com/amxts/amxts/issues/1))
- **compiler:** `boolean | function` fields, `has ? get : fallback`, a caught error read off a return, `new Map(entries)` and `new Set(values)`, narrowing on assignment
- **commands:** Typed arguments go where their interface does
- **editor:** `Date.UTC` with fewer arguments
- **host:** A missing native answers 0 and says so once
- **events:** Removing the last listener switches its hook off
- **runtime:** A function a plugin hands a module at its top level is called back, and a reloaded plugin's old functions are never called
- **runtime:** A plugin loaded while another one runs no longer stalls that one's `await`, and a reload of all loads each plugin once

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))
