// A release line's branch: the tag of a new minor version (v0.N.0) cuts
// 0.N.x at its commit, in the repository it was released from. main is the
// next version; 0.N.x takes the fixes for the released one - docs or code -
// and is merged forward into main. The site shows the docs of the core's
// highest 0.N.x, and each module's README from its own.
//
//   bun scripts/release-line.ts <tag> [--repo <owner/name>] [--dry-run]
//
// The repository is --repo, else GITHUB_REPOSITORY in CI, else amxts/amxts.
// A patch's tag (v0.N.1) is on its line already, and a line that exists is
// left as it is. `gh` does the talking (GH_TOKEN in CI, with contents: write).
// release.ts's publish cuts the core's line; the other repositories' release
// workflow (release-notes.yml) runs this.
import { spawnSync } from 'node:child_process';
import process from 'node:process';

/** The branch of a tag's release line, when the tag starts one: v0.2.0 is 0.2.x. */
export function newLine(tag: string): string | null {
	const minor = /^v(\d+)\.(\d+)\.0$/.exec(tag);
	return minor ? `${minor[1]}.${minor[2]}.x` : null;
}

function gh(argv: string[]): { ok: boolean; out: string } {
	const result = spawnSync('gh', argv, { encoding: 'utf-8', shell: process.platform === 'win32' });
	if (result.error) throw new Error(`gh did not start: ${result.error.message} - https://cli.github.com`);
	return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

/** Cuts the line `tag` starts, at the tag's commit in `repo`; what it did, in words. */
export function cutLine(tag: string, repo: string, dryRun = false): string {
	const branch = newLine(tag);
	if (!branch) return `${tag} starts no release line`;
	if (gh(['api', `repos/${repo}/git/ref/heads/${branch}`, '--silent']).ok) return `${repo} has ${branch} already`;
	const commit = gh(['api', `repos/${repo}/commits/${tag}`, '--jq', '.sha']);
	if (!commit.ok) throw new Error(`${repo} has no ${tag}: ${commit.out}`);
	if (dryRun) return `(dry run) ${branch} would be cut at ${tag} (${commit.out.slice(0, 10)}) in ${repo}`;
	const made = gh(['api', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${commit.out}`, '--silent']);
	if (!made.ok) throw new Error(`${branch} was not cut in ${repo}: ${made.out}`);
	return `${branch} cut at ${tag} in ${repo}`;
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
		console.log(cutLine(tag, repo, args.includes('--dry-run')));
	} catch (error) {
		process.stderr.write(`✖ ${(error as Error).message}\n`);
		process.exit(1);
	}
}
