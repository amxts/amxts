// A round as the game plays it, on any server - plain HLDS too, where the
// hood hears ReGameDLL's events through the stock modules: a new round
// before the players respawn, their spawns, the new round once they are
// alive, the end of the freeze time and the round's end with its winner and
// reason, in that order; the money the new round pays; the map's first round
// heard once. On plain HLDS the bomb's events are the game's log lines,
// written here as the game writes them.
// It plays a whole round, so it runs after round-end (the suites go by name).
import { Checks } from "@amxts/core/check";
import { elog_message, get_user_authid, get_user_userid } from "@amxts/core/natives";

/** What the round did, in order. */
const heard: string[] = [];
/** New rounds heard before the first freeze time ended: the map's first round. */
let atMapStart = 0;
let freezeEnded = false;
/** Players alive when the new round's listeners after the game ran. */
let aliveAfter = -1;
let paid = 0;
let winner: RoundWinner = "none";
let reason: RoundEndReason = "unknown";
let defused = 0;
let defuseStarted = 0;
/** Whether the round under check is on: its start kills the terrorists. */
let playing = false;

game.addEventListener("restartRound", () => {
	heard.push("new round");
	if (!freezeEnded) atMapStart++;
});
game.addEventListener("restartRound", () => {
	heard.push("new round, after");
	aliveAfter = Player.all({ alive: true }).length;
}, true);
game.addEventListener("playerSpawn", () => {
	heard.push("spawn");
});
game.addEventListener("onRoundFreezeEnd", () => {
	heard.push("round start");
	freezeEnded = true;
	if (playing) killSide("TERRORIST");
});
game.addEventListener("roundEnd", (event) => {
	heard.push("round end");
	winner = event.winner;
	reason = event.reason;
});
game.addEventListener("addAccount", (event) => {
	if (event.amount > 0) paid++;
});
game.addEventListener("defuseBombStart", (event) => {
	defuseStarted = event.player.id;
});
game.addEventListener("defuseBombEnd", (event) => {
	if (event.defused) defused = event.player.id;
});

server.addServerCommand("amxts_test_round_order", () => {
	run();
});

function killSide(team: Team) {
	for (const player of Player.all({ alive: true, team })) player.kill();
}

/** A bot on each side, alive: the game ends a round when one side is dead. */
async function twoSides(): Promise<boolean> {
	if (Player.all({ bots: true }).length < 2) server.command("yb add");
	// A bot that has just come picks his side himself first: wait for it, then move him.
	const sided = () => Player.all({ bots: true }).filter(bot => bot.team == "TERRORIST" || bot.team == "CT").length;
	for (let tries = 0; tries < 30 && sided() < 2; tries++) await sleep(200);
	const bots = Player.all({ bots: true });
	if (bots.length < 2) return false;
	bots[0].team = "TERRORIST";
	bots[1].team = "CT";
	return true;
}

async function run() {
	const check = new Checks("round-order");
	check.expect(atMapStart <= 1, `the map's first round is heard once at most (${atMapStart})`).toBe(true);

	server.command("mp_freezetime 1");
	const sides = await twoSides();
	check.expect(sides, "a bot on each side").toBe(true);
	if (!sides) {
		check.done();
		return;
	}

	// The round on now ends - by the game, these deaths, or as a draw - and the next is the one checked.
	if (!game.roundTerminating) killSide("TERRORIST");
	for (let tries = 0; tries < 20 && !game.roundTerminating; tries++) await sleep(100);
	if (!game.roundTerminating) game.endRound({ winner: "draw", delay: 1 });
	heard.length = 0;
	paid = 0;
	playing = true;
	for (let tries = 0; tries < 120 && !heard.includes("round end"); tries++) await sleep(100);
	playing = false;

	const order = heard.filter((one, i) => one != "spawn" || heard[i - 1] != "spawn").join(" > ");
	check.expect(order, "a round's events in order").toBe("new round > spawn > new round, after > round start > round end");
	check.expect(heard.filter(one => one == "new round").length, "one new round").toBe(1);
	check.expect(aliveAfter >= 2, `the players are alive when the new round's listeners after the game run (${aliveAfter})`).toBe(true);
	// The bots are far from the game's 16000 here: a restart (messages) reset them, and a round or two paid since.
	check.expect(paid > 0, `the new round pays the players (${paid})`).toBe(true);
	check.expect(winner, "roundEnd: the winner").toBe("CT");
	check.expect(reason, "roundEnd: the reason").toBe("ctsWin");

	if (!hasModule("reapi")) {
		// Plain HLDS hears the bomb's defuse as the game's log lines.
		const defuser = Player.all({ bots: true })[1];
		const named = `"${defuser.name}<${get_user_userid(defuser.id)}><${get_user_authid(defuser.id)}><CT>"`;
		elog_message(`${named} triggered "Begin_Bomb_Defuse_With_Kit"`);
		elog_message(`${named} triggered "Defused_The_Bomb"`);
		await sleep(100);
		check.expect(defuseStarted, "defuseBombStart: the defuser").toBe(defuser.id);
		check.expect(defused, "defuseBombEnd: the defuser").toBe(defuser.id);
	}

	server.command("mp_freezetime 0");
	check.done();
}
