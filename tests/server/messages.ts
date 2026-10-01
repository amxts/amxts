// Messages to clients as events on a real server: a message the game sends -
// HideWeapon when a bot's hidden HUD changes, Money when his money is set,
// DeathMsg, ScoreInfo and ScoreAttrib when he dies - is heard by name with
// its fields typed, a field written is what the next listener reads, and the
// listener hears only its own message's name. AMX Mod X's message hooks do
// not see a message a plugin sends itself, so the game's is waited for.
import { AS_SET } from "@amxts/core/constants";
import { rg_add_account } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

let seen: HideHud[] = [];
let rewritten: HideHud[] = [];
let others = 0;

let money = -1;
let moneyTo = "";
let victim = "";
let weapon = "";
let headshot = true;
let scoreOf = "";
let deadOnBoard = "";

server.addEventListener("message:HideWeapon", (event) => {
	seen = event.flags;
	event.flags = event.flags.concat(["Crosshair"]);
});
server.addEventListener("message:HideWeapon", (event) => {
	rewritten = event.flags;
	if (event.name != "HideWeapon") others++;
});
server.addEventListener("message:Money", (event) => {
	money = event.amount;
	moneyTo = event.player?.name ?? "";
});
server.addEventListener("message:DeathMsg", (event) => {
	victim = event.victim?.name ?? "";
	weapon = event.weapon;
	headshot = event.headshot;
});
server.addEventListener("message:ScoreInfo", (event) => {
	scoreOf = event.target?.name ?? "";
});
server.addEventListener("message:ScoreAttrib", (event) => {
	if (event.flags.includes("Dead")) deadOnBoard = event.target?.name ?? "";
});

server.addServerCommand("amxts_test_messages", () => {
	run();
});

async function run() {
	const check = new Checks("messages");
	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	bot.hideHud = ["Money", "Timer"];
	await sleep(500);
	check.expect(seen.includes("Money") && seen.includes("Timer"), `the game's HideWeapon is heard, its flags names (${seen.join(", ")})`).toBe(true);
	check.expect(rewritten.includes("Crosshair"), "a field written is what the next listener reads").toBe(true);
	check.expect(others, "only HideWeapon reaches these listeners").toBe(0);
	bot.hideHud = [];

	rg_add_account(bot.id, 1234, AS_SET);
	await sleep(300);
	check.expect(money, "Money: the amount the game shows").toBe(1234);
	check.expect(moneyTo, "Money goes to the bot").toBe(bot.name);

	if (!bot.isAlive) {
		bot.respawn();
		await sleep(500);
	}

	bot.kill();
	await sleep(500);
	check.expect(victim, "DeathMsg: the victim is the bot, a Player").toBe(bot.name);
	check.expect(weapon.length > 0, `DeathMsg: the weapon is its icon's name (${weapon})`).toBe(true);
	check.expect(headshot, "DeathMsg: no headshot").toBe(false);

	check.expect(scoreOf, "ScoreInfo: the row is the bot's").toBe(bot.name);
	check.expect(deadOnBoard, "ScoreAttrib: the bot is \"Dead\" on the scoreboard").toBe(bot.name);

	bot.respawn();
	check.done();
}
