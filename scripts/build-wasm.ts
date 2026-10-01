import type { Plugin } from './compile';
import type { PluginNative } from './plugin-natives';
import type { ModulePackage } from './project';
import { createSocket } from 'node:dgram';
// Builds a project's plugins into .aot files the server can load, and
// optionally copies them there. The project is the current folder: its
// amxts.config.ts names the modules it uses and where its plugins are
// (scripts/project.ts). In this repository that is as/ and dist-wasm/.
//
//   bun run plugins            build into dist-wasm/     (npx amxts build)
//   bun run plugins --deploy   build, copy to the server, write its plugins.ini
//                              and reload the running server over rcon
//   bun scripts/build-wasm.ts --deploy --watch   that on every save   (npx amxts dev)
//   bun scripts/build-wasm.ts --watch            only the build, on every save, for a
//                                                server that reads dist/ (npx amxts build --watch)
//   --watch --docker --os linux   that, for the Docker server that mounts the project,
//                                 with its console's amxts lines (npx amxts dev --docker)
//   --os windows|linux         the server's system, when AMXTS_SERVER does not say
//
// Every module the plugins use is built too, as its owner plugin - <name>.aot,
// the module's one instance on the server; one from npm that comes compiled
// is taken as it came (scripts/prebuilt.ts) - and plugins.ini lists the modules
// first, each after what it requires, then the project's plugins. A module the
// config lists and no plugin uses is left out, unless `pawn` keeps it for Pawn
// plugins (modulesInUse).
//
// `dev` is --deploy --watch: saving a .ts is not enough on its own, because
// the server loads a .aot and only asc and wamrc can produce one. A save
// rebuilds the plugins that import the saved file, copies them over and sends
// the server RELOAD_COMMAND, whose reply is printed.
//
// Two compilers, in order: asc turns AssemblyScript into wasm, wamrc turns
// wasm into i386 machine code - in the object format of the server's system,
// Windows or Linux, whichever this machine is (scripts/system.ts). wamrc is given runtime/natives.txt so that a
// call into a host native compiles to a direct call — 2 ns instead of 28. Both
// must come from the same WAMR release as the module, or the loader reports
// "unknown binary version" (CONTRIBUTING.md builds both from one checkout).
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { includePath } from './compile';
import { followConsoles, projectContainers, runCommand } from './docker-server';
import { FileContents, sourceIn, sourcesIn } from './file-contents';
import { serverIncludes } from './includes';
import { pluginCache } from './plugin-cache';
import { fromRegistry, prebuiltOf } from './prebuilt';
import { CORE_DIR, CORE_PLUGINS, loadProject, modulesInUse, pluginList, projectPlugins, sourcesFor } from './project';
import { sharedModulesBuild } from './shared-modules';
import { describeSystem, serverSystem, SYSTEM_NAME, WAMRC_PACKAGE, wamrcPath } from './system';
import { c, log, progress, since } from './ui';

function fail(message: string, hint?: string): void {
	log.error(message.trim());
	if (hint) log.hint(hint);
}

/** A path as the report shows it: from the project's folder, with forward slashes. */
function shown(path: string): string {
	return (relative(process.cwd(), path) || '.').replace(/\\/g, '/');
}

const project = loadProject(process.cwd());
if (project.problems.length) {
	fail(project.problems.join('\n'));
	process.exit(1);
}
const sourceDir = project.pluginsDir;
const outDir = project.outDir;
// Both of these differ between this repository and the kit a plugin author
// gets: there wamrc sits beside the plugins and the signature table is a file
// shipped with it, because neither WAMR nor the includes are there to build.
const wamrc = wamrcPath();

// The patched AssemblyScript, not the one npm installs: only ours parses a
// union of string literal types, which is how an event name is completed in an
// editor and misspelled names are refused. See runtime/patches.
const asc_ = process.env.AMXTS_ASC ?? join(CORE_DIR, 'runtime/deps/assemblyscript/bin/asc.js');
const signatures = process.env.AMXTS_NATIVES ?? join(CORE_DIR, 'runtime/natives.txt');
// Where --deploy copies the built plugins: the amxts folder inside a server's
// addons. It is per-machine, so it comes from the environment rather than from
// this file, and .env keeps it out of everyone else's way.
const serverDir = process.env.AMXTS_SERVER ?? '';

// The module's server command that starts every plugin over from disk.
const RELOAD_COMMAND = 'amxts_reload';
// The server's UDP port: 27015 unless AMXTS_PORT says otherwise.
const RCON_PORT = Number(process.env.AMXTS_PORT ?? 27015);
// Where rcon_password is set: cstrike/server.cfg, two folders above addons/amxts.
const serverCfg = join(serverDir, '..', '..', 'server.cfg');

// The system of the server the plugins are for: what the .aot is written as.
let target: ReturnType<typeof serverSystem>;
try {
	target = serverSystem();
} catch (error) {
	fail((error as Error).message);
	process.exit(1);
}

const deploy = process.argv.includes('--deploy');
const keepWatching = process.argv.includes('--watch');
// A development loop compiles quickly, not fully optimised (scripts/compile.ts).
const quick = keepWatching;
// For the Docker server: it reads dist/ where it is, so only the build.
const forDocker = process.argv.includes('--docker');

if (forDocker && deploy) {
	fail('--docker builds into dist/, which the container reads: there is nothing to deploy.');
	process.exit(1);
}

if (forDocker && target.system !== 'linux') {
	fail(`The Docker server is Linux, and the build is for ${describeSystem(target)}.`, 'Build with --os linux.');
	process.exit(1);
}

if (deploy && !serverDir) {
	fail('AMXTS_SERVER is not set: where should the plugins go?', [
		'Point it at the amxts folder inside your server, in .env beside package.json:',
		'  AMXTS_SERVER=D:/hlds/cstrike/addons/amxts',
	].join('\n'));
	process.exit(1);
}

if (!existsSync(asc_)) {
	fail(`The patched AssemblyScript is missing: ${asc_}`, 'Clone AssemblyScript into runtime/deps and apply the patch - CONTRIBUTING.md.');
	process.exit(1);
}

if (!existsSync(wamrc)) {
	fail(`wamrc is missing: ${wamrc}`, `It comes with @amxts/core as ${WAMRC_PACKAGE}, an optional dependency: install the project's dependencies again, optional ones included. A checkout of the core builds it - CONTRIBUTING.md.`);
	process.exit(1);
}

if (!existsSync(signatures)) {
	fail(`${signatures} is missing`, 'Run bun run generate in the core.');
	process.exit(1);
}

mkdirSync(outDir, { recursive: true });

/** A plugin to build: where its source is, and the name of its .aot. */
interface Target {
	source: string;
	name: string;
	/** The module package it owns. */
	pkg?: ModulePackage;
}

/** The project's own plugins: the .ts files at the top of its plugins folder. */
function ownPlugins(): Target[] {
	return projectPlugins(project).map(source => ({ source, name: basename(source).replace(/\.ts$/, '') }));
}

for (const plugin of ownPlugins()) {
	if (project.modules.some(pkg => pkg.short === plugin.name)) {
		fail(`${shown(plugin.source)}: a module in amxts.config.ts is called ${plugin.name} too`, 'Rename the plugin.');
		process.exit(1);
	}
}

/** The owners of the modules the plugins use, in load order. */
function moduleOwners(): Target[] {
	const sources = sourcesFor(CORE_PLUGINS);
	return modulesInUse(sources, ownPlugins().map(plugin => plugin.source)).map(pkg => ({ source: sources.ownerSource(pkg), name: pkg.short, pkg }));
}

/** The modules' owners, in load order, then the project's plugins. */
function allPlugins(): Target[] {
	return [...moduleOwners(), ...ownPlugins()];
}

/** The plugins a change to these files has to rebuild: every one importing them. */
function affected(files: string[]): Target[] {
	const sources = sourcesFor(CORE_PLUGINS);
	const changed = files.map(file => resolve(file));
	return allPlugins().filter((plugin) => {
		const reached = [...sources.reach(join(CORE_PLUGINS, sources.entry(plugin.source)))].map(place => sources.real(place) ?? place);
		return changed.some(file => reached.includes(file));
	});
}

/**
 * asc's errors, one per block, as `as/file.ts:line:col - message` over the
 * line it points at. Anything else - wamrc's - is passed through as it came.
 */
function readable(problem: string): string {
	const errors = [...problem.matchAll(/ERROR (\w+): (.*)\r?\n[ \t]*:\r?\n([\s\S]*?)\r?\n[ \t]*└─ in (.+?)\((\d+),(\d+)\)/g)];
	if (errors.length === 0) return problem.trim();

	const sources = sourcesFor(CORE_PLUGINS);
	// A file reached through `~/` is named `~lib/~/myplugin/bits.ts`; a module's
	// is the file in its package.
	const where = (file: string) => {
		const place = join(CORE_PLUGINS, file.replace(/^~lib\/~\//, ''));
		return relative(process.cwd(), sources.real(place) ?? place).replace(/\\/g, '/');
	};
	return errors
		.map(([, code, message, snippet, file, line, col]) => `${where(file)}:${line}:${col} - ${code} ${message}\n${snippet}`)
		.join('\n\n');
}

/** The include each built plugin wrote, by .aot: a contract's keeps its own name. */
const includes = new Map<string, string>();

/**
 * What the build keeps of the plugins it compiled (scripts/plugin-cache.ts).
 * A deploy copies the plugins' includes, and amxts.inc, where the server's
 * includes are: the ones built before are the build's own, not what it reads.
 */
const cache = pluginCache(project.dir, ['amxts', ...readdirSync(outDir).filter(file => file.endsWith('.inc')).map(file => file.replace(/\.inc$/, ''))]);

/**
 * Builds these plugins: a module that comes compiled for this project is
 * put in place as it came (scripts/prebuilt.ts), one an earlier build kept,
 * from the same files, likewise; the rest are compiled. The first build of a
 * run says when it has a module to compile. Returns the .aot names, or null
 * after printing the error.
 */
async function compile(plugins: Target[], first: boolean): Promise<string[] | null> {
	const sources = sourcesFor(CORE_PLUGINS);
	const planned = plugins.map((each) => {
		const plugin: Plugin = {
			source: each.source,
			output: join(outDir, `${each.name}.aot`),
			// `~/` is the core's as/, with the project's plugins and the
			// modules over it (scripts/project.ts).
			root: CORE_PLUGINS,
			wamrc,
			signatures,
			system: target.system,
			quick,
		};
		const prebuilt = each.pkg ? prebuiltOf(each.pkg, target.system, sources) : null;
		if (prebuilt && 'why' in prebuilt) log.info(`${prebuilt.why} - compiling it here`);
		if (prebuilt && 'aot' in prebuilt) return { ...each, plugin, how: 'prebuilt', natives: cache.take(plugin, prebuilt) };
		return { ...each, plugin, how: 'unchanged', natives: cache.reuse(plugin) };
	});
	const fresh = planned.filter(each => !each.natives);
	if (first && fresh.some(each => each.pkg)) {
		log.info('The first build compiles the modules to machine code: it takes about a minute.');
	}
	for (const each of planned.filter(each => each.natives)) log.success(`${c.bold(each.name)} ${c.dim(`· ${each.how}`)}`);

	for (const [i, each] of fresh.entries()) {
		const natives: PluginNative[] = [];
		const started = performance.now();
		const step = progress(`compiling ${c.bold(each.name)} ${c.dim(`${i + 1}/${fresh.length}`)}`);
		const problem = await cache.compile(each.plugin, natives).catch((error) => {
			step.end();
			throw error;
		});
		step.end(problem ? undefined : `${c.bold(each.name)} ${c.dim(`· ${since(started)}`)}`);
		if (problem) {
			fail(`${c.bold(each.name)} does not compile:\n${readable(problem)}\n`, keepWatching ? 'The server keeps the last good build.' : undefined);
			return null;
		}
		each.natives = natives;
	}

	for (const each of planned) {
		includes.set(`${each.name}.aot`, includePath(each.plugin.output, each.natives!));
		if (each.pkg) writePackageInclude(each.pkg, each.plugin.output);
	}
	return planned.map(each => `${each.name}.aot`);
}

/**
 * Built in a module's own folder, a module with natives gets its include
 * written into the package - include/<name>.inc, which the author commits and
 * Pawn plugins compile against. Not with `"contract": true`: that include is
 * the original's, and the build has checked the natives against it instead.
 */
function writePackageInclude(pkg: ModulePackage, output: string) {
	if (pkg.dir !== project.dir || !pkg.natives || pkg.contract) return;
	const generated = includePath(output);
	if (!existsSync(generated)) return;
	const target = pkg.include ?? join(pkg.dir, 'include', basename(generated));
	const text = readFileSync(generated, 'utf8');
	if (existsSync(target) && readFileSync(target, 'utf8').replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n')) return;
	mkdirSync(dirname(target), { recursive: true });
	writeFileSync(target, text);
	log.info(`wrote ${relative(project.dir, target).replace(/\\/g, '/')} from ${relative(project.dir, pkg.natives).replace(/\\/g, '/')}`);
}

/**
 * Sends one connectionless packet to the local server and collects what comes
 * back until it goes quiet. Null when nothing does: no server on that port.
 */
function ask(message: string, wait: number): Promise<string | null> {
	return new Promise((done) => {
		const socket = createSocket('udp4');
		let reply: string | null = null;
		let finished = false;

		const finish = () => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			socket.close();
			done(reply);
		};
		let timer = setTimeout(finish, wait);

		// Every packet starts with four 0xFF, and an rcon reply with an `l`
		// after them; a long reply comes in several.
		socket.on('message', (packet) => {
			reply = (reply ?? '') + packet.subarray(4).toString('latin1').replace(/^l/, '').replace(/\0+$/, '');
			clearTimeout(timer);
			timer = setTimeout(finish, 200);
		});
		// Windows answers a closed port with an error rather than silence.
		socket.on('error', finish);
		socket.send(Buffer.concat([Buffer.from([255, 255, 255, 255]), Buffer.from(`${message}\n`, 'latin1')]), RCON_PORT, '127.0.0.1');
	});
}

/**
 * Copies the built plugins to the server, then reloads it. Returns the
 * report's line - what happened to `names` - with what the server answered
 * under it.
 *
 * The module also reloads by itself when a plugin's .aot is newer than the
 * one it loaded. Reloading twice would run every plugin_init twice, so when
 * rcon can reload, the copies keep the old file's time and only rcon does.
 * When it cannot, they get a new time and the module's watcher does it.
 */
async function deployAndReload(built: string[], names: string): Promise<string> {
	if (!existsSync(serverDir)) return `${names} not deployed: there is no ${shown(serverDir)}`;

	// Without amxts.config.ts the list is the server's, not the build's: a
	// deploy names what it has just built and has never seen named, and leaves
	// every other line alone - a commented-out plugin stays commented out, and
	// an order somebody chose stays theirs. With the config the order is the
	// build's (serverList).
	const listPath = join(serverDir, 'plugins.ini');
	const existing = existsSync(listPath) ? readFileSync(listPath, 'utf8') : '';
	const named = new Set(
		existing.split('\n').map(line => line.replace(/^[\s;]+/, '').trim()).filter(Boolean),
	);
	const added = built.filter(file => !named.has(file));

	const password = existsSync(serverCfg)
		? readFileSync(serverCfg, 'utf8').match(/^\s*rcon_password\s+"?([^"\r\n]*)"?/m)?.[1]?.trim() ?? ''
		: '';
	const challenge = (await ask('challenge rcon', 1000))?.match(/challenge rcon (\d+)/)?.[1];
	const byRcon = Boolean(challenge && password);

	for (const file of built) {
		const target = join(serverDir, 'plugins', file);
		const before = existsSync(target) ? statSync(target) : null;
		copyFileSync(join(outDir, file), target);
		if (before && byRcon) utimesSync(target, before.atime, before.mtime);
	}

	// A plugin that exports natives has an include for Pawn plugins beside it;
	// it goes where amxxpc on the server looks, when the server has one.
	const pawnIncludes = join(serverDir, '..', 'amxmodx', 'scripting', 'include');
	for (const file of built) {
		const include = includes.get(file) ?? includePath(join(outDir, file));
		if (existsSync(include) && existsSync(pawnIncludes)) copyFileSync(include, join(pawnIncludes, basename(include)));
	}
	// The module's own natives for Pawn: the fields plugins add to Player.
	if (existsSync(pawnIncludes)) copyFileSync(join(CORE_DIR, 'runtime/host/amxts.inc'), join(pawnIncludes, 'amxts.inc'));

	// A folder beside the plugins is a library - `~/lib/thing`, `~/myplugin/config`.
	// It is compiled into the .aot already, so nothing here needs it; a .ts
	// plugin written on the server does, and it was silently compiling against
	// whatever copy happened to be there.
	const ownFolder = resolve(sourceDir) !== resolve(CORE_PLUGINS) || resolve(project.dir) === resolve(CORE_DIR);
	for (const entry of ownFolder ? readdirSync(sourceDir, { withFileTypes: true }) : []) {
		if (entry.isDirectory()) {
			cpSync(join(sourceDir, entry.name), join(serverDir, 'plugins', entry.name), { recursive: true });
		}
	}

	if (project.config) {
		writeFileSync(listPath, serverList(existing, readFileSync(join(outDir, 'plugins.ini'), 'utf8')));
	} else if (existing.length === 0) {
		writeFileSync(listPath, `${built.join('\n')}\n`);
	} else if (added.length > 0) {
		writeFileSync(listPath, `${existing.replace(/\n*$/, '\n') + added.join('\n')}\n`);
	}

	// A reload re-reads plugins.ini, so a new plugin loads with it (seen on the
	// server: api-async loaded that way).
	for (const file of added) log.info(`new plugin ${c.bold(file.replace(/\.aot$/, ''))}: added to plugins.ini`);

	if (!challenge) return `deployed ${names} - the server is not running`;

	if (!password) {
		log.warn(`no rcon_password in ${serverCfg}: add a line  rcon_password "something"  and restart the server (until then the module reloads on its own)`);
		return `deployed ${names} - the module reloads them on its own`;
	}

	const reply = await ask(`rcon ${challenge} "${password}" ${RELOAD_COMMAND}`, 5000);

	if (reply === null || /bad rcon_password/i.test(reply)) {
		// Nothing reloaded them, so let the module's watcher see the new files.
		const now = new Date();
		for (const file of built) utimesSync(join(serverDir, 'plugins', file), now, now);
		return `deployed ${names} - rcon ${reply === null ? 'got no answer' : 'refused the password'}, the module reloads them on its own`;
	}

	const lines = reply.split('\n').map(line => line.trimEnd()).filter(Boolean);
	return [`deployed, the server reloaded ${names}`, ...lines.map(line => c.dim(`  ${line}`))].join('\n');
}

/**
 * The server's plugins.ini with the build's order: the modules, each after
 * what it requires, then the project's plugins. A line the server commented
 * out stays commented out, and a plugin the build does not know stays, after.
 */
function serverList(existing: string, generated: string): string {
	const lines = existing.split(/\r?\n/).filter(line => line.trim());
	const nameOf = (line: string) => line.replace(/^[\s;]+/, '').trim();
	const order = generated.split('\n').filter(line => line && !line.startsWith(';'));
	const out = order.map(name => (lines.some(line => nameOf(line) === name && line.trim().startsWith(';')) ? `;${name}` : name));
	for (const line of lines) {
		if (!order.includes(nameOf(line)) && !line.trim().startsWith('; GENERATED')) out.push(line);
	}
	return `${out.join('\n')}\n`;
}

/** The modules plugins.ini lists; null before the first build. */
let listed: string[] | null = null;

/**
 * plugins.ini: the modules the plugins use, then the plugins. A module the
 * config lists that no plugin uses has no .aot in the build folder; one a
 * save stops using is said (the header says it of the first build).
 */
function writeList(owners: Target[]) {
	const names = owners.map(owner => owner.name);
	for (const pkg of project.modules.filter(each => !names.includes(each.short))) {
		if (listed?.includes(pkg.short)) log.info(`module "${pkg.short}" is no longer used by any plugin - left out`);
		rmSync(join(outDir, `${pkg.short}.aot`), { force: true });
	}
	listed = names;
	const list = pluginList(project, ownPlugins().map(plugin => `${plugin.name}.aot`), owners.map(owner => owner.pkg!));
	writeFileSync(join(outDir, 'plugins.ini'), `; GENERATED by amxts build: the modules in load order, then the plugins.\n${list.join('\n')}\n`);
}

/**
 * Builds, deploys when asked, and prints one line about it - after `why`,
 * the files a rebuild is for. A module a save brings into use is built with
 * the plugin that uses it.
 */
async function run(plugins: Target[], verb: string, why = ''): Promise<boolean> {
	const started = performance.now();
	const owners = moduleOwners();
	const fresh = owners.filter(owner => !listed?.includes(owner.name) && !plugins.some(plugin => plugin.name === owner.name));
	const built = await compile([...fresh, ...plugins], listed === null);
	if (!built) return false;
	writeList(owners);

	const names = c.bold(built.map(file => file.replace(/\.aot$/, '')).join(', '));
	const [first, ...rest] = (deploy ? await deployAndReload(built, names) : `${verb} ${names} into ${shown(outDir)}`).split('\n');
	const time = keepWatching ? `${c.dim(new Date().toLocaleTimeString())} ` : '';
	log.success([`${time}${why}${first} ${c.dim(`(${since(started)})`)}`, ...rest].join('\n'));
	return true;
}

/**
 * The server the plugins are for: its folder, its system, ReHLDS or HLDS (as
 * its includes - or `target` without them - say) and, for a deploy, whether
 * it runs.
 */
async function serverLine(): Promise<string> {
	const system = SYSTEM_NAME[target.system];
	if (forDocker) return `the Docker one that mounts this project · ${system}`;
	if (!serverDir) return `${c.dim('none - AMXTS_SERVER is not set')} · the plugins are for ${system}`;
	const folder = serverDir.replace(/\\/g, '/');
	if (!existsSync(serverDir)) return `${folder} ${c.yellow('is not there')} · the plugins are for ${system}`;
	const includes = serverIncludes();
	const rehlds = includes ? existsSync(join(includes, 'reapi.inc')) : project.config?.target !== 'hlds';
	const running = deploy ? ` · ${(await ask('challenge rcon', 1000)) === null ? 'not running' : 'running'}` : '';
	return `${folder} · ${system} · ${rehlds ? 'ReHLDS' : 'HLDS'}${running}`;
}

/**
 * What a build works with, before it starts: the core, the modules - each
 * with what brings it, or that no plugin uses it - the server and the
 * plugins. A module or a core from a folder on this machine is "local".
 */
async function header(): Promise<void> {
	const used = moduleOwners().map(owner => owner.pkg!);
	const listedFirst = project.config?.modules ?? [];
	const order = (pkg: ModulePackage) => (listedFirst.includes(pkg.name) ? listedFirst.indexOf(pkg.name) : listedFirst.length);
	const module = (pkg: ModulePackage) => {
		const notes = [
			!fromRegistry(pkg.dir) && 'local',
			...used.filter(each => each.definition.requires.includes(pkg.name)).map(each => `for ${each.short}`),
			!used.includes(pkg) && 'no plugin uses it',
		].filter(Boolean);
		return `${pkg.short} ${pkg.version}${notes.length ? c.dim(` (${notes.join(', ')})`) : ''}`;
	};
	const core = JSON.parse(readFileSync(join(CORE_DIR, 'package.json'), 'utf8'));
	const plugins = ownPlugins().length;
	const rows = [
		['Core', `@amxts/core ${core.version}${fromRegistry(CORE_DIR) ? '' : c.dim(' (local)')}`],
		['Modules', [...project.modules].sort((a, b) => order(a) - order(b)).map(module).join(c.dim(' · ')) || c.dim('none')],
		['Server', await serverLine()],
		['Plugins', `${plugins || 'none'} in ${shown(sourceDir)}/`],
	];
	console.log(['', ...rows.map(([label, value]) => `  ${c.dim(label.padEnd(8))}  ${value}`), ''].join('\n'));
}

await header();

// The containers are looked for before the first build, so that their answer
// to it - the reload - is shown too.
if (forDocker) {
	const containers = projectContainers(project.dir);
	if (containers === null) {
		log.warn('docker does not answer - is it running? The plugins are built all the same.');
	} else if (containers.length === 0) {
		log.warn(`no running container mounts ${shown(project.dir)} at /project - start the server with:`);
		log.hint(runCommand(project.dir));
	} else {
		log.step(`the server's console: ${containers.map(name => c.cyan(name)).join(', ')}`);
		followConsoles(containers);
	}
}

// What --watch watches: the plugins folder, and every module package the
// project uses - a module being written beside the project rebuilds its
// importers too - but not what the build and the editor config write. A save
// is compared with the sources as the first build reads them
// (scripts/file-contents.ts).
const watched = [...new Set([sourceDir, ...project.modules.map(pkg => pkg.dir)])];
const written = [outDir, join(project.dir, '.amxts')];
const watchedSources = () => watched.flatMap(folder => sourcesIn(folder, written));
const contents = new FileContents(keepWatching ? watchedSources() : []);

const ok = await run(ownPlugins(), 'built');

if (!keepWatching) process.exit(ok ? 0 : 1);

log.step(`watching ${c.cyan(shown(sourceDir))} - save a plugin and it ${deploy ? 'goes to the server' : `is built into ${shown(outDir)} again`} ${c.dim('(Ctrl+C stops)')}`);

// An editor writes a file more than once when saving, so one save means
// several events. They are collected for a quarter of a second, and a save
// that lands during a build waits for it and goes next. Only a file whose
// contents changed rebuilds.
const heard = new Set<string>();
let pending: ReturnType<typeof setTimeout> | null = null;
let building = false;

async function flush(): Promise<void> {
	if (building || heard.size === 0) return;
	building = true;

	const files = contents.changed([...heard]);
	heard.clear();
	const plugins = affected(files);
	if (plugins.length > 0) await run(plugins, 'rebuilt', `${files.map(shown).join(', ')} changed: `).catch(error => fail(String(error)));

	building = false;
	void flush();
}

for (const folder of watched) {
	watch(folder, { recursive: true }, (_event, file) => {
		const path = file && sourceIn(folder, file, written);
		if (!path) return;

		heard.add(path);
		if (pending) clearTimeout(pending);
		pending = setTimeout(() => {
			pending = null;
			void flush();
		}, 250);
	});
}

// A save made while the first build ran is built now.
for (const file of watchedSources()) heard.add(file);
void flush();

// A start that took every plugin from the cache has compiled nothing yet, and
// a plugin's compile begins with the modules it uses analysed
// (scripts/shared-modules.ts): that is done now, while nobody waits, rather
// than on the first save.
if (cache.counts.misses === 0) {
	const sources = sourcesFor(CORE_PLUGINS);
	for (const plugin of ownPlugins()) await sharedModulesBuild(CORE_PLUGINS, sources.entry(plugin.source)).catch(() => {});
}
