// The packages as a user gets them, before they go to npm: published to the
// local registry (bun run publish:local --reset), then a project created from
// it in an empty folder outside the checkouts - built, tested and type-checked,
// its modules taken as they came compiled.
//
//   bun run publish:check [--wamrc <folder>] [--skip-generate] [--keep]
//
// Nothing of the checkouts reaches the project: npm installs the packages from
// the registry, with a cache of its own, and whatever else they need from npm
// through it. The project is for `--target hlds`, so no includes are fetched
// from GitHub. The folder is removed when everything passes, unless --keep;
// the registry keeps running (bun run publish:local --stop).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VERSION = String(JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8')).version);
const REGISTRY = 'http://localhost:4873/';
const WINDOWS = process.platform === 'win32';
const args = process.argv.slice(2);

function fail(message: string): never {
	process.stderr.write(`\nthe check failed: ${message}\n`);
	process.exit(1);
}

/** Runs a step, its output to the terminal; a failed one ends the check. */
function step(title: string, cwd: string, file: string, argv: string[], env: NodeJS.ProcessEnv = process.env) {
	console.log(`\n== ${title}\n   ${[file, ...argv].join(' ')}`);
	const result = spawnSync(file, argv, { cwd, env, stdio: 'inherit', shell: WINDOWS && !/[\\/]/.test(file) });
	if (result.status !== 0) fail(`${title} (exit ${result.status ?? result.error?.message})`);
}

step('the packages, into the local registry', CORE, process.execPath, ['scripts/publish.ts', 'local', '--reset', ...args.filter(arg => arg !== '--keep')]);

const folder = realpathSync(mkdtempSync(join(tmpdir(), 'amxts-check-')));
// The user's shell, without this checkout's settings - AMXTS_*, and the npm_*
// that `bun run` sets - and with the registry and a cache of its own.
const env: NodeJS.ProcessEnv = {
	...Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(?:amxts_|npm_)/i.test(name))),
	NPM_CONFIG_REGISTRY: REGISTRY,
	npm_config_cache: join(folder, '.npm-cache'),
	// npm create asks before it installs create-amxts: nobody is there to answer.
	npm_config_yes: 'true',
};
const project = join(folder, 'my-server');
console.log(`\nthe project: ${project}`);

step('npm create amxts', folder, 'npm', ['create', `amxts@${VERSION}`, 'my-server', '--', '--yes', '--pm', 'npm', '--modules', 'menu-core', '--target', 'hlds', '--no-git'], env);
step('amxts module add', project, 'npx', ['amxts', 'module', 'add', 'resemiclip'], env);
step('amxts info', project, 'npx', ['amxts', 'info'], env);
step('amxts build', project, 'npx', ['amxts', 'build'], env);
step('amxts test', project, 'npx', ['amxts', 'test'], env);
step('amxts typecheck', project, 'npx', ['amxts', 'typecheck'], env);

// What it ran on: the registry's packages, installed into the project.
const core = realpathSync(join(project, 'node_modules/@amxts/core'));
const wamrc = join(project, 'node_modules', `@amxts/wamrc-${process.platform}-${process.arch}`, WINDOWS ? 'wamrc.exe' : 'wamrc');
const problems = [
	!core.startsWith(folder) && `@amxts/core is ${core}, outside the project`,
	existsSync(join(core, '.git')) && '@amxts/core is a checkout',
	!existsSync(wamrc) && `no ${wamrc}`,
	!existsSync(join(core, 'node_modules/assemblyscript/std/assembly.json')) && 'no bundled assemblyscript typings in @amxts/core',
	!readdirSync(join(project, 'dist')).some(file => file.endsWith('.aot')) && 'no .aot in dist/',
	// The modules came compiled, and the build took them as they came.
	...['menu-core', 'config-core'].map((name) => {
		const prebuilt = join(project, 'node_modules/@amxts', name, 'prebuilt', WINDOWS ? 'windows' : 'linux', `${name}.aot`);
		const built = join(project, 'dist', `${name}.aot`);
		return !(existsSync(prebuilt) && existsSync(built) && readFileSync(prebuilt).equals(readFileSync(built))) && `dist/${name}.aot is not the one @amxts/${name} came with`;
	}),
].filter(Boolean);
if (problems.length) fail(problems.join('; '));

console.log(`\nas a user: create, module add, info, build, test and typecheck pass with the packages of ${REGISTRY} (${VERSION}).`);
if (args.includes('--keep')) console.log(`The project stays: ${project}`);
else rmSync(folder, { recursive: true, force: true });
