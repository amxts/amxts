// Sounds and precache: server.precache in the "precache" event gives indices, and
// a sound from an entity, a sound to one player and a progress bar go out without
// errors - what the client hears cannot be checked from here.
import { Checks } from "@amxts/core/check";

const indices: number[] = [];

server.addEventListener("precache", () => {
	for (const path of ["items/gunpickup2.wav", "models/w_c4.mdl", "sprites/laserbeam.spr"]) indices.push(server.precache(path).index);
});

server.addServerCommand("amxts_test_sound", run);

function run() {
	const check = new Checks("sound");

	check.expect(indices.length, "precache passed in the precache event").toBe(3);
	check.expect(indices.every(index => index > 0), `every file has an index (${indices.join(", ")})`).toBe(true);

	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);

	if (bot != null) {
		bot.emitSound("items/gunpickup2.wav", { channel: "item", volume: 0.5, pitch: 120 });
		bot.playSound("items/gunpickup2.wav");
		bot.screen.progressBar(3);
		bot.screen.progressBar(0);
		check.expect(bot.isConnected, "the sounds and the bar went out, the bot is in place").toBe(true);
	}

	check.done();
}
