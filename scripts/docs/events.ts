// Our own words for the server events, in both languages the project speaks.
//
// scripts/generate-host.ts writes these into as/events.ts as the tooltips an
// editor shows on `server.addEventListener("...")`, on the event class and on
// each of its fields. The language is AMXTS_DOCS_LANG in .env ("en" by
// default, or "ru"). An event missing here, or missing a language, falls back
// to English and then to the AMX Mod X include's own comment - so the list is
// always complete and is made better one entry at a time.
//
// Written for someone who knows TypeScript and not Pawn: what happened, when,
// and what the fields are - not how AMX Mod X implements it. Keyed by the
// forward's full name; fields by their name on the event object.

export interface Text {
	en: string;
	ru: string;
}

export interface EventDoc {
	summary: Text;
	/** Things worth knowing before relying on the event. */
	notes?: Text[];
	fields?: Record<string, Text>;
	/** One short listener - shown as @example. */
	example?: string;
}

const player: Text = {
	en: `The player the event is about.`,
	ru: `Игрок, о котором событие.`,
};

export const EVENTS: Record<string, EventDoc> = {
	plugin_init: {
		summary: {
			en: `The plugin has loaded: register commands, events and hooks here.`,
			ru: `Плагин загрузился: здесь регистрируют команды, события и хуки.`,
		},
		notes: [{
			en: `Top-level code in the plugin file runs at the same moment, so most plugins never need this event.`,
			ru: `Код на верхнем уровне файла плагина выполняется в тот же момент, поэтому большинству плагинов это событие не нужно.`,
		}],
	},
	plugin_precache: {
		summary: {
			en: `The map is loading: the only moment models, sounds and sprites can be precached.`,
			ru: `Карта загружается: единственный момент, когда можно подгрузить (precache) модели, звуки и спрайты.`,
		},
		notes: [{
			en: `A hot reload of the plugin does not run it again: precaching needs a map change.`,
			ru: `Горячая перезагрузка плагина его не повторяет: для precache нужна смена карты.`,
		}],
	},
	plugin_cfg: {
		summary: {
			en: `Every config has been read and every plugin is loaded: the moment to read cvars and to create forwards other plugins listen to.`,
			ru: `Все конфиги прочитаны, все плагины загружены: момент читать квары и создавать форварды для других плагинов.`,
		},
	},
	plugin_end: {
		summary: {
			en: `The map is ending or the server is shutting down: save what has to survive.`,
			ru: `Карта заканчивается или сервер выключается: сохраните то, что должно пережить смену карты.`,
		},
	},
	plugin_pause: {
		summary: { en: `An admin paused this plugin.`, ru: `Админ поставил плагин на паузу.` },
	},
	plugin_unpause: {
		summary: { en: `An admin resumed this plugin.`, ru: `Админ снял плагин с паузы.` },
	},
	server_changelevel: {
		summary: {
			en: `The server is about to change the map.`,
			ru: `Сервер сейчас сменит карту.`,
		},
		fields: {
			map: { en: `The map the server changes to, e.g. \`"de_dust2"\`.`, ru: `Карта, на которую переходит сервер, например \`"de_dust2"\`.` },
		},
	},
	client_connect: {
		summary: {
			en: `A player started connecting. The player is not in the game yet: show him anything after \`"putInServer"\`.`,
			ru: `Игрок начал подключаться. В игре его ещё нет: показывать ему что-то можно после \`"putInServer"\`.`,
		},
		fields: { player },
	},
	client_connectex: {
		summary: {
			en: `A player started connecting, with a name and an address: the place to turn him away.`,
			ru: `Игрок начал подключаться, уже с именем и адресом: здесь его можно не пустить.`,
		},
		fields: {
			player,
			name: { en: `The name the player connects with.`, ru: `Имя, с которым игрок заходит.` },
			ip: { en: `The player's address with the port, e.g. \`"192.168.0.5:27005"\`.`, ru: `Адрес игрока с портом, например \`"192.168.0.5:27005"\`.` },
			reason: {
				en: `The message the player sees if he is turned away.`,
				ru: `Сообщение, которое игрок увидит, если его не пустят.`,
			},
		},
	},
	client_authorized: {
		summary: {
			en: `A player's SteamID is known. May come before or after \`"putInServer"\`.`,
			ru: `Стал известен SteamID игрока. Может прийти до или после \`"putInServer"\`.`,
		},
		notes: [{ en: `A bot's SteamID is \`"BOT"\`.`, ru: `SteamID бота — \`"BOT"\`.` }],
		fields: {
			player,
			steamId: { en: `The player's SteamID, e.g. \`"STEAM_0:1:12345"\`. A bot has \`"BOT"\`, HLTV has \`"HLTV"\`; on a LAN server it is \`"STEAM_ID_LAN"\`. With Reunion a game without Steam gets one made from its key: \`"STEAM_..."\` or \`"VALVE_..."\`, as the server's Reunion settings say.`, ru: `SteamID игрока, например \`"STEAM_0:1:12345"\`. У бота — \`"BOT"\`, у HLTV — \`"HLTV"\`; на LAN-сервере — \`"STEAM_ID_LAN"\`. С Reunion игра без Steam получает SteamID, сделанный из её ключа: \`"STEAM_..."\` или \`"VALVE_..."\`, как скажут настройки Reunion на сервере.` },
		},
	},
	client_putinserver: {
		summary: {
			en: `A player has joined and is in the game: the moment to greet him.`,
			ru: `Игрок зашёл и уже в игре: момент поприветствовать его.`,
		},
		fields: { player },
		example: `server.addEventListener("putInServer", (event) => {\n\tprint(event.player, "Welcome!");\n});`,
	},
	client_disconnected: {
		summary: {
			en: `A player left the server: quit, timed out or was kicked.`,
			ru: `Игрок покинул сервер: вышел сам, отвалился или был кикнут.`,
		},
		notes: [{
			en: `The player can still be read here (name, team), but nothing reaches his screen any more.`,
			ru: `Игрока здесь ещё можно прочитать (имя, команду), но на экран ему уже ничего не дойдёт.`,
		}],
		fields: {
			player,
			dropped: {
				en: `\`true\` when the server dropped the player (kick, timeout) rather than he left.`,
				ru: `\`true\`, если игрока отключил сервер (кик, таймаут), а не он вышел сам.`,
			},
			reason: {
				en: `The reason the server gives for the leave; empty when the player just quit.`,
				ru: `Причина выхода, как её сообщает сервер; пусто, если игрок просто вышел.`,
			},
		},
		example: `server.addEventListener("disconnected", (event) => {\n\tconsole.log(\`\${event.player.name} left: \${event.reason}\`);\n});`,
	},
	client_remove: {
		summary: {
			en: `A player's slot is being freed, after \`"disconnected"\`.`,
			ru: `Слот игрока освобождается, после \`"disconnected"\`.`,
		},
		fields: {
			player,
			dropped: { en: `\`true\` when the server dropped the player.`, ru: `\`true\`, если игрока отключил сервер.` },
			reason: { en: `The reason the player left.`, ru: `Причина выхода игрока.` },
		},
	},
	client_command: {
		summary: {
			en: `A player sent a console command. For one command, \`server.addCommand("name", handler)\` is simpler.`,
			ru: `Игрок отправил консольную команду. Для одной команды проще \`server.addCommand("name", handler)\`.`,
		},
		fields: { player },
	},
	client_infochanged: {
		summary: {
			en: `A player changed his info, usually the name.`,
			ru: `Игрок поменял свои данные, обычно ник.`,
		},
		fields: { player },
	},
	client_kill: {
		summary: {
			en: `A player typed \`"kill"\` in the console to kill himself.`,
			ru: `Игрок написал \`"kill"\` в консоли, чтобы убить себя.`,
		},
		fields: { player },
	},
	client_impulse: {
		summary: {
			en: `A player sent an impulse: \`100\` is the flashlight, \`201\` the spray.`,
			ru: `Игрок отправил impulse: \`100\` — фонарик, \`201\` — спрей.`,
		},
		fields: {
			player,
			impulse: { en: `The impulse number: \`100\`, \`201\`.`, ru: `Номер impulse: \`100\`, \`201\`.` },
		},
	},
	server_frame: {
		summary: {
			en: `A server frame, hundreds of times a second. Keep the listener tiny, or use \`setInterval\`.`,
			ru: `Кадр сервера, сотни раз в секунду. Обработчик должен быть очень лёгким, иначе используйте \`setInterval\`.`,
		},
	},
	pfn_think: {
		summary: {
			en: `An entity thinks: its scheduled update has come. Any entity's; one class's is \`game.addEventListener("think", listener, { classname })\`.`,
			ru: `Сущность «думает»: пришло её запланированное обновление. Любой сущности; одного класса — \`game.addEventListener("think", listener, { classname })\`.`,
		},
		fields: { entity: { en: `The entity that thinks.`, ru: `Сущность, которая «думает».` } },
	},
	pfn_spawn: {
		summary: {
			en: `An entity is being spawned on the map, the map's own too as it loads. A player's spawn is \`game.addEventListener("spawn", listener)\`.`,
			ru: `На карте появляется сущность, в том числе сущности самой карты, пока она загружается. Появление игрока — \`game.addEventListener("spawn", listener)\`.`,
		},
		fields: { entity: { en: `The entity being spawned.`, ru: `Сущность, которая появляется.` } },
	},
	pfn_playbackevent: {
		summary: {
			en: `The engine plays an event to the clients: a shot, a weapon's sound and effects.`,
			ru: `Движок проигрывает клиентам событие: выстрел, звук и эффекты оружия.`,
		},
		fields: {
			flags: { en: `The event's flags, how the engine sends it.`, ru: `Флаги события — как движок его отправляет.` },
			entity: { en: `The entity the event plays on, usually the player who fired.`, ru: `Сущность, на которой играет событие, — обычно игрок, который выстрелил.` },
			eventIndex: { en: `The event's index in the precached events.`, ru: `Номер события среди загруженных заранее событий.` },
			delay: { en: `The seconds before the event plays.`, ru: `Секунды до того, как событие проиграется.` },
			origin: { en: `The point the event plays from.`, ru: `Точка, откуда проигрывается событие.` },
			angles: { en: `The angles the event plays with.`, ru: `Углы, с которыми проигрывается событие.` },
			fparam1: { en: `The event's first fractional parameter.`, ru: `Первый дробный параметр события.` },
			fparam2: { en: `The event's second fractional parameter.`, ru: `Второй дробный параметр события.` },
			iparam1: { en: `The event's first whole-number parameter.`, ru: `Первый целый параметр события.` },
			iparam2: { en: `The event's second whole-number parameter.`, ru: `Второй целый параметр события.` },
			bparam1: { en: `The event's first flag parameter, \`1\` or \`0\`.`, ru: `Первый параметр-флаг события, \`1\` или \`0\`.` },
			bparam2: { en: `The event's second flag parameter, \`1\` or \`0\`.`, ru: `Второй параметр-флаг события, \`1\` или \`0\`.` },
		},
	},
};

/** `"playerChange"`: an event of the core's, not a forward - its class and fields are the facade's. */
export const PLAYER_CHANGE: EventDoc = {
	summary: {
		en: `A field plugins added to \`Player\` changed on a player; \`{ field: "spawnProtected" }\` hears one field.`,
		ru: `У игрока изменилось поле, которое плагины добавили в \`Player\`; \`{ field: "spawnProtected" }\` слушает одно поле.`,
	},
};
