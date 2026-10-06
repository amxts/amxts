// Messages to clients as events on a real server: a message the game sends -
// HideWeapon when a bot's hidden HUD changes, Money when a restart resets it,
// DeathMsg, ScoreInfo and ScoreAttrib when he dies - is heard by name with
// its fields typed, a field written is what the next listener reads, and the
// listener hears only its own message's name. AMX Mod X's message hooks do
// not see a message a plugin sends with message_begin, so the game's is
// waited for; player.screen sends through the engine, and progressBar's
// BarTime2 is heard by the name that hears BarTime too. What goes out is
// what the module's trace says of each message it holds: HideWeapon with the
// flag a listener added, a bar a listener blocked not at all.
// @log [amxts] TRACE message HideWeapon sent changed
// @log [amxts] TRACE message BarTime blocked
import { cs_get_user_money } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** The bot whose hidden HUD the suite changes: other players' HideWeapon is not his. */
let watched = 0;
/** The first HideWeapon the watched bot got since the suite cleared it. */
let seen: HideHud[] = [];
let rewritten: HideHud[] = [];
let others = 0;

/** The money the game last showed each player, by name. */
const money = new Map<string, number>();
let victim = "";
let weapon = "";
let headshot = true;
/** The rows ScoreInfo updated since the bot died: other bots may score meanwhile. */
const scored: string[] = [];
let restarts = 0;
let deadOnBoard = "";
/** The progress bar heard for the bot: its game's name and start percent. */
let bar = "";
/** Whether the bar's listener blocks it. */
let blockBar = false;

server.addMessageListener("hideWeapon", (event) => {
	if (event.player?.id == watched && seen.length == 0) seen = event.flags;
	event.flags = event.flags.concat(["crosshair"]);
});
server.addMessageListener("hideWeapon", (event) => {
	rewritten = event.flags;
	if (event.name != "HideWeapon") others++;
});
server.addMessageListener("money", (event) => {
	money.set(event.player?.name ?? "", event.amount);
});
server.addMessageListener("death", (event) => {
	victim = event.victim?.name ?? "";
	weapon = event.weapon;
	headshot = event.headshot;
});
server.addMessageListener("score", (event) => {
	scored.push(event.target?.name ?? "");
});
server.addMessageListener("scoreAttribute", (event) => {
	if (event.flags.includes("dead")) deadOnBoard = event.target?.name ?? "";
});

server.addMessageListener("progressBar", (event) => {
	if (event.player?.id == watched) bar = `${event.name} ${event.seconds} ${event.startPercent}`;
	if (blockBar) event.preventDefault();
});

game.addEventListener("newRound", () => {
	restarts++;
});

server.addServerCommand("amxts_test_messages", () => {
	run();
});

async function run() {
	const check = new Checks("messages");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	// The first HideWeapon after the change is the one it caused: a round
	// that starts meanwhile respawns the bot, and the game shows his money
	// and timer again in one more. A respawn before the game sent it changes
	// the HUD back first, so the suite asks again.
	watched = bot.id;
	for (let tries = 0; tries < 3 && !(seen.includes("money") && seen.includes("timer")); tries++) {
		seen = [];
		bot.hideHud = ["money", "timer"];
		for (let waits = 0; waits < 10 && seen.length == 0; waits++) await sleep(50);
	}

	check.expect(seen.includes("money") && seen.includes("timer"), `the game's HideWeapon is heard, its flags names (${seen.join(", ")})`).toBe(true);
	check.expect(rewritten.includes("crosshair"), "a field written is what the next listener reads").toBe(true);
	check.expect(others, "only HideWeapon reaches these listeners").toBe(0);
	bot.hideHud = [];

	bot.screen.progressBar(3, { startPercent: 50 });
	check.expect(bar, "progressBar hears the screen's bar with a start percent, BarTime2").toBe("BarTime2 3 50");
	bot.screen.progressBar(0);
	check.expect(bar, "and the bar hidden, BarTime").toBe("BarTime 0 0");

	// The trace says what the module sent of each message it held.
	server.command("amxts_trace");
	await sleep(100);
	seen = [];
	bot.hideHud = ["flashlight"];
	for (let waits = 0; waits < 10 && seen.length == 0; waits++) await sleep(50);
	blockBar = true;
	bot.screen.progressBar(2);
	blockBar = false;
	check.expect(bar, "a blocked bar is heard by its listener").toBe("BarTime 2 0");
	server.command("amxts_trace");
	await sleep(100);
	bot.hideHud = [];

	// The game resets everyone's money as it restarts, ReAPI or not, a
	// second after it reads sv_restart. A plugin's own message
	// (cs_set_user_money's) is not heard.
	money.clear();
	const before = restarts;
	const restarted = () => restarts != before;
	server.command("sv_restart 1");
	for (let tries = 0; tries < 40 && !restarted(); tries++) await sleep(100);
	check.expect(money.has(bot.name), "Money goes to the bot").toBe(true);
	check.expect(money.get(bot.name) ?? -1, "Money: the amount the game shows").toBe(cs_get_user_money(bot.id));

	if (!bot.isAlive) {
		bot.respawn();
		await sleep(500);
	}

	scored.length = 0;
	bot.kill();
	await sleep(500);
	check.expect(victim, "DeathMsg: the victim is the bot, a Player").toBe(bot.name);
	check.expect(weapon.length > 0, `DeathMsg: the weapon is its icon's name (${weapon})`).toBe(true);
	check.expect(headshot, "DeathMsg: no headshot").toBe(false);

	check.expect(scored.includes(bot.name), `ScoreInfo: the bot's row is updated (${scored.join(", ")})`).toBe(true);
	check.expect(deadOnBoard, "ScoreAttrib: the bot is \"Dead\" on the scoreboard").toBe(bot.name);

	bot.respawn();
	check.done();
}
