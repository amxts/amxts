// The Ham Sandwich functions a game event or an entity's method stands on,
// shared by scripts/generate-hooks.ts (the events) and
// scripts/generate-entities.ts (the methods).
//
// One row per function Counter-Strike configures (hamdata.ini's cstrike
// section): a function the game does not configure fails the plugin that
// hooks it. A row names the event the function is under - the game's action,
// never the backend - and the fields its arguments are, in ham_const.inc's
// order after `this`. Where reapi has a hookchain for the same function the
// row names that event (`reapi`): it is one event, and the hood picks reapi
// for the chain's own class and Ham Sandwich for any other.
//
// Left out, with the reason: Ham_Keyvalue (a key-value handle), Ham_Touch
// (the touch event is the engine module's, filtered by both classes),
// Ham_MyMonsterPointer, Ham_MySquadMonsterPointer and Ham_Item_GetWeaponPtr
// (C++ pointers), Ham_Item_GetItemInfo (an item-info handle).

/** What an argument is read as. */
export type HamKind = 'entity' | 'player' | 'weapon' | 'int' | 'float' | 'bool' | 'vector' | 'string' | 'damage' | 'use';

/** What the function returns: the event's answer, a method's result. */
export type HamAnswer = 'none' | 'int' | 'bool' | 'float' | 'entity' | 'string' | 'vector';

export interface HamParam {
	name: string;
	kind: HamKind;
}

export interface HamFunction {
	/** The Ham_* constant. */
	ham: string;
	/** The event's name: the game's action. */
	event: string;
	/** What `this` is: the event's first field. */
	target: 'entity' | 'player' | 'weapon';
	/** The arguments after `this`. */
	params: HamParam[];
	answer: HamAnswer;
	/** The reapi hookchain's event of the same function, when there is one. */
	reapi?: string;
	/** A method on the target's class, for what is an action rather than a question. */
	method?: boolean;
}

const p = (name: string, kind: HamKind): HamParam => ({ name, kind });
const row = (ham: string, event: string, target: HamFunction['target'], params: HamParam[], answer: HamAnswer, extra: Partial<HamFunction> = {}): HamFunction => ({ ham, event, target, params, answer, ...extra });

export const HAM_FUNCTIONS: HamFunction[] = [
	// Any entity's.
	row('Ham_Spawn', 'spawn', 'entity', [], 'none', { reapi: 'spawn', method: true }),
	row('Ham_Precache', 'precache', 'entity', [], 'none', { reapi: 'precache' }),
	row('Ham_ObjectCaps', 'objectCaps', 'entity', [], 'int', { reapi: 'objectCaps' }),
	row('Ham_Activate', 'activate', 'entity', [], 'none', { method: true }),
	row('Ham_SetObjectCollisionBox', 'setObjectCollisionBox', 'entity', [], 'none'),
	row('Ham_Classify', 'classify', 'entity', [], 'int', { reapi: 'classify' }),
	row('Ham_DeathNotice', 'childDeathNotice', 'entity', [p('child', 'entity')], 'none'),
	row('Ham_TraceAttack', 'traceAttack', 'entity', [p('attacker', 'entity'), p('damage', 'float'), p('direction', 'vector'), p('trace', 'int'), p('damageType', 'damage')], 'none', { reapi: 'traceAttack' }),
	row('Ham_TakeDamage', 'takeDamage', 'entity', [p('inflictor', 'entity'), p('attacker', 'entity'), p('damage', 'float'), p('damageType', 'damage')], 'int', { reapi: 'takeDamage' }),
	row('Ham_TakeHealth', 'takeHealth', 'entity', [p('health', 'float'), p('damageType', 'damage')], 'bool', { reapi: 'takeHealth', method: true }),
	row('Ham_Killed', 'killed', 'entity', [p('attacker', 'entity'), p('gib', 'int')], 'none', { reapi: 'killed', method: true }),
	row('Ham_BloodColor', 'bloodColor', 'entity', [], 'int'),
	row('Ham_TraceBleed', 'traceBleed', 'entity', [p('damage', 'float'), p('direction', 'vector'), p('trace', 'int'), p('damageType', 'damage')], 'none'),
	row('Ham_IsTriggered', 'isTriggered', 'entity', [p('activator', 'entity')], 'bool'),
	row('Ham_GetToggleState', 'toggleState', 'entity', [], 'int'),
	row('Ham_GetDelay', 'delay', 'entity', [], 'float'),
	row('Ham_IsMoving', 'isMoving', 'entity', [], 'bool'),
	row('Ham_OverrideReset', 'overrideReset', 'entity', [], 'none'),
	row('Ham_DamageDecal', 'damageDecal', 'entity', [p('damageType', 'damage')], 'int'),
	row('Ham_SetToggleState', 'setToggleState', 'entity', [p('state', 'int')], 'none'),
	row('Ham_StartSneaking', 'startSneaking', 'entity', [], 'none'),
	row('Ham_StopSneaking', 'stopSneaking', 'entity', [], 'none'),
	row('Ham_OnControls', 'onControls', 'entity', [p('on', 'entity')], 'bool'),
	row('Ham_IsSneaking', 'isSneaking', 'entity', [], 'bool'),
	row('Ham_IsAlive', 'isAlive', 'entity', [], 'bool'),
	row('Ham_IsBSPModel', 'isBspModel', 'entity', [], 'bool'),
	row('Ham_ReflectGauss', 'reflectGauss', 'entity', [], 'bool'),
	row('Ham_HasTarget', 'hasTarget', 'entity', [p('target', 'int')], 'bool'),
	row('Ham_IsInWorld', 'isInWorld', 'entity', [], 'bool'),
	row('Ham_IsPlayer', 'isPlayer', 'entity', [], 'bool'),
	row('Ham_IsNetClient', 'isNetClient', 'entity', [], 'bool'),
	row('Ham_TeamId', 'teamId', 'entity', [], 'string'),
	row('Ham_GetNextTarget', 'nextTarget', 'entity', [], 'entity'),
	row('Ham_Think', 'think', 'entity', [], 'none', { method: true }),
	row('Ham_Use', 'use', 'entity', [p('caller', 'entity'), p('activator', 'entity'), p('useType', 'use'), p('value', 'float')], 'none', { method: true }),
	row('Ham_Blocked', 'blocked', 'entity', [p('other', 'entity')], 'none', { method: true }),
	row('Ham_Respawn', 'respawn', 'entity', [], 'entity'),
	row('Ham_UpdateOwner', 'updateOwner', 'entity', [], 'none'),
	row('Ham_FBecomeProne', 'becomeProne', 'entity', [], 'bool'),
	row('Ham_Center', 'center', 'entity', [], 'vector'),
	row('Ham_EyePosition', 'eyePosition', 'entity', [], 'vector'),
	row('Ham_EarPosition', 'earPosition', 'entity', [], 'vector'),
	row('Ham_BodyTarget', 'bodyTarget', 'entity', [p('from', 'vector')], 'vector'),
	row('Ham_Illumination', 'illumination', 'entity', [], 'int'),
	row('Ham_FVisible', 'visible', 'entity', [p('other', 'entity')], 'bool'),
	row('Ham_FVecVisible', 'pointVisible', 'entity', [p('point', 'vector')], 'bool'),
	row('Ham_CS_Restart', 'restart', 'entity', [], 'none', { method: true }),

	// A monster's - in Counter-Strike, a hostage's.
	row('Ham_ChangeYaw', 'changeYaw', 'entity', [p('speed', 'int')], 'int'),
	row('Ham_HasHumanGibs', 'hasHumanGibs', 'entity', [], 'bool'),
	row('Ham_HasAlienGibs', 'hasAlienGibs', 'entity', [], 'bool'),
	row('Ham_FadeMonster', 'fadeMonster', 'entity', [], 'none'),
	row('Ham_GibMonster', 'gibMonster', 'entity', [], 'none'),
	row('Ham_GetDeathActivity', 'deathActivity', 'entity', [], 'int'),
	row('Ham_BecomeDead', 'becomeDead', 'entity', [], 'none'),
	row('Ham_IRelationship', 'relationship', 'entity', [p('other', 'entity')], 'int'),
	row('Ham_PainSound', 'painSound', 'entity', [], 'none'),
	row('Ham_ReportAIState', 'reportAiState', 'entity', [], 'none'),
	row('Ham_MonsterInitDead', 'monsterInitDead', 'entity', [], 'none'),
	row('Ham_Look', 'look', 'entity', [p('distance', 'int')], 'none'),
	row('Ham_BestVisibleEnemy', 'bestVisibleEnemy', 'entity', [], 'entity'),
	row('Ham_FInViewCone', 'inViewCone', 'entity', [p('other', 'entity')], 'bool'),
	row('Ham_FVecInViewCone', 'pointInViewCone', 'entity', [p('point', 'vector')], 'bool'),

	// A player's.
	row('Ham_AddPoints', 'addPoints', 'player', [p('points', 'int'), p('allowNegative', 'bool')], 'none', { reapi: 'addPoints', method: true }),
	row('Ham_AddPointsToTeam', 'addPointsToTeam', 'player', [p('points', 'int'), p('allowNegative', 'bool')], 'none', { reapi: 'addPointsToTeam', method: true }),
	row('Ham_AddPlayerItem', 'addPlayerItem', 'player', [p('item', 'weapon')], 'bool', { reapi: 'addPlayerItem', method: true }),
	row('Ham_RemovePlayerItem', 'removePlayerItem', 'player', [p('item', 'weapon')], 'bool', { reapi: 'removePlayerItem', method: true }),
	row('Ham_GiveAmmo', 'giveAmmo', 'player', [p('amount', 'int'), p('name', 'string'), p('max', 'int')], 'int', { reapi: 'giveAmmo', method: true }),
	row('Ham_Player_Jump', 'jump', 'player', [], 'none', { reapi: 'jump', method: true }),
	row('Ham_Player_Duck', 'duck', 'player', [], 'none', { reapi: 'duck', method: true }),
	row('Ham_Player_PreThink', 'preThink', 'player', [], 'none', { reapi: 'preThink' }),
	row('Ham_Player_PostThink', 'postThink', 'player', [], 'none', { reapi: 'postThink' }),
	row('Ham_Player_GetGunPosition', 'gunPosition', 'player', [], 'vector'),
	row('Ham_Player_ShouldFadeOnDeath', 'shouldFadeOnDeath', 'player', [], 'bool'),
	row('Ham_Player_ImpulseCommands', 'impulseCommands', 'player', [], 'none', { reapi: 'impulseCommands' }),
	row('Ham_Player_UpdateClientData', 'updateClientData', 'player', [], 'none', { reapi: 'updateClientData' }),
	row('Ham_CS_RoundRespawn', 'roundRespawn', 'player', [], 'none', { reapi: 'roundRespawn' }),
	row('Ham_CS_Player_ResetMaxSpeed', 'resetMaxSpeed', 'player', [], 'none', { reapi: 'resetMaxSpeed' }),
	row('Ham_CS_Player_IsBot', 'isBot', 'player', [], 'bool'),
	row('Ham_CS_Player_GetAutoaimVector', 'autoaimVector', 'player', [p('delta', 'float')], 'vector'),
	row('Ham_CS_Player_Blind', 'blind', 'player', [p('untilTime', 'float'), p('holdTime', 'float'), p('fadeTime', 'float'), p('alpha', 'int')], 'none', { reapi: 'blind' }),
	row('Ham_CS_Player_OnTouchingWeapon', 'touchingWeapon', 'player', [p('weapon', 'weapon')], 'none'),

	// A weapon's, or an item's.
	row('Ham_Item_AddToPlayer', 'addToPlayer', 'weapon', [p('player', 'player')], 'bool', { method: true }),
	row('Ham_Item_AddDuplicate', 'addDuplicate', 'weapon', [p('original', 'weapon')], 'bool'),
	row('Ham_Item_CanDeploy', 'canDeploy', 'weapon', [], 'bool', { reapi: 'canDeploy' }),
	row('Ham_Item_Deploy', 'deploy', 'weapon', [], 'bool', { method: true }),
	row('Ham_Item_CanHolster', 'canHolster', 'weapon', [], 'bool'),
	row('Ham_Item_Holster', 'holster', 'weapon', [], 'none', { method: true }),
	row('Ham_Item_UpdateItemInfo', 'updateItemInfo', 'weapon', [], 'none'),
	row('Ham_Item_PreFrame', 'itemPreFrame', 'weapon', [], 'none'),
	row('Ham_Item_PostFrame', 'itemPostFrame', 'weapon', [], 'none', { reapi: 'itemPostFrame' }),
	row('Ham_Item_Drop', 'drop', 'weapon', [], 'none', { method: true }),
	row('Ham_Item_Kill', 'kill', 'weapon', [], 'none'),
	row('Ham_Item_AttachToPlayer', 'attachToPlayer', 'weapon', [p('player', 'player')], 'none', { method: true }),
	row('Ham_Item_PrimaryAmmoIndex', 'primaryAmmoIndex', 'weapon', [], 'int'),
	row('Ham_Item_SecondaryAmmoIndex', 'secondaryAmmoIndex', 'weapon', [], 'int'),
	row('Ham_Item_UpdateClientData', 'itemUpdateClientData', 'weapon', [p('player', 'player')], 'int'),
	row('Ham_Item_ItemSlot', 'itemSlot', 'weapon', [], 'int'),
	row('Ham_Weapon_ExtractAmmo', 'extractAmmo', 'weapon', [p('target', 'weapon')], 'int', { method: true }),
	row('Ham_Weapon_ExtractClipAmmo', 'extractClipAmmo', 'weapon', [p('target', 'weapon')], 'int', { method: true }),
	row('Ham_Weapon_AddWeapon', 'addWeapon', 'weapon', [], 'bool'),
	row('Ham_Weapon_PlayEmptySound', 'playEmptySound', 'weapon', [], 'bool'),
	row('Ham_Weapon_ResetEmptySound', 'resetEmptySound', 'weapon', [], 'none', { method: true }),
	row('Ham_Weapon_IsUsable', 'isUsable', 'weapon', [], 'bool'),
	row('Ham_Weapon_PrimaryAttack', 'primaryAttack', 'weapon', [], 'none', { method: true }),
	row('Ham_Weapon_SecondaryAttack', 'secondaryAttack', 'weapon', [], 'none', { method: true }),
	row('Ham_Weapon_Reload', 'reload', 'weapon', [], 'none', { method: true }),
	row('Ham_Weapon_WeaponIdle', 'weaponIdle', 'weapon', [], 'none', { method: true }),
	row('Ham_Weapon_RetireWeapon', 'retireWeapon', 'weapon', [], 'none', { method: true }),
	row('Ham_Weapon_ShouldWeaponIdle', 'shouldWeaponIdle', 'weapon', [], 'bool'),
	row('Ham_Weapon_UseDecrement', 'useDecrement', 'weapon', [], 'bool'),
	row('Ham_CS_Item_CanDrop', 'canDrop', 'weapon', [], 'bool'),
	row('Ham_CS_Item_GetMaxSpeed', 'maxSpeed', 'weapon', [], 'float'),
	row('Ham_CS_Item_IsWeapon', 'isWeapon', 'weapon', [], 'bool'),
	row('Ham_CS_Weapon_SendWeaponAnim', 'sendWeaponAnim', 'weapon', [p('anim', 'int'), p('skipLocal', 'bool')], 'none', { reapi: 'sendWeaponAnim', method: true }),
];
