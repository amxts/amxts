// What the fake server needs to know about the generated layer, read out of
// the generated files themselves rather than copied: a constant, a dispatcher
// id or a hookchain number that moves when `bun run generate` runs moves here
// too, and a test never disagrees with the plugin it loads.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The plugins folder - what `~/` means - and where the generated files live. */
export const PLUGINS_ROOT = fileURLToPath(new URL('../../as/', import.meta.url));

function generated(file: string): string {
	try {
		return readFileSync(join(PLUGINS_ROOT, file), 'utf-8');
	} catch {
		throw new Error(`as/${file} is missing - run \`bun run generate\` before testing plugins`);
	}
}

/** A hook's answer, by how its event's result getter reads it: text and a vector are only Ham Sandwich's. */
function answerOf(result: string | undefined): HookAnswer {
	if (!result) return 'none';
	if (result.includes('__resultText')) return 'text';
	if (result.includes('__resultVector')) return 'vector';
	if (result.startsWith('cellFloat')) return 'float';
	return result.endsWith('!= 0') ? 'bool' : 'int';
}

export type HookAnswer = 'int' | 'float' | 'bool' | 'text' | 'vector' | 'none';

/** A hookchain as the fake fires it: which arguments are floats or text, and what it answers. */
export interface HookShape {
	/** reapi's short name: "take_damage". */
	kind: string;
	/** Zero-based arguments the event reads as floats. */
	floats: Set<number>;
	/** Zero-based arguments the event reads as text. */
	texts: Set<number>;
	/** What the chain answers with: a number, a float, a boolean, text, a vector, or nothing. */
	answer: HookAnswer;
	/** The Ham_* function a Ham Sandwich hook of the event is on, when it has one. */
	ham?: number;
}

export interface Tables {
	/** Every `export const X: i32 = N` in as/constants.ts. */
	constants: Map<string, number>;
	/** The dispatcher's native ids (`NATIVE_x`) to names. */
	dispatched: Map<number, string>;
	/** A native's arguments as they cross, by its name: runtime/natives.txt's marks (`s` text in, `t` text back). */
	crossings: Map<string, string[]>;
	/** A hookchain's number (hookIdOf) to its short name. */
	hookNames: Map<number, string>;
	/** A hookchain by its short name, or by its event name ("takeDamage"). */
	hooks: Map<string, HookShape>;
	/** Entvars and members read as floats, by constant value. */
	floatFields: Set<number>;
	/** Entvars and members that hold three floats. */
	vectorFields: Set<number>;
	/** Entvars and members that hold text: var_classname, m_szTeamName. */
	stringFields: Set<number>;
	/** Members read with an element index: m_rgpPlayerItems. */
	arrayFields: Set<number>;
	/** An entvar by its offset in entvars_t, as the module's ent_get takes it: its constant, and a vector's component. */
	entvarAt: Map<number, { field: number; component: number }>;
	/** A member by its class and name in the gamedata, as member_slot takes it ("CBasePlayer::m_iAccount"): its constant. */
	memberNamed: Map<string, number>;
}

/**
 * The entvars by their offset (a vector's components each) and the members by
 * their gamedata name, as the module reads them: the lists as/entities.ts
 * keeps beside its member table.
 */
function fieldPlaces(constants: Map<string, number>, entities: string) {
	const entvarAt = new Map<number, { field: number; component: number }>();
	for (const [, name, offset, vector] of entities.matchAll(/^\/\/ (var_\w+) (\d+)( vector)?$/gm)) {
		const field = constants.get(name);
		if (field === undefined) continue;
		for (let component = 0; component < (vector ? 3 : 1); component++) entvarAt.set(Number(offset) + component * 4, { field, component });
	}
	const memberNamed = new Map<string, number>();
	for (const [, className, name, reapi] of entities.matchAll(/^\t"(\w+)", "(\w+)", \/\/ (\w+)$/gm)) {
		const field = constants.get(reapi);
		if (field !== undefined) memberNamed.set(`${className}::${name}`, field);
	}
	return { entvarAt, memberNamed };
}

let cached: Tables | null = null;

export function tables(): Tables {
	if (cached) return cached;

	const constantsSource = generated('constants.ts');
	const constants = new Map<string, number>();
	for (const [, name, value] of constantsSource.matchAll(/^export const (\w+): i32 = (-?(?:0x[0-9a-fA-F]+|\d+));/gm)) {
		constants.set(name, Number(value));
	}

	const dispatched = new Map<number, string>();
	for (const [, name, id] of generated('natives.ts').matchAll(/^export const NATIVE_(\w+): i32 = (\d+);/gm)) {
		dispatched.set(Number(id), name);
	}

	const crossings = new Map<string, string[]>();
	const natives = readFileSync(join(PLUGINS_ROOT, '../runtime/natives.txt'), 'utf-8');
	for (const [, name, marks] of natives.matchAll(/^(\w+) \([^)]*\)\S* (\S+)$/gm)) crossings.set(name, marks.split(','));

	const hookNames = new Map<number, string>();
	const switchBody = constantsSource.slice(constantsSource.indexOf('export function hookIdOf'));
	for (const [, name, id] of switchBody.slice(0, switchBody.indexOf('\n}\n')).matchAll(/case "(\w+)": return (-?\d+);/g)) {
		hookNames.set(Number(id), name);
	}

	const hooksSource = generated('hooks.ts');
	const hooks = new Map<string, HookShape>();
	const byClass = new Map<string, HookShape>();

	for (const [, className, body] of hooksSource.matchAll(/^export class (\w+) extends HookEvent \{\n([\s\S]*?)\n\}\n/gm)) {
		const kind = body.match(/private readonly kind: string = "(\w+)";/)?.[1];
		if (!kind) continue;

		const result = body.match(/get result\(\)[^{]*\{ return ([^;]*);/)?.[1];
		const answer = answerOf(result);
		const ham = body.match(/private static readonly ham: i32 = (Ham_\w+);/)?.[1];
		const shape: HookShape = {
			kind,
			floats: new Set([...body.matchAll(/cellFloat\(this\.__cell\((\d+)\)\)/g)].map(m => Number(m[1]))),
			texts: new Set([...body.matchAll(/this\.__text\((\d+)\)/g)].map(m => Number(m[1]))),
			answer,
			...(ham ? { ham: constants.get(ham) } : {}),
		};

		hooks.set(kind, shape);
		byClass.set(className, shape);
	}

	const eventMap = hooksSource.slice(hooksSource.indexOf('export interface GameEventMap'));
	for (const [, event, className] of eventMap.slice(0, eventMap.indexOf('\n}\n')).matchAll(/^\t(\w+): (\w+);/gm)) {
		const shape = byClass.get(className);
		if (shape) hooks.set(event, shape);
	}

	// A field's kind is what the field natives' tables in as/natives.ts say
	// (__get_entvar_kind, __get_member_kind): 1 a Float, 2 a vector, 3 text,
	// 4 more for an array member. Entvars and members only - a game rule's
	// number is its own.
	const kinds = new Map<number, number>();
	for (const [, body] of generated('natives.ts').matchAll(/^export function __get_(?:entvar|member)_kind\(field: i32\): i32 \{\n([\s\S]*?)\n\}\n/gm)) {
		for (const [, cases, kind] of body.matchAll(/((?:\t\tcase \w+:\n)+)\t\t\treturn (\d+);/g)) {
			for (const [, name] of cases.matchAll(/case (\w+):/g)) {
				const value = constants.get(name);
				if (value !== undefined) kinds.set(value, Number(kind));
			}
		}
	}
	const fieldsOf = (test: (kind: number) => boolean) => new Set([...kinds].filter(([, kind]) => test(kind)).map(([field]) => field));

	cached = {
		constants,
		dispatched,
		crossings,
		hookNames,
		hooks,
		floatFields: fieldsOf(kind => (kind & 3) === 1),
		vectorFields: fieldsOf(kind => (kind & 3) === 2),
		stringFields: fieldsOf(kind => (kind & 3) === 3),
		arrayFields: fieldsOf(kind => (kind & 4) !== 0),
		...fieldPlaces(constants, generated('entities.ts')),
	};

	return cached;
}

/** A constant's value by name, or an error naming it. */
export function constant(name: string): number {
	const value = tables().constants.get(name);
	if (value === undefined) throw new Error(`no constant named ${name} in as/constants.ts`);
	return value;
}
