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

/** A hookchain as the fake fires it: which arguments are floats or text, and what it answers. */
export interface HookShape {
	/** reapi's short name: "take_damage". */
	kind: string;
	/** Zero-based arguments the event reads as floats. */
	floats: Set<number>;
	/** Zero-based arguments the event reads as text. */
	texts: Set<number>;
	/** The ATYPE_* the chain answers with, or -1 for a chain that answers nothing. */
	answer: number;
	/** The Ham_* function a Ham Sandwich hook of the event is on, when it has one. */
	ham?: number;
}

export interface Tables {
	/** Every `export const X: i32 = N` in as/constants.ts. */
	constants: Map<string, number>;
	/** The dispatcher's native ids (`NATIVE_x`) to names. */
	dispatched: Map<number, string>;
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

		// The answer's ATYPE_*: a cell's, or text or a vector, which only Ham Sandwich answers.
		const result = body.match(/get result\(\)[^{]*\{[^}]*this\.__result(?:Cell\((ATYPE_\w+)\)|(Text|Vector)\(\))/);
		const answer = !result ? '' : result[1] ?? (result[2] === 'Text' ? 'ATYPE_STRING' : 'ATYPE_VECTOR');
		const ham = body.match(/private static readonly ham: i32 = (Ham_\w+);/)?.[1];
		const shape: HookShape = {
			kind,
			floats: new Set([...body.matchAll(/cellFloat\(this\.__cell\((\d+)\)\)/g)].map(m => Number(m[1]))),
			texts: new Set([...body.matchAll(/this\.__text\((\d+)\)/g)].map(m => Number(m[1]))),
			answer: answer ? constants.get(answer) ?? -1 : -1,
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
		hookNames,
		hooks,
		floatFields: fieldsOf(kind => (kind & 3) === 1),
		vectorFields: fieldsOf(kind => (kind & 3) === 2),
		stringFields: fieldsOf(kind => (kind & 3) === 3),
		arrayFields: fieldsOf(kind => (kind & 4) !== 0),
	};

	return cached;
}

/** A constant's value by name, or an error naming it. */
export function constant(name: string): number {
	const value = tables().constants.get(name);
	if (value === undefined) throw new Error(`no constant named ${name} in as/constants.ts`);
	return value;
}
