// Hears the raiser's forwards and the game event they are raised in.
const spawned = new Forward<Player>("fih_on_spawned");
const spawnedLater = new Forward<Player>("fih_on_spawned_later");

spawned.subscribe(() => console.log("listener: forward"));
spawnedLater.subscribe(() => console.log("listener: forward later"));
game.addEventListener("playerSpawn", () => console.log("listener: playerSpawn"));
