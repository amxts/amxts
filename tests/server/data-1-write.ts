// Player fields on the server, step 1: one TS plugin sets the bot's ghost field.
// Then another TS plugin (data-2-read) and Pawn through a native (data-3-pawn)
// read it, and data-4-reset checks that the field is reset when the bot leaves.
import { Checks } from "@amxts/core/check";
import "../as/player-state";

server.addServerCommand("amxts_test_data_write", () => {
	const check = new Checks("data-write");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.ghost, "ghost before the write is the default").toBe(false);
	bot.ghost = true;
	check.expect(bot.ghost, "ghost is set").toBe(true);

	check.expect(bot.glow.enabled == "default", "glow before the write is default").toBe(true);
	bot.glow.enabled = true;
	bot.glow.seenBy = [bot];
	check.expect(bot.glow.enabled == true, "glow.enabled is set").toBe(true);
	check.expect(bot.glow.seenBy.length, "seenBy is one player").toBe(1);
	check.done();
});
