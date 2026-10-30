// The game's log on a real server: the `log` event hears each line the game
// logs, and read_logargv reads its arguments as AMX Mod X splits them - a
// quoted text is one, the words between are one. A bot's chat line is
// logged as `"Name<id><BOT><TEAM>" say "text"`, with ` (dead)` after it when
// the bot is dead - a fourth argument.
import { read_logargc, read_logargv, read_logdata } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const TEXT = "amxts log check";

let line = "";
let args: string[] = [];

server.addEventListener("log", () => {
	if (read_logargv(1) != "say" || read_logargv(2) != TEXT) return;
	line = read_logdata();
	args = [];
	for (let i = 0; i < read_logargc(); i++) args.push(read_logargv(i));
});

server.addServerCommand("amxts_test_log", () => {
	run();
});

async function run() {
	const check = new Checks("log");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	// The game says one chat line of a player in a moment, and a bot's own
	// chatter may take it: say it again.
	for (let tries = 0; tries < 3 && line.length == 0; tries++) {
		bot.command(`say "${TEXT}"`);
		for (let waits = 0; waits < 10 && line.length == 0; waits++) await sleep(50);
	}

	const dead = line.endsWith(" (dead)");
	check.expect(line.endsWith(`say "${TEXT}"${dead ? " (dead)" : ""}`), `the line is heard whole (${line})`).toBe(true);
	check.expect(args.length, "in three arguments, a fourth when the bot is dead").toBe(dead ? 4 : 3);
	check.expect(args.length > 0 && args[0].startsWith(`${bot.name}<`), `the first is the player, without its quotes (${args.length > 0 ? args[0] : ""})`).toBe(true);
	check.expect(args.length > 2 ? args[2] : "", "the last is the text, without its quotes").toBe(TEXT);
	check.done();
}
