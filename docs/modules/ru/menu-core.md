---
title: "Меню: menu-core"
---

Меню, описанные в файле — INI, YAML или JSON — или собранные в коде:
страницы, клавиши, путь назад, отсчёт времени и пункты, которые видны,
скрыты или серые в зависимости от того, кто смотрит. Это
[общий модуль](../../ru/5.modules/01.shared-modules.md), которым плагин на TypeScript пользуется
как `menus`, без строки импорта ([автоимпорты](../../ru/2.core/01.plugin.md#автоимпорты)), и он
даёт плагинам на Pawn нативы `mc_*` из `menu_core.inc`.

::: warning В работе
menu-core ещё доделывается. В игре его пробовали всего несколько раз, и его
поведение может измениться.
:::

## Из TypeScript

Меню — объект: `create()` его делает, методы наполняют и открывают, а что
пишет пункт, что он делает, когда он виден и когда его можно выбрать, —
функции прямо у пункта.

```ts
const shop = menus.create("SHOP", { title: player => `Магазин для ${player.name}` });

shop.addItem(player => `Лечение (${player.health} HP)`, {
	visible: player => player.health < 100,
	onSelect: (player) => {
		player.health = 100;
	},
});
shop.addItem("Броня", {
	enabled: player => player.armor < 100,
	message: player => `(уже ${player.armor})`,
	onSelect: (player) => {
		player.armor = 100;
	},
});
// Серый, пока одно отвечает «нет»: первое такое даёт своё сообщение.
shop.addItem("Купить AWP", {
	enabled: [
		{ when: player => player.isAlive, message: "Только живым" },
		{ when: player => player.account >= 4750, message: player => `Не хватает $${4750 - player.account}` },
	],
	onSelect: (player) => {
		player.account = player.account - 4750;
		player.give("weapon_awp");
	},
});
shop.addItem("Закрыть", { action: "CLOSE_MENU", spaceBefore: 1 });

server.addCommand("/shop", ({ player }) => shop.show(player));
```

Текст — заголовок, пункт, `message` погашенного пункта — это сам текст или
функция, которая даёт его для игрока, который смотрит:
`(player, target) => string`, где `target` — цель строки в меню-списке, а
иначе `target` меню. Он читается при каждой отрисовке. Обычная строка, если
это ключ словаря, переводится для игрока.

Пункт говорит, когда он показан и когда его можно выбрать:

- `visible` — показан ли он вообще; пока отвечает «нет», пункта нет и слот
  он не занимает.
- `enabled` — можно ли его выбрать; пока отвечает «нет», пункт серый, а рядом
  `message`. Или список требований, каждое `{ when, message }`: первое
  невыполненное даёт своё сообщение, а требование без своего сообщения —
  сообщение пункта.

В коде требование — функция, и её проверяет редактор. Имена — `IS_ALIVE`,
`FLAG_d`, ограничение, которое зарегистрировал плагин, — для файлов меню:
функцию файл не удержит.

Цвета — метки, те же буквы, что в чате ([цвета](../../ru/2.core/01.plugin.md#цвета)): `!y`
жёлтый, `!r` красный, `!d` серый, `!w` белый, `!R` — остаток строки к правому
краю: `"Armor!R!y100$"`. Метки только для чата — `!g`, `!b` и `!t` — из меню
убираются.

- `menus.create(name, options)` — меню из кода; если имя занято — уже
  существующее. Имя на `LIST_` даёт меню-список. Настройки: `title`, `time`,
  `hideBack`, `hideExit`, `locked` и `activeWhen` — меню открывается, только
  пока она отвечает «да».
- `menu.addItem(text, options)` / `menu.addFixedItem(slot, text, options)` —
  `onSelect` выполняется при выборе пункта; `visible`, пока отвечает «нет»,
  убирает пункт (слот он не занимает); `enabled` — проверка или список
  `{ when, message }` — гасит его, и рядом показывается `message`. Ещё
  `spaceBefore`, `spaceAfter`, `at`, а для меню, которое называет
  зарегистрированное плагинами, — `action` и `placeholder`.
- `menu.show(player, options)` — false, если меню не открылось; настройки:
  `time`, `target`, `resetHistory`, `force`, `skipHistory`.
- `menu.refresh()`, `menu.close()` — у всех, кто его смотрит;
  `menu.setTimer(seconds)`, `menu.cancelTimer()` — общий отсчёт;
  `menu.clearItems()`.
- `menu.addEventListener("open" | "close" | "show", listener)` — события
  этого меню; `"show"` приходит до открытия, и `event.preventDefault()` его
  останавливает.
- Поля: `name`, `kind`, `title`, `time`, `hideBack`, `hideExit`, `locked`,
  `sharedTimer`, `countdown` и имена из menu.ini `activeOn` и `onTimeout`.

В меню-списке строка на каждого игрока, нарисованная по первому пункту: его
текст и `onSelect` получают игрока строки как цель.

```ts
const players = menus.create("LIST_PLAYERS", { title: "Кого поприветствовать" });
players.addFilter((row, viewer) => row.id != viewer.id && row.isAlive, "Некого приветствовать");
players.addItem(rowText, { onSelect: greet });

function rowText(player: Player, target: number) {
	const row = new Player(target);
	return `${row.name} (${row.health} HP)`;
}

function greet(player: Player, target: number) {
	const greeted = new Player(target);
	print(greeted, `${player.name} передаёт привет`);
}
```

`menu.addFilter(test, message)` пропускает строки, на которые `test`
отвечает «нет»; если не осталось ни одной, меню не открывается, а игрок
получает `message`. `menu.setListSource(rows)` даёт свои строки вместо
игроков: `menus.listRow(target, text)`, `menus.textRow(text)`.

Для игрока, какое бы меню он ни смотрел: `menus.close(player)`,
`menus.activeMenu(player)`, `menus.lock(player)`, `menus.show(player, name)` —
меню по имени.

Клавиши: 1-7 выбирают, 8 — следующая страница, 9 — предыдущая страница или
назад в меню, из которого открыто это, 0 закрывает.

## Имена: для файлов меню и Pawn-плагинов

Файлы меню и Pawn-плагины называют то, что им нужно, — условие, действие,
ограничение и `%name%` в тексте для плейсхолдера, — а TypeScript-плагин
отвечает на эти имена функциями:

```ts
menus.addCondition("IS_ALIVE", player => player.isAlive);
menus.addAction("RESET_SCORE", resetScore);
menus.addPlaceholder("hp", player => `${player.health}`);   // %hp% в файле меню
menus.addRestriction("VIP", player => player.access.includes("Reservation"), "только VIP");
menus.setListSource("LIST_FPS_CHECK", rows);        // меню-список из файла, по имени
menus.conditionChanged("IS_ALIVE");                  // перерисовать меню, которые его используют
```

Сообщение ограничения пишется рядом с пунктом, который оно гасит, если у
пункта или требования нет своего. Ещё `menu.addPlaceholder(name, value)` — `%name%` одного меню,
`addActionCheck`, `addConditionFilter`, `menus.addEventListener` на события
всех меню, `refresh("A B")`, `runActions(player, line)`. В коде текст — функция,
а не плейсхолдер.

## Из любого плагина: один menu-core на сервер

На сервере один экземпляр `@amxts/menu-core` — плагина menu-core. Любой
ваш плагин, который им пользуется, вызывает этот экземпляр, с теми же
функциями и типами (см. [Общие модули](../../ru/5.modules/01.shared-modules.md)). Поэтому меню,
которое наполняют несколько плагинов, — главное меню, куда Pawn-плагины
добавляют пункты через `mc_*`, — это одно меню, а у игрока одно открытое
меню, кто бы его ни открыл.

```ts
menus.register("MAIN_MENU");
menus.addCondition("IS_ALIVE", (player) => player.isAlive);
menus.addAction("RESET_SCORE", resetScore);
menus.setListSource("LIST_FPS_CHECK", rows);   // rows(viewer) возвращает строки menus.listRow(target, text)
menus.show(player, "MAIN_MENU", { resetHistory: true });
```

Проект перечисляет в `amxts.config.ts` menu-core, а сразу за ним
config-core: меню menu-core читает через `@amxts/config-core` — плагина
config-core. `npx amxts module add menu-core` ставит и вписывает оба.
Сборка ставит оба плагина в `plugins.ini`, config-core первым.

```ts
// amxts.config.ts
export default defineConfig({
	modules: [
		"@amxts/menu-core",
		"@amxts/config-core", // needed by menu-core
	],
	menus: { file: "myplugin/menu" },     // configs/myplugin/menu.ini, .yaml или .json
});
```

## Меню в файле

Меню читается из файла, когда его впервые запрашивают: через `register(name)` или через `show` с именем, которого Menu Core ещё не знает. Файл — INI, YAML или JSON: `menus: { file: "menu" }` читает первый из `menu.ini`, `menu.yaml`, `menu.yml`, `menu.json` и `menu.jsonc`, который есть, и меню значит одно и то же в любом из них — только INI не умеет скрывать пункт ([столбцы INI](#столбцы-ini)).

Плагин может указать другой файл сам: `setConfigFile("myplugin/menu")` читает `configs/myplugin/menu.ini`, `.yaml`, `.yml`, `.json` или `.jsonc`.

```yaml
# configs/menu.yaml
chatPrefix: MYPLUGIN_CHAT_PREFIX   # префикс в чате для сообщения «некого показать»
labels:
  exit: MYPLUGIN_MENU_EXIT         # кнопки: ключ словаря или сам текст
  number: MYPLUGIN_MENU_NUMBER     # "!y[%d]!w", если словарь не говорит иначе

menus:
  MAIN_MENU:
    title: MYPLUGIN_MENU_MAIN_TITLE
    hideBack: true
    items:
      - name: MYPLUGIN_MENU_MAIN_ADMIN
        visible: IS_ADMIN                  # у остальных его нет
        enabled: FLAG_d                    # серый, рядом сообщение
        message: MYPLUGIN_MENU_NEEDS_FLAG_D
        action: SHOW_ADMIN_MENU
      - name: MYPLUGIN_MENU_MAIN_AWP
        enabled:                           # первое невыполненное даёт своё сообщение
          - when: VIP
            message: MYPLUGIN_MENU_VIP_ONLY
          - when: LEVEL:5
            message: MYPLUGIN_MENU_LEVEL_5
        action: BUY_AWP
      - variants:                          # показан первый, чьё "when" выполняется
          - { name: MYPLUGIN_MENU_MAIN_SPECTATE, when: "!IS_SPECTATOR", action: JOIN_SPECTATE }
          - { name: MYPLUGIN_MENU_MAIN_JOIN, when: IS_SPECTATOR, action: JOIN_TEAM }

  LIST_SPECTATORS_MENU:
    title: MYPLUGIN_MENU_SPECTATORS_TITLE
    activeOn: IS_ROUND_RUNNING
    filters:
      - { when: IS_SPECTATOR, message: MYPLUGIN_CHAT_NO_SPECTATORS }
    view:
      name: "%name%"
      action: SWAP_WITH_SPECTATOR
```

```jsonc
// configs/menu.json
{
  "chatPrefix": "MYPLUGIN_CHAT_PREFIX",
  "labels": { "exit": "MYPLUGIN_MENU_EXIT", "number": "MYPLUGIN_MENU_NUMBER" },
  "menus": {
    "MAIN_MENU": {
      "title": "MYPLUGIN_MENU_MAIN_TITLE",
      "hideBack": true,
      "items": [
        { "name": "MYPLUGIN_MENU_MAIN_ADMIN", "visible": "IS_ADMIN", "enabled": "FLAG_d", "message": "MYPLUGIN_MENU_NEEDS_FLAG_D", "action": "SHOW_ADMIN_MENU" },
        {
          "name": "MYPLUGIN_MENU_MAIN_AWP",
          "enabled": [
            { "when": "VIP", "message": "MYPLUGIN_MENU_VIP_ONLY" },
            { "when": "LEVEL:5", "message": "MYPLUGIN_MENU_LEVEL_5" }
          ],
          "action": "BUY_AWP"
        },
        {
          "variants": [
            { "name": "MYPLUGIN_MENU_MAIN_SPECTATE", "when": "!IS_SPECTATOR", "action": "JOIN_SPECTATE" },
            { "name": "MYPLUGIN_MENU_MAIN_JOIN", "when": "IS_SPECTATOR", "action": "JOIN_TEAM" }
          ]
        }
      ]
    },
    "LIST_SPECTATORS_MENU": {
      "title": "MYPLUGIN_MENU_SPECTATORS_TITLE",
      "activeOn": "IS_ROUND_RUNNING",
      "filters": [{ "when": "IS_SPECTATOR", "message": "MYPLUGIN_CHAT_NO_SPECTATORS" }],
      "view": { "name": "%name%", "action": "SWAP_WITH_SPECTATOR" }
    }
  }
}
```

```ini
; configs/menu.ini
[MAIN]
PREFIX = MYPLUGIN_CHAT_PREFIX
KEY = {
	EXIT = MYPLUGIN_MENU_EXIT
	NUMBER = MYPLUGIN_MENU_NUMBER
}

[MAIN_MENU]
TITLE = MYPLUGIN_MENU_MAIN_TITLE
HIDE_BACK = YES
ITEMS = {
	; название | подстановка | условие | действие | ограничение | сообщение | отступ
	"MYPLUGIN_MENU_MAIN_ADMIN" "" "IS_ADMIN" "SHOW_ADMIN_MENU" "FLAG_d" "MYPLUGIN_MENU_NEEDS_FLAG_D" ""
	"MYPLUGIN_MENU_MAIN_AWP" "" "" "BUY_AWP" "VIP LEVEL:5" "VIP:MYPLUGIN_MENU_VIP_ONLY|MYPLUGIN_MENU_LEVEL_5" ""
	"MYPLUGIN_MENU_MAIN_SPECTATE|MYPLUGIN_MENU_MAIN_JOIN" "" "!IS_SPECTATOR|IS_SPECTATOR" "JOIN_SPECTATE|JOIN_TEAM" "" "" ""
}

[LIST_SPECTATORS_MENU]
TITLE = MYPLUGIN_MENU_SPECTATORS_TITLE
ACTIVE_ON = IS_ROUND_RUNNING
FILTER = {
	"IS_SPECTATOR" "MYPLUGIN_CHAT_NO_SPECTATORS"
}
VIEW = {
	; название | условие | действие | ограничение | сообщение
	"%name%" "" "SWAP_WITH_SPECTATOR" "" ""
}
```

### Поля

| YAML, JSON | INI | Что это |
| --- | --- | --- |
| `chatPrefix` | `[MAIN]` `PREFIX` | Префикс сообщений Menu Core в чате. |
| `labels`: `exit`, `back`, `next`, `number`, `disabled`, `page`, `time` | `[MAIN]` `KEY = { ... }` | Слова кнопок, страницы и отсчёта. |
| `menus`: `{ NAME: меню }` | `[NAME]` | Меню; имя на `LIST_` — меню-список. |
| `title` | `TITLE` | Заголовок; он у меню обязателен. |
| `activeOn` | `ACTIVE_ON` | Условия, при которых меню открывается. |
| `hideBack` · `hideExit` | `HIDE_BACK` · `HIDE_EXIT` | `true` (INI: `YES`) убирает кнопку. |
| `time` · `onTimeout` | `TIME` · `ON_TIMEOUT` | Отсчёт в секундах и действия, когда он закончился. |
| `locked` · `sharedTimer` | `LOCKED` · `GLOBAL` | Пункты нельзя выбрать; один отсчёт на всех. |
| `items` | `ITEMS` | Пункты обычного меню. |
| `fixedItems` | `FIXED_ITEMS` | Пункты, которые держат свой `slot`, 1–7, на каждой странице. |
| `view` · `filters` | `VIEW` · `FILTER` | Строка меню-списка и фильтры, которые проходят его строки: `when`, `message`. |

У пункта — в `items`, в `fixedItems` или в `view` — есть `name`, а ещё:

| Ключ | Что это |
| --- | --- |
| `placeholder` | Текст после названия, с плейсхолдерами: `"%hp%"`. |
| `action` | Действия, которые выполняются при выборе. |
| `visible` | Имена, при которых пункт показан; пока они не выполняются, пункта нет и слот он не занимает (у фиксированного пункта слот остаётся пустым). Не в `view`: меню-список пропускает строки через `filters`. |
| `enabled` | Имена, при которых пункт можно выбрать, а пока они не выполняются, рядом `message`, — или список требований, каждое строка имён или `{ when, message }`: первое невыполненное даёт своё сообщение. |
| `message` | Текст рядом с пунктом, пока его гасит требование без своего сообщения. |
| `spaceBefore` · `spaceAfter` | Пустые строки до и после пункта. |
| `variants` | Несколько видов, `[{ name, when, action }, ...]`: показан первый, чьё `when` выполняется; вариант без `when` выполняется всегда, а если не выполняется ни один, показан первый — серым. |

Сообщение рядом с серым пунктом идёт от общего к частному: то, с которым зарегистрировано ограничение (`addRestriction(name, test, message)`), `message` пункта, собственное сообщение требования. Каждое — текст или ключ словаря.

`visible`, `when`, `enabled`, `activeOn`, `action` и `onTimeout` — это имя, несколько имён через пробел или список: `activeOn: [IS_ALIVE, "!IS_SPECTATOR"]`. В YAML значение, которое начинается с `!` или `%`, берётся в кавычки.

- **Имена** в `visible`, `enabled` и `when` — ограничение, которое зарегистрировал плагин, условие, а иначе ответ ограничения `"*"`. `!NAME` переворачивает имя; несколько должны выполняться все. `NAME:параметр` передаёт проверке ограничения весь токен и забирает с собой остаток строки: `VIP:Only for VIP` — одно имя, поэтому пишите его последним. Незнакомое имя не выполняется.
- **Условия:** `activeOn` называет только условия. Эти встроены — на них отвечает Menu Core, пока имя не регистрирует ни один плагин (а плагин, который регистрирует, отвечает вместо него):

  | Условие | Выполняется, когда игрок |
  | --- | --- |
  | `IS_ALIVE` · `IS_DEAD` | жив · не жив (зритель тоже) |
  | `TEAM_CT` · `TEAM_TERRORIST` · `TEAM_SPECTATOR` · `TEAM_UNASSIGNED` | в этой команде |
  | `IS_BOT` | бот |
  | `IS_ADMIN` | имеет любой доступ, кроме `z` простого игрока, — `is_user_admin` AMX Mod X |
  | `FLAG_<буквы>` | имеет любую из этих букв `users.ini`: `FLAG_ab` |

  В меню-списке условие вида или фильтра спрашивается у игрока строки, а ограничение получает строку как цель. Регистр в именах не важен.
- **Встроенные действия:** `SHOW_<MENU>` открывает это меню, `CLOSE_MENU` закрывает; в строке действия их может быть несколько.
- **Подстановки:** `%name%` (текст строки списка), `%target%`, `%time%` и любые зарегистрированные.
- **Меню-список** рисует свою строку на каждого игрока или на каждую строку своего источника и пропускает те, что не прошли фильтр. Если никого не осталось, меню не открывается, а игрок получает сообщение фильтра.

::: warning В файле меню
- **Флаги** INI-меню — `HIDE_BACK`, `HIDE_EXIT`, `LOCKED`, `GLOBAL` — это `YES` или `NO`: на `true`, `1` или `yes` будет предупреждение с правильным словом, и это `NO`. В YAML `yes` — текст: флаг там — `true` или `false`.
- **Текст с пробелами** в INI-меню берётся в кавычки: `TITLE = "Main menu"`. Без кавычек читается только первое слово.
- **Имя пункта в YAML или JSON не делится по `|`:** его варианты пишутся через `variants`.
- **Цвета** и в файле меню пишутся метками: `!y`, `!r`, `!d`, `!w`, `!R`. На коды Pawn (`\y`, `\r`) будет предупреждение с меткой, которую писать, и они выбрасываются. Текст из Pawn — пункты и заголовки Pawn-плагина, словарь lang — сохраняет свои коды, и menu-core читает их как метки.
- **`%time%` и `%target%` пишутся строчными:** `%TIME%` и `%s` остаются как написаны.
- **`ADMIN` и `ACCESS_ADMIN` не встроены:** их регистрирует плагин, или файл пишет `IS_ADMIN` (любой админ) или `FLAG_<буквы>` (`FLAG_d`).
:::

### Столбцы INI

INI — формат, который читают и Pawn-плагины, поэтому его столбцы неизменны. Строка пункта — `name | placeholder | condition | action | restriction | message | spacing`:

| INI | YAML, JSON |
| --- | --- |
| названия `"A\|B"`, условия `"C1\|C2"`, действия `"X\|Y"` | `variants: [{ name: A, when: C1, action: X }, { name: B, when: C2, action: Y }]` |
| условие, один вариант | `enabled: C` — серый без причины |
| ограничение и сообщение | `enabled: R`, `message: M` — серый с сообщением |
| `"NAME:message\|NAME2:message"` | `enabled: [{ when: NAME, message: ... }, { when: NAME2, message: ... }]` |
| — | `visible` — в INI нечем скрыть пункт |

Столбец условия спрашивает только условия, а столбец ограничения — сначала ограничения, затем условия. Нативы `mc_*` добавляют пункты так же.

::: tip
`menu.ini`, написанный для Pawn, красит текст кодами (`\y`, `\r`). Скрипт menu-core переписывает их метками — в INI, YAML и JSON: `bun node_modules/@amxts/menu-core/scripts/menu-colors.ts configs/menu.ini` (`--dry-run` говорит, что он изменил бы).
:::

### Проверки

То, что не подходит файлу меню, консоль сервера называет с файлом и строкой — а в YAML и JSON и со столбцом — и пропускает; остальное меню читается.

- **Когда файл читается:** незнакомый ключ — с тем, который, может быть, имелся в виду: `visible` или `enabled` вместо `condition` и `restriction` пункта, `when` вместо `condition` варианта или фильтра; значение не того вида (`hideBack: yes` — в YAML `yes` это текст, а поле ждёт `true`; `HIDE_BACK = 1` — флаг INI это `YES` или `NO`); цветовой код (`\y`) там, где файл меню пишет метку, — с меткой, которую написать, а сам код пропускается; меню без заголовка, пункт без названия, `items` в меню-списке, слот вне 1–7. Пункт без действия отмечается, но не как предупреждение: выбор его ничего не делает. Пустой блок `ITEMS = { }` — это нормально.
- **На первом кадре сервера:** каждое имя, действие и подстановка из файла, которые никто не зарегистрировал, — ни TypeScript-плагины, ни Pawn-плагины через нативы `mc_*`, ни сам Menu Core. К этому моменту все плагины прошли `plugin_init` и `plugin_cfg`, так что имя, которое Pawn-плагин регистрирует после чтения файла, за ошибку не принимается. Файл, прочитанный позже, — `setConfigFile()`, — проверяется сразу при чтении. Тогда же — строка имён, которая говорит меньше, чем кажется: имя дважды, регистр не важен (`IS_ADMIN is listed more than once`), имя и его противоположность (`IS_ALIVE and !IS_ALIVE together can never hold`) — каждое требование и каждый вариант отдельно.

```
[MenuCore] addons/amxmodx/configs/menu.yaml:12:9: MAIN_MENU: the condition "IS_SPECTATR" is not registered - did you mean "IS_SPECTATOR"?
[MenuCore] addons/amxmodx/configs/menu.yaml:14:9: MAIN_MENU: SHOW_ADMN_MENU opens the menu "ADMN_MENU", which is not there - did you mean "ADMIN_MENU"?
```

### Подсказки в редакторе

Расширение amxts для VS Code помогает в файле меню прямо при наборе, до
всякой сборки. Напишите в плагине `menus.addCondition("MY_VIP", ...)`, и
`MY_VIP` сразу появится в подсказках `menu.ini`, `menu.yaml` или `menu.json`
— ещё до сохранения плагина.

- **Автодополнение:** ключи каждого уровня; условия, действия, ограничения и
  подстановки, которые регистрируют ваши плагины, — TypeScript, Pawn
  (`mc_register_*`) и установленные модули, — с местом регистрации;
  `SHOW_<MENU>`, `CLOSE_MENU`, встроенные условия; `%подстановки%` после
  `%`.
- **Проверки выше — при наборе,** теми же словами, с быстрым исправлением
  для «did you mean». Имя, которое никто в рабочей области не регистрирует,
  — предупреждение: его может зарегистрировать Pawn-плагин, который есть
  только на сервере. Имя столбца INI вместо ключа — `condition`,
  `restriction` — получает ключ, который нужно писать: `visible`, `enabled`
  или `when`.
- **Подсказка при наведении и переход к определению** ведут от имени к его
  регистрации и её JSDoc; **поиск всех ссылок** на `"MY_VIP"` в плагине
  находит файлы меню, где оно используется.

Файл меню — тот, что называет `amxts.config.ts` (`menus.file`, по умолчанию
`"menu"`), или любой файл, похожий на файл меню. В Marketplace расширения
пока нет: установите его `.vsix` командой
`code --install-extension amxts-vscode-<версия>.vsix` или в VS Code:
**Extensions** → `...` → **Install from VSIX**.

::: warning
Расширение знает только имена, записанные строкой в рабочей области:
`menus.addAction(name, ...)` с именем в переменной и Pawn-плагин, которого
нет в рабочей области, ему неизвестны — это предупреждение в редакторе. В
счёт идёт проверка сервера на его первом кадре.
:::

## Для Pawn-плагинов

Проект, плагины которого на TypeScript menu-core не пользуются, оставляет его
для своих Pawn-плагинов через `pawn: ["@amxts/menu-core"]` в
`amxts.config.ts`: иначе модуль, которым не пользуется ни один плагин, в
сборку не попадает ([собирается только то, чем
пользуются](../../ru/2.core/01.plugin.md#собирается-только-то-чем-пользуются)).

Плагин menu-core отдаёт Pawn-плагинам 30 нативов из `menu_core.inc` —
`mc_register_action`, `mc_show_menu`, `mc_add_menu_item` и остальные — с их
сигнатурами, поэтому скомпилированные `.amxx` работают с ним без изменений.
Он встаёт на место `menu_core.amxx`: тот закомментируйте в `plugins.ini`.
Меню он читает через
`@amxts/config-core`, поэтому в `plugins.ini` amxts config-core стоит
раньше — его туда ставит сборка.

Pawn-плагин называет свои обработчики именем public, и menu-core зовёт их
через callfunc; id плагина берётся из вызова натива.

Сгенерированный `menu_core.inc` (при выкладке он копируется в
`addons/amxmodx/scripting/include` сервера) объявляет:

- свойства меню как `enum MenuProperty { MP_LOCKED = 0, ... MP_FILTER }`, и
  три натива свойств принимают `MenuProperty:property`;
- `mc_add_list_text(aItems, ...)` без тега `Array:`;
- `mc_get_menu_text(id, out[], len)`: что показывает меню игрока, — для
  тестов и логов.

Плагин, собранный с этим include, получит предупреждение о теге на голое
число там, где ждут `MenuProperty:`, и на `Array:` в `mc_add_list_text`.
Значения, которые передаёт собранный плагин, от этого не меняются.

## Как работают нативы

- Нет ограничений Pawn: имена, заголовки и плейсхолдеры любой длины, меню
  держит все пункты, путь назад любой длины, меню длиннее 500 байт (кириллица
  доходит до них быстро) приходит целиком.
- `mc_get_menu_property_string(idx, MP_SECTION)` отдаёт секцию меню.
- Фильтр условия работает везде, где условие спрашивают.
- `message` ограничения (`mc_register_restriction`) показывается у пункта,
  который оно гасит, если у пункта нет своего сообщения.
- Когда меню закрывается, потому что поверх открылось другое, обработчики
  закрытия получают его имя.
- Заблокированное меню гасит пункты любого меню, а не только строки списков.
- `mc_show_menu` секции, которую никто не зарегистрировал, читает её из файла.
- `ADMIN` и `ACCESS_ADMIN` не встроены: меню, где они есть, нужен плагин,
  который их регистрирует (`mc_register_condition`,
  `mc_register_restriction`), иначе проверка скажет, что они не
  зарегистрированы. Без плагина пишите `IS_ADMIN` (любой админ) или
  `FLAG_<буквы>` (`FLAG_dluy` — доступ ban, rcon, admin или menu).
- `isCritical` у `mc_register_action` принимается и ничего не делает.

## Тесты

Menu Core поставляет тестовый набор для поддельного сервера
([тестирование](../../ru/7.testing/01.index.md)): его ставит `setup()`, а `menusOf(server)` из
`@amxts/menu-core/testing` даёт то, что он добавляет, — что показывает меню
игрока, клавиши, которые он нажимает, поддельные Pawn-плагины, которые
регистрируют и отвечают через нативы `mc_*`, и словарь:

```ts
import { setup } from "@amxts/core/test-utils";
import { menusOf } from "@amxts/menu-core/testing";

const server = await setup({ files });
const menus = menusOf(server);
const admin = menus.pawnPlugin("admin.amxx", {
	OnKick: (_id: number, target: number) => kicked.push(target),
	Hp: (_id: number, _target: number, value: PawnArray) => value.set("100"),
});

admin.native("mc_register_action", "KICK", "OnKick");      // вызов из admin.amxx
admin.native("mc_show_menu", player.id, "LIST_KICK");
menus.screen(player)?.text;                                  // что он видит, и клавиши
menus.press(player, 1);
menus.translate({ MYPLUGIN_MENU_EXIT: "Выход" });
```
