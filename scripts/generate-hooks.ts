import type { Text } from './docs/events';
import type { HamAnswer, HamFunction, HamKind } from './ham-functions';
import type { HeardEvent } from './hlds-events';
// Generates as/hooks.ts: one event class per reapi hookchain, and the map
// game.addEventListener types a listener by.
//
// reapi documents every chain with the arguments it passes and what it
// returns:
//
//     * Return type:      int
//     * Params:           (const this, pevInflictor, pevAttacker, Float:flDamage, bitsDamageType)
//     RG_CBasePlayer_TakeDamage,
//
// That comment is the event's shape. A plugin writes
//
//     game.addEventListener("canPlayerHearPlayer", onHear);
//     function onHear(event: CanPlayerHearPlayerEvent) {
//         return event.listener.team == event.sender.team;
//     }
//
// and never meets arg(4), ATYPE_BOOL, SetHookChainReturn or HC_SUPERCEDE: an
// entity argument is a Player, a Weapon or an Entity, and what the handler
// returns is the chain's answer.
//
// The chain names are the ones as/constants.ts already gives `hook()` - read
// back from its hookIdOf, so the two can never disagree.
//
// Run: bun scripts/generate-hooks.ts (after generate-wasm-api and generate-flags)
import { readFileSync, writeFileSync } from 'node:fs';
import { docsLang, docText, pick, renderDoc } from './apply-docs';
import { GAME } from './docs/game';
import { HAM_FUNCTIONS } from './ham-functions';
import { HEARD } from './hlds-events';
import { GAME_ENUMS, memberName } from './include-enums';
import { includePath } from './includes';

const constants = readFileSync('./as/constants.ts', 'utf8');

// hook name -> chain id, and chain id -> constant, from the generated file.
const idOfName = new Map<string, number>();
const hookBlock = constants.slice(constants.indexOf('export function hookIdOf'));
for (const m of hookBlock.slice(0, hookBlock.indexOf('\n}')).matchAll(/case "(\w+)": return (\d+);/g)) {
	idOfName.set(m[1], Number(m[2]));
}
const constantOfId = new Map<number, string>();
for (const m of constants.matchAll(/^export const (R[GH]_\w+): i32 = (\d+);/gm)) {
	if (!constantOfId.has(Number(m[2]))) constantOfId.set(Number(m[2]), m[1]);
}

// The documentation comment above each chain.
const docs = new Map<string, string>();
for (const file of [includePath('reapi_gamedll_const'), includePath('reapi_engine_const')]) {
	const text = readFileSync(file, 'utf8');
	for (const m of text.matchAll(/\/\*((?:(?!\*\/)[\s\S])*?)\*\/\s*(R[GH]_\w+)/g)) docs.set(m[2], m[1]);
}

function line(comment: string, label: string) {
	const m = comment.match(new RegExp(`${label}:\\s*(.*)`));
	return m ? m[1].trim() : '';
}

type Kind = 'int' | 'float' | 'bool' | 'string' | 'damage' | 'vector' | 'enum' | 'flags' | 'use' | 'Player' | 'Weapon' | 'Entity';

interface Param {
	name: string;
	kind: Kind;
	index: number; // the argument's position, as arg() counts
	settable: boolean;
	pawn: string; // the argument as reapi writes it
	named?: Named; // an enum or a set of flags, read as names
}

// ------------------------------------------------------------ enums as names
//
// An argument tagged with a Pawn enum - `WinStatus:status`,
// `ScenarioEventEndRound:event` - is a closed set of values, and a plugin
// reads it as a union of string literals: `event.winner == "CT"`,
// `event.reason == "targetSaved"`, as game.endRound takes its winner. A
// bit-flag enum is an array of names, as a mask is everywhere else (rule 7).
// The members and their numbers come from the include text; only the names
// a mechanical rule cannot make are written here.

interface NamedSpec {
	/** The field's name on the event; the argument's own name when it says enough. */
	field?: string;
	/** The union's name - one the facade already has (Team), or a new one. */
	type: string;
	/** A type the facade declares; otherwise hooks.ts declares it. */
	existing?: boolean;
	/** Stripped from each member: ROUND_ of ROUND_CTS_WIN. */
	prefix: RegExp;
	/** Names the rule would get wrong, by member. */
	names?: Record<string, string>;
	/** Members that are not values: a count, a range marker. */
	skip?: RegExp;
	/** What a number the enum does not name reads as; "unknown" by default. */
	unknown?: string;
	/** A bit-flag enum: the field is an array of names. */
	flags?: boolean;
	about: string;
}

interface Named extends NamedSpec {
	tag: string;
	members: { name: string; value: number }[];
}

/** By the Pawn tag of the argument. Each tag is on one chain. */
const NAMED: Record<string, NamedSpec> = {
	WinStatus: {
		field: 'winner',
		type: 'RoundWinner',
		existing: true,
		prefix: /^WINSTATUS_/,
		unknown: 'none',
		names: { WINSTATUS_NONE: 'none', WINSTATUS_CTS: 'CT', WINSTATUS_TERRORISTS: 'TERRORIST', WINSTATUS_DRAW: 'draw' },
		about: 'The round\'s winner, as game.endRound takes it.',
	},
	ScenarioEventEndRound: {
		field: 'reason',
		type: 'RoundEndReason',
		prefix: /^ROUND_/,
		about: 'The reason a round ended, e.g. "targetBomb", "bombDefused", "ctsWin", "targetSaved".',
	},
	TeamName: {
		field: 'team',
		type: 'Team',
		existing: true,
		prefix: /^TEAM_/,
		unknown: 'UNASSIGNED',
		names: { TEAM_UNASSIGNED: 'UNASSIGNED', TEAM_TERRORIST: 'TERRORIST', TEAM_CT: 'CT', TEAM_SPECTATOR: 'SPECTATOR' },
		about: 'A team.',
	},
	MenuChooseTeam: {
		field: 'choice',
		type: 'TeamChoice',
		prefix: /^MenuChoose_/,
		names: { MenuChoose_T: 'TERRORIST', MenuChoose_CT: 'CT', MenuChoose_VIP: 'VIP', MenuChoose_AutoSelect: 'auto', MenuChoose_Spec: 'SPECTATOR' },
		about: 'The player\'s pick in the team menu; the sides by the names Team gives them.',
	},
	WeaponIdType: {
		field: 'weapon',
		type: 'WeaponKind',
		existing: true,
		prefix: /^WEAPON_/,
		unknown: 'none',
		about: 'A weapon, as weapon.kind names it.',
	},
	RewardType: {
		field: 'reason',
		type: 'RewardReason',
		prefix: /^RT_/,
		about: 'The reason a player is paid.',
	},
	ItemRestType: {
		field: 'restriction',
		type: 'ItemRestriction',
		prefix: /^ITEM_TYPE_/,
		about: 'The way a player would get the item a restriction is asked about: buying, touching, equipping.',
	},
	ResourceType_t: {
		field: 'resourceType',
		type: 'ResourceType',
		prefix: /^r?t_/,
		names: { rt_unk: 'unknown' },
		skip: /^rt_max$/,
		about: 'The kind of file a resource is: a sound, a model, a decal, ...',
	},
	GameEventType: {
		field: 'gameEvent',
		type: 'BotEvent',
		prefix: /^EVENT_/,
		skip: /^NUM_GAME_EVENTS$/,
		about: 'The game event the bots are told about.',
	},
	VGUIMenu: {
		field: 'menu',
		type: 'VguiMenu',
		prefix: /^VGUI_Menu_/,
		about: 'A VGUI menu of the game: the team menu, the class menu, the buy menu, ...',
	},
	DeathMessageFlags: {
		field: 'flags',
		type: 'DeathMessageFlag',
		prefix: /^PLAYERDEATH_/,
		flags: true,
		names: { PLAYERDEATH_KILLRARITY: 'killRarity' },
		about: 'The extras a death message carries.',
	},
	ItemID: {
		field: 'item',
		type: 'ItemKind',
		prefix: /^ITEM_/,
		unknown: 'none',
		about: 'An item a player can have: a weapon by its kind, or equipment such as "kevlar", "defusekit", "nvg".',
	},
	HitBoxGroup: {
		type: 'HitGroup',
		existing: true,
		prefix: /^HITGROUP_/,
		names: { HITGROUP_LEFTARM: 'leftArm', HITGROUP_RIGHTARM: 'rightArm', HITGROUP_LEFTLEG: 'leftLeg', HITGROUP_RIGHTLEG: 'rightLeg' },
		about: 'A body part a bullet hits, as player.lastHitGroup names it.',
	},
	PLAYER_ANIM: {
		type: 'PlayerAnimation',
		prefix: /^PLAYER_/,
		names: { PLAYER_SUPERJUMP: 'superJump', PLAYER_HOLDBOMB: 'holdBomb' },
		about: 'An animation the game plays on a player\'s model: walking, jumping, attacking, reloading, ...',
	},
	KillRarity: {
		field: 'rarity',
		type: 'KillRarity',
		prefix: /^KILLRARITY_/,
		flags: true,
		names: { KILLRARITY_NOSCOPE: 'noScope', KILLRARITY_THRUSMOKE: 'throughSmoke', KILLRARITY_ASSISTEDFLASH: 'assistedFlash', KILLRARITY_INAIR: 'inAir' },
		about: 'The things that made a kill rare: a headshot, through smoke, in the air, ...',
	},
};

/**
 * Fields whose reapi name was only a way round a keyword or says little:
 * `vecThrow` came out as `throwValue`, `bOverride` as `overrideValue`.
 */
const RENAMED: Record<string, string> = {
	'RG_RoundEnd:tmDelay': 'delay',
	'RG_CBasePlayer_ThrowGrenade:vecThrow': 'velocity',
	// ReGameDLL: `if (bOverride || m_bShowHints)` - shown even to a player who turned hints off.
	'RG_CBasePlayer_HintMessageEx:bOverride': 'displayIfHintsOff',
	'RH_SV_AddResource:index': 'resourceIndex',
	'RH_SV_DropClient:fmt': 'reason',
	'RH_PF_precache_generic_I:string': 'file',
	'RH_PF_precache_model_I:string': 'file',
	'RH_PF_precache_sound_I:string': 'file',
	'RG_CBasePlayer_Radio:msg_id': 'sound',
	'RG_CBasePlayer_Radio:msg_verbose': 'text',
	// ReGameDLL's KickBack(up_base, lateral_base, up_modifier, lateral_modifier, up_max, ...).
	'RG_CBasePlayerWeapon_KickBack:p_max': 'upMax',
};

/**
 * Words reapi's parameters are written in, by the name left once the
 * Hungarian prefix is off, as the author says them: `tracehandle` is the
 * `trace`, `infobuffer` the player's `info`, `vecSrc` where a shot `start`s.
 * A snake_case name not here is put in camelCase (`lateral_base` is
 * `lateralBase`).
 */
const WORDS: Record<string, string> = {
	accel: 'acceleration',
	adr: 'address',
	anim: 'animation',
	animExt: 'animationExtension',
	cmd: 'command',
	curTeam_id: 'currentTeam',
	dir: 'direction',
	dirShooting: 'direction',
	filename: 'file',
	fvol: 'volume',
	infobuffer: 'info',
	newTeam_id: 'newTeam',
	playerAnim: 'animation',
	sample: 'sound',
	shared_rand: 'randomSeed',
	skiplocal: 'skipLocal',
	spot: 'end',
	startAnim: 'startAnimation',
	src: 'start',
	string: 'text',
	team_id: 'team',
	teamonly: 'teamOnly',
	tracehandle: 'trace',
	usEvent: 'eventIndex',
	velModifier: 'velocityModifier',
	weapon_entity: 'weapon',
	weaponent: 'weapon',
	wishdir: 'direction',
	wishspeed: 'speed',
};

/** A parameter's name in the author's words: WORDS, or a snake_case one in camelCase. */
const wordOf = (name: string) => WORDS[name] ?? name.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const ENUMS = GAME_ENUMS;

const namedUsed = new Map<string, Named>();

function namedOf(tag: string, hook: string): Named | null {
	const spec = NAMED[tag];
	// An argument of an enum the includes declare is a closed set of names,
	// never a bare number: a new one needs its line in NAMED.
	if (!spec && ENUMS.has(tag)) throw new Error(`${hook}: an argument of the enum ${tag} - give it names in NAMED (scripts/generate-hooks.ts)`);
	if (!spec) return null;
	const raw = ENUMS.get(tag);
	if (!raw) throw new Error(`${hook}: enum ${tag} is not in the includes`);
	const members = raw
		.filter(m => !spec.skip?.test(m.name))
		.map(m => ({ name: spec.names?.[m.name] ?? memberName(m.name.replace(spec.prefix, '')), value: m.value }));
	const named: Named = { ...spec, tag, members };
	namedUsed.set(tag, named);
	return named;
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** A flag family's list, as scripts/generate-flags.ts names them: KillRarity -> KILL_RARITY. */
const familyOf = (n: Named) => n.type.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c).toUpperCase();

/** What a number the game hands over reads as when the enum has no name for it. */
const unknownOf = (n: Named) => n.unknown ?? 'unknown';

/** The union, the number -> name and name -> number functions, or the flag family, for hooks.ts. */
function namedBlock(n: Named) {
	const fn = lowerFirst(n.type);
	if (n.flags) {
		const bits = n.members.map(m => m.value);
		return [
			renderDoc(`${n.about}\n\nPawn: \`${n.tag}\``, ''),
			`export type ${n.type} =`,
			`${n.members.map(m => `\t| "${m.name}"`).join('\n')};`,
			``,
			`const ${familyOf(n)} = new FlagFamily(`,
			`\t[${n.members.map(m => `"${m.name}"`).join(', ')}],`,
			`\t[${bits.map(b => `0x${b.toString(16)}`).join(', ')}]`,
			`);`,
		].join('\n');
	}
	const unknown = unknownOf(n);
	const names = n.members.map(m => m.name);
	const union = names.includes(unknown) ? names : [...names, unknown];
	const seen = new Set<number>();
	return [
		...(n.existing
			? []
			: [
					renderDoc(`${n.about}${names.includes(unknown) ? '' : ` "${unknown}" - a number the include does not name.`}\n\nPawn: \`${n.tag}\``, ''),
					`export type ${n.type} =`,
					`${union.map(name => `\t| "${name}"`).join('\n')};`,
					``,
				]),
		`/** ${n.tag} as a name; a number it does not name reads as "${unknown}". */`,
		`function ${fn}Name(cell: i32): ${n.type} {`,
		`\tswitch (cell) {`,
		...n.members.filter(m => !seen.has(m.value) && seen.add(m.value)).map(m => `\t\tcase ${m.value}: return "${m.name}";`),
		`\t}`,
		`\treturn "${unknown}";`,
		`}`,
		``,
		`/** A name as its ${n.tag} number; one the enum does not have keeps the argument as it came. */`,
		`function ${fn}Cell(name: ${n.type}, current: i32): i32 {`,
		...n.members.map(m => `\tif (name == "${m.name}") return ${m.value};`),
		`\treturn current;`,
		`}`,
	].join('\n');
}

interface Result {
	kind: 'int' | 'float' | 'bool' | 'string' | 'vector' | 'Player' | 'Weapon' | 'Entity';
	pawn: string;
}

// Hungarian prefixes reapi's parameter names carry: pevInflictor, flDamage.
const HUNGARIAN = /^(pev|pent|psz|bits|vec|fl|sz|pp|[pibfnvehc])(?=[A-Z])/;

// Words a TypeScript member cannot be called, or that the event itself uses.
// AssemblyScript is stricter than TypeScript here: `get override()` does not
// parse, so every keyword is avoided rather than only the reserved ones.
const TAKEN = new Set([
	'result',
	'preventDefault',
	'kind',
	'constructor',
	'abstract',
	'as',
	'async',
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'declare',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'from',
	'function',
	'get',
	'if',
	'implements',
	'import',
	'in',
	'instanceof',
	'interface',
	'is',
	'keyof',
	'let',
	'module',
	'namespace',
	'new',
	'null',
	'of',
	'override',
	'private',
	'protected',
	'public',
	'readonly',
	'return',
	'set',
	'static',
	'super',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'type',
	'typeof',
	'var',
	'void',
	'while',
	'yield',
]);

const camelCase = (raw: string) => raw.charAt(0).toLowerCase() + raw.slice(1);
const pascal = (snake: string) => snake.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
const camelOfHook = (snake: string) => camelCase(pascal(snake));

/** The object an entity of this class is read as. */
function classOf(className: string): 'Player' | 'Weapon' | 'Entity' {
	if (className === 'CBasePlayer') return 'Player';
	if (/^CBasePlayer(?:Item|Weapon)$/.test(className)) return 'Weapon';
	return 'Entity';
}

/**
 * The object an entity argument is read as, from its name: the attacker, the
 * victim, the listener are players; an item is a weapon; anything else an
 * entity. Wrong only in the harmless direction - a Player over the world or a
 * trigger reads fields a player does not have, which is why a handler still
 * checks is_user_connected where it did.
 */
function entityOf(rawName: string): 'Player' | 'Weapon' | 'Entity' {
	if (/player|attacker|killer|victim|listener|sender|receiver|client/i.test(rawName)) return 'Player';
	if (/weapon|item/i.test(rawName)) return 'Weapon';
	return 'Entity';
}

// What `this` is called on the event: the player a CBasePlayer chain is about.
function ownerName(constant: string) {
	const owner = constant.split('_')[1] ?? '';
	const names: Record<string, string> = {
		CBasePlayer: 'player',
		CBasePlayerWeapon: 'weapon',
		CBasePlayerItem: 'item',
		CBaseEntity: 'entity',
		CBaseAnimating: 'entity',
		CBaseMonster: 'monster',
		CGrenade: 'grenade',
		CWeaponBox: 'weaponBox',
		CGib: 'gib',
		CBot: 'bot',
	};
	return names[owner] ?? camelCase(owner.replace(/^C(?=[A-Z])/, ''));
}

// An argument that is an entity - read, but not rewritten: reapi wants the
// chain's own type for it (a class pointer, an entvars) and a number is not one.
const ENTITY = /^(?:pev|pent|this$|index$|id$|attacker|victim|killer|inflictor|player|entity|ent$|other|owner|item$|weapon$|weapon_entity$|weaponent$|target|listener|sender|receiver)/i;
// pAttacker, pItem: a pointer by its Hungarian `p` and a capital after it.
// Apart from ENTITY because that one ignores case, and then `pitch` was an
// entity too.
const POINTER = /^p[A-Z]/;

interface Skip { hook: string; what: string }
const skipped: Skip[] = [];

function paramsOf(hook: string, constant: string, raw: string) {
	const list = raw.replace(/^\(|\)$/g, '').split(',').map(s => s.trim()).filter(Boolean);
	const params: Param[] = [];
	const used = new Set<string>();

	list.forEach((text, index) => {
		// reapi writes one tag without its colon: `bool bReverse`.
		const bare = text.replace(/^const\s+/, '').replace(/^&/, '').replace(/^(\w+)\s+\b/, '$1:');
		const tag = (bare.match(/^(\w+):/) ?? [])[1] ?? '';
		const nameWithArray = bare.replace(/^\w+:/, '');
		const isArray = /\[/.test(nameWithArray);
		const sized = /\[\d+\]/.test(nameWithArray);
		const rawName = nameWithArray.replace(/\[.*$/, '');

		// A vector - `Float:vecSrc[3]` - is an address in the image, where
		// reapi pushed it, and is read there (argArray in the module) and
		// written there: reapi copies it back into the game's own.
		const vector = !text.includes('&') && tag === 'Float' && nameWithArray.endsWith('[3]');

		if (!vector && (text.includes('&') || (isArray && tag === 'Float') || sized || (isArray && tag && tag !== '_'))) {
			skipped.push({ hook, what: `argument ${index + 1} \`${text}\`` });
			return;
		}

		// The player a chain is about, where reapi calls him by his index:
		// `index` in a game-rules or buy chain, `playerIndex` in a movement one.
		// He is event.player, as `this` of a CBasePlayer chain is. An engine
		// chain's `index` (RH_SV_AddResource) is a number, not an entity.
		const playerIndex = rawName === 'playerIndex' || (rawName === 'index' && constant.startsWith('RG_'));
		const plainIndex = rawName === 'index' && !playerIndex;

		const named = !isArray ? namedOf(tag, hook) : null;
		let name = RENAMED[`${constant}:${rawName}`]
			?? named?.field
			?? (rawName === 'this' ? ownerName(constant) : playerIndex ? 'player' : wordOf(camelCase(rawName.replace(HUNGARIAN, ''))));
		if (!name || !/^[a-z_]\w*$/i.test(name)) name = `arg${index + 1}`;
		if (TAKEN.has(name)) name = `${name}Value`;
		while (used.has(name)) name += '_';
		used.add(name);

		let kind: Kind = 'int';
		if (vector) {
			kind = 'vector';
		} else if (isArray) {
			kind = 'string';
		} else if (tag === 'Float') {
			kind = 'float';
		} else if (tag === 'bool') {
			kind = 'bool';
		} else if (named) {
			kind = named.flags ? 'flags' : 'enum';
		} else if (/damage.?type/i.test(rawName)) {
			kind = 'damage';
		}

		// An entity is handed over as its index and read as an object; rewriting
		// it would need the chain's own pointer type, so it is read only.
		if (kind === 'int' && !plainIndex && (rawName === 'this' || ENTITY.test(rawName) || POINTER.test(rawName))) {
			kind = rawName === 'this' ? classOf(constant.split('_')[1] ?? '') : playerIndex ? 'Player' : entityOf(rawName);
		}
		const settable = !(kind === 'Player' || kind === 'Weapon' || kind === 'Entity');
		params.push({ name, kind, index, settable, pawn: text, ...(named ? { named } : {}) });
	});

	return params;
}

/**
 * What these hooks return, which reapi's include leaves out of their comment.
 * Taken from ReGameDLL's regamedll_api.h and ReHLDS's rehlds_api.h (the
 * IHookChain's first type argument); every other undocumented hook there is
 * void. Read as void, RG_RoundEnd's preventDefault() blocked without an
 * answer, and reapi refused it on every map change: "Can't suppress original
 * function call without new return value set".
 */
const UNDOCUMENTED_RESULTS: Record<string, string> = {
	RG_RoundEnd: 'bool',
	RG_HandleMenu_ChooseTeam: 'BOOL',
	RG_CBasePlayer_TakeHealth: 'BOOL',
	RG_CBasePlayer_SetClientUserInfoName: 'bool',
	RG_CBasePlayer_Observer_IsValidTarget: 'CBasePlayer *',
	RG_CBasePlayer_HasRestrictItem: 'bool',
	RH_SV_CheckUserInfo: 'int',
};

function resultOf(hook: string, raw: string): Result | null {
	const type = raw.trim();
	if (type === '' || type === '-' || type === 'void') return null;
	if (/^(?:int|BOOL|enum \w+)$/.test(type)) return { kind: 'int', pawn: type };
	if (type === 'bool') return { kind: 'bool', pawn: type };
	if (type === 'float') return { kind: 'float', pawn: type };
	const pointer = type.match(/^(C\w+) \*/);
	// A class pointer is answered as the entity's index - reapi's docs say
	// "CGrenade * (Entity index of smokegrenade)" - and the module makes it
	// the object again.
	if (pointer) return { kind: classOf(pointer[1]), pawn: type };
	if (/^(?:edict_t|Edict) \*/.test(type)) return { kind: 'Entity', pawn: type };
	skipped.push({ hook, what: `result \`${type}\`` });
	return null;
}

const TYPES: Record<Kind, string> = {
	int: 'number',
	float: 'number',
	bool: 'boolean',
	string: 'string',
	damage: 'Damage[]',
	vector: 'Vector',
	enum: 'string',
	flags: 'string[]',
	use: 'UseType',
	Player: 'Player',
	Weapon: 'Weapon',
	Entity: 'Entity',
};

/**
 * A field's tooltip: scripts/docs/game.ts, or which argument it is, then the
 * argument as reapi declares it on a last line (code-style rule 30).
 */
function fieldDoc(p: Param, own?: Text) {
	const readOnly = p.settable ? '' : say(', read only', ', только чтение');
	const words = own ? docText(pick(own, DOCS_LANG)) : `${say('Argument', 'Аргумент')} ${p.index + 1}${p.named ? say(', by name', ', по имени') : ''}${readOnly}.`;
	return `\t${renderDoc(`${words}\n\nPawn: \`${p.pawn.replace(/^const /, '')}\``, '\t')}`;
}

function fieldOf(p: Param, own?: Text) {
	const n = p.index;
	const doc = fieldDoc(p, own);
	const named = p.named;
	const fn = named ? lowerFirst(named.type) : '';
	const family = named ? familyOf(named) : '';
	// Bits the include does not name are kept as they came when the names are written.
	const others = named?.flags ? `~0x${named.members.reduce((mask, m) => mask | m.value, 0).toString(16)}` : '';
	const get: Record<Kind, string> = {
		int: `return this.__cell(${n});`,
		float: `return cellFloat(this.__cell(${n}));`,
		bool: `return this.__cell(${n}) != 0;`,
		string: `return this.__text(${n});`,
		vector: `return this.__vector(${n});`,
		damage: `return <Damage[]>DAMAGE.namesOf(this.__cell(${n}));`,
		enum: `return ${fn}Name(this.__cell(${n}));`,
		flags: `return <${named?.type}[]>${family}.namesOf(this.__cell(${n}));`,
		use: `return useTypeName(this.__cell(${n}));`,
		Player: `return __playerOf(this.__cell(${n}));`,
		Weapon: `return new Weapon(this.__cell(${n}));`,
		Entity: `return new Entity(this.__cell(${n}));`,
	};
	// Written through the event (HookEvent.__set). An entity is written back
	// only on a Ham Sandwich function's own events, the only ones with that
	// setter.
	const set: Record<Kind, string> = {
		int: `this.__set(${n}, value);`,
		float: `this.__set(${n}, floatCell(value));`,
		bool: `this.__set(${n}, value ? 1 : 0);`,
		string: `this.__setText(${n}, value);`,
		damage: `this.__set(${n}, DAMAGE.maskOf(values));`,
		enum: `this.__set(${n}, ${fn}Cell(value, this.__cell(${n})));`,
		flags: `this.__set(${n}, ${family}.maskOf(values) | (this.__cell(${n}) & ${others}));`,
		use: `this.__set(${n}, max(USE_TYPES.indexOf(value), 0));`,
		vector: `this.__setVector(${n}, value);`,
		Player: `this.__setEntity(${n}, value.id);`,
		Weapon: `this.__setEntity(${n}, value.id);`,
		Entity: `this.__setEntity(${n}, value.id);`,
	};
	const type = named ? `${named.type}${named.flags ? '[]' : ''}` : TYPES[p.kind];
	const lines = [doc, `\tget ${p.name}(): ${type} { ${get[p.kind]} }`];
	if (p.settable) {
		const param = p.kind === 'damage' || p.kind === 'flags' ? 'values' : 'value';
		lines.push(`\tset ${p.name}(${param}: ${type}) { ${set[p.kind]} }`);
	}
	return lines.join('\n');
}

function resultField(r: Result) {
	const type = TYPES[r.kind];
	const cell = 'this.__resultCell()';
	const get = r.kind === 'float'
		? `cellFloat(${cell})`
		: r.kind === 'bool'
			? `${cell} != 0`
			: r.kind === 'int'
				? cell
				: r.kind === 'string'
					? 'this.__resultText()'
					: r.kind === 'vector'
						? 'this.__resultVector()'
						: `new ${r.kind}(${cell})`;
	const native = r.pawn.startsWith('Ham') ? 'GetHamReturn*' : 'GetHookChainReturn';
	const lines = [
		`\t${renderDoc(say(
			`The game's answer, read in a post hook. To answer yourself, return a value from the handler.\n\nPawn: \`${native}\` (${r.pawn})`,
			`Ответ игры, читается в post-хуке. Чтобы ответить самому, верните значение из обработчика.\n\nPawn: \`${native}\` (${r.pawn})`,
		), '\t')}`,
		`\tget result(): ${type} { return ${get}; }`,
	];
	// Text and a vector are Ham Sandwich's alone, which blocks without an answer.
	if (r.kind === 'string' || r.kind === 'vector') return lines.join('\n');
	return [
		...lines,
		``,
		// A function blocked still answers its caller: the neutral value,
		// what the Pawn core set by hand before its HC_SUPERCEDE - without
		// it, protection let damage through.
		`\t${renderDoc(say(
			`Blocks the game's function; it answers ${r.kind === 'bool' ? 'false' : '0'}.\n\nPawn: \`HC_SUPERCEDE\`, \`HAM_SUPERCEDE\``,
			`Блокирует функцию игры; она отвечает ${r.kind === 'bool' ? 'false' : '0'}.\n\nPawn: \`HC_SUPERCEDE\`, \`HAM_SUPERCEDE\``,
		), '\t')}`,
		`\tpreventDefault(): void { this.__block(); }`,
	].join('\n');
}

/** How a handler's answer becomes the cell the game is answered with. */
function answerCell(r: Result, value: string) {
	if (r.kind === 'float') return `floatCell(${value})`;
	if (r.kind === 'bool') return `${value} ? 1 : 0`;
	if (r.kind === 'int') return `<i32>${value}`;
	return `<i32>${value}.id`;
}

/** The listener's answer handed to the game, through the event. */
function answerCall(r: Result, value: string) {
	if (r.kind === 'string') return `event.__answerText(${value}, post);`;
	if (r.kind === 'vector') return `event.__answerVector(${value}, post);`;
	return `event.__answer(${answerCell(r, value)}, post);`;
}

/** How asyncAnswer reads an async listener's early answer - see AsyncListener. */
function answerKind(r: Result | null) {
	if (!r) return 0;
	if (r.kind === 'float') return 1;
	if (r.kind === 'bool') return 2;
	if (r.kind === 'int') return 3;
	return 4;
}

/** The compile-time check that a handler answers with the chain's own type. */
function answerGuard(r: Result) {
	const test = r.kind === 'float'
		? 'isFloat<R>()'
		: r.kind === 'bool'
			? 'isBoolean<R>()'
			: r.kind === 'int'
				// A number a plugin returns is JavaScript's, a float to the compiler.
				? '(isInteger<R>() || isFloat<R>()) && !isBoolean<R>()'
				: r.kind === 'string'
					? 'isString<R>()'
					: r.kind === 'vector'
						? 'isReference<R>() && idof<R>() == idof<Vector>()'
						: 'isReference<R>() && !isString<R>()';
	return `if (!(${test})) ERROR("a ${'${'}hook${'}'} handler answers with ${TYPES[r.kind]}");`;
}

// The language of the tooltips: AMXTS_DOCS_LANG in .env, English by default.
const DOCS_LANG = docsLang();
/** The generator's own words, in the chosen language. */
const say = (en: string, ru: string) => (DOCS_LANG === 'ru' ? ru : en);

/** What an editor shows for a chain: scripts/docs/game.ts first, reapi's Description after. */
function gameSummary(camel: string, comment: string) {
	const ours = GAME[camel];
	const description = line(comment, 'Description');
	return ours ? pick(ours.summary, DOCS_LANG) : description && description !== '-' ? description : '';
}

/** The API a chain is of: ReHLDS's for the engine's, ReGameDLL's for the game's. */
const apiOf = (rehlds: boolean) => (rehlds ? 'ReHLDS' : 'ReGameDLL');

/**
 * What a hookchain event's tooltip says of a server without its API - plain
 * HLDS: what it does not give there (scripts/hlds-events.ts), or that nothing
 * hears it. An event heard fully says nothing.
 */
function withoutChains(camel: string, rehlds: boolean) {
	const heard = HEARD[camel];
	const api = apiOf(rehlds);
	if (heard?.gaps) return say(`Without ${api} (plain HLDS): ${heard.gaps.en}.`, `Без ${api} (чистый HLDS): ${heard.gaps.ru}.`);
	if (heard) return '';
	return say(`Without ${api} (plain HLDS) nothing hears it.`, `Без ${api} (чистый HLDS) его ничто не слышит.`);
}

/** Two texts as sentences one after the other: the first ended with its full stop. */
function sentences(first: string, second: string) {
	if (!first || !second) return first || second;
	return `${/[.!?]$/.test(first) ? first : `${first}.`} ${second}`;
}

/**
 * One game event as it is written out: a reapi hookchain, a Ham Sandwich
 * function, or both - the same function, one event, and the hood picks the
 * backend by the class it is listened for on (addGameListener).
 */
interface EventSpec {
	camel: string;
	Name: string;
	/** The event's kind: reapi's short name, or the Ham_* constant of an event reapi has no chain for. */
	kind: string;
	/** reapi's short name, for hook(). */
	hook?: string;
	/** A chain of ReHLDS's, the engine's, rather than ReGameDLL's. */
	rehlds: boolean;
	ham?: HamFunction;
	params: Param[];
	result: Result | null;
	summary: string;
	/** The event's Pawn line. */
	pawn: string;
	/** The fields a Ham Sandwich event about any entity adds to a reapi chain about a player. */
	extra: string[];
}

// reapi's chain names that say the C++ class rather than the action: an
// event is named after what the game does.
const EVENT_NAMES: Record<string, string> = {
	base_player_spawn: 'spawn',
	base_player_jump: 'jump',
	base_player_duck: 'duck',
	// The game rules' think: `think` is an entity's (Ham_Think).
	think: 'gameThink',
	// ReGameDLL's function names, said as a player says them: AddAccount moves
	// the money, RestartRound starts the next round, OnRoundFreezeEnd is the
	// round's start, once the freeze time is over.
	add_account: 'addMoney',
	restart_round: 'newRound',
	on_round_freeze_end: 'roundStart',
	has_restrict_item: 'itemRestricted',
	clean_up_map: 'mapReset',
	// Hungarian prefixes of the game rules' questions: fl a float, f a BOOL.
	fl_player_fall_damage: 'fallDamage',
	f_player_can_take_damage: 'canTakeDamage',
	f_player_can_respawn: 'canRespawn',
	f_should_switch_weapon: 'shouldSwitchWeapon',
	buy_weapon_by_weapon_id: 'buyWeapon',
	buy_gun_ammo: 'buyAmmo',
	give_named_item: 'giveItem',
	give_c4: 'giveBomb',
	make_bomber: 'becomeBomber',
	make_vip: 'becomeVip',
	go_to_intermission: 'intermission',
	// ReHLDS's internal functions end in I; the file kinds are the author's words.
	precache_generic_i: 'precacheFile',
	precache_model_i: 'precacheModel',
	precache_sound_i: 'precacheSound',
	ent_select_spawn_point: 'selectSpawnPoint',
	get_player_spawn_spot: 'spawnSpot',
	execute_server_string_cmd: 'serverCommand',
	client_printf: 'consoleMessage',
	send_say_message: 'chatMessage',
	hint_message_ex: 'hintMessage',
	drop_client: 'disconnectClient',
	set_client_user_info_name: 'changeName',
	set_client_user_info_model: 'changeModel',
	client_user_info_changed: 'userInfoChange',
	add_points: 'addFrags',
	add_points_to_team: 'addTeamScore',
	take_health: 'heal',
	add_player_item: 'addItem',
	remove_player_item: 'removeItem',
	can_have_player_item: 'canHaveItem',
	dead_player_weapons: 'dropWeaponsOnDeath',
	kick_back: 'recoil',
	is_penetrable_entity: 'canShootThrough',
	start_observer: 'startSpectating',
	observer_find_next_player: 'spectateNext',
	observer_is_valid_target: 'canSpectate',
	impulse_commands: 'impulse',
	on_spawn_equip: 'spawnEquip',
	on_event: 'gameEvent',
	// The player's movement code (pm_shared): pm is the engine's prefix.
	pm_duck: 'duckMovement',
	pm_jump: 'jumpMovement',
	// The game's shot and a shotgun's: fire_bullets stays Half-Life's own FireBullets.
	fire_bullets3: 'shoot',
	fire_buckshots: 'shootBuckshot',
};

// Chains of the engine's own bookkeeping, and Ham Sandwich functions the
// game leaves empty or keeps for debugging: not game events a plugin
// listens for. RegisterHookChain and RegisterHam (`@amxts/core/natives`)
// still reach them.
const HIDDEN_EVENTS = new Set([
	'alloc',
	'free',
	'directSet',
	'emitPings',
	'objectCaps',
	'getEntityInit',
	'allowPhysent',
	'writeFullClientUpdate',
	'sendResources',
	'reportAiState',
	'useDecrement',
	'addDuplicate',
	'overrideReset',
	'onControls',
	'updateOwner',
]);

const hamOf = new Map(HAM_FUNCTIONS.filter(f => f.reapi).map(f => [f.reapi!, f]));

// A Ham Sandwich function's own comment in ham_const.inc: its Description is
// the tooltip until scripts/docs/game.ts has words for the event.
const hamDocs = new Map<string, string>();
for (const m of readFileSync(includePath('ham_const'), 'utf8').matchAll(/\/\*\*((?:(?!\*\/)[\s\S])*?)\*\/\s*(Ham_\w+)/g)) hamDocs.set(m[2], m[1]);

const HAM_KINDS: Record<HamKind, { kind: Kind; pawn: (name: string) => string }> = {
	entity: { kind: 'Entity', pawn: name => name },
	player: { kind: 'Player', pawn: name => name },
	weapon: { kind: 'Weapon', pawn: name => name },
	int: { kind: 'int', pawn: name => name },
	float: { kind: 'float', pawn: name => `Float:${name}` },
	bool: { kind: 'bool', pawn: name => `bool:${name}` },
	vector: { kind: 'vector', pawn: name => `Float:${name}[3]` },
	string: { kind: 'string', pawn: name => `${name}[]` },
	damage: { kind: 'damage', pawn: name => name },
	use: { kind: 'use', pawn: name => name },
};

const HAM_RESULTS: Record<Exclude<HamAnswer, 'none'>, Result> = {
	int: { kind: 'int', pawn: 'Integer' },
	bool: { kind: 'bool', pawn: 'Integer' },
	float: { kind: 'float', pawn: 'Float' },
	entity: { kind: 'Entity', pawn: 'Entity' },
	string: { kind: 'string', pawn: 'String' },
	vector: { kind: 'vector', pawn: 'Vector' },
};

/** A Ham Sandwich function's arguments as fields: `this` first, then the rest, each writable. */
function hamParams(f: HamFunction): Param[] {
	const self = HAM_KINDS[f.target];
	return [
		{ name: f.target, kind: self.kind, index: 0, settable: false, pawn: 'this' },
		...f.params.map((param, i) => {
			const shape = HAM_KINDS[param.kind];
			return { name: param.name, kind: shape.kind, index: i + 1, settable: true, pawn: shape.pawn(param.name) };
		}),
	];
}

/** The same function under both backends has the same arguments, float for float. */
function checkSameShape(spec: EventSpec, f: HamFunction) {
	const reapi = spec.params.slice(1).map(p => p.kind === 'float');
	const ham = f.params.map(param => param.kind === 'float');
	if (JSON.stringify(reapi) !== JSON.stringify(ham)) throw new Error(`${f.ham} and reapi's ${spec.hook} do not take the same arguments: ${spec.pawn}`);
}

const specs: EventSpec[] = [];

for (const [hook, id] of [...idOfName].sort((a, b) => a[0].localeCompare(b[0]))) {
	const constant = constantOfId.get(id);
	const comment = constant ? docs.get(constant) : undefined;
	if (!constant || !comment) {
		skipped.push({ hook, what: 'no documentation comment' });
		continue;
	}

	const camel = EVENT_NAMES[hook] ?? camelOfHook(hook);
	if (HIDDEN_EVENTS.has(camel)) continue;
	const ham = hamOf.get(camel);
	const paramsLine = line(comment, 'Params');
	const spec: EventSpec = {
		camel,
		Name: `${pascal(camel)}Event`,
		kind: hook,
		hook,
		rehlds: constant.startsWith('RH_'),
		ham,
		params: paramsOf(hook, constant, paramsLine),
		result: resultOf(hook, line(comment, 'Return type') || UNDOCUMENTED_RESULTS[constant] || ''),
		// An event Ham Sandwich's function delivers too is heard the same without ReGameDLL.
		summary: ham ? gameSummary(camel, comment) : sentences(gameSummary(camel, comment), withoutChains(camel, constant.startsWith('RH_'))),
		pawn: `\`${constant}\`${paramsLine ? ` ${paramsLine}` : ''}${ham ? `, \`${ham.ham}\`` : ''}`,
		extra: [],
	};
	if (ham) checkSameShape(spec, ham);
	// Listened for on another class, a player's event is about that entity.
	if (ham?.target === 'entity' && spec.params[0]?.name === 'player') {
		spec.extra.push(`\t${renderDoc(say(
			'The entity the event is about, whatever its class - the one `classname` names; for a player, `event.player`.',
			'Сущность, о которой событие, какого бы класса она ни была, — та, что названа в `classname`; для игрока — `event.player`.',
		), '\t')}`, `\tget entity(): Entity { return new Entity(this.__cell(0)); }`);
	}
	specs.push(spec);
}

const taken = new Set(specs.map(spec => spec.camel));
for (const f of HAM_FUNCTIONS.filter(row => !row.reapi && !HIDDEN_EVENTS.has(row.event))) {
	if (taken.has(f.event)) throw new Error(`${f.ham}: the event ${f.event} is another function's - name it for its own action`);
	const ours = GAME[f.event];
	specs.push({
		camel: f.event,
		Name: `${pascal(f.event)}Event`,
		kind: f.ham,
		rehlds: false,
		ham: f,
		params: hamParams(f),
		result: f.answer === 'none' ? null : HAM_RESULTS[f.answer],
		summary: ours ? pick(ours.summary, DOCS_LANG) : line(hamDocs.get(f.ham) ?? '', 'Description'),
		pawn: `\`${f.ham}\``,
		extra: [],
	});
}
const orphan = HAM_FUNCTIONS.find(f => f.reapi && !HIDDEN_EVENTS.has(f.reapi) && !specs.some(spec => spec.hook && spec.camel === f.reapi));
if (orphan) throw new Error(`${orphan.ham}: no reapi event named ${orphan.reapi}`);

const classes: string[] = [];
const tables: string[] = [];
const adds: string[] = [];
const removes: string[] = [];
const eventKeys: string[] = [];
const answerKeys: string[] = [];

/**
 * When a listener goes to the Ham Sandwich function rather than the chain:
 * when it names a class other than the chain's own, or the server has no
 * ReGameDLL. A weapon chain's own class is every weapon, so any class
 * narrows it to the function; a player chain's is "player".
 */
function toHam(ham: HamFunction) {
	return `(${ham.target === 'weapon' ? 'classname.length > 0' : 'classname.length > 0 && classname != "player"'}) || !__hasChains(false)`;
}

/** The class Ham Sandwich hooks for a listener: the one named, or the chain's own - "player", or every weapon. */
function hamOwnClass(ham: HamFunction) {
	return `classname.length > 0 ? classname : ${ham.target === 'weapon' ? 'EVERY_WEAPON' : '"player"'}`;
}

/** The class an event reapi has no chain for is listened for on: the one named, a player's by default. */
function hamClass(ham: HamFunction) {
	return ham.target === 'player' ? 'classname.length > 0 ? classname : "player"' : 'classname';
}

/**
 * How a listener is taken off: from Ham Sandwich's list of its class or from
 * the chain's phase, each switching its hook off with its last listener; a
 * stock hook's backend is switched off with the event's last.
 */
/**
 * An event's object - a chain's phase, its Ham Sandwich hooks, a stock
 * hook's switch - read through `name()` and made on its first use. A
 * module-level `new` runs in the module's start, which compiles every event's
 * classes into every plugin, the ones it never listens for too.
 */
function made(name: string, type: string, args = '') {
	return [
		`let ${name}Made: ${type} | null = null;`,
		`// @ts-ignore: decorator`,
		`@inline function ${name}(): ${type} {`,
		`\tlet made = ${name}Made;`,
		`\tif (made == null) ${name}Made = made = new ${type}(${args});`,
		`\treturn made;`,
		`}`,
	];
}

function removal(spec: EventSpec, heard: HeardEvent | undefined) {
	const { camel, hook, ham } = spec;
	if (ham && !hook) return [`\t\t${camel}Hams().remove(${hamClass(ham)}, post, fn);`];
	return [
		...(ham ? [`\t\tif (${toHam(ham)}) { ${camel}Hams().remove(${hamOwnClass(ham)}, post, fn); return; }`] : []),
		`\t\t(post ? ${camel}Post() : ${camel}Pre()).remove(fn);`,
		...(heard ? [`\t\t${camel}Backend().set(${camel}Pre().entries.count + ${camel}Post().entries.count > 0);`] : []),
		...(heard?.post ? [`\t\t${camel}PostBackend().set(${camel}Post().entries.count > 0);`] : []),
	];
}

/** What a listener with a class it cannot take is told, instead of being added. */
function refusal(spec: EventSpec) {
	const { camel, hook, ham } = spec;
	if (!ham) return `\t\tif (classname.length > 0) { console.error("${camel} is not listened for by class: leave classname out"); return; }`;
	if (hook || ham.target === 'player') return '';
	const example = ham.target === 'weapon' ? 'weapon_knife' : 'info_target';
	return `\t\tif (classname.length == 0) { console.error("${camel} is about one class of entity, e.g. { classname: \\"${example}\\" }"); return; }`;
}

/**
 * The events a listener is not handed in some case, as a condition on `event`.
 * playerSpawn: a player who takes the slot of one who left this map is
 * spawned by the game's ClientPutInServer before it clears has_disconnected,
 * which the last one left set - the game counts him out, and ReAPI's natives
 * refuse him. He is heard from his next spawn on.
 */
const UNHEARD: Record<string, string> = {
	playerSpawn: 'event.player.hasDisconnected',
};

for (const spec of specs.sort((a, b) => a.camel.localeCompare(b.camel))) {
	const { camel, Name, hook, ham, params, result } = spec;
	const ours = GAME[camel];
	const fields = params.map(p => fieldOf(p, ours?.fields?.[p.name]));
	const unheard = UNHEARD[camel] ? [`\tif (${UNHEARD[camel]}) return;`] : [];

	classes.push([
		`/**`,
		...(spec.summary ? [` * ${docText(spec.summary)}`, ` *`] : []),
		` * Pawn: ${spec.pawn}`,
		` */`,
		`export class ${Name} extends HookEvent {`,
		// A private field is what makes two event classes different types to
		// TypeScript: without it, a listener for one chain would be accepted
		// for another whose fields happen to match.
		`\tprivate readonly kind: string = "${spec.kind}";`,
		// The function a Ham Sandwich hook of the event is on; the fake server reads it too.
		...(ham ? [`\tprivate static readonly ham: i32 = ${ham.ham};`] : []),
		...fields,
		...spec.extra,
		...(result ? [resultField(result)] : []),
		`}`,
	].join('\n'));

	const T = result ? TYPES[result.kind] : 'i32';
	// Heard on plain HLDS through a stock hook (as/hlds.ts): the backend makes the event and hands it to each phase.
	const heard = hook && !ham ? HEARD[camel] : undefined;
	const pawnNames = spec.pawn.replace(/ \([^)]*\)/, '');
	eventKeys.push(`\t${renderDoc(`${spec.summary ? `${docText(spec.summary)}\n\n` : ''}Pawn: ${pawnNames}`, '\t')}`, `\t${camel}: ${Name};`);
	answerKeys.push(`\t${camel}: ${result ? T : 'void'};`);

	// The event a hook delivers is a view of the hook's call: its fields are
	// read from the call that runs and it keeps nothing of its own, so one
	// object, made on the first call, serves every dispatch, nested ones too.
	// The one a stock hook's backend made holds what the backend gave and goes
	// through the same loop, Run, for each phase. Fire and Run are inlined into
	// the phase's handler: a call of the plugin's own costs a shadow-stack frame.
	const view = [
		`let ${camel}View: ${Name} | null = null;`,
		`// @ts-ignore: decorator`,
		`@inline function ${camel}Event(): ${Name} {`,
		`\tlet event = ${camel}View;`,
		`\tif (event == null) ${camel}View = event = new ${Name}();`,
		`\treturn event;`,
		`}`,
	];
	const open = heard
		? [
				...view,
				`// @ts-ignore: decorator`,
				`@inline function ${camel}Fire(entries: HookEntries<${Name}, ${T}>, post: bool): void {`,
				`\t${camel}Run(${camel}Event(), entries, post);`,
				`}`,
				`function ${camel}FireHlds(event: ${Name}, post: bool): void {`,
				`\tevent.__hlds = true;`,
				`\t${camel}Run(event, post ? ${camel}Post().entries : ${camel}Pre().entries, post);`,
				`}`,
				`let ${camel}HldsHooked = false;`,
				...made(`${camel}Backend`, '__Switch'),
				...(heard.post ? [`let ${camel}PostHldsHooked = false;`, ...made(`${camel}PostBackend`, '__Switch')] : []),
				`// @ts-ignore: decorator`,
				`@inline function ${camel}Run(event: ${Name}, entries: HookEntries<${Name}, ${T}>, post: bool): void {`,
			]
		: [
				...view,
				`// @ts-ignore: decorator`,
				`@inline function ${camel}Fire(entries: HookEntries<${Name}, ${T}>, post: bool): void {`,
				`\tconst event = ${camel}Event();`,
			];
	const fire = result
		? [
				...open,
				...unheard,
				`\tconst n = entries.begin();`,
				`\tfor (let i = 0; i < n; i++) {`,
				`\t\tconst entry = entries.at(i);`,
				`\t\tif (entry == null) continue;`,
				`\t\tconst silent = entry.silent;`,
				`\t\tif (silent) { silent(event); continue; }`,
				`\t\tconst answer = entry.answer!(event);`,
				`\t\t${answerCall(result, 'answer')}`,
				`\t\t// Answered: in a pre hook the game does not run and nobody after asks.`,
				`\t\tif (!post) break;`,
				`\t}`,
				`\tentries.end();`,
				`}`,
			]
		: [
				...open,
				...unheard,
				`\tconst n = entries.begin();`,
				`\tfor (let i = 0; i < n; i++) {`,
				`\t\tconst entry = entries.at(i);`,
				`\t\tif (entry) entry.silent!(event);`,
				`\t}`,
				`\tentries.end();`,
				`}`,
			];

	tables.push([
		...(hook
			? [
					...made(`${camel}Pre`, `ChainPhase<${Name}, ${T}>`),
					...made(`${camel}Post`, `ChainPhase<${Name}, ${T}>`),
				]
			: []),
		...fire,
		...(ham ? made(`${camel}Hams`, `HamHooks<${Name}, ${T}>`, ham.ham) : []),
		...(hook
			? [
					`function ${camel}FirePre(a: number, b: number, c: number, d: number) { ${camel}Fire(${camel}Pre().entries, false); }`,
					`function ${camel}FirePost(a: number, b: number, c: number, d: number) { ${camel}Fire(${camel}Post().entries, true); }`,
				]
			: []),
	].join('\n'));

	const answerBranch = result
		? [
				`\t\telse {`,
				`\t\t\t${answerGuard(result).replace('${hook}', camel)}`,
				`\t\t\tentry.answer = changetype<(event: ${Name}) => ${T}>(listener);`,
				`\t\t}`,
			]
		: [`\t\telse ERROR("a ${camel} listener cannot answer: the game's function returns nothing");`];

	// An async listener returns a Promise. Told apart at compile time: a
	// class with PromiseBase's fields (as/promise.ts). Text and a vector are
	// answered at once or not at all.
	const promiseGuard = !result
		? ''
		: result.kind === 'string' || result.kind === 'vector'
			? `\t\t\tif (idof<R>() != idof<Promise<void>>()) ERROR("an async ${camel} listener answers nothing: return the ${TYPES[result.kind]} without await");`
			: `\t\t\tif (idof<R>() != idof<Promise<${T}>>() && idof<R>() != idof<Promise<void>>()) ERROR("an async ${camel} listener answers with Promise<${TYPES[result.kind]}>");`;

	// The chain is hooked on the first listener of a phase (ChainPhase); a
	// Ham Sandwich function on the first listener for its class (HamHooks).
	const chainHook = hook ? [`\t\t(post ? ${camel}Post() : ${camel}Pre()).add(entry, "${hook}", post ? ${camel}FirePost : ${camel}FirePre, post, changetype<usize>(${camel}Event()), ${!UNHEARD[camel]});`] : [];
	const guard = refusal(spec);
	// A chain of ReGameDLL's or ReHLDS's own: without its API nothing delivers it, and the console says so once.
	const chainOnly = hook && !ham && !heard ? `\t\tif (!__hasChains(${spec.rehlds})) { __sayOnce("${camel} needs ${apiOf(spec.rehlds)}, which this server does not have: its listeners are never called"); return; }` : '';
	// One a stock hook hears instead: its backend is registered on the first
	// listener, its post one on the first post listener, each switched off
	// while it has none (removal).
	const hlds = heard
		? [
				`\t\tif (!__hasChains(${spec.rehlds})) {`,
				`\t\t\tif (!${camel}HldsHooked) { ${camel}HldsHooked = true; ${camel}Hlds(${camel}FireHlds, ${camel}Backend()); }`,
				...(heard.post ? [`\t\t\tif (post && !${camel}PostHldsHooked) { ${camel}PostHldsHooked = true; ${camel}PostHlds(${camel}FireHlds, ${camel}PostBackend()); }`] : []),
				`\t\t\t(post ? ${camel}Post() : ${camel}Pre()).entries.push(entry);`,
				`\t\t\t${camel}Backend().set(true);`,
				...(heard.post ? [`\t\t\tif (post) ${camel}PostBackend().set(true);`] : []),
				`\t\t\treturn;`,
				`\t\t}`,
			]
		: [];

	adds.push([
		`\tif (idof<E>() == idof<${Name}>()) {`,
		...(guard ? [guard] : []),
		...(chainOnly ? [chainOnly] : []),
		`\t\tconst entry = new HookEntry<${Name}, ${T}>();`,
		`\t\tif (isVoid<R>()) entry.silent = changetype<(event: ${Name}) => void>(listener);`,
		`\t\t// @ts-ignore: TypeScript does not know R is a Promise here; the compiler checks it`,
		`\t\telse if (isReference<R>() && isDefined(changetype<R>(0).__hasValue)) {`,
		...(promiseGuard ? [promiseGuard] : []),
		`\t\t\tentry.silent = changetype<(event: ${Name}) => void>(asyncListener(changetype<usize>(listener), ${answerKind(result)}, post));`,
		`\t\t\tentry.source = changetype<usize>(listener);`,
		`\t\t}`,
		...answerBranch,
		...(ham && hook ? [`\t\tif (${toHam(ham)}) { ${camel}Hams().add(${hamOwnClass(ham)}, post, ${camel}Fire, entry); return; }`] : []),
		...(ham && !hook ? [`\t\t${camel}Hams().add(${hamClass(ham)}, post, ${camel}Fire, entry);`] : []),
		...hlds,
		...chainHook,
		`\t\treturn;`,
		`\t}`,
	].join('\n'));

	removes.push([
		`\tif (idof<E>() == idof<${Name}>()) {`,
		...removal(spec, heard),
		`\t\treturn;`,
		`\t}`,
	].join('\n'));
}

// A touch between two classes is no hookchain: the engine module's
// register_touch, filtered by class before it reaches the plugin
// (Game.addEventListener in as/facade.ts, TouchEvent there).
eventKeys.push(`\t${renderDoc(`${docText(pick(GAME.touch.summary, DOCS_LANG))}\n\nPawn: \`register_touch\``, '\t')}`, `\ttouch: TouchEvent;`);
answerKeys.push(`\ttouch: void;`);
// So is an entity's state as a player is sent it: the game's AddToFullPack,
// filtered by class in the module (EntityStateEvent in as/facade.ts).
eventKeys.push(`\t${renderDoc(`${docText(pick(GAME.entityState.summary, DOCS_LANG))}\n\nPawn: \`register_forward(FM_AddToFullPack, ..., 1)\`, \`get_es\`, \`set_es\``, '\t')}`, `\tentityState: EntityStateEvent;`);
answerKeys.push(`\tentityState: void;`);

writeFileSync('./as/hooks.ts', `// GENERATED by scripts/generate-hooks.ts — do not edit
// Source: includes/reapi_gamedll_const.inc, includes/reapi_engine_const.inc,
// ham_const.inc (scripts/ham-functions.ts)
//
// Every game event: a reapi hookchain, a Ham Sandwich function, or both. Its
// arguments are fields of the type the include documents - an entity is a
// Player, a Weapon or an Entity - what the handler returns is the game's
// answer, and blocking without one is \`event.preventDefault()\`. Listen with
// \`game.addEventListener("takeDamage", ...)\`.
import { EntityStateEvent, Player, RoundWinner, Team, TouchEvent, UseType, Vector, WideHandler, arg, argText, cellFloat, floatCell, handled, hook, __chainSet, __chainSetText, __hasChains, __hookDirect, __hookOn, __Listeners, __Switch, __ham, __outcome, __nativeVector, __playerOf, __setNativeVector, __sayOnce, __weaponClassnames } from "./facade";
import { Entity, HitGroup, Weapon, WeaponKind } from "./entities";
import {
	HookName,
	${HAM_FUNCTIONS.map(f => f.ham).join(', ')}
} from "./constants";
import { DAMAGE, Damage, FlagFamily } from "./flags";
import {
	${Object.entries(HEARD).flatMap(([event, heard]) => [`${event}Hlds`, ...(heard.post ? [`${event}PostHlds`] : [])]).join(', ')}
} from "./hlds";

// A use's type, USE_OFF to USE_TOGGLE in their numbers' order.
const USE_TYPES: UseType[] = ["off", "on", "set", "toggle"];

function useTypeName(cell: i32): UseType {
	return cell >= 0 && cell < USE_TYPES.length ? USE_TYPES[cell] : "toggle";
}

// What a listener's outcome stops: the event, the game's function with it.
const OUTCOME_BREAK: i32 = 2;

/**
 * What every game event can do. Its fields are the module's hook's call of
 * the game's function (arg, argText): a field written is what the function
 * goes on with, and -1 is its answer.
 */
export class HookEvent {
	/**
	 * @hidden A stock hook's backend made the event, on a server without
	 * ReGameDLL (as/hlds.ts): a field is what the backend gave, 0 or empty
	 * where it gave nothing, and what a listener asks of the game - blocking
	 * it, answering, a field written - waits for the backend, which gives the
	 * game what it can.
	 */
	__hlds: bool = false;
	/** @hidden What the listeners asked of the game, on a stock hook's event. */
	__prevented: bool = false;
	__answered: bool = false;
	__answerCell: i32 = 0;
	__changed: bool = false;

	// A stock hook's event: what the backend gave and the listeners wrote, by
	// argument. Made on the first: most events are only read.
	private written: Map<i32, i32> | null = null;
	private writtenText: Map<i32, string> | null = null;
	private writtenVector: Map<i32, Vector> | null = null;

	/** An argument as the handler sees it now. */
	protected __cell(index: i32): i32 {
		if (!this.__hlds) return arg(index);
		const written = this.written;
		return written != null && written.has(index) ? written.get(index) : 0;
	}

	protected __text(index: i32): string {
		if (!this.__hlds) return argText(index);
		const written = this.writtenText;
		return written != null && written.has(index) ? written.get(index) : "";
	}

	protected __vector(index: i32): Vector {
		if (!this.__hlds) return __nativeVector(index);
		const written = this.writtenVector;
		return written != null && written.has(index) ? written.get(index) : new Vector();
	}

	private __write(index: i32, cell: i32): void {
		let written = this.written;
		if (written == null) this.written = written = new Map<i32, i32>();
		written.set(index, cell);
	}

	private __writeText(index: i32, value: string): void {
		let written = this.writtenText;
		if (written == null) this.writtenText = written = new Map<i32, string>();
		written.set(index, value);
	}

	private __writeVector(index: i32, value: Vector): void {
		let written = this.writtenVector;
		if (written == null) this.writtenVector = written = new Map<i32, Vector>();
		written.set(index, value);
	}

	/** @hidden A field's value from a stock hook's backend, by the argument's place; -1 is the game's answer. */
	__give(index: i32, cell: i32): void {
		this.__write(index, cell);
	}

	/** @hidden */
	__giveText(index: i32, value: string): void {
		this.__writeText(index, value);
	}

	/** @hidden */
	__giveVector(index: i32, value: Vector): void {
		this.__writeVector(index, value);
	}

	/** Writes an argument back, a float as its bits, an entity as its index. */
	protected __set(index: i32, cell: i32): void {
		if (!this.__hlds) {
			__chainSet(index, cell);
			return;
		}
		this.__changed = true;
		this.__write(index, cell);
	}

	protected __setText(index: i32, value: string): void {
		if (!this.__hlds) {
			__chainSetText(index, value);
			return;
		}
		this.__changed = true;
		this.__writeText(index, value);
	}

	protected __setEntity(index: i32, id: number): void {
		this.__set(index, <i32>id);
	}

	// A vector is written where the game keeps it.
	protected __setVector(index: i32, value: Vector): void {
		if (!this.__hlds) {
			__setNativeVector(index, value);
			return;
		}
		this.__changed = true;
		this.__writeVector(index, value);
	}

	/** The game's answer as a cell: a float's bits, an entity's index. */
	protected __resultCell(): i32 {
		return this.__cell(-1);
	}

	protected __resultText(): string {
		return argText(-1);
	}

	protected __resultVector(): Vector {
		return __nativeVector(-1);
	}

	/** @hidden A listener's answer: the game's function's result, and in a pre listener the function blocked. */
	__answer(cell: i32, post: bool): void {
		if (this.__hlds) {
			this.__answered = true;
			this.__answerCell = cell;
			return;
		}
		__chainSet(-1, cell);
		if (!post) handled();
	}

	/** @hidden */
	__answerText(value: string, post: bool): void {
		__chainSetText(-1, value);
		if (!post) handled();
	}

	/** @hidden */
	__answerVector(value: Vector, post: bool): void {
		__setNativeVector(-1, value);
		if (!post) handled();
	}

	/** Blocks a function that answers: it answers the neutral value, 0 or false. */
	protected __block(): void {
		if (this.__hlds) this.__prevented = true;
		else {
			__chainSet(-1, 0);
			handled();
		}
	}

	${renderDoc(say(
		'Blocks the game\'s function this event is about. For one that answers, return the answer from the handler instead; this is for blocking without one.\n\nPawn: `HC_SUPERCEDE`, `HAM_SUPERCEDE`',
		'Блокирует функцию игры, о которой событие. Если она ждёт ответа, верните его из обработчика; это — блокировка без ответа.\n\nPawn: `HC_SUPERCEDE`, `HAM_SUPERCEDE`',
	), '\t')}
	preventDefault() {
		if (this.__hlds) this.__prevented = true;
		else handled();
	}

	${renderDoc(say(
		'Stops the event: the game\'s function does not run, and neither do the listeners after this one. Rarely what is wanted; preventDefault() usually is.\n\nPawn: `HC_BREAK`',
		'Останавливает событие: функция игры не выполняется, и обработчики после этого тоже. Нужно редко — обычно подходит preventDefault().\n\nPawn: `HC_BREAK`',
	), '\t')}
	stopImmediatePropagation() {
		if (this.__hlds) this.__prevented = true;
		else __outcome(OUTCOME_BREAK);
	}
}

/**
 * One registered handler: one that says nothing, or one that answers. Two
 * fields rather than one because a handler's return type is fixed when it
 * is compiled - AssemblyScript has no "maybe returns".
 */
export class HookEntry<E, T> {
	silent: ((event: E) => void) | null = null;
	answer: ((event: E) => T) | null = null;
	/** An async listener as it was added: \`silent\` holds its wrapper, asyncListener. */
	source: usize = 0;
}

/** The listeners of one phase or class, walked in place by the event's Fire. */
type HookEntries<E, T> = __Listeners<HookEntry<E, T>>;

/** Takes a listener off a list: the function it was added as, or the async one behind a wrapper. */
function unlisten<E, T>(list: HookEntries<E, T>, fn: usize): void {
	for (let i = 0; i < list.slots; i++) {
		const entry = list.at(i);
		if (entry == null) continue;
		if (changetype<usize>(entry.silent) == fn || changetype<usize>(entry.answer) == fn || entry.source == fn) {
			list.removeAt(i);
			return;
		}
	}
}

// The class of a weapon chain's listener without one, on a server without
// reapi: Ham Sandwich hooks the function on every weapon's class.
const EVERY_WEAPON = "weapon_*";

/**
 * One phase of a hookchain, before the game or after it: its listeners, and
 * the hook registered on the first of them and switched off while none is
 * left, so the game's function does not call the plugin for nothing. On a
 * server without the chain's API the listeners alone: a backend hears the
 * event (as/hlds.ts).
 */
class ChainPhase<E, T> {
	entries: HookEntries<E, T> = new __Listeners<HookEntry<E, T>>();
	private hooked: bool = false;
	private chain: __Switch = new __Switch();
	private handle: i32 = 0;
	private view: usize = 0;
	private plain: bool = false;

	// The event's fire function comes with each listener, as HamHooks' does;
	// so do its object (view) and whether the fire function does nothing but
	// call the listeners (plain).
	add(entry: HookEntry<E, T>, name: HookName, fire: WideHandler, post: bool, view: usize, plain: bool): void {
		if (!this.hooked) {
			this.hooked = true;
			const handle = <i32>hook(name, fire, post);
			this.handle = handle;
			this.view = view;
			this.plain = plain;
			if (handle != 0) this.chain.add((on: bool): void => __hookOn(handle, on));
		}
		this.entries.push(entry);
		this.chain.set(true);
		this.direct();
	}

	remove(fn: usize): void {
		unlisten<E, T>(this.entries, fn);
		this.chain.set(this.entries.count > 0);
		this.direct();
	}

	/**
	 * One listener that only listens - not async, answering nothing - is
	 * called by the module itself, with the event's object: the phase's walk
	 * would do nothing else, and the call skips it.
	 */
	private direct(): void {
		if (this.handle == 0 || !this.plain) return;
		let listener: usize = 0;
		const entries = this.entries;
		for (let i = 0; i < entries.slots && entries.count == 1; i++) {
			const entry = entries.at(i);
			if (entry == null) continue;
			if (entry.source == 0) listener = changetype<usize>(entry.silent);
			break;
		}
		__hookDirect(this.handle, listener, listener != 0 ? this.view : 0);
	}
}

/** The listeners of one class's Ham Sandwich hook, pre or post, and the hook's switch. */
class HamList<E, T> {
	entries: HookEntries<E, T> = new __Listeners<HookEntry<E, T>>();
	hook: __Switch = new __Switch();
	constructor(public classname: string, public post: bool) {}
}

/**
 * An event's Ham Sandwich hooks: one registration per class and phase, made
 * on the first listener for it, so only the classes listened for reach the
 * plugin - as a touch's do - and switched off while it has none.
 */
class HamHooks<E, T> {
	private lists: HamList<E, T>[] = [];

	// The event's fire function comes with each listener, not here: a
	// module-level object holding it would compile the event's code into the
	// module's start, ahead of the natives it calls.
	constructor(private fn: i32) {}

	/** Adds a listener for this class, the hook registered when it is the class's first. */
	add(classname: string, post: bool, fire: (entries: HookEntries<E, T>, post: bool) => void, entry: HookEntry<E, T>): void {
		const list = this.find(classname, post) ?? this.hookClass(classname, post, fire);
		list.entries.push(entry);
		list.hook.set(true);
	}

	remove(classname: string, post: bool, fn: usize): void {
		const list = this.find(classname, post);
		if (list == null) return;
		unlisten<E, T>(list.entries, fn);
		list.hook.set(list.entries.count > 0);
	}

	private hookClass(classname: string, post: bool, fire: (entries: HookEntries<E, T>, post: bool) => void): HamList<E, T> {
		const list = new HamList<E, T>(classname, post);
		this.lists.push(list);
		const fired = (a: number, b: number, c: number, d: number): void => fire(list.entries, post);
		const classes = classname == EVERY_WEAPON ? __weaponClassnames() : [classname];
		for (let i = 0; i < classes.length; i++) __ham(this.fn, classes[i], fired, post, list.hook);
		return list;
	}

	private find(classname: string, post: bool): HamList<E, T> | null {
		for (let i = 0; i < this.lists.length; i++) {
			const list = this.lists[i];
			if (list.classname == classname && list.post == post) return list;
		}
		return null;
	}
}

/**
 * An async listener, called as a silent one: it runs up to its first await
 * and returns a Promise, and if that has settled with a value by then, the
 * value is the game's answer - as a plain listener's return is. After an
 * await it can answer nothing: the game has moved on.
 *
 * The wrapper is a copy of asyncAnswer with this object as its \`_env\`,
 * which the compiler hands over on every indirect call (__env, as closures
 * get theirs).
 * A plugin without async listeners compiles none of this.
 */
class AsyncListener {
	constructor(public listener: usize, public kind: i32, public post: bool) {}
}

function asyncListener(listener: usize, kind: i32, post: bool): usize {
	return __co_bindEnv(changetype<usize>(asyncAnswer), new AsyncListener(listener, kind, post));
}

function asyncAnswer(event: usize): void {
	// @ts-ignore: the compiler library's, unknown to the editor
	const self = changetype<AsyncListener>(__env);
	const settled = changetype<(event: usize) => PromiseBase>(self.listener)(event);
	if (self.kind == 0 || settled.__state != 1 || !settled.__hasValue) return;
	const cell = self.kind == 1 ? floatCell(reinterpret<f64>(settled.__bits))
		: self.kind == 2 ? (settled.__bits != 0 ? 1 : 0)
		: self.kind == 3 ? <i32>reinterpret<f64>(settled.__bits)
		: <i32>changetype<Entity>(settled.__ref).id;
	changetype<HookEvent>(event).__answer(cell, self.post);
}

${[...namedUsed.values()].map(namedBlock).join('\n\n')}

${classes.join('\n\n')}

/**
 * Every game event, by the name game.addEventListener takes - the event
 * it hands the listener. What an editor completes; the compiler reads it
 * through the same patch as ServerEventMap (runtime/patches).
 */
export interface GameEventMap {
${eventKeys.join('\n')}
}

/**
 * What a listener may return for each event: the game's answer type, or
 * void for one that answers nothing. Only the editor reads this - it is the
 * constraint on a listener's return type.
 */
export interface GameAnswerMap {
${answerKeys.join('\n')}
}

${tables.join('\n\n')}

/**
 * Adds a listener for the event E - game.addEventListener's hood. \`classname\`
 * picks the class an event of Ham Sandwich's is listened for on; "" is the
 * reapi chain's own.
 */
export function addGameListener<E, R>(listener: (event: E) => R, post: bool, classname: string): void {
${adds.join('\n')}
}

/** Takes a listener off again - game.removeEventListener's hood. */
export function removeGameListener<E, R>(listener: (event: E) => R, post: bool, classname: string): void {
	const fn = changetype<usize>(listener);
${removes.join('\n')}
}
`);

console.log(`as/hooks.ts: ${specs.length} game events (${specs.filter(spec => spec.hook).length} reapi hookchains, ${specs.filter(spec => spec.ham).length} Ham Sandwich functions); ${skipped.length} things skipped`);
if (process.argv.includes('--verbose')) {
	for (const s of skipped) console.log(`  ${s.hook}: ${s.what}`);
}
