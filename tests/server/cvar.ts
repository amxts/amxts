// A cvar created at the top level of the file. create_cvar during
// plugin_natives crashed the server while loading the plugin: that this plugin
// loaded at all and answers its command is half of the check. A change is
// heard once, made by a plugin, by the console or by a config.
import { Cvar, server } from "@amxts/core";
import { Checks } from "@amxts/core/check";
import * as fs from "@amxts/core/fs";

const answer = new Cvar("amxts_test_answer", "42");
const freeze = new Cvar("mp_freezetime");
let heard = "";
let changes = 0;

answer.addEventListener("change", (event) => {
	heard = `${event.oldValue} -> ${event.value}`;
	changes++;
});

server.addServerCommand("amxts_test_cvar", run);

async function run() {
	const check = new Checks("cvar");

	check.expect(answer.exists, "a top-level cvar is created").toBe(true);
	check.expect(answer.value, "the default value").toBe("42");
	check.expect(answer.number, "as a number").toBe(42);

	answer.number = 7;
	check.expect(answer.value, "an integer is written without a fraction").toBe("7");
	check.expect(heard, "the change listener heard the write").toBe("42 -> 7");

	answer.value = "0";
	check.expect(answer.boolean, "0 is off").toBe(false);

	changes = 0;
	server.command("amxts_test_answer 5");
	await sleep(200);
	check.expect(heard, "a change typed in the console is heard").toBe("0 -> 5");
	check.expect(changes, "once").toBe(1);

	const config = `${server.configsDir}/amxts-test-cvar.cfg`;
	fs.writeFileSync(config, "amxts_test_answer 9\n");
	server.command(`exec ${config}`);
	await sleep(200);
	check.expect(heard, "a change a config makes is heard").toBe("5 -> 9");
	check.expect(changes, "once").toBe(2);

	server.command("amxts_test_answer 9");
	await sleep(200);
	check.expect(changes, "a value set again as it was is no change").toBe(2);

	check.expect(freeze.exists, "another plugin's cvar is found by name").toBe(true);
	check.done();
}
