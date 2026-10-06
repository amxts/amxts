// A release: one GitHub Release per tag, a draft until both systems' files
// are on it.
//
//   bun run release:windows [--dry-run]   build the Windows files on Windows, attach them
//   bun run release:linux   [--dry-run]   the same for Linux (CI on a tag; on Windows through Docker)
//   bun run release:upload  [--dry-run]   attach what dist-release/ holds for the tag
//   bun run release:publish [--dry-run]   check both are there, of one version, then publish
//
// Each system's build makes dist-release/<system>/: the module, amxts-compile,
// wamrc, the server kit as one archive, and amxts-<system>.json - the version,
// the tag, the commit and every file's size and sha256. It finds the draft
// release of the tag, or creates it with the version's section of
// CHANGELOG.md as its notes (scripts/changelog.ts; a release that is already
// published is left alone), and attaches the files; --no-upload stops at
// dist-release/. CI builds each system in a job of its own with --no-upload
// and attaches both from one (`upload`), so the draft is made once. `publish`
// reads both manifests back from the release and refuses while a system is
// missing, a file is not attached or differs in size, or the versions, tags
// or commits disagree (scripts/release-check.ts); then it takes the draft off
// and cuts its release line's branch 0.N.x at a new minor version's tag, or
// brings it up to a patch's (scripts/release-line.ts).
//
// The tag is --tag, else GITHUB_REF_NAME in CI, else the tag at HEAD, and must
// be v<package.json's version>. The repository is AMXTS_RELEASE_REPO, else
// GITHUB_REPOSITORY in CI, else amxts/amxts; `gh` does the talking and needs
// to be logged in (GH_TOKEN in CI). --dry-run builds and checks everything
// and prints the gh commands instead of running them.
//
// Options: --skip-build packs what is built already. On Windows, LLVM_DIR
// (<llvm>/lib/cmake/llvm) builds wamrc.exe too; without it the one there is
// taken, and the report says so.
import type { Asset, Manifest } from './release-check';
import type { System } from './system';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { releaseNotes } from './changelog';
import { manifestName, releaseProblems } from './release-check';
import { releaseLine } from './release-line';
import { HOST_SYSTEM, modulePath, serverFiles, SYSTEM_NAME, wamrcPath } from './system';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const command = args[0];
const dryRun = args.includes('--dry-run');
const skipBuild = args.includes('--skip-build');
const noUpload = args.includes('--no-upload');
function option(name: string): string | undefined {
	const at = args.indexOf(name);
	return at >= 0 ? args[at + 1] : undefined;
}

const pkg = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8'));
const VERSION = String(pkg.version);
const REPO = process.env.AMXTS_RELEASE_REPO ?? process.env.GITHUB_REPOSITORY ?? 'amxts/amxts';
const OUT = join(CORE, 'dist-release');

class ReleaseError extends Error {}

function run(file: string, argv: string[], options: { cwd?: string; quiet?: boolean } = {}): string {
	const result = spawnSync(file, argv, {
		cwd: options.cwd ?? CORE,
		encoding: 'utf-8',
		stdio: options.quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'],
		// bun, npm and gh may be .cmd shims on Windows.
		shell: process.platform === 'win32' && !/[\\/]/.test(file),
		maxBuffer: 64 * 1024 * 1024,
	});
	if (result.error) throw new ReleaseError(`${file} did not start: ${result.error.message}`);
	if (result.status !== 0) throw new ReleaseError(`${file} ${argv.join(' ')} failed (exit ${result.status})${options.quiet ? `\n${result.stdout}${result.stderr}` : ''}`);
	return result.stdout ?? '';
}

function step(text: string): void {
	console.log(`\n== ${text}`);
}

/** The tag this release is for, checked against the version. */
function releaseTag(): string {
	const ref = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined;
	const atHead = spawnSync('git', ['describe', '--tags', '--exact-match', 'HEAD'], { cwd: CORE, encoding: 'utf-8' });
	const tag = option('--tag') ?? ref ?? (atHead.status === 0 ? atHead.stdout.trim() : undefined);
	if (!tag) {
		if (dryRun) {
			console.log(`no tag at HEAD - a dry run goes on as v${VERSION}`);
			return `v${VERSION}`;
		}
		throw new ReleaseError(`no tag: tag the commit v${VERSION}, or pass --tag`);
	}
	if (tag !== `v${VERSION}`) throw new ReleaseError(`the tag is ${tag}, and package.json says ${VERSION}: a release is v<version>`);
	return tag;
}

function commitState(): { commit: string; dirty: boolean } {
	const commit = run('git', ['rev-parse', 'HEAD'], { quiet: true }).trim();
	// CI checks the tag out as it is; what it changes there is `bun run
	// generate` writing the tooltips into the facade's files, which a fresh
	// clone has no clean filter for - not an edit of the code.
	if (process.env.GITHUB_ACTIONS === 'true') return { commit, dirty: false };
	const dirty = run('git', ['status', '--porcelain', '--untracked-files=no'], { quiet: true }).trim() !== '';
	return { commit, dirty };
}

// ---------------------------------------------------------------- building

/** The SDKs the module is built against - AMX Mod X's, the Half-Life SDK, Metamod's headers - at the commits the Linux build pins. */
function ensureSdks(): void {
	for (const [name, repo] of [['amxmodx', 'amxmodx'], ['hlsdk', 'hlsdk'], ['metamod', 'metamod-hl1']]) {
		const want = readFileSync(join(CORE, `docker/build/${name}.commit`), 'utf8').trim();
		const dir = join(CORE, 'runtime/deps', name);
		const have = existsSync(join(dir, '.git')) ? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).stdout.trim() : '';
		if (have === want) continue;
		if (existsSync(dir)) throw new ReleaseError(`runtime/deps/${name} is at ${have || 'no commit'}, the build pins ${want}: move it aside`);
		run('git', ['init', '-q', dir]);
		run('git', ['fetch', '-q', '--depth', '1', `https://github.com/alliedmodders/${repo}`, want], { cwd: dir });
		run('git', ['checkout', '-q', 'FETCH_HEAD'], { cwd: dir });
	}
}

/** Whether a checkout has a patch applied: it reverses cleanly. */
function patched(dir: string, patch: string): boolean {
	return spawnSync('git', ['apply', '--check', '--reverse', patch], { cwd: dir, encoding: 'utf-8' }).status === 0;
}

function buildWindows(): string[] {
	if (HOST_SYSTEM !== 'windows') throw new ReleaseError('the Windows files are built on Windows (Visual Studio, cmake -A Win32)');
	const notes: string[] = [];
	step('the generated API');
	run('bun', ['run', 'generate']);
	// Before the module, which carries it.
	step('the natives\' image');
	run('bun', ['run', 'image']);

	step('amxts_amxx.dll');
	ensureSdks();
	run('cmake', ['-A', 'Win32', '-B', 'runtime/build', '-S', 'runtime']);
	run('cmake', ['--build', 'runtime/build', '--config', 'Release']);

	const wamr = join(CORE, 'runtime/deps/wamr');
	if (!patched(wamr, join(CORE, 'runtime/patches/wamr-2.4.5-amxts.patch'))) {
		throw new ReleaseError('runtime/deps/wamr does not have runtime/patches/wamr-2.4.5-amxts.patch applied');
	}
	if (process.env.LLVM_DIR) {
		step('wamrc.exe');
		const compiler = join(wamr, 'wamr-compiler');
		run('cmake', ['-B', 'build', '-S', '.', '-DWAMR_BUILD_WITH_CUSTOM_LLVM=1', `-DLLVM_DIR=${process.env.LLVM_DIR}`], { cwd: compiler });
		run('cmake', ['--build', 'build', '--config', 'Release'], { cwd: compiler });
	} else {
		notes.push(`wamrc.exe was not rebuilt (no LLVM_DIR): ${wamrcPath()} from ${new Date(statSync(wamrcPath()).mtime).toISOString()}`);
	}

	step('the server kit');
	run('bun', ['scripts/pack-server.ts', '--os', 'windows']);
	return notes;
}

function buildLinux(): string[] {
	step('the generated API');
	run('bun', ['run', 'generate']);
	step('the natives\' image');
	run('bun', ['run', 'image']);
	step('amxts_amxx_i386.so and wamrc (Docker)');
	run('bun', ['scripts/build-linux.ts']);
	step('the server kit');
	run('bun', ['scripts/pack-server.ts', '--os', 'linux']);
	return [];
}

// ---------------------------------------------------------------- packing

function sha256(file: string): string {
	return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** The files a system's release carries, by the name they are attached under. */
function releaseFiles(system: System): Record<string, string> {
	const kitWamrc = system === HOST_SYSTEM ? wamrcPath() : join(CORE, 'runtime/build/linux/wamrc');
	const [module, compile, wamrc] = serverFiles(system);
	return {
		[module.asset]: modulePath(system),
		[compile.asset]: join(CORE, 'dist-server', system, compile.path),
		[wamrc.asset]: kitWamrc,
	};
}

function pack(system: System, tag: string): string[] {
	step(`dist-release/${system}`);
	const dir = join(OUT, system);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });

	for (const [name, from] of Object.entries(releaseFiles(system))) {
		if (!existsSync(from)) throw new ReleaseError(`${from} is missing - build ${SYSTEM_NAME[system]} first`);
		copyFileSync(from, join(dir, name));
	}

	// The kit as one archive: a zip for Windows, a tar.gz for Linux, which
	// keeps the tools' execute bit when made on Linux.
	const kit = join(CORE, 'dist-server', system);
	if (!existsSync(join(kit, 'addons'))) throw new ReleaseError(`${kit} is missing - bun run serverkit --os ${system}`);
	const archive = system === 'windows' ? `amxts-server-${system}-x64.zip` : `amxts-server-${system}-x64.tar.gz`;
	// Windows' own tar (bsdtar) makes a zip; a GNU tar earlier on PATH would not.
	const tar = HOST_SYSTEM === 'windows' ? join(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe') : 'tar';
	run(tar, [system === 'windows' ? '-a' : '-z', '-c', '-f', join(dir, archive), '-C', kit, '.']);

	const { commit, dirty } = commitState();
	const files = readdirSync(dir).sort().map(name => ({ name, size: statSync(join(dir, name)).size, sha256: sha256(join(dir, name)) }));
	const manifest: Manifest = { name: 'amxts', version: VERSION, tag, system, commit, dirty, built: new Date().toISOString(), files };
	writeFileSync(join(dir, manifestName(system)), `${JSON.stringify(manifest, null, '\t')}\n`);

	for (const file of files) console.log(`  ${file.name.padEnd(36)} ${String(file.size).padStart(10)}  ${file.sha256.slice(0, 16)}`);
	console.log(`  ${manifestName(system).padEnd(36)} ${commit.slice(0, 10)}${dirty ? ' (uncommitted changes)' : ''}`);
	return [...files.map(file => join(dir, file.name)), join(dir, manifestName(system))];
}

// ---------------------------------------------------------------- GitHub

function gh(argv: string[], quiet = false): string {
	if (dryRun) {
		console.log(`  (dry run) gh ${argv.map(arg => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ')}`);
		return '';
	}
	return run('gh', argv, { quiet });
}

interface ReleaseView {
	isDraft: boolean;
	assets: Asset[];
}

function viewRelease(tag: string): ReleaseView | null {
	const result = spawnSync('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'isDraft,assets'], { encoding: 'utf-8', shell: process.platform === 'win32' });
	if (result.error) throw new ReleaseError(`gh did not start: ${result.error.message} - https://cli.github.com`);
	if (result.status !== 0) return null;
	return JSON.parse(result.stdout) as ReleaseView;
}

function upload(tag: string, files: string[]): void {
	step(`the draft release ${tag} of ${REPO}`);
	if (!dryRun) {
		const release = viewRelease(tag);
		if (release && !release.isDraft) throw new ReleaseError(`${tag} is published already: a published release is not changed`);
		if (!release) createRelease(tag);
	} else {
		createRelease(tag);
	}
	gh(['release', 'upload', tag, ...files, '--repo', REPO, '--clobber']);
}

function createRelease(tag: string): void {
	const changes = releaseNotes(CORE, VERSION);
	if (changes === null && !dryRun) throw new ReleaseError(`CHANGELOG.md has no section v${VERSION}: bun run changelog, commit it, then tag again`);
	const notes = [
		changes ?? '(dry run: CHANGELOG.md has no section for this version yet)',
		'',
		'### 📦 Files',
		'',
		'- `amxts-server-windows-x64.zip`, `amxts-server-linux-x64.tar.gz` - the server kit: the module, and the compiler for `.ts` plugins written on the server.',
		'- `amxts_amxx.dll`, `amxts_amxx_i386.so` - the module alone.',
		'- `amxts-compile-*`, `wamrc-*` - the on-server compiler and WAMR\'s AOT compiler, per system.',
		'- `amxts-windows.json`, `amxts-linux.json` - what each was built from, with every file\'s sha256.',
	].join('\n');
	const file = join(mkdtempSync(join(tmpdir(), 'amxts-release-')), 'notes.md');
	writeFileSync(file, `${notes}\n`);
	// --verify-tag: the tag has to be on GitHub already; gh would otherwise make
	// one from the default branch.
	gh(['release', 'create', tag, '--repo', REPO, '--draft', '--verify-tag', '--title', `amxts ${tag}`, '--notes-file', file]);
}

/** What dist-release/ holds for this tag, by system: each system's files and its manifest. */
function packed(tag: string): string[] {
	const systems = existsSync(OUT) ? readdirSync(OUT).filter(system => existsSync(join(OUT, system, manifestName(system as System)))) : [];
	const files = systems.flatMap((system) => {
		const manifest = JSON.parse(readFileSync(join(OUT, system, manifestName(system as System)), 'utf8')) as Manifest;
		if (manifest.tag !== tag) {
			console.log(`  ${system}: packed for ${manifest.tag}, not ${tag} - left out`);
			return [];
		}
		console.log(`  ${system}: ${manifest.files.length} files, ${manifest.commit.slice(0, 10)}`);
		return [...manifest.files.map(each => join(OUT, system, each.name)), join(OUT, system, manifestName(system as System))];
	});
	if (files.length === 0) throw new ReleaseError(`dist-release/ holds nothing for ${tag}: bun run release:windows|linux --no-upload first`);
	return files;
}

/** Both manifests and the assets: from the release, or with --local from dist-release. */
function readRelease(tag: string, local: boolean): { manifests: Manifest[]; assets: Asset[]; isDraft: boolean } {
	if (local) {
		const manifests: Manifest[] = [];
		const assets: Asset[] = [];
		for (const system of existsSync(OUT) ? readdirSync(OUT) : []) {
			for (const name of readdirSync(join(OUT, system))) {
				assets.push({ name, size: statSync(join(OUT, system, name)).size });
				if (/^amxts-\w+\.json$/.test(name)) manifests.push(JSON.parse(readFileSync(join(OUT, system, name), 'utf8')));
			}
		}
		return { manifests, assets, isDraft: true };
	}
	const release = viewRelease(tag);
	if (!release) throw new ReleaseError(`${REPO} has no release ${tag}`);
	const dir = mkdtempSync(join(tmpdir(), 'amxts-release-'));
	run('gh', ['release', 'download', tag, '--repo', REPO, '--pattern', 'amxts-*.json', '--dir', dir], { quiet: true });
	const manifests = readdirSync(dir).map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as Manifest);
	return { manifests, assets: release.assets, isDraft: release.isDraft };
}

function publish(tag: string): void {
	const local = args.includes('--local');
	step(`checking ${local ? 'dist-release' : `the release ${tag} of ${REPO}`}`);
	const { manifests, assets, isDraft } = readRelease(tag, local);
	for (const manifest of manifests) console.log(`  ${SYSTEM_NAME[manifest.system].padEnd(8)} ${manifest.version} ${manifest.commit.slice(0, 10)}, ${manifest.files.length} files, built ${manifest.built}`);
	const problems = releaseProblems(tag, manifests, assets);
	if (problems.length) throw new ReleaseError(`not published:\n${problems.map(problem => `  - ${problem}`).join('\n')}`);
	console.log(isDraft ? '  both systems are there, of one version and one commit' : `${tag} is published already`);
	if (local) return;
	if (isDraft) {
		gh(['release', 'edit', tag, '--repo', REPO, '--draft=false']);
		if (!dryRun) console.log(`✅ ${tag} published`);
	}
	// Its release line: 0.N.x cut at a new minor version, brought up to a patch.
	try {
		console.log(`  ${releaseLine(tag, REPO, dryRun)}`);
	} catch (error) {
		throw new ReleaseError((error as Error).message);
	}
}

// ---------------------------------------------------------------- main

try {
	if (command === 'windows' || command === 'linux') {
		const tag = releaseTag();
		const { dirty } = commitState();
		if (dirty && !dryRun) throw new ReleaseError('the working tree has uncommitted changes: a release is built from a commit');
		const notes = skipBuild ? [] : command === 'windows' ? buildWindows() : buildLinux();
		const files = pack(command, tag);
		if (!noUpload) upload(tag, files);
		for (const note of notes) console.log(`note: ${note}`);
		const where = dryRun || noUpload ? ' are in dist-release, not uploaded' : ' are on the draft release; bun run release:publish once both systems are there';
		console.log(`\n${dryRun ? '(dry run) ' : ''}✅ ${SYSTEM_NAME[command]} files for ${tag}${where}`);
	} else if (command === 'upload') {
		const tag = releaseTag();
		step(`dist-release/ for ${tag}`);
		upload(tag, packed(tag));
		console.log(`\n${dryRun ? '(dry run) ' : ''}✅ dist-release/ is on the draft release ${tag}`);
	} else if (command === 'publish') {
		publish(releaseTag());
	} else {
		throw new ReleaseError('bun scripts/release.ts windows|linux|upload|publish [--tag v<version>] [--dry-run] [--skip-build] [--no-upload] [--local]');
	}
} catch (error) {
	if (!(error instanceof ReleaseError)) throw error;
	process.stderr.write(`✖ ${error.message}\n`);
	process.exit(1);
}
