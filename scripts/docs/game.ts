// Our own words for the game's events - the reapi hookchains and Ham Sandwich
// functions a plugin listens to with game.addEventListener - in both languages
// the project speaks.
//
// scripts/generate-hooks.ts writes these into as/hooks.ts as the tooltips an
// editor shows on the event name, the event class and its fields. The
// language is AMXTS_DOCS_LANG in .env ("en" by default, or "ru"). A chain
// missing here falls back to English, then to the Description line reapi's
// include carries - so every chain has a tooltip, and the list improves one
// entry at a time.
//
// Written for someone who knows TypeScript and not reapi: what happened, and
// what returning a value does. Keyed by the event's name as game takes it;
// fields by their name on the event object.
import type { Text } from './events';

export interface GameDoc {
	summary: Text;
	fields?: Record<string, Text>;
}

const player: Text = { en: `The player the event is about.`, ru: `Игрок, о котором событие.` };
// Vector arguments are read only: reapi takes a vector back only as itself.
const grenadeStart: Text = { en: `The point the grenade is thrown from, a Vector.`, ru: `Точка, откуда летит граната, Vector.` };
const thrower: Text = { en: `The player who threw the grenade.`, ru: `Игрок, который бросил гранату.` };
const grenadeVelocity: Text = { en: `The grenade's velocity, a Vector.`, ru: `Скорость гранаты, Vector.` };

// The entity a Ham Sandwich event of one class is about.
const theWeapon: Text = { en: `The weapon the event is about - one of the class \`classname\` names.`, ru: `Оружие, о котором событие, — одного класса, названного в \`classname\`.` };
const theEntity: Text = { en: `The entity the event is about - one of the class \`classname\` names.`, ru: `Сущность, о которой событие, — одного класса, названного в \`classname\`.` };

export const GAME: Record<string, GameDoc> = {
	touch: {
		summary: {
			en: `An entity touched another: \`event.toucher\` moved into \`event.touched\`. Pass the classes it is about as the third argument - \`{ toucher: "player", touched: "player" }\` - so only those touches reach the plugin; \`event.preventDefault()\` blocks the touch.`,
			ru: `Сущность коснулась другой: \`event.toucher\` вошла в \`event.touched\`. Передайте классы, о которых речь, третьим аргументом — \`{ toucher: "player", touched: "player" }\`, — и до плагина дойдут только эти касания; \`event.preventDefault()\` блокирует касание.`,
		},
	},
	takeDamage: {
		summary: {
			en: `A player is about to take damage. Assign \`event.damage\` to change how much, or call \`preventDefault()\` to take none.`,
			ru: `Игрок сейчас получит урон. Чтобы изменить сколько, присвойте \`event.damage\`; чтобы урона не было, вызовите \`preventDefault()\`.`,
		},
		fields: {
			player: { en: `The player who is hurt.`, ru: `Игрок, которого ранят.` },
			inflictor: { en: `The source of the damage: a weapon, a grenade, the world.`, ru: `Источник урона: оружие, граната, мир.` },
			attacker: { en: `The player who does the damage.`, ru: `Игрок, который наносит урон.` },
			damage: { en: `The damage, before armour. Assign to change it.`, ru: `Урон до брони. Присвойте, чтобы изменить.` },
			damageType: { en: `The kinds of damage, e.g. \`"Fall"\`, \`"Bullet"\`, \`"Burn"\`.`, ru: `Виды урона, например \`"Fall"\`, \`"Bullet"\`, \`"Burn"\`.` },
		},
	},
	fallDamage: {
		summary: {
			en: `The game works out how much a fall hurts. In a post listener \`event.result\` is that number; return a number to replace it.`,
			ru: `Игра считает урон от падения. В post-обработчике \`event.result\` — это число; верните своё, чтобы заменить его.`,
		},
		fields: { player: { en: `The player who fell.`, ru: `Игрок, который упал.` } },
	},
	canPlayerHearPlayer: {
		summary: {
			en: `The game asks if one player hears another on voice. Return \`true\` or \`false\` to decide.`,
			ru: `Игра спрашивает, слышит ли один игрок другого в голосовом чате. Верните \`true\` или \`false\`, чтобы решить.`,
		},
		fields: {
			listener: { en: `The player who would hear.`, ru: `Игрок, который слушает.` },
			sender: { en: `The player who is talking.`, ru: `Игрок, который говорит.` },
		},
	},
	playerSpawn: {
		summary: { en: `A player spawned.`, ru: `Игрок появился на карте (спавн).` },
		fields: { player },
	},
	playerKilled: {
		summary: { en: `A player was killed.`, ru: `Игрока убили.` },
		fields: {
			victim: { en: `The player who died.`, ru: `Игрок, который погиб.` },
			killer: { en: `The player who killed the victim.`, ru: `Игрок, который убил жертву.` },
			inflictor: { en: `The source of the kill: a weapon, a grenade, the world.`, ru: `Орудие убийства: оружие, граната, мир.` },
		},
	},
	traceAttack: {
		summary: {
			en: `A shot or a knife hit a player, before the damage. \`preventDefault()\` makes it miss.`,
			ru: `Выстрел или нож попал в игрока, ещё до урона. \`preventDefault()\` — и попадания не было.`,
		},
		fields: {
			dir: { en: `The shot's direction, a Vector.`, ru: `Направление выстрела, Vector.` },
		},
	},
	throwSmokeGrenade: {
		summary: {
			en: `A player threw a smoke grenade. In a post listener \`event.result\` is the grenade.`,
			ru: `Игрок бросил дымовую гранату. В post-обработчике \`event.result\` — сама граната.`,
		},
		fields: { player: thrower, start: grenadeStart, velocity: grenadeVelocity },
	},
	throwHeGrenade: {
		summary: {
			en: `A player threw an HE grenade. In a post listener \`event.result\` is the grenade.`,
			ru: `Игрок бросил осколочную гранату. В post-обработчике \`event.result\` — сама граната.`,
		},
		fields: { player: thrower, start: grenadeStart, velocity: grenadeVelocity },
	},
	throwFlashbang: {
		summary: {
			en: `A player threw a flashbang. In a post listener \`event.result\` is the grenade.`,
			ru: `Игрок бросил флешку. В post-обработчике \`event.result\` — сама граната.`,
		},
		fields: { player: thrower },
	},
	explodeSmokeGrenade: {
		summary: { en: `A smoke grenade is going off.`, ru: `Дымовая граната взрывается.` },
	},
	preThink: {
		summary: {
			en: `A player's frame, before he moves: every frame for every player, hundreds of times a second. Keep the listener tiny.`,
			ru: `Кадр игрока, до его движения: каждый кадр для каждого игрока, сотни раз в секунду. Обработчик должен быть очень лёгким.`,
		},
		fields: { player },
	},
	resetMaxSpeed: {
		summary: {
			en: `The game resets a player's speed, on spawn and on every weapon switch. \`preventDefault()\` keeps the speed you set.`,
			ru: `Игра сбрасывает скорость игрока — при спавне и при каждой смене оружия. \`preventDefault()\` оставит скорость, которую вы задали.`,
		},
		fields: { player },
	},
	giveDefaultItems: {
		summary: {
			en: `The game hands a spawned player the default weapons. \`preventDefault()\` gives nothing.`,
			ru: `Игра выдаёт появившемуся игроку стандартное оружие. \`preventDefault()\` — и не выдаст ничего.`,
		},
		fields: { player },
	},
	dropPlayerItem: {
		summary: {
			en: `A player drops a weapon. In a post listener \`event.result\` is the weapon box on the ground.`,
			ru: `Игрок выбрасывает оружие. В post-обработчике \`event.result\` — коробка с оружием на земле.`,
		},
		fields: { player, itemName: { en: `The weapon's class name, e.g. \`"weapon_ak47"\`.`, ru: `Имя класса оружия, например \`"weapon_ak47"\`.` } },
	},
	roundEnd: {
		summary: { en: `The round is ending.`, ru: `Раунд заканчивается.` },
		fields: {
			winner: {
				en: `The round's winner, one of \`"TERRORIST"\`, \`"CT"\`, \`"draw"\` or \`"none"\`, as \`game.endRound\` takes it. Assign to change it.`,
				ru: `Победитель раунда, одно из \`"TERRORIST"\`, \`"CT"\`, \`"draw"\` или \`"none"\`, как у \`game.endRound\`. Присвойте, чтобы изменить.`,
			},
			reason: {
				en: `The reason the round ended, e.g. \`"terroristsWin"\`, \`"ctsWin"\`, \`"bombDefused"\`, \`"targetSaved"\`, \`"gameRestart"\`; \`"unknown"\` for a number the game does not name.`,
				ru: `Причина конца раунда, например \`"terroristsWin"\`, \`"ctsWin"\`, \`"bombDefused"\`, \`"targetSaved"\`, \`"gameRestart"\`; \`"unknown"\` — номер, которому у игры нет имени.`,
			},
			delay: { en: `The seconds until the next round.`, ru: `Секунды до следующего раунда.` },
		},
	},
	newRound: {
		summary: { en: `A new round is starting.`, ru: `Начинается новый раунд.` },
	},
	checkWinConditions: {
		summary: {
			en: `The game checks if a side has won. \`preventDefault()\` stops it from ending the round.`,
			ru: `Игра проверяет, не победила ли какая-то сторона. \`preventDefault()\` не даст ей закончить раунд.`,
		},
	},
	roundStart: {
		summary: { en: `The freeze time at the start of the round is over.`, ru: `Закончилось время заморозки в начале раунда.` },
	},
	shoot: {
		summary: {
			en: `A gun fires a shot: the game traces the bullet, through walls as its penetration allows, and deals its damage.`,
			ru: `Оружие стреляет: игра ведёт пулю, сквозь стены, насколько позволяет пробивание, и наносит её урон.`,
		},
	},
	shootBuckshot: {
		summary: {
			en: `A shotgun fires: the game traces each pellet and deals its damage.`,
			ru: `Дробовик стреляет: игра ведёт каждую дробину и наносит её урон.`,
		},
	},
	radio: {
		summary: {
			en: `A radio message is sent. \`preventDefault()\` silences it.`,
			ru: `Отправляется радиосообщение. \`preventDefault()\` заглушит его.`,
		},
		fields: { player },
	},
	startSound: {
		summary: {
			en: `A sound is about to play. Assign \`event.sample\` to change it, or call \`preventDefault()\` to keep it silent.`,
			ru: `Сейчас прозвучит звук. Присвойте \`event.sample\`, чтобы заменить его, или вызовите \`preventDefault()\`, чтобы заглушить.`,
		},
	},
	defaultDeploy: {
		summary: {
			en: `A weapon is being taken out. Assign \`event.viewModel\` / \`weaponModel\` to change what is shown.`,
			ru: `Оружие достают. Присвойте \`event.viewModel\` / \`weaponModel\`, чтобы поменять модель.`,
		},
	},
	playerBlind: {
		summary: {
			en: `A flashbang is blinding a player. \`preventDefault()\` keeps the player's eyes clear.`,
			ru: `Флешка ослепляет игрока. \`preventDefault()\` — и он ничего не заметит.`,
		},
		fields: {
			player: { en: `The player who is blinded.`, ru: `Игрок, которого ослепляет.` },
			color: { en: `The flash's colour, [r, g, b] as a Vector.`, ru: `Цвет вспышки, [r, g, b] как Vector.` },
		},
	},
	startDeathCam: {
		summary: { en: `A dead player's camera starts.`, ru: `Включается камера погибшего игрока.` },
		fields: { player },
	},
	impulse: {
		summary: { en: `A player sends an impulse: \`100\` is the flashlight, \`201\` the spray.`, ru: `Игрок отправляет impulse: \`100\` — фонарик, \`201\` — спрей.` },
		fields: { player },
	},
	showMenu: {
		summary: { en: `The game shows a player a menu.`, ru: `Игра показывает игроку меню.` },
		fields: { player },
	},
	showVguiMenu: {
		summary: { en: `The game shows a player a VGUI menu (team select).`, ru: `Игра показывает игроку VGUI-меню (выбор команды).` },
		fields: {
			player,
			menu: {
				en: `The menu shown, e.g. \`"team"\`, \`"classT"\`, \`"classCT"\`, \`"buy"\`, \`"buyPistol"\`.`,
				ru: `Показываемое меню, например \`"team"\`, \`"classT"\`, \`"classCT"\`, \`"buy"\`, \`"buyPistol"\`.`,
			},
		},
	},
	canSwitchTeam: {
		summary: {
			en: `The game asks if a player may move to a team. Return \`true\` or \`false\` to decide.`,
			ru: `Игра спрашивает, можно ли игроку перейти в команду. Верните \`true\` или \`false\`, чтобы решить.`,
		},
		fields: { player, team: { en: `The team the player would move to.`, ru: `Команда, в которую перейдёт игрок.` } },
	},
	chooseTeam: {
		summary: {
			en: `A player picked an item in the team menu. \`preventDefault()\` ignores the pick.`,
			ru: `Игрок выбрал пункт в меню команд. \`preventDefault()\` — и выбор не засчитается.`,
		},
		fields: {
			player,
			choice: {
				en: `The player's pick, one of \`"TERRORIST"\`, \`"CT"\`, \`"VIP"\`, \`"auto"\` or \`"SPECTATOR"\`. Assign to change it.`,
				ru: `Выбор игрока, одно из \`"TERRORIST"\`, \`"CT"\`, \`"VIP"\`, \`"auto"\` или \`"SPECTATOR"\`. Присвойте, чтобы изменить.`,
			},
		},
	},
	buyWeapon: {
		summary: {
			en: `A player buys a weapon. In a post listener \`event.result\` is the weapon.`,
			ru: `Игрок покупает оружие. В post-обработчике \`event.result\` — само оружие.`,
		},
		fields: { player, weapon: { en: `The weapon bought, as \`weapon.kind\` names it, e.g. \`"ak47"\` or \`"awp"\`.`, ru: `Покупаемое оружие, как его называет \`weapon.kind\`, например \`"ak47"\` или \`"awp"\`.` } },
	},
	addMoney: {
		summary: {
			en: `A player's money changes. Assign \`event.amount\` to change how much.`,
			ru: `У игрока меняются деньги. Присвойте \`event.amount\`, чтобы изменить сумму.`,
		},
		fields: {
			player,
			reason: {
				en: `The reason for the money, e.g. \`"roundBonus"\`, \`"enemyKilled"\`, \`"playerBoughtSomething"\`, \`"hostageRescued"\`.`,
				ru: `Причина начисления, например \`"roundBonus"\`, \`"enemyKilled"\`, \`"playerBoughtSomething"\`, \`"hostageRescued"\`.`,
			},
		},
	},
	itemRestricted: {
		summary: {
			en: `The game asks if an item is forbidden to a player. Return \`true\` to forbid it.`,
			ru: `Игра спрашивает, запрещён ли игроку предмет. Верните \`true\`, чтобы запретить.`,
		},
		fields: {
			player,
			item: {
				en: `The item asked about, by its kind, e.g. \`"awp"\`, \`"hegrenade"\`, \`"kevlar"\`, \`"defusekit"\`.`,
				ru: `Предмет, о котором спрашивают, по его виду, например \`"awp"\`, \`"hegrenade"\`, \`"kevlar"\`, \`"defusekit"\`.`,
			},
			restriction: {
				en: `The way the player would get the item, one of \`"buying"\`, \`"touched"\` (picked up) or \`"equipped"\` (given on spawn).`,
				ru: `Способ, которым игрок получит предмет, — одно из \`"buying"\` (покупка), \`"touched"\` (подобрал) или \`"equipped"\` (выдан при спавне).`,
			},
		},
	},
	pain: {
		summary: {
			en: `A player cries out in pain after a hit.`,
			ru: `Игрок вскрикивает от боли после попадания.`,
		},
		fields: {
			player,
			lastHitGroup: {
				en: `The body part the hit struck, e.g. \`"head"\`, \`"chest"\`, \`"leftLeg"\`.`,
				ru: `Часть тела, куда пришлось попадание, например \`"head"\`, \`"chest"\`, \`"leftLeg"\`.`,
			},
			hasArmour: {
				en: `\`true\` when the player wears armour: the game picks the sound by it.`,
				ru: `\`true\`, когда на игроке броня: по ней игра выбирает звук.`,
			},
		},
	},
	setAnimation: {
		summary: {
			en: `The game sets the animation a player's model plays: walking, jumping, attacking, reloading.`,
			ru: `Игра задаёт анимацию, которую играет модель игрока: ходьба, прыжок, атака, перезарядка.`,
		},
		fields: {
			player,
			playerAnim: {
				en: `The animation, e.g. \`"jump"\`, \`"attack1"\`, \`"reload"\`.`,
				ru: `Анимация, например \`"jump"\`, \`"attack1"\`, \`"reload"\`.`,
			},
		},
	},
	addResource: {
		summary: {
			en: `A file is added to what clients download.`,
			ru: `Файл добавляется в то, что скачивают клиенты.`,
		},
		fields: {
			resourceType: {
				en: `The file's kind, e.g. \`"sound"\`, \`"model"\`, \`"decal"\`, \`"generic"\`.`,
				ru: `Вид файла, например \`"sound"\`, \`"model"\`, \`"decal"\`, \`"generic"\`.`,
			},
			resourceIndex: { en: `The resource's number in the list.`, ru: `Номер ресурса в списке.` },
		},
	},
	gameEvent: {
		summary: {
			en: `The game tells the bots something happened.`,
			ru: `Игра сообщает ботам, что что-то произошло.`,
		},
		fields: {
			gameEvent: {
				en: `The thing that happened, e.g. \`"weaponFired"\`, \`"playerDied"\`, \`"bombPlanted"\`, \`"roundStart"\`.`,
				ru: `Событие для ботов, например \`"weaponFired"\`, \`"playerDied"\`, \`"bombPlanted"\`, \`"roundStart"\`.`,
			},
		},
	},
	sendDeathMessage: {
		summary: {
			en: `The game tells everyone who killed whom.`,
			ru: `Игра сообщает всем, кто кого убил.`,
		},
		fields: {
			flags: {
				en: `The extras the death message carries, any of \`"Position"\`, \`"Assistant"\`, \`"KillRarity"\`.`,
				ru: `Дополнения к сообщению о смерти, любые из \`"Position"\`, \`"Assistant"\`, \`"KillRarity"\`.`,
			},
			rarity: {
				en: `The things that made the kill rare, e.g. \`"Headshot"\`, \`"NoScope"\`, \`"Penetrated"\`, \`"InAir"\`.`,
				ru: `Особенности убийства, например \`"Headshot"\`, \`"NoScope"\`, \`"Penetrated"\`, \`"InAir"\`.`,
			},
		},
	},
	throwGrenade: {
		summary: { en: `A player throws a grenade.`, ru: `Игрок бросает гранату.` },
		fields: { player: thrower, velocity: grenadeVelocity },
	},
	hintMessage: {
		summary: { en: `The game shows a player a hint.`, ru: `Игра показывает игроку подсказку.` },
		fields: {
			player,
			displayIfHintsOff: {
				en: `\`true\` to show the hint even to a player who turned hints off.`,
				ru: `\`true\` — показать подсказку и игроку, который отключил подсказки.`,
			},
		},
	},
	chatMessage: {
		summary: {
			en: `A player's chat message goes out to the players and to the server console. Assign \`event.text\` to change what they read, or call \`preventDefault()\` so nobody gets it.`,
			ru: `Сообщение игрока в чат уходит игрокам и в консоль сервера. Чтобы изменить, что они прочтут, присвойте \`event.text\`; чтобы его не получил никто, вызовите \`preventDefault()\`.`,
		},
		fields: {
			player: { en: `The player who wrote the message.`, ru: `Игрок, который написал сообщение.` },
			cmd: { en: `The command the message came with, \`"say"\` or \`"say_team"\`.`, ru: `Команда, с которой пришло сообщение, \`"say"\` или \`"say_team"\`.` },
			teamonly: { en: `\`true\` when only the player's team gets the message.`, ru: `\`true\`, когда сообщение получает только команда игрока.` },
			text: { en: `The message as the player wrote it. Assign to change it.`, ru: `Сообщение, как его написал игрок. Присвойте, чтобы изменить.` },
			format: {
				en: `The chat's format that puts the name, the place and the message together, e.g. \`"#Cstrike_Chat_All"\`.`,
				ru: `Формат чата, который собирает имя, место и сообщение, например \`"#Cstrike_Chat_All"\`.`,
			},
			consoleFormat: { en: `The format of the line the server console prints for the message.`, ru: `Формат строки, которую консоль сервера печатает для сообщения.` },
			senderDead: { en: `\`true\` when the player who wrote the message is dead.`, ru: `\`true\`, когда игрок, написавший сообщение, мёртв.` },
			placeName: { en: `The name of the place on the map where the player is, e.g. \`"BombsiteA"\`.`, ru: `Название места на карте, где находится игрок, например \`"BombsiteA"\`.` },
			consoleUsesPlaceName: { en: `\`true\` when the console's line carries the place's name too.`, ru: `\`true\`, когда строка в консоли тоже содержит название места.` },
		},
	},
	takeDamageImpulse: {
		summary: {
			en: `A hurt player is pushed back and slowed down by the hit, after the damage. Assign \`event.knockbackForce\` or \`event.velModifier\` to change how much, or call \`preventDefault()\` for neither.`,
			ru: `Раненого игрока отбрасывает и замедляет от удара, уже после урона. Чтобы изменить насколько, присвойте \`event.knockbackForce\` или \`event.velModifier\`; чтобы не было ни того ни другого, вызовите \`preventDefault()\`.`,
		},
		fields: {
			player: { en: `The player who is hurt.`, ru: `Игрок, которого ранили.` },
			attacker: { en: `The player who did the damage.`, ru: `Игрок, который нанёс урон.` },
			knockbackForce: { en: `The force that pushes the player away from the attacker. Assign to change it.`, ru: `Сила, которая отталкивает игрока от атакующего. Присвойте, чтобы изменить.` },
			velModifier: {
				en: `The share of speed the player keeps while slowed by the hit, e.g. \`0.5\` for half. Assign to change it.`,
				ru: `Доля скорости, которая остаётся у игрока, пока его замедляет удар, например \`0.5\` — половина. Присвойте, чтобы изменить.`,
			},
		},
	},
	updateStatusBar: {
		summary: {
			en: `The game updates a player's status bar: the name and health of the player under the crosshair, at the bottom of the screen. \`preventDefault()\` leaves it as it is.`,
			ru: `Игра обновляет строку состояния игрока — имя и здоровье игрока под прицелом внизу экрана. \`preventDefault()\` оставит её как есть.`,
		},
		fields: { player: { en: `The player whose status bar it is.`, ru: `Игрок, чья это строка состояния.` } },
	},
	spawn: {
		summary: {
			en: `An entity spawns - a player at the start of his life, a weapon, anything the map or a plugin makes. Without \`classname\` it is a player's; \`{ classname: "weaponbox" }\` hears that class's.`,
			ru: `Сущность появляется — игрок в начале жизни, оружие, всё, что создаёт карта или плагин. Без \`classname\` — появление игрока; \`{ classname: "weaponbox" }\` слушает этот класс.`,
		},
		fields: { player: { en: `The player who spawns; for another class, \`event.entity\`.`, ru: `Игрок, который появляется; для другого класса — \`event.entity\`.` } },
	},
	killed: {
		summary: {
			en: `An entity dies - a player, or with \`classname\` a breakable, a hostage. \`preventDefault()\` keeps it alive.`,
			ru: `Сущность погибает — игрок или, с \`classname\`, разбиваемый объект, заложник. \`preventDefault()\` оставляет её в живых.`,
		},
		fields: {
			player: { en: `The player who dies; for another class, \`event.entity\`.`, ru: `Игрок, который погибает; для другого класса — \`event.entity\`.` },
			attacker: { en: `The killer.`, ru: `Убийца.` },
			gib: { en: `The body's fate: \`0\` the usual death, \`1\` never torn apart, \`2\` always.`, ru: `Судьба тела: \`0\` — обычная смерть, \`1\` — никогда не разрывает, \`2\` — всегда.` },
		},
	},
	gameThink: {
		summary: {
			en: `The game rules' think: every frame, the round's clock and win conditions checked.`,
			ru: `«Мысль» правил игры: каждый кадр — часы раунда и проверка условий победы.`,
		},
	},
	think: {
		summary: {
			en: `An entity of one class thinks - when its \`nextThink\` comes: \`{ classname: "info_target" }\`.`,
			ru: `Сущность одного класса «думает» — когда наступает её \`nextThink\`: \`{ classname: "info_target" }\`.`,
		},
		fields: { entity: theEntity },
	},
	use: {
		summary: {
			en: `An entity of one class is used - a button pressed, a door opened. \`preventDefault()\` keeps it as it is.`,
			ru: `Сущность одного класса используют — нажимают кнопку, открывают дверь. \`preventDefault()\` оставит её как есть.`,
		},
		fields: {
			entity: theEntity,
			caller: { en: `The entity that passes the use on, e.g. a button to its door.`, ru: `Сущность, которая передаёт использование, например кнопка — своей двери.` },
			activator: { en: `The entity that started it, e.g. the player who pressed the button.`, ru: `Сущность, которая его начала, например игрок, нажавший кнопку.` },
			useType: { en: `The way it is used, one of \`"off"\`, \`"on"\`, \`"set"\` or \`"toggle"\`.`, ru: `Способ использования, одно из \`"off"\`, \`"on"\`, \`"set"\` или \`"toggle"\`.` },
			value: { en: `A number the use carries, for \`"set"\`.`, ru: `Число, которое несёт использование, для \`"set"\`.` },
		},
	},
	blocked: {
		summary: {
			en: `A moving entity of one class - a door, a train - is blocked by another in its way.`,
			ru: `Движущуюся сущность одного класса — дверь, поезд — блокирует другая на её пути.`,
		},
		fields: { entity: theEntity, other: { en: `The entity in the way.`, ru: `Сущность на пути.` } },
	},
	primaryAttack: {
		summary: {
			en: `A weapon of one class fires its primary attack - a shot, a knife's slash: \`{ classname: "weapon_knife" }\`. \`preventDefault()\` stops it.`,
			ru: `Оружие одного класса выполняет основную атаку — выстрел, удар ножом: \`{ classname: "weapon_knife" }\`. \`preventDefault()\` её отменяет.`,
		},
		fields: { weapon: theWeapon },
	},
	secondaryAttack: {
		summary: {
			en: `A weapon of one class fires its secondary attack - a knife's stab, a scope. \`preventDefault()\` stops it.`,
			ru: `Оружие одного класса выполняет вторую атаку — укол ножом, прицел. \`preventDefault()\` её отменяет.`,
		},
		fields: { weapon: theWeapon },
	},
	reload: {
		summary: {
			en: `A weapon of one class reloads. \`preventDefault()\` stops it.`,
			ru: `Оружие одного класса перезаряжается. \`preventDefault()\` это отменяет.`,
		},
		fields: { weapon: theWeapon },
	},
	deploy: {
		summary: {
			en: `A weapon of one class is drawn. Return \`false\` to refuse it.`,
			ru: `Оружие одного класса достают. Верните \`false\`, чтобы не дать его достать.`,
		},
		fields: { weapon: theWeapon },
	},
	holster: {
		summary: {
			en: `A weapon of one class is put away.`,
			ru: `Оружие одного класса убирают.`,
		},
		fields: { weapon: theWeapon },
	},
	weaponIdle: {
		summary: {
			en: `A weapon of one class idles, playing its idle animation.`,
			ru: `Оружие одного класса бездействует и проигрывает анимацию ожидания.`,
		},
		fields: { weapon: theWeapon },
	},
	itemPreFrame: {
		summary: {
			en: `A weapon of one class is thought over in its owner's hands, every frame before his move.`,
			ru: `Оружие одного класса обрабатывается в руках владельца, каждый кадр до его движения.`,
		},
		fields: { weapon: theWeapon },
	},
	addToPlayer: {
		summary: {
			en: `A weapon of one class goes to a player - picked up or given. Return \`false\` to refuse it.`,
			ru: `Оружие одного класса достаётся игроку — подобрано или выдано. Верните \`false\`, чтобы не отдать его.`,
		},
		fields: { weapon: theWeapon, player: { en: `The player who gets it.`, ru: `Игрок, который его получает.` } },
	},
	drop: {
		summary: {
			en: `A weapon of one class is dropped.`,
			ru: `Оружие одного класса выбрасывают.`,
		},
		fields: { weapon: theWeapon },
	},
	jump: {
		summary: {
			en: `A player jumps.`,
			ru: `Игрок прыгает.`,
		},
		fields: { player },
	},
	duck: {
		summary: {
			en: `A player ducks.`,
			ru: `Игрок приседает.`,
		},
		fields: { player },
	},
};
