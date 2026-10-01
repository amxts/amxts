// A reapi member's class and name in AMX Mod X's gamedata - what the module
// looks a member's offset up by (member_slot in runtime/src/fields.h), the
// data fakemeta's get_ent_data reads on any server.
//
// reapi names most members as the game does, under the class that declares
// them. The exceptions are here: a weapon's members carry reapi's `m_Weapon_`
// prefix, two of the game rules' are CGameRules', not CHalfLifeMultiplay's,
// a few are spelled as ReGameDLL renamed them, and some are not in the
// gamedata at all - ReGameDLL's own, and the voice manager's, which the
// gamedata keeps as one object - and stay reapi's.
//
// Shared by scripts/generate-entities.ts and the fake server's tables.

export interface GamedataMember {
	className: string;
	name: string;
}

/** CGameRules' own members; the rest of the game rules are CHalfLifeMultiplay's. */
const GAME_RULES_BASE = new Set(['m_bFreezePeriod', 'm_bBombDropped']);

/** The original game's name of a member ReGameDLL renamed. */
const ORIGINAL_NAMES: Record<string, string> = {
	m_flRestartRoundTime: 'm_fTeamCount',
	m_fRoundStartTime: 'm_fRoundCount',
	m_fRoundStartTimeReal: 'm_fIntroRoundCount',
	m_bMapHasVIPSafetyZone: 'm_iMapHasVIPSafetyZone',
	m_bGameStarted: 'm_bFirstConnected',
};

/**
 * The game rules' members the gamedata does not have: ReGameDLL's own, and
 * the voice manager's (the gamedata has m_VoiceGameMgr whole). They are
 * reapi's alone.
 */
export const REAPI_ONLY_MEMBERS = new Set([
	'm_GameDesc',
	'm_msgPlayerVoiceMask',
	'm_msgRequestState',
	'm_nMaxPlayers',
	'm_UpdateInterval',
	'm_bSkipShowMenu',
	'm_bNeededPlayers',
	'm_flEscapeRatio',
	'm_flTimeLimit',
	'm_flGameStartTime',
	'm_bTeamBalanced',
]);

/**
 * Where the gamedata has `reapi`, a member of reapi's class `owner`
 * (CBasePlayer, CBasePlayerWeapon, CSGameRules ...); null for a member it
 * does not have.
 */
export function gamedataMember(reapi: string, owner: string): GamedataMember | null {
	if (REAPI_ONLY_MEMBERS.has(reapi)) return null;
	if (owner === 'CSGameRules') {
		return { className: GAME_RULES_BASE.has(reapi) ? 'CGameRules' : 'CHalfLifeMultiplay', name: ORIGINAL_NAMES[reapi] ?? reapi };
	}
	if (owner === 'CBasePlayerWeapon') return { className: owner, name: reapi.replace(/^m_Weapon_/, 'm_') };
	return { className: owner, name: reapi };
}
