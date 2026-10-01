// Where each entvar lies in the engine's entvars_t: the byte offset the
// facade hands the module (ent_get in runtime/src/fields.h), which reads the
// field there itself.
//
// reapi's include lists every entvar in the struct's order, each with its
// C type in the comment above it:
//
//     * Member type:      class Vector
//     var_origin,
//
// so the layout follows from it as the compiler lays the struct out on i386 -
// Windows and Linux alike: a number or a pointer is four bytes on a four-byte
// boundary, a vector twelve, the byte arrays as long as they are. The engine
// itself never changes it; the checks below stop a reapi that skipped or
// reordered a field.
//
// Shared by scripts/generate-entities.ts and the fake server's tables.
import { readFileSync } from 'node:fs';
import { includePath } from './includes';

export type EntvarKind = 'string' | 'vector' | 'float' | 'int' | 'entity' | 'bytes';

export interface Entvar {
	/** Bytes from the start of entvars_t. */
	offset: number;
	kind: EntvarKind;
}

/** What a reapi member type is, and how many bytes it takes. */
const TYPES: Record<string, { kind: EntvarKind; size: number; align: number }> = {
	'string_t': { kind: 'string', size: 4, align: 4 },
	'class Vector': { kind: 'vector', size: 12, align: 4 },
	'vec3_t': { kind: 'vector', size: 12, align: 4 },
	'float': { kind: 'float', size: 4, align: 4 },
	'int': { kind: 'int', size: 4, align: 4 },
	'struct edict_s *': { kind: 'entity', size: 4, align: 4 },
	'byte [4]': { kind: 'bytes', size: 4, align: 1 },
	'byte [2]': { kind: 'bytes', size: 2, align: 1 },
};

/** Fields whose place is known from the engine, to catch a layout that went wrong. */
const ANCHORS: Record<string, number> = {
	var_origin: 8,
	var_health: 352,
	var_pContainingEntity: 520,
	var_euser4: 672,
};

/** sizeof(entvars_t). */
export const ENTVARS_SIZE = 676;

/** Every entvar by its reapi name, from reapi_engine_const.inc's EntVars. */
export function entvarLayout(text = readFileSync(includePath('reapi_engine_const'), 'utf8')): Map<string, Entvar> {
	const start = text.search(/^enum EntVars\r?$/m);
	if (start < 0) throw new Error('enum EntVars is not in reapi_engine_const.inc');
	const body = text.slice(start, text.indexOf('\n};', start));

	const layout = new Map<string, Entvar>();
	let offset = 0;
	let memberType = '';
	for (const line of body.split('\n')) {
		const comment = line.match(/Member type:(.*)/);
		if (comment) memberType = comment[1].trim();
		const name = line.match(/^\s*(var_\w+)/)?.[1];
		if (!name) continue;

		const type = TYPES[memberType];
		if (!type) throw new Error(`${name}: no layout for the member type "${memberType}"`);
		offset = Math.ceil(offset / type.align) * type.align;
		layout.set(name, { offset, kind: type.kind });
		offset += type.size;
	}

	if (offset !== ENTVARS_SIZE) throw new Error(`entvars_t came out ${offset} bytes, not ${ENTVARS_SIZE}: reapi's EntVars skips or adds a field`);
	for (const [name, expected] of Object.entries(ANCHORS)) {
		if (layout.get(name)?.offset !== expected) throw new Error(`${name} came out at ${layout.get(name)?.offset}, not ${expected}`);
	}
	return layout;
}
