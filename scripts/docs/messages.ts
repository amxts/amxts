// Our own words for the messages the server sends its clients, as
// server.addEventListener("message:<Name>", ...) hears them - in both
// languages. scripts/generate-host.ts writes them into as/events.ts as the
// tooltips an editor shows on the name, the event and its fields. A message
// without an entry has the words of every message: its arguments by number.
import type { EventDoc, Text } from './events';

const receiver: Text = { en: `The player the message goes to.`, ru: `Игрок, которому идёт сообщение.` };
const seconds: Text = { en: `The seconds the bar or the clock shows. Assign to change them.`, ru: `Секунды, которые показывают полоса или часы. Присвойте, чтобы изменить.` };

export const MESSAGES: Record<string, EventDoc> = {
	AmmoPickup: {
		summary: { en: `A player picks up ammo: the notice at the side of his screen.`, ru: `Игрок подбирает патроны: уведомление сбоку экрана.` },
		fields: {
			ammo: { en: `The ammo's index in the game's list of kinds.`, ru: `Индекс патронов в списке видов у игры.` },
			amount: { en: `The amount picked up.`, ru: `Подобранное количество.` },
		},
	},
	BarTime: {
		summary: { en: `The progress bar in the middle of a player's screen is shown or hidden.`, ru: `Полосу прогресса посреди экрана игрока показывают или прячут.` },
		fields: { seconds },
	},
	Battery: {
		summary: { en: `A player's armour on his HUD changes.`, ru: `Меняется броня игрока на его HUD.` },
		fields: { armor: { en: `The armour shown.`, ru: `Показанная броня.` } },
	},
	ClCorpse: {
		summary: { en: `A dead player's body is left on the ground for the clients to draw.`, ru: `Тело погибшего игрока остаётся на земле, чтобы клиенты его нарисовали.` },
		fields: {
			model: { en: `The body's model, e.g. \`"sas"\`.`, ru: `Модель тела, например \`"sas"\`.` },
			target: { en: `The player whose body it is.`, ru: `Игрок, чьё это тело.` },
		},
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
	Health: {
		summary: { en: `A player's health on his HUD changes.`, ru: `Меняется здоровье игрока на его HUD.` },
		fields: { health: { en: `The health shown.`, ru: `Показанное здоровье.` } },
	},
	HideWeapon: {
		summary: { en: `The parts of a player's HUD that are hidden change.`, ru: `Меняются скрытые части HUD игрока.` },
		fields: { flags: { en: `The hidden parts, e.g. \`"Money"\`, \`"Timer"\`. Assign to change them.`, ru: `Скрытые части, например \`"Money"\`, \`"Timer"\`. Присвойте, чтобы изменить.` } },
	},
	HudTextArgs: {
		summary: { en: `A hint in the middle of a player's screen, from the game's own texts.`, ru: `Подсказка посреди экрана игрока из собственных текстов игры.` },
		fields: { text: { en: `The game's text, e.g. \`"#Hint_press_buy_to_purchase"\`.`, ru: `Текст игры, например \`"#Hint_press_buy_to_purchase"\`.` } },
	},
	ItemPickup: {
		summary: { en: `A player picks up an item: the notice at the side of his screen.`, ru: `Игрок подбирает предмет: уведомление сбоку экрана.` },
		fields: { item: { en: `The item's class name, e.g. \`"item_kevlar"\`.`, ru: `Имя класса предмета, например \`"item_kevlar"\`.` } },
	},
	Money: {
		summary: { en: `A player's money on his HUD changes.`, ru: `Меняются деньги игрока на его HUD.` },
		fields: {
			amount: { en: `The money shown.`, ru: `Показанные деньги.` },
			flash: { en: `\`true\` to flash the change.`, ru: `\`true\` — мигнуть изменением.` },
		},
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
	SendAudio: {
		summary: { en: `A sound played to a player, such as a radio line.`, ru: `Звук, который играет игроку, например фраза рации.` },
		fields: {
			sender: { en: `The player the sound is from; \`null\` for none.`, ru: `Игрок, от которого звук; \`null\` — ни от кого.` },
			sound: { en: `The sound, e.g. \`"%!MRAD_GO"\` for a radio line.`, ru: `Звук, например \`"%!MRAD_GO"\` — фраза рации.` },
			pitch: { en: `The pitch in percent, \`100\` as recorded.`, ru: `Высота в процентах, \`100\` — как записан.` },
		},
	},
	SetFOV: {
		summary: { en: `A player's field of view is set.`, ru: `Задаётся поле зрения игрока.` },
		fields: { fov: { en: `The field of view, in degrees.`, ru: `Поле зрения, в градусах.` } },
	},
	StatusIcon: {
		summary: { en: `A status icon on a player's HUD - the buy zone, the bomb - is shown, flashed or hidden.`, ru: `Значок состояния на HUD игрока — зона закупки, бомба — показывается, мигает или прячется.` },
		fields: {
			state: { en: `One of \`"hide"\`, \`"show"\` or \`"flash"\`.`, ru: `Одно из \`"hide"\`, \`"show"\` или \`"flash"\`.` },
			sprite: { en: `The icon's sprite name, e.g. \`"buyzone"\`.`, ru: `Имя спрайта значка, например \`"buyzone"\`.` },
		},
	},
	TeamInfo: {
		summary: { en: `A player's team on the scoreboard.`, ru: `Команда игрока в таблице счёта.` },
		fields: {
			target: { en: `The player whose team it is.`, ru: `Игрок, чья это команда.` },
			team: { en: `The team's name, e.g. \`"TERRORIST"\`, \`"CT"\`.`, ru: `Имя команды, например \`"TERRORIST"\`, \`"CT"\`.` },
		},
	},
	TextMsg: {
		summary: { en: `A text from the game - an announcement, a hint - in chat, the console or the middle of the screen.`, ru: `Текст игры — объявление, подсказка — в чате, консоли или посреди экрана.` },
		fields: {
			destination: { en: `The place it shows, one of \`"chat"\`, \`"center"\`, \`"console"\` or \`"notify"\`.`, ru: `Место, где он виден, одно из \`"chat"\`, \`"center"\`, \`"console"\` или \`"notify"\`.` },
			text: { en: `The text, or the game's own for it, e.g. \`"#Round_Draw"\`.`, ru: `Текст или собственный текст игры, например \`"#Round_Draw"\`.` },
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
