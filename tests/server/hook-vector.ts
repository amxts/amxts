// A game event's vector argument written back on a real server: a pre
// listener of traceAttack turns the shot's direction straight up, and the
// post listener - handed what the game was given - reads it so. The attack
// is the game's own function, run on a bot with no damage.
import { Call } from "@amxts/core";
import { DMG_BULLET, Ham_TraceAttack } from "@amxts/core/constants";
import { create_tr2, free_tr2, NATIVE_ExecuteHamB } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

let before = "";
let after = "";

game.addEventListener("traceAttack", (event) => {
	before = `${event.direction.x} ${event.direction.y} ${event.direction.z}`;
	event.direction = new Vector(0, 0, 1);
});
game.addEventListener("traceAttack", (event) => {
	after = `${event.direction.x} ${event.direction.y} ${event.direction.z}`;
}, true);

server.addServerCommand("amxts_test_hook_vector", () => {
	const check = new Checks("hook-vector");
	const bot = server.players.find(player => player.isBot && player.isAlive);
	check.expect(bot != null, "a living bot is on the server").toBe(true);

	if (bot != null) {
		const trace = create_tr2();
		new Call(NATIVE_ExecuteHamB).num(Ham_TraceAttack).num(bot.id).ref(bot.id).ref(0).vec(1, 0, 0).ref(trace).ref(DMG_BULLET).run();
		free_tr2(trace);
		check.expect(before, "the pre listener reads the direction given").toBe("1 0 0");
		check.expect(after, "the post listener reads the direction written").toBe("0 0 1");
	}
	check.done();
});
