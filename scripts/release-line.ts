// A release line's branch, 0.N.x: main is the next version, 0.N.x takes the
// fixes for the released one - docs or code - and is merged forward into
// main. The site shows the docs of the core's highest 0.N.x, and each
// module's README from its own.
//
// Every package versions on its own, so a tag is a line's in the repository
// it was released from:
//
// - a new minor version (v0.N.0) cuts 0.N.x at its commit;
// - a patch (v0.N.1) brings 0.N.x up to it. One tagged on the line is there
//   already; one tagged on main - a module whose main is still that minor
//   version - moves the line on, by a fast-forward, or by a merge when the
//   line has commits of its own. A line that does not take the tag cleanly is
//   left as it is, and the words say so; a line that is missing is cut at it.
//
//   bun scripts/release-line.ts <tag> [--repo <owner/name>] [--dry-run]
//
// The repository is --repo, else GITHUB_REPOSITORY in CI, else amxts/amxts.
// `gh` does the talking (GH_TOKEN in CI, with contents: write). release.ts's
// publish does the core's line; the other repositories' release workflow
// (release-notes.yml) runs this.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** A tag's release line, and whether the tag is a patch of it: v0.2.0 is 0.2.x, v0.2.1 a patch of it. */
export function lineOf(tag: string): { branch: string; patch: boolean } | null {
	const version = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
	return version ? { branch: `${version[1]}.${version[2]}.x`, patch: version[3] !== '0' } : null;
}

function gh(argv: string[]): { ok: boolean; out: string } {
	const result = spawnSync('gh', argv, { encoding: 'utf-8', shell: process.platform === 'win32' });
	if (result.error) throw new Error(`gh did not start: ${result.error.message} - https://cli.github.com`);
	return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

/** Cuts or brings up the line of `tag`, in `repo`; what it did, in words. */
export function releaseLine(tag: string, repo: string, dryRun = false): string {
	const line = lineOf(tag);
	if (!line) return `${tag} is on no release line`;
	const { branch, patch } = line;
	const exists = gh(['api', `repos/${repo}/git/ref/heads/${branch}`, '--silent']).ok;
	if (exists && !patch) return `${repo} has ${branch} already`;
	const commit = gh(['api', `repos/${repo}/commits/${tag}`, '--jq', '.sha']);
	if (!commit.ok) throw new Error(`${repo} has no ${tag}: ${commit.out}`);
	const sha = commit.out;
	const at = `${tag} (${sha.slice(0, 10)})`;

	if (!exists) {
		if (dryRun) return `(dry run) ${branch} would be cut at ${at} in ${repo}`;
		const made = gh(['api', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${sha}`, '--silent']);
		if (!made.ok) throw new Error(`${branch} was not cut in ${repo}: ${made.out}`);
		return `${branch} cut at ${tag} in ${repo}`;
	}

	// The tag against the line: ahead of it, the line's own commits beside it, or in it.
	const compared = gh(['api', `repos/${repo}/compare/${branch}...${sha}`, '--jq', '.status']);
	if (!compared.ok) throw new Error(`${tag} was not compared with ${branch} in ${repo}: ${compared.out}`);
	if (compared.out === 'identical' || compared.out === 'behind') return `${repo}'s ${branch} has ${tag} already`;
	const how = compared.out === 'ahead' ? 'fast-forwarded' : 'merged';
	if (dryRun) return `(dry run) ${branch} would be ${how} to ${at} in ${repo}`;
	const moved = compared.out === 'ahead'
		? gh(['api', '-X', 'PATCH', `repos/${repo}/git/refs/heads/${branch}`, '-f', `sha=${sha}`, '-F', 'force=false', '--silent'])
		: gh(['api', `repos/${repo}/merges`, '-f', `base=${branch}`, '-f', `head=${sha}`, '-f', `commit_message=Merge ${tag} into ${branch}`, '--silent']);
	return moved.ok ? `${branch} ${how} to ${tag} in ${repo}` : `${branch} left as it is in ${repo}: it does not take ${tag} cleanly - merge it by hand (${moved.out})`;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const at = args.indexOf('--repo');
	const repo = at >= 0 ? args[at + 1] : process.env.GITHUB_REPOSITORY ?? 'amxts/amxts';
	const tag = args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--repo');
	if (!tag || !repo) {
		process.stderr.write('bun scripts/release-line.ts <tag> [--repo <owner/name>] [--dry-run]\n');
		process.exit(1);
	}
	try {
		console.log(releaseLine(tag, repo, args.includes('--dry-run')));
	} catch (error) {
		process.stderr.write(`✖ ${(error as Error).message}\n`);
		process.exit(1);
	}
}
