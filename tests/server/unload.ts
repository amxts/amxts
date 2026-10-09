// amxts_unload stops one plugin and takes back what it registered, and
// amxts_load starts it again: unload-target.ts's interval and its server
// command stop with it, and come back once each; amxts_reload with its name
// starts it alone over. This plugin runs on through all of it.
// @log [amxts] unloaded unload-target.aot
// @log [amxts] loaded unload-target.aot
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const ticks = new Cvar("amxts_test_unload_ticks", "0");
const pings = new Cvar("amxts_test_unload_pings", "0");
const ends = new Cvar("amxts_test_unload_ends", "0");

server.addServerCommand("amxts_test_unload", unload);

/** Runs a server command now, as the console would. */
function run(command: string) {
	server.command(command);
	server_exec();
}

function unload() {
	const check = new Checks("unload");
	check.expect(ticks.number > 0, `the target's interval runs (${ticks.number} ticks)`).toBe(true);

	run("amxts_unload unload-target");
	check.expect(ends.number, "an unloaded plugin hears end first").toBe(1);
	run("amxts_plugins");
	const before = pings.number;
	run("amxts_ping_unload");
	check.expect(pings.number, "an unloaded plugin's server command answers nothing").toBe(before);

	const stopped = ticks.number;
	setTimeout(() => {
		check.expect(ticks.number, "an unloaded plugin's interval does not fire").toBe(stopped);
		load(check);
	}, 1000);
}

function load(check: Checks) {
	run("amxts_load unload-target");
	run("amxts_plugins");
	const before = pings.number;
	run("amxts_ping_unload");
	check.expect(pings.number - before, "a loaded plugin's server command answers once").toBe(1);

	ticks.number = 0;
	setTimeout(() => {
		check.expect(ticks.number >= 3 && ticks.number <= 6, `its interval fires once a period (${ticks.number} in 1 s at 0.2 s)`).toBe(true);
		reload(check);
	}, 1000);
}

function reload(check: Checks) {
	run("amxts_reload unload-target");
	check.expect(ends.number, "a reloaded plugin hears end first").toBe(2);
	const before = pings.number;
	run("amxts_ping_unload");
	check.expect(pings.number - before, "after amxts_reload of the plugin its server command answers once").toBe(1);
	check.done();
}
