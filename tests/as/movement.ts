// A fixture for tests/game-events.test.ts: a movement event reads the
// player's movement the game is running.

game.addEventListener("airMove", (event) => {
	console.log(`air ${event.player.name} touched ${event.touchCount} in ${event.frameTime}`);
});
