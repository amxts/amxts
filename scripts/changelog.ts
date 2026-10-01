// The release notes, one tool for every amxts repository: changelogen
// (github.com/unjs/changelogen) reads the Conventional Commits since the
// repository's last tag and writes them by kind - the scope in bold, each line
// with its commit or pull request - with a link comparing the two tags and who
// took part.
//
//   bun run changelog [--dry-run]       each checkout's CHANGELOG.md gets its version's section
//   bun run changelog release <tag> [--dir <repo>] [--dry-run]
//                                       the repository's GitHub Release of <tag>, with that
//                                       section as its notes (CI on the tag)
//
// The checkouts are the core and those beside it that are there: amxts-cli,
// the official modules, amxts-vscode. Each gets `## v<version>`, its own
// package.json's version, at the top of its CHANGELOG.md, from its last tag
// v* to HEAD; a CHANGELOG.md that has that section already is left alone.
// Before the tags, the developer reads the sections, writes a short "what's
// new" above a section's first group where it helps, and commits them: a
// release's notes are its section as committed.
//
// Kept: feat, fix, perf, refactor, docs, and a breaking change among them.
// Left out: chore, test, ci, build, style. Contributors are GitHub's logins of
// the commits (`gh api .../compare`); before the commits are on GitHub, their
// names.
import type { ChangelogConfig } from 'changelogen';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const NEIGHBOURS = resolve(CORE, '..');

/** A repository whose releases have notes, and the package.json its version is read from. */
interface Checkout {
	dir: string;
	manifest: string;
}

const CHECKOUTS: Checkout[] = [
	{ dir: CORE, manifest: 'package.json' },
	{ dir: join(NEIGHBOURS, 'amxts-cli'), manifest: 'packages/cli/package.json' },
	...['config-core', 'menu-core', 'resemiclip', 'ftp'].map(name => ({ dir: join(NEIGHBOURS, 'amxts-modules', name), manifest: 'package.json' })),
	{ dir: join(NEIGHBOURS, 'amxts-vscode'), manifest: 'package.json' },
];

/** The kinds of commit a release's notes list, in this order. */
const TYPES: ChangelogConfig['types'] = {
	feat: { title: '🚀 Enhancements' },
	fix: { title: '🩹 Fixes' },
	perf: { title: '🔥 Performance' },
	refactor: { title: '💅 Refactors' },
	docs: { title: '📖 Documentation' },
};

class ChangelogError extends Error {}

function git(dir: string, args: string[]): string | null {
	const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
	return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * The section of a CHANGELOG.md for `version` - from its `## v<version>`
 * heading to the next `## ` - without the heading; null when it has none.
 */
export function changelogSection(changelog: string, version: string): string | null {
	const lines = changelog.split(/\r?\n/);
	const heading = new RegExp(`^## v?${version.replace(/\./g, '\\.')}\\s*$`);
	const start = lines.findIndex(line => heading.test(line));
	if (start < 0) return null;
	const next = lines.findIndex((line, at) => at > start && line.startsWith('## '));
	return lines.slice(start + 1, next < 0 ? undefined : next).join('\n').trim();
}

/** A repository's notes for `version`, from its CHANGELOG.md; null when it has none. */
export function releaseNotes(dir: string, version: string): string | null {
	const file = join(dir, 'CHANGELOG.md');
	return existsSync(file) ? changelogSection(readFileSync(file, 'utf8'), version) : null;
}

/** `## v<version>`, before the first section of a changelog - or the changelog it starts. */
export function prependSection(changelog: string | null, section: string): string {
	if (changelog === null) return `# Changelog\n\n${section}\n`;
	const first = changelog.search(/^## /m);
	return first < 0 ? `${changelog.trimEnd()}\n\n${section}\n` : `${changelog.slice(0, first)}${section}\n\n${changelog.slice(first)}`;
}

/** The commits' authors as GitHub knows them: `- Name ([@login](...))`, or `- Name` when it does not. */
function contributors(repo: string, dir: string, from: string, names: string[]): string[] {
	const head = git(dir, ['rev-parse', 'HEAD']);
	const known = new Map<string, string>();
	const compare = from && head && spawnSync('gh', ['api', `repos/${repo}/compare/${from}...${head}`, '--jq', '.commits[] | [.commit.author.name, .author.login // ""] | @tsv'], { encoding: 'utf8' });
	if (compare && compare.status === 0) {
		for (const line of compare.stdout.split('\n').filter(Boolean)) {
			const [name, login] = line.split('\t');
			if (login) known.set(name, login);
		}
	}
	return [...new Set(names)].filter(name => !name.includes('[bot]')).map((name) => {
		const login = known.get(name);
		return login ? `- ${name} ([@${login}](https://github.com/${login}))` : `- ${name}`;
	});
}

/** A checkout's section for its version: changelogen's, with the contributors. */
async function section(checkout: Checkout, version: string): Promise<string> {
	const { generateMarkDown, getGitDiff, parseCommits, resolveRepoConfig } = await import('changelogen');
	const from = git(checkout.dir, ['describe', '--tags', '--abbrev=0', '--match', 'v*', 'HEAD']) ?? '';
	const config = {
		cwd: checkout.dir,
		repo: await resolveRepoConfig(checkout.dir),
		types: TYPES,
		scopeMap: {},
		tokens: {},
		from,
		to: 'HEAD',
		newVersion: version,
		output: false,
		publish: {},
		templates: { tagBody: 'v{{newVersion}}' },
		noAuthors: true,
		excludeAuthors: [],
	};
	const raw = await getGitDiff(from || undefined, 'HEAD', checkout.dir);
	// Without their authors: changelogen would look each e-mail up on a
	// service of its own, even with noAuthors.
	const commits = parseCommits(raw, config).map(commit => ({ ...commit, author: undefined as never }));
	const markdown = (await generateMarkDown(commits, config)).replace(/\n{3,}/g, '\n\n');
	const people = contributors(config.repo.repo ?? '', checkout.dir, from, raw.map(commit => commit.author.name));
	return people.length ? `${markdown}\n\n### ❤️ Contributors\n\n${people.join('\n')}` : markdown;
}

/** Every checkout's CHANGELOG.md gets the section of its version - printed instead, with --dry-run. */
async function writeChangelogs(dryRun: boolean): Promise<void> {
	const present = CHECKOUTS.filter(checkout => existsSync(join(checkout.dir, checkout.manifest)));
	const sections = await Promise.all(present.map(async (checkout) => {
		const version = String(JSON.parse(readFileSync(join(checkout.dir, checkout.manifest), 'utf8')).version);
		return { checkout, version, text: releaseNotes(checkout.dir, version) === null ? await section(checkout, version) : null };
	}));
	for (const { checkout, version, text } of sections) {
		const name = basename(checkout.dir);
		if (text === null) {
			console.log(`${name}: CHANGELOG.md has v${version} already`);
		} else if (dryRun) {
			console.log(`\n== ${name}: CHANGELOG.md would get\n\n${text}\n`);
		} else {
			const file = join(checkout.dir, 'CHANGELOG.md');
			writeFileSync(file, prependSection(existsSync(file) ? readFileSync(file, 'utf8') : null, text));
			console.log(`${name}: CHANGELOG.md has v${version} - read it, add a word above the groups where it helps, commit it`);
		}
	}
	for (const checkout of CHECKOUTS.filter(each => !present.includes(each))) console.log(`${basename(checkout.dir)}: not checked out beside the core - skipped`);
}

/** The GitHub Release of `tag` in the repository at `dir`, with its section as the notes: created, or its notes replaced. */
function githubRelease(dir: string, tag: string, dryRun: boolean): void {
	const notes = releaseNotes(dir, tag.replace(/^v/, ''));
	if (notes === null) throw new ChangelogError(`${join(dir, 'CHANGELOG.md')} has no section ${tag}: bun run changelog, commit it, then tag again`);
	const repo = process.env.GITHUB_REPOSITORY ?? git(dir, ['remote', 'get-url', 'origin'])?.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1];
	if (!repo) throw new ChangelogError(`${dir}: no GitHub repository - set GITHUB_REPOSITORY`);
	const file = join(mkdtempSync(join(tmpdir(), 'amxts-notes-')), 'notes.md');
	writeFileSync(file, `${notes}\n`);
	const gh = (args: string[]) => {
		if (dryRun) return console.log(`(dry run) gh ${args.join(' ')}`);
		const result = spawnSync('gh', args, { stdio: 'inherit' });
		if (result.status !== 0) throw new ChangelogError(`gh ${args.join(' ')} failed (exit ${result.status})`);
	};
	const exists = spawnSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' }).status === 0;
	console.log(`${repo} ${tag}:\n\n${notes}\n`);
	gh(exists
		? ['release', 'edit', tag, '--repo', repo, '--notes-file', file]
		: ['release', 'create', tag, '--repo', repo, '--verify-tag', '--title', `${repo.split('/')[1]} ${tag}`, '--notes-file', file]);
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const dryRun = args.includes('--dry-run');
	try {
		if (args[0] === 'release') {
			const dir = args.includes('--dir') ? resolve(args[args.indexOf('--dir') + 1]) : process.cwd();
			if (!/^v\d/.test(args[1] ?? '')) throw new ChangelogError('bun run changelog release v<version> [--dir <repo>] [--dry-run]');
			githubRelease(dir, args[1], dryRun);
		} else {
			await writeChangelogs(dryRun);
		}
	} catch (error) {
		if (!(error instanceof ChangelogError)) throw error;
		process.stderr.write(`✖ ${error.message}\n`);
		process.exit(1);
	}
}
