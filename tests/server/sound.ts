// Sounds and precache: server.precache in the "precache" event gives indices, and
// a sound from an entity, a sound to one player and a progress bar go out without
// errors - what the client hears cannot be checked from here. A sound to one
// player and one whose startSound listeners choose its players are played with
// the players' groups set for that call alone: the bot's group is its own again
// right after, before the post listeners.
import { Checks } from "@amxts/core/check";

const indices: number[] = [];

/** The bot whose sounds the listeners below choose for, what they heard, and its group in the post listener. */
let source = 0;
let chosen = 0;
let groupAfter = -1;

function chooseNobody(event: StartSoundEvent) {
	if (event.entity.id != source) return;
	chosen++;
	event.recipients = [];
}

function readGroup(event: StartSoundEvent) {
	if (event.entity.id == source) groupAfter = event.entity.groupInfo;
}

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

		bot.groupInfo = 4;
		bot.emitSound("items/gunpickup2.wav", { to: bot });
		check.expect(bot.groupInfo, "a sound to one player leaves the bot's group as it was").toBe(4);

		source = bot.id;
		game.addEventListener("startSound", chooseNobody);
		game.addEventListener("startSound", readGroup, { post: true });
		bot.emitSound("items/gunpickup2.wav");
		game.removeEventListener("startSound", chooseNobody);
		game.removeEventListener("startSound", readGroup, { post: true });
		check.expect(chosen, "startSound hears the sound, and its listener chooses the players").toBe(1);
		check.expect(groupAfter, "the post listener sees the bot's own group").toBe(4);
		check.expect(bot.groupInfo, "the bot's group is its own after the sound").toBe(4);
		bot.groupInfo = 0;
	}

	check.done();
}
