// game.endRound кончает раунд, как его кончает игра: победитель, момент
// следующего раунда, раунд помечен кончающимся, счёт не тронут. С dispatch
// он зовёт обработчики roundEnd, и они видят победителя и причину словами:
// с reapi - его событие, без него - строки лога, как пишет их игра.
// Раунд правда кончается и начинается заново, поэтому набор идёт почти
// последним (наборы идут по имени файла): проверки других попали бы в новый раунд.
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
	const ctWins = game.numCtWins;

	game.endRound({ winner: "CT", delay: 3, message: "", sound: "", dispatch: true });

	check.expect(game.roundWinner, "roundWinner - победитель").toBe("CT");
	check.expect(game.roundTerminating, "раунд кончается").toBe(true);
	check.expect(game.restartRoundTime - game.time, "следующий раунд через delay").toBeCloseTo(3);
	check.expect(game.numCtWins, "счёт не тронут").toBe(ctWins);

	check.expect(heard, "обработчик roundEnd услышал конец раунда").toBe(true);
	check.expect(winner, "event.winner").toBe("CT");
	check.expect(reason, "event.reason").toBe("ctsWin");
	check.expect(delay, "event.delay").toBeCloseTo(3);
	check.done();
}
