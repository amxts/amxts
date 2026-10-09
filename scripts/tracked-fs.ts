// The file reads of a compile, for a cache that has to know what it depended on.
//
// The scripts a compile runs through (project.ts, shared-modules.ts,
// plugin-natives.ts, includes.ts) take readFileSync, existsSync, statSync and
// readdirSync from here instead of node:fs. They are node:fs's own, and while
// a compile is being recorded (`recordReads`) every call is noted with what it
// saw: a file's content hash, whether a path exists, what kind it is. A cached
// result is still good while every one of them answers the same (`unchanged`).
//
// Two compiles recorded at once both note each other's reads: a cache entry
// then depends on a little more than it needs, never on less.
import type { PathLike, Stats } from 'node:fs';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { resolve } from 'node:path';

/** What a compile read: `<op>\0<absolute path>` -> what it saw. */
export type Reads = Record<string, string>;

const recording = new Set<Reads>();

export function hashOf(data: string | Uint8Array): string {
	return createHash('sha1').update(data).digest('hex');
}

function note(op: string, path: PathLike, seen: string) {
	if (!recording.size) return;
	const key = `${op}\0${resolve(String(path))}`;
	for (const reads of recording) reads[key] = seen;
}

function kindOf(stats: Stats): string {
	return stats.isFile() ? 'file' : stats.isDirectory() ? 'dir' : 'other';
}

export function readFileSync(path: PathLike, encoding: BufferEncoding): string;
export function readFileSync(path: PathLike): Buffer;
export function readFileSync(path: PathLike, encoding?: BufferEncoding): string | Buffer {
	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(path);
	} catch (error) {
		note('read', path, 'missing');
		throw error;
	}
	note('read', path, hashOf(bytes));
	return encoding ? bytes.toString(encoding) : bytes;
}

export function existsSync(path: PathLike): boolean {
	const exists = fs.existsSync(path);
	note('exists', path, String(exists));
	return exists;
}

export function statSync(path: PathLike): Stats {
	let stats: Stats;
	try {
		stats = fs.statSync(path);
	} catch (error) {
		note('stat', path, 'missing');
		throw error;
	}
	note('stat', path, kindOf(stats));
	return stats;
}

export function readdirSync(path: PathLike): string[] {
	let names: string[];
	try {
		names = fs.readdirSync(path);
	} catch (error) {
		note('readdir', path, 'missing');
		throw error;
	}
	note('readdir', path, listingOf(names));
	return names;
}

/**
 * What a folder's listing is noted as: its names but the hidden ones - a
 * project's node_modules gains `.cache` with the first build's own cache,
 * which no compile depends on.
 */
function listingOf(names: string[]): string {
	return hashOf(names.filter(name => !name.startsWith('.')).sort().join('\n'));
}

/** `run`, with every file read it makes - and anything else read meanwhile - noted. */
export async function recordReads<T>(run: () => Promise<T>): Promise<{ reads: Reads; result: PromiseSettledResult<T> }> {
	const reads: Reads = {};
	recording.add(reads);
	try {
		return { reads, result: { status: 'fulfilled', value: await run() } };
	} catch (reason) {
		return { reads, result: { status: 'rejected', reason } };
	} finally {
		recording.delete(reads);
	}
}

/** What one noted read sees now. */
function seenNow(op: string, path: string): string {
	try {
		switch (op) {
			case 'read': return hashOf(fs.readFileSync(path));
			case 'exists': return String(fs.existsSync(path));
			case 'stat': return kindOf(fs.statSync(path));
			case 'readdir': return listingOf(fs.readdirSync(path));
			default: return 'unknown';
		}
	} catch {
		return 'missing';
	}
}

/** Whether every read noted in `reads` would see today what it saw then. */
export function unchanged(reads: Reads): boolean {
	for (const [key, seen] of Object.entries(reads)) {
		const at = key.indexOf('\0');
		if (seenNow(key.slice(0, at), key.slice(at + 1)) !== seen) return false;
	}
	return true;
}
