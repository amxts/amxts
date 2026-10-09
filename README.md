<div align="center">

<img src="assets/logo.svg" alt="amxts" width="96" height="96">

# amxts

*Counter-Strike 1.6 plugins in TypeScript*

[Documentation](https://amxts.github.io/) • [Getting started](https://amxts.github.io/docs/getting-started/quick-start) • [Modules](https://amxts.github.io/modules) • [Building from source](#building-from-source)

**English** | [Русский](README.ru.md)

</div>

amxts is a framework for writing AMX Mod X plugins in TypeScript. A plugin is
an ordinary `.ts` file - classes, closures, `async`/`await`, events you
listen to - compiled ahead of time to native code and run inside AMX Mod X,
next to your Pawn plugins. The two call each other: a TypeScript plugin
exports natives and forwards for Pawn, and calls any native of any module or
plugin.

## Features

- **TypeScript you already know.** `number`, `string`, arrays, `Map`,
  classes, interfaces with optional fields, closures, `async`/`await` with
  `AbortSignal`.
- **Players and entities are objects.** `player.health = 100`,
  `player.team == "CT"`, `player.hideHud.push("money")`,
  `entity.renderMode = "additive"`.
- **Events as in the DOM.** `server.addEventListener("putInServer", ...)`,
  `game.addEventListener("takeDamage", ...)` for the game's events (ReAPI's
  hookchains and Ham Sandwich's functions), with
  `event.preventDefault()` and an answer by `return`.
- **The editor knows the game.** Every native, ReAPI field and hookchain
  comes with its type and a tooltip in English or Russian; a typo is a red
  line, not a runtime error.
- **No import lines.** `Player`, `server`, `game` and the modules' names are
  auto-imported: the build adds what a plugin uses, and nothing else.
- **Save and play.** `amxts dev` rebuilds what you saved, deploys it and
  reloads the running server - no map change, nobody disconnected.
- **Tests without a server.** Your plugin runs on a fake server under
  `bun test`, driven as players would drive it.
- **Machine code.** Plugins are compiled to machine code before the server
  loads them ([performance](docs/en/2.core/05.performance.md)).
- **Modules, one per server.** `amxts.config.ts` lists them, `amxts module add`
  installs them, and each runs once per server for every plugin that
  uses it; a module no plugin uses is not built.

## Requirements

On the server:

- **Windows or Linux** - the `amxts_amxx` module is `amxts_amxx.dll` or
  `amxts_amxx_i386.so`, both tested on a real server. A plugin is compiled
  for its server's system, which the build reads off the server's folder
  (or `--os`).
- **ReHLDS with ReGameDLL and ReAPI** - recommended. amxts is tested on it and
  on plain HLDS, where the entity fields work through AMX Mod X's own modules
  and the game events come through Ham Sandwich, the game's log and its
  messages: most of them after the game has acted, and a few of ReGameDLL's
  not at all.
- **AMX Mod X 1.9** or later.

To write plugins: [Node.js](https://nodejs.org) 20.12+. The build runs on
[Bun](https://bun.sh), which the core installs itself - nothing to set up.

## Getting started

```sh
npm create amxts@latest    # or: pnpm create amxts, yarn create amxts, bun create amxts
```

It asks for the package manager, the folder, the modules, lint and the
server's folder, writes a project with a first plugin and its test, and
installs everything.

Then, in the project:

```sh
npx amxts dev              # build, deploy to the server in AMXTS_SERVER, again on every save
npx amxts build --deploy   # build once and deploy
npx amxts test             # the tests, on a fake server
```

## A plugin

```ts
// plugins/hello.ts
plugin({ name: "Hello", version: "1.0.0", author: "you", description: "An example" });

server.addCommand("/hp", ({ player }) => sayHp(player));
server.addEventListener("putInServer", (event) => {
	server.print(`${event.player.name} joined`);
});

function sayHp(player: Player) {
	player.print(`${player.name}, your HP: ${player.health}`);

	if (player.health < 50) player.health = 100;
}
```

## Modules

The core includes no modules: a project lists the ones it uses in
`amxts.config.ts`, and `npx amxts module add <name>` installs one. The
official modules, kept by the amxts authors:

| module | what |
| --- | --- |
| [menu-core](https://github.com/amxts/menu-core) | menus from INI, YAML or JSON files or from code: conditions, lists, countdowns - and the `mc_*` natives for Pawn plugins |
| [config-core](https://github.com/amxts/config-core) | configs in INI, YAML or JSON, read into typed objects and written back - and the `cfg_*` natives for Pawn plugins |
| [resemiclip](https://github.com/amxts/resemiclip) | who walks through whom, as a rule over two players, over the ReSemiclip module |
| [ftp](https://github.com/amxts/ftp) | FTP, FTPS and SFTP: upload, download and list files on another server, every call a promise |

Web requests come with the core: `useFetch<T>(url)` and `fetch`, as in the browser. More modules
are in the [catalog](https://amxts.github.io/modules), and
`npx amxts init --module` starts your own.

## Editor support

[amxts for VS Code](https://github.com/amxts/amxts-vscode) gives menu and
config files completion, checks and navigation, from the names your plugins
register as you type them. TypeScript itself needs nothing extra: a project's
`tsconfig.json` is ready for any editor.

## Documentation

[amxts.github.io](https://amxts.github.io/) - getting started, the API,
modules, testing and what amxts cannot do yet, in English and Russian. It
describes the latest release; the next one, which this branch builds, is at
[amxts.github.io/docs/next](https://amxts.github.io/docs/next). The sources
are in [`docs`](docs).

## Building from source

Working on amxts itself takes Bun, an AMX Mod X 1.10 distribution
(`bun run setup:amxmodx`), for the Windows module Windows with CMake and
Visual Studio (32-bit) and LLVM 18 for `wamrc`, for the Linux one Docker
(`bun run build:linux`, `bun run test:server --linux`), and the official
modules and the `amxts` command ([amxts-cli](https://github.com/amxts/amxts-cli))
checked out beside the core. The compilers are patched - AssemblyScript
0.28.20 and WAMR 2.4.5 - and the generated API is not committed:

```sh
npm install --no-package-lock   # npm, not bun: it links the file: folders
bun run generate    # after the compilers are built and patched
bun run test
```

[`CONTRIBUTING.md`](CONTRIBUTING.md) has every step, the checks and how to
send a change.

## License

[MIT](LICENSE). The server module built from this code, with the natives'
image it carries, uses AMX Mod X's SDK, so it is distributed under GPL-3.0-or-later. Third-party
licenses: [`runtime/licenses`](runtime/licenses/README.md).
