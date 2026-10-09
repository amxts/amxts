// A fixture for tests/player-fields.test.ts: one plugin writes the fields.
import "./player-state";
import "./data-fields";

server.addCommand("data_write [tag]", ({ player, tag }) => write(player, tag ?? ""));

function write(player: Player, tag: string) {
	player.ghost = true;
	player.kills = player.kills + 1.5;
	player.tag = tag;
	player.print(`written: ${player.kills}`, "console");
}
