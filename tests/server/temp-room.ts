// Temp entities a plugin sends in one frame past what a packet holds beside
// the entities - about 3000 of its 4000 bytes - are said in the console and
// AMX Mod X's log, with the plugin and the player, on ReHLDS, which lets the
// module read what waits; Valve's HLDS says nothing. Sparks to everyone wait
// in the server's datagram, which every player's packet carries.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

/** Sparks in one frame: 8 bytes each, past the estimate and short of the whole packet. */
const SPARKS = 450;
const WARNING = "temp-room.aot: temp entities wait for everyone in";

/** How many times AMX Mod X's logs have the warning: they are kept from run to run. */
function said() {
	const logs = (fs.readdirSync(server.logsDir) ?? []).filter(name => name.endsWith(".log"));
	return logs.reduce((count, name) => count + (fs.readFileSync(`${server.logsDir}/${name}`) ?? "").split(WARNING).length - 1, 0);
}

server.addServerCommand("amxts_test_temp_room", () => {
	const check = new Checks("temp-room");
	const before = said();
	for (let i = 0; i < SPARKS; i++) effects.sparks({ at: [0, 0, 0] });
	const reHlds = server.versions.reHlds != null;
	check.expect(said() - before, reHlds ? "ReHLDS: the log names the plugin and the player, once" : "Valve's HLDS: nothing is said").toBe(reHlds ? 1 : 0);
	check.done();
});
