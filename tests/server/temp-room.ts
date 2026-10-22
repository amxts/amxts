// Temp entities a plugin sends in one frame past what a packet holds beside
// the entities - about 3000 of its 4000 bytes - are said in the console and
// AMX Mod X's log, with the plugin and the player; on ReHLDS, which lets the
// module read what waits. Sparks to everyone wait in the server's datagram,
// which every player's packet carries.
// @log [amxts] temp-room.aot: temp entities wait for everyone in
import { Checks } from "@amxts/core/check";

/** Sparks in one frame: 8 bytes each, past the estimate and short of the whole packet. */
const SPARKS = 450;

server.addServerCommand("amxts_test_temp_room", () => {
	const check = new Checks("temp-room");
	for (let i = 0; i < SPARKS; i++) effects.sparks({ at: [0, 0, 0] });
	check.expect(server.versions.reHlds != null, "the server is ReHLDS, which shows the datagrams").toBe(true);
	check.done();
});
