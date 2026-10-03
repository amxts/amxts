// A fixture for tests/game-events.test.ts: a hookchain's vector argument,
// read and written back - a shot's direction turned around.

game.addEventListener("traceAttack", (event) => {
	console.log(`dir ${event.direction.x} ${event.direction.y} ${event.direction.z}`);
	event.direction = new Vector(-event.direction.x, -event.direction.y, event.direction.z);
	console.log(`now ${event.direction.x} ${event.direction.y} ${event.direction.z}`);
});
