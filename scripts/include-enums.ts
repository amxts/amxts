// The Pawn enums of the includes and the names amxts gives their members,
// shared by the generators that turn an enum argument into a union of names:
// scripts/generate-hooks.ts (game events) and scripts/generate-host.ts (the
// messages to clients).
import { readFileSync } from 'node:fs';
import { includePath } from './includes';

export interface EnumMember {
	name: string;
	value: number;
}

/** Every named enum in these includes, with its members' values. */
export function enumsIn(files: string[]): Map<string, EnumMember[]> {
	const found = new Map<string, EnumMember[]>();
	for (const file of files) {
		const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
		for (const m of text.matchAll(/enum\s+(\w+)\s*\{([^}]*)\}/g)) {
			const members: EnumMember[] = [];
			let next = 0;
			for (const raw of m[2].split(',').map(s => s.trim()).filter(Boolean)) {
				const [name, value] = raw.split('=').map(s => s.trim());
				if (value !== undefined) next = Number(value);
				if (!Number.isInteger(next)) break;
				members.push({ name, value: next });
				next++;
			}
			if (!found.has(m[1])) found.set(m[1], members);
		}
	}
	return found;
}

/** The enums of the includes that carry the game's types: cssdk_const and reapi's. */
export const GAME_ENUMS = enumsIn([includePath('cssdk_const'), includePath('reapi_gamedll_const'), includePath('reapi_engine_const')]);

/** ROUND_CTS_WIN -> ctsWin; Class_CT -> classCT; a flag's KILLER_BLIND -> KillerBlind. */
export function memberName(suffix: string, flags: boolean): string {
	const screaming = suffix === suffix.toUpperCase();
	const parts = suffix.split('_').filter(Boolean).map(part => screaming ? part.toLowerCase() : part);
	const word = (part: string) => part.charAt(0).toUpperCase() + part.slice(1);
	const joined = parts.map(word).join('');
	return flags ? joined : joined.charAt(0).toLowerCase() + joined.slice(1);
}
