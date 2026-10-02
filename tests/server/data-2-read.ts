// Player fields on the server, step 2: another TS plugin sees what data-1-write
// set - the value lives in the module, not in the plugin's memory.
import { Checks } from "@amxts/core/check";
import "../as/player-state";

server.addServerCommand("amxts_test_data_read", () => {
	const check = new Checks("data-read");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.ghost, "ghost from another plugin").toBe(true);
	check.expect(bot.glow.enabled == true, "glow.enabled from another plugin").toBe(true);
	check.expect(bot.glow.seenBy.includes(bot), "seenBy from another plugin").toBe(true);
	check.expect(bot.hideTimer, "nobody set hideTimer").toBe(false);
	check.done();
});
