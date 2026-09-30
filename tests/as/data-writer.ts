// A fixture for tests/player-fields.test.ts: one plugin writes the fields.
import "./player-state";
import "./data-fields";

server.addCommand("data_write", write);

function write(player: Player, args: string[]) {
	player.ghost = true;
	player.kills = player.kills + 1.5;
	player.tag = args.join(" ");
	print(player, `written: ${player.kills}`, "console");
}
