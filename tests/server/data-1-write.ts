// Поля Player на сервере, шаг 1: один TS-плагин ставит боту поле ghost.
// Дальше его читают другой TS-плагин (data-2-read) и Pawn через натив
// (data-3-pawn), а data-4-reset проверяет, что с уходом бота поле сброшено.
import { Checks } from "~/lib/check";
import "../as/player-state";

server.addServerCommand("amxts_test_data_write", () => {
	const check = new Checks("data-write");
	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.ghost, "ghost до записи - по умолчанию").toBe(false);
	bot.ghost = true;
	check.expect(bot.ghost, "ghost поставлен").toBe(true);

	check.expect(bot.semiclip.enabled == "default", "semiclip до записи - default").toBe(true);
	bot.semiclip.enabled = true;
	bot.semiclip.passesThrough = [bot];
	check.expect(bot.semiclip.enabled == true, "semiclip.enabled поставлен").toBe(true);
	check.expect(bot.semiclip.passesThrough.length, "passesThrough - один игрок").toBe(1);
	check.done();
});
