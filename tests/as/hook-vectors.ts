// A fixture for tests/game-events.test.ts: a hookchain's vector argument,
// read and written back - a shot's direction turned around.

game.addEventListener("traceAttack", (event) => {
	console.log(`dir ${event.dir.x} ${event.dir.y} ${event.dir.z}`);
	event.dir = new Vector(-event.dir.x, -event.dir.y, event.dir.z);
	console.log(`now ${event.dir.x} ${event.dir.y} ${event.dir.z}`);
});
