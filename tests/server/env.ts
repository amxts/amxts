// env() on the server: a variable of hlds's environment, one the test
// folder's .env adds (scripts/test-server.ts writes both), the environment
// over the file, and a value turned into its default's kind. Then a plugin
// that requires a variable neither has, and reads another that is not a
// number: refused with one line, which a game panel reads, and started by
// amxts_reload once .env has both.
// @log [amxts] env-needs needs AMXTS_TEST_LIMIT as a number, AMXTS_TEST_NEEDED in addons/amxts/test/.env
// @log refused   needs AMXTS_TEST_LIMIT as a number, AMXTS_TEST_NEEDED in addons/amxts/test/.env
// @log env-needs read yes, 7
import { Checks } from "@amxts/core/check";
import * as fs from "@amxts/core/fs";

const DOTENV = "addons/amxts/test/.env";

server.addServerCommand("amxts_test_env", run);

async function run() {
	const check = new Checks("env");

	check.expect(env("AMXTS_TEST_ENV"), "a variable of the server's environment").toBe("from the environment");
	check.expect(env("AMXTS_TEST_FILE"), "one .env adds, # and spaces kept in quotes").toBe("from the file # kept");
	check.expect(env("AMXTS_TEST_BOTH"), "the environment wins over .env").toBe("from the environment");
	check.expect(env("AMXTS_TEST_NONE", "none"), "the default of a variable there is not").toBe("none");
	check.expect(env("AMXTS_TEST_NUMBER", 0), "a number").toBe(42.5);
	check.expect(env("AMXTS_TEST_SWITCH", false), "an on/off switch, in any case").toBe(true);
	check.expect(env("AMXTS_TEST_NONE", 3), "a number's default").toBe(3);

	server.command("amxts_load env-needs");
	await sleep(200);
	server.command("amxts_plugins");
	await sleep(200);

	fs.writeFileSync(DOTENV, `${fs.readFileSync(DOTENV) ?? ""}AMXTS_TEST_NEEDED=yes\nAMXTS_TEST_LIMIT=7\n`);
	server.command("amxts_reload env-needs");
	await sleep(200);
	check.done();
}
