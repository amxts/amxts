// Temporary effects on a real server: a sprite precached from the top level
// has its index when the map has loaded, asking for it again later finds the
// same one - as a plugin reloaded mid-map does - and effects sent to
// everyone, near a point and to one player go out without an error. What a
// client draws cannot be checked from here.
import { Checks } from "@amxts/core/check";

const beam = server.precache("sprites/laserbeam.spr");
const bomb = server.precache("models/w_c4.mdl");

server.addServerCommand("amxts_test_effects", run);

function run() {
	const check = new Checks("effects");

	check.expect(beam.index > 0 && bomb.index > 0, `the top level's files are precached (${beam.index}, ${bomb.index})`).toBe(true);
	const again = server.precache("sprites/laserbeam.spr");
	check.expect(again.index, "asked for again after the map loaded, the same index").toBe(beam.index);

	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	const here = bot.origin;
	effects.beamCylinder({ at: here, radius: 385, sprite: beam, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
	effects.beamFollow({ entity: bot, sprite: beam, life: 1, width: 5, color: "#0096ff" });
	effects.beamPoints({ start: here, end: here.add([0, 0, 100]), sprite: beam, life: 1, width: 10 }, { to: bot });
	effects.sparks({ at: here });
	effects.dynamicLight({ at: here, radius: 200, life: 1, color: "#ff8000" });
	effects.breakModel({ at: here, size: [16, 16, 16], velocity: [0, 0, 50], model: bomb, count: 4, life: 1, material: "metal" });
	effects.killBeams({ entity: bot });
	check.expect(bot.isConnected, "the effects went out, the bot is still here").toBe(true);

	check.done();
}
