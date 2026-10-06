// A bot the plugin adds itself: it comes as any player does, is a bot in
// server.players, walks when moved every frame, joins the spectators - after
// the game's team, as a dead player who changed teams once a round may only
// change to them - and leaves when kicked. A bot that takes the slot of the
// one that left is not heard spawning while the game counts it out (it spawns
// the bot as it joins, with the fields the last one left), and its spawn in
// a team is heard.
import { Checks } from "@amxts/core/check";
import { server_exec } from "@amxts/core/natives";

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
/** The spawns heard, as `<id> <hasDisconnected>`. */
const spawns: string[] = [];
game.addEventListener("playerSpawn", ({ player }) => {
	spawns.push(`${player.id} ${player.hasDisconnected}`);
}, { post: true });

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
	// The kick runs now, and the next bot takes the slot before anyone else can.
	server_exec();
	check.expect(left, "disconnected fired for the bot").toBe(NAME);
	check.expect(server.players.some(player => player.id == id && player.name == NAME), "it is gone from server.players").toBe(false);

	// The engine gives a bot the first free slot: the ones before it are filled first.
	spawns.length = 0;
	const fillers: Player[] = [];
	let next = server.addBot(NAME);
	while (next != null && next.id != id) {
		fillers.push(next);
		next = server.addBot(NAME);
	}
	check.expect(next != null ? next.id : 0, "a bot takes the slot the kicked one left").toBe(id);
	check.expect(spawns.filter(spawn => spawn.endsWith("true")).join(), "no spawn is heard while the game counts the bot out").toBe("");
	if (next != null) {
		next.joinTeam("CT");
		next.respawn();
		await sleep(300);
		check.expect(spawns.includes(`${id} false`), `its spawn in the team is heard (${spawns.join()})`).toBe(true);
		next.kick();
	}
	for (let i = 0; i < fillers.length; i++) fillers[i].kick();
	check.done();
}
