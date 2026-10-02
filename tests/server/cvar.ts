// A cvar created at the top level of the file. create_cvar during
// plugin_natives crashed the server while loading the plugin: that this plugin
// loaded at all and answers its command is half of the check.
import { Cvar, server } from "@amxts/core";
import { Checks } from "@amxts/core/check";

const answer = new Cvar("amxts_test_answer", "42");
const freeze = new Cvar("mp_freezetime");
let heard = "";

answer.addEventListener("change", (event) => {
	heard = event.value;
});

server.addServerCommand("amxts_test_cvar", run);

function run() {
	const check = new Checks("cvar");

	check.expect(answer.exists, "a top-level cvar is created").toBe(true);
	check.expect(answer.value, "the default value").toBe("42");
	check.expect(answer.number, "as a number").toBe(42);

	answer.number = 7;
	check.expect(answer.value, "an integer is written without a fraction").toBe("7");
	check.expect(heard, "the change listener heard the write").toBe("7");

	answer.value = "0";
	check.expect(answer.boolean, "0 is off").toBe(false);

	check.expect(freeze.exists, "another plugin's cvar is found by name").toBe(true);
	check.done();
}
