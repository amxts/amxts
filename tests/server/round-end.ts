// Поля события - имена, а не номера enum: game.endRound с dispatch зовёт
// обработчики roundEnd, и они видят победителя и причину словами.
// Раунд правда кончается и начинается заново, поэтому набор идёт почти
// последним (наборы идут по имени файла): проверки других попали бы в новый раунд.
import { Checks } from "~/lib/check";

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

	game.endRound({ winner: "CT", delay: 3, message: "", sound: "", dispatch: true });

	check.expect(heard, "обработчик roundEnd услышал конец раунда").toBe(true);
	check.expect(winner, "event.winner").toBe("CT");
	check.expect(reason, "event.reason").toBe("ctsWin");
	check.expect(delay, "event.delay").toBe(3);
	check.done();
}
