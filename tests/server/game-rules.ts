// Game rules - game's fields, generated as an entity's: a number, a fraction,
// a boolean, text and the round's winner by name. A team's score goes to the
// scoreboard at once: TeamScore is heard through the "teamScore" message. What
// is written is checked against reapi, and without it against fakemeta, whose
// offsets are the original game's, not ReGameDLL's. ReGameDLL's members without reapi
// read from what the server has: gameName is the game's name, timeLimit comes from mp_timelimit.
import { m_iNumCTWins, m_iNumTerroristWins } from "@amxts/core/constants";
import { get_cvar_float, get_gamerules_int, get_member_game, set_cvar_float } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_game_rules", () => {
	run();
});

/** The score sent out: "CT 7;TERRORIST 2;". */
let scores = "";

server.addMessageListener("teamScore", (event) => {
	scores += `${event.args.text(0)} ${event.args.number(1)};`;
});

async function run() {
	const check = new Checks("game-rules");

	const wins = game.ctWins;
	const terroristWins = game.terroristWins;
	scores = "";
	game.ctWins = wins + 7;
	check.expect(rulesMember(m_iNumCTWins, "m_iNumCTWins"), "ctWins is written to m_iNumCTWins").toBe(wins + 7);
	check.expect(game.ctWins, "ctWins reads back").toBe(wins + 7);
	check.expect(rulesMember(m_iNumTerroristWins, "m_iNumTerroristWins"), "the terrorists' score is untouched").toBe(terroristWins);
	check.expect(scores, "the scoreboard got the score at once").toBe(`CT ${wins + 7};TERRORIST ${terroristWins};`);
	game.ctWins = wins;

	check.expect(game.gameName.length > 0, `gameName is text (${game.gameName})`).toBe(true);
	check.expect(game.roundTimeSecs > 0, `roundTimeSecs is the round's seconds (${game.roundTimeSecs})`).toBe(true);
	check.expect(game.roundStartTime <= game.time, "roundStartTime is a moment in the past").toBe(true);
	check.expect(["none", "CT", "TERRORIST", "draw"].includes(game.roundWinner), `roundWinner is a name (${game.roundWinner})`).toBe(true);
	check.expect(game.mapInitialized, "mapInitialized is a boolean, the map is looked over").toBe(true);

	// The map's end by mp_timelimit: ReGameDLL recounts it a frame later, without reapi it comes from the cvar.
	const limit = get_cvar_float("mp_timelimit");
	set_cvar_float("mp_timelimit", 60);
	await sleep(200);
	check.expect(game.timeLimit - game.gameStartTime, "timeLimit is mp_timelimit minutes from the game's start").toBeCloseTo(3600);
	if (!hasModule("reapi")) {
		game.timeLimit = game.gameStartTime + 1200;
		check.expect(get_cvar_float("mp_timelimit"), "timeLimit is written to mp_timelimit").toBeCloseTo(20);
	}
	set_cvar_float("mp_timelimit", limit);

	check.done();
}

/** A game rules member read past game: by a reapi native, and without it by fakemeta. */
function rulesMember(member: number, name: string) {
	return hasModule("reapi") ? get_member_game(member) : get_gamerules_int("CHalfLifeMultiplay", name);
}
