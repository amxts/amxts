// A fixture for tests/player-fields.test.ts: one plugin writes the fields an
// entity carries, on a door it makes and on the player.
import "./door-fields";

server.addCommand("door_make", ({ player }) => {
	const door = Entity.create("info_target");
	if (door == null) return;
	door.bhopBlock = "held";
	door.doorSpeed = 250;
	player.doorSpeed = 1.5;
	player.print(`${door.id}`, "console");
});
