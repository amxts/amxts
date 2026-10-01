// Flag families as string literal types, and the array that stands for a mask.
//
//   bun scripts/generate-flags.ts        (after `bun run generate`)
//
// A Pawn plugin sets a HUD element hidden with `flags |= HIDEHUD_MONEY` and
// asks whether a button is held with `(buttons & IN_JUMP) != 0`. A plugin here
// writes `player.hideHud = ["Money", "Timer"]` and
// `player.buttons.includes("Jump")`.
//
// Each family is a union of string literals, which is what a TypeScript
// developer writes for a closed set of names: the editor completes them and
// `bun run check` refuses a misspelled one. AssemblyScript reads the union as
// `string` (a compiler patch, see runtime/patches), and the list below turns
// the names into bits.
//
// The values are read from as/constants.ts, which scripts/generate-wasm-api.ts
// has already resolved from the includes, so there is one source of truth for
// what HIDEHUD_MONEY is. Only single bits become members: a value that is zero
// or several bits at once (DMG_GIB_CORPSE) is a mask, not a flag, and is
// listed in a comment instead.
//
// Output: as/flags.ts
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * One line per family: the constants' prefix, the type's name. `names` gives
 * a member a name of its own where the one made of its suffix reads badly
 * (WPNSTATE_M4A1_SILENCED); `skip` drops a constant that is another's alias
 * (PFLAG_ONSWING is PFLAG_ONLADDER's bit).
 */
const FAMILIES: { prefix: string; name: string; about: string; names?: Record<string, string>; skip?: string[] }[] = [
	{ prefix: 'HIDEHUD_', name: 'HideHud', about: 'Parts of the HUD a player does not see - m_iHideHUD.' },
	{ prefix: 'IN_', name: 'Button', about: 'Buttons a player holds - var_button, var_oldbuttons.' },
	{ prefix: 'EF_', name: 'Effect', about: 'Visual effects on an entity - var_effects.' },
	{ prefix: 'FL_', name: 'EntityFlag', about: 'Engine flags of an entity - var_flags.' },
	{ prefix: 'DMG_', name: 'Damage', about: 'Kinds of damage - the damage type a hook receives.' },
	{ prefix: 'ADMIN_', name: 'Access', about: 'What an admin may do - get_user_flags, users.ini letters.' },
	{
		prefix: 'SCORE_STATUS_',
		name: 'ScoreStatus',
		about: 'What the scoreboard shows beside a player - the ScoreAttrib message: dead, the bomb, the VIP, a defuse kit.',
		names: { SCORE_STATUS_DEFKIT: 'DefuseKit' },
	},
	{
		prefix: 'WPNSTATE_',
		name: 'WeaponState',
		about: 'Modes a weapon is in - m_iWeaponState: a silencer on, burst fire, the shield drawn.',
		names: {
			WPNSTATE_USP_SILENCED: 'UspSilenced',
			WPNSTATE_GLOCK18_BURST_MODE: 'Glock18Burst',
			WPNSTATE_M4A1_SILENCED: 'M4a1Silenced',
			WPNSTATE_ELITE_LEFT: 'EliteLeft',
			WPNSTATE_FAMAS_BURST_MODE: 'FamasBurst',
			WPNSTATE_SHIELD_DRAWN: 'ShieldDrawn',
		},
	},
	{
		prefix: 'PFLAG_',
		name: 'PhysicsFlag',
		about: 'The physics state of a player - m_afPhysicsFlags: on a ladder, on a train, ducking.',
		names: { PFLAG_ONLADDER: 'OnLadder', PFLAG_ONTRAIN: 'OnTrain', PFLAG_ONBARNACLE: 'OnBarnacle' },
		skip: ['PFLAG_ONSWING'],
	},
];

/**
 * Words the suffixes are made of, so FL_ONGROUND is `OnGround` rather than
 * `Onground`. A suffix that cannot be split into these is kept as one word.
 */
const WORDS = new Set(`
	on ground partial water jump fake client always think base velocity monster clip train world
	brush custom entity kill me skip local host no target god mode in move left right bright field
	muzzle flash light dim inv interp draw force visibility owner slerp follow keep render never gib
	drown recover slow burn freeze energy beam nerve gas observer immune slime lava flashlight crosshair
`.split(/\s+/).filter(Boolean));

/** A suffix part split into words - the fewest that cover it - or null. */
function words(part: string): string[] | null {
	const text = part.toLowerCase();
	const best: (string[] | null)[] = [[]];

	for (let end = 1; end <= text.length; end++) {
		best[end] = null;
		for (let start = 0; start < end; start++) {
			const before = best[start];
			const word = text.slice(start, end);
			if (!before || !WORDS.has(word)) continue;
			if (!best[end] || before.length + 1 < best[end]!.length) best[end] = [...before, word];
		}
	}

	return best[text.length] ?? null;
}

const capital = (word: string) => word[0].toUpperCase() + word.slice(1).toLowerCase();

/** HIDEHUD_OBSERVER_CROSSHAIR -> ObserverCrosshair, IN_ATTACK2 -> Attack2. */
function memberName(suffix: string): string {
	return suffix.split('_').filter(Boolean).map(part => (words(part) ?? [part]).map(capital).join('')).join('');
}

const isSingleBit = (value: number) => value !== 0 && (value & (value - 1)) === 0;

const constants = new Map<string, number>();
for (const m of readFileSync('./as/constants.ts', 'utf8').matchAll(/^export const (\w+): i32 = (-?\d+);/gm)) {
	constants.set(m[1], Number(m[2]));
}

const blocks: string[] = [];
const summary: string[] = [];

for (const family of FAMILIES) {
	const names: string[] = [];
	const bits: string[] = [];
	const skipped: string[] = [];

	for (const [constant, value] of constants) {
		if (!constant.startsWith(family.prefix) || family.skip?.includes(constant)) continue;

		if (!isSingleBit(value >>> 0)) {
			skipped.push(`${constant} = ${value}`);
			continue;
		}

		const name = family.names?.[constant] ?? memberName(constant.slice(family.prefix.length));
		const shift = Math.log2(value >>> 0);
		names.push(name);
		bits.push(`1 << ${shift}`);
	}

	const listName = family.name.replace(/[A-Z]/g, (c, i) => (i ? '_' : '') + c).toUpperCase();

	blocks.push([
		`/** ${family.about} */`,
		`export type ${family.name} =`,
		`${names.map(n => `\t| "${n}"`).join('\n')};`,
		...(skipped.length ? [`// Not single bits, so not names: ${skipped.join(', ')}.`] : []),
		``,
		`/** The ${family.name} names and their bits, for the hood. */`,
		`export const ${listName} = new FlagFamily(`,
		`\t[${names.map(n => `"${n}"`).join(', ')}],`,
		`\t[${bits.join(', ')}]`,
		`);`,
	].join('\n'));

	summary.push(`${family.name}: ${names.length}${skipped.length ? ` (skipped ${skipped.join(', ')})` : ''}`);
}

const HOOD = `
// ---------------------------------------------------------------- the list

/** A family's names and the bit each stands for, in the same order. */
export class FlagFamily {
	constructor(public names: string[], public bits: i32[]) {}

	bitOf(name: string): i32 {
		const at = this.names.indexOf(name);
		return at < 0 ? 0 : unchecked(this.bits[at]);
	}

	/** The names set in a mask. */
	namesOf(mask: i32): string[] {
		const list: string[] = [];
		for (let i = 0; i < this.bits.length; i++) {
			if ((mask & unchecked(this.bits[i])) != 0) list.push(unchecked(this.names[i]));
		}
		return list;
	}

	/** Every bit the family names, as one mask. */
	get all(): i32 {
		let mask = 0;
		for (let i = 0; i < this.bits.length; i++) mask |= unchecked(this.bits[i]);
		return mask;
	}

	/** A list of names as the mask Pawn wants. */
	maskOf<T>(names: T[]): i32 {
		let mask = 0;
		for (let i = 0; i < names.length; i++) mask |= this.bitOf(<string>unchecked(names[i]));
		return mask;
	}
}

/**
 * Where a mask lives: an entvar, a member, a hookchain argument.
 *
 * A FlagList holds the entity and field it came from as one of these, and
 * \`push\` goes back through it.
 */
export abstract class FlagStore {
	abstract read(): i32;
	abstract write(mask: i32): void;
}

/** A mask in an entvar - var_flags, var_effects, var_button - at its offset in entvars_t. */
export class EntvarFlags extends FlagStore {
	constructor(private entity: i32, private offset: i32) { super(); }
	read(): i32 { return __entvarCell(this.entity, this.offset); }
	write(mask: i32): void { __setEntvarCell(this.entity, this.offset, mask); }
}

/** A mask in a game member - m_iHideHUD - by its place in entities.ts's member table. */
export class MemberFlags extends FlagStore {
	constructor(private entity: i32, private member: i32) { super(); }
	read(): i32 { return __memberCell(this.entity, this.member); }
	write(mask: i32): void { __setMemberCell(this.entity, this.member, mask); }
}

/**
 * The flags a mask holds, as an array of names.
 *
 * \`push\` sets the bit where the mask lives as well, so
 * \`player.hideHud.push("Money")\` hides the money. Everything else is a plain
 * array: \`includes\`, \`filter\`, \`length\`, a for loop. To take flags away,
 * assign the array back - \`player.hideHud = player.hideHud.filter(...)\`.
 */
export class FlagList<T> extends Array<T> {
	store: FlagStore | null = null;
	family: FlagFamily | null = null;

	push(value: T): i32 {
		const store = this.store;
		const family = this.family;
		if (store && family) store.write(store.read() | family.bitOf(<string>value));
		return super.push(value);
	}
}

/** The names set in the mask \`store\` holds now, as a list that writes back. */
export function flagList<T>(store: FlagStore, family: FlagFamily): FlagList<T> {
	const list = new FlagList<T>();
	const names = family.namesOf(store.read());
	for (let i = 0; i < names.length; i++) list.push(<T>unchecked(names[i]));
	// Only now: building the list must not write the bits it just read.
	list.store = store;
	list.family = family;
	return list;
}
`;

writeFileSync('./as/flags.ts', `// GENERATED by scripts/generate-flags.ts — do not edit
// Source: as/constants.ts
//
// Flag families as string literal types, and FlagList - the array a plugin
// sees where Pawn has a bit mask.
import { __entvarCell, __setEntvarCell, __memberCell, __setMemberCell } from "./entities";

${HOOD}
${blocks.join('\n\n')}
`);

console.log(`as/flags.ts: ${summary.join('; ')}`);
