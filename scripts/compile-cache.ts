// Compiles kept on disk, reused while what they read is the same.
//
// A compile is keyed by everything that is not a file it read - the
// compiler, the hood's scripts, the flags, the project and its config - and
// stored with every file read it made (scripts/tracked-fs.ts): the entry, what
// it imports, the facade and the generated API, the module packages. It is
// taken again only while each of those reads sees the same thing it saw, so a
// hit is what compiling again would give, byte for byte.
//
// One key holds one entry: a compile made again replaces the one before, so a
// cache does not grow with every edit. The testing library keeps its compiles
// in one (src/testing/compile-cache.ts), a build its plugins in another
// (scripts/build-wasm.ts).
import type { Reads } from './tracked-fs';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listIncludes } from './includes';
import { currentProjectDir, loadProject } from './project';
import { hashOf, recordReads, unchanged } from './tracked-fs';

/** Bump when what an entry holds changes shape. */
const FORMAT = 1;

/** Entries made this long ago are removed; one still in use is made again. */
const UNUSED_FOR = 14 * 24 * 3600 * 1000;

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The compiler: the patched AssemblyScript (with its standard library inside
 * asc.js), its Binaryen, and every script of the hood a compile runs through -
 * `entries`, this file and what they import, read off their import lines.
 */
export function codeIdentity(entries: string[]): string {
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
	[...entries, fileURLToPath(import.meta.url)].forEach(visit);
	const deps = join(CORE, 'runtime/deps/assemblyscript');
	for (const file of [
		join(deps, 'dist/asc.js'),
		join(deps, 'dist/assemblyscript.js'),
		join(deps, 'node_modules/binaryen/package.json'),
		join(CORE, 'runtime/patches/assemblyscript-0.28.20-amxts.patch'),
	]) {
		files.add(file);
	}
	const parts = [...files].sort().map(file => `${file}:${existsSync(file) ? hashOf(readFileSync(file)) : 'missing'}`);
	return hashOf(parts.join('\n'));
}

/**
 * The project a compile is made in: its folder, its config's text, and the
 * modules it resolved to with their options - a module's owner is compiled
 * with the options its project gives it. The .inc files there are to be
 * found in are listed once per run, so they are part of it too.
 */
function projectIdentity(): string {
	const dir = currentProjectDir();
	const config = join(dir, 'amxts.config.ts');
	return hashOf(JSON.stringify({
		dir,
		config: existsSync(config) ? hashOf(readFileSync(config)) : null,
		project: loadProject(dir),
		includes: listIncludes(),
	}));
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

export interface DiskCache {
	/** Whether results are kept on disk: not without a folder. */
	on: boolean;
	/** How often this process took a result from the disk, and made one. */
	counts: { hits: number; misses: number };
	/** What an earlier run made for `parts`, while every file it read is the same; else null. */
	find: <T>(parts: unknown[]) => T | null;
	/** `run`'s value, made now and kept for `parts` - unless `keep` says it is not worth keeping. */
	make: <T>(parts: unknown[], run: () => Promise<T>, keep?: (value: T) => boolean) => Promise<T>;
	/** find(), else make(). */
	cached: <T>(parts: unknown[], run: () => Promise<T>, keep?: (value: T) => boolean) => Promise<T>;
}

/**
 * A cache in `dir` (none when it is null: every compile is made). `parts` is
 * what a value depends on besides the files it reads: the entry, the flags. A
 * value is JSON, with Uint8Arrays in it.
 */
export function diskCache(dir: string | null, code: () => string): DiskCache {
	const counts = { hits: 0, misses: 0 };
	let identity: string | null = null;
	const fileOf = (parts: unknown[]) => {
		identity ??= hashOf(`${FORMAT}\n${code()}`);
		return join(dir!, `${hashOf(JSON.stringify([identity, projectIdentity(), ...parts]))}.json`);
	};

	let pruned = false;
	const prune = () => {
		if (pruned || !existsSync(dir!)) return;
		pruned = true;
		const now = Date.now();
		for (const name of readdirSync(dir!)) {
			const file = join(dir!, name);
			try {
				if (now - statSync(file).mtimeMs > UNUSED_FOR) rmSync(file, { force: true });
			} catch {}
		}
	};

	const find = <T>(parts: unknown[]): T | null => {
		if (!dir) return null;
		prune();
		try {
			const entry = JSON.parse(readFileSync(fileOf(parts), 'utf8'), decode) as Entry<T>;
			if (!unchanged(entry.reads)) return null;
			counts.hits++;
			return entry.value;
		} catch {
			return null;
		}
	};

	const make = async <T>(parts: unknown[], run: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> => {
		if (!dir) return run();
		counts.misses++;
		const { reads, result } = await recordReads(run);
		if (result.status === 'rejected') throw result.reason;
		if (keep(result.value)) store(fileOf(parts), { reads, value: result.value });
		return result.value;
	};

	return {
		on: dir !== null,
		counts,
		find,
		make,
		cached: async (parts, run, keep) => find(parts) ?? make(parts, run, keep),
	};
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
