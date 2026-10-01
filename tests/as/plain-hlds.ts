// A fixture for tests/plain-hlds.test.ts: what a plugin does the same on a
// server with reapi and on one without - plain HLDS - while the hood picks
// another backend there. A player's events, a weapon's with no class and an
// event of ReGameDLL's own; fields in memory; a team's score and a round's end.

game.addEventListener("takeDamage", event => console.log(`hurt ${event.player.id} ${event.damage}`));
game.addEventListener("jump", event => console.log(`jump ${event.player.id}`));
game.addEventListener("canDeploy", event => console.log(`can deploy ${event.weapon.id}`));
game.addEventListener("roundEnd", onRoundEnd);
game.addEventListener("roundEnd", onRoundEnd, true);

function onRoundEnd(event: RoundEndEvent) {
	console.log(`round ${event.winner}`);
}

server.addCommand("/fields", ({ player }) => {
	player.account = 1234;
	player.gravity = 0.5;
	player.teamName = "amxts";
	console.log(`fields ${player.account} ${player.gravity} ${player.teamName} ${player.origin.z}`);
});

server.addServerCommand("scores", () => {
	game.numCtWins = 3;
	console.log(`scores ${game.numCtWins} ${game.numTerroristWins}`);
});

server.addServerCommand("end", () => {
	game.endRound({ winner: "TERRORIST", delay: 3 });
	console.log(`ended ${game.roundWinner} ${game.roundTerminating}`);
});
