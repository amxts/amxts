// scripts/setup-includes.ts
// The third-party includes the API is generated from, fetched into
// includes/vendor/ - they are not kept in the repository:
//
//   bun run setup            (also the first step of `bun run generate`)
//
// includes/sources.json pins each one: the release, its URL and the sha256
// of what that URL gives. A download that does not match stops here - a
// release's includes decide the hookchain and member ids the API is built
// with, so another one would be wrong without a word. A source already
// fetched (includes/vendor/sources.lock.json) is not fetched again.
//
// Offline, a file put by hand into includes/vendor/.download/ under its URL's
// name is taken instead of downloading it, after the same check.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { c, log, report } from './ui';
import { unzip } from './unzip';

interface Source {
	name: string;
	version: string;
	license: string;
	home: string;
	url: string;
	sha256: string;
	/** In an archive: the folder whose .inc files are the includes. */
	include?: string;
}

const INCLUDES = join(dirname(fileURLToPath(import.meta.url)), '..', 'includes');
const VENDOR = join(INCLUDES, 'vendor');
const DOWNLOADS = join(VENDOR, '.download');
const LOCK = join(VENDOR, 'sources.lock.json');

class SetupError extends Error {
	constructor(message: string, public hint: string) {
		super(message);
	}
}

function sha256(data: Uint8Array): string {
	return createHash('sha256').update(data).digest('hex');
}

function readJson<T>(path: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as T;
	} catch {
		return fallback;
	}
}

/**
 * The file at the source's URL. GitHub's release downloads answer 5xx now and
 * then for a moment: such an answer, or a network error, is tried again
 * twice, a few seconds apart; a 4xx is not.
 */
async function download(source: Source, offline: string): Promise<Uint8Array> {
	for (let attempt = 1; ; attempt++) {
		let problem: string;
		try {
			const response = await fetch(source.url, { signal: AbortSignal.timeout(60_000) });
			if (response.ok) return new Uint8Array(await response.arrayBuffer());
			problem = `${source.url} answered ${response.status}`;
			if (response.status < 500) attempt = 3;
		} catch (error) {
			problem = (error as Error).message;
		}
		if (attempt >= 3) throw new SetupError(`Could not download ${source.name} ${source.version}: ${problem}`, offline);
		await new Promise(done => setTimeout(done, attempt * 3000));
	}
}

/** What `url` gives: the file in .download/ when it is there, else the download, saved there. */
async function fetchChecked(source: Source): Promise<Uint8Array> {
	const saved = join(DOWNLOADS, basename(new URL(source.url).pathname));
	const offline = `Check the connection and run it again - or download ${source.url} yourself and put it at ${saved}.`;
	const local = existsSync(saved);
	let data: Uint8Array;
	if (local) {
		data = readFileSync(saved);
	} else {
		data = await download(source, offline);
	}
	const got = sha256(data);
	if (got !== source.sha256) {
		throw new SetupError(
			`${source.name} ${source.version} is not the file includes/sources.json pins: sha256 ${got}, expected ${source.sha256}`,
			`${local ? `Delete ${saved} and run it again. ` : ''}A release changed under the same URL is a new include set: compare it and update sources.json on purpose.`,
		);
	}
	if (!local) {
		mkdirSync(DOWNLOADS, { recursive: true });
		writeFileSync(saved, data);
	}
	return data;
}

/** The .inc files a source gives, by file name. */
function includesOf(source: Source, data: Uint8Array): Map<string, Uint8Array> {
	if (!source.url.endsWith('.zip')) return new Map([[basename(new URL(source.url).pathname), data]]);
	const files = new Map<string, Uint8Array>();
	for (const [path, content] of unzip(data)) {
		if (path.startsWith(source.include ?? '') && path.endsWith('.inc')) files.set(basename(path), content);
	}
	if (!files.size) throw new SetupError(`${source.name} ${source.version}: no .inc files under ${source.include} in ${source.url}`, 'Fix `include` in includes/sources.json.');
	return files;
}

async function setup() {
	const sources = readJson<Record<string, Source>>(join(INCLUDES, 'sources.json'), {});
	const lock = readJson<Record<string, { sha256: string; files: string[] }>>(LOCK, {});
	mkdirSync(VENDOR, { recursive: true });
	// A source sources.json no longer pins goes, with its files: a generated
	// API from them would have natives no server is told to load.
	for (const [id, known] of Object.entries(lock)) {
		if (sources[id]) continue;
		for (const file of known.files) rmSync(join(VENDOR, file), { force: true });
		delete lock[id];
		writeFileSync(LOCK, `${JSON.stringify(lock, null, '\t')}\n`);
		log.success(`${id}: no longer pinned, its ${known.files.join(', ')} removed`);
	}
	for (const [id, source] of Object.entries(sources)) {
		const known = lock[id];
		if (known?.sha256 === source.sha256 && known.files.every(file => existsSync(join(VENDOR, file)))) continue;
		const files = includesOf(source, await fetchChecked(source));
		for (const [file, content] of files) writeFileSync(join(VENDOR, file), content);
		lock[id] = { sha256: source.sha256, files: [...files.keys()].sort() };
		writeFileSync(LOCK, `${JSON.stringify(lock, null, '\t')}\n`);
		log.success(`${source.name} ${source.version} ${c.dim(`(${source.license})`)}: ${[...files.keys()].join(', ')}`);
	}
}

try {
	await setup();
} catch (error) {
	report(error);
	process.exit(1);
}
