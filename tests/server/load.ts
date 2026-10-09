// amxts_load of a plugin the list does not name, run from a handler: the new
// plugin joins the module's list while the handler is still on the stack, and
// its init() runs there. The handler awaits after it - the timer it registers
// then is its own - and must resume: an async function that never wakes up
// again leaves this suite to time out.
//
// A server loads .aot files only: a .ts with no .aot of its name beside it
// is said so, and nothing of it runs.
// @log [amxts] loaded load-target.aot
// @log [amxts] source-only.ts is source: the server loads only .aot - build it on your machine with npx amxts build and upload the .aot
import { server_exec } from "@amxts/core/natives";
import { existsSync, unlinkSync, writeFileSync } from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

// The test server's plugins folder, under the game folder.
const SOURCE = "addons/amxts/test/plugins/source-only.ts";

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

	check.expect(writeFileSync(SOURCE, "plugin({ name: \"source only\" });\n"), "a .ts is put beside the plugins").toBe(true);
	server.command("amxts_load source-only");
	server_exec();
	check.expect(starts.number, "a .ts with no .aot runs nothing").toBe(1);
	check.expect(existsSync("addons/amxts/test/plugins/source-only.aot"), "and nothing builds it").toBe(false);
	unlinkSync(SOURCE);
	check.done();
}
