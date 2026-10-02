// A fixture for tests/plain-hlds.test.ts: what a plugin does the same on a
// server with reapi and on one without - plain HLDS - while the hood picks
// another backend there. A player's events, a weapon's with no class; events
// of ReGameDLL's own, heard through the stock modules or not at all; fields
// in memory; a team's score and a round's end.

// First: its logevent comes before roundEnd's, as a listener of the freeze
// time's end that ends the round logs "Round_End" inside it.
let endAtStart = false;
game.addEventListener("roundStart", () => {
	console.log("round start");
	if (endAtStart) game.endRound({ winner: "CT", delay: 4, dispatch: true });
});
game.addEventListener("takeDamage", event => console.log(`hurt ${event.player.id} ${event.damage}`));
game.addEventListener("jump", event => console.log(`jump ${event.player.id}`));
game.addEventListener("canDeploy", event => console.log(`can deploy ${event.weapon.id}`));
game.addEventListener("roundEnd", onRoundEnd);
game.addEventListener("roundEnd", onRoundEnd, true);
game.addEventListener("flPlayerFallDamage", event => event.result / 2, true);

function onRoundEnd(event: RoundEndEvent) {
	console.log(`round ${event.winner} ${event.reason} ${event.delay}`);
}

game.addEventListener("newRound", () => console.log("new round"));
game.addEventListener("newRound", () => console.log("new round, respawned"), true);
game.addEventListener("cleanUpMap", () => console.log("map cleaned up"));
game.addEventListener("playerSpawn", event => console.log(`spawned ${event.player.id}`));
game.addEventListener("addMoney", event => console.log(`money ${event.player.id} ${event.amount}`));
game.addEventListener("defuseBombEnd", event => console.log(`defused ${event.player.id} ${event.defused}`));

// Stopped where the stock hook can stop it: a player's command, a purchase.
game.addEventListener("chooseTeam", (event) => {
	if (event.choice == "SPECTATOR") event.preventDefault();
});
game.addEventListener("hasRestrictItem", event => event.item == "awp");

// Asked of a stock hook that hears the game after it acted: one line, once.
game.addEventListener("playerSpawn", event => event.preventDefault());

server.addCommand("/fields", ({ player }) => {
	player.money = 1234;
	player.gravity = 0.5;
	player.teamName = "amxts";
	console.log(`fields ${player.money} ${player.gravity} ${player.teamName} ${player.origin.z}`);
});

server.addServerCommand("scores", () => {
	game.numCtWins = 3;
	console.log(`scores ${game.numCtWins} ${game.numTerroristWins}`);
});

server.addServerCommand("end", () => {
	game.endRound({ winner: "TERRORIST", delay: 3 });
	console.log(`ended ${game.roundWinner} ${game.roundTerminating}`);
});

server.addServerCommand("end_at_start", () => {
	endAtStart = true;
});

server.addServerCommand("end_told", () => {
	game.endRound({ winner: "CT", delay: 4, dispatch: true });
});

server.addServerCommand("time_limit", () => {
	console.log(`time limit ${game.timeLimit} ${game.gameStartTime} ${game.gameDesc} ${game.maxPlayers}`);
	game.timeLimit = 600;
});
