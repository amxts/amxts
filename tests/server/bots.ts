// A bot the plugin adds itself: it comes as any player does, is a bot in
// server.players, walks when moved every frame, joins the spectators - after
// the game's team, as a dead player who changed teams once a round may only
// change to them - and leaves when kicked.
import { Checks } from "@amxts/core/check";

const NAME = "amxts walker";

let arrived = "";
let left = "";
/** The bot the frame moves forward, while it is set. */
let walking: Player | null = null;

server.addEventListener("putInServer", ({ player }) => {
	arrived = player.name;
});
server.addEventListener("disconnected", ({ player }) => {
	left = player.name;
});
server.addEventListener("frame", () => walking?.move({ forward: 250 }));

server.addServerCommand("amxts_test_bots", run);

async function run() {
	const check = new Checks("bots");

	const bot = server.addBot(NAME);
	check.expect(bot != null, "addBot gives a player").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(arrived, "putinserver fired for the bot").toBe(NAME);
	check.expect(bot.isBot, "isBot").toBe(true);
	check.expect(bot.name, "its name").toBe(NAME);
	check.expect(server.players.some(player => player.id == bot.id && player.isBot), "it is in server.players as a bot").toBe(true);

	check.expect(bot.joinTeam("CT"), "joinTeam(\"CT\")").toBe(true);
	bot.respawn();
	await sleep(300);
	check.expect(bot.isAlive, "alive after respawn").toBe(true);

	const from = bot.origin;
	walking = bot;
	await sleep(500);
	walking = null;
	const to = bot.origin;
	const walked = Math.hypot(to.x - from.x, to.y - from.y);
	check.expect(walked > 16, `moved forward over the frames (${Math.round(walked)} units)`).toBe(true);

	check.expect(bot.joinTeam("SPECTATOR"), "joinTeam(\"SPECTATOR\")").toBe(true);
	check.expect(bot.team, "in the spectators").toBe("SPECTATOR");

	const id = bot.id;
	bot.kick();
	await sleep(300);
	check.expect(left, "disconnected fired for the bot").toBe(NAME);
	check.expect(server.players.some(player => player.id == id && player.name == NAME), "it is gone from server.players").toBe(false);
	check.done();
}
