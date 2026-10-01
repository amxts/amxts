// Поля Player на сервере, шаг 2: другой TS-плагин видит то, что поставил
// data-1-write, - значение живёт в модуле, а не в памяти плагина.
import { Checks } from "@amxts/core/check";
import "../as/player-state";

server.addServerCommand("amxts_test_data_read", () => {
	const check = new Checks("data-read");
	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.ghost, "ghost из другого плагина").toBe(true);
	check.expect(bot.glow.enabled == true, "glow.enabled из другого плагина").toBe(true);
	check.expect(bot.glow.seenBy.includes(bot), "seenBy из другого плагина").toBe(true);
	check.expect(bot.hideTimer, "hideTimer никто не ставил").toBe(false);
	check.done();
});
