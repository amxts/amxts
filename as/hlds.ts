// The game events and game rules fields of ReGameDLL's and ReHLDS's own,
// which reapi alone delivers, on a server without it - plain HLDS - through
// the stock modules: AMX Mod X's logevents and messages, Ham Sandwich,
// fakemeta, cstrike, a client's commands. scripts/hlds-events.ts says, for
// each, what plain HLDS gives and what it does not.
//
// `<event>Hlds(fire)` is registered once, on the event's first listener, when
// the server has no reapi (as/hooks.ts). It makes the event with the fields
// the stock hook knows - by the argument's place in reapi's hookchain, as the
// event's getters read it - and hands it to the listeners before the game and
// to those after it: a stock hook mostly hears the game once it has acted,
// so both run then. What a listener asks of the game - preventDefault(), an
// answer, a field written - reaches it where the stock hook can take it, and
// is one line in the console where it cannot (`settle`).
import {
	Call, CellBuffer, Player, game, server, publicFor, handled, arg, argText, cellFloat, floatCell,
	__ham, __onCell, __outcome, __sayOnce, __whenPrecache, __whenUp
} from "./facade";
import { Entity } from "./entities";
import {
	HookEvent, AddMoneyEvent, BounceGibTouchEvent, BuyGunAmmoEvent, BuyItemEvent, BuyWeaponByWeaponIdEvent,
	CanPlayerHearPlayerEvent, ChangeLevelEvent, CleanUpMapEvent, ChooseAppearanceEvent, ChooseTeamEvent, ClientConnectedEvent,
	ClientUserInfoChangedEvent, ConnectClientEvent, DeathNoticeEvent, DeathSoundEvent, DefuseBombEndEvent,
	DefuseBombStartEvent, DropClientEvent, DropPlayerItemEvent, ExplodeBombEvent, GameThinkEvent, GibSpawnEvent,
	GiveC4Event, GoToIntermissionEvent, HasRestrictItemEvent, MakeBomberEvent, MakeVipEvent, RoundStartEvent,
	PainEvent, PlantBombEvent, PlayerBlindEvent, PlayerGotWeaponEvent, PlayerKilledEvent, PlayerSpawnEvent,
	PrecacheGenericIEvent, PrecacheModelIEvent, PrecacheSoundIEvent, NewRoundEvent, RoundEndEvent,
	SendDeathMessageEvent, SetClientUserInfoNameEvent, SetModelEvent, ShowVguiMenuEvent, StartSoundEvent,
	ThrowFlashbangEvent, ThrowGrenadeEvent, ThrowHeGrenadeEvent, ThrowSmokeGrenadeEvent
} from "./hooks";
import {
	GetHamReturnInteger, NATIVE_dllfunc, NATIVE_engfunc, NATIVE_forward_return, NATIVE_register_event,
	NATIVE_register_logevent, cs_get_user_money, find_ent_by_model, get_cvar_float, get_ent_data,
	get_gametime, get_maxplayers, get_orig_retval, get_timeleft, get_user_info, get_user_msgid, get_user_name,
	get_user_userid, is_user_alive, is_user_connected, pev_valid, read_argv, read_logargv, read_logdata, register_clcmd, register_forward,
	set_cvar_float,
} from "./natives";
import {
	CSI_DEFUSER, CSI_FLASHBANG, CSI_HEGRENADE, CSI_LAST_WEAPON, CSI_NVGS, CSI_PRIAMMO, CSI_SECAMMO, CSI_SHIELD,
	CSI_SHIELDGUN, CSI_SMOKEGRENADE, CSI_VEST, CSI_VESTHELM, DLLFunc_GetGameDescription, EngFunc_PrecacheEvent,
	EngFunc_SetClientListening, FMRES_IGNORED, FMRES_SUPERCEDE, FMV_CELL, FMV_STRING, FM_EmitSound,
	FM_GetGameDescription, FM_PrecacheGeneric, FM_PrecacheModel, FM_PrecacheSound, FM_SetModel,
	FM_Voice_SetClientListening, Ham_AddPlayerItem, Ham_CS_Player_Blind, Ham_Killed, Ham_Spawn,
	ITEM_ASSAULT, ITEM_DEFUSEKIT, ITEM_KEVLAR, ITEM_NVG, ITEM_SHIELDGUN, ITEM_TYPE_BUYING,
	ROUND_ALL_HOSTAGES_RESCUED, ROUND_BOMB_DEFUSED, ROUND_CTS_PREVENT_ESCAPE, ROUND_CTS_WIN, ROUND_END_DRAW,
	ROUND_ESCAPING_TERRORISTS_NEUTRALIZED, ROUND_GAME_COMMENCE, ROUND_HOSTAGE_NOT_RESCUED, ROUND_NONE,
	ROUND_TARGET_BOMB, ROUND_TARGET_SAVED, ROUND_TERRORISTS_ESCAPED, ROUND_TERRORISTS_NOT_ESCAPED,
	ROUND_TERRORISTS_WIN, ROUND_VIP_ASSASSINATED, ROUND_VIP_ESCAPED, ROUND_VIP_NOT_ESCAPED, WINSTATUS_CTS,
	PLUGIN_HANDLED, WINSTATUS_DRAW, WINSTATUS_NONE, WINSTATUS_TERRORISTS
} from "./constants";
import { TextMsgMessage, SendAudioMessage, MoneyMessage, DeathMsgMessage, VGUIMenuMessage } from "./events";

/** The listeners of one event, phase by phase: as/hooks.ts's `<event>FireHlds`. */
type Fire<E> = (event: E, post: bool) => void;

/**
 * What the listeners asked of the game that this backend cannot give it: one
 * line in the console for the event. `block` is what the stock hook answers to
 * stop the game's function, -1 where it cannot; `answers` that the backend
 * gave the game the listener's answer itself.
 */
function settle(event: HookEvent, name: string, block: i32 = -1, answers: bool = false): void {
	if (event.__prevented && block >= 0) __outcome(block);
	const lost = (event.__prevented && block < 0) || (event.__answered && !answers) || event.__changed;
	if (lost) __sayOnce(`${name} is heard on this server without ReAPI, where the game does not take a listener's preventDefault(), answer or change of a field`);
}

/** The listeners before the game, then the ones after it, on one event; then what they asked of the game. */
function hear<E>(fire: Fire<E>, event: E, name: string, block: i32 = -1): void {
	fire(event, false);
	fire(event, true);
	settle(changetype<HookEvent>(event), name, block);
}

/** A player's index, or 0 for anything else. */
function playerOr0(id: i32): i32 {
	return id >= 1 && id <= get_maxplayers() && is_user_connected(id) != 0 ? id : 0;
}

// ---------------------------------------------------------------- the game's log

/**
 * Calls `handler` on a line of the game's log that AMX Mod X's logevent
 * filter takes: `argc` arguments, `filter` such as "1=Round_End".
 */
function onLog(key: string, argc: i32, filter: string, handler: () => void): void {
	__whenUp((): void => {
		const pub = publicFor((a: number, b: number, c: number, d: number): void => {
			if (heardTwice(key)) return;
			handler();
		}, `hlds:log:${key}`);
		if (pub.length > 0) new Call(NATIVE_register_logevent).str(pub).num(argc).str(filter).run();
	});
}

// AMX Mod X walks its logevents with the line it parsed last. A line logged
// while a logevent runs - the "Round_End" of the kills a listener of
// "Round_Start" makes - is heard, and then again by every logevent after
// the outer one as its walk goes on. Each logevent hears a line once a frame.
const lastLines = new Map<string, string>();

function heardTwice(key: string): bool {
	const line = `${get_gametime()} ${read_logdata()}`;
	if (lastLines.has(key) && lastLines.get(key) == line) return true;
	lastLines.set(key, line);
	return false;
}

/** The player a log line names first - `"Name<userid><authid><team>"` - or 0. */
function loggedPlayer(): i32 {
	const text = read_logargv(0);
	// The name may hold `<` itself: the user id is the third group from the end.
	const team = text.lastIndexOf("<");
	const authid = team > 0 ? text.lastIndexOf("<", team - 1) : -1;
	const userid = authid > 0 ? text.lastIndexOf("<", authid - 1) : -1;
	if (userid < 0) return 0;
	const wanted = I32.parseInt(text.slice(userid + 1, authid - 1));
	const max = get_maxplayers();
	for (let id = 1; id <= max; id++) {
		if (is_user_connected(id) != 0 && get_user_userid(id) == wanted) return id;
	}
	return 0;
}

/** A player's line of the log - `"..." triggered "<what>"`: the player, 0 when he is gone. */
function onPlayerLog(event: string, what: string, handler: (id: i32) => void): void {
	onLog(event, 3, `2=${what}`, (): void => handler(loggedPlayer()));
}

/** The planted bomb: the grenade with the C4's model, or 0. */
function plantedBomb(): i32 {
	return max(<i32>find_ent_by_model(-1, "grenade", "models/w_c4.mdl"), 0);
}

// ---------------------------------------------------------------- fakemeta

/** Hooks a fakemeta function: `handler` reads its arguments with arg() and argText(). */
function onFakemeta(fn: i32, post: bool, key: string, handler: () => void, early: bool = false): void {
	const register = (): void => {
		const pub = publicFor((a: number, b: number, c: number, d: number): void => handler(), `hlds:fm:${key}`, FMRES_IGNORED);
		if (pub.length > 0) register_forward(fn, pub, post ? 1 : 0);
	};
	if (early) __whenPrecache(register);
	else __whenUp(register);
}

// One SetModel hook for every event that hears an entity get its model: each
// looks at it and takes its own.
const modelHearers: ((entity: i32, model: string) => void)[] = [];

function onSetModel(hearer: (entity: i32, model: string) => void): void {
	if (modelHearers.length == 0) onFakemeta(FM_SetModel, false, "setmodel", heardModel);
	modelHearers.push(hearer);
}

function heardModel(): void {
	const entity = <i32>arg(0);
	const model = argText(1);
	for (let i = 0; i < modelHearers.length; i++) modelHearers[i](entity, model);
}

// One EmitSound hook for every event that hears a sound.
const soundHearers: ((entity: i32, sample: string) => void)[] = [];

function onSound(hearer: (entity: i32, sample: string) => void): void {
	if (soundHearers.length == 0) onFakemeta(FM_EmitSound, false, "emitsound", heardSound);
	soundHearers.push(hearer);
}

function heardSound(): void {
	const entity = <i32>arg(0);
	const sample = argText(2);
	for (let i = 0; i < soundHearers.length; i++) soundHearers[i](entity, sample);
}

// ---------------------------------------------------------------- client commands

/** Hears a client command before the game: `handler` may block it with handled(). */
function onCommand(event: string, command: string, handler: (id: i32) => void): void {
	__whenUp((): void => {
		const pub = publicFor((a: number, b: number, c: number, d: number): void => handler(<i32>a), `hlds:${event}:${command}`);
		if (pub.length > 0) register_clcmd(command, pub);
	});
}

/** A command's first argument as a number; 0 for none. */
function commandNumber(): i32 {
	const text = read_argv(1);
	return text.length > 0 ? I32.parseInt(text) : 0;
}

// ---------------------------------------------------------------- the round

// The game time of this round's HLTV message: the players respawned after it
// at that same time, when the map's decals are reset.
let newRoundAt: f64 = -1;

/**
 * A new round: the HLTV message the game sends when it restarts a round,
 * before the players respawn. A map's first round is a restart too - the
 * game commences once both sides have players.
 */
export function newRoundHlds(fire: Fire<NewRoundEvent>): void {
	__whenUp((): void => {
		const pub = publicFor((a: number, b: number, c: number, d: number): void => announceRound(fire), "hlds:event:HLTV");
		if (pub.length > 0) new Call(NATIVE_register_event).str("HLTV").str(pub).str("a").str("1=0").str("2=0").run();
	});
}

function announceRound(fire: Fire<NewRoundEvent>): void {
	const now = get_gametime();
	if (now == newRoundAt) return;
	newRoundAt = now;
	const event = new NewRoundEvent();
	fire(event, false);
	settle(event, "newRound");
}

// The map's decals reset: the game's CleanUpMap plays events/decal_reset.sc
// as a round restarts, after its players have respawned, and nothing else
// does. The engine's playback forward is heard for that one event alone,
// compared in the module: it fires on every shot.
const decalHearers: (() => void)[] = [];

function onDecalsReset(hearer: () => void): void {
	if (decalHearers.length == 0) {
		__whenUp((): void => {
			const decals = <i32>new Call(NATIVE_engfunc).num(EngFunc_PrecacheEvent).ref(1).str("events/decal_reset.sc").run();
			__onCell("pfn_playbackevent", decalsReset.index, 2, decals);
		});
	}
	decalHearers.push(hearer);
}

function decalsReset(a: i32): void {
	for (let i = 0; i < decalHearers.length; i++) decalHearers[i]();
}

/** The round once its players have respawned: the decals' reset at its HLTV message's time. */
export function newRoundPostHlds(fire: Fire<NewRoundEvent>): void {
	onDecalsReset((): void => {
		if (get_gametime() != newRoundAt) return;
		const event = new NewRoundEvent();
		fire(event, true);
		settle(event, "newRound");
	});
}

/** The map cleaned up for a new round: the decals' reset, its last step. */
export function cleanUpMapHlds(fire: Fire<CleanUpMapEvent>): void {
	onDecalsReset((): void => hear(fire, new CleanUpMapEvent(), "cleanUpMap"));
}

/** The freeze time is over: the game logs "Round_Start". */
export function roundStartHlds(fire: Fire<RoundStartEvent>): void {
	onLog("roundStart", 2, "1=Round_Start", (): void => hear(fire, new RoundStartEvent(), "roundStart"));
}

// The round's end, told before its log line, by the time each came: the
// centred message the game sends - "#Terrorists_Win" - the log line of the
// side that won, or of the world - "Terrorists_Win" - and the radio sound.
let endText = "";
let endTextAt: f64 = -1;
let endTrigger = "";
let endTriggerAt: f64 = -1;
let endSound = "";
let endSoundAt: f64 = -1;

/** A round's end as the game announces it: its message, and the reason and the winner it is. */
class Ending {
	constructor(public text: string, public reason: i32, public winner: i32) {}
}

const ENDINGS: Ending[] = [
	new Ending("#Target_Bombed", ROUND_TARGET_BOMB, WINSTATUS_TERRORISTS),
	new Ending("#VIP_Escaped", ROUND_VIP_ESCAPED, WINSTATUS_CTS),
	new Ending("#VIP_Assassinated", ROUND_VIP_ASSASSINATED, WINSTATUS_TERRORISTS),
	new Ending("#Terrorists_Escaped", ROUND_TERRORISTS_ESCAPED, WINSTATUS_TERRORISTS),
	new Ending("#CTs_PreventEscape", ROUND_CTS_PREVENT_ESCAPE, WINSTATUS_CTS),
	new Ending("#Escaping_Terrorists_Neutralized", ROUND_ESCAPING_TERRORISTS_NEUTRALIZED, WINSTATUS_CTS),
	new Ending("#Bomb_Defused", ROUND_BOMB_DEFUSED, WINSTATUS_CTS),
	new Ending("#CTs_Win", ROUND_CTS_WIN, WINSTATUS_CTS),
	new Ending("#Terrorists_Win", ROUND_TERRORISTS_WIN, WINSTATUS_TERRORISTS),
	new Ending("#Round_Draw", ROUND_END_DRAW, WINSTATUS_DRAW),
	new Ending("#All_Hostages_Rescued", ROUND_ALL_HOSTAGES_RESCUED, WINSTATUS_CTS),
	new Ending("#Target_Saved", ROUND_TARGET_SAVED, WINSTATUS_CTS),
	new Ending("#Hostages_Not_Rescued", ROUND_HOSTAGE_NOT_RESCUED, WINSTATUS_TERRORISTS),
	new Ending("#Terrorists_Not_Escaped", ROUND_TERRORISTS_NOT_ESCAPED, WINSTATUS_CTS),
	new Ending("#VIP_Not_Escaped", ROUND_VIP_NOT_ESCAPED, WINSTATUS_TERRORISTS),
	new Ending("#Game_Commencing", ROUND_GAME_COMMENCE, WINSTATUS_DRAW),
];

/** The ending a text names, or null. */
function endingOf(text: string): Ending | null {
	for (let i = 0; i < ENDINGS.length; i++) {
		if (ENDINGS[i].text == text) return ENDINGS[i];
	}
	return null;
}

/**
 * The round's end: the game logs "Round_End" after its message, its log line
 * of who won and its sound, which say who won and why - the message, or
 * where a plugin changed it the log line, then the sound. The delay is the
 * game's when the round is already ending (as game.endRound leaves it), or
 * the original game's: 3 seconds for "Game Commencing", 5 for every other end.
 */
export function roundEndHlds(fire: Fire<RoundEndEvent>): void {
	server.addEventListener("message:TextMsg", (message: TextMsgMessage): void => {
		if (message.destination != "center" || !message.text.startsWith("#")) return;
		endText = message.text;
		endTextAt = get_gametime();
	});
	server.addEventListener("message:SendAudio", (message: SendAudioMessage): void => {
		if (message.sender != null || !message.sound.startsWith("%!MRAD_")) return;
		endSound = message.sound;
		endSoundAt = get_gametime();
	});
	onLog("roundEnd:team", 6, "0=Team", (): void => {
		endTrigger = `#${read_logargv(3)}`;
		endTriggerAt = get_gametime();
	});
	onLog("roundEnd:world", 4, "0=World triggered", (): void => {
		endTrigger = `#${read_logargv(1)}`;
		endTriggerAt = get_gametime();
	});
	onLog("roundEnd", 2, "1=Round_End", (): void => {
		const now = get_gametime();
		let ending = endTextAt == now ? endingOf(endText) : null;
		if (ending == null && endTriggerAt == now) ending = endingOf(endTrigger);
		const reason = ending != null ? ending.reason : ROUND_NONE;
		const winner = ending != null ? ending.winner : endSoundAt == now ? soundWinner(endSound) : WINSTATUS_NONE;
		const terminating = game.roundTerminating && game.restartRoundTime > now;
		const delay = terminating ? game.restartRoundTime - now : reason == ROUND_GAME_COMMENCE ? 3.0 : 5.0;
		const event = new RoundEndEvent();
		event.__give(0, winner);
		event.__give(1, reason);
		event.__give(2, <i32>floatCell(delay));
		event.__give(-1, 1);
		hear(fire, event, "roundEnd");
	});
}

function soundWinner(sound: string): i32 {
	if (sound == "%!MRAD_terwin") return WINSTATUS_TERRORISTS;
	if (sound == "%!MRAD_ctwin") return WINSTATUS_CTS;
	if (sound == "%!MRAD_rounddraw") return WINSTATUS_DRAW;
	return WINSTATUS_NONE;
}

/** The game rules think once a frame: the server's frame. */
export function gameThinkHlds(fire: Fire<GameThinkEvent>): void {
	server.addEventListener("frame", (): void => hear(fire, new GameThinkEvent(), "gameThink"));
}

/** The map is over: the game sends SVC_INTERMISSION, which AMX Mod X's events hear as "30". */
export function goToIntermissionHlds(fire: Fire<GoToIntermissionEvent>): void {
	__whenUp((): void => {
		const pub = publicFor((a: number, b: number, c: number, d: number): void => hear(fire, new GoToIntermissionEvent(), "goToIntermission"), "hlds:event:30");
		if (pub.length > 0) new Call(NATIVE_register_event).str("30").str(pub).str("a").run();
	});
}

/** The game changes the map: AMX Mod X's server_changelevel. */
export function changeLevelHlds(fire: Fire<ChangeLevelEvent>): void {
	server.addEventListener("changelevel", (): void => hear(fire, new ChangeLevelEvent(), "changeLevel"));
}

// ---------------------------------------------------------------- spawning and dying

/** A player spawned into the round: Ham Sandwich's Spawn after the game, of a player alive - not one who only joined. */
export function playerSpawnHlds(fire: Fire<PlayerSpawnEvent>): void {
	__ham(Ham_Spawn, "player", (id: number, b: number, c: number, d: number): void => {
		if (is_user_alive(<i32>id) == 0) return;
		const event = new PlayerSpawnEvent();
		event.__give(0, <i32>id);
		hear(fire, event, "playerSpawn");
	}, true);
}

/** A player was killed: Ham Sandwich's Killed after the game; the inflictor is the last that hurt him. */
export function playerKilledHlds(fire: Fire<PlayerKilledEvent>): void {
	__ham(Ham_Killed, "player", (victim: number, killer: number, c: number, d: number): void => {
		const inflictor = new Entity(victim).damageInflictor;
		const event = new PlayerKilledEvent();
		event.__give(0, <i32>victim);
		event.__give(1, <i32>killer);
		event.__give(2, <i32>inflictor);
		hear(fire, event, "playerKilled");
	}, true);
}

/** The game tells everyone of a death: its DeathMsg. */
export function deathNoticeHlds(fire: Fire<DeathNoticeEvent>): void {
	server.addEventListener("message:DeathMsg", (message: DeathMsgMessage): void => {
		const victim = message.victim;
		const killer = message.killer;
		const event = new DeathNoticeEvent();
		event.__give(0, victim != null ? <i32>victim.id : 0);
		event.__give(1, killer != null ? <i32>killer.id : 0);
		hear(fire, event, "deathNotice");
	});
}

/** The death message itself: DeathMsg, which preventDefault() keeps from the players. */
export function sendDeathMessageHlds(fire: Fire<SendDeathMessageEvent>): void {
	server.addEventListener("message:DeathMsg", (message: DeathMsgMessage): void => {
		const victim = message.victim;
		const killer = message.killer;
		const event = new SendDeathMessageEvent();
		event.__give(0, killer != null ? <i32>killer.id : 0);
		event.__give(1, victim != null ? <i32>victim.id : 0);
		event.__giveText(4, message.weapon);
		// KillRarity's first flag is the headshot.
		event.__give(6, message.headshot ? 1 : 0);
		hear(fire, event, "sendDeathMessage", PLUGIN_HANDLED);
	});
}

// A player's pain and death sounds - the game's CBasePlayer::Pain and
// DeathSound play nothing else, so stopping the sound stops the function.
const PAIN_SOUNDS: string[] = [
	"player/bhit_flesh-1.wav", "player/bhit_flesh-2.wav", "player/bhit_flesh-3.wav",
	"player/bhit_kevlar-1.wav", "player/bhit_helmet-1.wav",
	"player/headshot1.wav", "player/headshot2.wav", "player/headshot3.wav"
];
const DEATH_SOUNDS: string[] = ["player/die1.wav", "player/die2.wav", "player/die3.wav", "player/death6.wav"];

/** A player's pain: the sound the game plays for it, his last hit group and his armour read from him. */
export function painHlds(fire: Fire<PainEvent>): void {
	onSound((entity: i32, sample: string): void => {
		if (playerOr0(entity) == 0 || !PAIN_SOUNDS.includes(sample)) return;
		const hitGroup = <i32>get_ent_data(entity, "CBasePlayer", "m_LastHitGroup");
		const armour = <i32>get_ent_data(entity, "CBasePlayer", "m_iKevlar") != 0;
		const event = new PainEvent();
		event.__give(0, entity);
		event.__give(1, hitGroup);
		event.__give(2, armour ? 1 : 0);
		hear(fire, event, "pain", FMRES_SUPERCEDE);
	});
}

/** A player's death cry: the sound the game plays for it. */
export function deathSoundHlds(fire: Fire<DeathSoundEvent>): void {
	onSound((entity: i32, sample: string): void => {
		if (playerOr0(entity) == 0 || !DEATH_SOUNDS.includes(sample)) return;
		const event = new DeathSoundEvent();
		event.__give(0, entity);
		hear(fire, event, "deathSound", FMRES_SUPERCEDE);
	});
}

/** A sound the game plays through the engine's EmitSound; the recipients are everyone. */
export function startSoundHlds(fire: Fire<StartSoundEvent>): void {
	onSound((entity: i32, sample: string): void => {
		const event = new StartSoundEvent();
		event.__give(1, entity);
		event.__give(2, <i32>arg(1));
		event.__giveText(3, sample);
		event.__give(4, <i32>Math.round(cellFloat(arg(3)) * 255));
		event.__give(5, <i32>arg(4));
		event.__give(6, <i32>arg(5));
		event.__give(7, <i32>arg(6));
		hear(fire, event, "startSound", FMRES_SUPERCEDE);
	});
}

// ---------------------------------------------------------------- the bomb and the VIP

/** The terrorist who gets the bomb at the round's start: the game logs "Spawned_With_The_Bomb". */
export function giveC4Hlds(fire: Fire<GiveC4Event>): void {
	onPlayerLog("giveC4", "Spawned_With_The_Bomb", (id: i32): void => {
		const event = new GiveC4Event();
		event.__give(-1, id);
		hear(fire, event, "giveC4");
	});
}

export function makeBomberHlds(fire: Fire<MakeBomberEvent>): void {
	onPlayerLog("makeBomber", "Spawned_With_The_Bomb", (id: i32): void => {
		const event = new MakeBomberEvent();
		event.__give(0, id);
		event.__give(-1, 1);
		hear(fire, event, "makeBomber");
	});
}

export function makeVipHlds(fire: Fire<MakeVipEvent>): void {
	onPlayerLog("makeVip", "Became_VIP", (id: i32): void => {
		const event = new MakeVipEvent();
		event.__give(0, id);
		hear(fire, event, "makeVip");
	});
}

/** The bomb planted: the game gives the new bomb its model, with its planter, place and velocity set. */
export function plantBombHlds(fire: Fire<PlantBombEvent>): void {
	onSetModel((entity: i32, model: string): void => {
		if (model != "models/w_c4.mdl") return;
		const bomb = new Entity(entity);
		if (bomb.classname != "grenade") return;
		const event = new PlantBombEvent();
		event.__give(0, playerOr0(<i32>bomb.owner));
		event.__giveVector(1, bomb.origin);
		event.__giveVector(2, bomb.velocity);
		event.__give(-1, entity);
		hear(fire, event, "plantBomb");
	});
}

/** A defuse begins: the game logs "Begin_Bomb_Defuse_With_Kit", or "_Without_Kit". */
export function defuseBombStartHlds(fire: Fire<DefuseBombStartEvent>): void {
	onLog("defuseBombStart", 3, "2&Begin_Bomb_Defuse_", (): void => {
		const event = new DefuseBombStartEvent();
		event.__give(0, plantedBomb());
		event.__give(1, loggedPlayer());
		hear(fire, event, "defuseBombStart");
	});
}

/** The bomb defused: the game logs "Defused_The_Bomb". */
export function defuseBombEndHlds(fire: Fire<DefuseBombEndEvent>): void {
	onPlayerLog("defuseBombEnd", "Defused_The_Bomb", (id: i32): void => {
		const event = new DefuseBombEndEvent();
		event.__give(0, plantedBomb());
		event.__give(1, id);
		event.__give(2, 1);
		hear(fire, event, "defuseBombEnd");
	});
}

/** The bomb blew up: the terrorists trigger "Target_Bombed". */
export function explodeBombHlds(fire: Fire<ExplodeBombEvent>): void {
	onLog("explodeBomb", 6, "3=Target_Bombed", (): void => {
		const event = new ExplodeBombEvent();
		event.__give(0, plantedBomb());
		hear(fire, event, "explodeBomb");
	});
}

// ---------------------------------------------------------------- money and buying

// The money the game last sent each player, by his index: the change is the
// next amount less this one. -1 for none yet.
const moneySent: i32[] = new Array<i32>(33).fill(-1);

/** A player's money changed: the Money message the game sends him, by how much it moved. */
export function addMoneyHlds(fire: Fire<AddMoneyEvent>): void {
	// A bot is put in the server before the game has made him: his money is
	// not there yet, and the first message he is sent is what counts from.
	server.addEventListener("putinserver", (event): void => {
		const id = <i32>event.player.id;
		moneySent[id] = pev_valid(id) == 2 ? <i32>cs_get_user_money(id) : -1;
	});
	__whenUp((): void => {
		const max = get_maxplayers();
		for (let id = 1; id <= max; id++) moneySent[id] = is_user_connected(id) != 0 ? <i32>cs_get_user_money(id) : -1;
	});
	server.addEventListener("message:Money", (message: MoneyMessage): void => {
		const player = message.player;
		if (player == null) return;
		const id = <i32>player.id;
		const amount = <i32>message.amount;
		const before = moneySent[id];
		moneySent[id] = amount;
		if (before < 0 || amount == before) return;
		const event = new AddMoneyEvent();
		event.__give(0, id);
		event.__give(1, amount - before);
		event.__give(3, message.flash ? 1 : 0);
		hear(fire, event, "addMoney");
	});
}

/** What cstrike's CS_OnBuy hears, by the item it buys - each event takes its own. */
function onBuy(handler: (id: i32, item: i32) => void): void {
	server.addEventListener("CS_OnBuy", (event): void => handler(<i32>event.player.id, <i32>event.item));
}

const EQUIPMENT: i32[] = [CSI_VEST, CSI_VESTHELM, CSI_FLASHBANG, CSI_HEGRENADE, CSI_SMOKEGRENADE, CSI_NVGS, CSI_DEFUSER, CSI_SHIELD];

/** A weapon bought: CS_OnBuy of a gun; a grenade is equipment. */
export function buyWeaponByWeaponIdHlds(fire: Fire<BuyWeaponByWeaponIdEvent>): void {
	onBuy((id: i32, item: i32): void => {
		if (item < 1 || item > CSI_LAST_WEAPON || EQUIPMENT.includes(item)) return;
		const event = new BuyWeaponByWeaponIdEvent();
		event.__give(0, id);
		event.__give(1, item);
		hear(fire, event, "buyWeaponByWeaponId", PLUGIN_HANDLED);
	});
}

/** An item of the equipment menu bought: CS_OnBuy, its slot there. */
export function buyItemHlds(fire: Fire<BuyItemEvent>): void {
	onBuy((id: i32, item: i32): void => {
		const at = EQUIPMENT.indexOf(item == CSI_SHIELDGUN ? CSI_SHIELD : item);
		if (at < 0) return;
		const event = new BuyItemEvent();
		event.__give(0, id);
		event.__give(1, at + 1);
		hear(fire, event, "buyItem", PLUGIN_HANDLED);
	});
}

/** Ammo bought: CS_OnBuy of a gun's ammo. */
export function buyGunAmmoHlds(fire: Fire<BuyGunAmmoEvent>): void {
	onBuy((id: i32, item: i32): void => {
		if (item != CSI_PRIAMMO && item != CSI_SECAMMO) return;
		const event = new BuyGunAmmoEvent();
		event.__give(0, id);
		event.__give(2, 1);
		event.__give(-1, 1);
		hear(fire, event, "buyGunAmmo", PLUGIN_HANDLED);
	});
}

/** Whether an item is forbidden to buy: cstrike's CS_OnBuyAttempt, answered `true` to forbid. */
export function hasRestrictItemHlds(fire: Fire<HasRestrictItemEvent>): void {
	server.addEventListener("CS_OnBuyAttempt", (attempt): void => {
		const item = itemOf(<i32>attempt.item);
		if (item < ITEM_SHIELDGUN) return;
		const event = new HasRestrictItemEvent();
		event.__give(0, <i32>attempt.player.id);
		event.__give(1, item);
		event.__give(2, ITEM_TYPE_BUYING);
		fire(event, false);
		fire(event, true);
		if (event.__answered && event.__answerCell != 0) handled();
		// Blocking it answers false: the game decides, as it does unasked.
		event.__prevented = false;
		settle(event, "hasRestrictItem", -1, true);
	});
}

/** A CSI_ item as ReGameDLL's ItemID: a weapon is the same number, equipment is not. */
function itemOf(csi: i32): i32 {
	if (csi >= 1 && csi <= CSI_LAST_WEAPON) return csi;
	if (csi == CSI_VEST) return ITEM_KEVLAR;
	if (csi == CSI_VESTHELM) return ITEM_ASSAULT;
	if (csi == CSI_DEFUSER) return ITEM_DEFUSEKIT;
	if (csi == CSI_NVGS) return ITEM_NVG;
	if (csi == CSI_SHIELD || csi == CSI_SHIELDGUN) return ITEM_SHIELDGUN;
	return -1;
}

// ---------------------------------------------------------------- teams, menus, commands

/** A team picked: `jointeam`, or a number in the game's team menu. */
export function chooseTeamHlds(fire: Fire<ChooseTeamEvent>): void {
	const chosen = (id: i32): void => {
		const event = new ChooseTeamEvent();
		event.__give(0, id);
		event.__give(1, commandNumber());
		hear(fire, event, "chooseTeam", PLUGIN_HANDLED);
	};
	onCommand("chooseTeam", "jointeam", chosen);
	onCommand("chooseTeam", "menuselect", (id: i32): void => {
		const menu = new Player(id).menu;
		if (menu == "team" || menu == "teamInGame") chosen(id);
	});
}

/** A model picked: `joinclass`, or a number in the game's class menu. */
export function chooseAppearanceHlds(fire: Fire<ChooseAppearanceEvent>): void {
	const chosen = (id: i32): void => {
		const event = new ChooseAppearanceEvent();
		event.__give(0, id);
		event.__give(1, commandNumber());
		hear(fire, event, "chooseAppearance", PLUGIN_HANDLED);
	};
	onCommand("chooseAppearance", "joinclass", chosen);
	onCommand("chooseAppearance", "menuselect", (id: i32): void => {
		if (new Player(id).menu == "appearance") chosen(id);
	});
}

/** A weapon dropped: the player's `drop` command, with the weapon he names. */
export function dropPlayerItemHlds(fire: Fire<DropPlayerItemEvent>): void {
	onCommand("dropPlayerItem", "drop", (id: i32): void => {
		const event = new DropPlayerItemEvent();
		event.__give(0, id);
		event.__giveText(1, read_argv(1));
		hear(fire, event, "dropPlayerItem", PLUGIN_HANDLED);
	});
}

/** A VGUI menu shown: its VGUIMenu message, which preventDefault() keeps from the player. */
export function showVguiMenuHlds(fire: Fire<ShowVguiMenuEvent>): void {
	server.addEventListener("message:VGUIMenu", (message: VGUIMenuMessage): void => {
		const player = message.player;
		const event = new ShowVguiMenuEvent();
		event.__give(0, player != null ? <i32>player.id : 0);
		event.__give(1, <i32>message.args.number(0));
		event.__give(2, <i32>message.args.number(1));
		hear(fire, event, "showVguiMenu", PLUGIN_HANDLED);
	});
}

// ---------------------------------------------------------------- clients

export function clientConnectedHlds(fire: Fire<ClientConnectedEvent>): void {
	server.addEventListener("connect", (client): void => {
		const event = new ClientConnectedEvent();
		event.__give(0, <i32>client.player.id);
		hear(fire, event, "clientConnected");
	});
}

export function connectClientHlds(fire: Fire<ConnectClientEvent>): void {
	server.addEventListener("connect", (): void => hear(fire, new ConnectClientEvent(), "connectClient"));
}

/** A client dropped: AMX Mod X's client_disconnected, with the reason it was told. */
export function dropClientHlds(fire: Fire<DropClientEvent>): void {
	server.addEventListener("disconnected", (left): void => {
		const event = new DropClientEvent();
		event.__give(0, <i32>left.player.id);
		event.__giveText(2, left.reason);
		hear(fire, event, "dropClient");
	});
}

export function clientUserInfoChangedHlds(fire: Fire<ClientUserInfoChangedEvent>): void {
	server.addEventListener("infochanged", (changed): void => {
		const event = new ClientUserInfoChangedEvent();
		event.__give(0, <i32>changed.player.id);
		hear(fire, event, "clientUserInfoChanged");
	});
}

/** A new name asked for: the info's name is not the one the player has. */
export function setClientUserInfoNameHlds(fire: Fire<SetClientUserInfoNameEvent>): void {
	server.addEventListener("infochanged", (changed): void => {
		const id = changed.player.id;
		const wanted = get_user_info(id, "name");
		if (wanted == get_user_name(id)) return;
		const event = new SetClientUserInfoNameEvent();
		event.__give(0, <i32>id);
		event.__giveText(2, wanted);
		event.__give(-1, 1);
		hear(fire, event, "setClientUserInfoName");
	});
}

// ---------------------------------------------------------------- items, effects, sounds

/** A player blinded: Ham Sandwich's CS_Player_Blind after the game - (untilTime, holdTime, fadeTime, alpha). */
export function playerBlindHlds(fire: Fire<PlayerBlindEvent>): void {
	__ham(Ham_CS_Player_Blind, "player", (id: number, b: number, c: number, d: number): void => {
		const event = new PlayerBlindEvent();
		event.__give(0, <i32>id);
		event.__give(3, <i32>arg(3));
		event.__give(4, <i32>arg(2));
		event.__give(5, <i32>arg(4));
		hear(fire, event, "playerBlind");
	}, true);
}

// Ham Sandwich's by-address answer.
const hamAnswer = new StaticArray<i32>(1);

/** A player got a weapon: Ham Sandwich's AddPlayerItem after the game, when it took the item. */
export function playerGotWeaponHlds(fire: Fire<PlayerGotWeaponEvent>): void {
	__ham(Ham_AddPlayerItem, "player", (id: number, item: number, c: number, d: number): void => {
		GetHamReturnInteger(changetype<i32>(hamAnswer));
		if (hamAnswer[0] == 0) return;
		const event = new PlayerGotWeaponEvent();
		event.__give(0, <i32>id);
		event.__give(1, <i32>item);
		hear(fire, event, "playerGotWeapon");
	}, true);
}

/**
 * Who hears whom: the game tells the engine for each pair of players, and the
 * answer is told instead - preventDefault() answers `false`.
 */
export function canPlayerHearPlayerHlds(fire: Fire<CanPlayerHearPlayerEvent>): void {
	onFakemeta(FM_Voice_SetClientListening, false, "voice", (): void => {
		const listener = playerOr0(<i32>arg(0));
		const sender = playerOr0(<i32>arg(1));
		if (listener == 0 || sender == 0) return;
		const event = new CanPlayerHearPlayerEvent();
		event.__give(0, listener);
		event.__give(1, sender);
		event.__give(-1, <i32>arg(2));
		fire(event, false);
		fire(event, true);
		if (event.__answered || event.__prevented) {
			const hears = event.__prevented ? 0 : event.__answerCell;
			new Call(NATIVE_engfunc).num(EngFunc_SetClientListening).ref(listener).ref(sender).ref(hears).run();
			new Call(NATIVE_forward_return).num(FMV_CELL).ref(hears).run();
			__outcome(FMRES_SUPERCEDE);
		}
		event.__prevented = false;
		settle(event, "canPlayerHearPlayer", -1, true);
	});
}

/**
 * A grenade thrown: the game gives it its model once its thrower, place,
 * velocity and fuse are set - the time it blows up, less now.
 */
function onThrown(model: string, heard: (grenade: Entity, thrower: i32, fuse: f64) => void): void {
	onSetModel((entity: i32, given: string): void => {
		if (given != model) return;
		const grenade = new Entity(entity);
		if (grenade.classname != "grenade" || grenade.damageTime == 0) return;
		heard(grenade, playerOr0(<i32>grenade.owner), grenade.damageTime - get_gametime());
	});
}

export function throwHeGrenadeHlds(fire: Fire<ThrowHeGrenadeEvent>): void {
	onThrown("models/w_hegrenade.mdl", (grenade: Entity, thrower: i32, fuse: f64): void => {
		const team = thrower > 0 ? <i32>get_ent_data(thrower, "CBasePlayer", "m_iTeam") : 0;
		const event = new ThrowHeGrenadeEvent();
		event.__give(0, thrower);
		event.__giveVector(1, grenade.origin);
		event.__giveVector(2, grenade.velocity);
		event.__give(3, <i32>floatCell(fuse));
		event.__give(4, team);
		event.__give(-1, <i32>grenade.id);
		hear(fire, event, "throwHeGrenade");
	});
}

export function throwFlashbangHlds(fire: Fire<ThrowFlashbangEvent>): void {
	onThrown("models/w_flashbang.mdl", (grenade: Entity, thrower: i32, fuse: f64): void => {
		const event = new ThrowFlashbangEvent();
		event.__give(0, thrower);
		event.__giveVector(1, grenade.origin);
		event.__giveVector(2, grenade.velocity);
		event.__give(3, <i32>floatCell(fuse));
		event.__give(-1, <i32>grenade.id);
		hear(fire, event, "throwFlashbang");
	});
}

export function throwSmokeGrenadeHlds(fire: Fire<ThrowSmokeGrenadeEvent>): void {
	onThrown("models/w_smokegrenade.mdl", (grenade: Entity, thrower: i32, fuse: f64): void => {
		const event = new ThrowSmokeGrenadeEvent();
		event.__give(0, thrower);
		event.__giveVector(1, grenade.origin);
		event.__giveVector(2, grenade.velocity);
		event.__give(3, <i32>floatCell(fuse));
		event.__give(-1, <i32>grenade.id);
		hear(fire, event, "throwSmokeGrenade");
	});
}

const THROWN: string[] = ["models/w_hegrenade.mdl", "models/w_flashbang.mdl", "models/w_smokegrenade.mdl"];

/** Any grenade thrown; the grenade's weapon is the one in the thrower's hands. */
export function throwGrenadeHlds(fire: Fire<ThrowGrenadeEvent>): void {
	for (let i = 0; i < THROWN.length; i++) {
		onThrown(THROWN[i], (grenade: Entity, thrower: i32, fuse: f64): void => {
			const weapon = thrower > 0 ? new Player(thrower).activeItem : null;
			const event = new ThrowGrenadeEvent();
			event.__give(0, thrower);
			event.__give(1, weapon != null ? <i32>weapon.id : 0);
			event.__giveVector(2, grenade.origin);
			event.__giveVector(3, grenade.velocity);
			event.__give(4, <i32>floatCell(fuse));
			event.__give(-1, <i32>grenade.id);
			hear(fire, event, "throwGrenade");
		});
	}
}

/** A weaponbox given its model: preventDefault() keeps it off. */
export function setModelHlds(fire: Fire<SetModelEvent>): void {
	onSetModel((entity: i32, model: string): void => {
		if (new Entity(entity).classname != "weaponbox") return;
		const event = new SetModelEvent();
		event.__give(0, entity);
		event.__giveText(1, model);
		hear(fire, event, "setModel", FMRES_SUPERCEDE);
	});
}

/** A gib spawned: the game gives it its model last. */
export function gibSpawnHlds(fire: Fire<GibSpawnEvent>): void {
	onSetModel((entity: i32, model: string): void => {
		if (new Entity(entity).classname != "gib") return;
		const event = new GibSpawnEvent();
		event.__give(0, entity);
		event.__giveText(1, model);
		hear(fire, event, "gibSpawn");
	});
}

/** A gib touched something: the engine module's touch of the gib, which preventDefault() blocks. */
export function bounceGibTouchHlds(fire: Fire<BounceGibTouchEvent>): void {
	game.addEventListener("touch", (touch): void => {
		const event = new BounceGibTouchEvent();
		event.__give(0, <i32>touch.toucher.id);
		event.__give(1, <i32>touch.touched.id);
		hear(fire, event, "bounceGibTouch", PLUGIN_HANDLED);
	}, { toucher: "gib" });
}

/**
 * The game precaches a file: fakemeta's forward, added at plugin_precache,
 * before the game's own. The listeners before the game hear it as it is
 * asked, preventDefault() skips it; the ones after hear the engine's answer.
 */
function onPrecache<E>(fn: i32, key: string, make: () => E, fire: Fire<E>, name: string): void {
	onFakemeta(fn, false, `${key}:pre`, (): void => {
		const event = make();
		const fields = changetype<HookEvent>(event);
		fields.__giveText(0, argText(0));
		fire(event, false);
		settle(changetype<HookEvent>(event), name, FMRES_SUPERCEDE);
	}, true);
	onFakemeta(fn, true, `${key}:post`, (): void => {
		const event = make();
		const fields = changetype<HookEvent>(event);
		fields.__giveText(0, argText(0));
		fields.__give(-1, <i32>get_orig_retval());
		fire(event, true);
		settle(changetype<HookEvent>(event), name);
	}, true);
}

export function precacheModelIHlds(fire: Fire<PrecacheModelIEvent>): void {
	onPrecache<PrecacheModelIEvent>(FM_PrecacheModel, "model", (): PrecacheModelIEvent => new PrecacheModelIEvent(), fire, "precacheModelI");
}

export function precacheSoundIHlds(fire: Fire<PrecacheSoundIEvent>): void {
	onPrecache<PrecacheSoundIEvent>(FM_PrecacheSound, "sound", (): PrecacheSoundIEvent => new PrecacheSoundIEvent(), fire, "precacheSoundI");
}

export function precacheGenericIHlds(fire: Fire<PrecacheGenericIEvent>): void {
	onPrecache<PrecacheGenericIEvent>(FM_PrecacheGeneric, "generic", (): PrecacheGenericIEvent => new PrecacheGenericIEvent(), fire, "precacheGenericI");
}

// ---------------------------------------------------------------- the game rules' fields

// The game's description a plugin wrote, answered for the game's own; "" for none yet.
let gameDescWritten = "";

/** The game's description: the one written, or the game's own. */
export function gameDescHlds(): string {
	if (gameDescWritten.length > 0) return gameDescWritten;
	const text = new CellBuffer(64);
	new Call(NATIVE_dllfunc).num(DLLFunc_GetGameDescription).tailBuffer(text, 63).run();
	return text.text();
}

/** Writes the game's description: the game's GetGameDescription is answered with it from now on. */
export function setGameDescHlds(value: string): void {
	if (gameDescWritten.length == 0) {
		onFakemeta(FM_GetGameDescription, false, "gamedesc", (): void => {
			new Call(NATIVE_forward_return).num(FMV_STRING).str(gameDescWritten).run();
			__outcome(FMRES_SUPERCEDE);
		});
	}
	gameDescWritten = value;
}

/**
 * The game time the game began: AMX Mod X counts the map's time left from
 * the map's start, or from the last restart it saw announced; with no time
 * limit there is none, and it is 0.
 */
function gameStart(): f64 {
	const limit = get_cvar_float("mp_timelimit") * 60;
	return limit > 0 ? get_gametime() + get_timeleft() - limit : 0;
}

export function gameStartTimeHlds(): i32 {
	return <i32>floatCell(gameStart());
}

export function setGameStartTimeHlds(cell: i32): void {
	readOnly("gameStartTime");
}

/** The game time the map ends by its time limit, 0 for none: mp_timelimit after the game's start. */
export function timeLimitHlds(): i32 {
	const limit = get_cvar_float("mp_timelimit") * 60;
	return <i32>floatCell(limit > 0 ? gameStart() + limit : 0);
}

/** Moves the map's end: mp_timelimit, in minutes after the game's start. */
export function setTimeLimitHlds(cell: i32): void {
	const end = cellFloat(cell);
	set_cvar_float("mp_timelimit", end > 0 ? max((end - gameStart()) / 60, 0) : 0);
}

export function maxPlayersHlds(): i32 {
	return <i32>get_maxplayers();
}

export function setMaxPlayersHlds(cell: i32): void {
	readOnly("maxPlayers");
}

export function msgPlayerVoiceMaskHlds(): i32 {
	return <i32>get_user_msgid("VoiceMask");
}

export function setMsgPlayerVoiceMaskHlds(cell: i32): void {
	readOnly("msgPlayerVoiceMask");
}

export function msgRequestStateHlds(): i32 {
	return <i32>get_user_msgid("ReqState");
}

export function setMsgRequestStateHlds(cell: i32): void {
	readOnly("msgRequestState");
}

function readOnly(name: string): void {
	__sayOnce(`game.${name} is read from the server without ReAPI here, and writing it does nothing`);
}
