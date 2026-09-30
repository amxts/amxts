// What the testing library compiled, kept on disk between test runs.
//
// A plugin's compile is keyed by everything that is not a file it read - the
// compiler, the hood's scripts, the flags, the project and its config - and
// stored with every file read it made (scripts/tracked-fs.ts): the entry, what
// it imports, the facade and the generated API, the module packages. A second
// run takes the stored result only while each of those reads sees the same
// thing it saw, so a hit is what compiling again would give, byte for byte.
//
// The cache is node_modules/.cache/amxts in the folder the tests run from.
// AMXTS_TEST_CACHE=0 turns it off; AMXTS_TEST_CACHE=<folder> moves it.
import type { Reads } from '../../scripts/tracked-fs';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listIncludes } from '../../scripts/includes';
import { currentProjectDir, loadProject } from '../../scripts/project';
import { hashOf, recordReads, unchanged } from '../../scripts/tracked-fs';

const setting = process.env.AMXTS_TEST_CACHE;
const CACHE_DIR = setting === '0' ? null : resolve(setting || 'node_modules/.cache/amxts', 'compile');

/** Bump when what an entry holds changes shape. */
const FORMAT = 1;

/** Entries made this long ago are removed; one still in use is made again. */
const UNUSED_FOR = 14 * 24 * 3600 * 1000;

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The compiler: the patched AssemblyScript (with its standard library inside
 * asc.js), its Binaryen, and every script of the hood a compile runs through -
 * scripts/compile.ts and what it imports, read off their import lines.
 */
let compilerHash: string | null = null;
function compilerIdentity(): string {
	if (compilerHash) return compilerHash;
	const files = new Set<string>();
	const visit = (file: string) => {
		if (files.has(file) || !existsSync(file)) return;
		files.add(file);
		if (!file.endsWith('.ts')) return;
		for (const [, spec] of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
			const target = resolve(dirname(file), spec);
			visit(/\.[cm]?js$|\.ts$/.test(target) ? target : `${target}.ts`);
		}
	};
	visit(join(HERE, 'compile.ts'));
	visit(join(HERE, 'compile-cache.ts'));
	const deps = resolve(HERE, '../../runtime/deps/assemblyscript');
	for (const file of [
		join(deps, 'dist/asc.js'),
		join(deps, 'dist/assemblyscript.js'),
		join(deps, 'node_modules/binaryen/package.json'),
		resolve(HERE, '../../runtime/patches/assemblyscript-0.28.20-amxts.patch'),
	]) {
		files.add(file);
	}
	const parts = [...files].sort().map(file => `${file}:${existsSync(file) ? hashOf(readFileSync(file)) : 'missing'}`);
	compilerHash = hashOf(parts.join('\n'));
	return compilerHash;
}

/**
 * The project a compile is made in: its folder, its config's text, and the
 * modules it resolved to with their options - a module's owner is compiled
 * with the options its project gives it. The .inc files there are to be
 * found in are listed once per run, so they are part of it too.
 */
function projectIdentity(): string {
	const dir = currentProjectDir();
	const project = loadProject(dir);
	const config = join(dir, 'amxts.config.ts');
	return hashOf(JSON.stringify({
		dir,
		config: existsSync(config) ? hashOf(readFileSync(config)) : null,
		project,
		includes: listIncludes(),
	}));
}

function keyOf(parts: unknown[]): string {
	return hashOf(JSON.stringify([FORMAT, compilerIdentity(), projectIdentity(), ...parts]));
}

// Uint8Array fields travel as base64.
function encode(_: string, value: unknown) {
	return value instanceof Uint8Array ? { $bytes: Buffer.from(value).toString('base64') } : value;
}
function decode(_: string, value: any) {
	return value && typeof value === 'object' && typeof value.$bytes === 'string' ? new Uint8Array(Buffer.from(value.$bytes, 'base64')) : value;
}

interface Entry<T> {
	reads: Reads;
	value: T;
}

function load<T>(file: string): Entry<T> | null {
	try {
		const entry = JSON.parse(readFileSync(file, 'utf8'), decode) as Entry<T>;
		return unchanged(entry.reads) ? entry : null;
	} catch {
		return null;
	}
}

function store(file: string, entry: Entry<unknown>) {
	// Beside it first, then into place: a run stopped halfway leaves the old
	// entry or the new one, never half of one.
	const partial = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(partial, JSON.stringify(entry, encode));
		renameSync(partial, file);
	} catch {
		rmSync(partial, { force: true });
	}
}

let pruned = false;
function prune() {
	if (pruned || !CACHE_DIR || !existsSync(CACHE_DIR)) return;
	pruned = true;
	const now = Date.now();
	for (const name of readdirSync(CACHE_DIR)) {
		const file = join(CACHE_DIR, name);
		try {
			if (now - statSync(file).mtimeMs > UNUSED_FOR) rmSync(file, { force: true });
		} catch {}
	}
}

/** Whether results are kept on disk: not with AMXTS_TEST_CACHE=0. */
export const cacheOn = CACHE_DIR !== null;

/** How often this process took a result from the disk, and made one. */
export const cacheCounts = { hits: 0, misses: 0 };

/**
 * `run`'s value, from the disk when an earlier run made it from the same
 * sources, or made now and kept. `parts` is what it depends on besides the
 * files it reads: the entry, the flags. A value is JSON, with Uint8Arrays in
 * it; `keep` says whether a failure is worth keeping - a compile error is, a
 * file that could not be opened is not.
 */
export async function cached<T>(parts: unknown[], run: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
	if (!CACHE_DIR) return run();
	prune();
	const file = join(CACHE_DIR, `${keyOf(parts)}.json`);
	const hit = load<T>(file);
	if (hit) {
		cacheCounts.hits++;
		return hit.value;
	}

	cacheCounts.misses++;
	const { reads, result } = await recordReads(run);
	if (result.status === 'rejected') throw result.reason;
	if (keep(result.value)) store(file, { reads, value: result.value });
	return result.value;
}
