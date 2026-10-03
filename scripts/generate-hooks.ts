import type { Text } from './docs/events';
import type { HamAnswer, HamFunction, HamKind } from './ham-functions';
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
	atype: string;
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
	atype: string;
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

		// A vector - `Float:vecSrc[3]` - is an address in the host plugin, where
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
		let atype = 'ATYPE_INTEGER';
		if (vector) {
			kind = 'vector';
			atype = 'ATYPE_VECTOR';
		} else if (isArray) {
			kind = 'string';
			atype = 'ATYPE_STRING';
		} else if (tag === 'Float') {
			kind = 'float';
			atype = 'ATYPE_FLOAT';
		} else if (tag === 'bool') {
			kind = 'bool';
			atype = 'ATYPE_BOOL';
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
		params.push({ name, kind, index, settable, atype, pawn: text, ...(named ? { named } : {}) });
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
	if (/^(?:int|BOOL|enum \w+)$/.test(type)) return { kind: 'int', atype: 'ATYPE_INTEGER', pawn: type };
	if (type === 'bool') return { kind: 'bool', atype: 'ATYPE_BOOL', pawn: type };
	if (type === 'float') return { kind: 'float', atype: 'ATYPE_FLOAT', pawn: type };
	const pointer = type.match(/^(C\w+) \*/);
	// reapi hands a class pointer back as the entity's index - its own docs say
	// "CGrenade * (Entity index of smokegrenade)" - and checks the type asked
	// for: ATYPE_CLASSPTR there failed with "incompatible type, expected
	// 'ATYPE_INTEGER'", the smoke throw handler died, and the frost grenade
	// lost its glow and trail.
	if (pointer) return { kind: classOf(pointer[1]), atype: 'ATYPE_INTEGER', pawn: type };
	if (/^(?:edict_t|Edict) \*/.test(type)) return { kind: 'Entity', atype: 'ATYPE_EDICT', pawn: type };
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
		Player: `return new Player(this.__cell(${n}));`,
		Weapon: `return new Weapon(this.__cell(${n}));`,
		Entity: `return new Entity(this.__cell(${n}));`,
	};
	// Written through the event, which knows whether reapi or Ham Sandwich
	// delivered it (HookEvent.__set). Only Ham Sandwich takes an entity back,
	// so only its own events have that setter.
	const set: Record<Kind, string> = {
		int: `this.__set(${n}, ${p.atype}, value);`,
		float: `this.__set(${n}, ${p.atype}, floatCell(value));`,
		bool: `this.__set(${n}, ${p.atype}, value ? 1 : 0);`,
		string: `this.__setText(${n}, value);`,
		damage: `this.__set(${n}, ${p.atype}, DAMAGE.maskOf(values));`,
		enum: `this.__set(${n}, ${p.atype}, ${fn}Cell(value, this.__cell(${n})));`,
		flags: `this.__set(${n}, ${p.atype}, ${family}.maskOf(values) | (this.__cell(${n}) & ${others}));`,
		use: `this.__set(${n}, ${p.atype}, max(USE_TYPES.indexOf(value), 0));`,
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
	const cell = `this.__resultCell(${r.atype})`;
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
		// reapi refuses to suppress a chain that returns something until it has
		// an answer: "Can't suppress original function call without new return
		// value set". A handler that only blocks has none, so blocking answers
		// the neutral value first - what the Pawn core did by hand before its
		// HC_SUPERCEDE, and what the port lost: protection let damage through.
		`\t${renderDoc(say(
			`Blocks the game's function; it answers ${r.kind === 'bool' ? 'false' : '0'}.\n\nPawn: \`HC_SUPERCEDE\`, \`HAM_SUPERCEDE\``,
			`Блокирует функцию игры; она отвечает ${r.kind === 'bool' ? 'false' : '0'}.\n\nPawn: \`HC_SUPERCEDE\`, \`HAM_SUPERCEDE\``,
		), '\t')}`,
		`\tpreventDefault(): void { this.__block(${r.atype}); }`,
	].join('\n');
}

/** How a handler's answer becomes the cell SetHookChainReturn takes. */
function answerCell(r: Result, value: string) {
	if (r.kind === 'float') return `floatCell(${value})`;
	if (r.kind === 'bool') return `${value} ? 1 : 0`;
	if (r.kind === 'int') return `<i32>${value}`;
	return `<i32>${value}.id`;
}

/** The listener's answer handed to the game, through the event: reapi's or Ham Sandwich's. */
function answerCall(r: Result, value: string) {
	if (r.kind === 'string') return `event.__answerText(${value}, post);`;
	if (r.kind === 'vector') return `event.__answerVector(${value}, post);`;
	return `event.__answer(${r.atype}, ${answerCell(r, value)}, post);`;
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

/**
 * What a reapi event's tooltip says of a server without reapi - plain HLDS:
 * what it does not give there (scripts/hlds-events.ts), or that nothing hears
 * it. An event heard fully says nothing.
 */
function withoutReapi(camel: string) {
	const heard = HEARD[camel];
	if (heard?.gaps) return say(`Without ReAPI (plain HLDS): ${heard.gaps.en}.`, `Без ReAPI (чистый HLDS): ${heard.gaps.ru}.`);
	if (heard) return '';
	return say('Without ReAPI (plain HLDS) nothing hears it.', 'Без ReAPI (чистый HLDS) его ничто не слышит.');
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

const HAM_KINDS: Record<HamKind, { kind: Kind; atype: string; pawn: (name: string) => string }> = {
	entity: { kind: 'Entity', atype: 'ATYPE_INTEGER', pawn: name => name },
	player: { kind: 'Player', atype: 'ATYPE_INTEGER', pawn: name => name },
	weapon: { kind: 'Weapon', atype: 'ATYPE_INTEGER', pawn: name => name },
	int: { kind: 'int', atype: 'ATYPE_INTEGER', pawn: name => name },
	float: { kind: 'float', atype: 'ATYPE_FLOAT', pawn: name => `Float:${name}` },
	bool: { kind: 'bool', atype: 'ATYPE_BOOL', pawn: name => `bool:${name}` },
	vector: { kind: 'vector', atype: 'ATYPE_VECTOR', pawn: name => `Float:${name}[3]` },
	string: { kind: 'string', atype: 'ATYPE_STRING', pawn: name => `${name}[]` },
	damage: { kind: 'damage', atype: 'ATYPE_INTEGER', pawn: name => name },
	use: { kind: 'use', atype: 'ATYPE_INTEGER', pawn: name => name },
};

const HAM_RESULTS: Record<Exclude<HamAnswer, 'none'>, Result> = {
	int: { kind: 'int', atype: 'ATYPE_INTEGER', pawn: 'Integer' },
	bool: { kind: 'bool', atype: 'ATYPE_BOOL', pawn: 'Integer' },
	float: { kind: 'float', atype: 'ATYPE_FLOAT', pawn: 'Float' },
	// ATYPE_EDICT stands for "an entity" to HookEvent: Ham Sandwich answers it with SetHamReturnEntity.
	entity: { kind: 'Entity', atype: 'ATYPE_EDICT', pawn: 'Entity' },
	string: { kind: 'string', atype: 'ATYPE_STRING', pawn: 'String' },
	vector: { kind: 'vector', atype: 'ATYPE_VECTOR', pawn: 'Vector' },
};

/** A Ham Sandwich function's arguments as fields: `this` first, then the rest, each writable. */
function hamParams(f: HamFunction): Param[] {
	const self = HAM_KINDS[f.target];
	return [
		{ name: f.target, kind: self.kind, index: 0, settable: false, atype: self.atype, pawn: 'this' },
		...f.params.map((param, i) => {
			const shape = HAM_KINDS[param.kind];
			return { name: param.name, kind: shape.kind, index: i + 1, settable: true, atype: shape.atype, pawn: shape.pawn(param.name) };
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
		ham,
		params: paramsOf(hook, constant, paramsLine),
		result: resultOf(hook, line(comment, 'Return type') || UNDOCUMENTED_RESULTS[constant] || ''),
		// An event Ham Sandwich delivers too is heard the same without reapi.
		summary: ham ? gameSummary(camel, comment) : sentences(gameSummary(camel, comment), withoutReapi(camel)),
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
 * When a listener goes to Ham Sandwich rather than reapi's chain: when it
 * names a class other than the chain's own, or the server has no reapi. A
 * weapon chain's own class is every weapon, so any class narrows it to Ham
 * Sandwich; a player chain's is "player".
 */
function toHam(ham: HamFunction) {
	return `(${ham.target === 'weapon' ? 'classname.length > 0' : 'classname.length > 0 && classname != "player"'}) || !__hasReapi()`;
}

/** The class Ham Sandwich hooks for a listener: the one named, or the chain's own - "player", or every weapon. */
function hamOwnClass(ham: HamFunction) {
	return `classname.length > 0 ? classname : ${ham.target === 'weapon' ? 'EVERY_WEAPON' : '"player"'}`;
}

/** The class an event reapi has no chain for is listened for on: the one named, a player's by default. */
function hamClass(ham: HamFunction) {
	return ham.target === 'player' ? 'classname.length > 0 ? classname : "player"' : 'classname';
}

/** The list a listener is taken off. */
function listOf(spec: EventSpec) {
	const { camel, hook, ham } = spec;
	const reapi = `post ? ${camel}Post : ${camel}Pre`;
	if (!ham) return reapi;
	if (!hook) return `${camel}Hams.listening(${hamClass(ham)}, post)`;
	return `${toHam(ham)} ? ${camel}Hams.listening(${hamOwnClass(ham)}, post) : ${reapi}`;
}

/** What a listener with a class it cannot take is told, instead of being added. */
function refusal(spec: EventSpec) {
	const { camel, hook, ham } = spec;
	if (!ham) return `\t\tif (classname.length > 0) { console.error("${camel} is not listened for by class: leave classname out"); return; }`;
	if (hook || ham.target === 'player') return '';
	const example = ham.target === 'weapon' ? 'weapon_knife' : 'info_target';
	return `\t\tif (classname.length == 0) { console.error("${camel} is about one class of entity, e.g. { classname: \\"${example}\\" }"); return; }`;
}

for (const spec of specs.sort((a, b) => a.camel.localeCompare(b.camel))) {
	const { camel, Name, hook, ham, params, result } = spec;
	const ours = GAME[camel];
	const fields = params.map(p => fieldOf(p, ours?.fields?.[p.name]));

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

	// The event a hook delivers is made here; the one a stock hook's backend
	// made goes through the same loop, Run, for each phase.
	const open = heard
		? [
				`function ${camel}Fire(entries: HookEntry<${Name}, ${T}>[], post: bool, ham: bool): void {`,
				`\tconst event = new ${Name}();`,
				`\tevent.__ham = ham;`,
				`\t${camel}Run(event, entries, post);`,
				`}`,
				`function ${camel}FireHlds(event: ${Name}, post: bool): void {`,
				`\tevent.__hlds = true;`,
				`\t${camel}Run(event, post ? ${camel}Post : ${camel}Pre, post);`,
				`}`,
				`let ${camel}HldsHooked = false;`,
				...(heard.post ? [`let ${camel}PostHldsHooked = false;`] : []),
				`function ${camel}Run(event: ${Name}, entries: HookEntry<${Name}, ${T}>[], post: bool): void {`,
			]
		: [
				`function ${camel}Fire(entries: HookEntry<${Name}, ${T}>[], post: bool, ham: bool): void {`,
				`\tconst event = new ${Name}();`,
				`\tevent.__ham = ham;`,
			];
	const fire = result
		? [
				...open,
				`\t// A copy: a listener that removes itself must not make the next one skip.`,
				`\tconst list = entries.slice(0);`,
				`\tfor (let i = 0; i < list.length; i++) {`,
				`\t\tconst silent = list[i].silent;`,
				`\t\tif (silent) { silent(event); continue; }`,
				`\t\tconst answer = list[i].answer!(event);`,
				`\t\t${answerCall(result, 'answer')}`,
				`\t\t// Answered: in a pre hook the game does not run and nobody after asks.`,
				`\t\tif (!post) return;`,
				`\t}`,
				`}`,
			]
		: [
				...open,
				`\tconst list = entries.slice(0);`,
				`\tfor (let i = 0; i < list.length; i++) list[i].silent!(event);`,
				`}`,
			];

	tables.push([
		...(hook
			? [
					`const ${camel}Pre: HookEntry<${Name}, ${T}>[] = [];`,
					`const ${camel}Post: HookEntry<${Name}, ${T}>[] = [];`,
					`let ${camel}PreHooked = false;`,
					`let ${camel}PostHooked = false;`,
				]
			: []),
		...fire,
		...(ham ? [`const ${camel}Hams = new HamHooks<${Name}, ${T}>(${ham.ham});`] : []),
		...(hook
			? [
					`function ${camel}FirePre(a: number, b: number, c: number, d: number) { ${camel}Fire(${camel}Pre, false, false); }`,
					`function ${camel}FirePost(a: number, b: number, c: number, d: number) { ${camel}Fire(${camel}Post, true, false); }`,
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

	// reapi's chain is registered on the first listener; a Ham Sandwich hook
	// on the first listener for its class (HamHooks).
	const reapiHook = hook
		? [
				`\t\tif (post && !${camel}PostHooked) { ${camel}PostHooked = true; hook("${hook}", ${camel}FirePost, true); }`,
				`\t\tif (!post && !${camel}PreHooked) { ${camel}PreHooked = true; hook("${hook}", ${camel}FirePre, false); }`,
			]
		: [];
	const guard = refusal(spec);
	// A chain of ReGameDLL's or ReHLDS's own: without reapi nothing delivers it, and the console says so once.
	const reapiOnly = hook && !ham && !heard ? `\t\tif (!__hasReapi()) { __sayOnce("${camel} needs ReAPI, which this server does not have: its listeners are never called"); return; }` : '';
	// One a stock hook hears instead: its backend is registered on the first listener, its post one on the first post listener.
	const hlds = heard
		? [
				`\t\tif (!__hasReapi()) {`,
				`\t\t\tif (!${camel}HldsHooked) { ${camel}HldsHooked = true; ${camel}Hlds(${camel}FireHlds); }`,
				...(heard.post ? [`\t\t\tif (post && !${camel}PostHldsHooked) { ${camel}PostHldsHooked = true; ${camel}PostHlds(${camel}FireHlds); }`] : []),
				`\t\t\t(post ? ${camel}Post : ${camel}Pre).push(entry);`,
				`\t\t\treturn;`,
				`\t\t}`,
			]
		: [];

	adds.push([
		`\tif (idof<E>() == idof<${Name}>()) {`,
		...(guard ? [guard] : []),
		...(reapiOnly ? [reapiOnly] : []),
		`\t\tconst entry = new HookEntry<${Name}, ${T}>();`,
		`\t\tif (isVoid<R>()) entry.silent = changetype<(event: ${Name}) => void>(listener);`,
		`\t\t// @ts-ignore: TypeScript does not know R is a Promise here; the compiler checks it`,
		`\t\telse if (isReference<R>() && isDefined(changetype<R>(0).__hasValue)) {`,
		...(promiseGuard ? [promiseGuard] : []),
		`\t\t\tentry.silent = changetype<(event: ${Name}) => void>(asyncListener(changetype<usize>(listener), ${answerKind(result)}, ${result ? result.atype : 0}, post));`,
		`\t\t\tentry.source = changetype<usize>(listener);`,
		`\t\t}`,
		...answerBranch,
		...(ham && hook ? [`\t\tif (${toHam(ham)}) { ${camel}Hams.listen(${hamOwnClass(ham)}, post, ${camel}Fire).push(entry); return; }`] : []),
		...(ham && !hook ? [`\t\t${camel}Hams.listen(${hamClass(ham)}, post, ${camel}Fire).push(entry);`] : []),
		...hlds,
		...reapiHook,
		...(hook ? [`\t\t(post ? ${camel}Post : ${camel}Pre).push(entry);`] : []),
		`\t\treturn;`,
		`\t}`,
	].join('\n'));

	removes.push([
		`\tif (idof<E>() == idof<${Name}>()) {`,
		`\t\tunlisten<${Name}, ${T}>(${listOf(spec)}, fn);`,
		`\t\treturn;`,
		`\t}`,
	].join('\n'));
}

// A touch between two classes is no hookchain: the engine module's
// register_touch, filtered by class before it reaches the plugin
// (Game.addEventListener in as/facade.ts, TouchEvent there).
eventKeys.push(`\t${renderDoc(`${docText(pick(GAME.touch.summary, DOCS_LANG))}\n\nPawn: \`register_touch\``, '\t')}`, `\ttouch: TouchEvent;`);
answerKeys.push(`\ttouch: void;`);

writeFileSync('./as/hooks.ts', `// GENERATED by scripts/generate-hooks.ts — do not edit
// Source: includes/reapi_gamedll_const.inc, includes/reapi_engine_const.inc,
// ham_const.inc (scripts/ham-functions.ts)
//
// Every game event: a reapi hookchain, a Ham Sandwich function, or both. Its
// arguments are fields of the type the include documents - an entity is a
// Player, a Weapon or an Entity - what the handler returns is the game's
// answer, and blocking without one is \`event.preventDefault()\`. Listen with
// \`game.addEventListener("takeDamage", ...)\`.
import { Call, Player, RoundWinner, Team, TouchEvent, UseType, Vector, arg, argText, cellFloat, floatCell, handled, hook, __ham, __hasReapi, __outcome, __nativeVector, __setNativeVector, __sayOnce, __weaponClassnames } from "./facade";
import { Entity, HitGroup, Weapon, WeaponKind } from "./entities";
import {
	GetHookChainReturn, SetHookChainArg, SetHookChainReturn, NATIVE_SetHookChainArg,
	GetHamReturnEntity, GetHamReturnFloat, GetHamReturnInteger, GetHamReturnString, GetHamReturnVector,
	SetHamParamEntity, SetHamParamFloat, SetHamParamInteger, SetHamParamString, SetHamParamVector,
	SetHamReturnEntity, SetHamReturnFloat, SetHamReturnInteger, SetHamReturnString, SetHamReturnVector
} from "./natives";
import {
	ATYPE_BOOL, ATYPE_CLASSPTR, ATYPE_EDICT, ATYPE_FLOAT, ATYPE_INTEGER, ATYPE_STRING, ATYPE_VECTOR, HC_BREAK, HAM_OVERRIDE, HAM_SUPERCEDE,
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

// Ham Sandwich's by-address answers, read into one cell.
const hamOut = new StaticArray<i32>(1);

/** What every game event can do. */
export class HookEvent {
	/** @hidden Ham Sandwich delivered the event rather than reapi: the arguments and the answer go back its way. */
	__ham: bool = false;

	/**
	 * @hidden A stock hook's backend made the event, on a server without reapi
	 * (as/hlds.ts): a field is what the backend gave, 0 or empty where it gave
	 * nothing, and what a listener asks of the game - blocking it, answering,
	 * a field written - waits for the backend, which gives the game what it can.
	 */
	__hlds: bool = false;
	/** @hidden What the listeners asked of the game, on a stock hook's event. */
	__prevented: bool = false;
	__answered: bool = false;
	__answerCell: i32 = 0;
	__changed: bool = false;

	// What the handler wrote, by argument: reapi hands a hook the arguments
	// it was called with, and SetHookChainArg changes what the chain goes on
	// with but not what arg() reads. Without these, \`event.damage = 1.0\`
	// did its job and \`event.damage\` still said 65 - measured on the server.
	private written: Map<i32, i32> = new Map<i32, i32>();
	private writtenText: Map<i32, string> = new Map<i32, string>();
	private writtenVector: Map<i32, Vector> = new Map<i32, Vector>();

	/** An argument as the handler sees it now: its own write, or what came in. */
	protected __cell(index: i32): i32 {
		return this.written.has(index) ? this.written.get(index) : this.__hlds ? 0 : arg(index);
	}

	protected __text(index: i32): string {
		return this.writtenText.has(index) ? this.writtenText.get(index) : this.__hlds ? "" : argText(index);
	}

	protected __vector(index: i32): Vector {
		return this.writtenVector.has(index) ? this.writtenVector.get(index) : this.__hlds ? new Vector() : __nativeVector(index);
	}

	/** @hidden A field's value from a stock hook's backend, by the argument's place; -1 is the game's answer. */
	__give(index: i32, cell: i32): void {
		this.written.set(index, cell);
	}

	/** @hidden */
	__giveText(index: i32, value: string): void {
		this.writtenText.set(index, value);
	}

	/** @hidden */
	__giveVector(index: i32, value: Vector): void {
		this.writtenVector.set(index, value);
	}

	/** Writes a number argument back: \`atype\` says how it is read, a float as its bits. */
	protected __set(index: i32, atype: i32, cell: i32): void {
		if (this.__hlds) this.__changed = true;
		else if (!this.__ham) SetHookChainArg(index + 1, atype, cell);
		else if (atype == ATYPE_FLOAT) SetHamParamFloat(index + 1, cellFloat(cell));
		else SetHamParamInteger(index + 1, cell);
		this.written.set(index, cell);
	}

	protected __setText(index: i32, value: string): void {
		if (this.__hlds) this.__changed = true;
		else if (this.__ham) SetHamParamString(index + 1, value);
		else new Call(NATIVE_SetHookChainArg).num(index + 1).num(ATYPE_STRING).str(value).run();
		this.writtenText.set(index, value);
	}

	// Only Ham Sandwich takes an entity back; reapi's events have no setter for one.
	protected __setEntity(index: i32, id: number): void {
		SetHamParamEntity(index + 1, id);
		this.written.set(index, <i32>id);
	}

	// SetHookChainArg takes no vector: reapi hands one over as an array it
	// copies back into the game's once the listener returns, so it is
	// written where it lies.
	protected __setVector(index: i32, value: Vector): void {
		if (this.__hlds) this.__changed = true;
		else if (this.__ham) SetHamParamVector(index + 1, value);
		else __setNativeVector(index, value);
		this.writtenVector.set(index, value);
	}

	/** The game's answer as a cell - ATYPE_EDICT is an entity. */
	protected __resultCell(atype: i32): i32 {
		if (this.__hlds) return this.written.has(-1) ? this.written.get(-1) : 0;
		if (!this.__ham) return GetHookChainReturn(atype);
		if (atype == ATYPE_FLOAT) GetHamReturnFloat(changetype<i32>(hamOut));
		else if (atype == ATYPE_EDICT) GetHamReturnEntity(changetype<i32>(hamOut));
		else GetHamReturnInteger(changetype<i32>(hamOut));
		return hamOut[0];
	}

	protected __resultText(): string {
		return GetHamReturnString();
	}

	protected __resultVector(): Vector {
		const value = new Vector();
		GetHamReturnVector(value);
		return value;
	}

	/** @hidden A listener's answer: the game's function's result, and in a pre listener the function blocked. */
	__answer(atype: i32, cell: i32, post: bool): void {
		if (this.__hlds) {
			this.__answered = true;
			this.__answerCell = cell;
			return;
		}
		if (!this.__ham) {
			SetHookChainReturn(atype, cell);
			if (!post) handled();
			return;
		}
		if (atype == ATYPE_FLOAT) SetHamReturnFloat(cellFloat(cell));
		else if (atype == ATYPE_EDICT) SetHamReturnEntity(cell);
		else SetHamReturnInteger(cell);
		__outcome(post ? HAM_OVERRIDE : HAM_SUPERCEDE);
	}

	/** @hidden */
	__answerText(value: string, post: bool): void {
		SetHamReturnString(value);
		__outcome(post ? HAM_OVERRIDE : HAM_SUPERCEDE);
	}

	/** @hidden */
	__answerVector(value: Vector, post: bool): void {
		SetHamReturnVector(value);
		__outcome(post ? HAM_OVERRIDE : HAM_SUPERCEDE);
	}

	/**
	 * Blocks a function that answers: reapi wants the answer set first -
	 * "Can't suppress original function call without new return value set" -
	 * so it is the neutral one.
	 */
	protected __block(atype: i32): void {
		if (this.__hlds) this.__prevented = true;
		else if (this.__ham) __outcome(HAM_SUPERCEDE);
		else {
			SetHookChainReturn(atype, atype == ATYPE_FLOAT ? floatCell(0.0) : 0);
			handled();
		}
	}

	${renderDoc(say(
		'Blocks the game\'s function this event is about. For one that answers, return the answer from the handler instead; this is for blocking without one.\n\nPawn: `HC_SUPERCEDE`, `HAM_SUPERCEDE`',
		'Блокирует функцию игры, о которой событие. Если она ждёт ответа, верните его из обработчика; это — блокировка без ответа.\n\nPawn: `HC_SUPERCEDE`, `HAM_SUPERCEDE`',
	), '\t')}
	preventDefault() {
		if (this.__hlds) this.__prevented = true;
		else if (this.__ham) __outcome(HAM_SUPERCEDE);
		else handled();
	}

	${renderDoc(say(
		'Stops the event: the game\'s function does not run, and neither do other plugins\' listeners where the game can stop them. Rarely what is wanted; preventDefault() usually is.\n\nPawn: `HC_BREAK`',
		'Останавливает событие: функция игры не выполняется, и обработчики других плагинов тоже, где игра умеет их остановить. Нужно редко — обычно подходит preventDefault().\n\nPawn: `HC_BREAK`',
	), '\t')}
	stopImmediatePropagation() {
		// Ham Sandwich calls every plugin's hook whatever one answers.
		if (this.__hlds) this.__prevented = true;
		else __outcome(this.__ham ? HAM_SUPERCEDE : HC_BREAK);
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

/** Takes a listener off a list: the function it was added as, or the async one behind a wrapper. */
function unlisten<E, T>(list: HookEntry<E, T>[], fn: usize): void {
	for (let i = 0; i < list.length; i++) {
		const entry = list[i];
		if (changetype<usize>(entry.silent) == fn || changetype<usize>(entry.answer) == fn || entry.source == fn) {
			list.splice(i, 1);
			return;
		}
	}
}

// The class of a weapon chain's listener without one, on a server without
// reapi: Ham Sandwich hooks the function on every weapon's class.
const EVERY_WEAPON = "weapon_*";

/** The listeners of one class's Ham Sandwich hook, pre or post. */
class HamList<E, T> {
	entries: HookEntry<E, T>[] = [];
	constructor(public classname: string, public post: bool) {}
}

/**
 * An event's Ham Sandwich hooks: one registration per class and phase, made
 * on the first listener for it, so only the classes listened for reach the
 * plugin - as a touch's do.
 */
class HamHooks<E, T> {
	private lists: HamList<E, T>[] = [];

	// The event's fire function comes with each listener, not here: a
	// module-level object holding it would compile the event's code into the
	// module's start, ahead of the natives it calls.
	constructor(private fn: i32) {}

	/** The list a listener for this class goes to, the hook registered when it is new. */
	listen(classname: string, post: bool, fire: (entries: HookEntry<E, T>[], post: bool, ham: bool) => void): HookEntry<E, T>[] {
		const found = this.find(classname, post);
		if (found != null) return found.entries;

		const list = new HamList<E, T>(classname, post);
		this.lists.push(list);
		const fired = (a: number, b: number, c: number, d: number): void => fire(list.entries, post, true);
		const classes = classname == EVERY_WEAPON ? __weaponClassnames() : [classname];
		for (let i = 0; i < classes.length; i++) __ham(this.fn, classes[i], fired, post);
		return list.entries;
	}

	/** The list the listeners for this class are on; none there is an empty one. */
	listening(classname: string, post: bool): HookEntry<E, T>[] {
		const found = this.find(classname, post);
		return found != null ? found.entries : [];
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
	constructor(public listener: usize, public kind: i32, public atype: i32, public post: bool) {}
}

function asyncListener(listener: usize, kind: i32, atype: i32, post: bool): usize {
	return __co_bindEnv(changetype<usize>(asyncAnswer), new AsyncListener(listener, kind, atype, post));
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
	changetype<HookEvent>(event).__answer(self.atype, cell, self.post);
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
