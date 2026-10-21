// server.precached counts what the map precached, the game's and every
// plugin's, by kind; once a kind nears the engine's room of 512, the console
// and AMX Mod X's log say so, naming the file and who precached it. The files
// here are other files - their names alone are kept, so none has to exist.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const FILES = 465;
const WARNING = "the map has precached 461 files of the engine's 512 - one past that stops the server; the last, \"amxts-test/precached/460.txt\", by precached.aot";

for (let i = 0; i < FILES; i++) server.precache(`amxts-test/precached/${i}.txt`);

server.addServerCommand("amxts_test_precached", () => {
	const check = new Checks("precached");
	const precached = server.precached;
	check.expect(precached.models > 1, `the map's models and the game's are counted (${precached.models})`).toBe(true);
	check.expect(precached.sounds > 1, `the game's sounds are counted (${precached.sounds})`).toBe(true);
	check.expect(precached.files >= FILES, `the plugin's files are counted (${precached.files})`).toBe(true);
	check.expect(precached.files < 512, "and the room is not full").toBe(true);

	// Said as the map loaded, before the suite: AMX Mod X's log keeps it.
	const logs = fs.readdirSync(server.logsDir) ?? [];
	const said = logs.some(name => name.endsWith(".log") && (fs.readFileSync(`${server.logsDir}/${name}`) ?? "").includes(WARNING));
	check.expect(said, "the log names the file and the plugin at nine tenths").toBe(true);
	check.done();
});
