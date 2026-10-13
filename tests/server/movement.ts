// A movement event on a real server: the player's movement the game is
// running - the frame's seconds and what he has touched - read through
// ReGameDLL, with no ReAPI native, or on plain HLDS through the module's
// hook of PM_Move. The bots move. A bot's own movement variables: the game
// moves him by them - his air acceleration, as the airAccelerate event hears
// it - and by the server's again after reset().
import { Checks } from "@amxts/core/check";

let frames = 0;
let longest = 0.0;
let touched = -1;

game.addEventListener("move", (event) => {
	if (!event.player.isBot) return;
	frames++;
	longest = Math.max(longest, event.frameTime);
	touched = Math.max(touched, event.touchCount);
}, true);

// The air acceleration the game moved the watched bot by, -1 until heard.
let watched = 0;
let heardAir = -1;

game.addEventListener("airAccelerate", (event) => {
	if (event.player.id == watched) heardAir = event.acceleration;
});

server.addServerCommand("amxts_test_movement", async () => {
	const check = new Checks("movement");
	await sleep(500);
	const regame = server.versions.reGameDll != null;
	check.expect(frames > 0, "the bots' movement is heard").toBe(true);
	check.expect(longest > 0 && longest < 1, "a frame lasts a fraction of a second").toBe(true);
	check.expect(touched >= 0, "what the player touched is counted").toBe(true);

	const bot = server.players.find(player => player.isBot && player.isAlive);
	check.expect(bot != null, "a living bot is on the server").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const air = new Cvar("sv_airaccelerate").number;
	bot.movement.airAccelerate = air + 90;
	check.expect(`${bot.movement.airAccelerate} ${bot.movement.friction}`, "his own value, and the server's for one not set").toBe(`${air + 90} ${new Cvar("sv_friction").number}`);
	watched = bot.id;
	bot.origin = bot.origin.add([0, 0, 32]);
	await sleep(300);
	if (regame) check.expect(heardAir, "the game moves him in the air by his own").toBe(air + 90);

	bot.movement.reset();
	heardAir = -1;
	bot.origin = bot.origin.add([0, 0, 32]);
	await sleep(300);
	if (regame) check.expect(heardAir, "and by the server's after reset()").toBe(air);
	check.expect(bot.movement.airAccelerate, "reset() gives him the server's").toBe(air);
	watched = 0;

	bot.slowdown = 0.5;
	bot.jumpSlowdown = 500;
	check.expect(`${bot.slowdown} ${bot.jumpSlowdown}`, "the slowdowns of a hit and a jump").toBe("0.5 500");
	bot.slowdown = 1;
	bot.jumpSlowdown = 0;
	check.done();
});
