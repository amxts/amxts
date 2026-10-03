// A game event's last listener taken off on a real server: its hook is
// switched off - reapi's chain, or Ham Sandwich's on a server without it - so
// a reset of a bot's speed costs what it costs with nobody listening, and the
// next listener switches it on again and hears each reset once.
import { Checks } from "@amxts/core/check";

const RESETS = 20_000;
const TRIES = 3;

let heard = 0;

function onReset() {
	heard++;
}

/** Microseconds a reset of the bot's speed takes, the best of three runs. */
function resetTakes(bot: Player) {
	let best = Number.POSITIVE_INFINITY;
	for (let run = 0; run < TRIES; run++) {
		const start = performance.now();
		for (let i = 0; i < RESETS; i++) bot.resetMaxSpeed();
		best = Math.min(best, performance.now() - start);
	}
	return best * 1000 / RESETS;
}

/** A time to the hundredth of a microsecond, for the check's line. */
function us(value: number) {
	return Math.round(value * 100) / 100;
}

server.addServerCommand("amxts_test_listeners_off", () => {
	const check = new Checks("listeners-off");
	const bot = server.players.find(player => player.isBot && player.isAlive);
	check.expect(bot != null, "a living bot to reset").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const unheard = resetTakes(bot);
	game.addEventListener("resetMaxSpeed", onReset);
	const listened = resetTakes(bot);
	game.removeEventListener("resetMaxSpeed", onReset);
	const taken = resetTakes(bot);
	check.expect(heard, "the listener heard every reset").toBe(RESETS * TRIES);
	const times = `unheard ${us(unheard)}, listened ${us(listened)}, taken off ${us(taken)}`;
	check.expect(taken - unheard < (listened - unheard) / 2, `with its last listener off a reset costs what it does unheard (${times})`).toBe(true);

	heard = 0;
	game.addEventListener("resetMaxSpeed", onReset);
	bot.resetMaxSpeed();
	game.removeEventListener("resetMaxSpeed", onReset);
	check.expect(heard, "the next listener hears a reset once").toBe(1);
	check.done();
});
