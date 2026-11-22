// Raises a forward from inside a game event's listener, at once and at the
// next frame: the subscribers of the first run inside this listener.
const spawned = new Forward<Player>("fih_on_spawned");
const spawnedLater = new Forward<Player>("fih_on_spawned_later");

game.addEventListener("playerSpawn", (event) => {
	const player = event.player;
	console.log("raiser: playerSpawn");
	spawned.emit(player);
	setTimeout(() => spawnedLater.emit(player));
	console.log("raiser: emitted");
});
