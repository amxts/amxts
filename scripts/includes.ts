// scripts/includes.ts
/**
 * Where .inc files come from. The AMX Mod X distribution in amxmodx/ carries the
 * standard set; the core's includes/ carries its own - order.txt and the
 * contracts of the Pawn plugins the official modules stand in for - and
 * includes/vendor/ the third-party ones the API is generated from (ReAPI and
 * the rehlds constants, resemiclip), which `bun run setup` fetches
 * as includes/sources.json pins them.
 *
 * A project looks in its own folders first: its includes/ (the includes of
 * the Pawn plugins it talks to), then its server's - the
 * addons/amxmodx/scripting/include beside AMXTS_SERVER when it is there, else
 * the ones the amxts command fetched into .amxts/include - then the core's
 * includes/ and AMX Mod X's. The core's includes/vendor/ is the core's own:
 * a project sees what its server has.
 *
 * Everything available is parsed for its natives, but the host plugin pulls only
 * what order.txt lists: referencing a native of a module the server does not
 * load makes AMX Mod X refuse the plugin, and the runtime goes down with it.
 */
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { serverFolder } from '../src/system.mjs';
import { existsSync, readdirSync, readFileSync } from './tracked-fs';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The third-party includes the core generates the API from: `bun run setup` fetches them. */
export const VENDOR = join(CORE, 'includes', 'vendor');

function same(a: string, b: string): boolean {
	try {
		return realpathSync(a) === realpathSync(b);
	} catch {
		return resolve(a) === resolve(b);
	}
}

/** The server's own includes: addons/amxmodx/scripting/include beside its addons/amxts (AMXTS_SERVER), when it is there. */
export function serverIncludes(): string | null {
	let server: string;
	try {
		server = serverFolder(process.env.AMXTS_SERVER ?? '');
	} catch {
		return null;
	}
	if (!server) return null;
	const dir = resolve(server, '..', 'amxmodx', 'scripting', 'include');
	return existsSync(dir) ? dir : null;
}

/** The folders includes are looked in for a project, first to last. */
export function includeDirs(project = process.cwd()): string[] {
	const own = join(project, 'includes');
	const amxmodx = join(CORE, 'amxmodx/base/include');
	if (same(project, CORE)) return [own, VENDOR, amxmodx];
	const server = serverIncludes();
	return [...new Set([own, server ?? join(project, '.amxts', 'include'), join(CORE, 'includes'), amxmodx])];
}

const DIRS = includeDirs();

function namesIn(dir: string): string[] {
	return existsSync(dir)
		? readdirSync(dir).filter(f => f.endsWith('.inc')).map(f => f.replace('.inc', ''))
		: [];
}

const located = new Map<string, string>();
for (const dir of DIRS) {
	for (const name of namesIn(dir)) {
		if (!located.has(name)) located.set(name, join(dir, `${name}.inc`));
	}
}

export function listIncludes(): string[] {
	return [...located.keys()];
}

export function includePath(name: string): string {
	const path = located.get(name);
	if (!path) throw new Error(`include not found: ${name}`);

	return path;
}

export function readInclude(name: string): string {
	return readFileSync(includePath(name), 'utf-8');
}

/**
 * Parses includes/order.txt. A bare name is included and (by the host
 * generator) pulled; a line starting with `-` is a deny marker — the name
 * still has to resolve (reapi.inc unconditionally #includes reapi_vtc,
 * reapi_reunion and reapi_rechecker, so they must be on disk to compile it),
 * but it is excluded from whatever build the caller pulls into a native
 * table. A #include costs nothing; a native reference does, because AMX Mod X
 * refuses to load a plugin whose native table names a module the server does
 * not have loaded.
 */
export function parseOrder(content: string): { includes: string[]; denied: Set<string> } {
	const lines = content
		.split('\n')
		.map(l => l.trim())
		.filter(l => l && !l.startsWith('#'));

	const includes: string[] = [];
	const denied = new Set<string>();

	for (const line of lines) {
		if (line.startsWith('-')) {
			denied.add(line.slice(1).replace(/\.inc$/, ''));
		} else {
			includes.push(line.replace(/\.inc$/, ''));
		}
	}

	return { includes, denied };
}

/** The listed names plus everything they #include, recursively. */
export function resolveTransitive(names: string[]): string[] {
	const seen = new Set<string>();
	const queue = [...names];

	while (queue.length > 0) {
		const name = queue.shift()!;
		if (seen.has(name) || !located.has(name)) continue;
		seen.add(name);

		for (const line of readInclude(name).split('\n')) {
			const match = line.match(/^\s*#include\s+[<"]([^>"]+)[>"]/);
			if (match) queue.push(match[1]);
		}
	}

	return [...seen];
}
