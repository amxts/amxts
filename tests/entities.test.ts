import { readFileSync } from 'node:fs';
// as/entities.ts is generated from reapi's own field docs. These are fields
// whose types are known for certain; if the generator misreads a "Get params"
// line, one of them changes type and the check fails. var_rendermode is here
// on purpose: written as a float, it is how a glow once never appeared.
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';

import { ENTITY_FIELDS } from '../scripts/docs/entities';

const source = readFileSync('as/entities.ts', 'utf8');

function typeOf(name: string) {
	const m = source.match(new RegExp(`\\tget ${name}\\(\\): ([\\w\\[\\]]+)`));
	return m ? m[1] : null;
}

// The module reads a field where the game keeps it: an entvar by its offset,
// a member by its place in the file's member table. Both lists name reapi's
// field: `// var_gravity 284`, `"CBasePlayer", "m_iAccount", // m_iAccount`.
const entvarAt = new Map([...source.matchAll(/^\/\/ (var_\w+) (\d+)/gm)].map(m => [m[2], m[1]]));
const members = [...source.matchAll(/^\t"\w+", "\w+", \/\/ (\w+)$/gm)].map(m => m[1]);

/** The reapi field an access reads: `entvarCell(this.id, 284)` is var_gravity, `memberCell(this.id, 3)` the table's fourth. */
function fieldOf(access: string) {
	const entvar = access.match(/(?:entvar\w*|Entvar\w*)\(this\.id, (\d+)/);
	if (entvar) return entvarAt.get(entvar[1]) ?? null;
	const member = access.match(/(?:member\w*|Member\w*)\(this\.id, (\d+)|\b(?:gameCell|regameCell)\((\d+)/);
	if (member) return members[Number(member[1] ?? member[2])] ?? null;
	// The game's name is read where every server keeps it, not as a member.
	if (access.includes('regameText("gameName"')) return 'm_GameDesc';
	const named = access.match(/\b(var_\w+|m_\w+|EV_SZ_\w+)\b/);
	return named ? named[1].replace(/^EV_SZ_/, 'var_') : null;
}

/** The reapi field a getter reads; a string entvar goes through EV_SZ_<name>. */
function reapiOf(name: string) {
	const m = source.match(new RegExp(`\\tget ${name}\\(\\)[^\\n]*(?:\\n\\t\\t[^\\n]*)*`));
	return m ? fieldOf(m[0]) : null;
}

test.each([
	['gravity', 'var_gravity', 'number'],
	['origin', 'var_origin', 'Vector'],
	['classname', 'var_classname', 'string'],
	['renderMode', 'var_rendermode', 'RenderMode'],
	['takeDamage', 'var_takedamage', 'TakeDamage'],
	['observerMode', 'var_iuser1', 'ObserverMode'],
	['iuser1', 'var_iuser1', 'number'],
	['weapons', 'var_weapons', 'WeaponKind[]'],
	['physicsFlags', 'm_afPhysicsFlags', 'PhysicsFlag[]'],
	['hideHud', 'm_iHideHUD', 'HideHud[]'],
	['flags', 'var_flags', 'EntityFlag[]'],
	['nightVisionOn', 'm_bNightVisionOn', 'boolean'],
	['slowdown', 'm_flVelocityModifier', 'number'],
])('%s is %s as %s', (name: string, reapi: string, type: string) => {
	expect(reapiOf(name)).toBe(reapi);
	expect(typeOf(name)).toBe(type);
});

// An enum field's union is its names and "unknown"; the getter switches on
// the engine's number, the setter compares names back.
test('an enum field is a union of names: MOVETYPE_NOCLIP is "noclip"', () => {
	expect(source).toMatch(/export type MoveType =[\s\S]*?\| "noclip"[\s\S]*?\| "unknown";/);
	expect(source).toContain('case 8: return "noclip";');
	expect(source).toContain('if (name == "noclip") return 8;');
	expect(source).toContain('case -5: return "lava";');
	expect(source).toContain('case -1: return "none";');
});

test('hand-written Player properties are not generated', () => {
	for (const name of ['frags', 'team', 'deaths', 'name']) expect(typeOf(name)).toBeNull();
});

// Every entity's health is pev->health; Player's whole number overrides it.
// A player's fov is his m_iFOV, over Entity's pev->fov, and writes both.
test('health is Entity\'s; a player\'s fov is m_iFOV, written with pev->fov', () => {
	expect(reapiOf('health')).toBe('var_health');
	expect(reapiOf('fov')).toBe('var_fov');
	const fov = members.indexOf('m_iFOV');
	expect(source).toContain(`\tget fov(): number { return memberCell(this.id, ${fov}); }`);
	expect(source).toContain(`\t\tsetMemberCell(this.id, ${fov}, <i32>value);\n\t\tsetEntvarCell(this.id, 532, <i32>floatCell(value));`);
	expect(entvarAt.get('532')).toBe('var_fov');
});

// The weapon: CBasePlayerItem and CBasePlayerWeapon members, with m_Weapon_
// dropped from the names and pointers read as the object they point at.
function weaponSource() {
	const at = source.indexOf('export class Weapon extends Entity');
	return at < 0 ? '' : source.slice(at);
}

test.each([
	['clip', 'm_Weapon_iClip', 'number'],
	['nextPrimaryAttack', 'm_Weapon_flNextPrimaryAttack', 'number'],
	['nextSecondaryAttack', 'm_Weapon_flNextSecondaryAttack', 'number'],
])('Weapon.%s is %s as %s', (name: string, reapi: string, type: string) => {
	const weapon = weaponSource();
	expect(weapon).toContain(`(this.id, ${members.indexOf(reapi)})`);
	expect(weapon).toContain(`\tget ${name}(): ${type} {`);
});

test('pointers are objects: activeItem is a Weapon, a weapon knows its player', () => {
	expect(source).toMatch(/\tget activeItem\(\): Weapon \| null \{/);
	expect(weaponSource()).toMatch(/\tget player\(\): Player \| null \{/);
	expect(weaponSource()).toMatch(/\tget next\(\): Weapon \| null \{/);
});

test('the game rules name what they hold: the bomb carrier is a Player, the VIP zone a name', () => {
	expect(source).toMatch(/\tget bomber\(\): Player \| null \{/);
	expect(source).toMatch(/\tget mapHasVipSafetyZone\(\): VipSafetyZone \{/);
	expect(source).toMatch(/export type VipSafetyZone =\n\t\| "notChecked"\n\t\| "yes"\n\t\| "no"\n\t\| "unknown";/);
});

test('an action answers what the game\'s function answers', () => {
	expect(source).toMatch(/\taddItem\(item: Weapon, options: ActionOptions = \{\}\): bool \{/);
	expect(source).toMatch(/\tremoveItem\(item: Weapon, options: ActionOptions = \{\}\): bool \{/);
	// CBasePlayerItem::Holster is void: nothing comes back to read.
	expect(weaponSource()).toMatch(/\tholster\(options: ActionOptions = \{\}\): void \{/);
});

test('kind is a name: WEAPON_KNIFE is "knife"', () => {
	expect(source).toContain('case 29: return "knife";');
	expect(source).toMatch(/export type WeaponKind =[\s\S]*\| "knife"/);
	expect(weaponSource()).toMatch(/\tget kind\(\): WeaponKind \{/);
});

test('a player lists every weapon he carries', () => {
	expect(source).toMatch(/\tget items\(\): Weapon\[\] \{/);
});

// A vector reads as a Vector and is written as any three numbers, so a literal
// `[0.0, 0.0, 0.0]` still assigns.
test('a vector is set from number[]', () => {
	expect(source).toContain('\tset origin(value: number[]) {');
});

// Tooltips come from scripts/docs/entities.ts, with the engine's name on a
// last line of their own (code-style rule 30). The generated file
// is in whichever language AMXTS_DOCS_LANG picks, so the check is on what is
// the same in both.
function docOf(name: string) {
	const m = source.match(new RegExp(`/\\*\\*\\n((?:\\t \\*[^\\n]*\\n)+)\\t \\*/\\n\\tget ${name}\\(`));
	return m ? m[1].replace(/^\t \* ?/gm, '') : null;
}

test('a field\'s tooltip says what it is, then the engine name on its last line', () => {
	expect(docOf('gravity')).toMatch(/0\.5[\s\S]*\n\nPawn: `pev->gravity`\n$/);
	expect(docOf('iuser4')).toMatch(/\n\nPawn: `pev->iuser4`\n$/);
	expect(docOf('slowdown')).toMatch(/\n\nPawn: `CBasePlayer::m_flVelocityModifier`\n$/);
	expect(docOf('clip')).toContain('\n\nPawn: `CBasePlayerWeapon::m_iClip` (reapi `m_Weapon_iClip`)');
	// An entry whose numbers are an engine constant family names it after the field.
	expect(docOf('renderMode')).toMatch(/\n\nPawn: `pev->rendermode`, `kRender\*`\n$/);
});

test('every entry in scripts/docs/entities.ts is a generated field', () => {
	const accesses = [...source.matchAll(/^\tget \w+\(\)[^\n]*(?:\n\t\t[^\n]*)*/gm)].map(m => fieldOf(m[0]));
	for (const reapi of Object.keys(ENTITY_FIELDS)) {
		// An entry keyed by a property name (observerMode) documents a property read another way.
		const read = accesses.includes(reapi) || source.includes(`	get ${reapi}(`);
		expect([reapi, read]).toEqual([reapi, true]);
	}
});

test('a field is read where the game keeps it, not through reapi\'s natives', () => {
	expect(source).not.toContain('NATIVE_get_entvar');
	expect(source).not.toContain('NATIVE_get_member)');
	expect(source).toContain('\tget gravity(): number { return cellFloat(entvarCell(this.id, 284)); }');
	// The game rules are read in memory too, on every server.
	expect(source).toMatch(/\tget ctWins\(\): number \{ return gameCell\(\d+\); \}/);
	// ReGameDLL's own member is read in memory where the server has it; elsewhere what the server has instead (as/hlds.ts), or nothing, said once.
	expect(source).toContain('\tget gameName(): string { return regameText("gameName", gameNameHlds); }');
	expect(source).toMatch(/\tget teamBalanced\(\): boolean \{ return regameCell\(\d+, "teamBalanced"\) != 0; \}/);
});
