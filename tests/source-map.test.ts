/**
 * A plugin's map (scripts/source-map.ts): what the module reads to print a
 * failed call's stack in TypeScript. It is made with the wasm, survives
 * Binaryen's optimiser and Asyncify - which run before asc writes the source
 * map - and maps the offsets of a function's code to that function's lines,
 * by the same wasm index WAMR's frames carry.
 */
import type { PluginMap } from '../scripts/source-map';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-ignore - bun:test types not available during type checking
import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { displayName, mapText, parseMap, placeOf, readMap, withSection } from '../scripts/source-map';
import { compileWasmFile } from '../src/testing/compile';

setDefaultTimeout(300_000);

const out = join(tmpdir(), 'amxts-source-map');
mkdirSync(out, { recursive: true });

/** The plugin compiled as the server build compiles it, its wasm and its map. */
async function compiled(source: string, name: string) {
	const file = join(out, `${name}.wasm`);
	const problem = await compileWasmFile({ source, root: 'as' }, file);
	if (problem) throw new Error(problem);
	const wasm = new Uint8Array(readFileSync(file));
	return { wasm, map: readMap(wasm) as PluginMap };
}

/** Each function body's byte range in the wasm, by its wasm index. */
function bodies(wasm: Uint8Array, first: number): Map<number, [number, number]> {
	let at = 8;
	const u32 = () => {
		let result = 0;
		let shift = 0;
		for (;;) {
			const byte = wasm[at++];
			result |= (byte & 0x7F) << shift;
			if ((byte & 0x80) === 0) return result >>> 0;
			shift += 7;
		}
	};
	const found = new Map<number, [number, number]>();
	while (at < wasm.length) {
		const id = wasm[at++];
		const size = u32();
		const end = at + size;
		if (id === 10) {
			const count = u32();
			for (let i = 0; i < count; i++) {
				const length = u32();
				found.set(first + i, [at, at + length]);
				at += length;
			}
		}
		at = end;
	}
	return found;
}

/** The lines the code of the function named `name` maps to in `file`. */
function linesOf(wasm: Uint8Array, map: PluginMap, name: string, file: string): number[] {
	const index = map.first + map.functions.indexOf(name);
	expect(index).toBeGreaterThanOrEqual(map.first);
	const [start, end] = bodies(wasm, map.first).get(index)!;
	const lines = new Set<number>();
	for (let offset = start; offset < end; offset++) {
		const place = placeOf(map, offset);
		if (place?.file === file) lines.add(place.line);
	}
	return [...lines].sort((a, b) => a - b);
}

describe('a plugin\'s map', () => {
	test('the functions\' names as a stack shows them', () => {
		expect(displayName('tests/server/errors/descend')).toBe('descend');
		expect(displayName('~lib/array/Array<plugins/shop/Item>#push')).toBe('Array<Item>.push');
		expect(displayName('plugins/shop/Shop#constructor')).toBe('new Shop');
		expect(displayName('plugins/shop/Shop#get:price')).toBe('Shop.price');
		expect(displayName('plugins/shop/onSelect~anonymous|0')).toBe('onSelect/<anonymous>');
		expect(displayName('start:plugins/shop~anonymous|1')).toBe('<anonymous>');
		expect(displayName('start:plugins/shop')).toBe('<top level>');
		expect(displayName('~lib/array/Array<%28i32%29=>void>#push@varargs')).toBe('Array<(i32)=>void>.push');
		// the library's error handling: the frame below is where the error was made
		expect(displayName('~lib/error/__throw')).toBe('');
		expect(displayName('~lib/error/RangeError#constructor')).toBe('');
	});

	test('goes into the wasm and comes back the same', () => {
		const map: PluginMap = { root: '', files: ['plugins/shop.ts'], first: 3, functions: ['buyItem', ''], mappings: 'gBAAA,EAAC' };
		const wasm = withSection(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), 'amxts.map', mapText(map));
		expect(readMap(wasm)).toEqual(map);
		expect(parseMap(mapText({ ...map, root: 'D:/project' })).root).toBe('D:/project');
	});

	test('maps a function\'s code to its lines, by the index a frame carries', async () => {
		const { wasm, map } = await compiled('tests/server/errors.ts', 'errors');
		expect(map.files).toContain('tests/server/errors.ts');
		expect(map.files).toContain('as/facade.ts');
		// the standard library's lines are left out; its functions keep their names
		expect(map.files.some(file => file.startsWith('~lib/'))).toBe(false);
		expect(map.functions).toContain('Checks.expect<String>');
		// `descend` calls itself, so it stays a function of its own
		expect(linesOf(wasm, map, 'descend', 'tests/server/errors.ts')).toEqual([36]);
		expect(map.root).toBe('');
	});

	test('survives Asyncify', async () => {
		const { wasm, map } = await compiled('tests/as/async.ts', 'async');
		expect(new TextDecoder().decode(wasm)).toContain('asyncify_start_unwind');
		const lines = linesOf(wasm, map, 'tick', 'tests/as/async.ts');
		expect(lines.length).toBeGreaterThan(0);
		expect(lines.every(line => line >= 5 && line <= 9)).toBe(true);
	});
});
