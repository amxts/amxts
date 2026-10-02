// A fixture for tests/game-api.test.ts: the game rules as fields of `game`,
// and touches filtered by class.

server.addCommand("game_rules", ({ player }) => rules(player));

game.addEventListener("touch", onPlayers, { toucher: "player", touched: "player" });
game.addEventListener("touch", onBox, { touched: "myplugin_box" });
game.addEventListener("takeDamage", afterDamage, true);

function onPlayers(event: TouchEvent) {
	console.log(`players ${event.toucher.id} -> ${event.touched.id}`);
}

function onBox(event: TouchEvent) {
	console.log(`box touched by a ${event.toucher.classname}`);
	event.preventDefault();
}

function afterDamage(event: TakeDamageEvent) {
	console.log(`hurt ${event.player.id}`);
}

function rules(player: Player) {
	const before = `${game.isFreezeTime} ${game.ctWins} ${game.roundWinner}`;
	game.isFreezeTime = false;
	game.ctWins = 3;
	game.terroristWins = 2;
	game.roundWinner = "TERRORIST";
	game.newRoundTime = 12.5;
	print(player, `${before} -> ${game.isFreezeTime} ${game.ctWins} ${game.terroristWins} ${game.roundWinner} ${game.newRoundTime}`, "console");
}
