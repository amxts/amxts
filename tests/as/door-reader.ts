// A fixture for tests/player-fields.test.ts: another plugin reads the fields
// an entity carries.
import "./door-fields";

interface DoorArgs {
	id?: number;
}

server.addCommand<DoorArgs>("door_read [id]", ({ player, id }) => {
	const door = new Entity(id ?? 0);
	player.print(`${door.bhopBlock} ${door.doorSpeed} ${player.doorSpeed}`, "console");
});
