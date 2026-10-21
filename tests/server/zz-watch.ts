// A plugin's .aot written again on a running server, as an upload writes it,
// starts that plugin over, and after it the plugins that call its module; the
// others run on. menu-core written again restarts menu-reload-target, which
// calls its menus, and not watch-target. A file read halfway through an
// upload is refused, and loaded once it is whole. It runs after the reload
// suite, which starts every plugin over.
// @log [amxts] reloading menu-core.aot, and what uses its module:
// @log [amxts] watch-target.aot is incomplete or unreadable - it is loaded again once it changes
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const PLUGINS = "addons/amxts/test/plugins";
/** What the watcher takes to see a file settled, load it and swap it in, with room to spare. */
const SETTLED = 1500;

const menuLoads = new Cvar("amxts_test_menu_reload_loads", "0");
const starts = new Cvar("amxts_test_watch_starts", "0");
const ends = new Cvar("amxts_test_watch_ends", "0");

server.addServerCommand("amxts_test_watch", watch);

/** Whether watch-target runs. */
function running() {
	return server.plugins.find(plugin => plugin.file == "watch-target.aot")?.running ?? false;
}

async function watch() {
	const check = new Checks("watch");
	const module = fs.readBytesSync(`${PLUGINS}/menu-core.aot`);
	const target = fs.readBytesSync(`${PLUGINS}/watch-target.aot`);
	check.expect(module != null && target != null, "the plugins' files are read").toBe(true);
	if (module == null || target == null) {
		check.done();
		return;
	}

	const loads = menuLoads.number;
	const started = starts.number;
	const ended = ends.number;
	fs.writeFileSync(`${PLUGINS}/menu-core.aot`, module);
	await sleep(SETTLED);
	check.expect(menuLoads.number - loads, "a plugin that calls the module written again starts over once").toBe(1);
	check.expect(starts.number, "a plugin that does not call it runs on").toBe(started);

	fs.writeFileSync(`${PLUGINS}/watch-target.aot`, target.subarray(0, target.length >> 1));
	await sleep(SETTLED);
	check.expect(running(), "a file read halfway through an upload is refused").toBe(false);
	check.expect(ends.number - ended, "the plugin hears end before it goes").toBe(1);

	fs.writeFileSync(`${PLUGINS}/watch-target.aot`, target);
	await sleep(SETTLED);
	check.expect(running(), "the whole file is loaded").toBe(true);
	check.expect(starts.number - started, "and the plugin starts once").toBe(1);
	check.done();
}
