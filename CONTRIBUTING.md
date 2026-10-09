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
  third-party includes `includes/sources.json` pins (ReAPI, resemiclip),
  checks each file's sha256 and puts them in `includes/vendor/`
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

`bun run build:linux` builds a Linux `wamrc` too, in Docker. It builds the
toolchain image `amxts-build` first; an image named by `AMXTS_BUILD_IMAGE` is
taken as it is, which is how CI gives it the image built from its cache.

**4. The SDKs**: AMX Mod X's, and the Half-Life SDK and Metamod's headers the
module needs as a Metamod plugin, each at the commit its file in
`docker/build/` pins:

```sh
for dep in amxmodx:amxmodx hlsdk:hlsdk metamod:metamod-hl1; do
  dir=runtime/deps/${dep%%:*}
  git init $dir
  git -C $dir fetch --depth 1 https://github.com/alliedmodders/${dep#*:} $(cat docker/build/${dep%%:*}.commit)
  git -C $dir checkout FETCH_HEAD
done
```

**5. The generated API.** Nothing generated is committed, so this runs after
every clone, before the checks or a build:

```sh
bun run generate
```

It runs `bun run setup` first, then writes the API from the includes.
`bun run clean` removes what the build made. Within a release line a
released import keeps its shape (`runtime/abi-lock.txt`): when generate
stops on one, give the new shape a new name instead.

**6. The natives' image and the module that carries it:**

```sh
bun run image                             # runtime/host/amxts_natives.amxx, and runtime/src/image.h
cd runtime
cmake -A Win32 -B build -S .
cmake --build build --config Release      # runtime/build/Release/amxts_amxx.dll
cd ..
bun run build:linux                       # runtime/build/linux: amxts_amxx_i386.so, wamrc
bun run build:linux --sanitize            # runtime/build/linux-sanitize: the same under ASan and UBSan
```

The module carries the compiled natives' image - the native table it calls
every native through - and loads it itself, so a server gets the module
alone. It links its network client in too - curl,
mbedTLS and libssh2, which its first build downloads (pinned in
`runtime/network.cmake`) and builds static.

The module carries part of the API, so after a change to `as/` or the
includes rebuild in this order: generate, the image, the module.

## Checks

Run them one at a time:

```sh
bun run check          # tsc over src/, scripts/ and tests/
bun run lint           # oxlint and oxfmt --check; bun run lint:fix fixes what it can
bun run test           # the suite, on a fake server, several files at once
bun run test --changed # only the files a change since origin/next reaches
AMXTS_GC_STRESS=1 bun run test   # the same with a step of the collector on every allocation (CI runs both)
bun run test:fast      # the quick ones: the style test, the generators, the include parser
bun run test:server    # the server suites, on a test server of the AMXTS_SERVER install
bun run test:server --linux   # the same suites on a Linux server, in Docker
bun run test:server --plain   # the same on Linux without ReHLDS, ReGameDLL, ReAPI
bun run test:server --no-reapi   # the same on ReHLDS and ReGameDLL without ReAPI
bun run test:server --linux --amxx 1.9.0-git5303   # the same on another AMX Mod X build
bun run test:server --linux --sanitize   # the same with the module under ASan and UBSan
bun run test:server --full    # the same suites compiled as `amxts build` compiles them
bun run test:server --only cvar,player   # only these suites, beside what every run loads
bun run test:release          # the npm packages end to end: a local registry, npx create-amxts, a server in Docker
```

`--amxx <build>` runs the Linux server on another AMX Mod X build, any one
whose packages' sha256 are in `docker/hlds/amxmodx.sha256`. CI runs the
server suites on three: the image's own (1.10.0-git5474), 1.9.0-git5303 and
1.10.0-git5486.

`--sanitize` runs the Linux server with the module of `bun run build:linux
--sanitize`, its C++ under AddressSanitizer and UBSan: a memory error in it
fails the run with the sanitizer's report, which names the file and line.
CI runs it too, as the `linux (sanitizers)` job, and `--plain` as the
`linux (plain HLDS)` job. CI builds the module and compiles the suites
once, in the `linux (build)` job (`test:server --linux --build-only`); the
five `linux` jobs take them as they are (`--prebuilt`).

The Linux server starts with core dumps on. When it exits on its own, the
run says how (the exit code, the signal) and prints the backtrace of its
core dump, kept with the console in `last-run`; `test:release` does the
same. The Docker host's `core_pattern` has to be `/cores/core.%e.%p` for
the dump to come: CI sets it, and on Docker Desktop `docker run --rm
--privileged debian:bookworm-slim sh -c 'echo /cores/core.%e.%p >
/proc/sys/kernel/core_pattern'` does, until Docker restarts.

`bun run test:release` publishes the nine packages to a local registry of
its own, makes a project with `npx create-amxts`, builds and tests it and
runs it on the server image in Docker; it needs both systems' release files
in `dist-release/` (`bun run release:linux --no-upload --dry-run`, and
`release:windows`'s), and CI runs it on a tag before the release.
`bun run publish:local` publishes them to a local registry on
`http://localhost:4873/` and leaves it running (`--reset` empties it,
`--stop` stops it). Each package goes out as its own version - the core and
`wamrc` share one, the command, `create-amxts` and each official module have
theirs - with its links to the others as `^<their version>`. `--as 0.3.0`
stages the core and `wamrc` as that version (and the command too, when its
`CORE_RANGE` does not take it), the checkouts unchanged and the earlier
releases copied from npm beside them, to try `amxts upgrade` before a
release. A server runs the modules' plugins with a module built as that
version: `AMXTS_AS_VERSION=0.3.0 bun run generate`, then the module.

A release's packages go to npm by hand, once the core's Publish workflow has
made its GitHub Release (`wamrc` comes from it): a maintainer runs `npm
login`, then `bun run publish:npm` - all nine, in order, skipping what npm
has, so a run after a failure finishes it.

`bun run test` runs each test file in a `bun test --smol` of its own, half
as many at once as the machine has CPUs, below normal priority (`--jobs N` or `AMXTS_TEST_JOBS`
for fewer, when memory is short), and prints a line as each file ends, a
failed test at once, and the slowest files at the end;
`dist/test-progress.txt` says where a run is - `cat` it while one runs in
the background. `bun run test showcase` runs the files whose names hold the
word, and one file with bun's own output is
`bun test --smol tests/<name>.test.ts`. `--changed` is for the
edit-and-run loop; run the whole suite before a push.
`bun run test:server` compiles its plugins several at once, as a project's
build does: `AMXTS_BUILD_JOBS`, or `AMXTS_BUILD_MEMORY` in megabytes (3072,
two at once), says how many. Locally they compile as `amxts dev` compiles,
about twice as fast - all but `perf.ts`, which measures speed; in CI and with
`--full`, as `amxts build` does. A compile is kept in the plugin cache and
taken again while nothing it read changed, so a second run, or one after a
change to the module's C++ alone, compiles nothing. A module in
`runtime/build` that would refuse the checkout's plugins - built before the
version's line or the API's imports and natives changed - is built again
first (`bun run generate`, then cmake's build, or `bun run build:linux`),
with a line saying so; one older than a file of `runtime/src` or
`runtime/CMakeLists.txt` is built again too, without `generate`.
`AMXTS_SERVER` (in `.env` beside `package.json`) is a server's
`addons/amxts` folder. `tests/code-style.test.ts` checks how plugin code
reads: every finding names the file, the line and the rule.

The `perf` server suite is a speed check: it measures a native, fields,
the HUD's money, a vector, an event, whole and fractional arithmetic and a
plugin's hot path against the same in Pawn (`tests/server/perf-pawn.sma`),
and fails when TypeScript's time over Pawn's passes its limit (`LIMITS` in
`tests/server/perf.ts`): the failure names the ratio, both times and the
limit. A change to a hot path is measured before and after, and the result
goes to the maintainers, not into the commit; a limit moves only on purpose.
On Linux CI also holds each measure against the last passing runs on the
same CPU (`scripts/perf-history.ts`): one more than three times its median
there fails the job, as the code's doing until a bisect on that CPU says
otherwise - a rerun that lands on another CPU proves nothing. The Linux
module's build fails when its own code makes a number whole through the
x87 (`fldcw`): AMD's Zen cores stall on it at some code addresses, so a cast
of a float or a double in the module is `Whole()`.

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
public element gets an entry in both. The page "From Pawn" is written from
the tooltips' `Pawn:` lines: after a change to them,
`bun scripts/coverage.ts --write` writes it again (`tests/coverage.test.ts`
fails until then).

## Branches

`main` is the next version. Each released minor version has its branch,
`0.N.x` (the latest is what [amxts.github.io](https://amxts.github.io/docs)
shows; `main` is at `/docs/next`). A fix the released version needs too -
in the code or the docs - goes into the latest `0.N.x`, which is then merged
into `main`; everything else goes into `main`. The command and each official
module have versions of their own, so their lines are their own versions'.

## Commits

[Conventional Commits](https://www.conventionalcommits.org), in English:
`feat(game): ...`, `fix(runtime): ...`, `docs: ...`.
