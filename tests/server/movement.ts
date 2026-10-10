// A movement event on a real server: the player's movement the game is
// running - the frame's seconds and what he has touched - read through
// ReGameDLL, with no ReAPI native. The bots move. Plain HLDS hears no
// movement event.
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

server.addServerCommand("amxts_test_movement", async () => {
	const check = new Checks("movement");
	await sleep(500);
	if (server.versions.reGameDll == null) {
		check.expect(frames, "plain HLDS hears no movement event").toBe(0);
	} else {
		check.expect(frames > 0, "the bots' movement is heard").toBe(true);
		check.expect(longest > 0 && longest < 1, "a frame lasts a fraction of a second").toBe(true);
		check.expect(touched >= 0, "what the player touched is counted").toBe(true);
	}
	check.done();
});
