// A player's commands and the server's, as the module hears them: a bot's
// command in chat - `say` and `say_team` - and in its console, one it lacks
// the right for, a word a typed command does not take, a command of the
// server console, the module's own amxts_plugins, and a command a `command`
// listener stops before the game and the plugins' commands get it.
// @log Usage: amxts_commands_count <count>
// @log plugin(s):
import { read_flags, remove_user_flags, set_user_flags } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

interface CountArgs {
	count: number;
}

/** What the commands heard, in order. */
const heard: string[] = [];

server.addCommand("/amxts_commands [words]", ({ player, words }) => {
	heard.push(`chat ${player.name} ${words ?? ""}`);
});
server.addCommand<CountArgs>("amxts_commands_give <count>", ({ count }) => {
	heard.push(`give ${count}`);
});
server.addCommand("amxts_commands_admin", () => {
	heard.push("admin");
}, { access: "rcon" });
server.addServerCommand<CountArgs>("amxts_commands_count <count>", ({ count }) => {
	heard.push(`count ${count}`);
});
server.addServerCommand("amxts_test_commands", run);

// While it is set, a chat line goes no further than the `command` event.
let stopping = false;
server.addEventListener("command", (event) => {
	if (stopping && event.command == "say") event.preventDefault();
});

// The chat line the game last said, as its log has it.
let said = "";
server.addEventListener("log", (event) => {
	if (event.args.length > 2 && event.args[1] == "say") said = event.args[2];
});

/** Waits a moment for the game's log line of a chat line. */
async function lineSaid() {
	for (let waits = 0; waits < 10 && said.length == 0; waits++) await sleep(50);
	return said;
}

/** What the commands heard since the last call, joined. */
function took() {
	const said = heard.join(", ");
	heard.length = 0;
	return said;
}

async function run() {
	const check = new Checks("commands");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	bot.command("say /amxts_commands one two");
	check.expect(took(), "say /name: the chat command, with its words").toBe(`chat ${bot.name} one two`);
	bot.command("say_team \"/AMXTS_COMMANDS three\"");
	check.expect(took(), "say_team /NAME, quoted as the game's chat sends it: the same command, in any case").toBe(`chat ${bot.name} three`);

	bot.command("amxts_commands_give 5");
	check.expect(took(), "a console command, its word read as a number").toBe("give 5");
	bot.command("amxts_commands_give five");
	check.expect(took(), "a word the command does not take: the handler does not run").toBe("");

	const rcon = read_flags("l");
	remove_user_flags(bot.id, rcon);
	bot.command("amxts_commands_admin");
	check.expect(took(), "a player without the right does not run the command").toBe("");
	set_user_flags(bot.id, rcon);
	bot.command("amxts_commands_admin");
	check.expect(took(), "with the right, he does").toBe("admin");
	remove_user_flags(bot.id, rcon);

	// The game says one chat line of a player in a moment: the stopped one
	// goes first, which the game never gets.
	said = "";
	stopping = true;
	bot.command("say amxts commands stopped");
	check.expect(await lineSaid(), "preventDefault in a command listener: the game does not say it").toBe("");
	bot.command("say /amxts_commands stopped");
	check.expect(took(), "and no addCommand hears it").toBe("");
	stopping = false;
	bot.command("say amxts commands line");
	check.expect(await lineSaid(), "without it, the game says the line").toBe("amxts commands line");

	// The server's console runs a command on the next frame.
	server.command("amxts_commands_count 3");
	server.command("amxts_commands_count three");
	server.command("amxts_plugins");
	await sleep(100);
	check.expect(took(), "a server command from the console; one with a wrong word answers its usage").toBe("count 3");
	check.done();
}
