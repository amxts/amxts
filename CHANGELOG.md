# Changelog

## v0.3.3

> v0.3.3 is a patch release of the 0.3 line. Plugins built with 0.3.0, 0.3.1 and 0.3.2 load on its module as they are; the new events need the 0.3.3 module, which `npx amxts upgrade` puts on your server.

### 📣 Some news

#### 👁️ What each player is sent

Since 0.3, `entityState` changes what one player sees of an entity. 👉 **0.3.3 opens the rest of what the server sends a player each frame**: what his own client is told about him (`clientData`), where the server looks from to pick what he is sent (`visibility`), and the move command his client sent (`cmdStart`). Each is written for one player alone, and a server with no listener pays nothing for it.

```ts
game.addEventListener("clientData", (event) => {
	if (event.player.flags.includes("onGround")) return;
	event.maxSpeed = 200;                    // his client predicts him slower in the air
});

const replays = new Map<number, number[]>();  // where the replay each player watches is, by id

game.addEventListener("visibility", (event) => {
	const point = replays.get(event.player.id);
	if (point != null) event.addOrigin(point);   // he is sent the walls and doors around it too
});
```

A plugin that shows a player a place his own eyes are far from - a replay, a rewind, a camera - can now send him that place, and freeze or slow what he sees there without touching anyone else.

#### 🧯 An error is never silent

A `throw` in a listener that your own code reached - a command run with `server_exec`, a forward emitted, a player kicked - from inside a `try` or an `async` function ended that listener without a word, and landed in your code instead: a `catch` got it, an `await` rejected with it, and the rest of the function never ran. 👉 **In 0.3.3 a listener is a call of its own wherever it starts from**, as a listener of `dispatchEvent` is in JavaScript: its error ends that listener alone, the console names it, and your code goes on.

And every error a plugin hits now goes to AMX Mod X's log too (`addons/amxmodx/logs`), not only to the server console: a host's panel often keeps no console, and the log is what you send us when something breaks.

#### 🚶 Players walk through each other, with nothing else on the server

Semiclip needed a module of its own beside AMX Mod X, ReSemiclip, and the official `resemiclip` module only passed it bit masks. 👉 **In 0.3.3 the core does it itself**: two players you pair walk through each other, their clients predict it without a jolt, and one who comes close can turn see-through or vanish from your view. It all runs in the module, with no call into your plugin per pair, and a server with no pair pays nothing.

```ts
game.addEventListener("spawn", ({ player }) => {
	for (const mate of server.players) if (mate.team == player.team) player.walksThrough.add(mate);
}, true);

server.walkThroughLook.fadeDistance = 250;   // closer than this a partner is see-through...
server.walkThroughLook.opacity = 0.4;        // ...this opaque right next to you
server.walkThroughLook.hideDistance = 48;    // and closer than this, not drawn at all
```

A partner's grenade passes through you too, and on ReGameDLL he does not shield you from a flash. The official `resemiclip` module moves onto it in its next release, and then needs nothing but amxts.

### 👀 Highlights

#### 🔪 A weapon's look in his hands

One view model can hold several looks of a weapon as body groups - a knife with several finishes. `weapon.viewBody` picks the one his hands show, and a spectator watching him through his eyes sees the same:

```ts
game.addEventListener("defaultDeploy", (event) => {
	if (event.weapon.classname != "weapon_knife") return;
	event.viewModel = "models/myplugin/v_knife.mdl";
	event.weapon.viewBody = 2;               // the third finish of the model
});
```

#### 🎞️ An entity's animation, for one player

`entityState` has the model's animation: `sequence`, `gaitSequence`, `frame`, `frameRate`, `animTime` and `ducking`. A `frameRate` of `0` holds a model in one pose for one player while the others see it move.

#### 🕹️ The move command

A `cmdStart` listener reads and writes the command the game moves a player by: `forward`, `side`, `up`, `msec`, `buttons`, `angles` and `impulse`, with the names `bot.move` takes.

```ts
server.addEventListener("cmdStart", (event) => {
	// A side speed the strafe keys did not give is taken away.
	if (event.side != 0 && !event.buttons.includes("moveLeft") && !event.buttons.includes("moveRight")) event.side = 0;
});
```

The fake server runs it too: `server.runCommand(player, command)`, and `server.sendVisibility(player)` for the `visibility` listeners.

#### ✉️ A message of your own

A plugin can now send its own message - to a client-side mod of yours, say - by name, as the game sends its own:

```ts
const jump = new UserMessage("MyJump");          // registered when the plugin starts

jump.byte(1).coord(distance).text(player.name).send(player);   // one player
jump.byte(2).sendAll();                                         // everyone
```

`get_user_msgid`, `message_begin` and `register_message` know it, in Pawn plugins too, and it keeps its id on every map.

#### 🎨 Sprays, sparks and other temporary effects

The game's temporary effects - a spray on a wall, sparks, a beam - are the `tempEntity` message: `type` is the effect's `TE_*` number and `source` what made it, the spray can (whose `owner` is the player) or the player whose move made it. And any message can now go to some players only, with `recipients`:

```ts
server.addMessageListener("tempEntity", (event) => {
	const maker = event.source?.owner ?? 0;   // a spray can's player
	if (hidden.has(maker)) event.recipients = server.players.filter(player => !hidesOthers.has(player.id));
});
```

#### ⚡ Faster builds, and Node is all you need

A plugin that awaits is no longer compiled twice, the compiles run side by side as far as the machine's memory allows, and every task of the `amxts` command - `build`, `dev`, `prepare`, `check`, `upgrade` - runs on Node, in far less memory. A save in `amxts dev` rebuilds a large plugin several times faster than in 0.3.2. A project no longer installs Bun: Node 24 is all it needs. `amxts build` writes the same files byte for byte.

#### 🔁 An upload restarts only its plugin

Uploading a plugin's `.aot` to a running server restarts that plugin and the plugins that use its module - not every plugin - and the files are read and prepared while the game runs, so the players do not feel it. A plugin can carry what it holds across that restart:

```ts
let run = server.kept<Uint8Array>("run") ?? new Uint8Array(0);   // what the previous run kept
server.addEventListener("end", () => server.keep("run", run));
```

#### 📋 plugins.ini on a live server

A line added to `plugins.ini` loads its plugin, and a line taken out unloads it, with no restart and no command - a server without rcon included. A shared module's plugin loads before the plugins that use it wherever its line is, so a module listed last no longer loses every call its users make as they start ([b32d173](https://github.com/amxts/amxts/commit/b32d173)). And a dictionary uploaded after its plugin is read again as soon as it lands, not at the next map ([8ea5dde](https://github.com/amxts/amxts/commit/8ea5dde)).

#### 🩺 A server that tells you what holds it

- A listener, timer or command that holds the frame longer than `amxts_slow_ms` (5 ms unless you set it) is named in the console and in AMX Mod X's log, with its plugin and its time - and so is a plugin's async work after an `await`, and an upload's restart of plugins, split into its parts. When several listeners of one event held the frame together, the line says so and names the slowest of them in that very call, with its own time: by the function's name (`trackRuns (3 of 10), 3.1 ms`), or for an arrow by where it starts (`a function at plugins/replay.ts:987 (5 of 10)`). The line comes at once, then while it goes on after 10 s, 20 s, 40 s and so on up to 10 minutes, so a plugin a little over the limit does not fill the log. It prints the server's own `amxts_slow_ms`.
- `server.precached` counts the models, sounds and files the map has precached, and the log warns as they near the engine's 512 - naming the last file and the plugin.
- When a plugin's temporary effects fill a player's packet, the log says so, instead of the player silently seeing none of them.

#### 🗄️ A query's rows, several times faster

`JSON.parse` reads its text straight into the type you asked for, with no tree in between, and so a database query's rows - which reach a plugin as JSON - and `fetch`'s answers come several times faster, with far less for the garbage collector. A plugin that reads thousands of rows no longer holds the frame for them. A text that does not fit the type is read the old way, so its error says the same as before.

#### 🛠️ And more

- `concat` takes any number of arguments, as in TypeScript: `a.concat(1, [2, 3], b)`, `s.concat("x", "y")`;
- `entity.lip`, how far short of its full travel a door, a platform or a button stops;
- the Storage page says how to add a field to a stored type without breaking the records already saved: declare it optional and read it with a default;
- a call to a shared module no plugin runs is said in AMX Mod X's log too, once for each module in each load of the plugin ([24d0311](https://github.com/amxts/amxts/commit/24d0311));
- `amxts build --against amxts_amxx_i386.so` says whether a server's module loads the built plugins, and what it lacks, before an upload; a build names the imports a plugin uses that the last release has not, and the module says "needs a newer amxts than 0.3.2" for one built with an unreleased core.

### 🩹 Important fixes

- A ReHLDS server stopped by its panel, `docker stop` or systemd crashed on the way out and left a core file, and Storage's last second was lost: the module's threads now stop cleanly at exit, the stores are written, and ReHLDS's own stop signal handler - installed broken by `hlds_linux` - is set again correctly ([d5d0cfc](https://github.com/amxts/amxts/commit/d5d0cfc), [9ad9590](https://github.com/amxts/amxts/commit/9ad9590)).
- An error between `message_begin` and `message_end` left the message open, and the next message - the game's own - could break the server. The message is now ended or dropped and the plugin named ([b082b16](https://github.com/amxts/amxts/commit/b082b16)).
- A chat line longer than the engine's message - a translation in Georgian, a long name - stopped the server; it is now cut to fit ([ed37111](https://github.com/amxts/amxts/commit/ed37111)).
- A stored record kept before a field was added lost the class's defaults when the class's constructor takes arguments - a text field came back `null`. Now the default stays, and a record that still cannot be read names the storage, the key and the field ([d7e359e](https://github.com/amxts/amxts/commit/d7e359e)).
- On Node, `amxts dev` did not see a change to `amxts.config.ts`, `amxts prepare` on Windows wrote no tooltips in another language, and a plugin's test of an HTTPS server with its own certificate failed ([0035d85](https://github.com/amxts/amxts/commit/0035d85), [8dc1435](https://github.com/amxts/amxts/commit/8dc1435), [207f581](https://github.com/amxts/amxts/commit/207f581)).
- A loop that keeps the index of its best element - the nearest, the smallest, the largest - returned `0` whatever it found, when the comparison was of fractional numbers and the best value was kept in a variable of the loop. A silent wrong answer since 0.3.0 ([259cbbb](https://github.com/amxts/amxts/commit/259cbbb)).
- A listener's error entered from a `try` or an `async` function was swallowed and cut its caller short ([3b233b4](https://github.com/amxts/amxts/commit/3b233b4)).
- A plugin's error was printed to the server console only ([e386030](https://github.com/amxts/amxts/commit/e386030)).
- A plugin whose memory could not grow - on a 32-bit server past about 1 GiB - kept being called with its allocator broken, and flooded the console and the log until the map changed. Now it stops at the next frame with one line that says why and how big its memory is, `amxts_plugins` lists it as `stopped` and shows each running plugin's memory, and `amxts_reload` starts it again ([d68278e](https://github.com/amxts/amxts/commit/d68278e)).
- A SteamID typed into a console command - `amx_ban STEAM_0:1:123` - reached the command in five words, since the engine splits at `:`; a command's words now keep it whole, `,`, `'` and brackets too ([97ac57a](https://github.com/amxts/amxts/commit/97ac57a)).
- A `write_*` after a `message_begin` that failed - an id the game does not know, a player who is not there - reached the engine with no message open, and the server stopped. Now the writes and the end are dropped, the begin's error is logged, and the server goes on ([8d4b091](https://github.com/amxts/amxts/commit/8d4b091)).
- On Windows with an `mp.dll` amxts does not know, `game.restartRound()` and the win check could call the wrong function and crash the server; they now answer `0` and say so once in the console ([d42365d](https://github.com/amxts/amxts/commit/d42365d)).
- `player.kill()` killed nothing on Valve's game when the player was a bot a plugin had added: the game's kill command turned him down. It now kills any living player on every server, and is recorded as the same suicide ([59e7249](https://github.com/amxts/amxts/commit/59e7249)).
- `entity.killed(world, 0)` - a death no damage led to - crashed a server running Valve's game ([261f1dd](https://github.com/amxts/amxts/commit/261f1dd)).
- A plugin's test that set a pair of players walking through each other threw "unsimulated": the fake server answers it now ([1a61470](https://github.com/amxts/amxts/commit/1a61470)).

### ✅ Upgrading

Update the command with your project's package manager, then upgrade:

```sh
npm install -D @amxts/cli@latest   # pnpm add -D, yarn add -D, bun add -d
npx amxts upgrade
```

It moves `@amxts/core` to 0.3.3, builds, and puts the 0.3.3 module on the server in `AMXTS_SERVER`. Another server takes the module from the release and the `.aot` files from your build. Rebuild every plugin: a plugin built with 0.3.2 runs on the new module, but only a rebuilt one gets the fixes of the compiler and of listeners' errors.

The command and the core move together this time: every task of the command runs on Node now, and amxts 0.3.3 drives only a 0.3.3 core, as the 0.3.2 command drives only its own - each says which one to update when they differ. Update the command first, as above, and `upgrade` brings the core to it. A project needs Node 24 and no longer installs Bun.

> [!NOTE]
> A plugin that listens to `clientData`, `visibility`, reads `cmdStart`'s fields, makes a `UserMessage`, or uses `server.keep`, `server.kept`, `server.precached`, `player.walksThrough`, `server.walkThroughLook` or `entityState`'s `solid` does not load on an older module. Put the 0.3.3 module on the server with the plugin.

### 👉 Changelog

[compare changes](https://github.com/amxts/amxts/compare/v0.3.2...v0.3.3)

### 🚀 Enhancements

- **hooks:** `clientData` event and `weapon.viewBody` ([02e72d7](https://github.com/amxts/amxts/commit/02e72d7))
- **hooks:** `entityState` animation fields ([e8274b2](https://github.com/amxts/amxts/commit/e8274b2))
- **hooks:** `clientData` view fields ([8d745f9](https://github.com/amxts/amxts/commit/8d745f9))
- **events:** `cmdStart` reads the move command ([212b4bb](https://github.com/amxts/amxts/commit/212b4bb))
- **events:** Visibility moves where a player sees from ([f68f4e3](https://github.com/amxts/amxts/commit/f68f4e3))
- **events:** Visibility adds points a player sees from ([15d592f](https://github.com/amxts/amxts/commit/15d592f))
- **messages:** UserMessage, a plugin's own message ([3966558](https://github.com/amxts/amxts/commit/3966558))
- **server:** A plugin's state across its reload ([0269c89](https://github.com/amxts/amxts/commit/0269c89))
- **module:** Name a listener that holds the frame ([37dbb6b](https://github.com/amxts/amxts/commit/37dbb6b))
- **server:** `server.precached` and a warning near the precache room ([1cc0911](https://github.com/amxts/amxts/commit/1cc0911))
- **module:** Say when a plugin's effects fill a player's packet ([28f31e6](https://github.com/amxts/amxts/commit/28f31e6))
- **entities:** `entity.lip`, how far a door stops short ([4b4cd68](https://github.com/amxts/amxts/commit/4b4cd68))
- **messages:** `tempEntity`, and recipients on any message ([7c268db](https://github.com/amxts/amxts/commit/7c268db))
- **build:** Check plugins against a server's module ([33b37d9](https://github.com/amxts/amxts/commit/33b37d9))
- **module:** `plugins.ini` order and changes on a live server ([b32d173](https://github.com/amxts/amxts/commit/b32d173))
- **lang:** A dictionary is read again when it changes ([8ea5dde](https://github.com/amxts/amxts/commit/8ea5dde))
- **module:** Name the slow listener, repeat the line less often ([40a0354](https://github.com/amxts/amxts/commit/40a0354))
- **api:** Players walk through each other ([55c0183](https://github.com/amxts/amxts/commit/55c0183))

### 🩹 Fixes

- **compiler:** Concat takes any number of arguments ([8ad933a](https://github.com/amxts/amxts/commit/8ad933a))
- **hooks:** Windows calls game rules only on a known `mp.dll` ([d42365d](https://github.com/amxts/amxts/commit/d42365d))
- **hooks:** `viewBody` keeps the client's animation in step ([42e5d2e](https://github.com/amxts/amxts/commit/42e5d2e))
- **hooks:** A `viewBody` deploy's draw only in hand ([d55b196](https://github.com/amxts/amxts/commit/d55b196))
- **hooks:** `viewBody` for in-eye spectators ([572c09f](https://github.com/amxts/amxts/commit/572c09f))
- **hooks:** `viewBody` 0 holds the weapon ([a97d3a4](https://github.com/amxts/amxts/commit/a97d3a4))
- **hooks:** Keep `viewBody` when an in-eye spectator spawns ([3d4ecbb](https://github.com/amxts/amxts/commit/3d4ecbb))
- **events:** No usercmd import in plugins that only wait ([fb4a6a9](https://github.com/amxts/amxts/commit/fb4a6a9))
- **compiler:** Read a kept whole number from its i32 local ([259cbbb](https://github.com/amxts/amxts/commit/259cbbb))
- **events:** A listener's error ends that listener alone ([3b233b4](https://github.com/amxts/amxts/commit/3b233b4))
- **module:** A plugin's failure in AMX Mod X's log too ([e386030](https://github.com/amxts/amxts/commit/e386030))
- **module:** A failed `message_begin` cannot stop the server ([8d4b091](https://github.com/amxts/amxts/commit/8d4b091))
- **module:** A chat line fits the engine's message ([ed37111](https://github.com/amxts/amxts/commit/ed37111))
- **package:** Carry the Node hook of the compile workers ([b861dd5](https://github.com/amxts/amxts/commit/b861dd5))
- **upgrade:** The same order of changes on every system ([acc783e](https://github.com/amxts/amxts/commit/acc783e))
- **module:** The slow-listener clock without the x87 ([4902bf6](https://github.com/amxts/amxts/commit/4902bf6))
- **testing:** Fetch trusts a test's own CA on Node ([207f581](https://github.com/amxts/amxts/commit/207f581))
- **prepare:** Tooltips in another language on Node on Windows ([8dc1435](https://github.com/amxts/amxts/commit/8dc1435))
- **config:** A changed `amxts.config.ts` read again on Node ([0035d85](https://github.com/amxts/amxts/commit/0035d85))
- **storage:** A record kept before a field was added reads ([d7e359e](https://github.com/amxts/amxts/commit/d7e359e))
- **test-server:** A core dump left at the stop is reported ([d4af6e7](https://github.com/amxts/amxts/commit/d4af6e7))
- **module:** A server stopped by SIGTERM exits without a core dump ([d5d0cfc](https://github.com/amxts/amxts/commit/d5d0cfc))
- **module:** Storage's last write at exit asks AMX Mod X nothing ([0c88562](https://github.com/amxts/amxts/commit/0c88562))
- **module:** A ReHLDS server's stop returns from its handler ([9ad9590](https://github.com/amxts/amxts/commit/9ad9590))
- **module:** `SA_RESTORER` for the Linux build ([d051a07](https://github.com/amxts/amxts/commit/d051a07))
- **module:** A message a call leaves open is ended for it ([b082b16](https://github.com/amxts/amxts/commit/b082b16))
- **module:** `amxts_slow_ms` covers async work and reloads ([ff30a71](https://github.com/amxts/amxts/commit/ff30a71))
- **messages:** Recipients start empty; spray test on plain HLDS ([06928d3](https://github.com/amxts/amxts/commit/06928d3))
- **commands:** A SteamID comes whole in a command's words ([97ac57a](https://github.com/amxts/amxts/commit/97ac57a))
- **module:** A plugin out of memory stops ([d68278e](https://github.com/amxts/amxts/commit/d68278e))
- **modules:** A module with no owner is logged once a load ([24d0311](https://github.com/amxts/amxts/commit/24d0311))
- **module:** Name the slow listener the author wrote ([6de6665](https://github.com/amxts/amxts/commit/6de6665))
- **module:** Name the slowest of the call the line says ([7d8e869](https://github.com/amxts/amxts/commit/7d8e869))
- **module:** Name the slowest again after a reload ([363cc16](https://github.com/amxts/amxts/commit/363cc16))
- **testing:** Simulate players walking through each other ([1a61470](https://github.com/amxts/amxts/commit/1a61470))
- **players:** Kill() kills a bot on any server ([59e7249](https://github.com/amxts/amxts/commit/59e7249))
- **module:** Killed() by the world on Valve's game ([261f1dd](https://github.com/amxts/amxts/commit/261f1dd))

### 🔥 Performance

- **build:** Stop asc early for a plugin that awaits ([45cee0d](https://github.com/amxts/amxts/commit/45cee0d))
- **build:** Compile with half the free memory ([7703592](https://github.com/amxts/amxts/commit/7703592))
- **build:** Compile under Node when it is installed ([1d5a557](https://github.com/amxts/amxts/commit/1d5a557))
- **build:** Build and dev run on Node ([8937b94](https://github.com/amxts/amxts/commit/8937b94))
- **module:** An upload reloads only its plugin ([7cd7abe](https://github.com/amxts/amxts/commit/7cd7abe))
- **build:** A dev rebuild of a large plugin without -O3 ([7adde0e](https://github.com/amxts/amxts/commit/7adde0e))
- **cli:** Every task on Node, and no Bun in a project ([f08a123](https://github.com/amxts/amxts/commit/f08a123))
- **build:** A dev save starts at the plugin's last wamrc level ([b4acda0](https://github.com/amxts/amxts/commit/b4acda0))
- **module:** A module owner's upload preloads its users ([0c72980](https://github.com/amxts/amxts/commit/0c72980))
- **json:** Read `JSON.parse` text straight into T ([bd769dc](https://github.com/amxts/amxts/commit/bd769dc))

### 📖 Documentation

- **storage:** A field added later is optional ([5cdf18a](https://github.com/amxts/amxts/commit/5cdf18a))
- The core's tests run with npm test, on Vitest ([02af320](https://github.com/amxts/amxts/commit/02af320))
- The core is built and tested with npm run ([58a1fa2](https://github.com/amxts/amxts/commit/58a1fa2))
- **time:** Which clock each event sees ([2bb61fb](https://github.com/amxts/amxts/commit/2bb61fb))
- **install:** A module owner's users are prepared off the frame too ([1d100ab](https://github.com/amxts/amxts/commit/1d100ab))
- A plugin out of memory, a command's words ([4f59687](https://github.com/amxts/amxts/commit/4f59687))
- `plugins.ini` order and watch, dictionaries read again ([c9d7b1f](https://github.com/amxts/amxts/commit/c9d7b1f))
- **players:** Dead players pass only while a pair is set ([1203a8b](https://github.com/amxts/amxts/commit/1203a8b))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.3.2

> v0.3.2 is a patch release of the 0.3 line. Plugins built with 0.3.0 and 0.3.1 load on its module as they are; the new things need the 0.3.2 module, which `npx amxts upgrade` puts on your server.

### 📣 Some news

#### 🔌 Forwards of C++ modules reach TypeScript

A forward a Pawn plugin raises has reached `Forward.subscribe` since 0.3. A forward an AMX Mod X module written in C++ raises (`MF_ExecuteForward`) reached only the Pawn plugins. 👉 **In 0.3.2 it reaches TypeScript too**, after the Pawn plugins' handlers, with every kind of argument: numbers, floats, strings, arrays and by-reference values.

```ts
const jumped = new Forward<Player, number>("mymodule_on_jump");

jumped.subscribe((player, height) => {
	console.log(`${player.name} jumped ${height} units`);
});
```

A module hands its forwards to amxts when AMX Mod X loads it after amxts, so `amxts_amxx` goes on the first line of `modules.ini`. `npx amxts upgrade` puts it there, and the server console names any module listed above it.

A Pawn forward made with `ET_STOP` or `ET_STOP2` that a Pawn public stopped no longer reaches TypeScript subscribers, as AMX Mod X itself would do for one more plugin.

#### 🎯 Valve's HLDS hears the game first

Without ReGameDLL, most of the game rules' events were heard only after the game had acted, and their questions (`fallDamage`, `canHaveItem`, `canRespawn`, ...) were not heard at all. 👉 **In 0.3.2 they are heard the way ReGameDLL hears them**: before the game acts, with answers, written fields and `preventDefault()` taken.

```ts
game.addEventListener("fallDamage", (event) => event.result / 2, true);   // half the fall damage

game.addEventListener("addMoney", (event) => {
	if (event.player.isBot) event.amount = 0;
});
```

That is 21 events - the questions, `playerSpawn`, `playerKilled`, `newRound`, `deathNotice`, `gameThink` and the rest - plus `addMoney` and `giveDefaultItems`. On Linux it works with any build of the game. On Windows it works with the builds of Valve's game amxts knows: the one steam installs and its `steam_legacy` branch. With another `mp.dll` the console says so once and the events are heard as before. The table on the hooks page shows what each event gives on such a server.

### 👀 Highlights

#### 🔢 A byte is a number

An element of a `Uint8Array` (and of `Int8Array`, `Uint16Array`, `Int16Array`, `Uint8ClampedArray`) is a `number`, as in JavaScript. Arithmetic on it no longer wraps at 8 bits, so reading a file's words gives what JavaScript gives:

```ts
const word = bytes[i] | (bytes[i + 1] << 8);   // a little-endian word
```

Loops over bytes keep their integer code, and are faster than the same loop in Pawn.

#### ➕ `push` and `unshift` take any number of values

```ts
names.push("a", "b", "c");
names.push(...others);
```

#### 🛠️ And more

- `entity.touch()` and the entity actions (`restart()`, `think()`, ...) cost less, and are faster than Pawn's `ExecuteHamB` on every machine the speed suite runs on;
- the compiler keeps fewer values on its stack for the garbage collector, which makes the facade's calls cheaper everywhere.

### 🩹 Important fixes

- `ExecuteHam(Ham_DeathSound, ...)` and any other Ham function Counter-Strike has not got crashed the server; such a call now answers 0 and says so once in the console ([959bcf0](https://github.com/amxts/amxts/commit/959bcf0)).
- `bytes[i] << 8` was cut back to 8 bits, so decoding a word from a file's bytes gave garbage ([21610b6](https://github.com/amxts/amxts/commit/21610b6)).
- A generic call to an arrow declared further down the file did not build ("Type argument expected") ([7da3818](https://github.com/amxts/amxts/commit/7da3818)).
- A stopped Pawn forward reached TypeScript subscribers ([e0dd372](https://github.com/amxts/amxts/commit/e0dd372)).
- `@amxts/core/zlib` and the query builder had no types on the site, and its examples did not type-check ([a907e84](https://github.com/amxts/amxts/commit/a907e84), [58883e0](https://github.com/amxts/amxts/commit/58883e0)).

### ⚠️ Breaking changes

One, listed by `npx amxts upgrade`:

| 0.3.1 | 0.3.2 | upgrade |
| --- | --- | --- |
| a `use` event's `event.caller` was the one who used the entity, `event.activator` what passed the use on | named as the game passes them: `event.activator` uses the entity, `event.caller` passes the use on | lists each `caller` and `activator` of a use event |

`entity.use()` calls do the same as before; only its parameters' names changed.

### ✅ Upgrading

Update the command with your project's package manager, then upgrade:

```sh
npm install -D @amxts/cli@latest   # pnpm add -D, yarn add -D, bun add -d
npx amxts upgrade
```

It moves `@amxts/core` to 0.3.2, lists the use events to check, puts `amxts_amxx` on the first line of `modules.ini`, builds, and puts the 0.3.2 module on the server in `AMXTS_SERVER`. Another server takes the module from the release and the `.aot` files from your build.

### 👉 Changelog

[compare changes](https://github.com/amxts/amxts/compare/v0.3.1...v0.3.2)

### 🚀 Enhancements

- **hooks:** Game rules' questions on plain HLDS for Linux ([55a14a1](https://github.com/amxts/amxts/commit/55a14a1))
- **forwards:** A module's forward reaches `Forward.subscribe` ([b036bc6](https://github.com/amxts/amxts/commit/b036bc6))
- **hooks:** Plain HLDS hears game rules' events first ([20b51c5](https://github.com/amxts/amxts/commit/20b51c5))

### 🩹 Fixes

- **site:** The hood's files from the build's own list ([a907e84](https://github.com/amxts/amxts/commit/a907e84))
- **site:** The editor's own `.types.d.ts` files in the site's declarations ([58883e0](https://github.com/amxts/amxts/commit/58883e0))
- **hooks:** ⚠️  A use event's activator and caller the right way round ([535a989](https://github.com/amxts/amxts/commit/535a989))
- **forwards:** A stopped Pawn forward skips TypeScript ([e0dd372](https://github.com/amxts/amxts/commit/e0dd372))
- **compiler:** A typed array's element is a number ([21610b6](https://github.com/amxts/amxts/commit/21610b6))
- **compiler:** An arrow declared below types a generic call ([7da3818](https://github.com/amxts/amxts/commit/7da3818))
- **forwards:** The sanitized module builds again ([db6b3d0](https://github.com/amxts/amxts/commit/db6b3d0))
- **hooks:** ExecuteHam of a function the game has not got ([959bcf0](https://github.com/amxts/amxts/commit/959bcf0))
- **hooks:** Game rules' questions hooked before the map's rules exist ([366bee1](https://github.com/amxts/amxts/commit/366bee1))
- **hooks:** `checkMapConditions` not hooked on plain HLDS ([a684626](https://github.com/amxts/amxts/commit/a684626))
- **hooks:** `original_hook`'s import passes the editor's check ([dffb78d](https://github.com/amxts/amxts/commit/dffb78d))
- **compiler:** Push and unshift take any number of values ([b11f2fe](https://github.com/amxts/amxts/commit/b11f2fe))

### 🔥 Performance

- **entities:** An action with hooks keeps no Call's frame ([2bbffd2](https://github.com/amxts/amxts/commit/2bbffd2))
- **compiler:** An argument keeps a slot only if held ([3661bd4](https://github.com/amxts/amxts/commit/3661bd4))
- **compiler:** Whole numbers bounded by i + c in i32 ([b712462](https://github.com/amxts/amxts/commit/b712462))
- **compiler:** An array's [] keeps no frame for its error ([ff9a2f7](https://github.com/amxts/amxts/commit/ff9a2f7))

#### ⚠️ Breaking Changes

- **hooks:** ⚠️  A use event's activator and caller the right way round ([535a989](https://github.com/amxts/amxts/commit/535a989))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

## v0.3.1

> v0.3.1 is a patch release of the 0.3 line. Plugins built with 0.3.0 load on its module as they are; the new things need the 0.3.1 module, which `npx amxts upgrade` puts on your server.

### 📣 Some news

#### 🗄️ A database, built in

A plugin that kept its records in `Storage` had them on one server only, and a plugin that wanted MySQL had to call a web service of its own in between. 👉 **In 0.3.1, MySQL is part of amxts.**

The module speaks MySQL itself - no client library to install, TLS included, MariaDB too - and every query runs on its own thread, so the server never waits for the database. Tables are described in TypeScript, the way Drizzle does it, and the rows come back typed:

```ts
import { asc, double, eq, int, table, varchar } from "@amxts/core/database";

export const records = table("records", {
	id: int().primaryKey().autoincrement(),
	steamId: varchar(32).notNull(),
	map: varchar(64).notNull(),
	time: double().notNull(),
});

const db = new Database(env("MYPLUGIN_DB"));   // mysql://user:password@host:3306/myplugin, or jdbc:mysql://... as a game panel shows it
await db.create(records);

const top = await db.select().from(records)
	.where(eq(records.map, server.map))
	.orderBy(asc(records.time))
	.limit(10);

await db.insert(records).values({ steamId: player.steamId, map: server.map, time })
	.onConflictDoUpdate({ target: [records.steamId, records.map], set: { time } });
```

A misspelt column is an error in the editor. Every value goes to the server as a parameter, never as text in the SQL. Transactions (`db.transaction(async (tx) => ...)`), raw SQL beside the builder (`db.query<Row>(sql, [values])`), and bytes - a recording, a file - in BLOB columns as `Uint8Array`. Another database plugs in as a provider of its own scheme, with `Database.register`.

#### ⚡ Nothing waits on the frame

Unpacking a downloaded map held the server's frame for as long as it took, and players saw it. `fs.extract` now unpacks on the module's worker thread, and so do writing and reading bytes, and the new compression:

```ts
import * as zlib from "@amxts/core/zlib";

for (const entry of await fs.extract(await response.arrayBuffer())) {
	fs.writeFileSync(entry.path, entry.data);
}

await fs.writeFile(`${server.dataDir}/myplugin/${name}.rec.gz`, await zlib.gzip(recording));
```

`@amxts/core/zlib` is Node's: `gzip`, `gunzip`, `deflate`, `inflate`, the raw forms, and a `...Sync` of each.

### 👀 Highlights

#### 🏃 A player's own movement

Air acceleration, friction, stop speed and the rest for one player - the server moves him with them and his game predicts them, on any server:

```ts
player.movement.airAccelerate = 100;   // strafes gain speed easily, for him alone
player.movement.friction = 2;
player.movement.reset();               // the server's again
```

#### 🧱 Fields of your own on entities

The way plugins add fields to a player, they add them to an `Entity` - shared between plugins, gone with the entity:

```ts
declare module "@amxts/core" {
	interface Entity {
		doorSpeed: number;
	}
}

door.doorSpeed = door.speed;
```

#### 🔊 Who hears what

A sound or a shot can go to some players only - a player who hid the others no longer hears their steps:

```ts
game.addEventListener("startSound", (event) => {
	event.recipients = server.players.filter(listener => !hidden(event.entity, listener));
});

door.emitSound("myplugin/creak.wav", { to: player });   // one player hears it
```

#### 📺 HUD lines that don't steal each other's channel

A client shows four HUD channels. A line with a higher `priority` keeps its channel, and a line whose time is up gives it back:

```ts
const speed = new HudLine({ priority: 1 });   // redrawn every frame, always on screen
```

#### 🛠️ And more

- `entity.touch(other)` and `entity.restart()`, done by the module;
- `player.resetMaxSpeed()`, `player.jumpSlowdown`, `server.intermission()`;
- `fs.existsSync(path, { game: true })` looks in every folder the game reads from;
- on plain HLDS, the `move` event and `touchCount`/`frameTime` are heard too;
- the language: `string | number | boolean | null` values, `number | null`, `T | T[]`, and a `Uint8Array` in JSON as base64.

Each of the new calls is checked against its Pawn way in the speed suite, and is faster.

### 🩹 Important fixes

- `Storage.get` lost the last character of a value of 1 KB or more - JSON came back without its closing brace ([2599130](https://github.com/amxts/amxts/commit/2599130)).
- A Pawn plugin's `amxclient_cmd` reaches TypeScript commands and the `"command"` event ([4e9118f](https://github.com/amxts/amxts/commit/4e9118f)).
- `Infinity | 0` and every number past 2^63 convert as JavaScript does ([1add817](https://github.com/amxts/amxts/commit/1add817)).
- A plugin may be named like a file of the core's API - `facade.ts`, `hooks.ts` ([501a354](https://github.com/amxts/amxts/commit/501a354)).
- The module shows its own version in `amxx modules` and `meta list` ([2889b27](https://github.com/amxts/amxts/commit/2889b27)).
- An arrow that returns an object literal gives the interface, so `rows.map((name) => ({ name, time }))` is a `Row[]` ([df82419](https://github.com/amxts/amxts/commit/df82419)).
- In tests, `setTimeout(fn, 0)` from a listener no longer loops `server.advance` ([f6db4d4](https://github.com/amxts/amxts/commit/f6db4d4)).
- A build stops, saying so, when the generated natives table is older than the core's code, instead of making a plugin every server refuses ([7f4c5af](https://github.com/amxts/amxts/commit/7f4c5af)).

### ⚠️ Breaking changes

Two, each listed or rewritten by `npx amxts upgrade`:

| 0.3.0 | 0.3.1 | upgrade |
| --- | --- | --- |
| `fs.extract(bytes)` gives the entries | a Promise: `await fs.extract(bytes)`; the synchronous form is `fs.extractSync(bytes)` | rewrites a call without `await` to `fs.extractSync`; lists a named import or a reference handed on |
| `startSound`'s `event.recipients` a number (`0`, `1`) | the players who hear it: `event.recipients = server.players.filter(...)` | lists each use |

A binary column read into a `string` field comes as base64 now, not as the bytes decoded as text; read it into a `Uint8Array`, or `CAST(col AS CHAR)` in the SQL.

### ✅ Upgrading

amxts needs Node.js 24 or newer now: Node 22's npm 10 fails installing a new project's test runner on Linux. The command says so when it runs on an older Node.

Update the command with your project's package manager, then upgrade:

```sh
npm install -D @amxts/cli@latest   # pnpm add -D, yarn add -D, bun add -d
npx amxts upgrade
```

It moves `@amxts/core` and `@amxts/menu-core` to 0.3.1, rewrites `fs.extract`, lists what to check by hand, builds, and puts the 0.3.1 module on the server in `AMXTS_SERVER`. Another server takes the module from the release and the `.aot` files from your build.

### 👉 Changelog

[compare changes](https://github.com/amxts/amxts/compare/v0.3.0...v0.3.1)

### 🚀 Enhancements

- **compiler:** A union of text, numbers and booleans ([9002ad0](https://github.com/amxts/amxts/commit/9002ad0))
- **database:** MySQL from a plugin ([952e2e9](https://github.com/amxts/amxts/commit/952e2e9))
- **compiler:** Number | null and one or a list ([21e7feb](https://github.com/amxts/amxts/commit/21e7feb))
- **compiler:** A generic's arguments from a subclass ([dda7bf9](https://github.com/amxts/amxts/commit/dda7bf9))
- **database:** A query builder on Database ([0c167ab](https://github.com/amxts/amxts/commit/0c167ab))
- **database:** An address as a game panel gives it, jdbc: ([86870b9](https://github.com/amxts/amxts/commit/86870b9))
- **zlib:** Node's zlib, off the frame on the module's worker ([f8aedcd](https://github.com/amxts/amxts/commit/f8aedcd))
- **fs:** ⚠️  Extract and bytes off the frame ([8969c38](https://github.com/amxts/amxts/commit/8969c38))
- **json:** A Uint8Array as base64 text ([177f545](https://github.com/amxts/amxts/commit/177f545))
- **database:** Bytes as Uint8Array ([dcb0310](https://github.com/amxts/amxts/commit/dcb0310))
- **fs:** `existsSync` in the game's other folders ([874c4e7](https://github.com/amxts/amxts/commit/874c4e7))
- **entities:** Touch, and actions run by the module ([5cc7dfb](https://github.com/amxts/amxts/commit/5cc7dfb))
- **players:** Own movement variables, `server.intermission` ([13ffbe4](https://github.com/amxts/amxts/commit/13ffbe4))
- **hooks:** The move event on plain HLDS ([eda7288](https://github.com/amxts/amxts/commit/eda7288))
- **sound:** ⚠️  Choose who hears a sound ([8adfbfa](https://github.com/amxts/amxts/commit/8adfbfa))
- **hud:** HudLine priority, and channels taken by ending ([ed6f0ed](https://github.com/amxts/amxts/commit/ed6f0ed))
- **entities:** Fields plugins add to Entity ([db61bed](https://github.com/amxts/amxts/commit/db61bed))

### 🩹 Fixes

- **storage:** A value of 1 KB or more read whole ([2599130](https://github.com/amxts/amxts/commit/2599130))
- **module:** Its version in amxx modules and meta list ([2889b27](https://github.com/amxts/amxts/commit/2889b27))
- **commands:** A Pawn plugin's `amxclient_cmd` reaches `addCommand` ([4e9118f](https://github.com/amxts/amxts/commit/4e9118f))
- **compiler:** ToInt32 of numbers past 2^63 and Infinity ([1add817](https://github.com/amxts/amxts/commit/1add817))
- **build:** A plugin may be named like a file of the core ([501a354](https://github.com/amxts/amxts/commit/501a354))
- **compiler:** An arrow's returned literal is its interface ([df82419](https://github.com/amxts/amxts/commit/df82419))
- **testing:** A timer armed while timers fire waits a frame ([f6db4d4](https://github.com/amxts/amxts/commit/f6db4d4))
- **database:** The builder's hood type-checks in the editor ([20eb9be](https://github.com/amxts/amxts/commit/20eb9be))
- **build:** A natives table older than the code stops the build ([7f4c5af](https://github.com/amxts/amxts/commit/7f4c5af))
- **build:** A version bump makes cached compiles again ([aa89604](https://github.com/amxts/amxts/commit/aa89604))
- **sound:** `emitSound`'s volume and attenuation as f32 bits ([d538c1e](https://github.com/amxts/amxts/commit/d538c1e))

### 🔥 Performance

- **player:** `resetMaxSpeed` without a gamedata search ([8145d3f](https://github.com/amxts/amxts/commit/8145d3f))
- **entities:** Touch listeners matched by class number ([d1e9cb7](https://github.com/amxts/amxts/commit/d1e9cb7))
- **entities:** A touch without a handler call's frame ([9d28099](https://github.com/amxts/amxts/commit/9d28099))

### 📖 Documentation

- **database:** The query builder first, raw SQL after ([fd721ba](https://github.com/amxts/amxts/commit/fd721ba))
- **testing:** `server.storage` keys are the Map's iterator ([f7b8c38](https://github.com/amxts/amxts/commit/f7b8c38))
- **pawn:** The From Pawn pages as the coverage script writes them ([0d76dc4](https://github.com/amxts/amxts/commit/0d76dc4))

#### ⚠️ Breaking Changes

- **fs:** ⚠️  Extract and bytes off the frame ([8969c38](https://github.com/amxts/amxts/commit/8969c38))
- **sound:** ⚠️  Choose who hears a sound ([8adfbfa](https://github.com/amxts/amxts/commit/8adfbfa))

### ❤️ Contributors

- Ernest Manukyan ([@kukson777](https://github.com/kukson777))

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
