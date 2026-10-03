// The names `amxts upgrade` brings up to date (scripts/upgrade.ts): the API's
// names that were the engine's words and are now the player's, and the ones
// left out of the API, which the natives still reach.

/** Game events by their old name; each event's class follows its name. */
export const EVENTS: Record<string, string> = {
	addAccount: 'addMoney',
	restartRound: 'newRound',
	onRoundFreezeEnd: 'roundStart',
	hasRestrictItem: 'itemRestricted',
	cleanUpMap: 'mapReset',
	flPlayerFallDamage: 'fallDamage',
	fPlayerCanTakeDamage: 'canTakeDamage',
	fPlayerCanRespawn: 'canRespawn',
	fShouldSwitchWeapon: 'shouldSwitchWeapon',
	buyWeaponByWeaponId: 'buyWeapon',
	buyGunAmmo: 'buyAmmo',
	giveNamedItem: 'giveItem',
	giveC4: 'giveBomb',
	makeBomber: 'becomeBomber',
	makeVip: 'becomeVip',
	goToIntermission: 'intermission',
	precacheGenericI: 'precacheFile',
	precacheModelI: 'precacheModel',
	precacheSoundI: 'precacheSound',
	entSelectSpawnPoint: 'selectSpawnPoint',
	getPlayerSpawnSpot: 'spawnSpot',
	executeServerStringCmd: 'serverCommand',
	clientPrintf: 'consoleMessage',
	sendSayMessage: 'chatMessage',
	hintMessageEx: 'hintMessage',
	dropClient: 'disconnectClient',
	setClientUserInfoName: 'changeName',
	setClientUserInfoModel: 'changeModel',
	clientUserInfoChanged: 'userInfoChange',
	addPoints: 'addFrags',
	addPointsToTeam: 'addTeamScore',
	takeHealth: 'heal',
	addPlayerItem: 'addItem',
	removePlayerItem: 'removeItem',
	canHavePlayerItem: 'canHaveItem',
	deadPlayerWeapons: 'dropWeaponsOnDeath',
	kickBack: 'recoil',
	isPenetrableEntity: 'canShootThrough',
	startObserver: 'startSpectating',
	observerFindNextPlayer: 'spectateNext',
	observerIsValidTarget: 'canSpectate',
	impulseCommands: 'impulse',
	onSpawnEquip: 'spawnEquip',
	onEvent: 'gameEvent',
	pmDuck: 'duckMovement',
	pmJump: 'jumpMovement',
	fireBullets3: 'shoot',
	fireBuckshots: 'shootBuckshot',
};

/** Game events out of the API, by the native that hooks them. */
export const HIDDEN_EVENTS: Record<string, string> = {
	alloc: 'RegisterHookChain(RH_ED_Alloc, ...)',
	free: 'RegisterHookChain(RH_ED_Free, ...)',
	directSet: 'RegisterHookChain(RH_Cvar_DirectSet, ...)',
	emitPings: 'RegisterHookChain(RH_SV_EmitPings, ...)',
	objectCaps: 'RegisterHookChain(RG_CBasePlayer_ObjectCaps, ...) or RegisterHam(Ham_ObjectCaps, ...)',
	getEntityInit: 'RegisterHookChain(RH_GetEntityInit, ...)',
	allowPhysent: 'RegisterHookChain(RH_SV_AllowPhysent, ...)',
	writeFullClientUpdate: 'RegisterHookChain(RH_SV_WriteFullClientUpdate, ...)',
	sendResources: 'RegisterHookChain(RH_SV_SendResources, ...)',
	reportAiState: 'RegisterHam(Ham_ReportAIState, ...)',
	useDecrement: 'RegisterHam(Ham_Weapon_UseDecrement, ...)',
	addDuplicate: 'RegisterHam(Ham_Item_AddDuplicate, ...)',
	overrideReset: 'RegisterHam(Ham_OverrideReset, ...)',
	onControls: 'RegisterHam(Ham_OnControls, ...)',
	updateOwner: 'RegisterHam(Ham_UpdateOwner, ...)',
};

/** What a value is, as far as the code says: the class whose names apply to it. */
export type Kind = 'Player' | 'Weapon' | 'Entity' | 'Game';

/** Every entity's fields and methods, a player's and a weapon's too. */
const ENTITY: Record<string, string> = {
	armorValue: 'armor',
	takeHealth: 'heal',
};

/** Fields and methods by their old name, for each kind of value. */
export const RENAMED: Record<Kind, Record<string, string>> = {
	Entity: ENTITY,
	Player: {
		...ENTITY,
		account: 'money',
		lastAccount: 'lastSentMoney',
		nextAccountHealthUpdate: 'nextScoreboardUpdate',
		clientHealth: 'healthSent',
		clientFov: 'fovSent',
		clientBattery: 'batterySent',
		clientHideHud: 'hideHudSent',
		clientActiveItem: 'activeItemSent',
		flashBattery: 'flashlightBattery',
		flashLightTime: 'flashlightTime',
		flgeigerDelay: 'geigerDelay',
		flgeigerRange: 'geigerRange',
		igeigerRangePrev: 'geigerRangePrev',
		idrowndmg: 'drownDamage',
		idrownrestored: 'drownRestored',
		currentammo: 'currentAmmo',
		gaitframe: 'gaitFrame',
		gaitsequence: 'playerGaitSequence',
		gaityaw: 'gaitYaw',
		prevgaitorigin: 'prevGaitOrigin',
		lastx: 'lastX',
		lasty: 'lastY',
		maxammoBuckshot: 'maxAmmoBuckshot',
		maxammo9mm: 'maxAmmo9mm',
		maxammo556nato: 'maxAmmo556nato',
		maxammo556natobox: 'maxAmmo556natobox',
		maxammo762nato: 'maxAmmo762nato',
		maxammo45acp: 'maxAmmo45acp',
		maxammo50ae: 'maxAmmo50ae',
		maxammo338mag: 'maxAmmo338mag',
		maxammo57mm: 'maxAmmo57mm',
		maxammo357sig: 'maxAmmo357sig',
		sbarString0: 'statusBarText',
		nextSBarUpdateTime: 'nextStatusBarUpdate',
		sndLast: 'lastSoundEntity',
		sndRange: 'soundRange',
		sndRoomtype: 'roomType',
		tbdPrev: 'timeBasedDamagePrev',
		punishedForTk: 'punishedForTeamKill',
		longJump: 'hasLongJump',
		velocityModifier: 'slowdown',
		sneaking: 'sneakingUntil',
		tank: 'mountedGun',
		train: 'trainControls',
		weapon: 'weaponHudValid',
		menu: 'openMenu',
		numSpawns: 'spawnCount',
		autoWepSwitch: 'autoSwitchWeapon',
		progressStart: 'progressBarStart',
		progressEnd: 'progressBarEnd',
		onTarget: 'aimingAtTarget',
		addPoints: 'addFrags',
		addPointsToTeam: 'addTeamScore',
		addPlayerItem: 'addItem',
		removePlayerItem: 'removeItem',
	},
	Weapon: {
		...ENTITY,
		inReload: 'isReloading',
		inSpecialReload: 'shotgunReloadStage',
		clientClip: 'clipSent',
		glock18Shoot: 'glockNextBurstShot',
		glock18ShotsFired: 'glockBurstShots',
		famasShoot: 'famasNextBurstShot',
		famasShotsFired: 'famasBurstShots',
		decreaseShotsFired: 'recoilResetTime',
		timeWeaponIdle: 'nextIdle',
		primaryAmmoType: 'ammoType',
	},
	Game: {
		accountCt: 'ctRoundBonus',
		accountTerrorist: 'terroristRoundBonus',
		c4Guy: 'bomber',
		c4Timer: 'bombTimer',
		numCt: 'ctCount',
		numTerrorist: 'terroristCount',
		numCtWins: 'ctWins',
		numTerroristWins: 'terroristWins',
		numSpawnableCt: 'spawnableCts',
		numSpawnableTerrorist: 'spawnableTerrorists',
		numConsecutiveCtLoses: 'ctLossStreak',
		numConsecutiveTerroristLoses: 'terroristLossStreak',
		restartRoundTime: 'newRoundTime',
		roundStartTimeReal: 'freezeStartTime',
		introRoundTime: 'freezeTime',
		freezePeriod: 'isFreezeTime',
		roundTerminating: 'roundEnding',
		tCantBuy: 'terroristsCantBuy',
		ctCantBuy: 'ctsCantBuy',
		unBalancedRounds: 'unbalancedRounds',
		levelInitialized: 'mapInitialized',
		endIntermissionButtonHit: 'intermissionSkipped',
		forceCameraValue: 'forceCamera',
		forceChaseCamValue: 'forceChaseCam',
		fadeToBlackValue: 'fadeToBlack',
		gameDesc: 'gameName',
	},
};

/** Every entity's field out of the API, by its member. */
const ENTITY_HIDDEN: Record<string, string> = { armorType: 'var_armortype' };

/** Fields out of the API, by the member a native reads them with, for each kind of value. */
export const HIDDEN: Record<Kind, Record<string, string>> = {
	Entity: ENTITY_HIDDEN,
	Player: {
		...ENTITY_HIDDEN,
		activity: 'm_Activity',
		idealActivity: 'm_IdealActivity',
		monsterState: 'm_MonsterState',
		idealMonsterState: 'm_IdealMonsterState',
		conditions: 'm_afConditions',
		memory: 'm_afMemory',
		enemyLkp: 'm_vecEnemyLKP',
		hackedGunPos: 'm_HackedGunPos',
		targetEnt: 'm_hTargetEnt',
		teamName: 'm_szTeamName',
	},
	Weapon: {
		...ENTITY_HIDDEN,
		fireFamas: 'm_Weapon_usFireFamas',
		fireGlock18: 'm_Weapon_usFireGlock18',
		lastFire: 'm_Weapon_flLastFire',
	},
	Game: {
		careerMatchMenuTime: 'm_fCareerMatchMenuTime',
		careerMatchWins: 'm_iCareerMatchWins',
		careerRoundMenuTime: 'm_fCareerRoundMenuTime',
		inCareerGame: 'm_bInCareerGame',
		roundWinDifference: 'm_iRoundWinDifference',
		msgPlayerVoiceMask: 'm_msgPlayerVoiceMask',
		msgRequestState: 'm_msgRequestState',
	},
};

/**
 * Old names common enough elsewhere - a menu's `menu`, a message's `weapon`,
 * a memory's `memory` - that a use on a value the code does not say is one of
 * ours is not listed.
 */
export const COMMON = new Set(['menu', 'weapon', 'memory', 'conditions', 'activity', 'train', 'tank', 'sneaking', 'onTarget', 'lastFire', 'teamName']);

/**
 * Server events by their old names - the Pawn forward's and the short one
 * before it - each by the name in the author's words
 * (scripts/generate-host.ts's EVENT_NAMES).
 */
export const SERVER_EVENTS: Record<string, string> = {
	plugin_init: 'init',
	plugin_precache: 'precache',
	cfg: 'pluginsLoaded',
	plugin_cfg: 'pluginsLoaded',
	plugin_end: 'end',
	plugin_pause: 'pause',
	plugin_unpause: 'unpause',
	plugin_log: 'log',
	plugin_modules: 'modules',
	changelevel: 'changeLevel',
	server_changelevel: 'changeLevel',
	server_frame: 'frame',
	OnConfigsExecuted: 'configsExecuted',
	OnAutoConfigsBuffered: 'configsQueued',
	client_connect: 'connect',
	connectex: 'connectAttempt',
	client_connectex: 'connectAttempt',
	client_authorized: 'authorized',
	putinserver: 'putInServer',
	client_putinserver: 'putInServer',
	disconnect: 'disconnected',
	client_disconnect: 'disconnected',
	client_disconnected: 'disconnected',
	client_remove: 'remove',
	client_command: 'command',
	kill: 'suicide',
	client_kill: 'suicide',
	client_impulse: 'impulse',
	client_cmdStart: 'cmdStart',
	inconsistent_file: 'inconsistentFile',
	CS_InternalCommand: 'internalCommand',
	pfnSpawn: 'entitySpawn',
	pfn_spawn: 'entitySpawn',
	pfnThink: 'entityThink',
	pfn_think: 'entityThink',
	pfnKeyvalue: 'keyValue',
	pfn_keyvalue: 'keyValue',
	pfnPlaybackevent: 'playbackEvent',
	pfn_playbackevent: 'playbackEvent',
	playerchange: 'playerChange',
};

/** Server events that are a game event: `game.addEventListener` by this name. */
export const SERVER_GAME_EVENTS: Record<string, string> = {
	PreThink: 'preThink',
	client_PreThink: 'preThink',
	PostThink: 'postThink',
	client_PostThink: 'postThink',
	pfnTouch: 'touch',
	pfn_touch: 'touch',
	infochanged: 'userInfoChange',
	client_infochanged: 'userInfoChange',
};

/** Server events whose game events ask it otherwise: listed, with what to write. */
export const SERVER_EVENTS_BY_HAND: Record<string, string> = {
	CS_OnBuy: 'a purchase is game.addEventListener("buyWeapon" | "buyItem" | "buyAmmo", ...), one per kind of thing bought, with what is bought by its name',
	CS_OnBuyAttempt: 'whether a purchase is allowed is game.addEventListener("itemRestricted", ...) where event.restriction == "buying": return true to forbid it',
};

/** Server events' classes by their old names, where the event is another's now. */
export const SERVER_EVENT_CLASSES: Record<string, string> = {
	Client_PreThinkEvent: 'PreThinkEvent',
	Client_PostThinkEvent: 'PostThinkEvent',
	PfnTouchEvent: 'TouchEvent',
	ClientInfochangedEvent: 'UserInfoChangeEvent',
	ClientDisconnectEvent: 'ClientDisconnectedEvent',
};

/** A server event's fields by their old names, for each event by its name. */
export const SERVER_EVENT_FIELDS: Record<string, Record<string, string>> = {
	internalCommand: { cmd: 'command' },
	inconsistentFile: { filename: 'file' },
	playbackEvent: { eventid: 'eventIndex' },
};

/** The server events whose fields are renamed, by the class an annotation names them with. */
export const SERVER_FIELD_CLASSES: Record<string, string> = {
	CS_InternalCommandEvent: 'internalCommand',
	InconsistentFileEvent: 'inconsistentFile',
	PfnPlaybackeventEvent: 'playbackEvent',
};

const TRACE = { tracehandle: 'trace' };
const SHOT = { src: 'start', dirShooting: 'direction' };

/** A game event's fields by their old names - reapi's parameters as they were - for each event (scripts/generate-hooks.ts's WORDS). */
export const GAME_EVENT_FIELDS: Record<string, Record<string, string>> = {
	addResource: { filename: 'file' },
	airAccelerate: { wishdir: 'direction', wishspeed: 'speed', accel: 'acceleration' },
	buyAmmo: { weapon_entity: 'weapon' },
	canShootThrough: { src: 'start' },
	changeModel: { infobuffer: 'info' },
	changeName: { infobuffer: 'info' },
	chatMessage: { cmd: 'command', teamonly: 'teamOnly' },
	checkUserInfo: { adr: 'address' },
	consoleMessage: { string: 'text' },
	createWeaponBox: { weaponent: 'weapon' },
	defaultDeploy: { anim: 'animation', animExt: 'animationExtension', skiplocal: 'skipLocal' },
	defaultReload: { anim: 'animation' },
	defaultShotgunReload: { anim: 'animation', startAnim: 'startAnimation' },
	disconnectClient: { fmt: 'reason' },
	explodeBomb: TRACE,
	explodeFlashbang: TRACE,
	explodeHeGrenade: TRACE,
	fireBullets: SHOT,
	playStepSound: { fvol: 'volume' },
	precacheFile: { string: 'file' },
	precacheModel: { string: 'file' },
	precacheSound: { string: 'file' },
	printf: { string: 'text' },
	radio: { msg_id: 'sound', msg_verbose: 'text' },
	recoil: {
		up_base: 'upBase',
		lateral_base: 'lateralBase',
		up_modifier: 'upModifier',
		lateral_modifier: 'lateralModifier',
		p_max: 'upMax',
		lateral_max: 'lateralMax',
		direction_change: 'directionChange',
	},
	sendWeaponAnim: { anim: 'animation', skiplocal: 'skipLocal' },
	serverCommand: { cmd: 'command' },
	setAnimation: { playerAnim: 'animation' },
	shoot: { ...SHOT, shared_rand: 'randomSeed' },
	shootBuckshot: SHOT,
	spectateNext: { arg2: 'reverse' },
	startSound: { sample: 'sound' },
	takeDamageImpulse: { velModifier: 'velocityModifier' },
	teamFull: { team_id: 'team' },
	teamStacked: { newTeam_id: 'newTeam', curTeam_id: 'currentTeam' },
	throwGrenade: { src: 'start', usEvent: 'eventIndex' },
	throwHeGrenade: { usEvent: 'eventIndex' },
	throwSmokeGrenade: { usEvent: 'eventIndex' },
	traceAttack: { dir: 'direction', ...TRACE },
	traceLine: { src: 'start', spot: 'end', ...TRACE },
	userInfoChange: { infobuffer: 'info' },
};

/** Flag names that are more than the old one in lowerCamelCase: KillRarity's `"ThruSmoke"` is `"throughSmoke"`. */
export const FLAG_NAMES: Record<string, string> = { ThruSmoke: 'throughSmoke' };
