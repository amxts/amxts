// A release is published only whole: both systems, every file attached, one
// version and one commit (scripts/release-check.ts).
import type { Manifest } from '../scripts/release-check';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { changelogSection, prependSection } from '../scripts/changelog';
import { releaseProblems } from '../scripts/release-check';

function manifest(system: 'windows' | 'linux', over: Partial<Manifest> = {}): Manifest {
	const files = system === 'windows'
		? [{ name: 'amxts_amxx.dll', size: 100, sha256: 'a' }, { name: 'amxts-server-windows-x64.zip', size: 200, sha256: 'b' }]
		: [{ name: 'amxts_amxx_i386.so', size: 300, sha256: 'c' }, { name: 'amxts-server-linux-x64.tar.gz', size: 400, sha256: 'd' }];
	return { name: 'amxts', version: '0.1.0', tag: 'v0.1.0', system, commit: 'abc123', dirty: false, built: '2026-09-28T00:00:00Z', files, ...over };
}

const assetsOf = (...manifests: Manifest[]) => manifests.flatMap(one => [...one.files.map(({ name, size }) => ({ name, size })), { name: `amxts-${one.system}.json`, size: 1 }]);

test('both systems of one version and commit, every file attached: nothing stands in the way', () => {
	const both = [manifest('windows'), manifest('linux')];
	expect(releaseProblems('v0.1.0', both, assetsOf(...both))).toEqual([]);
});

test('a system missing', () => {
	const linux = [manifest('linux')];
	expect(releaseProblems('v0.1.0', linux, assetsOf(...linux))).toEqual(['no windows build: amxts-windows.json is not attached']);
});

test('versions, tags and commits that disagree', () => {
	const both = [manifest('windows', { version: '0.1.1', tag: 'v0.1.1' }), manifest('linux', { commit: 'def456' })];
	const problems = releaseProblems('v0.1.0', both, assetsOf(...both));
	expect(problems).toContain('windows: version 0.1.1, the tag is v0.1.0');
	expect(problems).toContain('windows: built for v0.1.1, the release is v0.1.0');
	expect(problems.some(problem => problem.startsWith('the systems were built from different commits'))).toBe(true);
});

test('a file not attached, or not the size it was built', () => {
	const both = [manifest('windows'), manifest('linux', { dirty: true })];
	const assets = assetsOf(...both).filter(asset => asset.name !== 'amxts_amxx.dll').map(asset => (asset.name === 'amxts_amxx_i386.so' ? { ...asset, size: 1 } : asset));
	expect(releaseProblems('v0.1.0', both, assets)).toEqual([
		'windows: amxts_amxx.dll is not attached',
		'linux: built from a working tree with uncommitted changes',
		'linux: amxts_amxx_i386.so is 1 bytes attached, 300 built',
	]);
});

// A release's notes are its version's section of CHANGELOG.md (scripts/changelog.ts).
const CHANGELOG = '# Changelog\n\n## v0.2.0\n\nWhat is new.\n\n### 🩹 Fixes\n\n- **build:** A fix\n\n## v0.1.0\n\nThe first release.\n';

test('the notes of a version are its section, without its heading', () => {
	expect(changelogSection(CHANGELOG, '0.2.0')).toBe('What is new.\n\n### 🩹 Fixes\n\n- **build:** A fix');
	expect(changelogSection(CHANGELOG, '0.1.0')).toBe('The first release.');
	expect(changelogSection('# Changelog\n\n## 0.1.0\n\nWithout a v.\n', '0.1.0')).toBe('Without a v.');
	expect(changelogSection(CHANGELOG, '0.1.1')).toBeNull();
	expect(changelogSection(CHANGELOG, '0.2')).toBeNull();
});

test('a new section goes above the newest one, or starts the changelog', () => {
	expect(prependSection(CHANGELOG, '## v0.3.0\n\n- Next')).toBe(`# Changelog\n\n## v0.3.0\n\n- Next\n\n${CHANGELOG.slice('# Changelog\n\n'.length)}`);
	expect(prependSection(null, '## v0.1.0\n\n- First')).toBe('# Changelog\n\n## v0.1.0\n\n- First\n');
	expect(prependSection('# Changelog\n', '## v0.1.0')).toBe('# Changelog\n\n## v0.1.0\n');
});
