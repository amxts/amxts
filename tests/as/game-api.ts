// A fixture for tests/game-api.test.ts: the game rules as fields of `game`,
// and touches filtered by class.

server.addCommand("game_rules", ({ player }) => rules(player));
const logged: string[] = [];
server.addEventListener("log", (event) => {
	logged.push(`${event.text} | ${event.args.join(",")}`);
});
server.addCommand("game_logged", ({ player }) => print(player, logged.join(" / "), "console"));
server.addCommand("game_sides", ({ player }) => {
	game.ctWins = 3;
	game.terroristWins = 1;
	game.swapTeams();
	const swapped = `${game.ctWins} ${game.terroristWins}`;
	game.balanceTeams();
	print(player, `${swapped} ${game.timeLeft}`, "console");
});
server.addCommand("game_plugins", ({ player }) => {
	const own = server.plugins.find(plugin => plugin.file == "game-api.ts");
	print(player, own == null ? "none" : `${own.language} ${own.running}`, "console");
	own?.reload();
	own?.stop();
	server.loadPlugin("other.aot");
});
server.addCommand("game_restart", () => {
	game.restartRound();
	game.checkWinConditions();
});

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

server.addCommand("game_server", ({ player }) => {
	const versions = server.versions;
	const before = server.lightStyle;
	server.lightStyle = "b";
	print(player, `${server.game} ${versions.amxts} ${versions.amxModX} ${versions.reHlds} ${versions.reGameDll} ${server.mapExists("de_inferno")} ${server.mapExists("de_nowhere")} ${server.changeLevel("de_nowhere")} ${server.changeLevel("cs_office")} ${before} ${server.lightStyle}`, "console");
	server.print("Round 3");
	server.print("Go!", "center");
});

server.addCommand("game_languages", ({ player }) => {
	lang.load("myplugin");
	print(player, `${lang.languages().join(",")} ${lang.languages("other").join(",")} ${lang.languages("none").length}`, "console");
});
