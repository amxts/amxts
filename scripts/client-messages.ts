// The messages Counter-Strike's server sends its clients, as
// server.addEventListener("message:<Name>", ...) hears them - read by
// scripts/generate-host.ts, which writes their events into as/events.ts.
//
// Every name the game registers is an event; the ones below also have typed
// fields, each an argument of the message by its number (1 is the first
// write_*), read and written as the kind says. The rest are read through
// `event.args`. `player` is every message's receiver, so a player an
// argument names is `target` (or its role: `killer`, `sender`). The words are
// scripts/docs/messages.ts's.

/**
 * What an argument is read as: a number, a boolean, text; `player` a player's
 * number, `0` none (`Player | null`); `weapon` a weapon's id as WeaponKind
 * names it; `hideHud` HideWeapon's flags as HideHud names them; `damage`
 * Damage's bits; `team` a TeamName number; `statusIcon` StatusIcon's state
 * (0 hide, 1 show, 2 flash); `destination` TextMsg's (1 notify, 2 console,
 * 3 chat, 4 center).
 */
export type MessageFieldKind = 'number' | 'boolean' | 'string' | 'player' | 'weapon' | 'hideHud' | 'damage' | 'team' | 'statusIcon' | 'destination';

export interface MessageField {
	name: string;
	/** The argument's number, 1 for the first. */
	arg: number;
	kind: MessageFieldKind;
}

const f = (name: string, arg: number, kind: MessageFieldKind): MessageField => ({ name, arg, kind });

/** The messages with typed fields. */
export const MESSAGE_FIELDS: Record<string, MessageField[]> = {
	AmmoPickup: [f('ammo', 1, 'number'), f('amount', 2, 'number')],
	BarTime: [f('seconds', 1, 'number')],
	Battery: [f('armor', 1, 'number')],
	ClCorpse: [f('model', 1, 'string'), f('target', 12, 'player')],
	CurWeapon: [f('active', 1, 'boolean'), f('weapon', 2, 'weapon'), f('clip', 3, 'number')],
	Damage: [f('armor', 1, 'number'), f('damage', 2, 'number'), f('damageType', 3, 'damage')],
	DeathMsg: [f('killer', 1, 'player'), f('victim', 2, 'player'), f('headshot', 3, 'boolean'), f('weapon', 4, 'string')],
	Health: [f('health', 1, 'number')],
	HideWeapon: [f('flags', 1, 'hideHud')],
	HudTextArgs: [f('text', 1, 'string')],
	ItemPickup: [f('item', 1, 'string')],
	Money: [f('amount', 1, 'number'), f('flash', 2, 'boolean')],
	ResetHUD: [],
	RoundTime: [f('seconds', 1, 'number')],
	SayText: [f('sender', 1, 'player'), f('text', 2, 'string')],
	ScoreInfo: [f('target', 1, 'player'), f('frags', 2, 'number'), f('deaths', 3, 'number'), f('team', 5, 'team')],
	SendAudio: [f('sender', 1, 'player'), f('sound', 2, 'string'), f('pitch', 3, 'number')],
	SetFOV: [f('fov', 1, 'number')],
	StatusIcon: [f('state', 1, 'statusIcon'), f('sprite', 2, 'string')],
	TeamInfo: [f('target', 1, 'player'), f('team', 2, 'string')],
	TextMsg: [f('destination', 1, 'destination'), f('text', 2, 'string')],
	WeapPickup: [f('weapon', 1, 'weapon')],
};

/** Every message Counter-Strike 1.6 registers, by the name get_user_msgid takes. */
export const CLIENT_MESSAGES = `
	ADStop AllowSpec AmmoPickup AmmoX ArmorType BarTime BarTime2 Battery BlinkAcct BombDrop BombPickup
	BotProgress BotVoice Brass BuyClose ClCorpse Crosshair CurWeapon CZCareer CZCareerHUD Damage
	DeathMsg Flashlight FlashBat Fog ForceCam GameMode GameTitle Geiger Health HideWeapon HLTV HostageK
	HostagePos HudText HudTextArgs HudTextPro InitHUD ItemPickup ItemStatus Location Money MOTD
	NVGToggle Radar ReceiveW ReloadSound ReqState ResetHUD RoundTime SayText Scenario ScoreAttrib
	ScoreInfo ScreenFade ScreenShake SendAudio ServerName SetFOV ShadowIdx ShowMenu ShowTimer
	SpecHealth SpecHealth2 Spectator StatusIcon StatusText StatusValue TaskTime TeamInfo TeamScore
	TextMsg Train TutorClose TutorLine TutorState TutorText VGUIMenu ViewMode VoiceMask WeaponList
	WeapPickup
`.trim().split(/\s+/);
