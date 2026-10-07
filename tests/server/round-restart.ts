// game.restartRound() starts the round over at once through the game rules'
// own RestartRound - ReGameDLL's through its API, plain HLDS's at its place in
// the game's table, never sv_restart - and the newRound listeners hear it;
// with completeReset the score starts from zero. game.checkWinConditions() is
// the game's own check. It restarts the round, so it runs after round-order
// (the suites go by name).
import { Checks } from "@amxts/core/check";

let newRounds = 0;

game.addEventListener("newRound", () => {
	newRounds++;
});
server.addServerCommand("amxts_test_round_restart", run);

function run() {
	const check = new Checks("round-restart");
	game.ctWins = 5;
	game.endRound({ winner: "CT", delay: 30, message: "", sound: "" });
	check.expect(game.roundEnding, "the round is ending before the restart").toBe(true);

	const before = newRounds;
	game.completeReset = true;
	game.restartRound();

	check.expect(newRounds - before, "the newRound listeners heard the restart").toBe(1);
	check.expect(game.roundEnding, "the round is on again, at once").toBe(false);
	check.expect(game.ctWins, "completeReset started the score from zero").toBe(0);

	game.checkWinConditions();
	check.expect(game.ctWins, "checkWinConditions ran the game's check").toBe(0);
	check.done();
}
