// The game rules' functions as events, and AddAccount's and
// GiveDefaultItems': on ReGameDLL through its hookchains, on Valve's game
// through the module's hook of the rules' table and of the functions' start -
// heard before the game acts, preventDefault() and a written field taken.
// A YaPB bot, who joined as a player does, spawns without and with his
// default items; a bot of its own, a terrorist, is killed by himself with
// and without the game counting it, then by the YaPB bot, who is paid for
// it, and his info changes; the round's restart resets the map between its
// two newRound phases. It restarts the round, so
// it runs after round-restart and rules-questions (the suites go by name).
import { __hasChains, __hooksOriginal } from "@amxts/core";
import { Checks } from "@amxts/core/check";
import { DLLFunc_ClientUserInfoChanged, EngFunc_GetInfoKeyBuffer } from "@amxts/core/constants";
import { dllfunc, engfunc } from "@amxts/core/natives";

/** What the game did, in order: "playerSpawn 3", "deathNotice 3 3 3". */
const heard: string[] = [];
const ours: number[] = [];
let preventSpawn = false;
let preventKill = false;
let doubleMoney = false;
let thinks = 0;

const isOurs = (player: Player) => ours.includes(player.id);

game.addEventListener("gameThink", () => {
	thinks++;
});
game.addEventListener("newRound", () => {
	heard.push("newRound");
});
game.addEventListener("newRound", () => {
	heard.push("newRound after");
}, true);
game.addEventListener("mapReset", () => {
	heard.push("mapReset");
});
game.addEventListener("playerSpawn", (event) => {
	if (!isOurs(event.player)) return;
	heard.push(`playerSpawn ${event.player.id}`);
	if (preventSpawn) event.preventDefault();
});
game.addEventListener("giveDefaultItems", (event) => {
	if (isOurs(event.player)) heard.push(`giveDefaultItems ${event.player.id}`);
});
game.addEventListener("playerKilled", (event) => {
	if (!isOurs(event.victim)) return;
	heard.push(`playerKilled ${event.victim.id} ${event.killer.id}`);
	if (preventKill) event.preventDefault();
});
game.addEventListener("deathNotice", (event) => {
	if (isOurs(event.victim)) heard.push(`deathNotice ${event.victim.id} ${event.killer.id} ${event.inflictor.id}`);
});
game.addEventListener("addMoney", (event) => {
	if (!isOurs(event.player)) return;
	heard.push(`addMoney ${event.player.id} ${event.amount}`);
	if (doubleMoney) event.amount = event.amount * 2;
});
game.addEventListener("playerGotWeapon", (event) => {
	if (isOurs(event.player)) heard.push(`playerGotWeapon ${event.player.id} ${event.weapon.classname}`);
});
game.addEventListener("userInfoChange", (event) => {
	if (isOurs(event.player) && event.info.includes("amxts_events")) heard.push(`userInfoChange ${event.player.id}`);
});

server.addServerCommand("amxts_test_rules_events", run);

/** Whether `line` was heard after the first `since` lines. */
function did(line: string, since: number): boolean {
	return heard.slice(since).includes(line);
}

/** Where `line` was heard after the first `since` lines, -1 for nowhere. */
function at(line: string, since: number): number {
	const found = heard.slice(since).indexOf(line);
	return found < 0 ? -1 : since + found;
}

async function run() {
	const check = new Checks("rules-events");
	check.expect(__hasChains(false) || __hooksOriginal("player_spawn"), "the server hears the game rules' functions").toBe(true);
	const terrorist = server.addBot("amxts events T");
	const counter = server.players.find(other => other.isBot && other.team == "CT") ?? null;
	if (terrorist == null || counter == null) {
		check.expect(terrorist != null, "addBot gives a player").toBe(true);
		check.expect(counter != null, "a YaPB bot of the counter-terrorists").toBe(true);
		check.done();
		return;
	}

	ours.push(terrorist.id);
	ours.push(counter.id);
	const t = terrorist.id;
	const ct = counter.id;
	terrorist.joinTeam("TERRORIST");
	await sleep(300);

	const since = thinks;
	await sleep(200);
	check.expect(thinks > since, "gameThink: heard as the game thinks").toBe(true);

	// A map with game_player_equip gives its items in place of the default ones.
	const equips = Entity.find({ classname: "game_player_equip" }) != null;
	counter.killed(counter, 0);
	let from = heard.length;
	preventSpawn = true;
	counter.respawn();
	preventSpawn = false;
	check.expect(did(`playerSpawn ${ct}`, from), "playerSpawn: heard as he spawns").toBe(true);
	check.expect(did(`giveDefaultItems ${ct}`, from), "playerSpawn's preventDefault(): the game's spawn of him skipped, no default items").toBe(false);

	counter.killed(counter, 0);
	from = heard.length;
	counter.respawn();
	await sleep(100);
	check.expect(counter.isAlive, "alive after respawn").toBe(true);

	if (!equips) {
		check.expect(at(`giveDefaultItems ${ct}`, from) > at(`playerSpawn ${ct}`, from), `giveDefaultItems: heard inside the game's spawn of him (${heard.slice(from).join(" | ")})`).toBe(true);
		check.expect(did(`playerGotWeapon ${ct} weapon_knife`, from), "playerGotWeapon: heard for his knife").toBe(true);
	}

	terrorist.respawn();
	await sleep(100);

	let frags = terrorist.frags;
	from = heard.length;
	preventKill = true;
	terrorist.killed(terrorist, 0);
	preventKill = false;
	check.expect(did(`playerKilled ${t} ${t}`, from), "playerKilled: heard as he kills himself").toBe(true);
	check.expect(terrorist.frags, "playerKilled's preventDefault(): his frags kept").toBe(frags);
	check.expect(heard.slice(from).some(line => line.startsWith(`deathNotice ${t}`)), "playerKilled's preventDefault(): no death notice").toBe(false);

	terrorist.respawn();
	await sleep(100);
	frags = terrorist.frags;
	from = heard.length;
	terrorist.killed(terrorist, 0);
	check.expect(terrorist.frags, "playerKilled: the game took a frag").toBe(frags - 1);
	check.expect(heard.slice(from).some(line => line.startsWith(`deathNotice ${t} ${t} `)), "deathNotice: heard with the victim and the killer").toBe(true);

	terrorist.respawn();
	await sleep(100);
	const money = counter.money;
	from = heard.length;
	doubleMoney = true;
	terrorist.killed(counter, 0);
	doubleMoney = false;
	check.expect(did(`playerKilled ${t} ${ct}`, from), "playerKilled: heard as the other kills him").toBe(true);
	check.expect(did(`addMoney ${ct} 300`, from), "addMoney: the killer's reward heard").toBe(true);
	check.expect(counter.money, "addMoney: the amount a listener doubled is paid").toBe(Math.min(money + 600, 16000));

	// The engine tells the game of a changed info as a client sends it, which a bot does not.
	terrorist.info.set("amxts_events", "renamed");
	from = heard.length;
	dllfunc(DLLFunc_ClientUserInfoChanged, t, engfunc(EngFunc_GetInfoKeyBuffer, t));
	check.expect(did(`userInfoChange ${t}`, from), "userInfoChange: heard with his info").toBe(true);

	from = heard.length;
	game.restartRound();
	const reset = at("mapReset", from);
	check.expect(at("newRound", from) >= 0 && at("newRound", from) < reset, "newRound: heard before the map is reset").toBe(true);
	check.expect(at("newRound after", from) > reset, "newRound: heard after the game once the map is reset").toBe(true);

	ours.length = 0;
	terrorist.kick();
	check.done();
}
