// game.endRound ends the round as the game ends it: the winner, the moment of
// the next round, the round marked as ending, the score untouched. With dispatch
// it calls the roundEnd listeners, and they see the winner and the reason in words:
// with reapi its event, without it the log lines as the game writes them.
// The round really ends and starts again, so the suite runs almost
// last (suites run by file name): other suites' checks would land in the new round.
import { Checks } from "@amxts/core/check";

let winner: RoundWinner = "none";
let reason: RoundEndReason = "unknown";
let delay = 0.0;
let heard = false;

game.addEventListener("roundEnd", onRoundEnd, true);
server.addServerCommand("amxts_test_round_end", run);

function onRoundEnd(event: RoundEndEvent) {
	heard = true;
	winner = event.winner;
	reason = event.reason;
	delay = event.delay;
}

function run() {
	const check = new Checks("round-end");
	const ctWins = game.ctWins;

	game.endRound({ winner: "CT", delay: 3, message: "", sound: "", dispatch: true });

	check.expect(game.roundWinner, "roundWinner is the winner").toBe("CT");
	check.expect(game.roundEnding, "the round is ending").toBe(true);
	check.expect(game.newRoundTime - game.time, "the next round in delay").toBeCloseTo(3);
	check.expect(game.ctWins, "the score is untouched").toBe(ctWins);

	check.expect(heard, "the roundEnd listener heard the round end").toBe(true);
	check.expect(winner, "event.winner").toBe("CT");
	check.expect(reason, "event.reason").toBe("ctsWin");
	check.expect(delay, "event.delay").toBeCloseTo(3);
	check.done();
}
