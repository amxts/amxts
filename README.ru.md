<div align="center">

<img src="assets/logo.svg" alt="amxts" width="96" height="96">

# amxts

*Плагины для Counter-Strike 1.6 на TypeScript*

[Документация](https://amxts.github.io/ru/) • [Начало работы](https://amxts.github.io/ru/docs/getting-started/quick-start) • [Модули](https://amxts.github.io/ru/modules) • [Сборка из исходников](#сборка-из-исходников)

[English](README.md) | **Русский**

</div>

amxts — фреймворк для плагинов AMX Mod X на TypeScript. Плагин — обычный
файл `.ts`: классы, замыкания, `async`/`await`, события, на которые
подписываешься, — заранее компилируется в машинный код и работает внутри AMX
Mod X рядом с Pawn-плагинами. Они вызывают друг друга: TypeScript-плагин
отдаёт Pawn нативы и форварды и вызывает любой натив любого модуля или
плагина.

## Возможности

- **Знакомый TypeScript.** `number`, `string`, массивы, `Map`, классы,
  интерфейсы с необязательными полями, замыкания, `async`/`await` с
  `AbortSignal`.
- **Игроки и сущности — объекты.** `player.health = 100`,
  `player.team == "CT"`, `player.hideHud.push("Money")`,
  `entity.renderMode = "additive"`.
- **События как в DOM.** `server.addEventListener("putinserver", ...)`,
  `game.addEventListener("takeDamage", ...)` для событий игры (хукчейнов
  reapi и функций Ham Sandwich), с
  `event.preventDefault()` и ответом через `return`.
- **Редактор знает игру.** Каждый натив, поле reapi и хукчейн — с типом и
  подсказкой на русском или английском; опечатка — красная строка, а не
  ошибка на сервере.
- **Без строк импорта.** `Player`, `server`, `print` и имена модулей
  импортируются сами: сборка добавляет то, чем плагин пользуется, и ничего
  больше.
- **Сохранил — играешь.** `amxts dev` пересобирает сохранённое, выкладывает и
  перезагружает работающий сервер — без смены карты, никого не выкидывает.
- **Тесты без сервера.** Плагин работает на поддельном сервере под
  `bun test`, и тест ведёт его, как вели бы игроки.
- **Быстрее Pawn.** К загрузке на сервер плагин уже машинный код; на горячем
  пути настоящего плагина это примерно в три раза быстрее той же логики на
  Pawn.
- **Модули — по одному на сервер.** `amxts.config.ts` их перечисляет,
  `amxts module add` ставит, и каждый работает на сервере в одном экземпляре
  для всех плагинов, которые им пользуются; модуль, которым не пользуется
  никто, не собирается.

## Требования

На сервере:

- **Windows или Linux** — модуль `amxts_amxx` — это `amxts_amxx.dll` или
  `amxts_amxx_i386.so`, оба проверены на настоящем сервере. Плагин
  компилируется под систему своего сервера, которую сборка узнаёт по папке
  сервера (или по `--os`).
- **ReHLDS с ReGameDLL и reapi** — рекомендуется, на этом amxts и
  проверяется. Полям сущностей нужен reapi, как и событиям игры, которые
  приходят от него; на обычном HLDS не запускали.
- **AMX Mod X 1.9** или новее.

Для разработки плагинов: [Node.js](https://nodejs.org) 20.12+. Сборка работает
на [Bun](https://bun.sh), которого ядро ставит само — настраивать ничего не нужно.

## Начало работы

```sh
npm create amxts@latest    # or: pnpm create amxts, yarn create amxts, bun create amxts
```

Команда спрашивает менеджер пакетов, папку, модули, линт и папку сервера,
пишет проект с первым плагином и его тестом и всё устанавливает.

Дальше, в проекте:

```sh
npx amxts dev              # build, deploy to the server in AMXTS_SERVER, again on every save
npx amxts build --deploy   # build once and deploy
npx amxts test             # the tests, on a fake server
```

## Плагин

```ts
// plugins/hello.ts
plugin({ name: "Hello", version: "1.0.0", author: "you", description: "An example" });

server.addCommand("/hp", ({ player }) => sayHp(player));
server.addEventListener("putinserver", (event) => {
	print(0, `${event.player.name} joined`);
});

function sayHp(player: Player) {
	print(player, `${player.name}, your HP: ${player.health}`);

	if (player.health < 50) player.health = 100;
}
```

## Модули

Ядро не включает модулей: проект перечисляет нужные в `amxts.config.ts`, а
`npx amxts module add <name>` ставит модуль. Официальные модули от авторов
amxts:

| модуль | что |
| --- | --- |
| [menu-core](https://github.com/amxts/menu-core) | меню из файлов INI, YAML или JSON или из кода: условия, списки, отсчёты — и нативы `mc_*` для Pawn-плагинов |
| [config-core](https://github.com/amxts/config-core) | конфиги в INI, YAML или JSON, прочитанные в типизированные объекты и записанные обратно, — и нативы `cfg_*` для Pawn-плагинов |
| [resemiclip](https://github.com/amxts/resemiclip) | кто сквозь кого проходит, правилом над двумя игроками, поверх модуля ReSemiclip |

`fetch` поверх easy_http идёт с ядром (`@amxts/core/http`). Другие модули — в
[каталоге](https://amxts.github.io/ru/modules), а `npx amxts init --module`
начинает свой.

## Поддержка в редакторе

[amxts для VS Code](https://github.com/amxts/amxts-vscode) даёт файлам меню и
конфигов подсказки, проверки и навигацию — по именам, которые регистрируют
плагины, прямо при наборе. Самому TypeScript ничего дополнительно не нужно:
`tsconfig.json` проекта готов для любого редактора.

## Документация

[amxts.github.io](https://amxts.github.io/ru/) — начало работы, API, модули,
тесты и то, чего amxts пока не умеет, на русском и английском. Исходники — в
[`docs`](docs).

## Сборка из исходников

Для работы над самим amxts нужны Bun, дистрибутив AMX Mod X 1.10
(`bun run setup:amxmodx`), для модуля под Windows — Windows с CMake и Visual
Studio (32-битная сборка) и LLVM 18 для `wamrc`, для модуля под Linux — Docker
(`bun run build:linux`, `bun run test:server --linux`), а также официальные
модули и команда `amxts` ([amxts-cli](https://github.com/amxts/amxts-cli))
рядом с ядром. Компиляторы заплатаны — AssemblyScript 0.28.20 и WAMR 2.4.5, —
а сгенерированный API не коммитится:

```sh
npm install --no-package-lock   # npm, not bun: it links the file: folders
bun run generate    # after the compilers are built and patched
bun run test
```

[`CONTRIBUTING.ru.md`](CONTRIBUTING.ru.md) — все шаги, проверки и то, как
прислать изменение.

## Лицензия

[MIT](LICENSE). Модуль сервера и host-плагин, собранные из этого кода,
используют SDK AMX Mod X, поэтому распространяются под GPL-3.0-or-later.
Лицензии сторонних проектов: [`runtime/licenses`](runtime/licenses/README.md).
