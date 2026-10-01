// What a server without reapi - plain HLDS: Valve's engine and game, Metamod
// and AMX Mod X's stock modules - has for each game event and game rules
// field of ReGameDLL's and ReHLDS's own, which reapi alone delivers.
//
//   A  heard fully: the same moment, the same fields, preventDefault() and the
//      answer where reapi takes them;
//   B  heard, but late, without preventDefault() or the answer, or with
//      fewer fields - `gaps` says which, on the event's tooltip and the hooks
//      page;
//   C  nothing hears it (NOT_HEARD, with the reason): a listener is one line
//      in the console, and a project with `target: "hlds"` does not build it
//      (scripts/reapi-events.ts).
//
// An A or B event's backend is `<event>Hlds` in as/hlds.ts, which
// scripts/generate-hooks.ts registers on the event's first listener, once,
// when the server has no reapi; `post` adds `<event>PostHlds` for the first
// listener after the game.
import type { Text } from './docs/events';

export interface HeardEvent {
	class: 'A' | 'B';
	/** The stock hook that hears it. */
	backend: string;
	/** What plain HLDS does not give: B only. */
	gaps?: Text;
	/** A backend of its own for the listeners after the game. */
	post?: boolean;
}

const after: Text = {
	en: 'heard after the game has acted: `preventDefault()` and changing a field do nothing',
	ru: 'слышно, когда игра уже сделала своё: `preventDefault()` и запись поля ничего не делают',
};

/** `after`, then more. */
function afterAnd(en: string, ru: string): Text {
	return { en: `${after.en}; ${en}`, ru: `${after.ru}; ${ru}` };
}

function noAnswer(en: string, ru: string): Text {
	return { en: `${en}; returning an answer does nothing`, ru: `${ru}; ответ ничего не делает` };
}

function buy(en: string, ru: string): Text {
	return noAnswer(
		`heard through cstrike's \`CS_OnBuy\`: \`preventDefault()\` stops the purchase; ${en}`,
		`слышно через \`CS_OnBuy\` модуля cstrike: \`preventDefault()\` отменяет покупку; ${ru}`,
	);
}

function thrown(en: string, ru: string): Text {
	return afterAnd(`heard when the grenade gets its model; ${en}`, `слышно, когда граната получает модель; ${ru}`);
}

const precached: Text = {
	en: '`preventDefault()` skips the precache, which answers 0; returning an answer or changing `string` does nothing',
	ru: '`preventDefault()` пропускает прекэш, и он отвечает 0; ответ и запись `string` ничего не делают',
};

export const HEARD: Record<string, HeardEvent> = {
	// The round.
	restartRound: {
		class: 'B',
		backend: 'HLTV message (1=0 2=0) before, decal_reset.sc playback at its time after; the map\'s first round at plugin_cfg',
		post: true,
		gaps: {
			en: 'heard as the round restarts - the listeners before the game when it announces the round, the ones after it once its players have respawned - but `preventDefault()` does nothing; the map\'s first round is heard when the plugins start, and only by the listeners before the game',
			ru: 'слышно при перезапуске раунда — обработчики «до» игры, когда она объявляет раунд, обработчики «после» — когда её игроки возродились, — но `preventDefault()` ничего не делает; первый раунд карты слышен, когда плагины стартуют, и только обработчиками «до»',
		},
	},
	onRoundFreezeEnd: { class: 'B', backend: 'logevent World triggered "Round_Start"', gaps: after },
	roundEnd: {
		class: 'B',
		backend: 'logevent World triggered "Round_End"; winner and reason from the TextMsg, or SendAudio, before it',
		gaps: afterAnd(
			'`delay` is the original game\'s: 3 seconds for "gameCommencing", 5 for the rest; returning an answer does nothing, and `game.endRound` is not heard',
			'`delay` — как в оригинальной игре: 3 секунды для "gameCommencing", 5 для остальных; ответ ничего не делает, и `game.endRound` не слышен',
		),
	},
	gameThink: { class: 'B', backend: 'server_frame', gaps: after },
	goToIntermission: { class: 'B', backend: 'register_event "30" (SVC_INTERMISSION)', gaps: after },
	changeLevel: { class: 'B', backend: 'server_changelevel', gaps: { en: '`preventDefault()` does nothing', ru: '`preventDefault()` ничего не делает' } },

	// Spawning and dying.
	playerSpawn: { class: 'B', backend: 'Ham_Spawn post on "player", alive', gaps: after },
	playerKilled: {
		class: 'B',
		backend: 'Ham_Killed post on "player"; the inflictor is the victim\'s dmg_inflictor',
		gaps: after,
	},
	deathNotice: {
		class: 'B',
		backend: 'DeathMsg message',
		gaps: {
			en: 'heard as its death message is sent: `preventDefault()` does nothing, and `inflictor` reads as the world',
			ru: 'слышно, когда уходит сообщение о смерти: `preventDefault()` ничего не делает, а `inflictor` читается как мир',
		},
	},
	sendDeathMessage: {
		class: 'B',
		backend: 'DeathMsg message',
		gaps: {
			en: '`preventDefault()` stops the message; `assister` and `inflictor` read as the world, `flags` as empty, `rarity` has `"Headshot"` alone; changing a field does nothing',
			ru: '`preventDefault()` отменяет сообщение; `assister` и `inflictor` читаются как мир, `flags` пуст, в `rarity` бывает только `"Headshot"`; запись поля ничего не делает',
		},
	},
	pain: { class: 'A', backend: 'FM_EmitSound of a player\'s pain sound; lastHitGroup and hasArmour from the player' },
	deathSound: { class: 'A', backend: 'FM_EmitSound of a player\'s death sound' },

	// The bomb and the VIP: the game's log lines.
	giveC4: { class: 'B', backend: 'logevent "Spawned_With_The_Bomb"', gaps: noAnswer(after.en, after.ru) },
	makeBomber: { class: 'B', backend: 'logevent "Spawned_With_The_Bomb"', gaps: noAnswer(after.en, after.ru) },
	makeVip: { class: 'B', backend: 'logevent "Became_VIP"', gaps: after },
	plantBomb: {
		class: 'B',
		backend: 'logevent "Planted_The_Bomb"; the bomb is the grenade with the C4 model',
		gaps: noAnswer(afterAnd('`velocity` reads as zero', '`velocity` читается нулевым').en, afterAnd('`velocity` reads as zero', '`velocity` читается нулевым').ru),
	},
	defuseBombStart: { class: 'B', backend: 'logevent "Begin_Bomb_Defuse_With_Kit" / "_Without_Kit"', gaps: after },
	defuseBombEnd: {
		class: 'B',
		backend: 'logevent "Defused_The_Bomb"',
		gaps: afterAnd('heard only when the bomb is defused, not when a defuse stops halfway', 'слышно, только когда бомба обезврежена, а не когда разминирование прервано'),
	},
	explodeBomb: {
		class: 'B',
		backend: 'logevent Team "TERRORIST" triggered "Target_Bombed"',
		gaps: afterAnd('`tracehandle` and `damageType` read as 0', '`tracehandle` и `damageType` читаются как 0'),
	},

	// Money and buying.
	addAccount: {
		class: 'B',
		backend: 'Money message: the change from the last amount the player was sent',
		gaps: afterAnd(
			'`amount` is the change his money got, `reason` reads as `"none"`, and a change a plugin makes (`cs_set_user_money`) is heard too',
			'`amount` — на сколько изменились его деньги, `reason` читается как `"none"`, и изменение, сделанное плагином (`cs_set_user_money`), тоже слышно',
		),
	},
	buyWeaponByWeaponId: { class: 'B', backend: 'cstrike CS_OnBuy, a weapon', gaps: buy('`event.result` reads as `null`', '`event.result` читается как `null`') },
	buyItem: { class: 'B', backend: 'cstrike CS_OnBuy, the equipment', gaps: buy('heard for the equipment menu\'s items', 'слышно для предметов меню снаряжения') },
	buyGunAmmo: { class: 'B', backend: 'cstrike CS_OnBuy, ammo', gaps: buy('`blinkMoney` reads as `true`', '`blinkMoney` читается как `true`') },
	hasRestrictItem: {
		class: 'B',
		backend: 'cstrike CS_OnBuyAttempt',
		gaps: {
			en: 'asked only for `"buying"`, through cstrike\'s `CS_OnBuyAttempt`: answering `true` forbids the purchase, `false` lets the game go on',
			ru: 'спрашивается только про `"buying"`, через `CS_OnBuyAttempt` модуля cstrike: ответ `true` запрещает покупку, `false` оставляет решение игре',
		},
	},

	// Teams, menus and commands.
	chooseTeam: {
		class: 'B',
		backend: 'client commands jointeam, and menuselect in the team menu',
		gaps: {
			en: 'heard from the player\'s command: `preventDefault()` stops it; returning an answer does nothing, and a team the game picks itself is not heard',
			ru: 'слышно по команде игрока: `preventDefault()` её отменяет; ответ ничего не делает, а команда, которую игра выбирает сама, не слышна',
		},
	},
	chooseAppearance: {
		class: 'B',
		backend: 'client commands joinclass, and menuselect in the class menu',
		gaps: {
			en: 'heard from the player\'s command: `preventDefault()` stops it; a model the game picks itself is not heard',
			ru: 'слышно по команде игрока: `preventDefault()` её отменяет; модель, которую игра выбирает сама, не слышна',
		},
	},
	dropPlayerItem: {
		class: 'B',
		backend: 'client command drop',
		gaps: {
			en: 'heard from the player\'s `drop` command: `preventDefault()` stops it; `event.result` reads as `null`, and a drop the game makes itself is not heard',
			ru: 'слышно по команде игрока `drop`: `preventDefault()` её отменяет; `event.result` читается как `null`, а выброс, который игра делает сама, не слышен',
		},
	},
	showVguiMenu: {
		class: 'B',
		backend: 'VGUIMenu message',
		gaps: {
			en: 'heard as the menu is sent, to a player with VGUI menus on (not a bot): `preventDefault()` stops it; `oldMenu` reads as `""`, and changing a field does nothing',
			ru: 'слышно, когда меню уходит игроку с включёнными VGUI-меню (не боту): `preventDefault()` его отменяет; `oldMenu` читается как `""`, запись поля ничего не делает',
		},
	},

	// Clients.
	clientConnected: { class: 'B', backend: 'client_connect', gaps: after },
	connectClient: { class: 'B', backend: 'client_connect', gaps: afterAnd('heard once the player is let in', 'слышно, когда игрока уже пустили') },
	dropClient: {
		class: 'B',
		backend: 'client_disconnected',
		gaps: afterAnd('`crash` reads as `false`, and `fmt` is the reason AMX Mod X was told', '`crash` читается как `false`, а `fmt` — причина, которую узнал AMX Mod X'),
	},
	clientUserInfoChanged: { class: 'B', backend: 'client_infochanged', gaps: afterAnd('`infobuffer` reads as `""`', '`infobuffer` читается как `""`') },
	setClientUserInfoName: {
		class: 'B',
		backend: 'client_infochanged, when the name in the info differs from the player\'s',
		gaps: noAnswer(afterAnd('`infobuffer` reads as `""`', '`infobuffer` читается как `""`').en, afterAnd('`infobuffer` reads as `""`', '`infobuffer` читается как `""`').ru),
	},

	// Items, sounds, effects.
	playerBlind: {
		class: 'B',
		backend: 'Ham_CS_Player_Blind',
		gaps: afterAnd('`inflictor` and `attacker` read as the world, `color` as zero', '`inflictor` и `attacker` читаются как мир, `color` — нулевым'),
	},
	playerGotWeapon: { class: 'B', backend: 'Ham_AddPlayerItem post, when the item was added', gaps: after },
	canPlayerHearPlayer: {
		class: 'B',
		backend: 'FM_Voice_SetClientListening',
		gaps: {
			en: 'asked as the game tells the engine who hears whom, with `sv_alltalk` on too, and for a player who muted the other: the answer overrides both',
			ru: 'спрашивается, когда игра сообщает движку, кто кого слышит, — и при включённом `sv_alltalk`, и для игрока, заглушившего другого: ответ перекрывает и то и другое',
		},
	},
	throwHeGrenade: { class: 'B', backend: 'FM_SetModel w_hegrenade.mdl', gaps: thrown('`usEvent` reads as 0', '`usEvent` читается как 0') },
	throwFlashbang: { class: 'B', backend: 'FM_SetModel w_flashbang.mdl', gaps: thrown('every field is there', 'все поля на месте') },
	throwSmokeGrenade: { class: 'B', backend: 'FM_SetModel w_smokegrenade.mdl', gaps: thrown('`usEvent` reads as 0', '`usEvent` читается как 0') },
	throwGrenade: { class: 'B', backend: 'FM_SetModel of a thrown grenade', gaps: thrown('`usEvent` reads as 0', '`usEvent` читается как 0') },
	setModel: {
		class: 'B',
		backend: 'FM_SetModel on a weaponbox',
		gaps: { en: '`preventDefault()` keeps the model off; changing `modelName` does nothing', ru: '`preventDefault()` не даёт модели встать; запись `modelName` ничего не делает' },
	},
	gibSpawn: { class: 'B', backend: 'FM_SetModel on a gib', gaps: after },
	bounceGibTouch: { class: 'A', backend: 'engine touch of a gib' },
	startSound: {
		class: 'B',
		backend: 'FM_EmitSound',
		gaps: {
			en: 'heard for the sounds the game plays through the engine\'s `EmitSound`: `preventDefault()` stops it; `recipients` reads as 0, and changing a field does nothing',
			ru: 'слышно для звуков, которые игра проигрывает через `EmitSound` движка: `preventDefault()` его отменяет; `recipients` читается как 0, запись поля ничего не делает',
		},
	},

	// Precaching: fakemeta's forwards, added at plugin_precache, before the game's own.
	precacheModelI: { class: 'B', backend: 'FM_PrecacheModel', gaps: precached },
	precacheSoundI: { class: 'B', backend: 'FM_PrecacheSound', gaps: precached },
	precacheGenericI: { class: 'B', backend: 'FM_PrecacheGeneric', gaps: precached },
};

/**
 * The events nothing on plain HLDS hears, with the reason: ReGameDLL's own
 * function, one the game calls inside another with no hook between, or the
 * engine's own, which Metamod does not see.
 */
export const NOT_HEARD: Record<string, string> = {
	activateServer: 'the engine activates the map before plugin_init: a stock hook added then never hears it',
	addMultiDamage: 'a global function of the game, called inside an attack; no stock hook',
	addResource: 'the engine\'s own resource list',
	airAccelerate: 'player movement inside the game\'s PM_Move; no stock hook',
	airMove: 'player movement inside the game\'s PM_Move; no stock hook',
	alloc: 'the engine\'s own allocation of an edict',
	allowPhysent: 'the engine\'s own physics list',
	applyMultiDamage: 'a global function of the game, called inside an attack; no stock hook',
	balanceTeams: 'game rules code inside the round\'s restart; no stock hook',
	canHavePlayerItem: 'a game rules virtual: Ham Sandwich hooks entities only',
	canSwitchTeam: 'ReGameDLL\'s own function',
	checkMapConditions: 'game rules code at the map\'s start, before the plugins',
	checkTimeBasedDamage: 'inside the player\'s PreThink; no stock hook',
	checkUserInfo: 'the engine\'s own check of a connecting client',
	checkWaterJump: 'player movement inside the game\'s PM_Move; no stock hook',
	checkWinConditions: 'a game rules virtual: Ham Sandwich hooks entities only',
	cleanUpMap: 'game rules code inside the round\'s restart; no stock hook',
	clearMultiDamage: 'a global function of the game, called inside an attack; no stock hook',
	clientPrintf: 'the engine\'s own console text to a client',
	createWeaponBox: 'a weaponbox is heard only as it gets its model (setModel); its arguments are gone by then',
	deadPlayerWeapons: 'a game rules virtual: Ham Sandwich hooks entities only',
	defaultDeploy: 'a non-virtual helper inside a weapon\'s Deploy: the deploy event is the weapon\'s',
	defaultReload: 'a non-virtual helper inside a weapon\'s Reload: the reload event is the weapon\'s',
	defaultShotgunReload: 'a non-virtual helper inside a shotgun\'s Reload',
	directSet: 'the engine\'s own cvar code; AMX Mod X hooks one cvar at a time',
	disappear: 'ReGameDLL\'s own function',
	dropIdlePlayer: 'game code inside the player\'s think; no stock hook',
	dropShield: 'a non-virtual function of the player; no stock hook',
	emitPings: 'the engine\'s own network code',
	entSelectSpawnPoint: 'a non-virtual function of the player; no stock hook',
	executeServerStringCmd: 'the engine\'s own command buffer',
	explodeFlashbang: 'a non-virtual function of the grenade; its think is heard, not the step that explodes',
	explodeHeGrenade: 'a non-virtual function of the grenade; its think is heard, not the step that explodes',
	explodeSmokeGrenade: 'a non-virtual function of the grenade; its think is heard, not the step that explodes',
	fireBuckshots: 'a non-virtual function inside a weapon\'s attack',
	fireBullets: 'a non-virtual function inside a weapon\'s attack',
	fireBullets3: 'a non-virtual function inside a weapon\'s attack',
	flPlayerFallDamage: 'a game rules virtual: Ham Sandwich hooks entities only',
	fPlayerCanRespawn: 'a game rules virtual: Ham Sandwich hooks entities only',
	fPlayerCanTakeDamage: 'a game rules virtual: Ham Sandwich hooks entities only',
	free: 'the engine frees most entities itself (FL_KILLME): fakemeta\'s RemoveEntity hears a few',
	fShouldSwitchWeapon: 'a game rules virtual: Ham Sandwich hooks entities only',
	getEntityInit: 'the engine\'s own lookup of an entity\'s class',
	getForceCamera: 'a global function of the game; no stock hook',
	getIntoGame: 'a non-virtual function of the player; no stock hook',
	getNextBestWeapon: 'a game rules virtual: Ham Sandwich hooks entities only',
	getPlayerSpawnSpot: 'a game rules virtual: Ham Sandwich hooks entities only',
	giveDefaultItems: 'inside the game rules\' PlayerSpawn, for a player who did not survive and a map without game_player_equip; no stock hook',
	giveNamedItem: 'a non-virtual function of the player; fakemeta\'s CreateNamedEntity hears every entity made by name',
	giveShield: 'a non-virtual function of the player; no stock hook',
	hintMessageEx: 'ReGameDLL\'s own function; the original queues hints',
	isPenetrableEntity: 'ReGameDLL\'s own function',
	joiningThink: 'a non-virtual function of the player; no stock hook',
	kickBack: 'a non-virtual function inside a weapon\'s attack',
	ladderMove: 'player movement inside the game\'s PM_Move; no stock hook',
	move: 'the game\'s PM_Move: fakemeta has no forward for it',
	observerFindNextPlayer: 'a non-virtual function of the player; no stock hook',
	observerIsValidTarget: 'a non-virtual function of the player; no stock hook',
	observerSetMode: 'a non-virtual function of the player; no stock hook',
	observerThink: 'a non-virtual function of the player; no stock hook',
	onEvent: 'the bot manager\'s own events',
	onSpawnEquip: 'ReGameDLL\'s own function',
	playerDeathThink: 'a non-virtual function inside the player\'s PreThink',
	playStepSound: 'player movement inside the game\'s PM_Move; the client plays the steps',
	pmDuck: 'player movement inside the game\'s PM_Move; no stock hook',
	pmJump: 'player movement inside the game\'s PM_Move; no stock hook',
	printf: 'the engine\'s own console',
	radio: 'a non-virtual function of the player; its SendAudio goes to each teammate, and to nobody without one',
	removeAllItems: 'a non-virtual function of the player; no stock hook',
	removeGuns: 'game rules code inside the round\'s restart; no stock hook',
	removeSpawnProtection: 'ReGameDLL\'s own function',
	resetSequenceInfo: 'a non-virtual function of an animating entity',
	sendResources: 'the engine\'s own network code',
	sendSayMessage: 'ReGameDLL\'s own function; the say command and the SayText message are the plugin\'s to hear',
	serverDeactivate: 'happens as the plugins unload; the end event is the plugin\'s',
	setAnimation: 'a non-virtual function of the player; no stock hook',
	setClientUserInfoModel: 'ReGameDLL\'s own function',
	setSpawnProtection: 'ReGameDLL\'s own function',
	showMenu: 'its ShowMenu message is AMX Mod X\'s menus\' too: a hook of it hears every plugin\'s menu',
	spawnHeadGib: 'a global function of the game; no stock hook',
	spawnRandomGibs: 'a global function of the game; no stock hook',
	startDeathCam: 'a non-virtual function of the player; no stock hook',
	startObserver: 'a non-virtual function of the player; no stock hook',
	switchTeam: 'a non-virtual function of the player; its TeamInfo message is every team change\'s',
	takeDamageImpulse: 'ReGameDLL\'s own function',
	teamFull: 'a game rules virtual: Ham Sandwich hooks entities only',
	teamStacked: 'a game rules virtual: Ham Sandwich hooks entities only',
	traceLine: 'a trace inside the flashbang\'s explosion',
	unDuck: 'player movement inside the game\'s PM_Move; no stock hook',
	updateStatusBar: 'a non-virtual function of the player; no stock hook',
	useEmpty: 'a non-virtual function of the player; no stock hook',
	waitTillLand: 'a gib\'s think: Ham Sandwich cannot hook the gib\'s class',
	waterJump: 'player movement inside the game\'s PM_Move; no stock hook',
	writeFullClientUpdate: 'the engine\'s own network code',
};

/** A game rules field of ReGameDLL's own, read on plain HLDS from what the server does have. */
export interface HeardField {
	class: 'A' | 'B';
	backend: string;
	gaps?: Text;
}

export const HEARD_FIELDS: Record<string, HeardField> = {
	gameDesc: { class: 'A', backend: 'fakemeta: GetGameDescription read, and answered with the text written' },
	timeLimit: {
		class: 'B',
		backend: 'mp_timelimit and AMX Mod X\'s time left',
		gaps: {
			en: 'counted from `mp_timelimit` and AMX Mod X\'s time left, which starts when a restart is announced; writing it sets `mp_timelimit`',
			ru: 'считается из `mp_timelimit` и оставшегося времени AMX Mod X, которое идёт с объявления рестарта; запись меняет `mp_timelimit`',
		},
	},
	gameStartTime: {
		class: 'B',
		backend: 'mp_timelimit and AMX Mod X\'s time left',
		gaps: {
			en: 'counted from AMX Mod X\'s time left, which starts when a restart is announced; `0` while `mp_timelimit` is `0`, and writing it does nothing',
			ru: 'считается из оставшегося времени AMX Mod X, которое идёт с объявления рестарта; `0`, пока `mp_timelimit` равен `0`, запись ничего не делает',
		},
	},
	maxPlayers: { class: 'B', backend: 'get_maxplayers', gaps: { en: 'the server\'s slots; writing it does nothing', ru: 'слоты сервера; запись ничего не делает' } },
	msgPlayerVoiceMask: { class: 'B', backend: 'get_user_msgid("VoiceMask")', gaps: { en: 'writing it does nothing', ru: 'запись ничего не делает' } },
	msgRequestState: { class: 'B', backend: 'get_user_msgid("ReqState")', gaps: { en: 'writing it does nothing', ru: 'запись ничего не делает' } },
};

export const FIELDS_NOT_HEARD: Record<string, string> = {
	teamBalanced: 'ReGameDLL\'s own state of the round\'s balance',
	neededPlayers: 'ReGameDLL\'s own flag; the original keeps it in no member the gamedata has',
	skipShowMenu: 'ReGameDLL\'s own option',
	escapeRatio: 'ReGameDLL\'s own count of the escaped terrorists',
	updateInterval: 'the voice manager\'s own timer, which the gamedata does not have',
};
