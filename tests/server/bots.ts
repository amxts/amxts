// A bot the plugin adds itself: it comes as any player does - connect,
// authorized with "BOT", putInServer - is a bot in server.players, walks when
// moved every frame, its command is read in cmdStart, joins the spectators -
// after the game's team, as a dead player who changed teams once a round may
// only change to them - and leaves when kicked: disconnected with the
// reason, then remove.
import { IN_USE, usercmd_buttons } from "@amxts/core/constants";
import { get_usercmd } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const NAME = "amxts walker";

let arrived = "";
let left = "";
/** The bot the frame moves forward, while it is set. */
let walking: Player | null = null;
/** What the slots heard, in order: `"3 connect"`, `"3 authorized BOT"`. */
const heard: string[] = [];
/** The buttons cmdStart read off a command, -1 before one. */
let buttons = -1;

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

function onCommand({ player }: ClientCmdStartEvent) {
	if (player.id == walking?.id) buttons = get_usercmd(usercmd_buttons);
}
server.addEventListener("frame", () => walking?.move({ forward: 250, buttons: ["use"] }));

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
	check.expect(buttons, "cmdStart reads the command's buttons (get_usercmd)").toBe(IN_USE);

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
	check.done();
}
