// amxts_load of a plugin the list does not name, run from a handler: the new
// plugin joins the module's list while the handler is still on the stack, and
// its init() runs there. The handler awaits after it - the timer it registers
// then is its own - and must resume: an async function that never wakes up
// again leaves this suite to time out.
// @log [amxts] loaded load-target.aot
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const starts = new Cvar("amxts_test_load_starts", "0");

server.addServerCommand("amxts_test_load", () => {
	load();
});

async function load() {
	const check = new Checks("load");
	server.command("amxts_load load-target");
	server_exec();
	check.expect(starts.number, "amxts_load starts a plugin the list does not name").toBe(1);

	let resumed = 0;
	await sleep(100);
	resumed += 1;
	await sleep(100);
	resumed += 1;
	check.expect(resumed, "the handler that loaded it resumes after each await").toBe(2);
	check.done();
}
