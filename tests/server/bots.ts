// A bot the plugin adds itself: it comes as any player does - connect,
// authorized with "BOT", putInServer - is a bot in server.players, walks when
// moved every frame, its command is read in cmdStart - and written there:
// a forward speed taken away stops it - joins the spectators -
// after the game's team, as a dead player who changed teams once a round may
// only change to them - and leaves when kicked: disconnected with the
// reason, then remove. A bot that takes the slot of the one that left is not
// heard spawning while the game counts it out (it spawns the bot as it joins,
// with the fields the last one left), and its spawn in a team is heard.
import { Checks } from "@amxts/core/check";

const NAME = "amxts walker";

let arrived = "";
let left = "";
/** The bot the frame moves forward, while it is set. */
let walking: Player | null = null;
/** What the slots heard, in order: `"3 connect"`, `"3 authorized BOT"`. */
const heard: string[] = [];
/** What cmdStart read off the walker's last command, "" before one. */
let command = "";
/** Whether cmdStart takes the walker's forward speed away. */
let stopping = false;

server.addEventListener("connect", ({ player }) => {
	heard.push(`${player.id} connect`);
});
server.addEventListener("authorized", ({ player, steamId }) => {
	heard.push(`${player.id} authorized ${steamId}`);
});
server.addEventListener("putInServer", ({ player }) => {
	arrived = player.name;
	heard.push(`${player.id} putInServer`);
});
server.addEventListener("disconnected", ({ player, dropped, reason }) => {
	left = player.name;
	heard.push(`${player.id} disconnected ${dropped} ${reason}`);
});
server.addEventListener("remove", ({ player, dropped, reason }) => {
	heard.push(`${player.id} remove ${dropped} ${reason}`);
});

function onCommand(event: ClientCmdStartEvent) {
	if (event.player.id != walking?.id) return;
	command = `${event.forward} ${event.side} ${event.buttons.join("+")} ${event.msec} ${Math.round(event.angles.y)}`;
	if (stopping) event.forward = 0;
}
server.addEventListener("frame", () => walking?.move({ forward: 250, side: -100, buttons: ["use"], angles: [0, 30, 0], msec: 10 }));
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
	const own = (line: string) => line.startsWith(`${bot.id} `);
	check.expect(heard.filter(own).join(", "), "connect, authorized and putInServer, in order").toBe(`${bot.id} connect, ${bot.id} authorized BOT, ${bot.id} putInServer`);
	check.expect(bot.isBot, "isBot").toBe(true);
	check.expect(bot.name, "its name").toBe(NAME);
	check.expect(server.players.some(player => player.id == bot.id && player.isBot), "it is in server.players as a bot").toBe(true);

	check.expect(bot.joinTeam("CT"), "joinTeam(\"CT\")").toBe(true);
	bot.respawn();
	await sleep(300);
	check.expect(bot.isAlive, "alive after respawn").toBe(true);

	const from = bot.origin;
	server.addEventListener("cmdStart", onCommand);
	walking = bot;
	await sleep(500);
	walking = null;
	server.removeEventListener("cmdStart", onCommand);
	const to = bot.origin;
	const walked = Math.hypot(to.x - from.x, to.y - from.y);
	check.expect(walked > 16, `moved forward over the frames (${Math.round(walked)} units)`).toBe(true);
	check.expect(command, "cmdStart reads the command bot.move sent").toBe("250 -100 use 10 30");

	const still = bot.origin;
	server.addEventListener("cmdStart", onCommand);
	stopping = true;
	walking = bot;
	await sleep(500);
	walking = null;
	stopping = false;
	server.removeEventListener("cmdStart", onCommand);
	const along = bot.origin.subtract(still);
	// The move along yaw 30. A bot moves only by its commands, so the walk's
	// speed dies down in the first of them: a forward speed of 250 would take
	// it over 100 units.
	const forwardPart = along.x * Math.cos(Math.PI / 6) + along.y * Math.sin(Math.PI / 6);
	check.expect(Math.abs(forwardPart) < 40, `forward written 0 in cmdStart: no forward move (${Math.round(forwardPart)} units)`).toBe(true);

	check.expect(bot.joinTeam("SPECTATOR"), "joinTeam(\"SPECTATOR\")").toBe(true);
	check.expect(bot.team, "in the spectators").toBe("SPECTATOR");

	const id = bot.id;
	heard.length = 0;
	bot.kick("bye now");
	await sleep(300);
	check.expect(left, "disconnected fired for the bot").toBe(NAME);
	const leave = heard.filter(line => line.startsWith(`${id} `));
	check.expect(leave.length, `disconnected, then remove (${leave.join(" | ")})`).toBe(2);
	check.expect(leave.length == 2 && leave[0].startsWith(`${id} disconnected true `) && leave[0].includes("bye now"), "disconnected: dropped, with the kick's reason").toBe(true);
	check.expect(leave.length == 2 && leave[1].startsWith(`${id} remove true `) && leave[1].includes("bye now"), "remove: dropped, with the same reason").toBe(true);
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
