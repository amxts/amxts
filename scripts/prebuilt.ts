// Modules that come compiled: a module package from npm carries its owner
// plugin's .aot for each system in prebuilt/, with prebuilt/manifest.json
// saying what it was compiled from. A build takes it in place of compiling
// the module - seconds of asc and wamrc on every machine - while the project
// would compile the same thing; when it would not, the build says why and
// compiles it.
//
// The manifest also carries the module's surface - the proxy a plugin that
// uses the module reads in its place, and the owner's dispatcher
// (scripts/shared-modules.ts) - which every compile of a plugin that uses
// it would otherwise make by analysing the module with asc. It is taken on
// the same terms as the .aot, but for what only the machine code depends on:
// the system and the forwards' declarations.
//
//   bun scripts/prebuilt.ts      in a project: compile every module it lists
//                                into the module's prebuilt/, for every
//                                system (scripts/publish.ts runs it on the
//                                packages it stages)
//
// What a module's .aot is made of, and so what the manifest holds:
//
// - the core: the compile's scripts, the patched AssemblyScript and its
//   Binaryen, the API in as/, the natives table wamrc reads and the WAMR
//   patch - which also decides whether the server's module loads the .aot.
//   A package from the registry is its ABI (scripts/build-identity.ts): the
//   .aot is taken under any core of its line whose hood is the same, as the
//   server's module of that line loads it - a core's patch release needs no
//   module released again. The .aot keeps the facade of the core it was
//   compiled with, as any plugin built before the patch does. A folder on
//   this machine (a checkout) is its content too, so the version, the ABI
//   and a hash are all kept;
// - every module package the compile reads - the module, and the ones it
//   imports (menu-core reads config-core for its proxy) - the same way;
// - the options amxts.config.ts gives them: setup is compiled with them;
// - how the includes declare a forward the module raises with something
//   other than text: a Team, a number or a Float crosses as the declaration
//   says. The server's includes change nothing else of a module;
// - the project's plugins folder, which lies over the core's as/ in the
//   tree a compile reads: a file there at a place the module reads would be
//   compiled in its stead;
// - the system: one .aot each, compiled from one wasm.
//
// TypeScript is compared without its comments: `amxts prepare` writes the
// tooltips of the core and the modules in the project's language, which is
// no change to the code.
import type { NativesBeside, PluginNative } from './plugin-natives';
import type { ModulePackage, Options, Sources } from './project';
import type { ModuleSurface } from './shared-modules';
import type { System } from './system';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';
import { abiIdentity, abiLine, coreVersion, releaseLine } from './build-identity';
import { compileToMachineCode, compileToWasm } from './compile';
import { codeFiles } from './compile-cache';
import { includeForward, nativesBeside } from './plugin-natives';
import { CORE_DIR, CORE_PLUGINS, loadProject, optionsOf, shared, sourcesFor } from './project';
import { moduleSurface } from './shared-modules';
import { SYSTEM_NAME, SYSTEMS, wamrcPath } from './system';
import { c, log, since } from './ui';

/** Where a module package keeps its compiled owner: prebuilt/<system>/<name>.aot, and the manifest. */
export const PREBUILT_DIR = 'prebuilt';
const MANIFEST = 'manifest.json';
/** Goes up when the manifest changes shape: a build reads only its own. */
const FORMAT = 2;
const CORE_NAME = '@amxts/core';

/** A package as a prebuilt module was compiled with it. */
interface Built {
	version: string;
	/** Its content: the code files, TypeScript without comments. */
	hash: string;
	/** The core's: the ABI the .aot carries. */
	abi?: string;
}

export interface PrebuiltManifest {
	format: number;
	module: string;
	version: string;
	/** The core and every module package the compile read, by name. */
	from: Record<string, Built>;
	/** The options each of those modules was compiled with. */
	options: Record<string, Options>;
	/** The forwards it raises with something other than text, as the includes declared them (null: none did). */
	forwards: Record<string, string | null>;
	/** The places under `~/` the compile read: a project's plugins folder must not hold them. */
	places: string[];
	/** Its natives, for the include a Pawn plugin compiles against. */
	natives: PluginNative[];
	beside: NativesBeside;
	systems: Partial<Record<System, { file: string; size: number; sha256: string }>>;
	/** What a plugin that uses the module compiles against (scripts/shared-modules.ts); missing in a manifest made without it. */
	surface?: ModuleSurface;
}

/** What a build does with a module's prebuilt .aot: takes it, or compiles the module and says why. */
export type PrebuiltUse = { aot: Uint8Array; natives: PluginNative[]; beside: NativesBeside } | { why: string };

const posix = (path: string) => path.replace(/\\/g, '/');
const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Whether a package's folder is one a package manager installed, not a folder on this machine. */
export function fromRegistry(dir: string): boolean {
	return realpathSync(dir).split(sep).includes('node_modules');
}

const printer = ts.createPrinter({ removeComments: true });

/** A file as a compile sees it: TypeScript without its comments, anything else as it is. */
function codeOf(file: string): string | Buffer {
	const bytes = readFileSync(file);
	if (!file.endsWith('.ts')) return bytes;
	return printer.printFile(ts.createSourceFile(file, bytes.toString('utf8'), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
}

/** The files under `dir`, relative, but for node_modules, prebuilt/ and dot-folders. */
function filesIn(dir: string, at = ''): string[] {
	return readdirSync(join(dir, at), { withFileTypes: true }).flatMap((entry) => {
		const path = at ? `${at}/${entry.name}` : entry.name;
		if (!entry.isDirectory()) return [path];
		return entry.name === 'node_modules' || entry.name === PREBUILT_DIR || entry.name.startsWith('.') ? [] : filesIn(dir, path);
	});
}

/** One hash of `files` (relative to `base`) by their names and code, with `extra` before them. */
function hashFiles(base: string, files: string[], extra = ''): string {
	const hash = createHash('sha1').update(`${extra}\0`);
	for (const file of [...files].sort()) hash.update(`${file}\0`).update(codeOf(join(base, file))).update('\0');
	return hash.digest('hex');
}

/**
 * A module package's content: the TypeScript and the includes it publishes
 * (its package.json's `files`, when it lists them), and what its
 * package.json says to the build.
 */
function packageHash(pkg: ModulePackage): string {
	const json = JSON.parse(readFileSync(join(pkg.dir, 'package.json'), 'utf8'));
	const listed: string[] | null = Array.isArray(json.files) ? json.files.map((each: string) => each.replace(/^\.\/|\/$/g, '')) : null;
	const published = (file: string) => !listed || listed.some(each => file === each || file.startsWith(`${each}/`));
	const files = filesIn(pkg.dir).filter(file => /\.(?:ts|inc)$/.test(file) && published(file));
	return hashFiles(pkg.dir, files, JSON.stringify({ name: json.name, version: json.version, description: json.description, amxts: json.amxts }));
}

let coreHashed: string | null = null;

/** The core's content: the compile's code, the API, the natives table and the WAMR patch. */
function coreHash(): string {
	if (coreHashed) return coreHashed;
	const code = codeFiles([join(CORE_DIR, 'scripts/compile.ts')]).filter(existsSync).map(file => posix(relative(CORE_DIR, file)));
	const api = filesIn(CORE_PLUGINS).filter(file => file.endsWith('.ts')).map(file => `as/${file}`);
	const patches = readdirSync(join(CORE_DIR, 'runtime/patches')).map(file => `runtime/patches/${file}`);
	coreHashed = hashFiles(CORE_DIR, [...code, ...api, ...patches, 'runtime/natives.txt']);
	return coreHashed;
}

/** The core or a module package the project has, by name, as a prebuilt module is checked against it. */
function installed(name: string, sources: Sources): { version: string; dir: string; hash: () => string; abi?: string } | null {
	if (name === CORE_NAME) {
		return { version: coreVersion(), dir: CORE_DIR, hash: coreHash, abi: abiIdentity() };
	}
	const pkg = sources.project.packages.find(each => each.name === name);
	return pkg ? { version: pkg.version, dir: pkg.dir, hash: () => packageHash(pkg) } : null;
}

/** How a forward's declaration is compared: what decides how its arguments cross. */
function declarationOf(name: string): string | null {
	const found = includeForward(name);
	return found && JSON.stringify(found.params.map(param => [param.type, Boolean(param.isArray)]));
}

/**
 * A module package's manifest, or why it cannot be used. Null for a module
 * that has none - a folder on this machine, or a package without prebuilt/ -
 * which is compiled as any plugin is.
 */
function manifestOf(pkg: ModulePackage): PrebuiltManifest | { why: string } | null {
	const file = join(pkg.dir, PREBUILT_DIR, MANIFEST);
	if (!fromRegistry(pkg.dir) || !existsSync(file)) return null;
	const named = `${pkg.short} ${pkg.version}`;
	try {
		const manifest = JSON.parse(readFileSync(file, 'utf8')) as PrebuiltManifest;
		return manifest.format === FORMAT ? manifest : { why: `${named} comes compiled for another build of amxts` };
	} catch {
		return { why: `${named}: its ${PREBUILT_DIR}/${MANIFEST} cannot be read` };
	}
}

/**
 * The prebuilt .aot of a module from npm for `system`, when it is what the
 * project would compile; else why not. Null for a module that has none.
 */
export function prebuiltOf(pkg: ModulePackage, system: System, sources: Sources): PrebuiltUse | null {
	const manifest = manifestOf(pkg);
	if (!manifest || 'why' in manifest) return manifest;
	const named = `${pkg.short} ${pkg.version}`;
	const aot = manifest.systems[system];
	if (!aot) return { why: `${named} comes compiled for ${Object.keys(manifest.systems).map(each => SYSTEM_NAME[each as System]).join(' and ')}, not ${SYSTEM_NAME[system]}` };
	const why = mismatch(manifest, pkg, sources);
	if (why) return { why };
	for (const [name, declared] of Object.entries(manifest.forwards)) {
		if (declarationOf(name) !== declared) return { why: `the includes declare the forward ${name} otherwise than when ${named} was built` };
	}

	const bytes = new Uint8Array(readFileSync(join(pkg.dir, aot.file)));
	if (sha256(bytes) !== aot.sha256) return { why: `${named}: ${aot.file} is not the file its manifest lists` };
	return { aot: bytes, natives: manifest.natives, beside: manifest.beside };
}

/**
 * The surface a module from npm came with (scripts/shared-modules.ts), when
 * it is what the project would make; else why not. Null for a module that
 * has none.
 */
export function prebuiltSurface(pkg: ModulePackage, sources: Sources): { surface: ModuleSurface } | { why: string } | null {
	const manifest = manifestOf(pkg);
	if (!manifest || 'why' in manifest) return manifest;
	if (!manifest.surface) return { why: `${pkg.short} ${pkg.version} comes without its analysis` };
	const why = mismatch(manifest, pkg, sources);
	return why ? { why } : { surface: manifest.surface };
}

/** Why the project would not compile a module as its manifest says it was: another core or package, other options, a file in the way; null when it would. */
function mismatch(manifest: PrebuiltManifest, pkg: ModulePackage, sources: Sources): string | null {
	const named = `${pkg.short} ${pkg.version}`;
	for (const [name, built] of Object.entries(manifest.from)) {
		const have = installed(name, sources);
		if (!have) return `${named} was built with ${name}, which the project does not have`;
		const other = have.abi ? otherAbi(built.abi ?? '', have.abi) : have.version !== built.version && `${name} ${built.version}, the project has ${have.version}`;
		if (other) return `${named} was built for ${other}`;
		if (!fromRegistry(have.dir) && have.hash() !== built.hash) {
			return `${named} was built from another ${name} ${built.version} than the one in ${posix(relative(sources.project.dir, have.dir)) || '.'}`;
		}
	}
	for (const [name, options] of Object.entries(manifest.options)) {
		const module = sources.project.packages.find(each => each.name === name)!;
		if (JSON.stringify(optionsOf(sources.project, module.definition)) !== JSON.stringify(options)) {
			return `${named} was built with ${name === pkg.name ? 'its' : `${module.short}'s`} default options, and amxts.config.ts sets ${module.definition.configKey}`;
		}
	}
	const own = resolve(sources.project.pluginsDir) !== resolve(CORE_PLUGINS);
	const shadow = own ? manifest.places.find(place => sources.ownFile(place)) : undefined;
	if (shadow) return `${posix(relative(sources.project.dir, join(sources.project.pluginsDir, shadow)))} takes the place of a file ${named} was built from`;
	return null;
}

/**
 * How the ABI a module was built for differs from the project's - `amxts 0.2,
 * the project has 0.3`, or both whole within a line - or false when the
 * server's module would load it.
 */
function otherAbi(built: string, have: string): string | false {
	if (abiLine(built) === abiLine(have)) return false;
	const line = (abi: string) => releaseLine(abi.slice(0, abi.indexOf('+')));
	return line(built) === line(have) ? `amxts ${built}, the project has ${have}` : `amxts ${line(built)}, the project has ${line(have)}`;
}

/** The `new Forward<...>("name")` calls of a package whose arguments are not all text: their names. */
function typedForwards(pkg: ModulePackage): string[] {
	const names: string[] = [];
	for (const file of filesIn(pkg.dir).filter(each => each.endsWith('.ts'))) {
		const text = readFileSync(join(pkg.dir, file), 'utf8');
		for (const at of text.matchAll(/\bnew\s+Forward\b/g)) {
			const call = text.slice(at.index).match(/^new\s+Forward(?:\s*<([^<>]*)>)?\s*\(\s*["']([^"']+)["']/);
			if (!call) throw new Error(`${pkg.name}: ${file} - a Forward whose name and types the prebuilt build cannot read: new Forward<...>("name") with plain types`);
			if ((call[1] ?? '').split(',').some(type => type.trim() !== 'string')) names.push(call[2]);
		}
	}
	return names;
}

/** Compiles one module into its package's prebuilt/: one wasm, an .aot for each system, the manifest. */
async function prebuild(pkg: ModulePackage, sources: Sources): Promise<string> {
	const started = performance.now();
	const dir = join(pkg.dir, PREBUILT_DIR);
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(dir, { recursive: true });
	const owner = sources.ownerSource(pkg);
	const plugin = { source: owner, output: '', root: CORE_PLUGINS, wamrc: wamrcPath(), signatures: join(CORE_DIR, 'runtime/natives.txt'), quick: false };
	const natives: PluginNative[] = [];
	const wasm = join(dir, `${pkg.short}.wasm`);
	const problem = await compileToWasm(plugin, wasm, false, natives);
	if (problem) throw new Error(`${pkg.name} does not compile:\n${problem}`);

	const systems: PrebuiltManifest['systems'] = {};
	for (const system of SYSTEMS) {
		const output = join(dir, system, `${pkg.short}.aot`);
		const failed = compileToMachineCode({ ...plugin, output, system }, wasm, natives);
		if (failed) throw new Error(`${pkg.name} for ${SYSTEM_NAME[system]}:\n${failed}`);
		// The include is written from the natives where the build puts the .aot.
		for (const name of readdirSync(join(dir, system)).filter(name => name.endsWith('.inc'))) rmSync(join(dir, system, name));
		const bytes = readFileSync(output);
		systems[system] = { file: `${PREBUILT_DIR}/${system}/${pkg.short}.aot`, size: bytes.length, sha256: sha256(bytes) };
	}
	rmSync(wasm, { force: true });

	// What the compile read: its places in the tree, and the packages they are in.
	const reached = sources.reach(join(CORE_PLUGINS, 'facade.ts'), sources.reach(join(CORE_PLUGINS, sources.entry(owner))));
	const places = [...reached].map(place => posix(relative(CORE_PLUGINS, place))).sort();
	const used = sources.project.modules.filter(each => each === pkg || [...reached].some(place => sources.packageOf(sources.real(place) ?? place) === each));
	const core = installed(CORE_NAME, sources)!;
	const manifest: PrebuiltManifest = {
		format: FORMAT,
		module: pkg.name,
		version: pkg.version,
		from: Object.fromEntries([[CORE_NAME, { version: core.version, hash: core.hash(), abi: core.abi }], ...used.map(each => [each.name, { version: each.version, hash: packageHash(each) }])]),
		options: Object.fromEntries(used.map(each => [each.name, optionsOf(sources.project, each.definition)])),
		forwards: Object.fromEntries(used.flatMap(typedForwards).map(name => [name, declarationOf(name)])),
		places,
		natives,
		beside: nativesBeside(natives),
		systems,
		surface: await moduleSurface(CORE_PLUGINS, pkg.short),
	};
	writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, '\t')}\n`);
	const sizes = SYSTEMS.map(system => `${SYSTEM_NAME[system]} ${(systems[system]!.size / 1024).toFixed(0)} KB`).join(', ');
	return `prebuilt ${c.bold(pkg.short)} ${c.dim(`${sizes} (${since(started)})`)}`;
}

if (import.meta.main) {
	const project = loadProject(process.cwd());
	if (project.problems.length) throw new Error(project.problems.join('\n'));
	// A library has no owner to compile: it is compiled into the plugins that import it.
	for (const pkg of shared(project.modules)) log.success(await prebuild(pkg, sourcesFor(CORE_PLUGINS)));
}
