// A fixture for tests/player-fields.test.ts: another plugin reads what
// data-writer wrote, and still sees it while the player leaves.
import "./player-state";
import "./data-fields";

server.addCommand("data_read", read);
server.addEventListener("disconnected", event => console.log(`left with ${describe(event.player)}`));

function read(player: Player) {
	print(player, describe(player), "console");
}

function describe(player: Player) {
	return `ghost=${player.ghost} semiclip=${player.semiclip.enabled == false ? "off" : player.semiclip.enabled} kills=${player.kills} tag=${player.tag}`;
}
