// Messages to clients as events on a real server: a message the game sends -
// HideWeapon, when a bot's hidden HUD changes - is heard by name with its
// fields typed, a field written is what the next listener reads, and the
// listener hears only its own message's name. AMX Mod X's message hooks do
// not see a message a plugin sends itself, so the game's is waited for.
import { Checks } from "@amxts/core/check";

let seen: HideHud[] = [];
let rewritten: HideHud[] = [];
let others = 0;

server.addEventListener("message:HideWeapon", (event) => {
	seen = event.flags;
	event.flags = event.flags.concat(["Crosshair"]);
});
server.addEventListener("message:HideWeapon", (event) => {
	rewritten = event.flags;
	if (event.name != "HideWeapon") others++;
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
	check.done();
}
