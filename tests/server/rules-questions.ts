// The game rules' questions as events: on ReGameDLL through its hookchains,
// on Valve's game through the module's hook of the rules' table -
// heard as the game asks, before it decides, preventDefault() taken. A bot of
// its own spawns, is refused a rifle and then given it and drops it; the
// round's check and restart ask the rest, and a YaPB bot's death.
// canRespawn and fallDamage are left out: a dead player is asked only while
// he presses nothing, and a fall needs a map's height. It restarts the round,
// so it runs after round-restart (the suites go by name).
import { __hasChains, __hooksOriginal } from "@amxts/core";
import { Checks } from "@amxts/core/check";

const NAME = "amxts rules bot";

/** What the game asked, in order, about a player or the round: "spawnSpot", "canHaveItem weapon_ak47". */
const heard: string[] = [];
let bot: Player | null = null;
let refuse = false;

const ours = (player: Player) => bot != null && player.id == bot.id;

game.addEventListener("spawnSpot", (event) => {
	if (ours(event.player)) heard.push("spawnSpot");
});
game.addEventListener("canHaveItem", (event) => {
	if (!ours(event.player)) return;
	heard.push(`canHaveItem ${event.item.classname}`);
	if (refuse) event.preventDefault();
});
game.addEventListener("shouldSwitchWeapon", (event) => {
	if (ours(event.player)) heard.push(`shouldSwitchWeapon ${event.weapon.classname}`);
});
game.addEventListener("getNextBestWeapon", (event) => {
	if (ours(event.player)) heard.push("getNextBestWeapon");
});
game.addEventListener("dropWeaponsOnDeath", (event) => {
	heard.push(`dropWeaponsOnDeath ${event.player.id}`);
});
game.addEventListener("checkWinConditions", () => {
	heard.push("checkWinConditions");
});
game.addEventListener("removeGuns", () => {
	heard.push("removeGuns");
});
game.addEventListener("checkMapConditions", () => {
	heard.push("checkMapConditions");
});

server.addServerCommand("amxts_test_rules_questions", run);

/** Whether the game asked `question` after the first `since` lines of heard. */
function asked(question: string, since: number): boolean {
	return heard.slice(since).includes(question);
}

async function run() {
	const check = new Checks("rules-questions");
	check.expect(__hasChains(false) || __hooksOriginal("fl_player_fall_damage"), "the server hears the game rules' questions").toBe(true);
	bot = server.addBot(NAME);
	if (bot == null) {
		check.expect(false, "addBot gives a player").toBe(true);
		check.done();
		return;
	}
	const player = bot;

	player.joinTeam("TERRORIST");
	let since = heard.length;
	player.respawn();
	await sleep(300);
	check.expect(player.isAlive, "alive after respawn").toBe(true);
	check.expect(asked("spawnSpot", since), "spawnSpot: the game asked where he spawns").toBe(true);

	refuse = true;
	since = heard.length;
	check.expect(player.give("weapon_ak47"), "a rifle refused by canHaveItem's preventDefault()").toBe(false);
	check.expect(asked("canHaveItem weapon_ak47", since), "canHaveItem: the game asked").toBe(true);
	refuse = false;
	since = heard.length;
	check.expect(player.give("weapon_ak47"), "the rifle given once allowed").toBe(true);
	check.expect(asked("shouldSwitchWeapon weapon_ak47", since), "shouldSwitchWeapon: the game asked about it").toBe(true);

	since = heard.length;
	check.expect(player.dropItem("weapon_ak47") != null, "dropItem(\"weapon_ak47\")").toBe(true);
	check.expect(asked("getNextBestWeapon", since), "getNextBestWeapon: the game picked the next weapon").toBe(true);

	since = heard.length;
	game.checkWinConditions();
	check.expect(asked("checkWinConditions", since), "checkWinConditions: heard").toBe(true);

	since = heard.length;
	game.restartRound();
	check.expect(asked("removeGuns", since), "removeGuns: heard as the round restarts").toBe(true);
	// The original game asks it only as the map starts, before the plugins.
	if (__hasChains(false)) check.expect(asked("checkMapConditions", since), "checkMapConditions: heard as the round restarts").toBe(true);

	bot = null;
	player.kick();

	// A dead player's weapons are packed in his death's think, which a bot
	// that runs its moves has: YaPB's, armed again by the restart.
	const victim = server.players.find(other => other.isBot && other.isAlive && other.id != player.id) ?? null;
	check.expect(victim != null, "a living YaPB bot").toBe(true);
	if (victim != null) {
		const question = `dropWeaponsOnDeath ${victim.id}`;
		since = heard.length;
		victim.kill();
		for (let waited = 0; waited < 5000 && !asked(question, since); waited += 250) await sleep(250);
		check.expect(asked(question, since), "dropWeaponsOnDeath: the game asked what he drops").toBe(true);
	}
	check.done();
}
