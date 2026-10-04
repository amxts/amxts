// A project on the fake server, as `amxts build` would lay it out on a real
// one:
//
//   const server = await setup();                          // the project the tests run from
//   const server = await setup({ rootDir: "playground" }); // a module's playground
//
// The modules the project's plugins use load first, each after what it
// requires, with their test kits; then the project's plugins; then the map
// starts. A module no plugin uses is left out, as the build leaves it out.
import type { ServerOptions } from './server';
import { basename, resolve } from 'node:path';
import { loadProject, modulesInUse, projectPlugins, setProjectDir, sourcesFor } from '../../scripts/project';
import { installKit } from './kits';
import { FakeServer } from './server';
import { PLUGINS_ROOT } from './tables';

export interface SetupOptions extends ServerOptions {
	/**
	 * The project: the folder with its amxts.config.ts, whose modules and
	 * plugins are loaded. The folder the tests run from when left out. It
	 * stays the project for the rest of the run: `server.load("@you/greeter")`
	 * afterwards finds the module there.
	 */
	rootDir?: string;
	/**
	 * Which of the project's plugins load, by file name - `["welcome.ts"]`,
	 * `["welcome"]` - in this order; all of them when left out, none for `[]`.
	 */
	plugins?: string[];
	/** Starts the map - plugin_init, plugin_cfg, then OnConfigsExecuted - once everything is loaded. True when left out. */
	start?: boolean;
}

/**
 * A new fake server with the project on it: the modules its plugins use, in
 * load order, each with its test kit, then its plugins, then the map started.
 */
export async function setup(options: SetupOptions = {}): Promise<FakeServer> {
	const { rootDir = process.cwd(), plugins, start = true, ...serverOptions } = options;
	setProjectDir(rootDir);
	const project = loadProject(resolve(rootDir));
	if (project.problems.length) throw new Error(project.problems.join('\n'));

	const server = new FakeServer(serverOptions);
	const found = projectPlugins(project);
	const modules = modulesInUse(sourcesFor(PLUGINS_ROOT), found);
	for (const pkg of modules) await installKit(server, pkg);
	for (const pkg of modules) await server.load(pkg.name);
	for (const plugin of chosen(found, plugins)) await server.load(plugin);
	if (start) server.start();
	return server;
}

/** The plugins asked for, in the order asked; every one when none is named. */
function chosen(found: string[], names: string[] | undefined): string[] {
	if (!names) return found;
	return names.map((name) => {
		const file = name.endsWith('.ts') ? name : `${name}.ts`;
		const match = found.find(path => basename(path) === file);
		if (!match) throw new Error(`setup: no plugin ${file} in the project's plugins (${found.map(path => basename(path)).join(', ') || 'it has none'})`);
		return match;
	});
}
