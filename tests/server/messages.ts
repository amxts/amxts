// Messages to clients as events on a real server: a message the game sends -
// HideWeapon when a bot's hidden HUD changes, Money when a restart resets it,
// DeathMsg, ScoreInfo and ScoreAttrib when he dies - is heard by name with
// its fields typed, a field written is what the next listener reads, and the
// listener hears only its own message's name. AMX Mod X's message hooks do
// not see a message a plugin sends itself, so the game's is waited for.
import { cs_get_user_money } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** The bot whose hidden HUD the suite changes: other players' HideWeapon is not his. */
let watched = 0;
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

server.addMessageListener("hideWeapon", (event) => {
	if (event.player?.id == watched) seen = event.flags;
	event.flags = event.flags.concat(["Crosshair"]);
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
	if (event.flags.includes("Dead")) deadOnBoard = event.target?.name ?? "";
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

	watched = bot.id;
	bot.hideHud = ["Money", "Timer"];
	await sleep(500);
	check.expect(seen.includes("Money") && seen.includes("Timer"), `the game's HideWeapon is heard, its flags names (${seen.join(", ")})`).toBe(true);
	check.expect(rewritten.includes("Crosshair"), "a field written is what the next listener reads").toBe(true);
	check.expect(others, "only HideWeapon reaches these listeners").toBe(0);
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
