import type { PrebuiltManifest } from '../scripts/prebuilt';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// A module that comes compiled (scripts/prebuilt.ts): its package carries
// its .aot for each system, its surface - what a plugin that uses it compiles
// against - and what they were made from, and a build takes them while the
// project would make the same - else it says why not. A core is its ABI: the
// module is compiled here as 0.9.1 and taken as 0.9.2, another patch of its
// line with the same hood, as the server's module of that line loads it.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { prebuiltOf, prebuiltSurface } from '../scripts/prebuilt';
import { CORE_DIR, CORE_PLUGINS, setProjectDir, sourcesFor } from '../scripts/project';
import { moduleSurface } from '../scripts/shared-modules';
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

function greeterPackage() {
	const sources = sourcesFor(CORE_PLUGINS);
	return { sources, pkg: sources.project.modules.find(each => each.name === '@test/greeter')! };
}

/** The prebuilt module's .aot for `system`, or why the build compiles it. */
function use(system: 'windows' | 'linux' = 'windows') {
	const { sources, pkg } = greeterPackage();
	return prebuiltOf(pkg, system, sources);
}

/** `read()` with the core built as `version`, then as 0.9.2 again. */
function asVersion<T>(version: string, read: () => T): T {
	process.env.AMXTS_AS_VERSION = version;
	try {
		return read();
	} finally {
		process.env.AMXTS_AS_VERSION = '0.9.2';
	}
}

/** The surface the module came with, or why the build analyses it. */
function surface() {
	const { sources, pkg } = greeterPackage();
	return prebuiltSurface(pkg, sources);
}

/** `read()` with the manifest changed by `edit`, then as it was. */
function withManifest<T>(edit: (manifest: PrebuiltManifest) => unknown, read: () => T = use as () => T): T {
	const changed = manifest();
	edit(changed);
	writeFileSync(manifestFile, JSON.stringify(changed));
	try {
		return read();
	} finally {
		writeFileSync(manifestFile, original.manifest);
	}
}

const asVersionBefore = process.env.AMXTS_AS_VERSION;

afterAll(() => {
	if (asVersionBefore === undefined) delete process.env.AMXTS_AS_VERSION;
	else process.env.AMXTS_AS_VERSION = asVersionBefore;
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
		const run = spawnSync(process.execPath, [join(CORE_DIR, 'scripts/prebuilt.ts')], { cwd: dir, env: { ...env, AMXTS_AS_VERSION: '0.9.1' }, encoding: 'utf8' });
		expect(`${run.stdout}${run.stderr}`).toContain('prebuilt greeter');
		expect(run.status).toBe(0);
		original.manifest = readFileSync(manifestFile, 'utf8');

		const made = manifest();
		expect(Object.keys(made.systems)).toEqual(['windows', 'linux']);
		expect(Object.keys(made.from)).toEqual(['@amxts/core', '@test/greeter']);
		expect(made.from['@amxts/core'].version).toBe('0.9.1');
		expect(made.from['@amxts/core'].abi).toMatch(/^0\.9\.1\+abi\.[0-9a-f]{8}$/);
		expect(made.options).toEqual({ '@test/greeter': { greeting: 'Hello', times: 1 } });
		// A number crosses as an include declares it: the declaration is part of the build.
		expect(made.forwards).toEqual({ greeter_greeted: null });
		expect(made.places).toContain('facade.ts');
		expect(made.places).toContain('modules/greeter.ts');
		// What a plugin that uses it compiles against, in place of the module.
		expect(made.surface!.proxy).toContain('export function greet(name: string): string {');
		expect(made.surface!.serve).toContain('__serve("greeter"');
		setProjectDir(dir);
		process.env.AMXTS_AS_VERSION = '0.9.2';
	});

	test('a build takes it as it came, for the server\'s system', () => {
		const windows = use('windows');
		expect(windows && 'aot' in windows && Buffer.from(windows.aot).equals(readFileSync(join(greeter, 'prebuilt/windows/greeter.aot')))).toBe(true);
		const linux = use('linux');
		expect(linux && 'aot' in linux && Buffer.from(linux.aot).equals(readFileSync(join(greeter, 'prebuilt/linux/greeter.aot')))).toBe(true);
	});

	test('a core of another line, or of another hood, is said, and the module compiled', () => {
		expect(asVersion('0.10.0', use)).toEqual({ why: 'greeter 1.2.3 was built for amxts 0.9, the project has 0.10' });
		expect(asVersion('1.9.1', use)).toEqual({ why: 'greeter 1.2.3 was built for amxts 0.9, the project has 1.9' });
		const abi = manifest().from['@amxts/core'].abi!;
		const other = `${abi.slice(0, abi.indexOf('+'))}+abi.99999999`;
		expect(withManifest(made => Object.assign(made.from['@amxts/core'], { abi: other }))).toEqual({ why: expect.stringContaining(`greeter 1.2.3 was built for amxts ${other}, the project has 0.9.2+abi.`) });
		expect(withManifest(made => Object.assign(made, { format: 1 }))).toEqual({ why: 'greeter 1.2.3 comes compiled for another build of amxts' });
	});

	test('what the project would compile otherwise is said, and compiled', () => {
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

	test('its surface is taken on the same terms, but the system and the forwards, which only its machine code depends on', async () => {
		expect(surface()).toEqual({ surface: manifest().surface! });
		expect(withManifest(made => delete made.systems.windows, surface)).toHaveProperty('surface');
		expect(withManifest(made => Object.assign(made.forwards, { greeter_greeted: '[["Float",false]]' }), surface)).toHaveProperty('surface');
		expect(asVersion('0.10.0', surface)).toEqual({ why: 'greeter 1.2.3 was built for amxts 0.9, the project has 0.10' });
		expect(withManifest(made => delete made.surface, surface)).toEqual({ why: 'greeter 1.2.3 comes without its analysis' });

		config(' greeter: { times: 2 },');
		expect(surface()).toEqual({ why: 'greeter 1.2.3 was built with its default options, and amxts.config.ts sets greeter' });
		config();

		// A compile takes it in place of analysing the module.
		const shipped = await withManifest(made => Object.assign(made.surface!, { proxy: `${made.surface!.proxy}// as it came` }), () => moduleSurface(CORE_PLUGINS, 'greeter'));
		expect(shipped.proxy).toEndWith('// as it came');
	});

	test('a module in a folder of the project is compiled as any plugin is', () => {
		cpSync(greeter, join(dir, 'modules/greeter'), { recursive: true });
		config();
		expect(use()).toBeNull();
		rmSync(join(dir, 'modules'), { recursive: true });
		config();
	});
});
