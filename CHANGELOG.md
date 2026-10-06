# Changelog

## v0.2.4

[compare changes](https://github.com/amxts/amxts/compare/v0.2.3...v0.2.4)

### Summary

A fix for a project that began on an amxts whose API lived in the plugins folder: its `plugins/` still held that API's files (`constants.ts`, `facade.ts` and the rest), and the build took each for a plugin, so `npx amxts upgrade` ended with `constants does not compile`. The upgrade removes those copies and names them; the build leaves them out with a warning. An author's own file of such a name is kept.

### ⬆️ Upgrade guide

`npx amxts upgrade` in the project, with the server stopped: it moves `@amxts/core` to 0.2.4, removes the old API copies from `plugins/`, builds the plugins again and puts the 0.2.4 module on the server named in `.env`. A server installed by hand takes the module (and `amxts-compile`, where it has one) from this release, and its plugins are built again.

### 🩹 Fixes

- **build:** Old copies of amxts's API are not plugins - the build leaves them out of `plugins/` and says to delete them ([22303d7](https://github.com/amxts/amxts/commit/22303d7))
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
