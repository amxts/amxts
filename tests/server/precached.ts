// server.precached counts what the map precached, the game's and every
// plugin's, by kind; once a kind nears the engine's room of 512, the console
// and AMX Mod X's log say so, naming the file and who precached it. The files
// here are other files - their names alone are kept, so none has to exist.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const FILES = 465;
// A folder of this run's own: AMX Mod X's logs are kept from run to run.
const RUN = `${Math.floor(Math.random() * 1e9)}`;
// The game's own files may come before or among them: which one is the 461st is not known.
const WARNING = "the map has precached 461 files of the engine's 512 - one past that stops the server; the last, ";

for (let i = 0; i < FILES; i++) server.precache(`amxts-test/precached/${RUN}/${i}.txt`);

server.addServerCommand("amxts_test_precached", () => {
	const check = new Checks("precached");
	const precached = server.precached;
	check.expect(precached.models > 1, `the map's models and the game's are counted (${precached.models})`).toBe(true);
	check.expect(precached.sounds > 1, `the game's sounds are counted (${precached.sounds})`).toBe(true);
	check.expect(precached.files >= FILES, `the plugin's files are counted (${precached.files})`).toBe(true);
	check.expect(precached.files < 512, "and the room is not full").toBe(true);

	// Said as the map loaded, before the suite: AMX Mod X's log keeps it.
	const logs = (fs.readdirSync(server.logsDir) ?? []).filter(name => name.endsWith(".log"));
	const lines = logs.flatMap(name => (fs.readFileSync(`${server.logsDir}/${name}`) ?? "").split("\n").filter(line => line.includes(WARNING)));
	const own = lines.some(line => line.includes(`"amxts-test/precached/${RUN}/`) && line.includes("\", by precached.aot"));
	check.expect(own, `the log names the file and the plugin at nine tenths (last such line: ${lines.length > 0 ? lines[lines.length - 1] : "none"})`).toBe(true);
	check.done();
});
