// What `dev` rebuilds for: a source file whose contents changed.
//
// A watcher hears more than edits. An editor saves a file it did not change,
// a package manager writes a module package again as it was, a tool touches
// only a file's time - each is an event, and none is a change to build. So
// the files are known by a hash of what they hold, and an event counts only
// when that hash is not the one seen last.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Whether `path` is `dir` or inside it. */
function inside(dir: string, path: string): boolean {
	const rel = relative(dir, path);
	return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * The file a watcher of `folder` names - `file`, relative to it - when a
 * build reads it: a .ts, not a declaration file the editor config has, and
 * not in node_modules or the folders in `skip`. Null for any other.
 */
export function sourceIn(folder: string, file: string, skip: string[] = []): string | null {
	const path = join(folder, file);
	const source = file.endsWith('.ts') && !file.endsWith('.d.ts') && !file.split(/[\\/]/).includes('node_modules');
	return source && !skip.some(dir => inside(dir, path)) ? path : null;
}

/** The files under `folder` sourceIn() takes; node_modules is not looked into. */
export function sourcesIn(folder: string, skip: string[] = []): string[] {
	const walk = (dir: string): string[] => {
		let entries;
		try {
			entries = readdirSync(join(folder, dir), { withFileTypes: true });
		} catch {
			return [];
		}
		return entries.flatMap((entry) => {
			const file = join(dir, entry.name);
			if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : walk(file);
			return sourceIn(folder, file, skip) ?? [];
		});
	};
	return walk('');
}

/** What a file holds, as a hash; null when it is not there. */
function contentsOf(file: string): string | null {
	try {
		return createHash('sha1').update(readFileSync(file)).digest('hex');
	} catch {
		return null;
	}
}

/** Files known by what they hold. */
export class FileContents {
	private seen = new Map<string, string | null>();

	constructor(files: string[]) {
		for (const file of files) this.seen.set(resolve(file), contentsOf(file));
	}

	/**
	 * Of these files, the ones that hold something else than when they were
	 * seen last - a new file and one gone included. Each is seen as it is now.
	 */
	changed(files: string[]): string[] {
		const now = [...new Set(files.map(file => resolve(file)))].map(file => ({ file, contents: contentsOf(file) }));
		const changed = now.filter(each => (this.seen.get(each.file) ?? null) !== each.contents);
		for (const each of now) this.seen.set(each.file, each.contents);
		return changed.map(each => each.file);
	}
}
