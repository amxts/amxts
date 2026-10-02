// The tooltips of as/facade.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'Handler': {
		en: `A handler that takes a player \`id\` and returns nothing — what player events and commands call.`,
		ru: `Обработчик, который получает \`id\` игрока и ничего не возвращает, — так вызываются события игрока и команды.`,
	},
	'WideHandler': {
		en: `
			A handler that takes up to four numbers and returns nothing: for a forward
			that passes more than a player \`id\`, and for a hookchain.

			A string argument arrives as a number: read it with \`argString\`. To stop
			the event, or to block what a hookchain hooks, call \`handled()\`.
		`,
		ru: `
			Обработчик, который получает до четырёх чисел и ничего не возвращает: для
			форварда, который передаёт больше, чем \`id\` игрока, и для хукчейна.

			Строковый аргумент приходит числом: прочитайте его через \`argString\`.
			Чтобы остановить событие или заблокировать то, что перехватывает хукчейн,
			вызовите \`handled()\`.
		`,
	},
	'hostIndex': {
		en: `@hidden For the hood: what the server calls for \`handler\`.`,
		ru: `@hidden Для капота: что сервер вызывает вместо \`handler\`.`,
	},
	'handled': {
		en: `
			Stops the event: AMX Mod X passes it to no one else, and a hookchain does
			not call what it hooked. Applies only to the handler that is running.

			  function onSay(id: number) {
			    if (muted(id)) handled();
			  }

			Pawn: \`return PLUGIN_HANDLED\`
		`,
		ru: `
			Останавливает событие: AMX Mod X больше никому его не передаёт, а хукчейн
			не вызывает то, что перехватил. Действует только на выполняющийся
			обработчик.

			  function onSay(id: number) {
			    if (muted(id)) handled();
			  }

			Pawn: \`return PLUGIN_HANDLED\`
		`,
	},

	'floatCell': {
		en: `
			Converts a number to a Pawn \`Float:\` cell, for a raw native or \`ret()\`:

			  ret(floatCell(2.5));
			  rg_round_end(floatCell(5.0), ...);
		`,
		ru: `
			Переводит число в ячейку \`Float:\` для Pawn — для сырого натива или \`ret()\`:

			  ret(floatCell(2.5));
			  rg_round_end(floatCell(5.0), ...);
		`,
	},
	'rounded': {
		en: `
			Rounds a number to the nearest whole number: a round time of 59.6 seconds
			is \`60\`, not \`59\`.

			Pawn: \`floatround\`
		`,
		ru: `
			Округляет число до ближайшего целого: время раунда 59.6 секунды — это \`60\`,
			а не \`59\`.

			Pawn: \`floatround\`
		`,
	},
	'cellFloat': {
		en: `Converts a Pawn \`Float:\` cell back to a number.`,
		ru: `Переводит ячейку \`Float:\` из Pawn обратно в число.`,
	},
	'ret': {
		en: `Sets the value an exported native returns to the plugin that called it.`,
		ru: `Задаёт значение, которое экспортированный натив возвращает вызвавшему его плагину.`,
	},
	'publicFor': {
		en: `
			A public name that calls \`handler\`, for an AMX Mod X native that takes a
			callback by name: \`register_think\`, \`set_native_filter\`.

			\`\`\`ts
			const pub = publicFor(onThink, "think:myplugin_box");
			if (pub.length > 0) register_think("myplugin_box", pub);
			\`\`\`

			An empty name means “already registered”: such a registration cannot be
			undone and survives a hot reload, so registering again would call the
			handler twice. \`key\` identifies the registration across reloads — any name
			unique within the plugin. \`fallback\` is the answer when the handler returns
			nothing: \`0\` for most natives, \`1\` where the native expects the event handled.

			Register from the \`"cfg"\` event, not at the top of the file: a console
			command registered that early (\`register_concmd\`, \`register_srvcmd\`) crashes
			the server when typed.
		`,
		ru: `
			Имя паблика, который вызывает \`handler\`, — для натива AMX Mod X,
			принимающего колбэк по имени: \`register_think\`, \`set_native_filter\`.

			\`\`\`ts
			const pub = publicFor(onThink, "think:myplugin_box");
			if (pub.length > 0) register_think("myplugin_box", pub);
			\`\`\`

			Пустое имя значит «уже зарегистрировано»: такую регистрацию нельзя
			отменить, она переживает горячую перезагрузку, и повторная вызывала бы
			обработчик дважды. \`key\` опознаёт регистрацию между перезагрузками — любое
			имя, уникальное в пределах плагина. \`fallback\` — ответ, если обработчик
			ничего не вернул: \`0\` почти везде, \`1\` там, где натив ждёт обработанное событие.

			Регистрируйте из события \`"cfg"\`, а не с верхнего уровня файла: консольная
			команда, зарегистрированная так рано (\`register_concmd\`, \`register_srvcmd\`),
			роняет сервер, когда её вводят.
		`,
	},
	'nativeFn': {
		en: `
			Exports a native for other plugins - Pawn ones included - to call.

			  nativeFn("myplugin_get_mode", getGameMode)

			  function getGameMode(a: number, b: number, c: number, d: number) {
			    ret(mode);
			  }

			The handler gets the first four arguments as numbers; \`arg(i)\` and
			\`argText(i)\` read any of them, \`setArg\` and \`setArgText\` write back.
			Simpler: an \`export function\` of the entry file is a native with real
			types (see the Natives page).

			Call it at the top level of the file: AMX Mod X asks every plugin for its
			natives before it starts any of them.

			Pawn: \`register_native\`
		`,
		ru: `
			Экспортирует натив, который могут вызывать другие плагины, в том числе на
			Pawn.

			  nativeFn("myplugin_get_mode", getGameMode)

			  function getGameMode(a: number, b: number, c: number, d: number) {
			    ret(mode);
			  }

			Обработчик получает первые четыре аргумента числами; \`arg(i)\` и
			\`argText(i)\` читают любой из них, \`setArg\` и \`setArgText\` пишут обратно.
			Проще так: \`export function\` входного файла — это натив с настоящими
			типами (см. страницу «Нативы»).

			Вызывайте на верхнем уровне файла: AMX Mod X спрашивает у каждого плагина
			нативы до того, как запустит хоть один.

			Pawn: \`register_native\`
		`,
	},
	'Float': {
		en: `
			A number that a plugin's own native passes to Pawn as \`Float:\`.

			To TypeScript it is \`number\`. Write it only in the signature of an exported
			native, where Pawn has to know which numbers are fractional; everywhere
			else a number is \`number\`.

			\`\`\`ts
			export function cfg_get_float(file: string, key: string): Float { ... }
			//   native Float:cfg_get_float(const file[], const key[]);
			export function set_speed(id: number, speed: Float) { ... }
			//   native set_speed(id, Float:speed);
			\`\`\`
		`,
		ru: `
			Число, которое собственный натив плагина передаёт в Pawn как \`Float:\`.

			Для TypeScript это \`number\`. Пишется только в сигнатуре экспортированного
			натива, где Pawn нужно знать, какие числа дробные; в остальном коде число —
			это \`number\`.

			\`\`\`ts
			export function cfg_get_float(file: string, key: string): Float { ... }
			//   native Float:cfg_get_float(const file[], const key[]);
			export function set_speed(id: number, speed: Float) { ... }
			//   native set_speed(id, Float:speed);
			\`\`\`
		`,
	},
	'CellArray': {
		en: `
			A dynamic array of AMX Mod X, for returning a list to a Pawn plugin that
			expects an \`Array:\` handle.

			\`\`\`ts
			export function cfg_get_value_array(section: ConfigSection, key: string) {
			  const words = lookup(section, key);                // string[] | null
			  return words != null ? CellArray.fromStrings(words) : null;
			}
			// native Array:cfg_get_value_array(ConfigSection:section, const key[]);
			\`\`\`

			The Pawn plugin that gets the array owns it and destroys it; \`null\` reaches
			it as \`Invalid_Array\`. Inside TypeScript a list is a \`string[]\` or a
			\`number[]\`: this class is only for handing one to Pawn.

			Pawn: \`ArrayCreate\`, \`Array:\`
		`,
		ru: `
			Динамический массив AMX Mod X — чтобы вернуть список Pawn-плагину, который
			ждёт хэндл \`Array:\`.

			\`\`\`ts
			export function cfg_get_value_array(section: ConfigSection, key: string) {
			  const words = lookup(section, key);                // string[] | null
			  return words != null ? CellArray.fromStrings(words) : null;
			}
			// native Array:cfg_get_value_array(ConfigSection:section, const key[]);
			\`\`\`

			Pawn-плагин, получивший массив, владеет им и сам его удаляет; \`null\`
			приходит к нему как \`Invalid_Array\`. Внутри TypeScript список — это
			\`string[]\` или \`number[]\`: этот класс нужен только для передачи в Pawn.

			Pawn: \`ArrayCreate\`, \`Array:\`
		`,
	},
	'CellArray.handle': {
		en: `The array's handle, the \`Array:\` Pawn gets.`,
		ru: `Хэндл массива — \`Array:\`, который получает Pawn.`,
	},
	'CellArray.fromStrings': {
		en: `A new array of strings, each up to \`cellSize - 1\` bytes.`,
		ru: `Новый массив строк, каждая до \`cellSize - 1\` байт.`,
	},
	'CellArray.fromFloats': {
		en: `A new array of fractional numbers, which Pawn reads as \`Float:\`.`,
		ru: `Новый массив дробных чисел, которые Pawn читает как \`Float:\`.`,
	},
	'CellArray.length': {
		en: `The number of items in the array.`,
		ru: `Число элементов в массиве.`,
	},
	'CellArray.pushString': {
		en: `Adds a string; it must fit in \`cellSize - 1\` bytes of UTF-8.`,
		ru: `Добавляет строку; она должна уместиться в \`cellSize - 1\` байт UTF-8.`,
	},
	'CellArray.pushCell': {
		en: `Adds a whole number, or another array's handle.`,
		ru: `Добавляет целочисленное значение или хэндл другого массива.`,
	},
	'CellArray.pushFloat': {
		en: `Adds a fractional number, which Pawn reads as \`Float:\`.`,
		ru: `Добавляет дробное число, которое Pawn читает как \`Float:\`.`,
	},
	'CellArray.pushCells': {
		en: `Adds one item of several numbers: \`[a, b]\` into an array made with \`new CellArray(2)\`.`,
		ru: `Добавляет один элемент из нескольких чисел: \`[a, b]\` в массив, созданный через \`new CellArray(2)\`.`,
	},
	'arg': {
		en: `
			Reads an argument of the running handler by position; \`0\` is its first
			parameter. Useful past the fourth, which a handler does not get as a
			parameter.

			  function onSomething(a: number, b: number, c: number, d: number) {
			    const fifth = arg(4);
			  }
		`,
		ru: `
			Читает аргумент выполняющегося обработчика по номеру; \`0\` — его первый
			параметр. Нужна для аргументов после четвёртого, которых обработчик
			параметрами не получает.

			  function onSomething(a: number, b: number, c: number, d: number) {
			    const fifth = arg(4);
			  }
		`,
	},
	'argText': {
		en: `
			Reads an argument of the running callback as a string.

			A forward's strings need no call: its handler gets them as text already.
		`,
		ru: `
			Читает аргумент выполняющегося колбэка как строку.

			Форварду это не нужно: его обработчик получает строки уже текстом.
		`,
	},
	'argc': {
		en: `
			The number of arguments the running call actually carried.

			A handler always gets four, padded with zeros, so a native with optional
			arguments tells a passed zero from a missing one by this:

			  const flashes = argc() >= 2 ? arg(1) : -1;
		`,
		ru: `
			Число аргументов, которые на самом деле пришли в выполняющийся вызов.

			Обработчик всегда получает четыре, дополненные нулями, поэтому натив с
			необязательными аргументами по этому числу отличает переданный ноль от
			непереданного:

			  const flashes = argc() >= 2 ? arg(1) : -1;
		`,
	},
	'caller': {
		en: `
			The \`id\` of the plugin that called the running exported native, or \`-1\`.

			For a native that is about its caller: a cvar registered by a plugin, a
			chat prefix set for one.
		`,
		ru: `
			\`id\` плагина, который вызвал выполняющийся экспортированный натив, или \`-1\`.

			Для натива, который касается вызывающего: квар, зарегистрированный
			плагином, префикс чата, заданный для него.
		`,
	},
	'setArg': {
		en: `
			Writes a number back through an argument passed by reference (\`&value\`
			in Pawn).

			Pawn: \`set_param_byref\`
		`,
		ru: `
			Записывает число обратно через аргумент, переданный по ссылке (\`&value\`
			в Pawn).

			Pawn: \`set_param_byref\`
		`,
	},
	'setArgText': {
		en: `
			Writes text back through a string argument.

			For a callback that hands over a buffer to fill rather than text to read.
			\`max\` is the room the caller gave, usually the argument right after the
			buffer.

			  function placeholder(id: number, target: number, out: number, max: number) {
			    setArgText(2, "ready", max);
			  }
		`,
		ru: `
			Записывает текст обратно через строковый аргумент.

			Для колбэка, который передаёт не текст для чтения, а буфер для заполнения.
			\`max\` — место, которое дал вызывающий; обычно это аргумент сразу после
			буфера.

			  function placeholder(id: number, target: number, out: number, max: number) {
			    setArgText(2, "ready", max);
			  }
		`,
	},
	'argString': {
		en: `Reads a string argument that a wide handler got as a number.`,
		ru: `Читает строковый аргумент, который широкий обработчик получил числом.`,
	},
	'cellsToString': {
		en: `Reads the text a raw native from \`~/natives\` wrote into a cell array. \`stringToCells\` is the other way.`,
		ru: `Читает текст, который сырой натив из \`~/natives\` записал в массив ячеек. Обратно — \`stringToCells\`.`,
	},
	'stringToCells': {
		en: `Writes text into a cell array as a Pawn string, for a raw native.`,
		ru: `Записывает текст в массив ячеек как строку Pawn — для сырого натива.`,
	},
	'cells': {
		en: `
			Passes a string to a raw native from \`~/natives\` without declaring a
			buffer for it:

			  cfg_set_base_dir(cells("myplugin"));

			Up to eight strings in one call; a ninth overwrites the first. Only for
			arguments going in: a native that writes text back needs \`out()\`.
		`,
		ru: `
			Передаёт строку сырому нативу из \`~/natives\` без объявления буфера под неё:

			  cfg_set_base_dir(cells("myplugin"));

			До восьми строк в одном вызове; девятая затирает первую. Только для
			входящих аргументов: нативу, который пишет текст обратно, нужен \`out()\`.
		`,
	},
	'out': {
		en: `
			A buffer for a raw native to write text into; \`text()\` reads it back.

			  const name = out();
			  get_user_name(id, name, TEXT_MAX);
			  console.log(text(name));

			Up to four at once. A number a native writes through a \`&reference\` needs
			one too; \`cell()\` reads it back.
		`,
		ru: `
			Буфер, в который сырой натив пишет текст; прочитать его — \`text()\`.

			  const name = out();
			  get_user_name(id, name, TEXT_MAX);
			  console.log(text(name));

			Одновременно — до четырёх. Числу, которое натив пишет через \`&ссылку\`,
			тоже нужен такой буфер; прочитать его — \`cell()\`.
		`,
	},
	'text': {
		en: `Reads the text a native wrote into an \`out()\` buffer.`,
		ru: `Читает текст, который натив записал в буфер \`out()\`.`,
	},
	'CellBuffer': {
		en: `
			A row of numbers for a native to read from or write into: a vector, a list
			of players, a line of text. Used like an ordinary array - \`buffer[0]\`,
			\`buffer.float(2)\`, \`buffer.text()\` - and its \`address\` is what the native
			takes.

			  const origin = new CellBuffer(3);
			  entity_set_origin(cube, origin.address);
		`,
		ru: `
			Ряд чисел, из которого натив читает или в который пишет: вектор, список
			игроков, строка текста. Пользуются им как обычным массивом — \`buffer[0]\`,
			\`buffer.float(2)\`, \`buffer.text()\`, — а натив принимает его \`address\`.

			  const origin = new CellBuffer(3);
			  entity_set_origin(cube, origin.address);
		`,
	},
	'CellBuffer.vector': {
		en: `A buffer of three fractional numbers, for a native that takes a vector: an origin, a size, a colour.`,
		ru: `Буфер из трёх дробных чисел для натива, который принимает вектор: позицию, размер, цвет.`,
	},
	'CellBuffer.length': {
		en: `The number of cells in the buffer.`,
		ru: `Число ячеек в буфере.`,
	},
	'CellBuffer.address': {
		en: `The buffer's address, the argument a native that takes an array needs.`,
		ru: `Адрес буфера — аргумент для натива, который принимает массив.`,
	},
	'CellBuffer.get': {
		en: `The whole number in the cell at \`index\`: \`buffer[0]\`.`,
		ru: `Целочисленное значение в ячейке с номером \`index\`: \`buffer[0]\`.`,
	},
	'CellBuffer.set': {
		en: `Puts a whole number in the cell at \`index\`: \`buffer[0] = 5\`.`,
		ru: `Кладёт целочисленное значение в ячейку с номером \`index\`: \`buffer[0] = 5\`.`,
	},
	'CellBuffer.float': {
		en: `The fractional number in the cell at \`index\`, which a native wrote as \`Float:\`.`,
		ru: `Дробное число в ячейке с номером \`index\`, которое натив записал как \`Float:\`.`,
	},
	'CellBuffer.setFloat': {
		en: `Puts a fractional number in the cell at \`index\`, for a native that reads \`Float:\`.`,
		ru: `Кладёт дробное число в ячейку с номером \`index\` — для натива, который читает \`Float:\`.`,
	},
	'CellBuffer.text': {
		en: `The text a native wrote into the buffer.`,
		ru: `Текст, который натив записал в буфер.`,
	},
	'CellBuffer.write': {
		en: `Writes text into the buffer from the cell \`at\`, as a Pawn string.`,
		ru: `Записывает текст в буфер начиная с ячейки \`at\`, как строку Pawn.`,
	},
	'CellBuffer.fill': {
		en: `Sets every cell to \`value\`: \`buffer.fill(0)\` clears it.`,
		ru: `Записывает \`value\` во все ячейки: \`buffer.fill(0)\` очищает буфер.`,
	},
	'arrayOf': {
		en: `An array of \`length\` copies of \`value\`: \`arrayOf(33, 0)\`. Every slot is the same \`value\` - for objects, give each slot its own.`,
		ru: `Массив из \`length\` копий \`value\`: \`arrayOf(33, 0)\`. Во всех ячейках одно и то же \`value\` — объектам дайте каждой ячейке свой.`,
	},
	'cell': {
		en: `Reads the number a native wrote through an \`out()\` buffer passed as a \`&reference\`.`,
		ru: `Читает число, которое натив записал в буфер \`out()\`, переданный как \`&ссылка\`.`,
	},
	'putCell': {
		en: `Puts a number in an \`out()\` buffer, for a reference a native reads as well as writes.`,
		ru: `Кладёт число в буфер \`out()\` — для ссылки, которую натив и читает, и пишет.`,
	},
	'noOrigin': {
		en: `
			An empty origin for a message sent to one player:

			  message_begin(MSG_ONE, msgid, noOrigin(), id);

			Only messages sent to players near a point read the origin.
		`,
		ru: `
			Пустая точка для сообщения одному игроку:

			  message_begin(MSG_ONE, msgid, noOrigin(), id);

			Точку читают только сообщения игрокам рядом с ней.
		`,
	},
	'TEXT_MAX': {
		en: `The length of text an \`out()\` buffer holds: \`255\`.`,
		ru: `Длина текста, который вмещает буфер \`out()\`: \`255\`.`,
	},
	'Team': {
		en: `A Counter-Strike team, by the name the game gives it: one of \`"TERRORIST"\`, \`"CT"\`, \`"SPECTATOR"\`, \`"UNASSIGNED"\`.`,
		ru: `Команда Counter-Strike под именем, которое даёт ей игра: одно из \`"TERRORIST"\`, \`"CT"\`, \`"SPECTATOR"\`, \`"UNASSIGNED"\`.`,
	},
	'WeaponName': {
		en: `A weapon a player can hold, by its class name, e.g. \`"weapon_ak47"\` or \`"weapon_knife"\`.`,
		ru: `Оружие, которое может держать игрок, по имени класса, например \`"weapon_ak47"\` или \`"weapon_knife"\`.`,
	},
	'ItemName': {
		en: `An item \`player.give\` hands over: a weapon, armour (\`"item_kevlar"\`, \`"item_assaultsuit"\`) or the defuse kit (\`"item_thighpack"\`).`,
		ru: `Предмет, который выдаёт \`player.give\`: оружие, броня (\`"item_kevlar"\`, \`"item_assaultsuit"\`) или набор сапёра (\`"item_thighpack"\`).`,
	},
	'ModuleName': {
		en: `An AMX Mod X module a plugin can check for, one of \`"reapi"\`, \`"cstrike"\`, \`"fun"\`, \`"hamsandwich"\`, \`"engine"\`, \`"fakemeta"\`.`,
		ru: `Модуль AMX Mod X, наличие которого плагин может проверить, — одно из \`"reapi"\`, \`"cstrike"\`, \`"fun"\`, \`"hamsandwich"\`, \`"engine"\`, \`"fakemeta"\`.`,
	},
	'hasModule': {
		en: `
			\`true\` when the server has the module: \`if (hasModule("reapi")) ...\`.
			Check it before a native that only one module has.

			Pawn: \`LibraryExists\`, \`module_exists\`
		`,
		ru: `
			\`true\`, если на сервере есть модуль: \`if (hasModule("reapi")) ...\`.
			Проверяйте перед нативом, который есть только в одном модуле.

			Pawn: \`LibraryExists\`, \`module_exists\`
		`,
	},
	'KillOptions': {
		en: `The options of \`player.kill()\`.`,
		ru: `Параметры \`player.kill()\`.`,
	},
	'KillOptions.keepFrags': {
		en: `Keeps the player's frags: no penalty for the suicide.`,
		ru: `Фраги игрока не меняются: штрафа за самоубийство нет.`,
	},
	'Client': {
		en: `
			A connecting player, in \`"connect"\`, \`"authorized"\` and \`"putinserver"\`: name,
			address, SteamID and team, but no health or weapons yet. Every Player is a
			Client too.

			\`\`\`ts
			server.addEventListener("putinserver", (event) => {
				print(event.player, \`Welcome, \${event.player.name}!\`);
			});
			\`\`\`
		`,
		ru: `
			Подключающийся игрок — в \`"connect"\`, \`"authorized"\` и \`"putinserver"\`: имя,
			адрес, SteamID и команда, но ещё без здоровья и оружия. Любой Player — тоже
			Client.

			\`\`\`ts
			server.addEventListener("putinserver", (event) => {
				print(event.player, \`Welcome, \${event.player.name}!\`);
			});
			\`\`\`
		`,
	},
	'Client.id': {
		en: `The player's slot, \`1\` to \`32\`.`,
		ru: `Слот игрока, от \`1\` до \`32\`.`,
	},
	'Client.name': {
		en: `The player's name.`,
		ru: `Имя игрока.`,
	},
	'Client.ip': {
		en: `The player's IP address without the port, e.g. \`"192.168.0.10"\`.`,
		ru: `IP-адрес игрока без порта, например \`"192.168.0.10"\`.`,
	},
	'Client.authid': {
		en: `The player's SteamID, e.g. \`"STEAM_0:1:12345"\`. A bot has \`"BOT"\`, HLTV has \`"HLTV"\`; until Steam confirms the player it is \`"STEAM_ID_PENDING"\` (wait for the \`"authorized"\` event), and on a LAN server \`"STEAM_ID_LAN"\`.`,
		ru: `SteamID игрока, например \`"STEAM_0:1:12345"\`. У бота — \`"BOT"\`, у HLTV — \`"HLTV"\`; пока Steam не подтвердил игрока — \`"STEAM_ID_PENDING"\` (дождитесь события \`"authorized"\`), на LAN-сервере — \`"STEAM_ID_LAN"\`.`,
	},
	'Client.isBot': {
		en: `\`true\` for a bot.`,
		ru: `\`true\`, если это бот.`,
	},
	'Client.isConnected': {
		en: `\`true\` while the player is on the server.`,
		ru: `\`true\`, пока игрок на сервере.`,
	},
	'Client.access': {
		en: `The player's admin rights, from the letters in \`users.ini\`: \`client.access.includes("Cvar")\`.`,
		ru: `Права админа у игрока — по буквам из \`users.ini\`: \`client.access.includes("Cvar")\`.`,
	},
	'Client.team': {
		en: `The player's team, one of \`"TERRORIST"\`, \`"CT"\`, \`"SPECTATOR"\` or \`"UNASSIGNED"\` (until the player joins a team). Setting it moves the player, as \`player.team\` does.`,
		ru: `Команда игрока, одно из \`"TERRORIST"\`, \`"CT"\`, \`"SPECTATOR"\` или \`"UNASSIGNED"\` (пока игрок ни в одну не вступил). Запись переводит игрока, как и \`player.team\`.`,
	},
	'Client.muted': {
		en: `\`true\` when nobody hears the player on the voice chat. Setting it mutes or unmutes him.`,
		ru: `\`true\`, если игрока никто не слышит в голосовом чате. Запись заглушает его или снимает заглушку.`,
	},
	'Client.joinTeam': {
		en: `Joins a side as the game joins a player who picks it in the team menu: \`client.joinTeam("CT")\`. \`false\` if the game refused.`,
		ru: `Вводит игрока в сторону так, как игра вводит того, кто выбрал её в меню команд: \`client.joinTeam("CT")\`. \`false\`, если игра отказала.`,
	},
	'Client.queryCvar': {
		en: `Asks the player's game for one of its cvars: \`await client.queryCvar("fps_max")\`, the value as text, or \`null\` when his game has none.`,
		ru: `Спрашивает у игры игрока один из её кваров: \`await client.queryCvar("fps_max")\` — значение текстом или \`null\`, если такого квара в его игре нет.`,
	},
	'Client.heardByEveryone': {
		en: `\`true\` when every player hears him on the voice chat, whatever the side.`,
		ru: `\`true\`, если в голосовом чате его слышат все игроки, с какой бы стороны они ни были.`,
	},
	'Client.hearsEveryone': {
		en: `\`true\` when he hears every player on the voice chat, whatever the side.`,
		ru: `\`true\`, если в голосовом чате он слышит всех игроков, с какой бы стороны они ни были.`,
	},
	'Client.language': {
		en: `The language the player reads the server's text in, e.g. \`"en"\`, \`"ru"\`: the one \`lang.translate\` picks for him.`,
		ru: `Язык, на котором игрок читает текст сервера, например \`"en"\`, \`"ru"\`: тот, что для него выбирает \`lang.translate\`.`,
	},
	'Client.signal': {
		en: `A signal that aborts when the player leaves the server: \`fetch(url, { signal: client.signal })\`.`,
		ru: `Сигнал, который срабатывает, когда игрок уходит с сервера: \`fetch(url, { signal: client.signal })\`.`,
	},
	'Client.command': {
		en: `Runs a command in the player's console, as if he had typed it: \`client.command("stop")\`.`,
		ru: `Выполняет команду в консоли игрока, будто он сам её набрал: \`client.command("stop")\`.`,
	},
	'Player': {
		en: `
			A player in the game: everything a Client has, plus health, armor, frags,
			weapons and the screen.

			An event about a player gives one as \`event.player\`; \`server.players\`
			lists everyone on the server.
		`,
		ru: `
			Игрок в игре: всё, что есть у Client, а также здоровье, броня, фраги,
			оружие и экран.

			Событие об игроке передаёт его как \`event.player\`; \`server.players\`
			возвращает всех на сервере.
		`,
	},
	'Player.name': {
		en: `
			The player's name.

			Pawn: \`get_user_name\`
		`,
		ru: `
			Имя игрока.

			Pawn: \`get_user_name\`
		`,
	},
	'Player.health': {
		en: `
			The player's health. \`100\` at spawn. Setting it to \`0\` or less kills the player.

			Pawn: \`get_user_health\`, \`set_user_health\`
		`,
		ru: `
			Здоровье игрока. При появлении \`100\`. Если записать \`0\` или меньше, игрок умрёт.

			Pawn: \`get_user_health\`, \`set_user_health\`
		`,
	},
	'Player.armor': {
		en: `
			The player's armor points: \`100\` with a bought vest, \`0\` without one.

			Pawn: \`get_user_armor\`, \`set_user_armor\`
		`,
		ru: `
			Броня игрока в очках: \`100\` с купленным бронежилетом, \`0\` без него.

			Pawn: \`get_user_armor\`, \`set_user_armor\`
		`,
	},
	'Player.frags': {
		en: `
			The player's frags on the scoreboard.

			Pawn: \`get_user_frags\`, \`set_user_frags\`
		`,
		ru: `
			Фраги игрока на табло.

			Pawn: \`get_user_frags\`, \`set_user_frags\`
		`,
	},
	'Player.deaths': {
		en: `
			The player's deaths on the scoreboard. Setting it updates the scoreboard
			at once.

			Pawn: \`cs_get_user_deaths\`, \`cs_set_user_deaths\`
		`,
		ru: `
			Смерти игрока на табло. Запись сразу обновляет табло.

			Pawn: \`cs_get_user_deaths\`, \`cs_set_user_deaths\`
		`,
	},
	'Player.team': {
		en: `
			The player's team, one of \`"TERRORIST"\`, \`"CT"\`, \`"SPECTATOR"\` or \`"UNASSIGNED"\`. Correct
			right after a team change too. Setting it moves the player.

			Pawn: \`cs_get_user_team\`, \`rg_set_user_team\`
		`,
		ru: `
			Команда игрока, одно из \`"TERRORIST"\`, \`"CT"\`, \`"SPECTATOR"\` или \`"UNASSIGNED"\`. Верна и
			сразу после смены команды. Запись переводит игрока.

			Pawn: \`cs_get_user_team\`, \`rg_set_user_team\`
		`,
	},
	'Player.ip': {
		en: `
			The player's IP address without the port, e.g. \`"192.168.0.10"\`.

			Pawn: \`get_user_ip\`
		`,
		ru: `
			IP-адрес игрока без порта, например \`"192.168.0.10"\`.

			Pawn: \`get_user_ip\`
		`,
	},
	'Player.authid': {
		en: `
			The player's SteamID, e.g. \`"STEAM_0:1:12345"\`. A bot has \`"BOT"\`, HLTV has \`"HLTV"\`; until Steam confirms the player it is \`"STEAM_ID_PENDING"\` (wait for the \`"authorized"\` event), and on a LAN server \`"STEAM_ID_LAN"\`.

			Pawn: \`get_user_authid\`
		`,
		ru: `
			SteamID игрока, например \`"STEAM_0:1:12345"\`. У бота — \`"BOT"\`, у HLTV — \`"HLTV"\`; пока Steam не подтвердил игрока — \`"STEAM_ID_PENDING"\` (дождитесь события \`"authorized"\`), на LAN-сервере — \`"STEAM_ID_LAN"\`.

			Pawn: \`get_user_authid\`
		`,
	},
	'Player.isAlive': {
		en: `
			\`true\` while the player is alive.

			Pawn: \`is_user_alive\`
		`,
		ru: `
			\`true\`, пока игрок жив.

			Pawn: \`is_user_alive\`
		`,
	},
	'Player.isConnected': {
		en: `
			\`true\` while the player is on the server.

			Pawn: \`is_user_connected\`
		`,
		ru: `
			\`true\`, пока игрок на сервере.

			Pawn: \`is_user_connected\`
		`,
	},
	'Player.isBot': {
		en: `
			\`true\` for a bot.

			Pawn: \`is_user_bot\`
		`,
		ru: `
			\`true\`, если это бот.

			Pawn: \`is_user_bot\`
		`,
	},
	'Player.signal': {
		en: `
			A signal that aborts when the player leaves the server, with an Error named
			\`"AbortError"\`; the next player in the slot gets a new one.

			\`\`\`ts
			const response = await fetch(url, { signal: player.signal });
			\`\`\`

			An async command handler or player event already runs under it: its
			\`await\`s stop quietly when the player leaves.
		`,
		ru: `
			Сигнал, который срабатывает, когда игрок уходит с сервера, с ошибкой
			(Error) по имени \`"AbortError"\`; следующий игрок в этом слоте получает новый.

			\`\`\`ts
			const response = await fetch(url, { signal: player.signal });
			\`\`\`

			Асинхронный обработчик команды или события игрока уже работает под ним:
			его \`await\` тихо прекращаются, когда игрок уходит.
		`,
	},
	'Player.muted': {
		en: `
			\`true\` when nobody hears the player on the voice chat, with alltalk or
			without. Setting it mutes or unmutes him; his other voice settings stay.

			Pawn: \`set_speak\`, \`SPEAK_MUTED\`
		`,
		ru: `
			\`true\`, если игрока никто не слышит в голосовом чате — с alltalk и без.
			Запись заглушает его или снимает заглушку; остальные настройки голоса
			остаются.

			Pawn: \`set_speak\`, \`SPEAK_MUTED\`
		`,
	},
	'Player.joinTeam': {
		en: `
			Joins a side the way the game joins a player who picks it in the team
			menu, appearance picked for him: \`player.joinTeam("CT")\`. A player who
			has just arrived is in the game after it and can spawn, which
			\`player.team = ...\` does not do for him. \`false\` if the game refused.

			Pawn: \`rg_join_team\`
		`,
		ru: `
			Вводит игрока в сторону так, как игра вводит того, кто выбрал её в меню
			команд, а внешность выбирается за него: \`player.joinTeam("CT")\`. Только
			что пришедший игрок после этого в игре и может появиться, чего
			\`player.team = ...\` для него не делает. \`false\`, если игра отказала.

			Pawn: \`rg_join_team\`
		`,
	},
	'Player.queryCvar': {
		en: `
			Asks the player's game for one of its cvars: \`await
			player.queryCvar("fps_max")\` is the value as text, e.g. \`"100"\`, or
			\`null\` when his game has no such cvar or will not tell. The answer is
			what his game says, a claim a cheat can change. A bot has no game to ask
			and answers \`null\` at once; when the player leaves before he answers, the
			promise is rejected with an \`"AbortError"\`.

			Pawn: \`query_client_cvar\`
		`,
		ru: `
			Спрашивает у игры игрока один из её кваров: \`await
			player.queryCvar("fps_max")\` — значение текстом, например \`"100"\`, или
			\`null\`, если такого квара в его игре нет или она его не называет. Ответ —
			то, что говорит его игра, заявление, которое чит может подменить. У бота
			игры нет, и он сразу отвечает \`null\`; если игрок уходит раньше ответа,
			промис отклоняется с \`"AbortError"\`.

			Pawn: \`query_client_cvar\`
		`,
	},
	'Player.language': {
		en: `
			The language the player reads the server's text in, e.g. \`"en"\`, \`"ru"\`:
			the one \`lang.translate\` picks for him. It is his \`setinfo lang\`, or the
			server's language when he has none or \`amx_client_languages\` is \`0\`.

			Pawn: \`get_user_info(id, "lang")\`, \`amx_language\`
		`,
		ru: `
			Язык, на котором игрок читает текст сервера, например \`"en"\`, \`"ru"\`:
			тот, что для него выбирает \`lang.translate\`. Это его \`setinfo lang\` или
			язык сервера, если своего у него нет или \`amx_client_languages\` равен \`0\`.

			Pawn: \`get_user_info(id, "lang")\`, \`amx_language\`
		`,
	},
	'Player.heardByEveryone': {
		en: `
			\`true\` when every player hears him on the voice chat, whatever the side
			and without alltalk. A mute (\`muted\`) still silences him.

			Pawn: \`set_speak\`, \`SPEAK_ALL\`
		`,
		ru: `
			\`true\`, если в голосовом чате его слышат все игроки, с какой бы стороны
			они ни были, и без alltalk. Заглушка (\`muted\`) всё равно его глушит.

			Pawn: \`set_speak\`, \`SPEAK_ALL\`
		`,
	},
	'Player.hearsEveryone': {
		en: `
			\`true\` when he hears every player on the voice chat, whatever the side
			and without alltalk: a spectator who hears both sides.

			Pawn: \`set_speak\`, \`SPEAK_LISTENALL\`
		`,
		ru: `
			\`true\`, если в голосовом чате он слышит всех игроков, с какой бы стороны
			они ни были, и без alltalk: зритель, который слышит обе стороны.

			Pawn: \`set_speak\`, \`SPEAK_LISTENALL\`
		`,
	},
	'Player.showHud': {
		en: `
			Shows a line of text on the player's screen:
			\`player.showHud("-35 HP", { color: [255, 40, 40], x: 0.02, y: 0.88, hold: 2 })\`.
			Every option has a default.

			Pawn: \`set_hudmessage\`, \`show_hudmessage\`
		`,
		ru: `
			Показывает строку текста на экране игрока:
			\`player.showHud("-35 HP", { color: [255, 40, 40], x: 0.02, y: 0.88, hold: 2 })\`.
			У каждой опции есть значение по умолчанию.

			Pawn: \`set_hudmessage\`, \`show_hudmessage\`
		`,
	},
	'Player.playSound': {
		en: `
			Plays a sound to the player alone, the way the radio does - heard as it
			is wherever he stands: \`player.playSound("vox/one.wav")\`. The path is
			under \`sound/\`, as \`server.precache\` takes it.

			Pawn: \`SendAudio\`, \`rg_send_audio\`
		`,
		ru: `
			Проигрывает звук одному игроку, как рация, — он слышит его одинаково,
			где бы ни стоял: \`player.playSound("vox/one.wav")\`. Путь — внутри
			\`sound/\`, как его принимает \`server.precache\`.

			Pawn: \`SendAudio\`, \`rg_send_audio\`
		`,
	},
	'Player.screen': {
		en: `The player's screen effects: \`player.screen.fade({ ... })\`, \`.shake(...)\`, \`.statusIcon(...)\` — see Screen.`,
		ru: `Эффекты на экране игрока: \`player.screen.fade({ ... })\`, \`.shake(...)\`, \`.statusIcon(...)\` — см. Screen.`,
	},
	'Player.give': {
		en: `
			Gives the player a weapon or an item: \`player.give("weapon_flashbang")\`.
			\`false\` if the game did not give it.

			Pawn: \`rg_give_item\`, \`give_item\`
		`,
		ru: `
			Выдаёт игроку оружие или предмет: \`player.give("weapon_flashbang")\`.
			\`false\`, если игра его не выдала.

			Pawn: \`rg_give_item\`, \`give_item\`
		`,
	},
	'Player.removeAllItems': {
		en: `
			Takes all the player's weapons away. The suit (armour, HUD) stays unless
			\`removeSuit\` is \`true\`.

			Pawn: \`rg_remove_all_items\`, \`strip_user_weapons\`
		`,
		ru: `
			Отбирает у игрока всё оружие. Костюм (броня, HUD) остаётся, если
			\`removeSuit\` не \`true\`.

			Pawn: \`rg_remove_all_items\`, \`strip_user_weapons\`
		`,
	},
	'Player.setAmmo': {
		en: `
			Sets the player's reserve ammo for a weapon he carries: \`player.setAmmo("weapon_flashbang", 2)\`.

			Pawn: \`rg_set_user_bpammo\`, \`cs_set_user_bpammo\`
		`,
		ru: `
			Задаёт запас патронов игрока к оружию, которое у него есть: \`player.setAmmo("weapon_flashbang", 2)\`.

			Pawn: \`rg_set_user_bpammo\`, \`cs_set_user_bpammo\`
		`,
	},
	'Player.getAmmo': {
		en: `
			The player's reserve ammo for a weapon he carries: \`player.getAmmo("weapon_ak47")\`;
			for a grenade, how many he has. \`0\` for a weapon he does not carry.

			Pawn: \`rg_get_user_bpammo\`, \`cs_get_user_bpammo\`
		`,
		ru: `
			Запас патронов игрока к оружию, которое у него есть: \`player.getAmmo("weapon_ak47")\`;
			для гранаты — сколько их у него. \`0\` для оружия, которого у него нет.

			Pawn: \`rg_get_user_bpammo\`, \`cs_get_user_bpammo\`
		`,
	},
	'Player.respawn': {
		en: `
			Respawns the player in the current round, at a spawn point the game picks.

			Pawn: \`rg_round_respawn\`
		`,
		ru: `
			Возрождает игрока в текущем раунде, на точке, которую выберет игра.

			Pawn: \`rg_round_respawn\`
		`,
	},
	'Player.kill': {
		en: `
			Kills the player, as the \`kill\` console command does. With
			\`{ keepFrags: true }\` the death costs no frags.

			Pawn: \`user_kill\`, \`user_silentkill\`
		`,
		ru: `
			Убивает игрока, как консольная команда \`kill\`. С
			\`{ keepFrags: true }\` смерть не отнимает фрагов.

			Pawn: \`user_kill\`, \`user_silentkill\`
		`,
	},
	'Player.access': {
		en: `
			The player's admin rights, from the letters in \`users.ini\`:
			\`player.access.includes("Cvar")\`.

			Pawn: \`get_user_flags\`
		`,
		ru: `
			Права админа у игрока — по буквам из \`users.ini\`:
			\`player.access.includes("Cvar")\`.

			Pawn: \`get_user_flags\`
		`,
	},
	'Player.switchWeapon': {
		en: `
			Puts a weapon the player carries into his hands. \`false\` if he does not
			have it.

			Pawn: \`rg_switch_weapon\`
		`,
		ru: `
			Даёт игроку в руки оружие, которое у него есть. \`false\`, если такого
			нет.

			Pawn: \`rg_switch_weapon\`
		`,
	},
	'Player.resetMaxSpeed': {
		en: `
			Recomputes the player's speed from the weapon in hand, after a slowdown for
			instance.

			Pawn: \`rg_reset_maxspeed\`
		`,
		ru: `
			Пересчитывает скорость игрока по оружию в руках — например, после
			замедления.

			Pawn: \`rg_reset_maxspeed\`
		`,
	},
	'Player.command': {
		en: `
			Runs a command in the player's own console, as if he had typed it:
			\`player.command("messagemode say_team")\`, \`player.command("stop")\`.
			The player's game runs it, not the server.

			Pawn: \`client_cmd\`
		`,
		ru: `
			Выполняет команду в консоли самого игрока, будто он набрал её сам:
			\`player.command("messagemode say_team")\`, \`player.command("stop")\`.
			Выполняет её игра игрока, а не сервер.

			Pawn: \`client_cmd\`
		`,
	},
	'readText': {
		en: `
			Calls a native that fills a text buffer and returns the text. The native
			itself is passed in:

			  readText(get_mapname)                 // "c21_kitty"
			  readText(get_user_name, 32, id)       // not this one: see Player.name
		`,
		ru: `
			Вызывает натив, заполняющий текстовый буфер, и возвращает текст. Сам
			натив передаётся аргументом:

			  readText(get_mapname)                 // "c21_kitty"
			  readText(get_user_name, 32, id)       // так не надо: для этого есть Player.name
		`,
	},
	'playerIds': {
		en: `
			The ids of the players on the server, as an array. \`flags\`: \`"a"\` living,
			\`"b"\` dead, \`"c"\` no bots, \`"h"\` no HLTV, \`"e"\` only \`team\`. \`server.players\` is
			everyone, as players, to filter as an array.

			Pawn: \`get_players\`
		`,
		ru: `
			\`id\` игроков на сервере в виде массива. \`flags\`: \`"a"\` живые, \`"b"\` мёртвые,
			\`"c"\` без ботов, \`"h"\` без HLTV, \`"e"\` только \`team\`. \`server.players\` — все,
			как игроки, их фильтруют как массив.

			Pawn: \`get_players\`
		`,
	},
	'CommandOptions': {
		en: `The options of a command: who may use it and its description in a listing.`,
		ru: `Параметры команды: кому она доступна и её описание в списке.`,
	},
	'CommandOptions.access': {
		en: `The admin right a player needs to use the command; left out, everyone may.`,
		ru: `Право админа, которое нужно игроку для команды; если не указано, команда доступна всем.`,
	},
	'CommandOptions.description': {
		en: `The command's description, shown by \`amx_help\` and in \`server.commands\`.`,
		ru: `Описание команды, которое показывают \`amx_help\` и \`server.commands\`.`,
	},
	'accessOf': {
		en: `
			Converts \`users.ini\` letters to rights: \`accessOf("abc")\` is
			[\`"Immunity"\`, \`"Reservation"\`, \`"Kick"\`]. An unknown letter is skipped.

			Pawn: \`read_flags\`
		`,
		ru: `
			Переводит буквы из \`users.ini\` в права: \`accessOf("abc")\` —
			[\`"Immunity"\`, \`"Reservation"\`, \`"Kick"\`]. Неизвестные буквы пропускаются.

			Pawn: \`read_flags\`
		`,
	},
	'HudOptions': {
		en: `
			The look of a HUD message. Every field has a default, so
			\`{ color: [255, 40, 40] }\` is enough.

			Pawn: \`set_hudmessage\`
		`,
		ru: `
			Вид HUD-сообщения. У каждого поля есть значение по умолчанию, так что
			\`{ color: [255, 40, 40] }\` достаточно.

			Pawn: \`set_hudmessage\`
		`,
	},
	'HudOptions.color': {
		en: `The text's colour: red, green, blue, \`0\` to \`255\` each.`,
		ru: `Цвет текста: красный, зелёный, синий, от \`0\` до \`255\`.`,
	},
	'HudOptions.x': {
		en: `The horizontal position: \`0\` is the left edge, \`1\` the right; \`-1\` centres the text.`,
		ru: `Положение по горизонтали: \`0\` — левый край, \`1\` — правый; \`-1\` — по центру.`,
	},
	'HudOptions.y': {
		en: `The vertical position: \`0\` is the top, \`1\` the bottom; \`-1\` centres the text.`,
		ru: `Положение по вертикали: \`0\` — верх, \`1\` — низ; \`-1\` — по центру.`,
	},
	'HudOptions.hold': {
		en: `The time the message stays on screen, in seconds.`,
		ru: `Время, которое сообщение держится на экране, в секундах.`,
	},
	'HudOptions.effect': {
		en: `The appearance effect, one of: \`"fade"\` in and out, \`"flicker"\`, or \`"typewriter"\` — letter by letter.`,
		ru: `Эффект появления, одно из: \`"fade"\` — плавно, \`"flicker"\` — мерцая, \`"typewriter"\` — по буквам.`,
	},
	'HudOptions.fadeIn': {
		en: `The fade-in time, in seconds.`,
		ru: `Время появления в секундах.`,
	},
	'HudOptions.fadeOut': {
		en: `The fade-out time, in seconds.`,
		ru: `Время исчезания в секундах.`,
	},
	'HudOptions.channel': {
		en: `The HUD channel, \`1\` to \`4\`; \`-1\` picks a free one.`,
		ru: `Канал HUD, от \`1\` до \`4\`; \`-1\` — выбрать свободный.`,
	},
	'HudOptions.effectTime': {
		en: `The duration of the \`"flicker"\` and \`"typewriter"\` effects, in seconds.`,
		ru: `Длительность эффектов \`"flicker"\` и \`"typewriter"\` в секундах.`,
	},
	'HudOptions.large': {
		en: `
			Large letters, for a result or a headline. They have no channels, so
			\`channel\` does not apply.

			Pawn: \`set_dhudmessage\`
		`,
		ru: `
			Крупные буквы — для итога или заголовка. Каналов у них нет, так что
			\`channel\` не действует.

			Pawn: \`set_dhudmessage\`
		`,
	},
	'HudEffect': {
		en: `A HUD message's appearance effect, one of: \`"fade"\` in and out, \`"flicker"\`, or \`"typewriter"\` — letter by letter.`,
		ru: `Эффект появления HUD-сообщения, одно из: \`"fade"\` — плавно, \`"flicker"\` — мерцая, \`"typewriter"\` — по буквам.`,
	},
	'HudLine': {
		en: `
			A HUD line for one message: showing a new one replaces the old instead of
			taking another channel — for a countdown redrawn every second, a warning
			that changes. \`clear\` removes it early.

			\`\`\`ts
			const countdown = new HudLine();
			countdown.show(player, \`\${left}\`, { color: [255, 50, 50], hold: 1.1 });
			countdown.clear(player);
			countdown.clearAll();
			\`\`\`

			Pawn: \`CreateHudSyncObj\`, \`ShowSyncHudMsg\`
		`,
		ru: `
			Строка HUD для одного сообщения: новое заменяет прежнее, а не занимает
			ещё один канал, — для обратного отсчёта, который перерисовывается каждую
			секунду, для меняющегося предупреждения. \`clear\` убирает его раньше
			времени.

			\`\`\`ts
			const countdown = new HudLine();
			countdown.show(player, \`\${left}\`, { color: [255, 50, 50], hold: 1.1 });
			countdown.clear(player);
			countdown.clearAll();
			\`\`\`

			Pawn: \`CreateHudSyncObj\`, \`ShowSyncHudMsg\`
		`,
	},
	'HudLine.show': {
		en: `Shows \`text\` to the player on this line, replacing what it showed him before.`,
		ru: `Показывает игроку \`text\` на этой строке вместо того, что она показывала ему раньше.`,
	},
	'HudLine.clear': {
		en: `Removes the line's message from the player's screen before its time is up.`,
		ru: `Убирает сообщение строки с экрана игрока раньше времени.`,
	},
	'HudLine.clearAll': {
		en: `Removes the line's message from every screen.`,
		ru: `Убирает сообщение строки со всех экранов.`,
	},
	'SoundChannel': {
		en: `
			The channel a sound plays on, one of \`"auto"\` (the default), \`"weapon"\`,
			\`"voice"\`, \`"item"\`, \`"body"\`, \`"stream"\`, \`"static"\`. A new sound on an
			entity's channel cuts the one playing there; \`"auto"\` never cuts.
		`,
		ru: `
			Канал, на котором играет звук, одно из \`"auto"\` (по умолчанию), \`"weapon"\`,
			\`"voice"\`, \`"item"\`, \`"body"\`, \`"stream"\`, \`"static"\`. Новый звук на канале
			сущности обрывает тот, что играет на нём; \`"auto"\` не обрывает никогда.
		`,
	},
	'SoundOptions': {
		en: `The options of \`entity.emitSound\`; every one has a default.`,
		ru: `Настройки \`entity.emitSound\`; у каждой есть значение по умолчанию.`,
	},
	'SoundOptions.channel': {
		en: `The entity's channel the sound plays on; \`"auto"\` by default.`,
		ru: `Канал сущности, на котором играет звук; по умолчанию \`"auto"\`.`,
	},
	'SoundOptions.volume': {
		en: `The volume, \`0\` to \`1\`; \`1\` by default.`,
		ru: `Громкость, от \`0\` до \`1\`; по умолчанию \`1\`.`,
	},
	'SoundOptions.attenuation': {
		en: `The sound's fall-off with distance: \`0\` is heard across the map, \`0.8\` (the default) as a footstep, \`2\` only close by.`,
		ru: `Затухание звука с расстоянием: \`0\` слышен по всей карте, \`0.8\` (по умолчанию) — как шаги, \`2\` — только вблизи.`,
	},
	'SoundOptions.pitch': {
		en: `The pitch in percent: \`100\` (the default) as recorded, \`50\` an octave lower, up to \`255\`.`,
		ru: `Высота в процентах: \`100\` (по умолчанию) — как записан, \`50\` — октавой ниже, до \`255\`.`,
	},
	'MessageArgs': {
		en: `
			The arguments of a message, by their place, \`0\` for the first: a number
			or a text, as the message wrote it.

			\`\`\`ts
			server.addEventListener("message:BotProgress", (event) => {
			  console.log(\`\${event.args.length} \${event.args.number(0)}\`);
			});
			\`\`\`

			Pawn: \`get_msg_args\`, \`get_msg_arg_*\`, \`set_msg_arg_*\`
		`,
		ru: `
			Аргументы сообщения по месту, \`0\` — первый: число или текст, как их
			записало сообщение.

			\`\`\`ts
			server.addEventListener("message:BotProgress", (event) => {
			  console.log(\`\${event.args.length} \${event.args.number(0)}\`);
			});
			\`\`\`

			Pawn: \`get_msg_args\`, \`get_msg_arg_*\`, \`set_msg_arg_*\`
		`,
	},
	'MessageArgs.length': {
		en: `The number of arguments.`,
		ru: `Число аргументов.`,
	},
	'MessageArgs.isText': {
		en: `Whether the argument at \`index\` is text; otherwise it is a number.`,
		ru: `Текст ли аргумент на месте \`index\`; иначе это число.`,
	},
	'MessageArgs.number': {
		en: `The argument at \`index\` as a number: a byte, a short, a coordinate, an angle.`,
		ru: `Аргумент на месте \`index\` как число: байт, short, координата, угол.`,
	},
	'MessageArgs.text': {
		en: `The argument at \`index\` as text.`,
		ru: `Аргумент на месте \`index\` как текст.`,
	},
	'MessageArgs.setNumber': {
		en: `Writes a number argument: the message goes out with it.`,
		ru: `Записывает числовой аргумент: сообщение уходит с ним.`,
	},
	'MessageArgs.setText': {
		en: `Writes a text argument: the message goes out with it.`,
		ru: `Записывает текстовый аргумент: сообщение уходит с ним.`,
	},
	'ClientMessage': {
		en: `
			A message the server sends its clients - a chat line, the round clock, a
			HUD icon - heard on its way, before it leaves:

			\`\`\`ts
			server.addEventListener("message:TextMsg", (event) => {
			  if (event.text == "#Round_Draw") event.preventDefault();
			});
			\`\`\`

			A message whose layout is known has a typed field for each argument
			(\`event.text\`), and writing one changes what the client gets; a message
			without a known layout is read by place, through \`event.args\`, which
			every message has.

			Pawn: \`register_message\`
		`,
		ru: `
			Сообщение, которое сервер шлёт клиентам, — строка чата, часы раунда, значок
			HUD, — услышанное по пути, до того как оно ушло:

			\`\`\`ts
			server.addEventListener("message:TextMsg", (event) => {
			  if (event.text == "#Round_Draw") event.preventDefault();
			});
			\`\`\`

			У сообщения с известной раскладкой на каждый аргумент есть типизированное
			поле (\`event.text\`), и запись в него меняет то, что получит клиент;
			сообщение без известной раскладки читается по месту, через \`event.args\`,
			которые есть у любого сообщения.

			Pawn: \`register_message\`
		`,
	},
	'ClientMessage.name': {
		en: `The message's name, e.g. \`"TextMsg"\`.`,
		ru: `Имя сообщения, например \`"TextMsg"\`.`,
	},
	'ClientMessage.player': {
		en: `The player the message goes to; \`null\` for a message to everyone.`,
		ru: `Игрок, которому идёт сообщение; \`null\` — сообщение всем.`,
	},
	'ClientMessage.args': {
		en: `The message's arguments, by their place: \`event.args.text(1)\`.`,
		ru: `Аргументы сообщения по месту: \`event.args.text(1)\`.`,
	},
	'ClientMessage.preventDefault': {
		en: `
			Stops the message: the client does not get it.

			Pawn: \`return PLUGIN_HANDLED\`
		`,
		ru: `
			Останавливает сообщение: клиент его не получит.

			Pawn: \`return PLUGIN_HANDLED\`
		`,
	},
	'Resource': {
		en: `
			A file the game has precached - a sprite, a model, a sound - as
			\`server.precache\` returns it. An effect takes it where it draws a sprite or
			a model:

			\`\`\`ts
			const shock = server.precache("sprites/shockwave.spr");
			effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60 });
			\`\`\`
		`,
		ru: `
			Файл, который игра прекэшировала, — спрайт, модель, звук, — как его
			возвращает \`server.precache\`. Эффект принимает его там, где рисует спрайт
			или модель:

			\`\`\`ts
			const shock = server.precache("sprites/shockwave.spr");
			effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60 });
			\`\`\`
		`,
	},
	'Resource.path': {
		en: `The file's path, as \`server.precache\` was given it, e.g. \`"sprites/shockwave.spr"\`.`,
		ru: `Путь к файлу, как его получил \`server.precache\`, например \`"sprites/shockwave.spr"\`.`,
	},
	'Resource.index': {
		en: `
			The file's index in the game's precache list, as a native takes it; \`0\`
			while it is not precached.
		`,
		ru: `
			Индекс файла в списке прекэша игры, как его принимает натив; \`0\`, пока
			файл не прекэширован.
		`,
	},
	'FadeDirection': {
		en: `A fade's direction, one of: \`"in"\` from the colour to a clear view, \`"out"\` from a clear view to the colour.`,
		ru: `Направление затемнения, одно из: \`"in"\` — от цвета к чистому экрану, \`"out"\` — от чистого экрана к цвету.`,
	},
	'FadeOptions': {
		en: `The options of \`player.screen.fade\`. Times are in seconds.`,
		ru: `Параметры \`player.screen.fade\`. Время — в секундах.`,
	},
	'FadeOptions.color': {
		en: `The colour: red, green, blue and alpha, \`0\` to \`255\` each; black by default.`,
		ru: `Цвет: красный, зелёный, синий и альфа, от \`0\` до \`255\`; по умолчанию чёрный.`,
	},
	'FadeOptions.duration': {
		en: `The fade's duration, in seconds; \`1\` by default.`,
		ru: `Длительность перехода в секундах; по умолчанию \`1\`.`,
	},
	'FadeOptions.hold': {
		en: `The time the full colour holds, in seconds; \`0\` by default.`,
		ru: `Время, которое держится полный цвет, в секундах; по умолчанию \`0\`.`,
	},
	'FadeOptions.direction': {
		en: `The fade's direction, one of: \`"in"\` (the default) from the colour to a clear view, \`"out"\` from a clear view to the colour.`,
		ru: `Направление затемнения, одно из: \`"in"\` (по умолчанию) — от цвета к чистому экрану, \`"out"\` — от чистого экрана к цвету.`,
	},
	'FadeOptions.stay': {
		en: `Keeps the colour on the screen until the next fade.`,
		ru: `Цвет остаётся на экране до следующего затемнения.`,
	},
	'FadeOptions.modulate': {
		en: `Tints what is on the screen rather than painting over it.`,
		ru: `Тонирует изображение на экране, а не закрашивает его.`,
	},
	'ShakeOptions': {
		en: `The options of \`player.screen.shake\`.`,
		ru: `Параметры \`player.screen.shake\`.`,
	},
	'ShakeOptions.amplitude': {
		en: `The shake's strength: how far the view moves, up to 16 units; \`4\` by default.`,
		ru: `Сила тряски: насколько смещается вид, до 16 единиц; по умолчанию \`4\`.`,
	},
	'ShakeOptions.duration': {
		en: `The shake's duration, in seconds; \`1\` by default.`,
		ru: `Длительность тряски в секундах; по умолчанию \`1\`.`,
	},
	'ShakeOptions.frequency': {
		en: `The shake's frequency, in jolts a second; \`5\` by default.`,
		ru: `Частота тряски — толчков в секунду; по умолчанию \`5\`.`,
	},
	'StatusIconState': {
		en: `A status icon's state, one of \`"hide"\`, \`"show"\` (lit) or \`"flash"\`.`,
		ru: `Состояние иконки статуса, одно из: \`"hide"\` — убрана, \`"show"\` — горит, \`"flash"\` — мигает.`,
	},
	'Screen': {
		en: `
			The effects one player sees over the world: fades, shakes, status icons and
			the parts of the HUD the game draws itself.

			\`\`\`ts
			player.screen.fade({ color: [0, 0, 0, 255], duration: 0.5, hold: 1, stay: true });
			player.screen.shake({ amplitude: 8, duration: 1, frequency: 5 });
			player.screen.statusIcon("dmg_cold", "show", [0, 160, 255]);
			\`\`\`

			Times are in seconds.

			Pawn: \`ScreenFade\`, \`ScreenShake\`, \`StatusIcon\`, ...
		`,
		ru: `
			Эффекты, которые один игрок видит поверх мира: затемнение, тряска, иконки
			статуса и части HUD, которые рисует сама игра.

			\`\`\`ts
			player.screen.fade({ color: [0, 0, 0, 255], duration: 0.5, hold: 1, stay: true });
			player.screen.shake({ amplitude: 8, duration: 1, frequency: 5 });
			player.screen.statusIcon("dmg_cold", "show", [0, 160, 255]);
			\`\`\`

			Время — в секундах.

			Pawn: \`ScreenFade\`, \`ScreenShake\`, \`StatusIcon\`, ...
		`,
	},
	'Screen.fade': {
		en: `
			Colours the player's screen, fading in or out.

			Pawn: \`ScreenFade\`
		`,
		ru: `
			Окрашивает экран игрока с плавным переходом.

			Pawn: \`ScreenFade\`
		`,
	},
	'Screen.shake': {
		en: `
			Shakes the player's view.

			Pawn: \`ScreenShake\`
		`,
		ru: `
			Трясёт экран игрока.

			Pawn: \`ScreenShake\`
		`,
	},
	'Screen.statusIcon': {
		en: `
			Shows, flashes or hides a status icon by its sprite name (\`"dmg_cold"\`,
			\`"buyzone"\`, \`"c4"\`, ...), in a colour.

			Pawn: \`StatusIcon\`
		`,
		ru: `
			Зажигает, заставляет мигать или убирает иконку статуса по имени спрайта
			(\`"dmg_cold"\`, \`"buyzone"\`, \`"c4"\`, ...), в заданном цвете.

			Pawn: \`StatusIcon\`
		`,
	},
	'Screen.roundTime': {
		en: `
			Sets the round clock at the top of the player's HUD, in seconds. Sent
			unreliably, as the game does: a client with a lagging connection may skip
			it.

			Pawn: \`RoundTime\`
		`,
		ru: `
			Выставляет таймер раунда вверху HUD игрока, в секундах. Отправляется
			ненадёжно, как это делает сама игра: клиент с плохим соединением может
			его пропустить.

			Pawn: \`RoundTime\`
		`,
	},
	'Screen.hideHud': {
		en: `
			Hides parts of the player's HUD right now. Setting \`player.hideHud\` does
			the same a frame later; this is for when that is too late.

			Pawn: \`HideWeapon\`
		`,
		ru: `
			Сразу скрывает части HUD игрока. Запись \`player.hideHud\` делает то же
			кадром позже; этот метод — для случаев, когда это уже поздно.

			Pawn: \`HideWeapon\`
		`,
	},
	'Screen.crosshair': {
		en: `
			Shows or hides Counter-Strike's own crosshair on the player's screen.

			Pawn: \`Crosshair\`
		`,
		ru: `
			Показывает или скрывает стандартный прицел Counter-Strike на экране игрока.

			Pawn: \`Crosshair\`
		`,
	},
	'Screen.flashlight': {
		en: `
			Sets the flashlight icon on the player's HUD: on or off, and the battery in
			percent.

			Pawn: \`Flashlight\`
		`,
		ru: `
			Выставляет иконку фонарика на HUD игрока: включён или выключен и заряд
			батареи в процентах.

			Pawn: \`Flashlight\`
		`,
	},
	'Screen.progressBar': {
		en: `
			Shows the progress bar in the middle of the player's screen, filling up
			over \`seconds\`; \`0\` hides it.

			Pawn: \`BarTime\`, \`rg_send_bartime\`
		`,
		ru: `
			Показывает полосу прогресса посреди экрана игрока, которая заполняется за
			\`seconds\` секунд; \`0\` её убирает.

			Pawn: \`BarTime\`, \`rg_send_bartime\`
		`,
	},
	'PlayerChangeEvent': {
		en: `
			A field plugins added to \`Player\` changed on a player - written by any
			plugin, TypeScript or Pawn:

			\`\`\`ts
			server.addEventListener("playerchange", (event) => {
			  print(event.player, event.value ? "You are protected" : "Your spawn protection is over");
			}, { field: "spawnProtected" });
			\`\`\`

			With \`field\`, \`event.value\` and \`event.previous\` have the field's type; a
			named listener takes \`PlayerChangeEvent<"spawnProtected">\`. Without it
			every field is heard, and \`event.field\` says which.
		`,
		ru: `
			У игрока изменилось поле, которое плагины добавили в \`Player\`, — его
			записал любой плагин, на TypeScript или Pawn:

			\`\`\`ts
			server.addEventListener("playerchange", (event) => {
			  print(event.player, event.value ? "You are protected" : "Your spawn protection is over");
			}, { field: "spawnProtected" });
			\`\`\`

			С \`field\` у \`event.value\` и \`event.previous\` тип поля; именованный
			обработчик принимает \`PlayerChangeEvent<"spawnProtected">\`. Без него
			слышно любое поле, а какое — говорит \`event.field\`.
		`,
	},
	'PlayerChangeEvent.field': {
		en: `The field that changed, e.g. \`"spawnProtected"\`; a member of an object field is dotted, \`"glow.enabled"\`.`,
		ru: `Поле, которое изменилось, например \`"spawnProtected"\`; член поля-объекта — через точку, \`"glow.enabled"\`.`,
	},
	'PlayerChangeEvent.player': {
		en: `The player whose field changed.`,
		ru: `Игрок, у которого изменилось поле.`,
	},
	'ServerListenerOptions': {
		en: `The third argument of \`server.addEventListener\`.`,
		ru: `Третий аргумент \`server.addEventListener\`.`,
	},
	'ServerListenerOptions.field': {
		en: `
			For \`"playerchange"\`: the field listened for, e.g. \`"spawnProtected"\`, or
			an object field's member, \`"glow.enabled"\`; an object field's name
			hears each of its members. Left out, every field.
		`,
		ru: `
			Для \`"playerchange"\`: поле, которое слушают, например \`"spawnProtected"\`,
			или член поля-объекта, \`"glow.enabled"\`; имя поля-объекта слышит
			каждый его член. Без него — любое поле.
		`,
	},
	'CvarChangeEvent': {
		en: `The event a cvar's change listener receives: the cvar, its old and its new value.`,
		ru: `Событие, которое получает обработчик изменения квара: квар, старое и новое значение.`,
	},
	'CvarChangeEvent.cvar': {
		en: `The cvar that changed.`,
		ru: `Квар, который изменился.`,
	},
	'CvarChangeEvent.oldValue': {
		en: `The cvar's value before the change, as text.`,
		ru: `Значение квара до изменения, текстом.`,
	},
	'CvarChangeEvent.value': {
		en: `The cvar's new value, as text.`,
		ru: `Новое значение квара, текстом.`,
	},
	'CvarListener': {
		en: `A cvar's change listener: \`(event) => ...\`, with the old and the new value in \`event\`.`,
		ru: `Обработчик изменения квара: \`(event) => ...\`; старое и новое значение — в \`event\`.`,
	},
	'Cvar': {
		en: `
			A server cvar, read and written like an input's \`value\`:

			\`\`\`ts
			const freeze = new Cvar("mp_freezetime");
			freeze.number = 5;
			const speed = new Cvar("my_speed", "250");     // made with 250 if it does not exist
			speed.addEventListener("change", (event) => console.log(\`\${event.oldValue} -> \${event.value}\`));
			\`\`\`

			\`value\` is the cvar's text; \`number\` and \`boolean\` read and write the same
			cvar as a number and as an on/off switch.

			Pawn: \`get_cvar_pointer\`, \`create_cvar\`, \`get_pcvar_string\`, \`set_pcvar_num\`, \`hook_cvar_change\`
		`,
		ru: `
			Квар сервера; читается и пишется, как \`value\` у поля ввода:

			\`\`\`ts
			const freeze = new Cvar("mp_freezetime");
			freeze.number = 5;
			const speed = new Cvar("my_speed", "250");     // создаётся со значением 250, если его нет
			speed.addEventListener("change", (event) => console.log(\`\${event.oldValue} -> \${event.value}\`));
			\`\`\`

			\`value\` — текст квара; \`number\` и \`boolean\` читают и пишут тот же квар как
			число и как переключатель.

			Pawn: \`get_cvar_pointer\`, \`create_cvar\`, \`get_pcvar_string\`, \`set_pcvar_num\`, \`hook_cvar_change\`
		`,
	},
	'Cvar.pointer': {
		en: `
			The cvar's handle in the engine; \`0\` when the server has no such cvar.

			Pawn: \`get_cvar_pointer\`
		`,
		ru: `
			Хэндл квара в движке; \`0\`, если такого квара на сервере нет.

			Pawn: \`get_cvar_pointer\`
		`,
	},
	'Cvar.name': {
		en: `The cvar's name, as the console knows it, e.g. \`"mp_timelimit"\`.`,
		ru: `Имя квара, как его знает консоль, например \`"mp_timelimit"\`.`,
	},
	'Cvar.attach': {
		en: `
			@internal Finds or creates the cvar and starts hearing its changes. A Cvar
			made at the top level of a plugin waits for \`plugin_init\`: creating a cvar
			while plugins are still loading takes the server down.
		`,
		ru: `
			@internal Находит или создаёт квар и начинает слушать его изменения. Cvar,
			созданный на верхнем уровне плагина, ждёт \`plugin_init\`: создание квара, пока
			плагины ещё загружаются, роняет сервер.
		`,
	},
	'Cvar.exists': {
		en: `\`true\` when the server has this cvar.`,
		ru: `\`true\`, если такой квар есть на сервере.`,
	},
	'Cvar.value': {
		en: `The cvar's value as text, e.g. \`"250"\`.`,
		ru: `Значение квара текстом, например \`"250"\`.`,
	},
	'Cvar.number': {
		en: `The cvar's value as a number. A whole number is written without a fraction: \`"5"\`, not \`"5.000000"\`.`,
		ru: `Значение квара числом. Число без дробной части так и записывается: \`"5"\`, а не \`"5.000000"\`.`,
	},
	'Cvar.boolean': {
		en: `The cvar as an on/off switch: \`true\` for anything but \`0\`. Writing \`true\` sets \`1\`, \`false\` sets \`0\`.`,
		ru: `Квар как переключатель: \`true\` при любом значении, кроме \`0\`. Запись \`true\` ставит \`1\`, \`false\` — \`0\`.`,
	},
	'Cvar.addEventListener': {
		en: `Calls \`listener\` whenever the cvar's value changes.`,
		ru: `Вызывает \`listener\` при каждом изменении значения квара.`,
	},
	'Cvar.removeEventListener': {
		en: `Stops calling a listener added with \`addEventListener\`.`,
		ru: `Перестаёт вызывать обработчик, добавленный через \`addEventListener\`.`,
	},
	'Cvar.dispatch': {
		en: `@internal Calls the change listeners; the server does it when the cvar changes. A plugin listens with \`addEventListener\`.`,
		ru: `@internal Вызывает обработчики изменения; это делает сервер, когда квар меняется. Плагин слушает через \`addEventListener\`.`,
	},
	'Server': {
		en: `
			The server, an event target like the DOM's: its events, commands, map and
			the folders AMX Mod X keeps. Used through \`server\`:

			\`\`\`ts
			server.addEventListener("putinserver", (event) => {
			  print(event.player, "Welcome!");      // event is a PutinserverEvent
			});
			server.map;                             // "de_dust2"
			server.maxPlayers;                      // 32
			server.command("echo hi");
			\`\`\`

			The event's name is written out as a string: the editor completes it and
			hands the listener the event's own type. A listener may use the variables
			of the function it is written in - it is a closure, as in JavaScript.
		`,
		ru: `
			Сервер — цель событий, как в DOM: его события, команды, карта и папки
			AMX Mod X. Используется через \`server\`:

			\`\`\`ts
			server.addEventListener("putinserver", (event) => {
			  print(event.player, "Welcome!");      // event — это PutinserverEvent
			});
			server.map;                             // "de_dust2"
			server.maxPlayers;                      // 32
			server.command("echo hi");
			\`\`\`

			Имя события пишется строкой: редактор его подсказывает и передаёт
			обработчику собственный тип события. Обработчик может пользоваться
			переменными функции, в которой он написан, — это замыкание, как в JavaScript.
		`,
	},
	'Server.addEventListener': {
		en: `
			Calls \`listener\` every time the server raises the event \`type\` - or,
			for \`"message:<Name>"\`, every time it sends that message to a client.
			\`"playerchange"\` takes the field it is for: \`{ field: "spawnProtected" }\`.
		`,
		ru: `
			Вызывает \`listener\` каждый раз, когда сервер поднимает событие \`type\`, —
			или, для \`"message:<Name>"\`, каждый раз, когда он шлёт это сообщение клиенту.
			\`"playerchange"\` принимает поле, для которого он: \`{ field: "spawnProtected" }\`.
		`,
	},
	'Server.removeEventListener': {
		en: `Stops calling a listener added with \`addEventListener\` - the same function and the same options.`,
		ru: `Перестаёт вызывать обработчик, добавленный через \`addEventListener\`, — ту же функцию с теми же настройками.`,
	},
	'Server.map': {
		en: `
			The current map's name, e.g. \`"de_dust2"\`.

			Pawn: \`get_mapname\`
		`,
		ru: `
			Имя текущей карты, например \`"de_dust2"\`.

			Pawn: \`get_mapname\`
		`,
	},
	'Server.maxPlayers': {
		en: `
			The number of player slots on the server, e.g. \`32\`.

			Pawn: \`get_maxplayers\`
		`,
		ru: `
			Число слотов для игроков на сервере, например \`32\`.

			Pawn: \`get_maxplayers\`
		`,
	},
	'Server.players': {
		en: `
			The players on the server, every one connected - never an HLTV proxy -
			read anew each time. Narrow them with the array's \`filter\`:

			\`\`\`ts
			const alive = server.players.filter(player => player.isAlive);
			const cts = server.players.filter(player => player.team === "CT" && !player.isBot);
			\`\`\`

			Pawn: \`get_players\`
		`,
		ru: `
			Игроки на сервере, все подключённые, кроме HLTV-прокси; читается заново
			при каждом обращении. Выборку сужает \`filter\` массива:

			\`\`\`ts
			const alive = server.players.filter(player => player.isAlive);
			const cts = server.players.filter(player => player.team === "CT" && !player.isBot);
			\`\`\`

			Pawn: \`get_players\`
		`,
	},
	'Server.configsDir': {
		en: `
			The AMX Mod X configs folder, relative to the game folder, as \`fs\` takes it:
			\`addons/amxmodx/configs\` unless the server moved it.

			\`\`\`ts
			const text = fs.readFileSync(\`\${server.configsDir}/myplugin.ini\`);
			\`\`\`

			Pawn: \`get_configsdir\`
		`,
		ru: `
			Папка конфигов AMX Mod X относительно папки игры — в том виде, в каком её
			принимает \`fs\`: \`addons/amxmodx/configs\`, если сервер её не перенёс.

			\`\`\`ts
			const text = fs.readFileSync(\`\${server.configsDir}/myplugin.ini\`);
			\`\`\`

			Pawn: \`get_configsdir\`
		`,
	},
	'Server.dataDir': {
		en: `
			The AMX Mod X folder for plugins' data files: \`addons/amxmodx/data\` unless the server moved it.

			Pawn: \`get_datadir\`
		`,
		ru: `
			Папка AMX Mod X для файлов данных плагинов: \`addons/amxmodx/data\`, если сервер её не перенёс.

			Pawn: \`get_datadir\`
		`,
	},
	'Server.command': {
		en: `
			Runs a command in the server console, as if typed there:
			\`server.command("changelevel de_dust2")\`. The text goes as it is: a \`%\` stays a \`%\`.

			Pawn: \`server_cmd\`
		`,
		ru: `
			Выполняет команду в консоли сервера, как если бы её ввели там:
			\`server.command("changelevel de_dust2")\`. Текст уходит как есть: \`%\` остаётся \`%\`.

			Pawn: \`server_cmd\`
		`,
	},
	'Server.showHud': {
		en: `Shows a HUD message to every player, with the same options as \`player.showHud\`.`,
		ru: `Показывает HUD-сообщение всем игрокам, с теми же настройками, что у \`player.showHud\`.`,
	},
	'Server.precache': {
		en: `
			Precaches a file, so the game can use it and players download it:
			\`const shock = server.precache("sprites/shockwave.spr")\`. At the top level
			of the file it is precached when the map loads; in the \`"precache"\` event,
			at once. A sound is written as the game plays it, under \`sound/\`:
			\`"myplugin/hit.wav"\`. Returns the file as a \`Resource\` - what an effect
			takes for a sprite or a model.

			Pawn: \`precache_model\`, \`precache_sound\`, \`precache_generic\`
		`,
		ru: `
			Прекэширует файл, чтобы игра могла им пользоваться, а игроки его скачали:
			\`const shock = server.precache("sprites/shockwave.spr")\`. На верхнем уровне
			файла он прекэшируется, когда грузится карта; в событии \`"precache"\` —
			сразу. Звук пишется так, как его играет игра, — внутри \`sound/\`:
			\`"myplugin/hit.wav"\`. Возвращает файл как \`Resource\` — то, что эффект
			принимает вместо спрайта или модели.

			Pawn: \`precache_model\`, \`precache_sound\`, \`precache_generic\`
		`,
	},
	'server': {
		en: `The server the plugin runs on: its events, commands and map.`,
		ru: `Сервер, на котором работает плагин: его события, команды и карта.`,
	},
	'Game': {
		en: `
			The game's events (reapi hookchains and Ham Sandwich functions) and round
			control, as an event target like the DOM's:

			\`\`\`ts
			game.addEventListener("takeDamage", (event) => {
			  if (event.player.isBot) event.preventDefault();
			});
			game.addEventListener("canPlayerHearPlayer", (event) => event.listener.team == event.sender.team);
			game.addEventListener("flPlayerFallDamage", (event) => event.result / 2, true);
			\`\`\`

			The event's type follows from its name. What a listener returns is the
			answer to the game: before the game acts it replaces what the game would
			do, after it (\`post\`) it replaces the result. A listener that returns
			nothing leaves it to the game; \`event.preventDefault()\` blocks without an
			answer. A value of the wrong type is an error in the editor and in the build.

			The game rules are its fields: \`game.freezePeriod\`, \`game.numCtWins\`,
			\`game.roundWinner\`.

			Pawn: \`RegisterHookChain\`, \`RegisterHam\`, \`get_member_game\`
		`,
		ru: `
			События игры (hookchain'ы reapi и функции Ham Sandwich) и управление
			раундом — цель событий, как в DOM:

			\`\`\`ts
			game.addEventListener("takeDamage", (event) => {
			  if (event.player.isBot) event.preventDefault();
			});
			game.addEventListener("canPlayerHearPlayer", (event) => event.listener.team == event.sender.team);
			game.addEventListener("flPlayerFallDamage", (event) => event.result / 2, true);
			\`\`\`

			Тип события следует из его имени. То, что возвращает обработчик, — ответ
			игре: до действия игры он заменяет то, что игра сделала бы, после (\`post\`) —
			её результат. Обработчик, который ничего не возвращает, оставляет решение
			игре; \`event.preventDefault()\` блокирует без ответа. Значение не того типа —
			ошибка и в редакторе, и при сборке.

			Правила игры — её поля: \`game.freezePeriod\`, \`game.numCtWins\`,
			\`game.roundWinner\`.

			Pawn: \`RegisterHookChain\`, \`RegisterHam\`, \`get_member_game\`
		`,
	},
	'Game.addEventListener': {
		en: `
			Calls \`listener\` every time the game runs \`type\`. With \`true\` - or
			\`{ post: true }\` - it runs after the game has acted, with the game's answer
			in \`event.result\`; by default it runs before and can stop it.
			\`classname\` narrows it to one class of entity, and only that class's
			reach the plugin: \`{ classname: "weapon_knife" }\`. A \`"touch"\` listener
			takes the classes it is about instead: \`{ toucher: "player", touched: "player" }\`.

			Pawn: \`RegisterHookChain\`, \`RegisterHam\`, \`register_touch\`
		`,
		ru: `
			Вызывает \`listener\` каждый раз, когда игра выполняет \`type\`. С \`true\` —
			или \`{ post: true }\` — после того как игра сделала своё, с её ответом в
			\`event.result\`; по умолчанию — до этого, и может её остановить.
			\`classname\` сужает его до одного класса сущностей, и до плагина доходят
			только они: \`{ classname: "weapon_knife" }\`. Обработчик \`"touch"\` вместо
			этого берёт классы, о которых речь: \`{ toucher: "player", touched: "player" }\`.

			Pawn: \`RegisterHookChain\`, \`RegisterHam\`, \`register_touch\`
		`,
	},
	'Game.removeEventListener': {
		en: `Stops calling a listener added with \`addEventListener\` - the same function and the same options.`,
		ru: `Перестаёт вызывать обработчик, добавленный через \`addEventListener\`, — ту же функцию с теми же настройками.`,
	},
	'Game.time': {
		en: `
			The game's clock: seconds since the map started. Entity fields that hold a
			moment - \`nextThink\`, \`damageTime\` - are on it:
			\`grenade.damageTime = game.time + 1\`. The attack timers - a weapon's
			\`nextPrimaryAttack\`, a player's \`nextAttack\` - count from now instead:
			\`weapon.nextPrimaryAttack = 1\` is a second away.

			Pawn: \`get_gametime\`
		`,
		ru: `
			Часы игры: секунды с начала карты. Поля сущностей, которые хранят момент, —
			\`nextThink\`, \`damageTime\` — идут по ним:
			\`grenade.damageTime = game.time + 1\`. Таймеры атаки — \`nextPrimaryAttack\`
			оружия, \`nextAttack\` игрока — считаются от текущего момента:
			\`weapon.nextPrimaryAttack = 1\` — это через секунду.

			Pawn: \`get_gametime\`
		`,
	},
	'Game.endRound': {
		en: `
			Ends the round now:

			\`\`\`ts
			game.endRound({ winner: "TERRORIST" });                 // terrorists win, next round in 5 s
			game.endRound({ winner: "draw", delay: 3 });            // a draw, next round in 3 s
			game.endRound({ winner: "none", message: "" });         // a quiet restart: no message
			\`\`\`

			The winner sets the score, the message and the sound (\`"Terrorists Win!"\`);
			\`message\` and \`sound\` replace them, \`""\` turns them off.

			Pawn: \`rg_round_end\`
		`,
		ru: `
			Завершает раунд сейчас:

			\`\`\`ts
			game.endRound({ winner: "TERRORIST" });                 // победа террористов, следующий раунд через 5 с
			game.endRound({ winner: "draw", delay: 3 });            // ничья, следующий раунд через 3 с
			game.endRound({ winner: "none", message: "" });         // тихий рестарт: без сообщения
			\`\`\`

			Победитель определяет счёт, сообщение и звук (\`"Terrorists Win!"\`);
			\`message\` и \`sound\` заменяют их, \`""\` — выключает.

			Pawn: \`rg_round_end\`
		`,
	},
	'GameListenerOptions': {
		en: `
			The third argument of \`game.addEventListener\`: \`true\` stands for
			\`{ post: true }\`; a \`"touch"\` listener names the classes it is about.
		`,
		ru: `
			Третий аргумент \`game.addEventListener\`: \`true\` означает
			\`{ post: true }\`; обработчик \`"touch"\` называет классы, о которых речь.
		`,
	},
	'GameListenerOptions.post': {
		en: `Runs the listener after the game has acted, with its answer in \`event.result\`.`,
		ru: `Вызывает обработчик после того, как игра сделала своё, с её ответом в \`event.result\`.`,
	},
	'GameListenerOptions.classname': {
		en: `The class of entity the event is listened for on, e.g. \`"weapon_knife"\`: only its entities reach the listener.`,
		ru: `Класс сущностей, на котором слушается событие, например \`"weapon_knife"\`: до обработчика доходят только его сущности.`,
	},
	'UseType': {
		en: `
			The way one entity uses another - a button pressed, a door opened - one of
			\`"off"\`, \`"on"\`, \`"set"\` or \`"toggle"\`.

			Pawn: \`USE_OFF\`, \`USE_ON\`, \`USE_SET\`, \`USE_TOGGLE\`
		`,
		ru: `
			Способ, которым одна сущность использует другую, — нажимает кнопку, открывает
			дверь, — одно из \`"off"\`, \`"on"\`, \`"set"\` или \`"toggle"\`.

			Pawn: \`USE_OFF\`, \`USE_ON\`, \`USE_SET\`, \`USE_TOGGLE\`
		`,
	},
	'ActionOptions': {
		en: `The options of an entity's action such as \`weapon.deploy()\` or \`entity.takeHealth(...)\`.`,
		ru: `Настройки действия сущности, такого как \`weapon.deploy()\` или \`entity.takeHealth(...)\`.`,
	},
	'ActionOptions.hooks': {
		en: `
			Whether the game's listeners run too - this plugin's and every other's,
			Pawn ones included; \`true\` by default. \`false\` runs the game's own
			function alone.

			Pawn: \`ExecuteHamB\`, \`ExecuteHam\`
		`,
		ru: `
			Вызываются ли и обработчики игры — этого плагина и всех остальных,
			Pawn-плагинов тоже; по умолчанию \`true\`. \`false\` выполняет только
			собственную функцию игры.

			Pawn: \`ExecuteHamB\`, \`ExecuteHam\`
		`,
	},
	'GameListenerOptions.toucher': {
		en: `For \`"touch"\`: the class of the entity that moves into the other, e.g. \`"player"\`; left out, any.`,
		ru: `Для \`"touch"\`: класс сущности, которая входит в другую, например \`"player"\`; если не задан — любой.`,
	},
	'GameListenerOptions.touched': {
		en: `For \`"touch"\`: the class of the entity touched, e.g. \`"func_door"\`; left out, any.`,
		ru: `Для \`"touch"\`: класс сущности, которой коснулись, например \`"func_door"\`; если не задан — любой.`,
	},
	'TouchEvent': {
		en: `
			Two entities touched: \`toucher\` moved into \`touched\`. Only the classes a
			listener asked for reach it:

			\`\`\`ts
			game.addEventListener("touch", onTouch, { toucher: "player", touched: "player" });
			\`\`\`

			Pawn: \`register_touch\`
		`,
		ru: `
			Две сущности коснулись: \`toucher\` вошла в \`touched\`. До обработчика
			доходят только классы, которые он просил:

			\`\`\`ts
			game.addEventListener("touch", onTouch, { toucher: "player", touched: "player" });
			\`\`\`

			Pawn: \`register_touch\`
		`,
	},
	'TouchEvent.toucher': {
		en: `The entity that moved into the other.`,
		ru: `Сущность, которая вошла в другую.`,
	},
	'TouchEvent.touched': {
		en: `The entity it touched.`,
		ru: `Сущность, которой она коснулась.`,
	},
	'TouchEvent.preventDefault': {
		en: `Blocks the touch: the game does not act on it.`,
		ru: `Блокирует касание: игра на него не реагирует.`,
	},
	'RoundWinner': {
		en: `The winner of a round, one of \`"TERRORIST"\`, \`"CT"\`, \`"draw"\`, or \`"none"\` - a restart without a winner.`,
		ru: `Победитель раунда, одно из \`"TERRORIST"\`, \`"CT"\`, \`"draw"\` или \`"none"\` — рестарт без победителя.`,
	},
	'EndRoundOptions': {
		en: `The options of \`game.endRound\`; only \`winner\` is required.`,
		ru: `Настройки \`game.endRound\`; обязателен только \`winner\`.`,
	},
	'EndRoundOptions.winner': {
		en: `The round's winner, one of \`"TERRORIST"\`, \`"CT"\`, \`"draw"\`, or \`"none"\` - a restart.`,
		ru: `Победитель раунда, одно из \`"TERRORIST"\`, \`"CT"\`, \`"draw"\` или \`"none"\` — рестарт.`,
	},
	'EndRoundOptions.delay': {
		en: `Seconds until the next round starts; \`5\` by default.`,
		ru: `Секунд до начала следующего раунда; по умолчанию \`5\`.`,
	},
	'EndRoundOptions.message': {
		en: `The message in the middle of the screen, or a game text such as \`"#Terrorists_Win"\`; \`"default"\` is the usual one for this winner, \`""\` none.`,
		ru: `Сообщение посередине экрана или текст игры вроде \`"#Terrorists_Win"\`; \`"default"\` — обычное для этого победителя, \`""\` — без сообщения.`,
	},
	'EndRoundOptions.sound': {
		en: `The sound, a radio phrase such as \`"terwin"\`; \`"default"\` is the usual one for this winner, \`""\` none.`,
		ru: `Звук — радиофраза вроде \`"terwin"\`; \`"default"\` — обычный для этого победителя, \`""\` — без звука.`,
	},
	'EndRoundOptions.dispatch': {
		en: `
			\`true\` to tell the \`roundEnd\` listeners of every plugin, Pawn ones too, as when
			the game ends a round itself. \`false\` by default: a \`roundEnd\` listener that
			ends the round would call itself.

			Pawn: \`rg_round_end(..., trigger)\`
		`,
		ru: `
			\`true\` — оповестить обработчики \`roundEnd\` всех плагинов, в том числе
			Pawn-плагинов, как когда игра сама завершает раунд. По умолчанию \`false\`:
			обработчик \`roundEnd\`, который завершает раунд, вызвал бы сам себя.

			Pawn: \`rg_round_end(..., trigger)\`
		`,
	},
	'game': {
		en: `The game the plugin runs in: its events (reapi hookchains and Ham Sandwich functions), its rules' fields and \`endRound\`.`,
		ru: `Игра, в которой работает плагин: её события (hookchain'ы reapi и функции Ham Sandwich), поля её правил и \`endRound\`.`,
	},
	'Variant': {
		en: `
			The places a message can show: \`Variant.chat\`, \`center\`, \`console\`, \`notify\`.
			A plain string works the same - \`"center"\`; an unknown name goes to chat.

			Pawn: \`print_chat\`, \`print_center\`, \`print_console\`, \`print_notify\`
		`,
		ru: `
			Места, где показывается сообщение: \`Variant.chat\`, \`center\`, \`console\`,
			\`notify\`. Обычная строка работает так же — \`"center"\`; незнакомое имя уходит
			в чат.

			Pawn: \`print_chat\`, \`print_center\`, \`print_console\`, \`print_notify\`
		`,
	},
	'Variant.chat': {
		en: `A line in the player's chat.`,
		ru: `Строка в чате игрока.`,
	},
	'Variant.center': {
		en: `Text in the middle of the player's screen.`,
		ru: `Текст посередине экрана игрока.`,
	},
	'Variant.console': {
		en: `A line in the player's console.`,
		ru: `Строка в консоли игрока.`,
	},
	'Variant.notify': {
		en: `A line in the player's console, sent as a notification; with \`developer 1\` CS also shows it in the top-left corner of the screen.`,
		ru: `Строка в консоли игрока, отправленная как уведомление; при \`developer 1\` CS показывает её ещё и в левом верхнем углу экрана.`,
	},
	'VariantName': {
		en: `The place a message shows, as a string: one of \`"chat"\`, \`"center"\`, \`"console"\` or \`"notify"\`.`,
		ru: `Место показа сообщения строкой, одно из \`"chat"\`, \`"center"\`, \`"console"\` или \`"notify"\`.`,
	},
	'Target': {
		en: `A message's recipient together with its place: \`{ id: 0, variant: "center" }\`. \`id\` is a player's \`id\`, \`0\` for everyone.`,
		ru: `Получатель сообщения вместе с местом показа: \`{ id: 0, variant: "center" }\`. \`id\` — \`id\` игрока, \`0\` — все.`,
	},
	'Target.id': {
		en: `The recipient's player \`id\`; \`0\` for every player.`,
		ru: `\`id\` игрока-получателя; \`0\` — все игроки.`,
	},
	'Target.variant': {
		en: `The place the message shows, one of \`"chat"\` (the default), \`"center"\`, \`"console"\` or \`"notify"\`.`,
		ru: `Место показа сообщения, одно из \`"chat"\` (по умолчанию), \`"center"\`, \`"console"\` или \`"notify"\`.`,
	},
	'paint': {
		en: `Turns a chat line's colour tags (\`!g\`, \`!r\`, ...) into the colour codes the client reads, and records in \`swapTeam\` which team colour the line needs. \`print\` calls it; exported for tests.`,
		ru: `Переводит цветовые метки строки чата (\`!g\`, \`!r\`, ...) в коды цвета для клиента и записывает в \`swapTeam\`, какой цвет команды нужен строке. Её вызывает \`print\`; экспортирована для тестов.`,
	},
	'menuColors': {
		en: `Turns a menu's colour tags (\`!y\`, \`!R\`, ...) into the codes the game draws, and drops the ones only chat has (\`!g\`, \`!b\`, \`!t\`) and the game's own codes written into the text (\`\\y\`); any other \`!\` stays. \`showMenu\` calls it, and a module hands its result to Pawn.`,
		ru: `Переводит цветовые метки меню (\`!y\`, \`!R\`, ...) в коды, которыми рисует игра, и убирает метки только для чата (\`!g\`, \`!b\`, \`!t\`) и собственные коды игры, записанные в текст (\`\\y\`); любой другой \`!\` остаётся. Её вызывает \`showMenu\`, а модуль отдаёт её результат в Pawn.`,
	},
	'colorTags': {
		en: `
			Text from Pawn - a dictionary's line, a Pawn plugin's argument - with its
			colour codes made tags: a menu's \`\\y\` \`\\r\` \`\\d\` \`\\w\` \`\\R\` are \`!y\` \`!r\`
			\`!d\` \`!w\` \`!R\`, and chat's bytes \`^1\` \`^3\` \`^4\` are \`!y\` \`!t\` \`!g\`.
		`,
		ru: `
			Текст из Pawn — строка словаря, аргумент Pawn-плагина — с цветовыми кодами,
			ставшими метками: коды меню \`\\y\` \`\\r\` \`\\d\` \`\\w\` \`\\R\` — это \`!y\` \`!r\`
			\`!d\` \`!w\` \`!R\`, а байты чата \`^1\` \`^3\` \`^4\` — \`!y\` \`!t\` \`!g\`.
		`,
	},
	'swapTeam': {
		en: `The team colour the last \`paint()\` chose for the line, one of \`"TERRORIST"\` (red), \`"CT"\` (blue), \`"SPECTATOR"\` (grey), or \`""\` - the reader's own team colour. \`print\` reads it right after.`,
		ru: `Цвет команды, который последний вызов \`paint()\` выбрал для строки, — одно из \`"TERRORIST"\` (красный), \`"CT"\` (синий), \`"SPECTATOR"\` (серый) или \`""\` — цвет команды читающего. \`print\` читает его сразу после.`,
	},
	'print': {
		en: `
			Sends a message to a player, or to every player (\`0\`).

			\`\`\`ts
			print(player, "Health restored!");                    // the player's chat
			print(0, "Round starts in 5 seconds");                // everyone's chat
			print(player, "Health restored!", "center");          // the middle of the player's screen
			print({ id: 0, variant: "center" }, "Go!");           // the middle of everyone's screen
			\`\`\`

			The first argument is a player, a player's \`id\`, or \`0\` for everyone. The third
			is where the message shows, one of \`"chat"\` (the default), \`"center"\` - the middle of
			the screen, \`"console"\` - the player's console, \`"notify"\` - the console too; CS
			shows it on screen only with \`developer 1\`.

			Colour tags work in chat only, and a letter is the same colour as in a menu:
			- \`!y\` yellow (the usual chat colour), \`!g\` green
			- \`!r\` red, \`!b\` blue, \`!d\` grey, \`!t\` the colour of the reader's team

			A menu's own tags (\`!w\`, \`!R\`) are dropped from a chat line. Red, blue,
			grey and \`!t\` share the message's one team colour: the first one used wins.

			Pawn: \`client_print\`, \`client_print_color\`
		`,
		ru: `
			Отправляет сообщение игроку или всем игрокам (\`0\`).

			\`\`\`ts
			print(player, "Health restored!");                    // чат игрока
			print(0, "Round starts in 5 seconds");                // чат всех игроков
			print(player, "Health restored!", "center");          // посередине экрана игрока
			print({ id: 0, variant: "center" }, "Go!");           // посередине экрана у всех
			\`\`\`

			Первый аргумент — игрок, \`id\` игрока или \`0\` — все. Третий — где показать
			сообщение, одно из \`"chat"\` (по умолчанию), \`"center"\` — посередине экрана, \`"console"\` —
			в консоли игрока, \`"notify"\` — тоже в консоли; на экране CS показывает его
			только при \`developer 1\`.

			Цветовые метки работают только в чате, и буква — тот же цвет, что в меню:
			- \`!y\` жёлтый (обычный цвет чата), \`!g\` зелёный
			- \`!r\` красный, \`!b\` синий, \`!d\` серый, \`!t\` цвет команды читающего

			Метки только для меню (\`!w\`, \`!R\`) из строки чата убираются. Красный, синий,
			серый и \`!t\` делят один цвет команды на сообщение: побеждает первый.

			Pawn: \`client_print\`, \`client_print_color\`
		`,
	},
	'lang': {
		en: `
			The server's dictionaries: the files of \`data/lang\`, a line per key and
			language, and each player reads them in his own.

			\`\`\`ts
			lang.load("myplugin");                                        // data/lang/myplugin.txt
			print(player, lang.translate(player, "MYPLUGIN_WELCOME", [player.name]));
			\`\`\`

			Pawn: \`register_dictionary\`, \`LookupLangKey\`
		`,
		ru: `
			Словари сервера: файлы \`data/lang\`, строка на ключ и язык, и каждый игрок
			читает их на своём.

			\`\`\`ts
			lang.load("myplugin");                                        // data/lang/myplugin.txt
			print(player, lang.translate(player, "MYPLUGIN_WELCOME", [player.name]));
			\`\`\`

			Pawn: \`register_dictionary\`, \`LookupLangKey\`
		`,
	},
	'lang.load': {
		en: `
			Loads the dictionary \`data/lang/<name>.txt\`: \`lang.load("myplugin")\`.
			\`false\` when there is no such file.

			Pawn: \`register_dictionary\`
		`,
		ru: `
			Загружает словарь \`data/lang/<name>.txt\`: \`lang.load("myplugin")\`.
			\`false\`, если такого файла нет.

			Pawn: \`register_dictionary\`
		`,
	},
	'lang.translate': {
		en: `
			The key's line in the player's language, \`null\` for the server's:
			\`lang.translate(player, "MYPLUGIN_WELCOME", [player.name])\`.

			\`%s\`, \`%d\`, \`%f\` (\`%.1f\`, \`%02d\`, ...) are filled from \`args\` in order;
			one no argument is left for stays as written. The dictionary's colour
			codes come back as tags - \`\\y\` as \`!y\`, \`^4\` as \`!g\` - so the line goes
			to a menu and to chat alike. A key no dictionary has comes back as it is.

			Pawn: \`LookupLangKey\`, \`format\` with \`%L\`
		`,
		ru: `
			Строка ключа на языке игрока, \`null\` — на языке сервера:
			\`lang.translate(player, "MYPLUGIN_WELCOME", [player.name])\`.

			\`%s\`, \`%d\`, \`%f\` (\`%.1f\`, \`%02d\`, ...) заполняются из \`args\` по порядку;
			тот, на который аргумента не хватило, остаётся как написан. Цветовые коды
			словаря возвращаются метками — \`\\y\` как \`!y\`, \`^4\` как \`!g\`, — так что
			строка годится и для меню, и для чата. Ключ, которого нет ни в одном
			словаре, возвращается как есть.

			Pawn: \`LookupLangKey\`, \`format\` с \`%L\`
		`,
	},
	'cvar': {
		en: `
			Reads and sets a cvar by name in one call: \`cvar.num("mp_freezetime")\`.

			For a cvar used more than once \`Cvar\` is the better choice: it creates a
			missing cvar, hears its changes and reads it as text, a number or a switch.
		`,
		ru: `
			Читает и задаёт квар по имени одним вызовом: \`cvar.num("mp_freezetime")\`.

			Для квара, который нужен не один раз, лучше \`Cvar\`: он создаёт недостающий
			квар, слышит его изменения и читает его как текст, число или переключатель.
		`,
	},
	'cvar.num': {
		en: `
			The cvar's value as a whole number: \`cvar.num("mp_freezetime")\`.

			Pawn: \`get_cvar_num\`
		`,
		ru: `
			Значение квара целым числом: \`cvar.num("mp_freezetime")\`.

			Pawn: \`get_cvar_num\`
		`,
	},
	'cvar.setNum': {
		en: `
			Sets the cvar to a whole number: \`cvar.setNum("mp_freezetime", 5)\`.

			Pawn: \`set_cvar_num\`
		`,
		ru: `
			Задаёт квару целочисленное значение: \`cvar.setNum("mp_freezetime", 5)\`.

			Pawn: \`set_cvar_num\`
		`,
	},
	'cvar.str': {
		en: `
			The cvar's value as text: \`cvar.str("hostname")\`.

			Pawn: \`get_cvar_string\`
		`,
		ru: `
			Значение квара текстом: \`cvar.str("hostname")\`.

			Pawn: \`get_cvar_string\`
		`,
	},
	'cvar.setStr': {
		en: `
			Sets the cvar's text: \`cvar.setStr("hostname", "My Server")\`.

			Pawn: \`set_cvar_string\`
		`,
		ru: `
			Задаёт квару текст: \`cvar.setStr("hostname", "My Server")\`.

			Pawn: \`set_cvar_string\`
		`,
	},
	'cmd': {
		en: `
			Registers a console command for players; the handler gets the \`id\` of the
			player who typed it. \`server.addCommand\` is the usual way.

			Pawn: \`register_clcmd\`
		`,
		ru: `
			Регистрирует консольную команду для игроков; обработчик получает \`id\`
			игрока, который её ввёл. Обычно для этого берут \`server.addCommand\`.

			Pawn: \`register_clcmd\`
		`,
	},
	'cmdWide': {
		en: `
			Registers a console command for players whose handler gets the raw
			arguments \`(id, level, cid)\`. \`handled()\` in the handler stops the command
			from going on to other plugins.

			Pawn: \`register_clcmd\`
		`,
		ru: `
			Регистрирует консольную команду для игроков, обработчик которой получает
			сырые аргументы \`(id, level, cid)\`. \`handled()\` в обработчике не пускает
			команду дальше, к другим плагинам.

			Pawn: \`register_clcmd\`
		`,
	},
	'TimerHandler': {
		en: `The function a timer runs: \`() => ...\`.`,
		ru: `Функция, которую запускает таймер: \`() => ...\`.`,
	},
	'setTimeout': {
		en: `
			Runs \`handler\` once after \`ms\` milliseconds and returns the timer's handle,
			as in the browser:

			\`\`\`ts
			const handle = setTimeout(() => print(player, "Welcome!"), 2000);
			clearTimeout(handle);
			\`\`\`

			The handler may use the variables around it. The precision is one server frame.

			Pawn: \`set_task\`
		`,
		ru: `
			Запускает \`handler\` один раз через \`ms\` миллисекунд и возвращает дескриптор
			таймера, как в браузере:

			\`\`\`ts
			const handle = setTimeout(() => print(player, "Welcome!"), 2000);
			clearTimeout(handle);
			\`\`\`

			Обработчик может пользоваться переменными вокруг. Точность — один серверный кадр.

			Pawn: \`set_task\`
		`,
	},
	'SleepOptions': {
		en: `The options of \`sleep()\`.`,
		ru: `Настройки \`sleep()\`.`,
	},
	'SleepOptions.signal': {
		en: `An AbortSignal that cancels the wait: the promise then rejects with the signal's reason.`,
		ru: `AbortSignal, который отменяет ожидание: промис тогда отклоняется с причиной сигнала.`,
	},
	'sleep': {
		en: `
			Returns a promise fulfilled after \`ms\` milliseconds - the way to wait inside
			an async function:

			\`\`\`ts
			await sleep(1000);
			await sleep(5000, { signal: AbortSignal.timeout(2000) }); // rejects after 2 s
			\`\`\`

			The precision is one server frame. Inside an async command handler or
			player event the wait also ends when that player leaves.

			Pawn: \`set_task\`
		`,
		ru: `
			Возвращает промис, который выполняется через \`ms\` миллисекунд, — так ждут
			внутри async-функции:

			\`\`\`ts
			await sleep(1000);
			await sleep(5000, { signal: AbortSignal.timeout(2000) }); // отклоняется через 2 с
			\`\`\`

			Точность — один серверный кадр. Внутри async-обработчика команды или
			события игрока ожидание заканчивается и тогда, когда этот игрок выходит.

			Pawn: \`set_task\`
		`,
	},
	'setInterval': {
		en: `
			Runs \`handler\` every \`ms\` milliseconds until \`clearInterval\` stops it;
			returns the timer's handle.

			Pawn: \`set_task\` with the "b" flag
		`,
		ru: `
			Запускает \`handler\` каждые \`ms\` миллисекунд, пока его не остановит
			\`clearInterval\`; возвращает дескриптор таймера.

			Pawn: \`set_task\` with the "b" flag
		`,
	},
	'clearTimeout': {
		en: `
			Stops the timer with this handle. A timer that has already fired or been
			stopped is ignored. Only this stops these timers: Pawn's task natives do not
			see them.

			Pawn: \`remove_task\`
		`,
		ru: `
			Останавливает таймер с этим дескриптором. Уже сработавший или остановленный
			таймер игнорируется. Остановить эти таймеры можно только так: task-нативы
			Pawn их не видят.

			Pawn: \`remove_task\`
		`,
	},
	'clearInterval': {
		en: `Stops the interval with this handle; the same as \`clearTimeout\`.`,
		ru: `Останавливает интервал с этим дескриптором; то же, что \`clearTimeout\`.`,
	},
	'Call': {
		en: `
			A call of a Pawn native with a \`...\` tail, built one argument at a time -
			the low-level way. A native from \`~/natives\` is an ordinary function and
			needs none of this.

			  new Call(NATIVE_server_print).str("%s").str(text).run();

			Find the \`...\` in the native's declaration. Arguments before it go as they
			are, with \`num\` or \`str\`. A number in the tail goes with \`ref\`, which passes
			it by address, and \`out(i)\` reads back what the native wrote there; a string
			goes with \`str\` anywhere.

			  ExecuteHam(Ham:function, this, any:...)      num, num, then the tail
			  SetHookChainArg(number, AType:type, any:...) num, num, then the tail
			  ExecuteForward(handle, &ret, any:...)        num, ref for &ret, then tail

			A wrong kind of argument fails quietly, somewhere else.
		`,
		ru: `
			Вызов Pawn-натива с хвостом \`...\`, собираемый по одному аргументу, —
			низкоуровневый способ. Натив из \`~/natives\` — обычная функция, и ему это
			не нужно.

			  new Call(NATIVE_server_print).str("%s").str(text).run();

			Найдите \`...\` в объявлении натива. Аргументы до него передаются как есть,
			через \`num\` или \`str\`. Число в хвосте передаётся через \`ref\` — по адресу, —
			а \`out(i)\` читает то, что натив туда записал; строка везде идёт через \`str\`.

			  ExecuteHam(Ham:function, this, any:...)      num, num, then the tail
			  SetHookChainArg(number, AType:type, any:...) num, num, then the tail
			  ExecuteForward(handle, &ret, any:...)        num, ref for &ret, then tail

			Аргумент не того вида ломает вызов тихо и совсем в другом месте.
		`,
	},
	'Call.num': {
		en: `Adds a number argument as it is: an entity index, a constant, a count.`,
		ru: `Добавляет числовой аргумент как есть: индекс сущности, константу, количество.`,
	},
	'Call.float': {
		en: `Adds a fractional number argument, one the native declares as \`Float:\`.`,
		ru: `Добавляет дробный аргумент — тот, что натив объявляет как \`Float:\`.`,
	},
	'Call.str': {
		en: `Adds a string argument, before the \`...\` or in the tail alike.`,
		ru: `Добавляет строковый аргумент — одинаково до \`...\` и в хвосте.`,
	},
	'Call.buffer': {
		en: `Adds an array of cells the native reads and may write into, followed by its length.`,
		ru: `Добавляет массив ячеек, который натив читает и может перезаписать, а следом — его длину.`,
	},
	'Call.vec': {
		en: `Adds a vector: three fractional numbers at one address - an origin, angles, a colour. Unlike \`buffer\`, no length follows it.`,
		ru: `Добавляет вектор: три дробных числа по одному адресу — координаты, углы, цвет. В отличие от \`buffer\`, длина за ним не идёт.`,
	},
	'Call.vecInto': {
		en: `Adds a vector the native fills in; after \`run\` the result is in \`cells\`.`,
		ru: `Добавляет вектор, который заполняет натив; после \`run\` результат — в \`cells\`.`,
	},
	'Call.tailBuffer': {
		en: `
			Adds an array of cells the native writes into, in a \`...\` tail: its length
			follows by address, as a tail's numbers do - \`get_member(id, member,
			dest[], len)\`.
		`,
		ru: `
			Добавляет массив ячеек, в который пишет натив, в хвост \`...\`: его длина
			идёт следом по адресу, как числа хвоста, — \`get_member(id, member,
			dest[], len)\`.
		`,
	},
	'Call.array': {
		en: `
			Adds an array to a forward's \`...\` tail: \`ExecuteForward\` gets it as
			\`PrepareArray\` makes it. \`floats\` sends the numbers as \`Float:\`.
		`,
		ru: `
			Добавляет массив в хвост \`...\` форварда: \`ExecuteForward\` получает его
			таким, каким его делает \`PrepareArray\`. \`floats\` передаёт числа как \`Float:\`.
		`,
	},
	'Call.ref': {
		en: `Adds a number passed by address, as a \`...\` tail argument must be; \`out\` reads what the native wrote into it.`,
		ru: `Добавляет число, передаваемое по адресу, — так передаётся аргумент хвоста \`...\`; \`out\` читает, что натив в него записал.`,
	},
	'Call.out': {
		en: `The value the native left in the \`ref\` argument at this position, after \`run\`.`,
		ru: `Значение, которое натив оставил в аргументе \`ref\` на этой позиции, после \`run\`.`,
	},
	'Call.run': {
		en: `Calls the native with the arguments added so far and returns its result.`,
		ru: `Вызывает натив с добавленными аргументами и возвращает его результат.`,
	},
	'hook': {
		en: `
			Registers a reapi hookchain with a raw handler of four numbers - the low
			level under \`game.addEventListener\`, which is what a plugin uses.

			The name is reapi's, without the class where it is not needed:
			\`"restart_round"\`, \`"player_spawn"\`; the editor completes them. The numbers
			behind the names come from reapi's includes, so they must be the ones of the
			reapi the server runs. Returns the hook's handle.

			Pawn: \`RegisterHookChain\`, \`EnableHookChain\`, \`DisableHookChain\`
		`,
		ru: `
			Регистрирует хукчейн reapi с сырым обработчиком из четырёх чисел — нижний
			уровень под \`game.addEventListener\`, которым пользуется плагин.

			Имя — из reapi, без класса там, где он не нужен: \`"restart_round"\`,
			\`"player_spawn"\`; редактор их дополняет. Числа за именами берутся из
			инклудов reapi, поэтому инклуды должны быть от того reapi, что стоит на
			сервере. Возвращает дескриптор хука.

			Pawn: \`RegisterHookChain\`, \`EnableHookChain\`, \`DisableHookChain\`
		`,
	},

	'PluginInfo': {
		en: `The plugin's name, version, author and description, given to \`plugin({ ... })\`; \`amxts_plugins\` in the server console lists them.`,
		ru: `Имя, версия, автор и описание плагина для \`plugin({ ... })\`; их показывает \`amxts_plugins\` в консоли сервера.`,
	},
	'PluginInfo.name': {
		en: `The plugin's name, e.g. \`"My Plugin"\`.`,
		ru: `Имя плагина, например \`"My Plugin"\`.`,
	},
	'PluginInfo.version': {
		en: `The plugin's version, e.g. \`"1.0.0"\`.`,
		ru: `Версия плагина, например \`"1.0.0"\`.`,
	},
	'PluginInfo.author': {
		en: `The plugin's author.`,
		ru: `Автор плагина.`,
	},
	'PluginInfo.description': {
		en: `The plugin's description, in one line.`,
		ru: `Описание плагина, одной строкой.`,
	},
	'PluginInfo.include': {
		en: `
			The Pawn include whose natives the plugin implements, e.g. \`"myplugin.inc"\`, from
			\`includes/\` or beside the plugin. Each exported function reaches Pawn as the
			include declares it, and Pawn plugins use that include.
		`,
		ru: `
			Pawn-инклуд, нативы которого реализует плагин, например \`"myplugin.inc"\`, из
			\`includes/\` или рядом с плагином. Каждая экспортированная функция уходит в
			Pawn так, как её объявляет инклуд, и Pawn-плагины подключают этот инклуд.
		`,
	},
	'plugin': {
		en: `
			Declares the plugin: its name, version, author and description, as the
			server's plugin list shows them. Called once, at the top level:

			\`\`\`ts
			plugin({ name: "Hello", version: "1.0.0", author: "you", description: "An example" });
			\`\`\`

			\`include\` names the Pawn include whose natives the plugin implements.

			Pawn: \`register_plugin\`
		`,
		ru: `
			Объявляет плагин: имя, версия, автор и описание — так их показывает список
			плагинов сервера. Вызывается один раз, на верхнем уровне файла:

			\`\`\`ts
			plugin({ name: "Hello", version: "1.0.0", author: "you", description: "An example" });
			\`\`\`

			\`include\` — Pawn-инклуд, нативы которого реализует плагин.

			Pawn: \`register_plugin\`
		`,
	},
	'ModuleOptions': {
		en: `
			The modules' settings in \`amxts.config.ts\`, each under its module's \`configKey\`.
			Empty here: a module adds its key by augmenting this interface in
			\`"@amxts/core"\` - \`menus?: Partial<MenuCoreOptions>\` - and the editor checks
			the config against it.
		`,
		ru: `
			Настройки модулей в \`amxts.config.ts\`, каждая — под \`configKey\` своего модуля.
			Здесь пусто: модуль добавляет свой ключ, дополняя этот интерфейс в
			\`"@amxts/core"\`, — \`menus?: Partial<MenuCoreOptions>\`, — и редактор проверяет
			конфиг по нему.
		`,
	},
	'defineModule': {
		en: `
			Defines a module: \`export default defineModule<Options>({ meta, requires,
			defaults, setup })\` in its module file. \`setup\` runs once,
			when the server loads the module, with \`defaults\` and what \`amxts.config.ts\`
			sets over them. Global; \`import { defineModule } from "@amxts/core"\` works too.
		`,
		ru: `
			Объявляет модуль: \`export default defineModule<Options>({ meta, requires,
			defaults, setup })\` в файле модуля. \`setup\` выполняется один
			раз, когда сервер загружает модуль, — с \`defaults\` и тем, что поверх них
			задаёт \`amxts.config.ts\`. Глобальная; \`import { defineModule } from "@amxts/core"\` тоже работает.
		`,
	},
	'ForwardStop': {
		en: `
			The forward's stopping rule, one of: \`"never"\` - every plugin hears it, whatever it
			returns; \`"handled"\` - the first plugin that says it handled the forward
			stops it.

			Pawn: \`ET_IGNORE\`, \`ET_STOP\`
		`,
		ru: `
			Правило остановки форварда, одно из: \`"never"\` — его слышат все плагины, что бы они
			ни вернули; \`"handled"\` — его останавливает первый плагин, который сообщил,
			что обработал форвард.

			Pawn: \`ET_IGNORE\`, \`ET_STOP\`
		`,
	},
	'NoArgument': {
		en: `A placeholder for an unused type argument of \`Forward\`: \`Forward<number>\` has one argument.`,
		ru: `Заглушка для неиспользуемого аргумента типа у \`Forward\`: у \`Forward<number>\` один аргумент.`,
	},
	'Forward': {
		en: `
			A forward other plugins listen to, Pawn and TypeScript alike. Its arguments
			are its type parameters, up to 32 - as many as AMX Mod X gives a forward:

			\`\`\`ts
			const roundStart = new Forward("myplugin_on_round_start");
			const roundEnd = new Forward<RoundWinner>("myplugin_on_round_end");
			const configChanged = new Forward<string, string>("myplugin_on_config_changed");

			roundStart.emit();
			roundEnd.emit(winner);
			configChanged.emit(id, value);

			const swapped = new Forward<Player, Player>("myplugin_on_player_swapped");
			swapped.emit(catcher, caught);              // Pawn gets their ids
			\`\`\`

			A Pawn plugin listens with \`public myplugin_on_round_end(winner)\`, as usual;
			a TypeScript plugin with \`subscribe(handler)\`. A number, a boolean and a
			Player (its \`id\`) reach Pawn as numbers, a \`Float\` as a Float, a string as
			a string, a \`number[]\` or a \`Vector\` as an array. A \`Team\` or a
			\`RoundWinner\` goes as Pawn's number where an include declares the forward
			with that tag; a \`Team\` for a forward no include declares is a build error.

			The forward is created on its first emit, or earlier by \`create()\` - once
			every plugin has loaded (\`plugin_cfg\` or later), or those loaded after it
			would not hear it.

			Pawn: \`CreateMultiForward\`, \`ExecuteForward\`
		`,
		ru: `
			Форвард, который слушают другие плагины — и Pawn, и TypeScript. Его
			аргументы — параметры типа, до 32 — столько, сколько AMX Mod X даёт форварду:

			\`\`\`ts
			const roundStart = new Forward("myplugin_on_round_start");
			const roundEnd = new Forward<RoundWinner>("myplugin_on_round_end");
			const configChanged = new Forward<string, string>("myplugin_on_config_changed");

			roundStart.emit();
			roundEnd.emit(winner);
			configChanged.emit(id, value);

			const swapped = new Forward<Player, Player>("myplugin_on_player_swapped");
			swapped.emit(catcher, caught);              // Pawn получает их id
			\`\`\`

			Pawn-плагин слушает его через \`public myplugin_on_round_end(winner)\`, как
			обычно, TypeScript-плагин — через \`subscribe(handler)\`. number, boolean и
			Player (его \`id\`) приходят в Pawn числами, \`Float\` — Float, string —
			строкой, \`number[]\` и \`Vector\` — массивом. \`Team\` и
			\`RoundWinner\` уходят числом Pawn там, где инклуд объявляет форвард с таким
			тегом; \`Team\` для форварда, которого нет ни в одном инклуде, — ошибка сборки.

			Форвард создаётся при первом emit или раньше, вызовом \`create()\`, — когда
			все плагины уже загружены (\`plugin_cfg\` или позже), иначе загруженные после
			него его не услышат.

			Pawn: \`CreateMultiForward\`, \`ExecuteForward\`
		`,
	},
	'Forward.stopWhen': {
		en: `The forward's stopping rule, one of \`"never"\` (the default) or \`"handled"\`. Set it before the first emit.`,
		ru: `Правило остановки форварда, одно из \`"never"\` (по умолчанию) или \`"handled"\`. Задаётся до первого emit.`,
	},
	'Forward.name': {
		en: `The forward's name, as Pawn plugins listen to it.`,
		ru: `Имя форварда, под которым его слушают Pawn-плагины.`,
	},
	'Forward.subscribe': {
		en: `
			Calls \`handler\` each time the forward is emitted - by this plugin, another
			TypeScript plugin or a Pawn plugin:

			\`\`\`ts
			const greeted = new Forward<string, number>("showcase_on_greeted");
			greeted.subscribe((name, count) => console.log(\`\${name}: \${count}\`));
			\`\`\`

			The handler's parameters take the forward's types; a named function may
			take fewer of them. A forward created by a Pawn plugin reaches TypeScript
			only when one of the amxts host plugin's includes declares it; one emitted
			from TypeScript reaches every subscriber.
		`,
		ru: `
			Вызывает \`handler\` при каждом срабатывании форварда — из этого плагина,
			другого TypeScript-плагина или Pawn-плагина:

			\`\`\`ts
			const greeted = new Forward<string, number>("showcase_on_greeted");
			greeted.subscribe((name, count) => console.log(\`\${name}: \${count}\`));
			\`\`\`

			Параметры обработчика получают типы форварда; именованная функция может
			принимать их меньше. Форвард, созданный Pawn-плагином, доходит до
			TypeScript, только если он объявлен в одном из инклудов хост-плагина
			amxts; отправленный из TypeScript доходит до всех подписчиков.
		`,
	},
	'Forward.unsubscribe': {
		en: `Stops calling a handler given to \`subscribe()\`.`,
		ru: `Перестаёт вызывать обработчик, переданный в \`subscribe()\`.`,
	},
	'Forward.deliver': {
		en: `Passes the forward's arguments to every \`subscribe()\` handler; the server calls it, not a plugin.`,
		ru: `Передаёт аргументы форварда всем обработчикам из \`subscribe()\`; вызывает это сервер, а не плагин.`,
	},
	'Forward.create': {
		en: `
			Creates the forward now rather than on its first emit; later calls do nothing.

			Pawn: \`CreateMultiForward\`
		`,
		ru: `
			Создаёт форвард сейчас, а не при первом emit; повторные вызовы ничего не делают.

			Pawn: \`CreateMultiForward\`
		`,
	},
	'Forward.emit': {
		en: `
			Sends the forward to every plugin that listens to it; \`true\` if it went out.

			Pawn: \`ExecuteForward\`
		`,
		ru: `
			Отправляет форвард всем плагинам, которые его слушают; \`true\`, если он ушёл.

			Pawn: \`ExecuteForward\`
		`,
	},
	'Storage': {
		en: `
			A key-to-text store on disk: a Map that survives a map change and a server
			restart.

			\`\`\`ts
			const demos = new Storage("core_demo_counters");
			const last = demos.get(auth);      // string | null
			demos.set(auth, "3");
			if (demos.has(auth)) ...
			demos.delete(auth);
			\`\`\`

			The file is named after the storage, kept in the \`vault\` folder of the AMX
			Mod X data folder, and opened on first use. Values are text: a number goes
			in with \`toString()\` and comes out with \`parseInt\`.

			Pawn: \`nvault_open\`, \`nvault_get\`, \`nvault_set\`, \`nvault_remove\`
		`,
		ru: `
			Хранилище текста по ключу на диске: Map, который переживает смену карты и
			перезапуск сервера.

			\`\`\`ts
			const demos = new Storage("core_demo_counters");
			const last = demos.get(auth);      // string | null
			demos.set(auth, "3");
			if (demos.has(auth)) ...
			demos.delete(auth);
			\`\`\`

			Файл называется по имени хранилища, лежит в папке \`vault\` в папке данных
			AMX Mod X и открывается при первом обращении. Значения — текст: число
			кладётся через \`toString()\`, а читается через \`parseInt\`.

			Pawn: \`nvault_open\`, \`nvault_get\`, \`nvault_set\`, \`nvault_remove\`
		`,
	},
	'Storage.name': {
		en: `The storage's name, which is also its file's name.`,
		ru: `Имя хранилища — оно же имя его файла.`,
	},
	'Storage.get': {
		en: `The value under \`key\`, or \`null\` when there is none.`,
		ru: `Значение по ключу \`key\` или \`null\`, если его нет.`,
	},
	'Storage.set': {
		en: `Puts \`value\` under \`key\`, replacing what was there.`,
		ru: `Записывает \`value\` по ключу \`key\`, заменяя прежнее значение.`,
	},
	'Storage.has': {
		en: `\`true\` when there is a value under \`key\`.`,
		ru: `\`true\`, если по ключу \`key\` есть значение.`,
	},
	'Storage.delete': {
		en: `Removes \`key\` and its value; a key that is not there is ignored.`,
		ru: `Удаляет ключ \`key\` вместе со значением; отсутствующий ключ игнорируется.`,
	},
	'PawnFunction': {
		en: `
			A public function of another plugin - a Pawn plugin's public, or a
			TypeScript plugin's \`publicFor\` name - to call from here:

			\`\`\`ts
			const fn = PawnFunction.find(caller(), "OnAction");       // null when there is none
			if (fn != null) fn.call().int(id).text("KEY").run();
			const call = fn.call().int(id).int(target).buffer(256).int(255);
			call.run();
			const value = call.bufferText;                            // what it wrote into value[]
			\`\`\`

			Pawn: \`get_func_id\`, \`callfunc_begin_i\`
		`,
		ru: `
			Публичная функция другого плагина — паблик Pawn-плагина или имя
			\`publicFor\` TypeScript-плагина, — которую можно вызвать отсюда:

			\`\`\`ts
			const fn = PawnFunction.find(caller(), "OnAction");       // null, если такой нет
			if (fn != null) fn.call().int(id).text("KEY").run();
			const call = fn.call().int(id).int(target).buffer(256).int(255);
			call.run();
			const value = call.bufferText;                            // что она записала в value[]
			\`\`\`

			Pawn: \`get_func_id\`, \`callfunc_begin_i\`
		`,
	},
	'PawnFunction.plugin': {
		en: `The \`id\` of the plugin the function belongs to.`,
		ru: `\`id\` плагина, которому принадлежит функция.`,
	},
	'PawnFunction.index': {
		en: `
			The function's index in its plugin.

			Pawn: \`get_func_id\`
		`,
		ru: `
			Индекс функции в её плагине.

			Pawn: \`get_func_id\`
		`,
	},
	'PawnFunction.find': {
		en: `
			Finds the public \`name\` in the plugin with this \`id\` (a native's \`caller()\`);
			\`null\` when the plugin has no such public.

			Pawn: \`get_func_id\`
		`,
		ru: `
			Находит паблик \`name\` в плагине с этим \`id\` (\`caller()\` натива); \`null\`, если
			такого паблика у плагина нет.

			Pawn: \`get_func_id\`
		`,
	},
	'PawnFunction.call': {
		en: `Starts a call of the function: add its arguments in order, then \`run()\`.`,
		ru: `Начинает вызов функции: добавьте её аргументы по порядку, затем \`run()\`.`,
	},
	'PawnCall': {
		en: `
			One call of a PawnFunction: its arguments in order, then \`run()\`. Any
			number of strings and arrays may be passed, and what the function writes
			into a \`buffer()\` is read afterwards from \`bufferText\`.

			Pawn: \`callfunc_push_int\`, \`callfunc_push_str\`, \`callfunc_push_array\`, \`callfunc_end\`
		`,
		ru: `
			Один вызов PawnFunction: её аргументы по порядку, затем \`run()\`. Строк и
			массивов можно передать сколько угодно, а то, что функция записала в
			\`buffer()\`, потом читается из \`bufferText\`.

			Pawn: \`callfunc_push_int\`, \`callfunc_push_str\`, \`callfunc_push_array\`, \`callfunc_end\`
		`,
	},
	'PawnCall.bufferText': {
		en: `The text the function wrote into its \`buffer()\`, once \`run()\` is over.`,
		ru: `Текст, который функция записала в свой \`buffer()\`, после \`run()\`.`,
	},
	'PawnCall.int': {
		en: `Adds a number argument.`,
		ru: `Добавляет числовой аргумент.`,
	},
	'PawnCall.bool': {
		en: `Adds a boolean argument; the function gets \`1\` or \`0\`.`,
		ru: `Добавляет логический аргумент; функция получает \`1\` или \`0\`.`,
	},
	'PawnCall.text': {
		en: `Adds a string argument.`,
		ru: `Добавляет строковый аргумент.`,
	},
	'PawnCall.buffer': {
		en: `Adds an array of \`size\` cells for the function to fill - its \`value[]\`; one per call. The text is then in \`bufferText\`.`,
		ru: `Добавляет массив из \`size\` ячеек, который заполняет функция, — её \`value[]\`; один на вызов. Текст потом — в \`bufferText\`.`,
	},
	'PawnCall.run': {
		en: `Calls the function and returns its result, or \`0\` when it could not be called.`,
		ru: `Вызывает функцию и возвращает её результат или \`0\`, если вызвать не удалось.`,
	},
	'createCellArray': {
		en: `
			Creates an AMX Mod X \`Array:\` of \`cellSize\` cells an item and returns its handle.

			Pawn: \`ArrayCreate\`
		`,
		ru: `
			Создаёт \`Array:\` AMX Mod X по \`cellSize\` ячеек на элемент и возвращает его дескриптор.

			Pawn: \`ArrayCreate\`
		`,
	},
	'destroyCellArray': {
		en: `
			Frees an \`Array:\` made by \`createCellArray\`; its handle is no good afterwards.

			Pawn: \`ArrayDestroy\`
		`,
		ru: `
			Освобождает \`Array:\`, созданный \`createCellArray\`; после этого дескриптор недействителен.

			Pawn: \`ArrayDestroy\`
		`,
	},
	'cellArrayRows': {
		en: `
			Reads every item of an \`Array:\` of \`cellSize\` cells an item, each as an array of numbers.

			Pawn: \`ArrayGetArray\`
		`,
		ru: `
			Читает все элементы \`Array:\` по \`cellSize\` ячеек на элемент, каждый — массивом чисел.

			Pawn: \`ArrayGetArray\`
		`,
	},
	'pushCellArrayRow': {
		en: `
			Adds one item, an array of numbers, to the end of an \`Array:\`.

			Pawn: \`ArrayPushArray\`
		`,
		ru: `
			Добавляет в конец \`Array:\` один элемент — массив чисел.

			Pawn: \`ArrayPushArray\`
		`,
	},
	'cellsText': {
		en: `Reads a Pawn string from \`count\` cells of a row, from \`start\`: a UTF-8 byte a cell, up to the first zero.`,
		ru: `Читает Pawn-строку из \`count\` ячеек строки таблицы, начиная со \`start\`: по байту UTF-8 на ячейку, до первого нуля.`,
	},
	'textCells': {
		en: `Writes text as \`count\` cells of a Pawn string: at most \`count - 1\` bytes, never half a letter, the rest zeros.`,
		ru: `Записывает текст в \`count\` ячеек Pawn-строки: не больше \`count - 1\` байт, без половинок букв, остаток — нули.`,
	},
	'showMenu': {
		en: `
			Shows a player an old-style menu of any length: \`keys\` are the keys it
			accepts, \`title\` the name its key presses come back under.

			Colour tags, the same letters as in chat: \`!y\` yellow, \`!r\` red, \`!d\` grey,
			\`!w\` white, \`!R\` to the right edge. Chat's own tags (\`!g\`, \`!b\`, \`!t\`)
			are dropped, and so are the game's own codes (\`\\y\`): text is written with tags.

			Pawn: \`show_menu\`, \`register_menucmd\`
		`,
		ru: `
			Показывает игроку старое меню любой длины: \`keys\` — клавиши, которые оно
			принимает, \`title\` — имя, под которым приходят нажатия.

			Цветовые метки, те же буквы, что в чате: \`!y\` жёлтый, \`!r\` красный, \`!d\` серый,
			\`!w\` белый, \`!R\` — к правому краю. Метки только для чата (\`!g\`, \`!b\`, \`!t\`)
			убираются, как и собственные коды игры (\`\\y\`): текст пишется метками.

			Pawn: \`show_menu\`, \`register_menucmd\`
		`,
	},
	'MenuColor': {
		en: `A colour of a menu's item numbers: a menu's colour tag, \`"!y"\`, \`"!r"\`, \`"!d"\` or \`"!w"\`.`,
		ru: `Цвет номеров пунктов меню: цветовой тег меню, \`"!y"\`, \`"!r"\`, \`"!d"\` или \`"!w"\`.`,
	},
	'MenuOptions': {
		en: `The options of a \`Menu\`: its pages and the texts of its own items.`,
		ru: `Настройки \`Menu\`: его страницы и тексты его собственных пунктов.`,
	},
	'MenuOptions.perPage': {
		en: `
			Items on a page, \`7\` at most: Back, More and Exit go below them. \`0\`
			puts every item on one page, without Back and More - \`10\` at most.

			Pawn: \`MPROP_PERPAGE\`
		`,
		ru: `
			Пунктов на странице, не больше \`7\`: под ними идут «Назад», «Дальше» и «Выход».
			\`0\` ставит все пункты на одну страницу, без «Назад» и «Дальше», — не больше \`10\`.

			Pawn: \`MPROP_PERPAGE\`
		`,
	},
	'MenuOptions.exit': {
		en: `
			Whether the menu has an Exit item; \`true\` by default.

			Pawn: \`MPROP_EXIT\`
		`,
		ru: `
			Есть ли у меню пункт «Выход»; по умолчанию \`true\`.

			Pawn: \`MPROP_EXIT\`
		`,
	},
	'MenuOptions.backText': {
		en: `
			The Back item's text; AMX Mod X's \`"Back"\`, in the player's language, by default.

			Pawn: \`MPROP_BACKNAME\`
		`,
		ru: `
			Текст пункта «Назад»; по умолчанию \`"Back"\` AMX Mod X на языке игрока.

			Pawn: \`MPROP_BACKNAME\`
		`,
	},
	'MenuOptions.nextText': {
		en: `
			The More item's text; AMX Mod X's \`"More"\` by default.

			Pawn: \`MPROP_NEXTNAME\`
		`,
		ru: `
			Текст пункта «Дальше»; по умолчанию \`"More"\` AMX Mod X.

			Pawn: \`MPROP_NEXTNAME\`
		`,
	},
	'MenuOptions.exitText': {
		en: `
			The Exit item's text; AMX Mod X's \`"Exit"\` by default.

			Pawn: \`MPROP_EXITNAME\`
		`,
		ru: `
			Текст пункта «Выход»; по умолчанию \`"Exit"\` AMX Mod X.

			Pawn: \`MPROP_EXITNAME\`
		`,
	},
	'MenuOptions.numberColor': {
		en: `
			The colour of the item numbers; \`"!r"\`, red, by default.

			Pawn: \`MPROP_NUMBER_COLOR\`
		`,
		ru: `
			Цвет номеров пунктов; по умолчанию \`"!r"\`, красный.

			Pawn: \`MPROP_NUMBER_COLOR\`
		`,
	},
	'MenuContext': {
		en: `The context a menu's functions get: the player it is shown to, the menu and the data it was shown with.`,
		ru: `Контекст, который получают функции меню: игрок, которому оно показано, само меню и данные, с которыми его показали.`,
	},
	'MenuContext.player': {
		en: `The player the menu is shown to.`,
		ru: `Игрок, которому показано меню.`,
	},
	'MenuContext.menu': {
		en: `The menu itself: \`menu.show(player, data)\` keeps it open after a choice.`,
		ru: `Само меню: \`menu.show(player, data)\` оставляет его открытым после выбора.`,
	},
	'MenuContext.data': {
		en: `The data \`show\` was given.`,
		ru: `Данные, которые получил \`show\`.`,
	},
	'MenuItemOptions': {
		en: `An item of a \`Menu\`: its title, when it is shown and can be chosen, and what choosing it does.`,
		ru: `Пункт \`Menu\`: его заголовок, когда он показан и доступен и что делает его выбор.`,
	},
	'MenuItemOptions.title': {
		en: `The item's text - or a function that gives it for the player it is shown to.`,
		ru: `Текст пункта — или функция, которая даёт его для игрока, которому он показан.`,
	},
	'MenuItemOptions.enabled': {
		en: `Whether the player can choose it; one he cannot is drawn grey and does nothing. \`true\` by default.`,
		ru: `Может ли игрок его выбрать; недоступный рисуется серым и ничего не делает. По умолчанию \`true\`.`,
	},
	'MenuItemOptions.visible': {
		en: `Whether it is shown at all; a hidden item takes no place. \`true\` by default.`,
		ru: `Показан ли он вообще; скрытый пункт не занимает места. По умолчанию \`true\`.`,
	},
	'MenuItemOptions.onSelect': {
		en: `The item's action, run when the player chooses it. The menu closes, unless this shows it again.`,
		ru: `Действие пункта, которое выполняется, когда игрок его выбирает. Меню закрывается, если эта функция не покажет его снова.`,
	},
	'Menu': {
		en: `
			A menu of AMX Mod X's own: items a player picks with the number keys, on
			pages with Back and More, and Exit. \`Data\` is what it is shown with, which
			its functions get beside the player.

			\`\`\`ts
			interface ShopData {
			  category: string;
			}

			const shop = new Menu<ShopData>("!yShop");
			shop.addItem({
			  title: "Armor - $1000",
			  enabled: ({ player }) => player.armor < 100,
			  onSelect: ({ player }) => {
			    player.armor = 100;
			  },
			});
			shop.show(player, { category: "armor" });
			\`\`\`

			The title and each item's title, \`visible\` and \`enabled\` are asked at
			every \`show\`, for that player. Colour tags as in \`showMenu\`: \`!y\` yellow,
			\`!r\` red, \`!d\` grey, \`!w\` white, \`!R\` to the right edge.

			Pawn: \`menu_create\`, \`menu_setprop\`
		`,
		ru: `
			Меню самого AMX Mod X: пункты, которые игрок выбирает цифровыми клавишами,
			на страницах с «Назад» и «Дальше», и «Выход». \`Data\` — то, с чем его
			показывают; это получают его функции рядом с игроком.

			\`\`\`ts
			interface ShopData {
			  category: string;
			}

			const shop = new Menu<ShopData>("!yShop");
			shop.addItem({
			  title: "Armor - $1000",
			  enabled: ({ player }) => player.armor < 100,
			  onSelect: ({ player }) => {
			    player.armor = 100;
			  },
			});
			shop.show(player, { category: "armor" });
			\`\`\`

			Заголовок и у каждого пункта заголовок, \`visible\` и \`enabled\` вычисляются
			при каждом \`show\`, для этого игрока. Цветовые теги — как в \`showMenu\`: \`!y\`
			жёлтый, \`!r\` красный, \`!d\` серый, \`!w\` белый, \`!R\` — к правому краю.

			Pawn: \`menu_create\`, \`menu_setprop\`
		`,
	},
	'Menu.addItem': {
		en: `
			Adds an item: its title, when it is shown and can be chosen, and what
			choosing it does.

			\`\`\`ts
			shop.addItem({
			  title: ({ player }) => \`Heal (\${player.health} HP)\`,
			  visible: ({ player }) => player.isAlive,
			  enabled: ({ player }) => player.health < 100,
			  onSelect: ({ player }) => {
			    player.health = 100;
			  },
			});
			\`\`\`

			Pawn: \`menu_additem\`
		`,
		ru: `
			Добавляет пункт: его заголовок, когда он показан и доступен и что делает
			его выбор.

			\`\`\`ts
			shop.addItem({
			  title: ({ player }) => \`Heal (\${player.health} HP)\`,
			  visible: ({ player }) => player.isAlive,
			  enabled: ({ player }) => player.health < 100,
			  onSelect: ({ player }) => {
			    player.health = 100;
			  },
			});
			\`\`\`

			Pawn: \`menu_additem\`
		`,
	},
	'Menu.show': {
		en: `
			Shows the menu to a player, with the data its functions get; it closes
			when he chooses an item or leaves it.

			Pawn: \`menu_display\`
		`,
		ru: `
			Показывает меню игроку, с данными, которые получают его функции; оно
			закрывается, когда он выбирает пункт или выходит из меню.

			Pawn: \`menu_display\`
		`,
	},
	'Client.kick': {
		en: `Kicks the player off the server, with the reason he is shown: \`client.kick("Spam")\`.`,
		ru: `Кикает игрока с сервера с причиной, которую он видит: \`client.kick("Спам")\`.`,
	},
	'Player.kick': {
		en: `
			Kicks the player off the server, with the reason he is shown:
			\`player.kick("Spam")\`; without one, the game's own.

			Pawn: \`server_cmd("kick #%d")\`
		`,
		ru: `
			Кикает игрока с сервера с причиной, которую он видит:
			\`player.kick("Спам")\`; без неё — собственной причиной игры.

			Pawn: \`server_cmd("kick #%d")\`
		`,
	},
	'CommandInfo': {
		en: `A command the plugin added, as \`server.commands\` lists it: what a \`/help\` shows.`,
		ru: `Команда, которую добавил плагин, как её перечисляет \`server.commands\`: то, что показывает \`/help\`.`,
	},
	'CommandInfo.usage': {
		en: `The command's usage, as it is typed, e.g. \`"/kick <target> [reason]"\`.`,
		ru: `Использование команды, как её набирают, например \`"/kick <target> [reason]"\`.`,
	},
	'CommandInfo.description': {
		en: `The command's description, as its \`description\` option gave it; \`""\` without one.`,
		ru: `Описание команды, как его дала настройка \`description\`; \`""\`, если описания нет.`,
	},
	'CommandInfo.access': {
		en: `The admin right the command needs; \`null\` when everyone may use it.`,
		ru: `Право админа, которое нужно команде; \`null\`, если пользоваться ей может каждый.`,
	},
	'CommandInfo.server': {
		en: `Whether it is a command of the server console rather than a player's.`,
		ru: `Команда ли это консоли сервера, а не игрока.`,
	},
	'Server.commands': {
		en: `
			The commands this plugin added, players' and the server's, in the order
			they were added: each one's \`usage\`, \`description\` and \`access\` - what a
			\`/help\` prints.

			\`\`\`ts
			server.addCommand("/help", ({ player }) => {
			  for (const command of server.commands) {
			    if (command.access == null || player.access.includes(command.access)) print(player, command.usage);
			  }
			});
			\`\`\`
		`,
		ru: `
			Команды, которые добавил этот плагин, игроков и сервера, в порядке
			добавления: у каждой \`usage\`, \`description\` и \`access\` — то, что
			печатает \`/help\`.

			\`\`\`ts
			server.addCommand("/help", ({ player }) => {
			  for (const command of server.commands) {
			    if (command.access == null || player.access.includes(command.access)) print(player, command.usage);
			  }
			});
			\`\`\`
		`,
	},
};
