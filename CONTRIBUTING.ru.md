# Как внести вклад в amxts

[English](CONTRIBUTING.md) | **Русский**

Здесь — как собрать ядро из исходников, проверить изменение и прислать его.
Автору плагинов ничего из этого не нужно: проект получает ядро из пакета
([amxts.github.io](https://amxts.github.io/ru/)).

## Что нужно

- [Git](https://git-scm.com), [Bun](https://bun.sh) (в CI — 1.4.2) и
  Node 20.12+.
- Команда `amxts` и официальные модули рядом с ядром — так, как их
  подключает `package.json`:

  ```
  amxts/                     this repository
  amxts-cli/                   github.com/amxts/amxts-cli
  amxts-modules/config-core/   github.com/amxts/config-core
  amxts-modules/menu-core/     github.com/amxts/menu-core
  ```

- Дистрибутив AMX Mod X 1.10 в `amxmodx/`: `bun run setup:amxmodx` скачивает
  его для системы этой машины. На Linux его `amxxpc` — 32-битная программа
  (`libc6-i386`).
- Для модуля под Windows: CMake 3.20+ и Visual Studio с нагрузкой C++ (модуль
  32-битный).
- Для `wamrc` под Windows: LLVM 18.x, готовый пакет
  (`clang+llvm-18.1.8-x86_64-pc-windows-msvc.tar.xz`).
- Для модуля и `wamrc` под Linux и для тестового сервера на Linux:
  [Docker](https://www.docker.com). Всё остальное для них есть в образах.
- Сеть при первом запуске `bun run setup`: он скачивает сторонние include,
  закреплённые в `includes/sources.json` (ReAPI, resemiclip),
  сверяет sha256 каждого файла и кладёт их в `includes/vendor/`
  ([includes/README.md](includes/README.md)).

`amxmodx/`, `runtime/deps/`, `runtime/build/`, `includes/vendor/` и все
сгенерированные файлы игнорируются git.

## Сборка

**1. Пакеты.** Сначала в `../amxts-cli`, потом здесь:

```sh
npm install --no-package-lock
```

npm, а не bun: npm связывает папки `file:`, bun их копирует.

**2. Заплатанный AssemblyScript.** Заплатка
([runtime/patches](runtime/patches/README.md)) — то, что позволяет писать
плагин на обычном TypeScript.

```sh
git clone --depth 1 --branch v0.28.20 https://github.com/AssemblyScript/assemblyscript runtime/deps/assemblyscript
cd runtime/deps/assemblyscript
git apply ../../patches/assemblyscript-0.28.20-amxts.patch
npm install && npm run build
```

После правки `src/` или `std/` там пересоберите его и запишите заплатку
обратно: `git diff -- src std > ../../patches/assemblyscript-0.28.20-amxts.patch`.

**3. Заплатанный WAMR и `wamrc`.** `wamrc` и загрузчик в модуле берутся из
одной рабочей копии: `.aot` от другого выпуска WAMR не загрузится —
`unknown binary version`.

```sh
git clone --depth 1 --branch WAMR-2.4.5 https://github.com/bytecodealliance/wasm-micro-runtime runtime/deps/wamr
cd runtime/deps/wamr && git apply ../../patches/wamr-2.4.5-amxts.patch
cd wamr-compiler
cmake -B build -S . -DWAMR_BUILD_WITH_CUSTOM_LLVM=1 -DLLVM_DIR=<llvm>/lib/cmake/llvm
cmake --build build --config Release
```

`bun run build:linux` собирает и `wamrc` под Linux, в Docker.

**4. SDK AMX Mod X** — на коммите из `docker/build/amxmodx.commit`:

```sh
git init runtime/deps/amxmodx && cd runtime/deps/amxmodx
git fetch --depth 1 https://github.com/alliedmodders/amxmodx $(cat ../../../docker/build/amxmodx.commit)
git checkout FETCH_HEAD
```

**5. Сгенерированный API.** Сгенерированное не коммитится, поэтому это
запускается после каждого клонирования, до проверок и сборки:

```sh
bun run generate
```

Сначала он запускает `bun run setup`, потом пишет API из include.
`bun run clean` удаляет то, что сделала сборка.

**6. Хост-плагин и модуль, который его несёт:**

```sh
bun run host                              # runtime/host/amxts_host.amxx и runtime/src/host.h
cd runtime
cmake -A Win32 -B build -S .
cmake --build build --config Release      # runtime/build/Release/amxts_amxx.dll
cd ..
bun run build:linux                       # runtime/build/linux: amxts_amxx_i386.so, wamrc
```

Модуль несёт скомпилированный хост-плагин в себе и сам даёт AMX Mod X его
загрузить, поэтому на сервер ставится один модуль. Сетевой клиент тоже
влинкован в него — curl, mbedTLS и libssh2, которые первая сборка скачивает
(они закреплены в `runtime/network.cmake`) и собирает статически.

Модуль несёт часть API в себе, поэтому после правки `as/` или include
пересобирайте по порядку: generate, хост, модуль.

## Проверки

Запускайте по одной:

```sh
bun run check          # tsc over src/, scripts/ and tests/
bun run lint           # oxlint and oxfmt --check; bun run lint:fix fixes what it can
bun run test           # the suite, on a fake server
bun run test:fast      # the quick ones: the style test, the generators, the include parser
bun run test:server    # the server suites, on a test server of the AMXTS_SERVER install
bun run test:server --linux   # the same suites on a Linux server, in Docker
bun run test:server --plain   # the same on Linux without ReHLDS, ReGameDLL, ReAPI
bun run test:server --linux --amxx 1.9.0-git5303   # the same on another AMX Mod X build
bun run test:server --quick   # the same suites compiled as `amxts dev` compiles them
bun run test:server --only cvar,player   # only these suites, beside what every run loads
bun run test:release          # пакеты npm от начала до конца: локальный реестр, npx create-amxts, сервер в Docker
```

`--amxx <build>` запускает сервер под Linux на другой сборке AMX Mod X —
любой, чьи пакеты с sha256 есть в `docker/hlds/amxmodx.sha256`. CI гоняет
серверные наборы на трёх: своей сборке образа (1.10.0-git5474),
1.9.0-git5303 и 1.10.0-git5486.

`bun run test:release` публикует девять пакетов в свой локальный реестр,
создаёт проект через `npx create-amxts`, собирает и тестирует его и
запускает на образе сервера в Docker; ему нужны файлы выпуска обеих систем
в `dist-release/` (`bun run release:linux --no-upload --dry-run` и файлы
`release:windows`), а CI запускает его на теге перед выпуском.
`bun run publish:local` публикует их в локальный реестр на
`http://localhost:4873/` и оставляет его работать (`--reset` очищает его,
`--stop` останавливает). Каждый пакет выходит своей версией — ядро и
`wamrc` делят одну, у команды, `create-amxts` и каждого официального модуля
свои — со ссылками на остальные как `^<их версия>`. `--as 0.3.0` готовит
ядро и `wamrc` как эту версию (и команду, когда её `CORE_RANGE` эту версию
не принимает), не меняя рабочие копии и копируя рядом прежние выпуски из
npm, — чтобы проверить `amxts upgrade` до выпуска. Сервер запускает плагины
модулей модулем, собранным как эта версия:
`AMXTS_AS_VERSION=0.3.0 bun run generate`, затем модуль.

Пакеты выпуска публикуются в npm вручную, когда workflow Publish ядра создал
его GitHub Release (`wamrc` берётся оттуда): мейнтейнер запускает `npm
login`, затем `bun run publish:npm` — все девять, по порядку, пропуская то,
что в npm уже есть, так что повторный запуск после сбоя доводит дело до конца.

Наборы запускаются с `--smol`; полный прогон занимает около 1,2 ГБ памяти и
меньше 2 ГБ, когда компилирует всё с пустым кэшем компиляции (CI);
один файл — `bun test --smol tests/<имя>.test.ts`.
`bun run test:server` компилирует свои плагины по нескольку сразу, как сборка
проекта: сколько — говорит `AMXTS_BUILD_JOBS` или `AMXTS_BUILD_MEMORY` в
мегабайтах (3072 — две сразу).
`AMXTS_SERVER` (в `.env` рядом с `package.json`) — папка `addons/amxts`
сервера. `tests/code-style.test.ts` проверяет, как читается код плагинов:
каждая находка называет файл, строку и правило.

Серверный набор `perf` — проверка скорости: он меряет натив, поля, деньги
на HUD, вектор, событие, целую и дробную арифметику и горячий путь плагина
против того же в Pawn (`tests/server/perf-pawn.sma`) и проваливается, когда
отношение времени TypeScript к времени Pawn выходит за предел (`LIMITS` в
`tests/server/perf.ts`): провал называет отношение, оба времени и предел.
Правку горячего пути меряют до и после, и результат идёт мейнтейнерам, а
не в коммит; предел двигается только намеренно.

## Документация

Документация автора плагинов — `docs/`, обычный Markdown, который публикуется
на [amxts.github.io](https://amxts.github.io/ru/): сайт читает папку как есть
(`docs/README.ru.md`). Каждая страница есть дважды: английская в `docs/en/`,
русская в `docs/ru/` — правка идёт в обе. Пронумерованная папка — группа
бокового меню, её название и значок — в `.navigation.yml`; новая страница —
пронумерованный файл в своей группе, на обоих языках, с `title` во front
matter. Ссылки между страницами — относительные ссылки на файлы `.md`. Чтобы
посмотреть правку, запустите сайт из его репозитория,
[amxts.github.io](https://github.com/amxts/amxts.github.io), склонированного
рядом с этим.

Подсказки API берутся из `scripts/docs/`, на обоих языках; у каждого нового
публичного элемента есть запись на обоих.

## Ветки

`main` — следующая версия. У каждой выпущенной минорной версии своя ветка,
`0.N.x` (последнюю показывает [amxts.github.io](https://amxts.github.io/ru/docs);
`main` — на `/ru/docs/next`). Исправление, нужное и выпущенной версии, — в коде
или в документации — идёт в последнюю `0.N.x`, а она потом сливается в `main`;
всё остальное — в `main`. У команды и каждого официального модуля свои
версии, поэтому и ветки у них — своих версий.

## Коммиты

[Conventional Commits](https://www.conventionalcommits.org), на английском:
`feat(game): ...`, `fix(runtime): ...`, `docs: ...`.
