// A game event on a real server, through the module's own hook of the
// game's function: a pre listener's change of an argument is what the
// function goes on with, a pre listener's answer keeps it from running, a
// post listener reads the game's answer and gives its own. With ReAPI, a Pawn
// plugin's handler of the same chain (chains-pawn.sma) comes first before
// the game and last after it. The damage is the game's own TakeDamage, run
// on a bot.
import { Call, floatCell, hook } from "@amxts/core";
import { DMG_GENERIC, Ham_TakeDamage } from "@amxts/core/constants";
import { NATIVE_ExecuteHamB } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

let running = false;
let written = 0.0;
let result = -1;
let hooked = -1;
const order: string[] = [];

/** chains-pawn.sma's handlers of the same chain, before the game (0) and after it (1). */
export function chains_pawn(post: number) {
	if (running) order.push(post != 0 ? "pawn post" : "pawn pre");
}

game.addEventListener("takeDamage", (event) => {
	if (!running) return;
	order.push("ts pre");
	event.damage = 10;
	written = event.damage;
});
game.addEventListener("takeDamage", (event) => {
	if (!running) return;
	order.push("ts post");
	result = event.result;
}, true);

// A raw hook made at the top level, before the plugin has its instance: its
// `number` parameters still get the cells as numbers. A server without
// ReGameDLL has no such hook (0).
function onTakeDamage(self: number) {
	if (running) hooked = self;
}
const topLevelHook = hook("take_damage", onTakeDamage);

function block(): number {
	return 0;
}

function answer(): number {
	return 7;
}

/** The game's TakeDamage on the player, 40 points from the world; what it answers. */
function hurt(player: Player): number {
	return new Call(NATIVE_ExecuteHamB).num(Ham_TakeDamage).num(player.id).ref(0).ref(0).ref(floatCell(40)).ref(DMG_GENERIC).run();
}

server.addServerCommand("amxts_test_chains", () => {
	const check = new Checks("chains");
	const bot = server.players.find(player => player.isBot && player.isAlive);
	check.expect(bot != null, "a living bot is on the server").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	bot.armor = 0;
	bot.health = 100;
	running = true;

	const took = hurt(bot);
	check.expect(written, "the listener reads the damage it wrote").toBe(10);
	check.expect(bot.health, "the game takes the damage the listener wrote").toBe(90);
	check.expect(`${took} ${result}`, "the game's answer reaches the caller and the post listener").toBe("1 1");
	const pawnFirst = hasModule("reapi") ? "pawn pre,ts pre,ts post,pawn post" : "ts pre,ts post";
	check.expect(order.join(","), "Pawn's handler comes first before the game and last after it").toBe(pawnFirst);
	if (topLevelHook != 0) check.expect(hooked, "a raw hook made at the top level reads its arguments as numbers").toBe(bot.id);

	game.addEventListener("takeDamage", block);
	result = -1;
	const blocked = hurt(bot);
	game.removeEventListener("takeDamage", block);
	check.expect(bot.health, "a pre listener's answer keeps the game's function from running").toBe(90);
	check.expect(`${blocked} ${result}`, "the answer is what the caller and the post listener get").toBe("0 0");

	game.addEventListener("takeDamage", answer, true);
	const answered = hurt(bot);
	game.removeEventListener("takeDamage", answer, true);
	check.expect(bot.health, "with a post listener's answer the game's function still runs").toBe(80);
	check.expect(answered, "the post listener's answer is the caller's").toBe(7);

	running = false;
	bot.health = 100;
	check.done();
});
