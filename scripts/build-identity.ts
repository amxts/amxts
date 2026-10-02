// The build a module and the compiler beside it on a server are of: the
// version and the commit, as a release's manifest names them -
// `0.2.0+1bf291c0ab`, SemVer's build metadata.
//
// `bun run generate` writes it into the module (runtime/src/embedded.h), and
// `bun run serverkit` builds amxts-compile with the one read back from there,
// so the two agree whenever they come from one build. Before it compiles a
// plugin's source, the module asks the compiler for its build
// (`amxts-compile --version`) and refuses one of another: the module writes
// the API a plugin imports, and a compiler of another release reads it with
// another AssemblyScript, which fails with errors that say nothing of why.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import pkg from '../package.json';

/** This checkout's build: the version, and the commit when git knows it. */
export function buildIdentity(): string {
	const git = spawnSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf-8' });
	const commit = git.status === 0 ? git.stdout.trim() : '';
	return commit ? `${pkg.version}+${commit}` : pkg.version;
}

/** The build the generated module carries, or null before `bun run generate`. */
export function moduleBuild(): string | null {
	const header = './runtime/src/embedded.h';
	if (!existsSync(header)) return null;
	return /^#define AMXTS_BUILD "([^"]*)"$/m.exec(readFileSync(header, 'utf-8'))?.[1] ?? null;
}

/** The `--define` that builds amxts-compile as of `build`. */
export function buildDefine(build: string): string {
	return `--define=AMXTS_BUILD=${JSON.stringify(build)}`;
}
