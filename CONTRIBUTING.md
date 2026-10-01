# Contributing to amxts

**English** | [Русский](CONTRIBUTING.ru.md)

This is how to build the core from source, check a change and send it. A
plugin author needs none of this: a project gets the core from its package
([amxts.github.io](https://amxts.github.io/)).

## What you need

- [Git](https://git-scm.com), [Bun](https://bun.sh) (CI runs 1.4.2) and
  Node 20.12+.
- The `amxts` command and the official modules checked out beside the core,
  as `package.json` links them:

  ```
  amxts/                     this repository
  amxts-cli/                   github.com/amxts/amxts-cli
  amxts-modules/config-core/   github.com/amxts/config-core
  amxts-modules/menu-core/     github.com/amxts/menu-core
  ```

- An AMX Mod X 1.10 distribution in `amxmodx/`: `bun run setup:amxmodx`
  fetches it for this machine's system. On Linux its `amxxpc` is a 32-bit
  program (`libc6-i386`).
- For the Windows module: CMake 3.20+ and Visual Studio with the C++ workload
  (the module is 32-bit).
- For a Windows `wamrc`: LLVM 18.x, the prebuilt package
  (`clang+llvm-18.1.8-x86_64-pc-windows-msvc.tar.xz`).
- For the Linux module, the Linux `wamrc` and the Linux test server:
  [Docker](https://www.docker.com). Everything else they need is in the
  images.
- A connection the first time `bun run setup` runs: it downloads the
  third-party includes `includes/sources.json` pins (ReAPI, easy_http,
  resemiclip), checks each file's sha256 and puts them in `includes/vendor/`
  ([includes/README.md](includes/README.md)).

`amxmodx/`, `runtime/deps/`, `runtime/build/`, `includes/vendor/` and every
generated file are git-ignored.

## Building

**1. Packages.** In `../amxts-cli`, then here:

```sh
npm install --no-package-lock
```

npm, not bun: npm links the `file:` folders, bun copies them.

**2. The patched AssemblyScript.** The patch
([runtime/patches](runtime/patches/README.md)) is what lets a plugin be plain
TypeScript.

```sh
git clone --depth 1 --branch v0.28.20 https://github.com/AssemblyScript/assemblyscript runtime/deps/assemblyscript
cd runtime/deps/assemblyscript
git apply ../../patches/assemblyscript-0.28.20-amxts.patch
npm install && npm run build
```

After changing `src/` or `std/` there, rebuild it and write the patch back:
`git diff -- src std > ../../patches/assemblyscript-0.28.20-amxts.patch`.

**3. The patched WAMR and `wamrc`.** `wamrc` and the loader in the module
come from this one checkout: an `.aot` from another WAMR release is refused
with `unknown binary version`.

```sh
git clone --depth 1 --branch WAMR-2.4.5 https://github.com/bytecodealliance/wasm-micro-runtime runtime/deps/wamr
cd runtime/deps/wamr && git apply ../../patches/wamr-2.4.5-amxts.patch
cd wamr-compiler
cmake -B build -S . -DWAMR_BUILD_WITH_CUSTOM_LLVM=1 -DLLVM_DIR=<llvm>/lib/cmake/llvm
cmake --build build --config Release
```

`bun run build:linux` builds a Linux `wamrc` too, in Docker.

**4. The AMX Mod X SDK**, at the commit `docker/build/amxmodx.commit` pins:

```sh
git init runtime/deps/amxmodx && cd runtime/deps/amxmodx
git fetch --depth 1 https://github.com/alliedmodders/amxmodx $(cat ../../../docker/build/amxmodx.commit)
git checkout FETCH_HEAD
```

**5. The generated API.** Nothing generated is committed, so this runs after
every clone, before the checks or a build:

```sh
bun run generate
```

It runs `bun run setup` first, then writes the API from the includes.
`bun run clean` removes what the build made.

**6. The host plugin and the module that carries it:**

```sh
bun run host                              # runtime/host/amxts_host.amxx, and runtime/src/host.h
cd runtime
cmake -A Win32 -B build -S .
cmake --build build --config Release      # runtime/build/Release/amxts_amxx.dll
cd ..
bun run build:linux                       # runtime/build/linux: amxts_amxx_i386.so, wamrc
```

The module carries the compiled host plugin and has AMX Mod X load it, so a
server gets the module alone.

The module carries part of the API, so after a change to `as/` or the
includes rebuild in this order: generate, the host, the module.

## Checks

Run them one at a time:

```sh
bun run check          # tsc over src/, scripts/ and tests/
bun run lint           # oxlint and oxfmt --check; bun run lint:fix fixes what it can
bun run test           # the suite, on a fake server
bun run test:fast      # the quick ones: the style test, the generators, the include parser
bun run test:server    # the server suites, on a test server of the AMXTS_SERVER install
bun run test:server --linux   # the same suites on a Linux server, in Docker
bun run test:server --plain   # the same on Linux without ReHLDS, ReGameDLL, ReAPI
bun run test:server --quick   # the same suites compiled as `amxts dev` compiles them
bun run test:release          # the npm packages end to end: a local registry, npx create-amxts, a server in Docker
```

`bun run test:release` publishes the eight packages to a local registry of
its own, makes a project with `npx create-amxts`, builds and tests it and
runs it on the server image in Docker; it needs both systems' release files
in `dist-release/` (`bun run release:linux --no-upload --dry-run`, and
`release:windows`'s), and CI runs it on a tag before the release.

The suites run with `--smol`; a full run takes about 1.2 GB of memory, and
under 2 GB when it compiles everything, from an empty compile cache (CI);
one file is `bun test --smol tests/<name>.test.ts`.
`AMXTS_SERVER` (in `.env` beside `package.json`) is a server's
`addons/amxts` folder. `tests/code-style.test.ts` checks how plugin code
reads: every finding names the file, the line and the rule.

## Documentation

The plugin author's documentation is `docs/`, raw Markdown published on
[amxts.github.io](https://amxts.github.io/) - the site reads the folder as it
is (`docs/README.md`). Every page exists twice: English in `docs/en/`, Russian
in `docs/ru/` - a change goes into both. A numbered folder is a group of the
sidebar with its title and icon in `.navigation.yml`; a new page is a numbered
file in its group, in both languages, with its `title` in the front matter.
Links between pages are relative links to the `.md` files. To preview a change,
run the site from its repository,
[amxts.github.io](https://github.com/amxts/amxts.github.io), checked out beside
this one.

The API's tooltips come from `scripts/docs/`, in both languages; every new
public element gets an entry in both.

## Commits

[Conventional Commits](https://www.conventionalcommits.org), in English:
`feat(game): ...`, `fix(runtime): ...`, `docs: ...`.
