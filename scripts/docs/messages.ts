// Our own words for the messages the server sends its clients, as
// server.addEventListener("message:<Name>", ...) hears them - in both
// languages. scripts/generate-host.ts writes them into as/events.ts as the
// tooltips an editor shows on the name, the event and its fields. A message
// without an entry has the words of every message: its arguments by number.
import type { EventDoc, Text } from './events';

const receiver: Text = { en: `The player the message goes to.`, ru: `Игрок, которому идёт сообщение.` };
const seconds: Text = { en: `The seconds the bar or the clock shows. Assign to change them.`, ru: `Секунды, которые показывают полоса или часы. Присвойте, чтобы изменить.` };
const params: Text = {
	en: `The texts put into the game's text in place of \`%s1\`, \`%s2\`, ... - e.g. a player's name. Assign to change them; their number stays.`,
	ru: `Тексты, которые подставляются в текст игры вместо \`%s1\`, \`%s2\`, ... — например, имя игрока. Присвойте, чтобы изменить; их число остаётся.`,
};
const battery: Text = { en: `The flashlight's battery, in percent.`, ru: `Заряд фонарика, в процентах.` };
const health: Text = { en: `The health shown.`, ru: `Показанное здоровье.` };
const hostage: Text = { en: `The hostage's number on the map, from \`1\`.`, ru: `Номер заложника на карте, с \`1\`.` };
const text: Text = { en: `The text, or the game's own for it, e.g. \`"#Hint_press_buy_to_purchase"\`.`, ru: `Текст или собственный текст игры, например \`"#Hint_press_buy_to_purchase"\`.` };

export const MESSAGES: Record<string, EventDoc> = {
	ADStop: {
		summary: { en: `A player's HUD stops showing the round's advertisement.`, ru: `HUD игрока перестаёт показывать рекламу раунда.` },
	},
	AllowSpec: {
		summary: { en: `Whether a player may pick Spectate in the team menu.`, ru: `Можно ли игроку выбрать «Наблюдать» в меню команды.` },
		fields: { allowed: { en: `\`true\` when the menu offers it.`, ru: `\`true\`, когда меню это предлагает.` } },
	},
	AmmoPickup: {
		summary: { en: `A player picks up ammo: the notice at the side of his screen.`, ru: `Игрок подбирает патроны: уведомление сбоку экрана.` },
		fields: {
			ammo: { en: `The ammo's index in the game's list of kinds.`, ru: `Индекс патронов в списке видов у игры.` },
			amount: { en: `The amount picked up.`, ru: `Подобранное количество.` },
		},
	},
	AmmoX: {
		summary: { en: `A player's reserve ammo of one kind on his HUD changes.`, ru: `Меняется запас патронов одного вида на HUD игрока.` },
		fields: {
			ammo: { en: `The ammo's index in the game's list of kinds.`, ru: `Индекс патронов в списке видов у игры.` },
			amount: { en: `The reserve shown.`, ru: `Показанный запас.` },
		},
	},
	ArmorType: {
		summary: { en: `The armour icon on a player's HUD: a vest, or a vest and a helmet.`, ru: `Значок брони на HUD игрока: жилет или жилет со шлемом.` },
		fields: { helmet: { en: `\`true\` for a vest and a helmet.`, ru: `\`true\` — жилет со шлемом.` } },
	},
	BarTime: {
		summary: { en: `The progress bar in the middle of a player's screen is shown or hidden.`, ru: `Полосу прогресса посреди экрана игрока показывают или прячут.` },
		fields: { seconds },
	},
	BarTime2: {
		summary: { en: `The progress bar in the middle of a player's screen, starting part of the way full.`, ru: `Полоса прогресса посреди экрана игрока, начатая не с нуля.` },
		fields: {
			seconds,
			startPercent: { en: `The bar's fill at the start, in percent.`, ru: `Заполненность полосы в начале, в процентах.` },
		},
	},
	Battery: {
		summary: { en: `A player's armour on his HUD changes.`, ru: `Меняется броня игрока на его HUD.` },
		fields: { armor: { en: `The armour shown.`, ru: `Показанная броня.` } },
	},
	BlinkAcct: {
		summary: { en: `A player's money on his HUD blinks: he cannot afford what he tried to buy.`, ru: `Деньги на HUD игрока мигают: ему не хватает на покупку.` },
		fields: { blinks: { en: `The number of blinks.`, ru: `Число миганий.` } },
	},
	BombDrop: {
		summary: { en: `The bomb on the terrorists' radar: dropped or planted.`, ru: `Бомба на радаре террористов: брошена или заложена.` },
		fields: {
			origin: { en: `The point where the bomb lies.`, ru: `Точка, где лежит бомба.` },
			planted: { en: `\`true\` for a bomb planted, \`false\` for one dropped.`, ru: `\`true\` — бомба заложена, \`false\` — брошена.` },
		},
	},
	BombPickup: {
		summary: { en: `The bomb is picked up: it leaves the terrorists' radar.`, ru: `Бомбу подобрали: она пропадает с радара террористов.` },
	},
	BotVoice: {
		summary: { en: `The voice icon over a bot who talks on the radio.`, ru: `Значок голоса над ботом, который говорит по рации.` },
		fields: {
			talking: { en: `\`true\` while the bot talks.`, ru: `\`true\`, пока бот говорит.` },
			target: { en: `The bot who talks.`, ru: `Бот, который говорит.` },
		},
	},
	BuyClose: {
		summary: { en: `A player's buy menu is closed.`, ru: `Меню закупки игрока закрывается.` },
	},
	ClCorpse: {
		summary: { en: `A dead player's body is left on the ground for the clients to draw.`, ru: `Тело погибшего игрока остаётся на земле, чтобы клиенты его нарисовали.` },
		fields: {
			model: { en: `The body's model, e.g. \`"sas"\`.`, ru: `Модель тела, например \`"sas"\`.` },
			team: { en: `The team of the player whose body it is.`, ru: `Команда игрока, чьё это тело.` },
			target: { en: `The player whose body it is.`, ru: `Игрок, чьё это тело.` },
		},
	},
	Crosshair: {
		summary: { en: `Counter-Strike's own crosshair on a player's screen is shown or hidden.`, ru: `Собственный прицел Counter-Strike на экране игрока показывают или прячут.` },
		fields: { shown: { en: `\`true\` to show it.`, ru: `\`true\` — показать.` } },
	},
	CurWeapon: {
		summary: { en: `The weapon in a player's hands and its clip on his HUD.`, ru: `Оружие в руках игрока и его обойма на HUD.` },
		fields: {
			active: { en: `\`true\` for the weapon in his hands.`, ru: `\`true\` — для оружия в его руках.` },
			weapon: { en: `The weapon, by its kind, e.g. \`"ak47"\`.`, ru: `Оружие по его виду, например \`"ak47"\`.` },
			clip: { en: `The rounds in the clip.`, ru: `Патроны в обойме.` },
		},
	},
	Damage: {
		summary: { en: `A player is shown the damage he took: the red marks at the side of his screen.`, ru: `Игроку показывают полученный урон: красные метки сбоку экрана.` },
		fields: {
			armor: { en: `The armour he lost.`, ru: `Потерянная броня.` },
			damage: { en: `The health he lost.`, ru: `Потерянное здоровье.` },
			damageType: { en: `The kinds of damage, e.g. \`"Fall"\`, \`"Bullet"\`.`, ru: `Виды урона, например \`"Fall"\`, \`"Bullet"\`.` },
			origin: { en: `The point the damage came from: the marks point to it.`, ru: `Точка, откуда пришёл урон: метки указывают на неё.` },
		},
	},
	DeathMsg: {
		summary: { en: `A kill in the top right corner of every screen.`, ru: `Убийство в правом верхнем углу каждого экрана.` },
		fields: {
			killer: { en: `The player who killed; \`null\` for the world.`, ru: `Игрок, который убил; \`null\` — мир.` },
			victim: { en: `The player who died.`, ru: `Игрок, который погиб.` },
			headshot: { en: `\`true\` for a headshot.`, ru: `\`true\` — выстрел в голову.` },
			weapon: { en: `The weapon's name as the icon shows it, e.g. \`"ak47"\`, \`"grenade"\`.`, ru: `Имя оружия, как его показывает значок, например \`"ak47"\`, \`"grenade"\`.` },
		},
	},
	Flashlight: {
		summary: { en: `The flashlight icon on a player's HUD: on or off, and its battery.`, ru: `Значок фонарика на HUD игрока: включён ли он, и его заряд.` },
		fields: {
			on: { en: `\`true\` while the flashlight is on.`, ru: `\`true\`, пока фонарик включён.` },
			battery,
		},
	},
	FlashBat: {
		summary: { en: `The flashlight's battery on a player's HUD changes.`, ru: `Меняется заряд фонарика на HUD игрока.` },
		fields: { battery },
	},
	Geiger: {
		summary: { en: `The Geiger counter's clicks a player hears near radiation.`, ru: `Щелчки счётчика Гейгера, которые игрок слышит рядом с радиацией.` },
		fields: { range: { en: `The distance to the radiation: the less, the faster the clicks.`, ru: `Расстояние до радиации: чем меньше, тем чаще щелчки.` } },
	},
	Health: {
		summary: { en: `A player's health on his HUD changes.`, ru: `Меняется здоровье игрока на его HUD.` },
		fields: { health },
	},
	HideWeapon: {
		summary: { en: `The parts of a player's HUD that are hidden change.`, ru: `Меняются скрытые части HUD игрока.` },
		fields: { flags: { en: `The hidden parts, e.g. \`"Money"\`, \`"Timer"\`. Assign to change them.`, ru: `Скрытые части, например \`"Money"\`, \`"Timer"\`. Присвойте, чтобы изменить.` } },
	},
	HostageK: {
		summary: { en: `A hostage is killed: it leaves the counter-terrorists' radar.`, ru: `Заложник убит: он пропадает с радара спецназа.` },
		fields: { hostage },
	},
	HostagePos: {
		summary: { en: `A hostage on the counter-terrorists' radar.`, ru: `Заложник на радаре спецназа.` },
		fields: {
			hostage,
			origin: { en: `The point where the hostage is.`, ru: `Точка, где находится заложник.` },
		},
	},
	HudText: {
		summary: { en: `A hint in the middle of a player's screen.`, ru: `Подсказка посреди экрана игрока.` },
		fields: { text },
	},
	HudTextArgs: {
		summary: { en: `A hint in the middle of a player's screen, from the game's own texts.`, ru: `Подсказка посреди экрана игрока из собственных текстов игры.` },
		fields: { text, params },
	},
	HudTextPro: {
		summary: { en: `A hint in the middle of a player's screen, for a player new to the game.`, ru: `Подсказка посреди экрана игрока — для новичка.` },
		fields: { text },
	},
	InitHUD: {
		summary: { en: `A player's HUD is set up, when he enters the game.`, ru: `HUD игрока готовится, когда он входит в игру.` },
	},
	ItemPickup: {
		summary: { en: `A player picks up an item: the notice at the side of his screen.`, ru: `Игрок подбирает предмет: уведомление сбоку экрана.` },
		fields: { item: { en: `The item's class name, e.g. \`"item_kevlar"\`.`, ru: `Имя класса предмета, например \`"item_kevlar"\`.` } },
	},
	ItemStatus: {
		summary: { en: `The night vision and the defuse kit a player has, for his HUD.`, ru: `Прибор ночного видения и набор сапёра, которые есть у игрока, для его HUD.` },
		fields: {
			nightVision: { en: `\`true\` when the player has night vision.`, ru: `\`true\`, когда у игрока есть ночное видение.` },
			defuseKit: { en: `\`true\` when the player has a defuse kit.`, ru: `\`true\`, когда у игрока есть набор сапёра.` },
		},
	},
	Location: {
		summary: { en: `The place on the map a player is in, as the radio names it.`, ru: `Место на карте, где находится игрок, как его называет рация.` },
		fields: {
			target: { en: `The player whose place it is.`, ru: `Игрок, чьё это место.` },
			place: { en: `The place's name, e.g. \`"BombsiteA"\`.`, ru: `Имя места, например \`"BombsiteA"\`.` },
		},
	},
	Money: {
		summary: { en: `A player's money on his HUD changes.`, ru: `Меняются деньги игрока на его HUD.` },
		fields: {
			amount: { en: `The money shown.`, ru: `Показанные деньги.` },
			flash: { en: `\`true\` to flash the change.`, ru: `\`true\` — мигнуть изменением.` },
		},
	},
	MOTD: {
		summary: { en: `A part of the message of the day, the window a joining player sees.`, ru: `Часть сообщения дня — окна, которое видит вошедший игрок.` },
		fields: {
			last: { en: `\`true\` for the last part: the window opens.`, ru: `\`true\` — последняя часть: окно открывается.` },
			text: { en: `The part's text.`, ru: `Текст части.` },
		},
	},
	NVGToggle: {
		summary: { en: `A player's night vision is turned on or off.`, ru: `Ночное видение игрока включают или выключают.` },
		fields: { on: { en: `\`true\` while night vision is on.`, ru: `\`true\`, пока ночное видение включено.` } },
	},
	Radar: {
		summary: { en: `A teammate on a player's radar.`, ru: `Союзник на радаре игрока.` },
		fields: {
			target: { en: `The teammate shown.`, ru: `Показанный союзник.` },
			origin: { en: `The point where the teammate is.`, ru: `Точка, где находится союзник.` },
		},
	},
	ReqState: {
		summary: { en: `The game asks a player's client for its state, for the voice.`, ru: `Игра запрашивает у клиента игрока его состояние — для голоса.` },
	},
	ResetHUD: {
		summary: { en: `A player's HUD is reset, at his spawn.`, ru: `HUD игрока сбрасывается при его появлении.` },
	},
	RoundTime: {
		summary: { en: `The round clock at the top of a player's HUD is set.`, ru: `Задаются часы раунда вверху HUD игрока.` },
		fields: { seconds },
	},
	SayText: {
		summary: { en: `A chat line.`, ru: `Строка чата.` },
		fields: {
			sender: { en: `The player who wrote it; \`null\` for the server.`, ru: `Игрок, который её написал; \`null\` — сервер.` },
			text: { en: `The line, or the game's format for it, e.g. \`"#Cstrike_Chat_All"\`.`, ru: `Строка или формат игры для неё, например \`"#Cstrike_Chat_All"\`.` },
			params,
		},
	},
	Scenario: {
		summary: { en: `The scenario icon on a player's HUD, such as the bomb's or a hostage's.`, ru: `Значок сценария на HUD игрока, например бомбы или заложника.` },
		fields: {
			active: { en: `\`true\` while the icon is shown.`, ru: `\`true\`, пока значок показан.` },
			sprite: { en: `The icon's sprite name, e.g. \`"hostage1"\`.`, ru: `Имя спрайта значка, например \`"hostage1"\`.` },
			alpha: { en: `The icon's opacity, \`0\` to \`255\`.`, ru: `Непрозрачность значка, от \`0\` до \`255\`.` },
		},
	},
	ScoreAttrib: {
		summary: { en: `The marks the scoreboard shows beside a player: dead, the bomb, the VIP.`, ru: `Отметки, которые таблица счёта показывает рядом с игроком: погиб, бомба, VIP.` },
		fields: {
			target: { en: `The player whose row it is.`, ru: `Игрок, чья это строка.` },
			flags: { en: `The marks on the row, e.g. \`"Dead"\`, \`"Bomb"\`, \`"Vip"\`.`, ru: `Отметки в строке, например \`"Dead"\`, \`"Bomb"\`, \`"Vip"\`.` },
		},
	},
	ScoreInfo: {
		summary: { en: `A player's row on the scoreboard.`, ru: `Строка игрока в таблице счёта.` },
		fields: {
			target: { en: `The player whose row it is.`, ru: `Игрок, чья это строка.` },
			frags: { en: `The frags shown.`, ru: `Показанные фраги.` },
			deaths: { en: `The deaths shown.`, ru: `Показанные смерти.` },
			team: { en: `The team the row is under.`, ru: `Команда, под которой строка.` },
		},
	},
	ScreenFade: {
		summary: { en: `A player's screen is coloured, fading in or out - a flashbang, a fade to black.`, ru: `Экран игрока окрашивается с затуханием — флешка, затемнение.` },
		fields: {
			duration: { en: `The fade's duration, in seconds.`, ru: `Длительность затухания, в секундах.` },
			hold: { en: `The time the full colour holds, in seconds.`, ru: `Время, которое держится полный цвет, в секундах.` },
			direction: { en: `One of \`"in"\`, from the colour to a clear view, or \`"out"\`, from a clear view to the colour.`, ru: `Одно из \`"in"\` — от цвета к чистому экрану, или \`"out"\` — от чистого экрана к цвету.` },
			modulate: { en: `\`true\` when the colour tints the screen rather than painting over it.`, ru: `\`true\`, когда цвет тонирует экран, а не закрашивает его.` },
			stay: { en: `\`true\` when the colour stays until the next fade.`, ru: `\`true\`, когда цвет остаётся до следующего затухания.` },
			color: { en: `The colour: red, green, blue and alpha, \`0\` to \`255\` each.`, ru: `Цвет: красный, зелёный, синий и альфа, от \`0\` до \`255\` каждый.` },
		},
	},
	ScreenShake: {
		summary: { en: `A player's view shakes - an explosion nearby.`, ru: `Вид игрока трясётся — рядом взрыв.` },
		fields: {
			amplitude: { en: `The shake's strength: how far the view moves, up to 16 units.`, ru: `Сила тряски: насколько сдвигается вид, до 16 единиц.` },
			duration: { en: `The shake's duration, in seconds.`, ru: `Длительность тряски, в секундах.` },
			frequency: { en: `The shake's frequency, in jolts a second.`, ru: `Частота тряски, в толчках в секунду.` },
		},
	},
	SendAudio: {
		summary: { en: `A sound played to a player, such as a radio line.`, ru: `Звук, который играет игроку, например фраза рации.` },
		fields: {
			sender: { en: `The player the sound is from; \`null\` for none.`, ru: `Игрок, от которого звук; \`null\` — ни от кого.` },
			sound: { en: `The sound, e.g. \`"%!MRAD_GO"\` for a radio line.`, ru: `Звук, например \`"%!MRAD_GO"\` — фраза рации.` },
			pitch: { en: `The pitch in percent, \`100\` as recorded.`, ru: `Высота в процентах, \`100\` — как записан.` },
		},
	},
	ServerName: {
		summary: { en: `The server's name a player's client shows.`, ru: `Имя сервера, которое показывает клиент игрока.` },
		fields: { serverName: { en: `The server's name, as \`hostname\` sets it.`, ru: `Имя сервера, как его задаёт \`hostname\`.` } },
	},
	SetFOV: {
		summary: { en: `A player's field of view is set.`, ru: `Задаётся поле зрения игрока.` },
		fields: { fov: { en: `The field of view, in degrees.`, ru: `Поле зрения, в градусах.` } },
	},
	ShowMenu: {
		summary: { en: `A text menu on a player's screen - the team menu without VGUI, the radio, a plugin's menu.`, ru: `Текстовое меню на экране игрока — меню команды без VGUI, рация, меню плагина.` },
		fields: {
			more: { en: `\`true\` when more of the menu's text follows in the next message.`, ru: `\`true\`, когда продолжение текста меню идёт следующим сообщением.` },
			text: { en: `The menu's text, or the game's own for it, e.g. \`"#Team_Select"\`.`, ru: `Текст меню или собственный текст игры, например \`"#Team_Select"\`.` },
		},
	},
	ShowTimer: {
		summary: { en: `The round clock appears on a player's HUD.`, ru: `На HUD игрока появляются часы раунда.` },
	},
	SpecHealth: {
		summary: { en: `The health of the player a spectator watches.`, ru: `Здоровье игрока, за которым следит наблюдатель.` },
		fields: { health },
	},
	SpecHealth2: {
		summary: { en: `The health of the player a spectator watches, and who it is.`, ru: `Здоровье игрока, за которым следит наблюдатель, и кто это.` },
		fields: {
			health,
			target: { en: `The player watched.`, ru: `Игрок, за которым следят.` },
		},
	},
	Spectator: {
		summary: { en: `A player becomes a spectator, or stops being one, on the scoreboard.`, ru: `Игрок становится наблюдателем или перестаёт им быть — в таблице счёта.` },
		fields: {
			target: { en: `The player.`, ru: `Игрок.` },
			spectator: { en: `\`true\` while the player spectates.`, ru: `\`true\`, пока игрок наблюдает.` },
		},
	},
	StatusIcon: {
		summary: { en: `A status icon on a player's HUD - the buy zone, the bomb - is shown, flashed or hidden.`, ru: `Значок состояния на HUD игрока — зона закупки, бомба — показывается, мигает или прячется.` },
		fields: {
			state: { en: `One of \`"hide"\`, \`"show"\` or \`"flash"\`.`, ru: `Одно из \`"hide"\`, \`"show"\` или \`"flash"\`.` },
			sprite: { en: `The icon's sprite name, e.g. \`"buyzone"\`.`, ru: `Имя спрайта значка, например \`"buyzone"\`.` },
			color: { en: `The icon's colour: red, green and blue, \`0\` to \`255\` each; empty when it is hidden.`, ru: `Цвет значка: красный, зелёный и синий, от \`0\` до \`255\` каждый; пусто, когда он скрыт.` },
		},
	},
	StatusText: {
		summary: { en: `The status line at the bottom of a player's screen, such as the name of the player he aims at.`, ru: `Строка состояния внизу экрана игрока, например имя игрока, в которого он целится.` },
		fields: {
			line: { en: `The status line's number, from \`0\`.`, ru: `Номер строки состояния, с \`0\`.` },
			text: { en: `The line's text, or its format, e.g. \`"1 %c1: %p2"\`.`, ru: `Текст строки или её формат, например \`"1 %c1: %p2"\`.` },
		},
	},
	StatusValue: {
		summary: { en: `A value the status line shows, such as the player a player aims at.`, ru: `Значение, которое показывает строка состояния, например игрок, в которого целится игрок.` },
		fields: {
			slot: { en: `The value's number in the line's format: \`1\` a team, \`2\` a player, \`3\` health.`, ru: `Номер значения в формате строки: \`1\` — команда, \`2\` — игрок, \`3\` — здоровье.` },
			value: { en: `The value.`, ru: `Значение.` },
		},
	},
	TaskTime: {
		summary: { en: `The countdown of a task on a player's HUD, such as rescuing the hostages in a career.`, ru: `Отсчёт задания на HUD игрока, например спасения заложников в карьере.` },
		fields: {
			seconds: { en: `The seconds left.`, ru: `Оставшиеся секунды.` },
			active: { en: `\`true\` while the clock runs.`, ru: `\`true\`, пока часы идут.` },
			fade: { en: `The seconds the clock takes to fade out.`, ru: `Секунды, за которые часы гаснут.` },
		},
	},
	TeamInfo: {
		summary: { en: `A player's team on the scoreboard.`, ru: `Команда игрока в таблице счёта.` },
		fields: {
			target: { en: `The player whose team it is.`, ru: `Игрок, чья это команда.` },
			team: { en: `The team, e.g. \`"TERRORIST"\`, \`"CT"\`.`, ru: `Команда, например \`"TERRORIST"\`, \`"CT"\`.` },
		},
	},
	TeamScore: {
		summary: { en: `A team's score on the scoreboard.`, ru: `Счёт команды в таблице счёта.` },
		fields: {
			team: { en: `The team, \`"TERRORIST"\` or \`"CT"\`.`, ru: `Команда, \`"TERRORIST"\` или \`"CT"\`.` },
			score: { en: `The rounds the team has won.`, ru: `Раунды, которые выиграла команда.` },
		},
	},
	TextMsg: {
		summary: { en: `A text from the game - an announcement, a hint - in chat, the console or the middle of the screen.`, ru: `Текст игры — объявление, подсказка — в чате, консоли или посреди экрана.` },
		fields: {
			destination: { en: `The place it shows, one of \`"chat"\`, \`"center"\`, \`"console"\` or \`"notify"\`.`, ru: `Место, где он виден, одно из \`"chat"\`, \`"center"\`, \`"console"\` или \`"notify"\`.` },
			text: { en: `The text, or the game's own for it, e.g. \`"#Round_Draw"\`.`, ru: `Текст или собственный текст игры, например \`"#Round_Draw"\`.` },
			params,
		},
	},
	Train: {
		summary: { en: `The speed of the train a player drives, on his HUD.`, ru: `Скорость поезда, которым управляет игрок, на его HUD.` },
		fields: { speed: { en: `The speed step, \`0\` for none.`, ru: `Ступень скорости, \`0\` — никакой.` } },
	},
	TutorClose: {
		summary: { en: `A tutor's message on a player's screen closes.`, ru: `Сообщение подсказчика на экране игрока закрывается.` },
	},
	VGUIMenu: {
		summary: { en: `A VGUI menu of the game opens on a player's screen: the team menu, the class menu, the buy menu.`, ru: `На экране игрока открывается VGUI-меню игры: меню команды, класса, закупки.` },
		fields: { menu: { en: `The menu, e.g. \`"team"\`, \`"classT"\`, \`"buy"\`.`, ru: `Меню, например \`"team"\`, \`"classT"\`, \`"buy"\`.` } },
	},
	ViewMode: {
		summary: { en: `A player's view goes back to first person.`, ru: `Вид игрока возвращается к виду от первого лица.` },
	},
	WeaponList: {
		summary: { en: `A weapon's description for a player's client: its ammo, its slot, its place in the slot.`, ru: `Описание оружия для клиента игрока: его патроны, слот, место в слоте.` },
		fields: {
			classname: { en: `The weapon's class name, e.g. \`"weapon_ak47"\`.`, ru: `Имя класса оружия, например \`"weapon_ak47"\`.` },
			ammo: { en: `The index of the weapon's ammo in the game's list of kinds.`, ru: `Индекс патронов оружия в списке видов у игры.` },
			maxAmmo: { en: `The most of that ammo a player carries.`, ru: `Наибольший запас этих патронов у игрока.` },
			ammo2: { en: `The index of the weapon's second ammo, \`-1\` for none.`, ru: `Индекс вторых патронов оружия, \`-1\` — нет.` },
			maxAmmo2: { en: `The most of the second ammo a player carries.`, ru: `Наибольший запас вторых патронов у игрока.` },
			slot: { en: `The slot the weapon is in, from \`0\`.`, ru: `Слот оружия, с \`0\`.` },
			position: { en: `The weapon's place in the slot, from \`0\`.`, ru: `Место оружия в слоте, с \`0\`.` },
			weapon: { en: `The weapon, by its kind, e.g. \`"ak47"\`.`, ru: `Оружие по его виду, например \`"ak47"\`.` },
		},
	},
	WeapPickup: {
		summary: { en: `A player picks up a weapon: the notice at the side of his screen.`, ru: `Игрок подбирает оружие: уведомление сбоку экрана.` },
		fields: { weapon: { en: `The weapon, by its kind, e.g. \`"knife"\`.`, ru: `Оружие по его виду, например \`"knife"\`.` } },
	},
};

/** The words of a message that has no entry, and of the receiver every message has. */
export const ANY_MESSAGE: { summary: Text; player: Text } = {
	summary: { en: `A message the server sends its clients; its arguments are \`event.args\`.`, ru: `Сообщение, которое сервер шлёт клиентам; его аргументы — \`event.args\`.` },
	player: receiver,
};
