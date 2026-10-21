// What a plugin keeps with server.keep reaches its next start: across
// amxts_reload, its .aot written again, and amxts_unload with amxts_load. It
// is there while the plugin starts and gone after, and a start that does not
// read it leaves nothing for the next one.
import * as fs from "@amxts/core/fs";
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const PLUGINS = "addons/amxts/test/plugins";
/** What the watcher takes to see a file settled, load it and swap it in, with room to spare. */
const SETTLED = 1500;

const given = new Cvar("amxts_test_keep_given", "0");
const frames = new Cvar("amxts_test_keep_frames", "");
const skip = new Cvar("amxts_test_keep_skip", "0");

server.addServerCommand("amxts_test_keep", keep);

/** Runs a server command now, as the console would. */
function run(command: string) {
	server.command(command);
	server_exec();
}

async function keep() {
	const check = new Checks("keep");
	const first = given.number;
	check.expect(first >= 1, `the target started (${first})`).toBe(true);

	run("amxts_reload keep-target");
	check.expect(given.number, "amxts_reload: the new start reads what the last run kept").toBe(first + 1);
	check.expect(frames.value, "bytes are kept as they were").toBe([first, first, first].join(","));

	run("amxts_keep_late");
	check.expect(given.number, "once the start is over, what was kept is gone").toBe(-1);

	const file = fs.readBytesSync(`${PLUGINS}/keep-target.aot`);
	check.expect(file != null, "the target's file is read").toBe(true);
	if (file != null) {
		fs.writeFileSync(`${PLUGINS}/keep-target.aot`, file);
		await sleep(SETTLED);
		check.expect(given.number, "its .aot written again: the new start reads it too").toBe(first + 2);
	}

	run("amxts_unload keep-target");
	run("amxts_load keep-target");
	check.expect(given.number, "amxts_unload, then amxts_load on the same map: kept").toBe(first + 3);

	skip.number = 1;
	run("amxts_reload keep-target");
	skip.number = 0;
	run("amxts_reload keep-target");
	check.expect(given.number, "a start that does not read it leaves nothing behind").toBe(1);
	check.done();
}
