// A module's test kit: what the fake server needs to run the module - the
// natives its plugin calls that the fake does not answer, the messages it
// sends read back for a test. The module ships it and names it in its
// package.json, and the fake server installs it before the module's plugin
// loads:
//
//   "amxts": { "module": "src/index.ts", "testing": "testing/index.ts" }
//
//   // testing/index.ts
//   import { defineTestKit } from "@amxts/core/test-utils";
//   export default defineTestKit({ install: server => installMenus(server) });
import type { ModulePackage } from '../../scripts/project';
import type { FakeServer } from './server';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { sourcesFor } from '../../scripts/project';
import { PLUGINS_ROOT } from './tables';

/** What a module's test kit does to a new fake server - before any plugin loads. */
export interface TestKit<T = unknown> {
	/**
	 * Adds what the module needs on the fake server - `server.defineNative`,
	 * `server.messageListeners` - and gives back what its tests use.
	 */
	install: (server: FakeServer) => T;
}

/**
 * A module's test kit, as the default export of the file its package.json
 * names in `"amxts": { "testing": ... }`.
 */
export function defineTestKit<T>(kit: TestKit<T>): TestKit<T> {
	return kit;
}

/** Installs a module package's test kit on the server, once; nothing for a package without one. */
export async function installKit(server: FakeServer, pkg: ModulePackage): Promise<void> {
	if (!pkg.testing || server.kits.has(pkg.name)) return;
	// By its real path: the test imports the same file through node_modules,
	// and one file must be one module - the kit keeps its state per server.
	const loaded = await import(pathToFileURL(realpathSync(pkg.testing)).href);
	const kit = loaded.default as TestKit | undefined;
	if (!kit || typeof kit.install !== 'function') {
		throw new Error(`${pkg.name}: ${pkg.testing} has no \`export default defineTestKit({ install(server) { ... } })\``);
	}
	if (server.kits.has(pkg.name)) return;
	server.kits.set(pkg.name, kit.install(server));
}

/** The kit of the module package `source` names, when it is one: `server.load("@amxts/menu-core")`. */
export async function installKitFor(server: FakeServer, source: string): Promise<void> {
	if (source.endsWith('.ts') || !/^@?[\w.-]+(?:\/[\w.-]+)?$/.test(source)) return;
	const pkg = sourcesFor(PLUGINS_ROOT).project.modules.find(each => each.name === source);
	if (pkg) await installKit(server, pkg);
}
