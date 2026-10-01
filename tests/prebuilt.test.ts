import type { PrebuiltManifest } from '../scripts/prebuilt';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// A module that comes compiled (scripts/prebuilt.ts): its package carries
// its .aot for each system and what it was compiled from, and a build takes
// it while the project would compile the same - else it says why not.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { prebuiltOf } from '../scripts/prebuilt';
import { CORE_DIR, CORE_PLUGINS, setProjectDir, sourcesFor } from '../scripts/project';
import { wamrcPath } from '../scripts/system';

setDefaultTimeout(240_000);

const HERE = process.cwd();
const dir = join(tmpdir(), 'amxts-prebuilt-test');
const greeter = join(dir, 'node_modules/@test/greeter');
const manifestFile = join(greeter, 'prebuilt/manifest.json');

const GREETER = [
	'import { Forward, server } from "@amxts/core";',
	'',
	'export interface GreeterOptions {',
	'\tgreeting: string;',
	'\ttimes: number;',
	'}',
	'',
	'export default defineModule<GreeterOptions>({',
	'\tmeta: { name: "greeter", configKey: "greeter" },',
	'\tdefaults: { greeting: "Hello", times: 1 },',
	'\tsetup(options) {',
	'\t\tgreeting = options.greeting;',
	'\t},',
	'});',
	'',
	'let greeting = "";',
	'const greeted = new Forward<number>("greeter_greeted");',
	'',
	'export function greet(name: string) {',
	'\tgreeted.emit(server.maxPlayers);',
	'\treturn `${greeting}, ${name}`;',
	'}',
	'',
].join('\n');

function write(path: string, text: string) {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
}

/** amxts.config.ts with these lines in the object; a new time, so the project is read again. */
function config(extra = '') {
	write('amxts.config.ts', `export default defineConfig({ modules: ["@test/greeter"],${extra} });\n`);
	const later = new Date(Date.now() + 2000 * Math.random() + 1000);
	utimesSync(join(dir, 'amxts.config.ts'), later, later);
}

const manifest = (): PrebuiltManifest => JSON.parse(readFileSync(manifestFile, 'utf8'));
const original = { manifest: '' };

/** The prebuilt module's .aot for `system`, or why the build compiles it. */
function use(system: 'windows' | 'linux' = 'windows') {
	const sources = sourcesFor(CORE_PLUGINS);
	const pkg = sources.project.modules.find(each => each.name === '@test/greeter')!;
	return prebuiltOf(pkg, system, sources);
}

/** `use()` with the manifest changed by `edit`, then as it was. */
function withManifest(edit: (manifest: PrebuiltManifest) => unknown) {
	const changed = manifest();
	edit(changed);
	writeFileSync(manifestFile, JSON.stringify(changed));
	try {
		return use();
	} finally {
		writeFileSync(manifestFile, original.manifest);
	}
}

afterAll(() => {
	setProjectDir(HERE);
	rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!existsSync(wamrcPath()))('a module that comes compiled', () => {
	test('compiled for both systems from one wasm, with what it was compiled from', () => {
		rmSync(dir, { recursive: true, force: true });
		write('package.json', '{ "name": "my-server", "private": true }\n');
		write('plugins/.keep', '');
		write('node_modules/@test/greeter/package.json', JSON.stringify({ name: '@test/greeter', version: '1.2.3', description: 'greets', files: ['src'], amxts: { module: 'src/index.ts' } }));
		write('node_modules/@test/greeter/src/index.ts', GREETER);
		config();
		// As the release compiles it: none of this machine's settings.
		const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('AMXTS_')));
		const run = spawnSync(process.execPath, [join(CORE_DIR, 'scripts/prebuilt.ts')], { cwd: dir, env, encoding: 'utf8' });
		expect(`${run.stdout}${run.stderr}`).toContain('prebuilt greeter');
		expect(run.status).toBe(0);
		original.manifest = readFileSync(manifestFile, 'utf8');

		const made = manifest();
		expect(Object.keys(made.systems)).toEqual(['windows', 'linux']);
		expect(Object.keys(made.from)).toEqual(['@amxts/core', '@test/greeter']);
		expect(made.options).toEqual({ '@test/greeter': { greeting: 'Hello', times: 1 } });
		// A number crosses as an include declares it: the declaration is part of the build.
		expect(made.forwards).toEqual({ greeter_greeted: null });
		expect(made.places).toContain('facade.ts');
		expect(made.places).toContain('modules/greeter.ts');
		setProjectDir(dir);
	});

	test('a build takes it as it came, for the server\'s system', () => {
		const windows = use('windows');
		expect(windows && 'aot' in windows && Buffer.from(windows.aot).equals(readFileSync(join(greeter, 'prebuilt/windows/greeter.aot')))).toBe(true);
		const linux = use('linux');
		expect(linux && 'aot' in linux && Buffer.from(linux.aot).equals(readFileSync(join(greeter, 'prebuilt/linux/greeter.aot')))).toBe(true);
	});

	test('what the project would compile otherwise is said, and compiled', () => {
		expect(withManifest(made => Object.assign(made.from['@amxts/core'], { version: '0.0.1' }))).toEqual({ why: expect.stringContaining('greeter 1.2.3 was built for @amxts/core 0.0.1, the project has') });
		// The core here is a checkout: its content counts, not only its version.
		expect(withManifest(made => Object.assign(made.from['@amxts/core'], { hash: 'another' }))).toEqual({ why: expect.stringContaining('greeter 1.2.3 was built from another @amxts/core') });
		expect(withManifest(made => Object.assign(made.forwards, { greeter_greeted: '[["Float",false]]' }))).toEqual({ why: 'the includes declare the forward greeter_greeted otherwise than when greeter 1.2.3 was built' });
		expect(withManifest(made => delete made.systems.linux)).toEqual(use());
		expect(withManifest(made => delete made.systems.windows)).toEqual({ why: 'greeter 1.2.3 comes compiled for Linux, not Windows' });
		expect(withManifest(made => Object.assign(made.systems.windows!, { sha256: '0' }))).toEqual({ why: 'greeter 1.2.3: prebuilt/windows/greeter.aot is not the file its manifest lists' });

		config(' greeter: { times: 2 },');
		expect(use()).toEqual({ why: 'greeter 1.2.3 was built with its default options, and amxts.config.ts sets greeter' });
		config();

		write('plugins/facade.ts', 'export const x = 1;\n');
		expect(use()).toEqual({ why: 'plugins/facade.ts takes the place of a file greeter 1.2.3 was built from' });
		rmSync(join(dir, 'plugins/facade.ts'));
		expect(use()).toHaveProperty('aot');
	});

	test('a module in a folder of the project is compiled as any plugin is', () => {
		cpSync(greeter, join(dir, 'modules/greeter'), { recursive: true });
		config();
		expect(use()).toBeNull();
		rmSync(join(dir, 'modules'), { recursive: true });
		config();
	});
});
