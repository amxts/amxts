// @amxts/core/test-utils: unit tests for amxts plugins and modules, without a
// game server.
//
//   import { loadPlugin, setup } from "@amxts/core/test-utils";
//
//   const server = await setup();                      // the project: its modules, then its plugins
//   const player = server.join("Alice", { team: "CT" });
//   player.say("/tour");
//   expect(player.chat).toContain("100 HP");
//
// The plugin is the real one - compiled by the same AssemblyScript, against
// the same facade and generated natives - and runs under WebAssembly with a
// fake server behind its imports. See docs/en/7.testing/01.index.md.
import type { ServerOptions } from './server';
import { FakeServer } from './server';

export { defineTestKit } from './kits';
export type { TestKit } from './kits';
export { bitsFloat, floatBits, Memory } from './memory';
export type { Native, NativeCall } from './natives';
export { FakeEntity, FakePlayer, FakeServer, FakeWeapon, PluginInstance } from './server';
export type { ArgValue, HookResult, JoinOptions, Message, NativeResult, SentForward, ServerOptions, TeamName, UserMessage, Value } from './server';
export { setup } from './setup';
export type { SetupOptions } from './setup';
export { constant } from './tables';

/**
 * Compiles a plugin (once per test run), loads it into a new fake server and
 * starts the map: its top level runs, then plugin_init, plugin_cfg and
 * OnConfigsExecuted.
 *
 * Several plugins go into one server as an array - they hear each other's
 * forwards and natives, as on a real one.
 */
export async function loadPlugin(source: string | string[], options: ServerOptions = {}): Promise<FakeServer> {
	const server = new FakeServer(options);
	for (const file of Array.isArray(source) ? source : [source]) await server.load(file);
	server.start();
	return server;
}
