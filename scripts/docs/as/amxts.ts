// The tooltips of as/amxts.d.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'AmxtsModuleMeta': {
		en: `A module's name and config key.`,
		ru: `Имя модуля и ключ его настроек.`,
	},
	'AmxtsModuleMeta.name': {
		en: `The package's name without its scope, e.g. \`"menu-core"\` for \`@amxts/menu-core\`.`,
		ru: `Имя пакета без scope, например \`"menu-core"\` для \`@amxts/menu-core\`.`,
	},
	'AmxtsModuleMeta.configKey': {
		en: `The key the module's options go under in \`amxts.config.ts\`, e.g. \`"menus"\`.`,
		ru: `Ключ настроек модуля в \`amxts.config.ts\`, например \`"menus"\`.`,
	},
	'AmxtsModuleImport': {
		en: `A module's API as plugins use it without an import: a namespace and its name (\`as\`), or one of its exports by its own name (\`name\`).`,
		ru: `API модуля, каким плагины пользуются без импорта: пространство имён и его имя (\`as\`) или один из его экспортов под своим именем (\`name\`).`,
	},
	'AmxtsModuleImport.from': {
		en: `The module's own package, e.g. \`"@amxts/menu-core"\`.`,
		ru: `Собственный пакет модуля, например \`"@amxts/menu-core"\`.`,
	},
	'AmxtsModuleImport.as': {
		en: `The name plugins use it by, e.g. \`"menus"\`: \`menus.create(...)\`.`,
		ru: `Имя, под которым его используют плагины, например \`"menus"\`: \`menus.create(...)\`.`,
	},
	'AmxtsModuleImport.name': {
		en: `One export plugins use by its own name, e.g. \`"semiclip"\`: \`semiclip.rule = ...\`.`,
		ru: `Один экспорт, которым плагины пользуются под его собственным именем, например \`"semiclip"\`: \`semiclip.rule = ...\`.`,
	},
	'AmxtsModule': {
		en: `A module's definition for \`defineModule\`: its meta, the modules it requires, its options, what it gives plugins and its setup.`,
		ru: `Описание модуля для \`defineModule\`: meta, модули, от которых он зависит, настройки, что он даёт плагинам, и setup.`,
	},
	'AmxtsModule.meta': {
		en: `The module's name and \`configKey\`.`,
		ru: `Имя модуля и его \`configKey\`.`,
	},
	'AmxtsModule.requires': {
		en: `The module packages this one needs, e.g. \`"@amxts/config-core"\`. They come along with it - listing this one in \`amxts.config.ts\` is enough - and load first.`,
		ru: `Пакеты модулей, от которых зависит этот, например \`"@amxts/config-core"\`. Они подключаются вместе с ним — в \`amxts.config.ts\` достаточно указать этот — и загружаются раньше.`,
	},
	'AmxtsModule.defaults': {
		en: `The module's default options: the values used when \`amxts.config.ts\` does not set them.`,
		ru: `Настройки модуля по умолчанию: значения, если \`amxts.config.ts\` их не задаёт.`,
	},
	'AmxtsModule.imports': {
		en: `
			The module's API as plugins use it without an import, e.g. \`[{ from: "@amxts/menu-core", as: "menus" }]\`:
			a plugin writes \`menus.create(...)\`, and the build adds the import to
			that plugin alone. \`{ from, name }\` gives one export by its own name
			instead - an object a plugin assigns a property of, as \`semiclip.rule = ...\`.
		`,
		ru: `
			API модуля, каким плагины пользуются без импорта, например \`[{ from: "@amxts/menu-core", as: "menus" }]\`:
			плагин пишет \`menus.create(...)\`, а сборка добавляет импорт только в
			этот плагин. \`{ from, name }\` вместо этого даёт один экспорт под его
			именем — объект, свойство которого плагин присваивает, как \`semiclip.rule = ...\`.
		`,
	},
	'AmxtsModule.setup': {
		en: `
			Runs once, in the module's plugin, when the server loads it. Gets the
			defaults with what \`amxts.config.ts\` sets under \`configKey\` on top.
		`,
		ru: `
			Выполняется один раз, в плагине модуля, когда сервер его загружает.
			Получает \`defaults\`, поверх которых наложено то, что \`amxts.config.ts\`
			задаёт под \`configKey\`.
		`,
	},
	'AmxtsConfig': {
		en: `The project's settings, exported by \`amxts.config.ts\`: the modules it uses and their options.`,
		ru: `Настройки проекта, которые экспортирует \`amxts.config.ts\`: модули проекта и их настройки.`,
	},
	'AmxtsConfig.modules': {
		en: `The project's module packages, by name, e.g. \`"@amxts/menu-core"\`. The build loads each after the ones it requires.`,
		ru: `Пакеты модулей проекта по имени, например \`"@amxts/menu-core"\`. Сборка загружает каждый после тех, от которых он зависит.`,
	},
	'AmxtsConfig.pluginsDir': {
		en: `The folder with the project's plugins; \`"plugins"\` by default.`,
		ru: `Папка с плагинами проекта; по умолчанию \`"plugins"\`.`,
	},
	'AmxtsConfig.outDir': {
		en: `The folder the build writes the \`.aot\` files and \`plugins.ini\` to; \`"dist"\` by default.`,
		ru: `Папка, куда сборка пишет файлы \`.aot\` и \`plugins.ini\`; по умолчанию \`"dist"\`.`,
	},
	'AmxtsConfig.target': {
		en: `
			The server the project is for, one of \`"rehlds"\` (ReHLDS, ReGameDLL and
			ReAPI) or \`"hlds"\` (plain HLDS); \`"rehlds"\` by default. Without a server
			(\`AMXTS_SERVER\`) the \`amxts\` command fetches the includes that server has
			into \`.amxts/include\`; with one, the build takes the server's own.
		`,
		ru: `
			Для какого сервера проект, одно из \`"rehlds"\` (ReHLDS, ReGameDLL и ReAPI)
			или \`"hlds"\` (обычный HLDS); по умолчанию \`"rehlds"\`. Без сервера (\`AMXTS_SERVER\`)
			команда \`amxts\` скачивает include такого сервера в \`.amxts/include\`; с
			сервером сборка берёт его собственные.
		`,
	},
	'AmxtsConfig.imports': {
		en: `
			Auto-imports: the build adds the imports of what a plugin uses without
			importing it - the core's API and what the modules give. \`{ autoImport:
			false }\` turns them off; the plugins import everything themselves.
		`,
		ru: `
			Автоимпорты: сборка добавляет импорты того, что плагин использует без
			импорта, - API ядра и того, что дают модули. \`{ autoImport: false }\`
			выключает их; плагины импортируют всё сами.
		`,
	},
	'AmxtsImports': {
		en: `The project's auto-imports: \`imports\` in \`amxts.config.ts\`.`,
		ru: `Автоимпорты проекта: \`imports\` в \`amxts.config.ts\`.`,
	},
	'AmxtsImports.autoImport': {
		en: `\`false\`: the plugins import everything themselves. \`true\` by default.`,
		ru: `\`false\`: плагины импортируют всё сами. По умолчанию \`true\`.`,
	},
	'AmxtsConfig.pawn': {
		en: `
			The modules whose natives Pawn plugins call, by package name, e.g.
			\`"@amxts/menu-core"\`. A module no plugin of the project uses is left out
			of the build; one listed here is built all the same.
		`,
		ru: `
			Модули, чьи нативы вызывают Pawn-плагины, по имени пакета, например
			\`"@amxts/menu-core"\`. Модуль, которым не пользуется ни один плагин
			проекта, в сборку не попадает; перечисленный здесь собирается всё равно.
		`,
	},
	'defineModule': {
		en: `
			Defines a module, in its module file:

			\`\`\`ts
			export default defineModule<MenuCoreOptions>({
			  meta: { name: "menu-core", configKey: "menus" },
			  requires: ["@amxts/config-core"],
			  defaults: { file: "menu" },
			  imports: [{ from: "@amxts/menu-core", as: "menus" }],
			  setup(options) { ... },
			});
			\`\`\`
		`,
		ru: `
			Описывает модуль в его файле модуля:

			\`\`\`ts
			export default defineModule<MenuCoreOptions>({
			  meta: { name: "menu-core", configKey: "menus" },
			  requires: ["@amxts/config-core"],
			  defaults: { file: "menu" },
			  imports: [{ from: "@amxts/menu-core", as: "menus" }],
			  setup(options) { ... },
			});
			\`\`\`
		`,
	},
	'defineConfig': {
		en: `
			Defines the project's settings, in \`amxts.config.ts\`:

			\`\`\`ts
			export default defineConfig({
			  modules: ["@amxts/config-core", "@amxts/menu-core"],
			  menus: { file: "myserver/menu" },
			});
			\`\`\`
		`,
		ru: `
			Описывает настройки проекта в \`amxts.config.ts\`:

			\`\`\`ts
			export default defineConfig({
			  modules: ["@amxts/config-core", "@amxts/menu-core"],
			  menus: { file: "myserver/menu" },
			});
			\`\`\`
		`,
	},
	'PlayerChangeEvent.value': {
		en: `The field's value after the change; with \`{ field }\`, of the field's type.`,
		ru: `Значение поля после изменения; с \`{ field }\` — типа этого поля.`,
	},
	'PlayerChangeEvent.previous': {
		en: `The field's value before the change.`,
		ru: `Значение поля до изменения.`,
	},
	'Server.addEventListener': {
		en: `
			Calls \`listener\` every time the field \`field\` plugins added to \`Player\`
			changes on a player, e.g. \`{ field: "spawnProtected" }\`: \`event.value\`
			and \`event.previous\` have the field's type.
		`,
		ru: `
			Вызывает \`listener\` каждый раз, когда у игрока меняется поле \`field\`,
			которое плагины добавили в \`Player\`, например
			\`{ field: "spawnProtected" }\`: у \`event.value\` и \`event.previous\` тип
			этого поля.
		`,
	},
	'Server.removeEventListener': {
		en: `Stops calling a listener added with \`addEventListener\` - the same function and the same field.`,
		ru: `Перестаёт вызывать обработчик, добавленный через \`addEventListener\`, — ту же функцию с тем же полем.`,
	},
	'Server.addCommand': {
		en: `
			Adds a command players type, by its usage: the name, then the
			arguments, \`<name>\` required and \`[name]\` optional. Their types are an
			interface, the type argument; without it each is text.

			\`\`\`ts
			interface KickArgs {
			  target: Player;
			  reason?: string;
			}

			server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
			  target.kick(reason ?? \`Kicked by \${player.name}\`);
			}, { access: "kick" });
			server.addCommand("/hp", ({ player }) => print(player, \`\${player.health} HP\`));
			\`\`\`

			A name with \`/\` is a chat command, one without a console command, and
			\`"say <phrase>"\` a phrase written in chat. A \`number\` argument is
			parsed, a \`Player\` found by \`#userid\`, the whole name or a part of it,
			a \`string\` taken as it is - the last one takes the rest of the line. A
			word that is not what the command takes answers the player with the
			usage, and the handler does not run.

			Pawn: \`register_clcmd\`
		`,
		ru: `
			Добавляет команду, которую набирают игроки, по её использованию: имя,
			затем аргументы, \`<name>\` — обязательный, \`[name]\` — необязательный.
			Их типы — интерфейс, аргумент типа; без него каждый — текст.

			\`\`\`ts
			interface KickArgs {
			  target: Player;
			  reason?: string;
			}

			server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
			  target.kick(reason ?? \`Kicked by \${player.name}\`);
			}, { access: "kick" });
			server.addCommand("/hp", ({ player }) => print(player, \`\${player.health} HP\`));
			\`\`\`

			Имя со \`/\` — команда чата, без него — команда консоли, а
			\`"say <фраза>"\` — фраза, написанная в чат. Аргумент \`number\`
			разбирается как число, \`Player\` находится по \`#userid\`, имени целиком
			или его части, \`string\` берётся как есть — последний забирает остаток
			строки. На слово, которое команда не принимает, игрок получает её
			использование, и обработчик не запускается.

			Pawn: \`register_clcmd\`
		`,
	},
	'Server.addServerCommand': {
		en: `
			Adds a command of the server console - typed there, sent over rcon or
			run by another plugin - by its usage, its arguments read as a player's
			command's are. No player types it.

			\`\`\`ts
			interface ResetArgs {
			  what?: "scores" | "all";
			}

			server.addServerCommand<ResetArgs>("myplugin_reset [what]", ({ what }) => reset(what ?? "all"));
			\`\`\`

			Pawn: \`register_srvcmd\`
		`,
		ru: `
			Добавляет команду консоли сервера — её набирают там, присылают по rcon
			или запускает другой плагин — по её использованию; аргументы читаются
			так же, как у команды игрока. Игрок её не набирает.

			\`\`\`ts
			interface ResetArgs {
			  what?: "scores" | "all";
			}

			server.addServerCommand<ResetArgs>("myplugin_reset [what]", ({ what }) => reset(what ?? "all"));
			\`\`\`

			Pawn: \`register_srvcmd\`
		`,
	},
};
