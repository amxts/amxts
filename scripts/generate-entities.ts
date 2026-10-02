import type { GamedataMember } from './gamedata';
import type { HamFunction, HamKind, HamParam } from './ham-functions';
// Generates as/entities.ts: Entity, PlayerFields, Weapon and GameFields (the
// game rules, which the facade's Game extends), one typed property per reapi
// field.
//
// reapi documents every field it can reach - entvars and the members of each
// game class - with the exact call that reads it:
//
//     * Get params:       Float:get_entvar(index, EntVars:var);
//     var_gravity,
//
// That line is the field's type. `Float:` in front is a float, a trailing
// `Float:output[3]` a vector, `dest[], len` text, and nothing at all a whole
// number. A plugin writes `player.gravity = 0.5` and never learns which of
// get_entvar's shapes it went through - which is the point: the rendermode
// glow bug came from an int field written as a float.
//
// Run: bun scripts/generate-entities.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { dedent, docsLang, pick, renderDoc } from './apply-docs';
import { ENTITY_FIELDS, ENTITY_METHODS, ENTITY_TYPES } from './docs/entities';
import { entvarLayout } from './entvars';
import { gamedataMember, REAPI_ONLY_MEMBERS } from './gamedata';
import { HAM_FUNCTIONS } from './ham-functions';
import { HEARD_FIELDS } from './hlds-events';
import { includePath } from './includes';

type Shape = 'float' | 'int' | 'bool' | 'vector' | 'string';

interface Field {
	reapi: string; // var_gravity, m_iHideHUD
	name: string; // gravity, hideHud
	shape: Shape;
	settable: boolean;
	memberType: string;
	/** Whose field it is: "entvars", or the game class - CBasePlayer, CBasePlayerWeapon. */
	owner: string;
	/** A pointer to a weapon or a player, read as that object rather than an index. */
	points?: 'Weapon' | 'Player';
	/** An engine enum the field holds one value of, read and written as a name (ENUM_FIELDS). */
	enumType?: string;
	/** The key of its entry in scripts/docs/entities.ts, when that is not the reapi name. */
	docKey?: string;
}

interface Skipped {
	reapi: string;
	why: string;
}

/** The fields of one enum block, with the comment above each. */
function blocksOf(path: string, enumName: string) {
	const text = readFileSync(path, 'utf8');
	const start = text.includes(`enum ${enumName}\n`) ? text.indexOf(`enum ${enumName}\n`) : text.indexOf(`enum ${enumName}\r\n`);
	if (start < 0) throw new Error(`${enumName} not found in ${path}`);
	const end = text.indexOf('\n};', start);
	const body = text.slice(start, end);

	const found: { reapi: string; comment: string }[] = [];
	for (const m of body.matchAll(/\/\*([\s\S]*?)\*\/\s*(\w+)\s*(?:=[^,\n]*)?,?/g)) {
		found.push({ reapi: m[2], comment: m[1] });
	}
	return found;
}

function line(comment: string, label: string) {
	const m = comment.match(new RegExp(`${label}:\\s*(.*)`));
	return m ? m[1].trim() : '';
}

/** The type the Get params line says, or null for a shape this does not read. */
function shapeOf(get: string, memberType: string): Shape | null {
	// A char array is text; an element index means an array member, and
	// TraceResult: and the rest are handles - this does not model those yet.
	if (/^get_\w+\(index, [^,()]+, dest\[\], const lenght\);$/.test(get)) return 'string';
	if (/\belement\b/.test(get) || /\[\d+\]/.test(memberType)) return null;
	if (/^Float:get_\w+\(index, [^,()]+\);$/.test(get)) return 'float';
	if (/^get_\w+\(index, [^,()]+, Float:output\[3\]\);$/.test(get)) return 'vector';
	if (/^get_\w+\(index, [^,()]+, dest\[\], const lenght\);$/.test(get)) return 'string';
	if (/^get_\w+\(index, [^,()]+\);$/.test(get)) {
		return /^(?:bool|qboolean|BOOL)$/.test(memberType.trim()) ? 'bool' : 'int';
	}
	return null;
}

// entvar names are lowercase and glued - `var_rendermode` - so the words are
// spelled out here; anything not listed keeps its name as it is.
const ENTVAR_WORDS: Record<string, string> = {
	globalname: 'globalName',
	oldorigin: 'oldOrigin',
	basevelocity: 'baseVelocity',
	clbasevelocity: 'clBaseVelocity',
	movedir: 'moveDir',
	avelocity: 'angularVelocity',
	punchangle: 'punchAngle',
	v_angle: 'viewAngle',
	endpos: 'endPos',
	startpos: 'startPos',
	impacttime: 'impactTime',
	starttime: 'startTime',
	fixangle: 'fixAngle',
	idealpitch: 'idealPitch',
	pitch_speed: 'pitchSpeed',
	ideal_yaw: 'idealYaw',
	yaw_speed: 'yawSpeed',
	modelindex: 'modelIndex',
	viewmodel: 'viewModel',
	weaponmodel: 'weaponModel',
	absmin: 'absMin',
	absmax: 'absMax',
	ltime: 'localTime',
	nextthink: 'nextThink',
	movetype: 'moveType',
	light_level: 'lightLevel',
	gaitsequence: 'gaitSequence',
	animtime: 'animTime',
	framerate: 'frameRate',
	rendermode: 'renderMode',
	renderamt: 'renderAmount',
	rendercolor: 'renderColor',
	renderfx: 'renderFx',
	takedamage: 'takeDamage',
	deadflag: 'deadFlag',
	view_ofs: 'viewOffset',
	dmg_inflictor: 'damageInflictor',
	aiment: 'aimEntity',
	groundentity: 'groundEntity',
	spawnflags: 'spawnFlags',
	colormap: 'colorMap',
	max_health: 'maxHealth',
	teleport_time: 'teleportTime',
	// The armour's points: `player.armor` is the facade's, the same number.
	armorvalue: 'armor',
	waterlevel: 'waterLevel',
	watertype: 'waterType',
	targetname: 'targetName',
	netname: 'netName',
	dmg_take: 'damageTaken',
	dmg_save: 'damageSaved',
	dmg: 'damage',
	dmgtime: 'damageTime',
	air_finished: 'airFinished',
	pain_finished: 'painFinished',
	radsuit_finished: 'radsuitFinished',
	playerclass: 'playerClass',
	maxspeed: 'maxSpeed',
	weaponanim: 'weaponAnim',
	pushmsec: 'pushMsec',
	gamestate: 'gameState',
	oldbuttons: 'oldButtons',
	groupinfo: 'groupInfo',
	button: 'buttons',
};

// Hungarian prefixes Valve's members carry: m_iHideHUD, m_flVelocityModifier.
const HUNGARIAN = /^(rgfl|rgi|rgp|rgb|rg|pfn|psz|pent|bits|fl|sz|vec|us|ui|iz|tm|af|ch|[bifphnvtce])(?=[A-Z])/;

/** HideHUD -> hideHud, VGUIMenus -> vguiMenus, 9mm -> 9mm. */
function camel(raw: string) {
	const words = raw.split('_').flatMap(part =>
		part.match(/[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+/g) ?? []);
	return words
		.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
		.join('');
}

// Names a member would otherwise get that read wrong: m_pPlayer is the
// weapon's holder, and `player.player` or `weapon.owner` (taken by var_owner)
// would not say so.
const MEMBER_NAMES: Record<string, string> = {
	m_pPlayer: 'player',
	m_pNext: 'next',
	// The game rules' last round: a RoundWinner, as game.endRound takes it,
	// and "roundWinStatus" holding "CT" would read wrong.
	m_iRoundWinStatus: 'roundWinner',
	// A moment, not the act: `game.checkWinConditions` would read as a method.
	m_flCheckWinConditions: 'checkWinConditionsTime',
	// reapi keeps ReGameDLL's spelling; the property is spelled right.
	m_szAnimExtention: 'animExtension',
	// The game's words for what a player has another word for: `player.money`,
	// as a player says it, not the engine's `account`.
	m_iAccount: 'money',
	m_iLastAccount: 'lastSentMoney',
	m_tmNextAccountHealthUpdate: 'nextScoreboardUpdate',
	// "Client" here is the value last sent to the player's game.
	m_iClientHealth: 'healthSent',
	m_iClientFOV: 'fovSent',
	m_iClientBattery: 'batterySent',
	m_iClientHideHUD: 'hideHudSent',
	m_pClientActiveItem: 'activeItemSent',
	m_iFlashBattery: 'flashlightBattery',
	m_flFlashLightTime: 'flashlightTime',
	// A lowercase word after the prefix, which HUNGARIAN does not strip.
	m_flgeigerDelay: 'geigerDelay',
	m_flgeigerRange: 'geigerRange',
	m_igeigerRangePrev: 'geigerRangePrev',
	m_idrowndmg: 'drownDamage',
	m_idrownrestored: 'drownRestored',
	currentammo: 'currentAmmo',
	m_flGaitframe: 'gaitFrame',
	// pev->gaitsequence is gaitSequence; this is the one the game picked.
	m_iGaitsequence: 'playerGaitSequence',
	m_flGaityaw: 'gaitYaw',
	m_prevgaitorigin: 'prevGaitOrigin',
	m_lastx: 'lastX',
	m_lasty: 'lastY',
	m_SbarString0: 'statusBarText',
	m_flNextSBarUpdateTime: 'nextStatusBarUpdate',
	m_pentSndLast: 'lastSoundEntity',
	m_flSndRange: 'soundRange',
	m_flSndRoomtype: 'roomType',
	m_tbdPrev: 'timeBasedDamagePrev',
	m_bPunishedForTK: 'punishedForTeamKill',
	m_fLongJump: 'hasLongJump',
	m_flVelocityModifier: 'slowdown',
	m_tSneaking: 'sneakingUntil',
	m_pTank: 'mountedGun',
	m_iTrain: 'trainControls',
	m_fWeapon: 'weaponHudValid',
	m_iMenu: 'openMenu',
	m_iNumSpawns: 'spawnCount',
	m_iAutoWepSwitch: 'autoSwitchWeapon',
	m_progressStart: 'progressBarStart',
	m_progressEnd: 'progressBarEnd',
	m_fOnTarget: 'aimingAtTarget',
	// The game rules, in a player's words for the round and the sides.
	m_iAccountCT: 'ctRoundBonus',
	m_iAccountTerrorist: 'terroristRoundBonus',
	m_iC4Guy: 'bomber',
	m_iC4Timer: 'bombTimer',
	m_iNumCT: 'ctCount',
	m_iNumTerrorist: 'terroristCount',
	m_iNumCTWins: 'ctWins',
	m_iNumTerroristWins: 'terroristWins',
	m_iNumSpawnableCT: 'spawnableCts',
	m_iNumSpawnableTerrorist: 'spawnableTerrorists',
	m_iNumConsecutiveCTLoses: 'ctLossStreak',
	m_iNumConsecutiveTerroristLoses: 'terroristLossStreak',
	m_flRestartRoundTime: 'newRoundTime',
	m_fRoundStartTimeReal: 'freezeStartTime',
	m_iIntroRoundTime: 'freezeTime',
	m_bFreezePeriod: 'isFreezeTime',
	m_bRoundTerminating: 'roundEnding',
	m_bTCantBuy: 'terroristsCantBuy',
	m_bCTCantBuy: 'ctsCantBuy',
	m_iUnBalancedRounds: 'unbalancedRounds',
	m_bLevelInitialized: 'mapInitialized',
	m_iEndIntermissionButtonHit: 'intermissionSkipped',
	m_flForceCameraValue: 'forceCamera',
	m_flForceChaseCamValue: 'forceChaseCam',
	m_flFadeToBlackValue: 'fadeToBlack',
	m_GameDesc: 'gameName',
	// A weapon's.
	m_Weapon_fInReload: 'isReloading',
	m_Weapon_fInSpecialReload: 'shotgunReloadStage',
	m_Weapon_iClientClip: 'clipSent',
	m_Weapon_flGlock18Shoot: 'glockNextBurstShot',
	m_Weapon_iGlock18ShotsFired: 'glockBurstShots',
	m_Weapon_flFamasShoot: 'famasNextBurstShot',
	m_Weapon_iFamasShotsFired: 'famasBurstShots',
	m_Weapon_flDecreaseShotsFired: 'recoilResetTime',
	m_Weapon_flTimeWeaponIdle: 'nextIdle',
	m_Weapon_iPrimaryAmmoType: 'ammoType',
};

// Left out of the API, still read and written through the natives
// (`get_member(id, m_Activity)`): the monster AI's members a player carries
// but the game never uses for one, Condition Zero's career mode, the user
// message numbers, the firing events' indexes, a second copy of the team, the
// pistol's own last-shot time beside every weapon's `lastFireTime`, and
// pev->armortype, which Counter-Strike does not use (`kevlar` is the armour's kind).
const HIDDEN = new Set([
	'm_Activity',
	'm_IdealActivity',
	'm_MonsterState',
	'm_IdealMonsterState',
	'm_afConditions',
	'm_afMemory',
	'm_vecEnemyLKP',
	'm_HackedGunPos',
	'm_hTargetEnt',
	'm_bInCareerGame',
	'm_fCareerRoundMenuTime',
	'm_iCareerMatchWins',
	'm_fCareerMatchMenuTime',
	'm_iRoundWinDifference',
	'm_msgPlayerVoiceMask',
	'm_msgRequestState',
	'm_Weapon_usFireGlock18',
	'm_Weapon_usFireFamas',
	'm_szTeamName',
	'm_Weapon_flLastFire',
	'var_armortype',
]);

function nameOf(reapi: string) {
	if (MEMBER_NAMES[reapi]) return MEMBER_NAMES[reapi];
	// maxammo_9mm is two words glued: maxAmmo9mm, as ammo_9mm is ammo9mm.
	if (reapi.startsWith('maxammo_')) return camel(`max_ammo_${reapi.slice('maxammo_'.length)}`);
	if (reapi.startsWith('var_')) {
		const rest = reapi.slice(4);
		if (ENTVAR_WORDS[rest]) return ENTVAR_WORDS[rest];
		return camel(rest.replace(HUNGARIAN, ''));
	}
	let rest = reapi.startsWith('m_') ? reapi.slice(2) : reapi;
	// m_Weapon_iClip is the weapon's clip: `weapon.clip`, not `weapon.weaponClip`.
	if (rest.startsWith('Weapon_')) rest = rest.slice('Weapon_'.length);
	return camel(rest.replace(HUNGARIAN, ''));
}

/** What a pointer member points at, when this models it as an object. */
function pointsAt(memberType: string): 'Weapon' | 'Player' | undefined {
	if (/^class CBasePlayer(?:Item|Weapon) \*$/.test(memberType.trim())) return 'Weapon';
	if (/^class CBasePlayer \*$/.test(memberType.trim())) return 'Player';
	return undefined;
}

// Written by hand in the facade's Player, with the type a plugin expects
// (team a name). A generated one would clash. `health` and `armor` are not
// here: every entity has pev->health and pev->armorvalue, and Player's whole
// numbers override Entity's.
const HAND_WRITTEN = new Set([
	'name',
	'frags',
	'deaths',
	'team',
	'ip',
	'authid',
	'isAlive',
	'isConnected',
	'isBot',
	'id',
]);

// A field that holds one value of an engine enum is a name, both ways:
// `entity.renderMode = "additive"`, `if (player.waterLevel == "head")`. The
// type is a union of string literals, like the flag families; under the hood
// the getter is a switch from the number to a static string (nothing is
// allocated per read) and the setter a chain of comparisons back.
//
// Each type names its members by the constant each stands for, looked up in
// as/constants.ts - so a name cannot drift from the include it came from - or
// by the number itself where the includes have no constant; a comment says
// then where the number is used. `prefix` names every constant that starts
// with it by its suffix: ACT_RANGE_ATTACK1 -> rangeAttack1.
//
// A number no name stands for - a Pawn plugin or a mod wrote it - reads as
// "unknown", the way a hook's enum argument does; writing "unknown" leaves
// the field as it is. The number itself is still get_entvar/get_member away.
interface EnumType {
	names?: Record<string, string | number>;
	prefix?: string;
	/** The constant family a Pawn plugin writes, for the tooltip's Pawn: line. */
	pawn: string;
	/**
	 * A union the facade declares (RoundWinner): only its name <-> number
	 * functions are written here, and a number no name stands for reads as
	 * this name, since the union has no "unknown".
	 */
	existing?: string;
}

const ENUM_TYPES: Record<string, EnumType> = {
	RoundWinner: {
		pawn: 'WINSTATUS_*',
		existing: 'none',
		names: { none: 'WINSTATUS_NONE', CT: 'WINSTATUS_CTS', TERRORIST: 'WINSTATUS_TERRORISTS', draw: 'WINSTATUS_DRAW' },
	},
	RenderMode: {
		pawn: 'kRender*',
		names: { normal: 'kRenderNormal', color: 'kRenderTransColor', texture: 'kRenderTransTexture', glow: 'kRenderGlow', alpha: 'kRenderTransAlpha', additive: 'kRenderTransAdd' },
	},
	RenderFx: { pawn: 'kRenderFx*', prefix: 'kRenderFx' },
	MoveType: {
		pawn: 'MOVETYPE_*',
		names: {
			none: 'MOVETYPE_NONE',
			walk: 'MOVETYPE_WALK',
			step: 'MOVETYPE_STEP',
			fly: 'MOVETYPE_FLY',
			toss: 'MOVETYPE_TOSS',
			push: 'MOVETYPE_PUSH',
			noclip: 'MOVETYPE_NOCLIP',
			flyMissile: 'MOVETYPE_FLYMISSILE',
			bounce: 'MOVETYPE_BOUNCE',
			bounceMissile: 'MOVETYPE_BOUNCEMISSILE',
			follow: 'MOVETYPE_FOLLOW',
			pushStep: 'MOVETYPE_PUSHSTEP',
		},
	},
	Solid: {
		pawn: 'SOLID_*',
		names: { none: 'SOLID_NOT', trigger: 'SOLID_TRIGGER', box: 'SOLID_BBOX', slideBox: 'SOLID_SLIDEBOX', bsp: 'SOLID_BSP' },
	},
	// DAMAGE_NO 0.0, DAMAGE_YES 1.0 and DAMAGE_AIM 2.0 (hlsdk_const.inc) are
	// float #defines, which as/constants.ts does not carry; pev->takedamage is
	// a float.
	TakeDamage: { pawn: 'DAMAGE_*', names: { no: 0, yes: 1, aim: 2 } },
	DeadFlag: {
		pawn: 'DEAD_*',
		names: { alive: 'DEAD_NO', dying: 'DEAD_DYING', dead: 'DEAD_DEAD', respawnable: 'DEAD_RESPAWNABLE', discardBody: 'DEAD_DISCARDBODY' },
	},
	// No constants: ReGameDLL's PM_CheckWater sets 1 when the feet are in,
	// 2 when the hull's middle is, 3 when the eyes are.
	WaterLevel: { pawn: 'pev->waterlevel', names: { none: 0, feet: 1, waist: 2, head: 3 } },
	Contents: { pawn: 'CONTENTS_*', prefix: 'CONTENTS_' },
	// No constants: ReHLDS's SV_WriteClientdataToMessage sends svc_addangle
	// with avelocity's yaw for 2, svc_setangle with angles for anything else.
	FixAngle: { pawn: 'pev->fixangle', names: { none: 0, set: 1, addYaw: 2 } },
	HitGroup: {
		pawn: 'HITGROUP_*',
		names: {
			generic: 'HITGROUP_GENERIC',
			head: 'HITGROUP_HEAD',
			chest: 'HITGROUP_CHEST',
			stomach: 'HITGROUP_STOMACH',
			leftArm: 'HITGROUP_LEFTARM',
			rightArm: 'HITGROUP_RIGHTARM',
			leftLeg: 'HITGROUP_LEFTLEG',
			rightLeg: 'HITGROUP_RIGHTLEG',
			shield: 'HITGROUP_SHIELD',
		},
	},
	ArmorType: { pawn: 'ARMOR_*', names: { none: 'ARMOR_NONE', vest: 'ARMOR_KEVLAR', vestHelmet: 'ARMOR_VESTHELM' } },
	ObserverMode: {
		pawn: 'OBS_*',
		names: { none: 'OBS_NONE', chaseLocked: 'OBS_CHASE_LOCKED', chaseFree: 'OBS_CHASE_FREE', roaming: 'OBS_ROAMING', inEye: 'OBS_IN_EYE', mapFree: 'OBS_MAP_FREE', mapChase: 'OBS_MAP_CHASE' },
	},
	// LTEXT is the MOTD, the long text the game shows a joining player.
	JoinState: {
		pawn: 'JoinState',
		names: { joined: 'JOINED', showMotd: 'SHOWLTEXT', readingMotd: 'READINGLTEXT', showTeamSelect: 'SHOWTEAMSELECT', pickingTeam: 'PICKINGTEAM', getIntoGame: 'GETINTOGAME' },
	},
	PlayerModel: {
		pawn: 'MODEL_*',
		names: {
			unassigned: 'MODEL_UNASSIGNED',
			urban: 'MODEL_CT_URBAN',
			terror: 'MODEL_T_TERROR',
			leet: 'MODEL_T_LEET',
			arctic: 'MODEL_T_ARCTIC',
			gsg9: 'MODEL_CT_GSG9',
			gign: 'MODEL_CT_GIGN',
			sas: 'MODEL_CT_SAS',
			guerilla: 'MODEL_T_GUERILLA',
			vip: 'MODEL_CT_VIP',
			militia: 'MODEL_T_MILITIA',
			spetsnaz: 'MODEL_CT_SPETSNAZ',
			auto: 'MODEL_AUTO',
		},
	},
	// IGNOREMSG_TEAM is "the enemy's and the teammates'": everyone's chat.
	IgnoredChat: { pawn: 'IGNOREMSG_*', names: { none: 'IGNOREMSG_NONE', enemy: 'IGNOREMSG_ENEMY', all: 'IGNOREMSG_TEAM' } },
	GameMenu: {
		pawn: 'Menu_*',
		names: {
			none: 'Menu_OFF',
			team: 'Menu_ChooseTeam',
			teamInGame: 'Menu_IGChooseTeam',
			appearance: 'Menu_ChooseAppearance',
			buy: 'Menu_Buy',
			buyPistol: 'Menu_BuyPistol',
			buyRifle: 'Menu_BuyRifle',
			buyMachineGun: 'Menu_BuyMachineGun',
			buyShotgun: 'Menu_BuyShotgun',
			buySubMachineGun: 'Menu_BuySubMachineGun',
			buyItem: 'Menu_BuyItem',
			radio1: 'Menu_Radio1',
			radio2: 'Menu_Radio2',
			radio3: 'Menu_Radio3',
			clientBuy: 'Menu_ClientBuy',
		},
	},
	// cssdk_const.inc has no ThrowDirection; cstrike_const.inc has the same
	// enum as CS_THROW_*, and ReGameDLL's player.h agrees.
	ThrowDirection: {
		pawn: 'CS_THROW_*',
		names: {
			none: 'CS_THROW_NONE',
			forward: 'CS_THROW_FORWARD',
			backward: 'CS_THROW_BACKWARD',
			hitVelocity: 'CS_THROW_HITVEL',
			bomb: 'CS_THROW_BOMB',
			grenade: 'CS_THROW_GRENADE',
			hitVelocityMinusAir: 'CS_THROW_HITVEL_MINUS_AIRVEL',
		},
	},
	// BLOOD_COLOR_GREEN is BLOOD_COLOR_YELLOW under another name.
	BloodColor: { pawn: 'BLOOD_COLOR_*', names: { none: 'DONT_BLEED', red: 'BLOOD_COLOR_RED', yellow: 'BLOOD_COLOR_YELLOW' } },
	// Not in the includes: ReGameDLL's player.h, enum MusicState { SILENT, CALM, INTENSE }.
	MusicState: { pawn: 'MusicState', names: { silent: 0, calm: 1, intense: 2 } },
	// Not in the includes: ReGameDLL's gamerules.h, MAP_VIP_SAFETYZONE_UNINITIALIZED,
	// MAP_HAVE_VIP_SAFETYZONE_YES and MAP_HAVE_VIP_SAFETYZONE_NO.
	VipSafetyZone: { pawn: 'MAP_HAVE_VIP_SAFETYZONE_*', names: { notChecked: 0, yes: 1, no: 2 } },
};

// Which enum each field holds, by its reapi name; player.observerMode
// (var_iuser1) is added by hand below.
const ENUM_FIELDS: Record<string, string> = {
	var_rendermode: 'RenderMode',
	var_renderfx: 'RenderFx',
	var_movetype: 'MoveType',
	var_solid: 'Solid',
	var_takedamage: 'TakeDamage',
	var_deadflag: 'DeadFlag',
	var_waterlevel: 'WaterLevel',
	var_watertype: 'Contents',
	var_fixangle: 'FixAngle',
	m_LastHitGroup: 'HitGroup',
	m_iKevlar: 'ArmorType',
	m_iObserverLastMode: 'ObserverMode',
	m_iJoiningState: 'JoinState',
	m_iMenu: 'GameMenu',
	m_iModelName: 'PlayerModel',
	m_iIgnoreGlobalChat: 'IgnoredChat',
	m_iThrowDirection: 'ThrowDirection',
	m_bloodColor: 'BloodColor',
	m_musicState: 'MusicState',
	m_iRoundWinStatus: 'RoundWinner',
	m_bMapHasVIPSafetyZone: 'VipSafetyZone',
};

/** What a number no name stands for reads as. */
const UNKNOWN = 'unknown';

const constantValues = new Map<string, number>();
for (const m of readFileSync('./as/constants.ts', 'utf8').matchAll(/^export const (\w+): i32 = (-?\d+);/gm)) {
	constantValues.set(m[1], Number(m[2]));
}

/** kRenderFxPulseSlow -> pulseSlow, ACT_RANGE_ATTACK1 -> rangeAttack1, CONTENTS_CURRENT_UP -> currentUp. */
function enumMemberName(suffix: string) {
	if (!suffix.includes('_') && suffix !== suffix.toUpperCase()) return suffix[0].toLowerCase() + suffix.slice(1);
	return suffix.toLowerCase().split('_').filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
}

/** A type's members, in order, with the number each stands for. */
function enumMembers(type: string): { name: string; value: number }[] {
	const spec = ENUM_TYPES[type];
	const members: { name: string; value: number }[] = [];

	if (spec.prefix) {
		for (const [constant, value] of constantValues) {
			if (constant.startsWith(spec.prefix)) members.push({ name: enumMemberName(constant.slice(spec.prefix.length)), value });
		}
	}
	for (const [name, source] of Object.entries(spec.names ?? {})) {
		const value = typeof source === 'number' ? source : constantValues.get(source);
		if (value === undefined) throw new Error(`${type}.${name}: ${source} is not in as/constants.ts`);
		members.push({ name, value });
	}

	if (members.length === 0) throw new Error(`${type}: no members`);
	const seen = new Map<number, string>();
	for (const m of members) {
		if (m.name === UNKNOWN) throw new Error(`${type}: "${UNKNOWN}" is what an unnamed number reads as`);
		if (seen.has(m.value)) throw new Error(`${type}: ${m.name} and ${seen.get(m.value)} are both ${m.value}`);
		seen.set(m.value, m.name);
	}
	return members;
}

const lowerFirst = (text: string) => text[0].toLowerCase() + text.slice(1);

// A qboolean that holds more than two values: m_bMapHasVIPSafetyZone is 0
// until the map is looked at, then 1 or 2 - a VipSafetyZone.
const NUMBER_FIELDS = new Set(['m_bMapHasVIPSafetyZone']);

// An int member that holds a player's index, read as the player: the
// terrorist who got the bomb is `game.c4Guy`, not a number to look up.
const INDEX_FIELDS: Record<string, 'Player'> = {
	m_iC4Guy: 'Player',
};

const ENGINE = includePath('reapi_engine_const');
const GAMEDLL = includePath('reapi_gamedll_const');

const used = new Set<string>();
const skipped: Skipped[] = [];
const collisions: string[] = [];

// A player's own copy of an entvar, under the entvar's name: PlayerFields
// overrides Entity's field with it. The game writes both together - the
// zoom is m_iFOV and pev->fov at once - and so does the setter.
const PLAYER_OWN: Record<string, string> = {
	m_iFOV: 'var_fov',
};

function collect(path: string, enumName: string, taken = used, handWritten = HAND_WRITTEN) {
	const fields: Field[] = [];

	for (const { reapi, comment } of blocksOf(path, enumName)) {
		const memberType = line(comment, 'Member type');
		// The game rules' fields have no index: get_member_game(member).
		const get = line(comment, 'Get params').replace(/get_member_game\(member/, 'get_member_game(index, member');
		const set = line(comment, 'Set params');
		const shape = shapeOf(get, memberType);
		if (HIDDEN.has(reapi)) continue;

		if (!shape) {
			skipped.push({ reapi, why: `shape not read: ${get || 'no Get params'} (${memberType})` });
			continue;
		}

		const name = nameOf(reapi);
		if (handWritten.has(name)) {
			collisions.push(`${reapi} -> ${name}: written by hand`);
			continue;
		}
		if (taken.has(name) && !PLAYER_OWN[reapi]) {
			collisions.push(`${reapi} -> ${name}: taken by an earlier field`);
			continue;
		}
		taken.add(name);

		fields.push({ reapi, name, shape: NUMBER_FIELDS.has(reapi) ? 'int' : shape, settable: set.length > 0, memberType, owner: enumName === 'EntVars' ? 'entvars' : enumName.replace(/_Members$/, ''), points: pointsAt(memberType) ?? INDEX_FIELDS[reapi], enumType: ENUM_FIELDS[reapi] });
	}

	return fields;
}

const entvars = collect(ENGINE, 'EntVars');
// Player's members, from the base class up: CBaseEntity, CBaseAnimating,
// CBaseMonster, CBasePlayer. An entvar keeps a name a member also wants.
const members = [
	...collect(GAMEDLL, 'CBaseEntity_Members'),
	...collect(GAMEDLL, 'CBaseAnimating_Members'),
	...collect(GAMEDLL, 'CBaseMonster_Members'),
	...collect(GAMEDLL, 'CBasePlayer_Members'),
];

// A weapon's members, CBasePlayerItem and CBasePlayerWeapon. Weapon extends
// Entity, not PlayerFields, so its names only have to stay clear of the
// entvars; m_iId is written by hand below as `kind`.
const weaponUsed = new Set(entvars.map(f => f.name));
const WEAPON_HAND_WRITTEN = new Set(['id', 'kind', 'kindId']);
const weaponMembers = [
	...collect(GAMEDLL, 'CBasePlayerItem_Members', weaponUsed, WEAPON_HAND_WRITTEN),
	...collect(GAMEDLL, 'CBasePlayerWeapon_Members', weaponUsed, WEAPON_HAND_WRITTEN),
].filter(f => f.reapi !== 'm_iId');

// The game rules (CSGameRules): fields of `game`, the facade's Game, which has
// a few members of its own. The array members (m_iMapVotes, m_pVIPQueue)
// have an element and are skipped, as a player's are.
const GAME_HAND_WRITTEN = new Set(['time', 'endRound', 'addEventListener', 'removeEventListener']);
const gameRules = collect(GAMEDLL, 'CSGameRules_Members', new Set<string>(), GAME_HAND_WRITTEN);

// WEAPON_KNIFE = 29 and the rest, read from the generated constants: the id
// m_iId holds, as the name a plugin writes - `weapon.kind == "knife"`.
const weaponKinds: { name: string; id: number }[] = [];
for (const [name, id] of constantValues) {
	if (/^WEAPON_[A-Z0-9]+$/.test(name) && id >= 0) weaponKinds.push({ name: name.slice('WEAPON_'.length).toLowerCase(), id });
}

// A bit-mask field is an array of names: `player.hideHud = ["Money", "Timer"]`.
// The enums and the list come from scripts/generate-flags.ts (as/flags.ts).
// `keep`: the setter leaves the bits the family does not name as they are -
// var_weapons' top bit is the suit, without which the HUD is gone, and it is
// no weapon a plugin would list.
const FLAG_FIELDS: Record<string, { type: string; family: string; keep?: boolean }> = {
	var_flags: { type: 'EntityFlag', family: 'ENTITY_FLAG' },
	var_effects: { type: 'Effect', family: 'EFFECT' },
	var_button: { type: 'Button', family: 'BUTTON' },
	var_oldbuttons: { type: 'Button', family: 'BUTTON' },
	m_afButtonLast: { type: 'Button', family: 'BUTTON' },
	m_afButtonPressed: { type: 'Button', family: 'BUTTON' },
	m_afButtonReleased: { type: 'Button', family: 'BUTTON' },
	m_iHideHUD: { type: 'HideHud', family: 'HIDE_HUD' },
	m_iClientHideHUD: { type: 'HideHud', family: 'HIDE_HUD' },
	m_bitsDamageType: { type: 'Damage', family: 'DAMAGE' },
	m_afPhysicsFlags: { type: 'PhysicsFlag', family: 'PHYSICS_FLAG' },
	m_Weapon_iWeaponState: { type: 'WeaponState', family: 'WEAPON_STATE' },
	// 1 << WEAPON_KNIFE and the rest: the family is made below, from the kinds.
	var_weapons: { type: 'WeaponKind', family: 'WEAPON_BITS', keep: true },
};

// The language of the tooltips: AMXTS_DOCS_LANG in .env, English by default.
const DOCS_LANG = docsLang();

/** A text's paragraphs, each on one line: an entry indented under its key reads the same as one on it. */
const paragraphs = (text: string) => dedent(text).split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);

/**
 * The tooltip: scripts/docs/entities.ts in the plugin author's words, then a
 * last line with the engine's name for whoever ports a Pawn plugin -
 * "Pawn: `pev->rendermode`" (code-style rule 30). An entry may
 * end with its own "Pawn: `kRender*`", the constants its numbers are; that
 * goes after the name. A field without an entry keeps reapi's name and
 * member type.
 */
function docOf(f: Field) {
	const ours = ENTITY_FIELDS[f.docKey ?? f.reapi];
	if (!ours) return `${f.reapi} - ${f.memberType || f.shape}${f.settable ? '' : ', read only'}`;

	const words = paragraphs(pick(ours, DOCS_LANG));
	const own = words.at(-1)?.startsWith('Pawn:') ? words.pop()!.slice('Pawn:'.length).trim() : '';
	// A pointer is read as its object and has no setter (see accessor).
	if (!f.settable || f.points) words[words.length - 1] += DOCS_LANG === 'ru' ? ' Только чтение.' : ' Read only.';

	// reapi calls CBasePlayerWeapon::m_iClip m_Weapon_iClip; both are named.
	let engine = `\`pev->${f.reapi.slice(4)}\``;
	if (f.owner !== 'entvars') {
		const member = f.reapi.replace(/^m_Weapon_/, 'm_');
		engine = member === f.reapi ? `\`${f.owner}::${member}\`` : `\`${f.owner}::${member}\` (reapi \`${f.reapi}\`)`;
	}
	return [...words, `Pawn: ${engine}${own ? `, ${own}` : ''}`].join('\n\n');
}

/** The tooltip of a member written by hand below, from ENTITY_METHODS. */
function methodDoc(key: string) {
	const words = ENTITY_METHODS[key];
	if (!words) throw new Error(`${key} has no entry in ENTITY_METHODS (scripts/docs/entities.ts)`);
	return renderDoc(paragraphs(pick(words, DOCS_LANG)).join('\n\n'), '\t');
}

// ---------------------------------------------------------------- actions
//
// A Ham Sandwich function that is an action - a weapon's deploy, an entity's
// takeDamage - as a method of the class it runs on (scripts/ham-functions.ts):
// ExecuteHamB, which runs every plugin's listeners on it, or ExecuteHam with
// `{ hooks: false }`.

const ACTION_TYPES: Record<HamKind, string> = {
	entity: 'Entity',
	player: 'Player',
	weapon: 'Weapon',
	int: 'number',
	float: 'number',
	bool: 'boolean',
	vector: 'number[]',
	string: 'string',
	damage: 'Damage[]',
	use: 'UseType',
};

/** How an argument goes into ExecuteHam's `...` tail: by address, a float as its bits, a vector as three. */
function actionArgument(param: HamParam) {
	const { name, kind } = param;
	if (kind === 'float') return `.ref(floatCell(${name}))`;
	if (kind === 'string') return `.str(${name})`;
	if (kind === 'vector') return `.vec(${name}[0], ${name}[1], ${name}[2])`;
	if (kind === 'entity' || kind === 'player' || kind === 'weapon') return `.ref(${name}.id)`;
	if (kind === 'bool') return `.ref(${name} ? 1 : 0)`;
	if (kind === 'damage') return `.ref(DAMAGE.maskOf(${name}))`;
	if (kind === 'use') return `.ref(max(USE_TYPES.indexOf(${name}), 0))`;
	return `.ref(${name})`;
}

/**
 * The methods of one class: Entity's, PlayerFields', Weapon's. A method may
 * not take a field's name: `takeDamage` is the entity's field - how it takes
 * damage - so Ham_TakeDamage is its event alone.
 */
function actions(target: HamFunction['target'], owner: string, fields: Field[]) {
	const methods = HAM_FUNCTIONS.filter(f => f.method && f.target === target);
	const clash = methods.find(f => fields.some(field => field.name === f.event));
	if (clash) throw new Error(`${clash.ham}: ${owner} has a field named ${clash.event} - leave the method out`);
	return methods.map((f) => {
		const params = [...f.params.map(param => `${param.name}: ${ACTION_TYPES[param.kind]}`), 'options: ActionOptions = {}'].join(', ');
		const call = `hamCall(${f.ham}, this.id, options)${f.params.map(actionArgument).join('')}.run()`;
		const body = f.answer === 'bool' ? `return ${call} != 0;` : f.answer === 'int' ? `return ${call};` : `${call};`;
		const type = f.answer === 'bool' ? 'bool' : f.answer === 'int' ? 'number' : 'void';
		return [`\t${methodDoc(`${owner}.${f.event}`)}`, `\t${f.event}(${params}): ${type} {`, `\t\t${body}`, `\t}`].join('\n');
	}).join('\n\n');
}

// The two team scores, each written with the other as it is: both are set
// and sent to the scoreboard at once (setTeamScores).
const TEAM_SCORES: Record<string, string> = {
	m_iNumCTWins: 'value, this.terroristWins',
	m_iNumTerroristWins: 'this.ctWins, value',
};

// A player's member the client learns only from a message - his money, his
// armour's kind, his flashlight's charge, his night vision, his defuse kit:
// written, then sent to him as the game sends it when it changes the member
// itself (setMoney and the rest, below). The member alone would show on his
// HUD only once the game next sends it.
const SENT_MEMBERS: Record<string, string> = {
	m_iAccount: 'setMoney',
	m_iKevlar: 'setKevlar',
	m_iFlashBattery: 'setFlashlightBattery',
	m_bHasNightVision: 'setNightVision',
	m_bNightVisionOn: 'setNightVisionOn',
	m_bHasDefuser: 'setDefuser',
};

// Every entvar's place in entvars_t, which the module reads it at.
const ENTVARS = entvarLayout();

/** An entvar's offset in entvars_t. */
function offsetOf(reapi: string) {
	const entvar = ENTVARS.get(reapi);
	if (!entvar) throw new Error(`${reapi} is not in entvars_t`);
	return entvar.offset;
}

// The members the module reads, by their place in this list: their class
// and name in AMX Mod X's gamedata, which the module looks the offset up by.
const memberTable: (GamedataMember & { reapi: string })[] = [];

/** A member's place in the member table, added the first time it is used. */
function memberAt(reapi: string, owner: string) {
	const member = gamedataMember(reapi, owner);
	if (!member) throw new Error(`${owner}::${reapi} is not in AMX Mod X's gamedata - it is reapi's alone`);
	const at = memberTable.findIndex(each => each.className === member.className && each.name === member.name);
	if (at >= 0) return at;
	memberTable.push({ ...member, reapi });
	return memberTable.length - 1;
}

/** How a field's cell is read and written: the expression, and the statement for a cell. */
interface Access {
	read: string;
	write: (cell: string) => string;
}

function accessOf(f: Field, kind: 'entvar' | 'member' | 'game'): Access {
	if (kind === 'entvar') {
		const offset = offsetOf(f.reapi);
		// An edict_t * entvar - owner, enemy, aiment - is the entity's index.
		if (ENTVARS.get(f.reapi)!.kind === 'entity') return { read: `entvarEntity(this.id, ${offset})`, write: cell => `setEntvarEntity(this.id, ${offset}, ${cell})` };
		return { read: `entvarCell(this.id, ${offset})`, write: cell => `setEntvarCell(this.id, ${offset}, ${cell})` };
	}
	if (kind === 'member') {
		const at = memberAt(f.reapi, f.owner);
		const sent = SENT_MEMBERS[f.reapi];
		return { read: `memberCell(this.id, ${at})`, write: cell => (sent ? `${sent}(this.id, ${cell})` : `setMemberCell(this.id, ${at}, ${cell})`) };
	}
	// A member of ReGameDLL's own is reapi's alone, and says so without it.
	if (REAPI_ONLY_MEMBERS.has(f.reapi)) {
		const [read, write] = hldsAccess(f);
		return { read: `reapiGameCell(${f.reapi}, "${f.name}"${read})`, write: cell => `setReapiGameCell(${f.reapi}, "${f.name}", ${cell}${write})` };
	}
	const at = memberAt(f.reapi, f.owner);
	return { read: `gameCell(${at}, ${f.reapi})`, write: cell => `setGameCell(${at}, ${f.reapi}, ${cell})` };
}

/**
 * The extra arguments of a ReGameDLL member plain HLDS reads another way
 * (scripts/hlds-events.ts): as/hlds.ts's `<name>Hlds` and `set<Name>Hlds`.
 */
function hldsAccess(f: Field): [string, string] {
	return Object.hasOwn(HEARD_FIELDS, f.name) ? [`, ${f.name}Hlds`, `, ${hldsSetter(f.name)}`] : ['', ''];
}

const hldsSetter = (name: string) => `set${name.charAt(0).toUpperCase()}${name.slice(1)}Hlds`;

function accessor(f: Field, kind: 'entvar' | 'member' | 'game') {
	// The field's own cell: a property knows what its field holds and where,
	// and converts the cell itself.
	const { read, write } = accessOf(f, kind);
	const lines: string[] = [`\t${renderDoc(docOf(f), '\t')}`];

	// A pointer member is its object: `player.activeItem.kind`, not an index to
	// look up. The module answers with the entity's index, 0 for none. Read
	// only: writing one takes an index and nothing here needs it yet.
	if (f.points) {
		lines.push(`\tget ${f.name}(): ${f.points} | null {`, `\t\tconst index = ${read};`, `\t\treturn index > 0 ? new ${f.points}(index) : null;`, `\t}`);
		return lines.join('\n');
	}

	switch (f.shape) {
		case 'float':
			// pev->takedamage keeps its DAMAGE_* number as a float: 2.0 is "aim",
			// and 0.5 is no name at all.
			if (f.enumType) {
				const fn = lowerFirst(f.enumType);
				lines.push(`\tget ${f.name}(): ${f.enumType} { return ${fn}Name(wholeCell(cellFloat(${read}))); }`);
				if (f.settable) lines.push(`\tset ${f.name}(value: ${f.enumType}) {`, `\t\tconst cell = ${fn}Cell(value);`, `\t\tif (cell != UNNAMED) ${write('<i32>floatCell(<f64>cell)')};`, `\t}`);
				break;
			}
			lines.push(`\tget ${f.name}(): number { return cellFloat(${read}); }`);
			if (f.settable) lines.push(`\tset ${f.name}(value: number) { ${write('<i32>floatCell(value)')}; }`);
			break;
		case 'int':
			if (FLAG_FIELDS[f.reapi]) {
				const flag = FLAG_FIELDS[f.reapi];
				const store = kind === 'entvar' ? `EntvarFlags(this.id, ${offsetOf(f.reapi)})` : `MemberFlags(this.id, ${memberAt(f.reapi, f.owner)})`;
				lines.push(`	get ${f.name}(): ${flag.type}[] { return flagList<${flag.type}>(new ${store}, ${flag.family}); }`);
				const mask = flag.keep ? `(${read} & ~${flag.family}.all) | ${flag.family}.maskOf(values)` : `${flag.family}.maskOf(values)`;
				if (f.settable) lines.push(`	set ${f.name}(values: ${flag.type}[]) { ${write(mask)}; }`);
				break;
			}
			if (f.enumType) {
				const fn = lowerFirst(f.enumType);
				lines.push(`\tget ${f.name}(): ${f.enumType} { return ${fn}Name(${read}); }`);
				// A spectator mode is switched as the game switches it
				// (Observer_SetMode): the target, the last mode and the text on
				// his screen follow. "none" is no mode the game switches to - it
				// would take it for "inEye" - and is written as it is.
				if (f.name === 'observerMode') lines.push(`\tset ${f.name}(value: ${f.enumType}) {`, `\t\tconst cell = ${fn}Cell(value);`, `\t\tif (cell == 0) ${write('cell')};`, `\t\telse if (cell != UNNAMED) setObserverMode(this.id, cell);`, `\t}`);
				else if (f.settable) lines.push(`\tset ${f.name}(value: ${f.enumType}) {`, `\t\tconst cell = ${fn}Cell(value);`, `\t\tif (cell != UNNAMED) ${write('cell')};`, `\t}`);
				break;
			}
			lines.push(`\tget ${f.name}(): number { return ${read}; }`);
			if (f.settable && PLAYER_OWN[f.reapi]) {
				lines.push(`\tset ${f.name}(value: number) {`, `\t\t${write('<i32>value')};`, `\t\tsetEntvarCell(this.id, ${offsetOf(PLAYER_OWN[f.reapi])}, <i32>floatCell(value));`, `\t}`);
				break;
			}
			// A team's score is set as the game sets it, with UpdateTeamScores:
			// the scoreboard shows it at once, not when the next round starts.
			if (f.settable && TEAM_SCORES[f.reapi]) lines.push(`\tset ${f.name}(value: number) { setTeamScores(${TEAM_SCORES[f.reapi]}); }`);
			else if (f.settable) lines.push(`\tset ${f.name}(value: number) { ${write('<i32>value')}; }`);
			break;
		case 'bool':
			lines.push(`\tget ${f.name}(): boolean { return ${read} != 0; }`);
			if (f.settable) lines.push(`\tset ${f.name}(value: boolean) { ${write('value ? 1 : 0')}; }`);
			break;
		case 'vector': {
			// Read as a Vector, written as any three numbers: a literal
			// `[0.0, 0.0, 0.0]` is a number[], and a Vector is one too.
			const place = kind === 'entvar' ? `this.id, ${offsetOf(f.reapi)}` : `this.id, ${memberAt(f.reapi, f.owner)}`;
			const what = kind === 'entvar' ? 'Entvar' : 'Member';
			lines.push(`\tget ${f.name}(): Vector { return ${lowerFirst(what)}Vector(${place}); }`);
			// Moving an entity is the engine's SET_ORIGIN, not a field write:
			// only it relinks the entity, and until then absmin/absmax - what
			// collisions and find_ent_in_sphere look at - stay where it was.
			if (f.settable && f.reapi === 'var_origin') lines.push(`\tset ${f.name}(value: number[]) { entity_set_origin(this.id, value); }`);
			else if (f.settable) lines.push(`\tset ${f.name}(value: number[]) { set${what}Vector(${place}, value); }`);
			break;
		}
		case 'string':
			// A string entvar is read through the engine module, EV_SZ_<name>
			// being the same field: the text is in the engine's string table.
			if (kind === 'entvar') {
				lines.push(`\tget ${f.name}(): string { return entity_get_string(this.id, EV_SZ_${f.reapi.slice(4)}); }`);
				// A model is the engine's SET_MODEL, not the text alone: it also
				// sets modelindex, without which nothing is drawn, and the size.
				if (f.settable && f.reapi === 'var_model') lines.push(`\tset ${f.name}(value: string) { entity_set_model(this.id, value); }`);
				else if (f.settable) lines.push(`\tset ${f.name}(value: string) { entity_set_string(this.id, EV_SZ_${f.reapi.slice(4)}, value); }`);
				break;
			}
			if (kind === 'game') {
				if (!REAPI_ONLY_MEMBERS.has(f.reapi)) throw new Error(`${f.reapi}: a text member of the game rules in the gamedata - read it in memory`);
				const [read, write] = hldsAccess(f);
				lines.push(`\tget ${f.name}(): string { return reapiGameText(${f.reapi}, "${f.name}"${read}); }`);
				if (f.settable) lines.push(`\tset ${f.name}(value: string) { setReapiGameText(${f.reapi}, "${f.name}", value${write}); }`);
				break;
			}
			lines.push(`\tget ${f.name}(): string { return memberText(this.id, ${memberAt(f.reapi, f.owner)}); }`);
			if (f.settable) lines.push(`\tset ${f.name}(value: string) { setMemberText(this.id, ${memberAt(f.reapi, f.owner)}, value); }`);
			break;
	}

	return lines.join('\n');
}

// A player's spectator mode lives in var_iuser1 - a free field on any other
// entity - so Entity keeps it as the number and a player also reads it by name.
if (used.has('observerMode')) throw new Error('observerMode is taken by a generated field');
const observerMode: Field = { reapi: 'var_iuser1', name: 'observerMode', shape: 'int', settable: true, memberType: 'int', owner: 'entvars', enumType: 'ObserverMode', docKey: 'observerMode' };

/** Every field the classes get. */
const generatedFields = [...entvars, ...members, ...weaponMembers, ...gameRules, observerMode];

/** The enums the fields use, in the order of ENUM_TYPES. */
const enumTypesUsed = Object.keys(ENUM_TYPES).filter(type => generatedFields.some(f => f.enumType === type));
const unusedTypes = Object.keys(ENUM_TYPES).filter(type => !enumTypesUsed.includes(type));
if (unusedTypes.length > 0) throw new Error(`ENUM_TYPES no field uses: ${unusedTypes.join(', ')}`);

/** The union, number -> name and name -> number of one enum. */
function enumBlock(type: string) {
	const members = enumMembers(type);
	const fn = lowerFirst(type);
	const fallback = ENUM_TYPES[type].existing;
	if (fallback) {
		return [
			`/** A ${type} number as its name; one no name stands for reads as "${fallback}". */`,
			`function ${fn}Name(cell: i32): ${type} {`,
			`\tswitch (cell) {`,
			...members.map(m => `\t\tcase ${m.value}: return "${m.name}";`),
			`\t}`,
			`\treturn "${fallback}";`,
			`}`,
			``,
			`/** A ${type} name as its number. */`,
			`function ${fn}Cell(name: ${type}): i32 {`,
			...members.map(m => `\tif (name == "${m.name}") return ${m.value};`),
			`\treturn UNNAMED;`,
			`}`,
		].join('\n');
	}
	const about = ENTITY_TYPES[type];
	if (!about) throw new Error(`${type} has no entry in ENTITY_TYPES (scripts/docs/entities.ts)`);
	const unknown = DOCS_LANG === 'ru'
		? `"${UNKNOWN}" — число, которому нет имени (его записал Pawn-плагин или мод); запись "${UNKNOWN}" поле не меняет.`
		: `"${UNKNOWN}" - a number no name stands for (a Pawn plugin or a mod wrote it); writing "${UNKNOWN}" leaves the field as it is.`;
	return [
		renderDoc([...paragraphs(pick(about, DOCS_LANG)), unknown, `Pawn: \`${ENUM_TYPES[type].pawn}\``].join('\n\n'), ''),
		`export type ${type} =`,
		`${[...members.map(m => m.name), UNKNOWN].map(name => `\t| "${name}"`).join('\n')};`,
		``,
		`/** A ${type} number as its name; one no name stands for reads as "${UNKNOWN}". */`,
		`function ${fn}Name(cell: i32): ${type} {`,
		`\tswitch (cell) {`,
		...members.map(m => `\t\tcase ${m.value}: return "${m.name}";`),
		`\t}`,
		`\treturn "${UNKNOWN}";`,
		`}`,
		``,
		`/** A ${type} name as its number; "${UNKNOWN}" is UNNAMED, and the field keeps what it has. */`,
		`function ${fn}Cell(name: ${type}): i32 {`,
		...members.map(m => `\tif (name == "${m.name}") return ${m.value};`),
		`\treturn UNNAMED;`,
		`}`,
	].join('\n');
}

// var_weapons as WeaponKind[]: bit n is the weapon whose m_iId is n. Id 0 is
// no weapon, and WEAPON_SHIELDGUN (99) is past the mask's 32 bits.
const weaponBits = weaponKinds.filter(k => k.id >= 1 && k.id <= 30);

// The flag families FLAG_FIELDS names, imported from as/flags.ts.
const flagImports = [...new Set(Object.values(FLAG_FIELDS).filter(f => f.family !== 'WEAPON_BITS').flatMap(f => [f.type, f.family]))];

// The members the hand-written code below reads, by their place in the member table.
const AT = {
	items: memberAt('m_rgpPlayerItems', 'CBasePlayer'),
	next: memberAt('m_pNext', 'CBasePlayerItem'),
	kind: memberAt('m_iId', 'CBasePlayerItem'),
	ctWins: memberAt('m_iNumCTWins', 'CSGameRules'),
	terroristWins: memberAt('m_iNumTerroristWins', 'CSGameRules'),
	observerTarget: memberAt('m_hObserverTarget', 'CBasePlayer'),
	observerLastMode: memberAt('m_iObserverLastMode', 'CBasePlayer'),
	money: memberAt('m_iAccount', 'CBasePlayer'),
	kevlar: memberAt('m_iKevlar', 'CBasePlayer'),
	flashlightBattery: memberAt('m_iFlashBattery', 'CBasePlayer'),
	nightVision: memberAt('m_bHasNightVision', 'CBasePlayer'),
	nightVisionOn: memberAt('m_bNightVisionOn', 'CBasePlayer'),
	defuser: memberAt('m_bHasDefuser', 'CBasePlayer'),
};

// The classes' properties, written before the file: the member table the
// file opens with is complete only once every property has its place in it.
const entityBody = entvars.map(f => accessor(f, 'entvar')).join('\n\n');
const playerBody = members.map(f => accessor(f, 'member')).join('\n\n');
const observerBody = accessor(observerMode, 'entvar');
const gameBody = gameRules.map(f => accessor(f, 'game')).join('\n\n');
const weaponBody = weaponMembers.map(f => accessor(f, 'member')).join('\n\n');

const stringKeys = entvars.filter(f => f.shape === 'string').map(f => `EV_SZ_${f.reapi.slice(4)}`);

const out = `// GENERATED by scripts/generate-entities.ts — do not edit
// Source: includes/reapi_engine_const.inc, includes/reapi_gamedll_const.inc
//
// Every entvar and every member of a player, as a property with the type
// reapi documents for it: \`entity.gravity = 0.5\`, \`entity.origin\`,
// \`player.hideHud\`. Under the hood the module reads and writes each one
// where the game keeps it, on any server; reapi's include says its type.
import { ActionOptions, Call, Player, RoundWinner, SoundChannel, SoundOptions, UseType, WeaponName, cellFloat, floatCell, __hasReapi, __sayOnce } from "./facade";
import { Vector } from "./vector";
import { ${Object.keys(HEARD_FIELDS).flatMap(name => [`${name}Hlds`, hldsSetter(name)]).join(', ')} } from "./hlds";
import {
	EntvarFlags, MemberFlags, FlagFamily, flagList,
	${chunk(flagImports).join(',\n\t')}
} from "./flags";
import {
	entity_get_string, entity_set_string,
	entity_get_int, entity_set_int, entity_get_edict, create_entity, is_valid_ent,
	find_ent_by_class, find_ent_in_sphere, get_global_int, entity_set_origin, emit_sound,
	entity_set_model, entity_set_size, is_user_connected, is_user_alive, get_maxplayers, get_user_msgid,
	emessage_begin, ewrite_string, ewrite_short, ewrite_byte, ewrite_long, emessage_end, client_print,
	get_member_game, set_member_game, rg_update_teamscores, rg_set_observer_mode,
	NATIVE_get_member_game, NATIVE_set_member_game, NATIVE_ExecuteHam, NATIVE_ExecuteHamB
} from "./natives";
import {
	${chunk([...new Set(gameRules.map(f => f.reapi).concat(stringKeys, ['EV_SZ_classname', 'EV_SZ_model', 'EV_INT_flags', 'EV_ENT_owner', 'FL_KILLME', 'GL_maxEntities', 'MSG_ALL', 'MSG_ONE', 'ARMOR_VESTHELM', 'print_center'], HAM_FUNCTIONS.filter(f => f.method).map(f => f.ham)))]).join(',\n\t')}
} from "./constants";

/** A name's number when it has none ("unknown"): the setter then leaves the field alone. */
const UNNAMED = i32.MIN_VALUE;

// A use's type, USE_OFF to USE_TOGGLE in their numbers' order.
const USE_TYPES: UseType[] = ["off", "on", "set", "toggle"];

/** An action's call: every plugin's listeners run on it, unless \`{ hooks: false }\`. */
function hamCall(fn: i32, id: number, options: ActionOptions): Call {
	return new Call((options.hooks ?? true) ? NATIVE_ExecuteHamB : NATIVE_ExecuteHam).num(fn).num(id);
}

// ---------------------------------------------------------------- fields
//
// The module reads and writes every field where the game keeps it
// (runtime/src/fields.h), on any server: an entvar at its offset in
// entvars_t, a member by its class and name in AMX Mod X's gamedata (the
// table below), looked up the first time it is used.

// @ts-ignore: decorator
@external("env", "ent_get")         declare function _entGet(id: i32, offset: i32): i32;
// @ts-ignore: decorator
@external("env", "ent_set")         declare function _entSet(id: i32, offset: i32, cell: i32): void;
// @ts-ignore: decorator
@external("env", "ent_entity")      declare function _entEntity(id: i32, offset: i32): i32;
// @ts-ignore: decorator
@external("env", "ent_set_entity")  declare function _entSetEntity(id: i32, offset: i32, index: i32): void;
// @ts-ignore: decorator
@external("env", "member_slot")     declare function _memberSlot(className: string, name: string): i32;
// @ts-ignore: decorator
@external("env", "member_get")      declare function _memberGet(id: i32, slot: i32, element: i32): i32;
// @ts-ignore: decorator
@external("env", "member_set")      declare function _memberSet(id: i32, slot: i32, element: i32, cell: i32): void;
// @ts-ignore: decorator
@external("env", "member_text")     declare function _memberText(id: i32, slot: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "member_set_text") declare function _memberSetText(id: i32, slot: i32, text: string): void;
// @ts-ignore: decorator
@external("env", "game_rules")      declare function _gameRules(): i32;

/** The id the module reads the game rules' members by. */
const RULES: i32 = -1;

/**
 * Each member's class and name in the gamedata, by its place: two strings a
 * member, reapi's name after it - which the test server reads, to know the
 * field a slot is.
 */
const MEMBERS: StaticArray<string> = [
${memberTable.map(m => `\t"${m.className}", "${m.name}", // ${m.reapi}`).join('\n')}
];

// Each entvar's offset, by reapi's name: a property carries its own; the
// test server reads these to know the field an offset is.
${[...ENTVARS].map(([name, entvar]) => `// ${name} ${entvar.offset}${entvar.kind === 'vector' ? ' vector' : ''}`).join('\n')}

/** The module's slot of each member, plus one: 0 until the member is first used. */
const memberSlots = new StaticArray<i32>(${memberTable.length});

/** The module's slot of the member at \`at\` in MEMBERS. */
function slotOf(at: i32): i32 {
	let slot = unchecked(memberSlots[at]);
	if (slot == 0) {
		slot = _memberSlot(unchecked(MEMBERS[at * 2]), unchecked(MEMBERS[at * 2 + 1])) + 1;
		unchecked(memberSlots[at] = slot);
	}
	return slot - 1;
}

/** An entvar's cell: a whole number, or a Float's bits. */
function entvarCell(id: number, offset: i32): i32 {
	return _entGet(<i32>id, offset);
}

/** Writes an entvar's cell: a whole number, or a Float's bits. */
function setEntvarCell(id: number, offset: i32, cell: i32): void {
	_entSet(<i32>id, offset, cell);
}

/** An entvar that points at an entity, as the entity's index; 0 for none. */
function entvarEntity(id: number, offset: i32): i32 {
	return _entEntity(<i32>id, offset);
}

/** Points an entvar at the entity with this index; 0 for none. */
function setEntvarEntity(id: number, offset: i32, index: i32): void {
	_entSetEntity(<i32>id, offset, index);
}

function entvarVector(id: number, offset: i32): Vector {
	return new Vector(cellFloat(_entGet(<i32>id, offset)), cellFloat(_entGet(<i32>id, offset + 4)), cellFloat(_entGet(<i32>id, offset + 8)));
}

function setEntvarVector(id: number, offset: i32, value: number[]): void {
	for (let i = 0; i < 3; i++) _entSet(<i32>id, offset + i * 4, <i32>floatCell(value[i]));
}

/** A member's cell: a whole number, a Float's bits, an entity's index; an array member's element. */
function memberCell(id: number, at: i32, element: i32 = 0): i32 {
	return _memberGet(<i32>id, slotOf(at), element);
}

function setMemberCell(id: number, at: i32, cell: i32, element: i32 = 0): void {
	_memberSet(<i32>id, slotOf(at), element, cell);
}

// A vector member's elements are its three components.
function memberVector(id: number, at: i32): Vector {
	const slot = slotOf(at);
	return new Vector(cellFloat(_memberGet(<i32>id, slot, 0)), cellFloat(_memberGet(<i32>id, slot, 1)), cellFloat(_memberGet(<i32>id, slot, 2)));
}

function setMemberVector(id: number, at: i32, value: number[]): void {
	const slot = slotOf(at);
	for (let i = 0; i < 3; i++) _memberSet(<i32>id, slot, i, <i32>floatCell(value[i]));
}

/** The longest text a member holds, with room: m_autoBuyString is 256 bytes. */
const MEMBER_TEXT: i32 = 512;
const memberTextBuffer = new StaticArray<u8>(MEMBER_TEXT);

function memberText(id: number, at: i32): string {
	const length = _memberText(<i32>id, slotOf(at), changetype<usize>(memberTextBuffer), MEMBER_TEXT);
	return String.UTF8.decodeUnsafe(changetype<usize>(memberTextBuffer), length);
}

function setMemberText(id: number, at: i32, value: string): void {
	_memberSetText(<i32>id, slotOf(at), value);
}

/**
 * How the game rules are read, chosen the first time: 1 in memory, 0
 * through reapi; -1 not chosen yet. AMX Mod X's gamedata lays them out as
 * the original game does, and ReGameDLL's add a member to their base class -
 * every offset after it is off - so a server with reapi, which runs
 * ReGameDLL, reads them through reapi.
 */
let rulesInMemory: i32 = -1;

function rulesHere(): bool {
	if (rulesInMemory < 0) {
		rulesInMemory = __hasReapi() ? 0 : 1;
		if (!__hasReapi() && _gameRules() == 0) __sayOnce("the game rules are not in AMX Mod X's gamedata for this server: game's fields read 0");
	}
	return rulesInMemory == 1;
}

/** A game rules member's cell: \`at\` in MEMBERS, or reapi's \`field\`. */
function gameCell(at: i32, field: i32): i32 {
	return rulesHere() ? _memberGet(RULES, slotOf(at), 0) : <i32>new Call(NATIVE_get_member_game).num(field).run();
}

function setGameCell(at: i32, field: i32, cell: i32): void {
	if (rulesHere()) _memberSet(RULES, slotOf(at), 0, cell);
	else new Call(NATIVE_set_member_game).num(field).ref(cell).run();
}

// A game rules member of ReGameDLL's own, which reapi alone reaches. On a
// server without it, a member plain HLDS has another way to - a cvar, a count
// AMX Mod X keeps - is read and written through \`hlds\` (as/hlds.ts); any
// other reads 0 and says so once.
function reapiGameCell(field: i32, name: string, hlds: (() => i32) | null = null): i32 {
	if (!__hasReapi()) {
		if (hlds) return hlds();
		__sayOnce(\`game.\${name} is ReGameDLL's, read through ReAPI, which this server does not have: it reads 0 and writes nothing\`);
		return 0;
	}
	return <i32>new Call(NATIVE_get_member_game).num(field).run();
}

function setReapiGameCell(field: i32, name: string, cell: i32, hlds: ((cell: i32) => void) | null = null): void {
	if (__hasReapi()) new Call(NATIVE_set_member_game).num(field).ref(cell).run();
	else if (hlds) hlds(cell);
	else reapiGameCell(field, name);
}

function reapiGameText(field: i32, name: string, hlds: (() => string) | null = null): string {
	if (!__hasReapi()) {
		if (hlds) return hlds();
		__sayOnce(\`game.\${name} is ReGameDLL's, read through ReAPI, which this server does not have: it reads "" and writes nothing\`);
		return "";
	}
	return get_member_game<string>(field);
}

function setReapiGameText(field: i32, name: string, value: string, hlds: ((value: string) => void) | null = null): void {
	if (__hasReapi()) set_member_game<string>(field, value);
	else if (hlds) hlds(value);
	else reapiGameText(field, name);
}

/**
 * Both teams' scores, sent to the scoreboard at once: reapi's
 * rg_update_teamscores, or, without it, the members and the TeamScore
 * message the game's UpdateTeamScores sends - sent so that other plugins'
 * message listeners hear it, as they would the game's.
 */
function setTeamScores(ct: number, terrorists: number): void {
	if (__hasReapi()) {
		rg_update_teamscores(ct, terrorists, false);
		return;
	}
	setGameCell(${AT.ctWins}, m_iNumCTWins, <i32>ct);
	setGameCell(${AT.terroristWins}, m_iNumTerroristWins, <i32>terrorists);
	sendTeamScore("CT", ct);
	sendTeamScore("TERRORIST", terrorists);
}

function sendTeamScore(team: string, score: number): void {
	emessage_begin(MSG_ALL, get_user_msgid("TeamScore"));
	ewrite_string(team);
	ewrite_short(score);
	emessage_end();
}

/**
 * Begins a message to one player, through the engine as the game's own go,
 * so every plugin's message listeners hear it: false, and nothing begun, for
 * a player who is not in the game.
 */
function messageTo(id: number, name: string): bool {
	if (is_user_connected(id) == 0) return false;
	emessage_begin(MSG_ONE, get_user_msgid(name), [0, 0, 0], id);
	return true;
}

/** The player's money, and the Money message that shows it on his HUD, flashing - what cs_set_user_money sends. */
function setMoney(id: number, cell: i32): void {
	setMemberCell(id, ${AT.money}, cell);
	if (!messageTo(id, "Money")) return;
	ewrite_long(cell);
	ewrite_byte(1);
	emessage_end();
}

/** The player's armour kind, and ArmorType: whether his HUD shows a helmet. */
function setKevlar(id: number, cell: i32): void {
	setMemberCell(id, ${AT.kevlar}, cell);
	if (!messageTo(id, "ArmorType")) return;
	ewrite_byte(cell == ARMOR_VESTHELM ? 1 : 0);
	emessage_end();
}

/** The flashlight's charge, and FlashBat: the bar on his HUD. */
function setFlashlightBattery(id: number, cell: i32): void {
	setMemberCell(id, ${AT.flashlightBattery}, cell);
	if (!messageTo(id, "FlashBat")) return;
	ewrite_byte(cell);
	emessage_end();
}

/** Whether he owns night vision goggles, told to his buy menu (ItemStatus). */
function setNightVision(id: number, cell: i32): void {
	setMemberCell(id, ${AT.nightVision}, cell);
	sendItemStatus(id);
}

/** Night vision switched on or off, and NVGToggle: his screen turns green or back. */
function setNightVisionOn(id: number, cell: i32): void {
	setMemberCell(id, ${AT.nightVisionOn}, cell);
	if (!messageTo(id, "NVGToggle")) return;
	ewrite_byte(cell);
	emessage_end();
}

/**
 * A defuse kit given or taken as the game does it: the kit on his model
 * (pev->body), its icon on his HUD (StatusIcon) and his buy menu told.
 */
function setDefuser(id: number, cell: i32): void {
	setMemberCell(id, ${AT.defuser}, cell);
	setEntvarCell(id, ${offsetOf('var_body')}, cell);
	if (messageTo(id, "StatusIcon")) {
		ewrite_byte(cell);
		ewrite_string("defuser");
		if (cell != 0) {
			ewrite_byte(0);
			ewrite_byte(160);
			ewrite_byte(0);
		}
		emessage_end();
	}
	sendItemStatus(id);
}

/** ItemStatus: the night vision and the defuse kit the player owns, which his buy menu shows. */
function sendItemStatus(id: number): void {
	if (!messageTo(id, "ItemStatus")) return;
	ewrite_byte((memberCell(id, ${AT.nightVision}) != 0 ? 1 : 0) | (memberCell(id, ${AT.defuser}) != 0 ? 2 : 0));
	emessage_end();
}

/**
 * Switches a spectator's mode as the game's Observer_SetMode does: reapi's
 * rg_set_observer_mode, or, without it, the same steps here - the target
 * kept while it is another living player, the next one found otherwise,
 * "roaming" when there is none, the mode asked for kept as the last one,
 * and the mode's name on his screen.
 */
function setObserverMode(id: number, mode: i32): void {
	if (__hasReapi()) {
		rg_set_observer_mode(id, mode);
		return;
	}
	if (entvarCell(id, ${offsetOf('var_iuser1')}) == mode) return;

	let target = memberCell(id, ${AT.observerTarget});
	if (!watchable(id, target)) target = nextWatchable(id);
	const roaming = ${constantValues.get('OBS_ROAMING')};
	const shown = mode != roaming && target == 0 ? roaming : mode;

	setMemberCell(id, ${AT.observerTarget}, shown == roaming ? 0 : target);
	setEntvarCell(id, ${offsetOf('var_iuser1')}, shown);
	setEntvarCell(id, ${offsetOf('var_iuser2')}, shown == roaming ? 0 : target);
	setEntvarCell(id, ${offsetOf('var_iuser3')}, 0);
	setMemberCell(id, ${AT.observerLastMode}, mode);
	if (shown != mode) client_print(id, print_center, "#Spec_NoTarget");
	client_print(id, print_center, \`#Spec_Mode\${shown}\`);
}

/** Whether \`target\` is a player \`id\` can watch: another one, in the game and alive. */
function watchable(id: number, target: i32): bool {
	return target > 0 && target != <i32>id && is_user_connected(target) != 0 && is_user_alive(target) != 0;
}

function nextWatchable(id: number): i32 {
	const last = get_maxplayers();
	for (let target = 1; target <= last; target++) {
		if (watchable(id, target)) return target;
	}
	return 0;
}

export { entvarCell as __entvarCell, setEntvarCell as __setEntvarCell, memberCell as __memberCell, setMemberCell as __setMemberCell };

/** A float field's value as a whole number, or UNNAMED when it has a fraction. */
function wholeCell(value: f64): i32 {
	const cell = <i32>value;
	return <f64>cell == value ? cell : UNNAMED;
}

/** SoundChannel's names at their CHAN_* numbers. */
const SOUND_CHANNELS: SoundChannel[] = ["auto", "weapon", "voice", "item", "body", "stream", "static"];

${enumTypesUsed.map(enumBlock).join('\n\n')}

/** The WeaponKind names and the bit each has in var_weapons: 1 << its id. */
const WEAPON_BITS = new FlagFamily(
	[${weaponBits.map(k => `"${k.name}"`).join(', ')}],
	[${weaponBits.map(k => `1 << ${k.id}`).join(', ')}]
);

/**
 * Which entities \`Entity.findAll\` returns. Every field is optional, and an
 * entity has to match all that are given:
 * \`Entity.findAll({ classname: "info_target", near: player.origin, radius: 200 })\`.
 */
export interface EntityFilter {
	classname?: string;
	/** The model, as the entity has it: "models/w_c4.mdl". */
	model?: string;
	/** Whose it is: a grenade's thrower, a weapon's carrier - \`{ owner: player }\`. */
	owner?: Entity;
	/** Only those whose origin is within \`radius\` units of here. */
	near?: number[];
	radius?: number;
}

/** Any entity: its entvars, typed. */
export class Entity {
	constructor(public id: number) {}

	/** A new entity of this class, or null if the engine could not make one. */
	static create(classname: string): Entity | null {
		const id = create_entity(classname);
		return id > 0 ? new Entity(id) : null;
	}

	/** Every entity that matches the filter; with no filter, every entity there is. */
	static findAll(filter: EntityFilter = {}): Entity[] {
		const found: Entity[] = [];
		const near = filter.near ?? [];
		const classname = filter.classname ?? "";

		// Each engine walker starts after the entity it is given; 0 is the
		// world, which nobody means.
		if (near.length == 3) {
			const radius = filter.radius ?? 0;
			for (let id = find_ent_in_sphere(0, near, radius); id > 0; id = find_ent_in_sphere(id, near, radius)) {
				if (Entity.matches(id, filter)) found.push(new Entity(id));
			}
		} else if (classname.length > 0) {
			for (let id = find_ent_by_class(0, classname); id > 0; id = find_ent_by_class(id, classname)) {
				if (Entity.matches(id, filter)) found.push(new Entity(id));
			}
		} else {
			const last = get_global_int(GL_maxEntities);
			for (let id = 1; id < last; id++) {
				if (is_valid_ent(id) != 0 && Entity.matches(id, filter)) found.push(new Entity(id));
			}
		}

		return found;
	}

	/** The first entity that matches, or null. */
	static find(filter: EntityFilter = {}): Entity | null {
		const all = Entity.findAll(filter);
		return all.length > 0 ? all[0] : null;
	}

	private static matches(id: number, filter: EntityFilter): bool {
		const classname = filter.classname ?? "";
		const model = filter.model ?? "";
		const owner = filter.owner;
		if (classname.length > 0 && entity_get_string(id, EV_SZ_classname) != classname) return false;
		if (model.length > 0 && entity_get_string(id, EV_SZ_model) != model) return false;
		if (owner && entity_get_edict(id, EV_ENT_owner) != owner.id) return false;
		return true;
	}

	/**
	 * Removes the entity at the end of this frame (FL_KILLME), not at once.
	 * remove_entity frees the edict on the spot, and one freed from inside its
	 * own touch or think, or while the engine is walking the entity list, is
	 * still used by the engine after it is gone. FL_KILLME is how the game's
	 * own entities ask to go: the engine frees them after the frame's physics,
	 * where nothing is holding them.
	 */
	remove(): void {
		entity_set_int(this.id, EV_INT_flags, entity_get_int(this.id, EV_INT_flags) | FL_KILLME);
	}

	// is_valid_ent rather than reapi's is_entity: it answers false for 0 and
	// for a number past the last entity instead of logging an error.
	${methodDoc('Entity.exists')}
	get exists(): bool { return is_valid_ent(this.id) != 0; }

	${methodDoc('Entity.setSize')}
	setSize(mins: number[], maxs: number[]): void {
		// The engine takes a box turned inside out for a fatal error.
		for (let i = 0; i < 3; i++) {
			if (mins[i] > maxs[i]) {
				console.error(\`setSize: mins [\${mins.join(", ")}] above maxs [\${maxs.join(", ")}]\`);
				return;
			}
		}
		entity_set_size(this.id, mins, maxs);
	}

	${methodDoc('Entity.emitSound')}
	emitSound(sample: string, options: SoundOptions = {}): void {
		const channel = max(SOUND_CHANNELS.indexOf(options.channel ?? "auto"), 0);
		emit_sound(this.id, channel, sample, options.volume ?? 1.0, options.attenuation ?? 0.8, 0, options.pitch ?? 100.0);
	}

${entityBody}

${actions('entity', 'Entity', entvars)}
}

/** A player's members - CBaseEntity up to CBasePlayer - on top of its entvars. */
export class PlayerFields extends Entity {
${playerBody}

${observerBody}

${actions('player', 'Player', [...entvars, ...members])}

	/**
	 * Every weapon the player carries: the first item of each of the six
	 * slots (m_rgpPlayerItems), and the ones chained behind it (m_pNext) -
	 * the grenades all share slot four.
	 */
	get items(): Weapon[] {
		const list: Weapon[] = [];
		for (let slot = 0; slot < 6; slot++) {
			let item = memberCell(this.id, ${AT.items}, slot);
			while (item > 0) {
				list.push(new Weapon(item));
				item = memberCell(item, ${AT.next});
			}
		}
		return list;
	}
}

/**
 * The game rules' members, the fields of \`game\`: \`game.freezePeriod\`,
 * \`game.ctWins\`. The facade's Game extends this.
 */
export class GameFields {
${gameBody}
}

/** What a weapon is, by the name CS gives it without the WEAPON_ prefix. */
export type WeaponKind =
${weaponKinds.map(k => `\t| "${k.name}"`).join('\n')};

/** m_iId as a name; an id this does not know reads as "none". */
export function weaponKindOf(id: number): WeaponKind {
	switch (id) {
${weaponKinds.map(k => `\t\tcase ${k.id}: return "${k.name}";`).join('\n')}
	}
	return "none";
}

/** A weapon: its entvars, and the members of CBasePlayerItem and CBasePlayerWeapon. */
export class Weapon extends Entity {
	/** m_iId - which weapon this is: \`weapon.kind == "knife"\`. */
	get kind(): WeaponKind { return weaponKindOf(memberCell(this.id, ${AT.kind})); }

	/** m_iId as the number WEAPON_* constants hold. */
	get kindId(): number { return memberCell(this.id, ${AT.kind}); }

	// Entity's classname, typed as the name the player's weapon methods take.
	${methodDoc('Weapon.classname')}
	get classname(): WeaponName { return entity_get_string(this.id, EV_SZ_classname) as WeaponName; }
	set classname(value: WeaponName) { entity_set_string(this.id, EV_SZ_classname, value); }

${weaponBody}

${actions('weapon', 'Weapon', [...entvars, ...weaponMembers])}
}
`;

function chunk(names: string[]) {
	const rows: string[] = [];
	for (let i = 0; i < names.length; i += 6) rows.push(names.slice(i, i + 6).join(', '));
	return rows;
}

writeFileSync('./as/entities.ts', out);

console.log(`Entity: ${entvars.length} entvars; PlayerFields: ${members.length} members; Weapon: ${weaponMembers.length} members, ${weaponKinds.length} kinds; GameFields: ${gameRules.length} members`);
console.log(`${skipped.length} skipped, ${collisions.length} collisions`);

const undescribed = generatedFields.filter(f => !ENTITY_FIELDS[f.docKey ?? f.reapi]);
const stray = Object.keys(ENTITY_FIELDS).filter(key => !generatedFields.some(f => (f.docKey ?? f.reapi) === key));
const strayTypes = Object.keys(ENTITY_TYPES).filter(type => !enumTypesUsed.includes(type));
if (strayTypes.length > 0) console.log(`  scripts/docs/entities.ts ENTITY_TYPES names types that are not generated: ${strayTypes.join(', ')}`);
console.log(`${generatedFields.length - undescribed.length} of ${generatedFields.length} fields described in scripts/docs/entities.ts`);
if (stray.length > 0) console.log(`  scripts/docs/entities.ts names fields that are not generated: ${stray.join(', ')}`);
if (process.argv.includes('--verbose')) {
	for (const f of undescribed) console.log(`  undescribed ${f.reapi}`);
}
if (process.argv.includes('--verbose')) {
	for (const s of skipped) console.log(`  skipped ${s.reapi}: ${s.why}`);
	for (const c of collisions) console.log(`  collision ${c}`);
}
