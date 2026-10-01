// The messages Counter-Strike's server sends its clients, as
// server.addEventListener("message:<Name>", ...) hears them - read by
// scripts/generate-host.ts, which writes their events into as/events.ts.
//
// Every name the game registers is an event. MESSAGE_FIELDS is the one table
// of the layouts the game writes them in: a message there is a class of its
// own with a typed field per argument it names (1 is the first write_*),
// read and written as the kind says; one without a known layout - a bot's
// progress, a tutor's text - is read by place, through `event.args`. Every
// message has `args` too, for what the table leaves out. `player` is every
// message's receiver, so a player an argument names is `target` (or its
// role: `killer`, `sender`). The words are scripts/docs/messages.ts's.

/**
 * What an argument is read as: a number, a boolean, text; `texts` every text
 * from the argument on (the words a game text puts in); `player` a player's
 * number, `0` none (`Player | null`); `weapon` a weapon's id as WeaponKind
 * names it; `team` a TeamName number and `teamName` a team written as text,
 * both a Team; `vector` three coordinates from the argument on; `color`
 * `size` bytes from it, red, green, blue (and alpha); `fixed` a number of
 * `scale` parts to one (a time in 1/4096 s); `bit` whether `mask`'s bit is
 * set; `fadeDirection` ScreenFade's FFADE_OUT bit as FadeDirection;
 * `hideHud`, `damage`, `scoreStatus` a mask as an array of HideHud, Damage,
 * ScoreStatus names; `statusIcon` StatusIcon's state (0 hide, 1 show,
 * 2 flash); `destination` TextMsg's (1 notify, 2 console, 3 chat, 4 center);
 * `vguiMenu` a VGUIMenu number as VguiMenu names it.
 */
export type MessageFieldKind = 'number' | 'boolean' | 'string' | 'texts' | 'player' | 'weapon' | 'team' | 'teamName' | 'vector' | 'color' | 'fixed' | 'bit' | 'fadeDirection' | 'hideHud' | 'damage' | 'scoreStatus' | 'statusIcon' | 'destination' | 'vguiMenu';

export interface MessageField {
	name: string;
	/** The argument's number, 1 for the first. */
	arg: number;
	kind: MessageFieldKind;
	/** `fixed`: the parts that make one. `bit`: the bit. `color`: the bytes. */
	of?: number;
}

const f = (name: string, arg: number, kind: MessageFieldKind, of?: number): MessageField => ({ name, arg, kind, ...(of === undefined ? {} : { of }) });

/** The messages whose layout is known, each argument a field. */
export const MESSAGE_FIELDS: Record<string, MessageField[]> = {
	ADStop: [],
	AllowSpec: [f('allowed', 1, 'boolean')],
	AmmoPickup: [f('ammo', 1, 'number'), f('amount', 2, 'number')],
	AmmoX: [f('ammo', 1, 'number'), f('amount', 2, 'number')],
	ArmorType: [f('helmet', 1, 'boolean')],
	BarTime: [f('seconds', 1, 'number')],
	BarTime2: [f('seconds', 1, 'number'), f('startPercent', 2, 'number')],
	Battery: [f('armor', 1, 'number')],
	BlinkAcct: [f('blinks', 1, 'number')],
	BombDrop: [f('origin', 1, 'vector'), f('planted', 4, 'boolean')],
	BombPickup: [],
	BotVoice: [f('talking', 1, 'boolean'), f('target', 2, 'player')],
	BuyClose: [],
	ClCorpse: [f('model', 1, 'string'), f('team', 11, 'team'), f('target', 12, 'player')],
	Crosshair: [f('shown', 1, 'boolean')],
	CurWeapon: [f('active', 1, 'boolean'), f('weapon', 2, 'weapon'), f('clip', 3, 'number')],
	Damage: [f('armor', 1, 'number'), f('damage', 2, 'number'), f('damageType', 3, 'damage'), f('origin', 4, 'vector')],
	DeathMsg: [f('killer', 1, 'player'), f('victim', 2, 'player'), f('headshot', 3, 'boolean'), f('weapon', 4, 'string')],
	Flashlight: [f('on', 1, 'boolean'), f('battery', 2, 'number')],
	FlashBat: [f('battery', 1, 'number')],
	Geiger: [f('range', 1, 'number')],
	Health: [f('health', 1, 'number')],
	HideWeapon: [f('flags', 1, 'hideHud')],
	HostageK: [f('hostage', 1, 'number')],
	HostagePos: [f('hostage', 2, 'number'), f('origin', 3, 'vector')],
	HudText: [f('text', 1, 'string')],
	HudTextArgs: [f('text', 1, 'string'), f('params', 4, 'texts')],
	HudTextPro: [f('text', 1, 'string')],
	InitHUD: [],
	ItemPickup: [f('item', 1, 'string')],
	ItemStatus: [f('nightVision', 1, 'bit', 1), f('defuseKit', 1, 'bit', 2)],
	Location: [f('target', 1, 'player'), f('place', 2, 'string')],
	Money: [f('amount', 1, 'number'), f('flash', 2, 'boolean')],
	MOTD: [f('last', 1, 'boolean'), f('text', 2, 'string')],
	NVGToggle: [f('on', 1, 'boolean')],
	Radar: [f('target', 1, 'player'), f('origin', 2, 'vector')],
	ReqState: [],
	ResetHUD: [],
	RoundTime: [f('seconds', 1, 'number')],
	SayText: [f('sender', 1, 'player'), f('text', 2, 'string'), f('params', 3, 'texts')],
	Scenario: [f('active', 1, 'boolean'), f('sprite', 2, 'string'), f('alpha', 3, 'number')],
	ScoreAttrib: [f('target', 1, 'player'), f('flags', 2, 'scoreStatus')],
	ScoreInfo: [f('target', 1, 'player'), f('frags', 2, 'number'), f('deaths', 3, 'number'), f('team', 5, 'team')],
	ScreenFade: [
		f('duration', 1, 'fixed', 4096),
		f('hold', 2, 'fixed', 4096),
		f('direction', 3, 'fadeDirection'),
		f('modulate', 3, 'bit', 2),
		f('stay', 3, 'bit', 4),
		f('color', 4, 'color', 4),
	],
	ScreenShake: [f('amplitude', 1, 'fixed', 4096), f('duration', 2, 'fixed', 4096), f('frequency', 3, 'fixed', 256)],
	SendAudio: [f('sender', 1, 'player'), f('sound', 2, 'string'), f('pitch', 3, 'number')],
	ServerName: [f('serverName', 1, 'string')],
	SetFOV: [f('fov', 1, 'number')],
	ShowMenu: [f('more', 3, 'boolean'), f('text', 4, 'string')],
	ShowTimer: [],
	SpecHealth: [f('health', 1, 'number')],
	SpecHealth2: [f('health', 1, 'number'), f('target', 2, 'player')],
	Spectator: [f('target', 1, 'player'), f('spectator', 2, 'boolean')],
	StatusIcon: [f('state', 1, 'statusIcon'), f('sprite', 2, 'string'), f('color', 3, 'color', 3)],
	StatusText: [f('line', 1, 'number'), f('text', 2, 'string')],
	StatusValue: [f('slot', 1, 'number'), f('value', 2, 'number')],
	TaskTime: [f('seconds', 1, 'number'), f('active', 2, 'boolean'), f('fade', 3, 'number')],
	TeamInfo: [f('target', 1, 'player'), f('team', 2, 'teamName')],
	TeamScore: [f('team', 1, 'teamName'), f('score', 2, 'number')],
	TextMsg: [f('destination', 1, 'destination'), f('text', 2, 'string'), f('params', 3, 'texts')],
	Train: [f('speed', 1, 'number')],
	TutorClose: [],
	VGUIMenu: [f('menu', 1, 'vguiMenu')],
	ViewMode: [],
	WeaponList: [
		f('classname', 1, 'string'),
		f('ammo', 2, 'number'),
		f('maxAmmo', 3, 'number'),
		f('ammo2', 4, 'number'),
		f('maxAmmo2', 5, 'number'),
		f('slot', 6, 'number'),
		f('position', 7, 'number'),
		f('weapon', 8, 'weapon'),
	],
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
