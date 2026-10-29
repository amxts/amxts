// A plugin out of memory stops. oom-target.aot asks for more memory than it
// can have and traps as the allocator does then: the module stops it at the
// next frame, its interval and its server command with it, says why in one
// line of the log, says nothing of what it fails until then, lists it as
// stopped - and amxts_reload starts it again, its memory in the list.
// @log oom-target.aot: RuntimeError: unreachable
// @log [amxts] oom-target.aot stopped: out of memory, its memory
// @log stopped   out of memory, its memory
// @log MiB  (no plugin() call)
import { get_localinfo, server_exec } from "@amxts/core/natives";
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const ticks = new Cvar("amxts_test_oom_ticks", "0");
const pings = new Cvar("amxts_test_oom_pings", "0");

server.addServerCommand("amxts_test_out_of_memory", start);

/** Runs a server command now, as the console would. */
function run(command: string) {
	server.command(command);
	server_exec();
}

/** How many lines of AMX Mod X's logs name the target. */
function logged(): number {
	const dir = get_localinfo("amxx_logs");
	let count = 0;
	for (const file of fs.readdirSync(dir) ?? []) {
		if (!file.endsWith(".log")) continue;
		count += (fs.readFileSync(`${dir}/${file}`) ?? "").split("\n").filter(line => line.includes("oom-target.aot")).length;
	}
	return count;
}

function start() {
	run("amxts_load oom-target");
	setTimeout(breakIt, 500);
}

function breakIt() {
	const check = new Checks("out-of-memory");
	check.expect(ticks.number > 0, `the target's interval runs (${ticks.number} ticks)`).toBe(true);

	const before = logged();
	run("amxts_oom_break");
	for (let i = 0; i < 3; i++) run("amxts_oom_fail");

	setTimeout(() => {
		check.expect(logged() - before, "the log has the failure and the line it stops with, nothing after").toBe(2);
		run("amxts_plugins");
		const pinged = pings.number;
		run("amxts_oom_ping");
		check.expect(pings.number, "a stopped plugin's server command answers nothing").toBe(pinged);
		const stopped = ticks.number;
		setTimeout(() => {
			check.expect(ticks.number, "a stopped plugin's interval does not fire").toBe(stopped);
			reload(check);
		}, 500);
	}, 300);
}

function reload(check: Checks) {
	run("amxts_reload oom-target");
	run("amxts_plugins");
	const before = pings.number;
	run("amxts_oom_ping");
	check.expect(pings.number - before, "after amxts_reload its server command answers once").toBe(1);
	run("amxts_unload oom-target");
	check.done();
}
