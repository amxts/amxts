/**
 * The build a module and the compiler beside it on a server are of: the
 * module carries it, amxts-compile is built as the same one, and
 * `amxts-compile --version` says it - what the module asks before it compiles
 * a plugin's source, refusing a compiler of another build.
 */
import { spawnSync } from 'node:child_process';
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import pkg from '../package.json';
import { buildDefine, buildIdentity } from '../scripts/build-identity';

test('a build is the version and the commit', () => {
	const commit = spawnSync('git', ['rev-parse', '--short=10', 'HEAD'], { encoding: 'utf-8' }).stdout.trim();
	expect(buildIdentity()).toBe(`${pkg.version}+${commit}`);
});

test('the compiler says the build it is built as', () => {
	const version = (...define: string[]) =>
		spawnSync(process.execPath, [...define, 'scripts/compile-one.ts', '--version'], { encoding: 'utf-8' }).stdout;

	expect(version(buildDefine('0.2.0+1bf291c0ab'))).toBe('0.2.0+1bf291c0ab\n');
	expect(version()).toBe('unknown\n');
});
