// Cyrillic reaches the server console as UTF-8, not as question marks. What
// is printed the plugin cannot see itself - the runner looks for the lines below in the log as they are.
//
// @log Привет, мир (console.log)
// @log Привет, мир (server_print)
import { contain, server_print, strlen } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const text = new Cvar("amxts_test_text", "");

server.addServerCommand("amxts_test_utf8", run);

function run() {
	const check = new Checks("utf8");

	console.log("Привет, мир (console.log)");
	server_print("Привет, мир (server_print)");

	check.expect("Привет".length, "a string's length in characters").toBe(6);

	text.value = "Ёлка и щука";
	check.expect(text.value, "the string went through a cvar and came back").toBe("Ёлка и щука");

	// A native gets the text whole, not the first 511 bytes.
	check.expect(strlen("я".repeat(1500)), "3000 bytes of Cyrillic reach the native").toBe(3000);
	check.expect(contain(`${"x".repeat(5000)}иголка`, "иголка"), "a needle after 5000 bytes is found").toBe(5000);
	check.done();
}
