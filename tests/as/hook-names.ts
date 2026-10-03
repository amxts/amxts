// A fixture for tests/game-events.test.ts: hookchain arguments that are Pawn
// enums and bit flags, read and written by name.

game.addEventListener("roundEnd", onRoundEnd);
game.addEventListener("showVguiMenu", onShowVguiMenu);
game.addEventListener("sendDeathMessage", onDeathMessage);
game.addEventListener("pain", (event) => {
	console.log(`pain ${event.lastHitGroup}`);
	if (event.lastHitGroup == "head") event.lastHitGroup = "chest";
});
game.addEventListener("itemRestricted", (event) => {
	console.log(`restrict ${event.item} ${event.restriction}`);
	return event.item == "awp";
});

function onRoundEnd(event: RoundEndEvent) {
	console.log(`roundEnd ${event.winner} ${event.reason} ${event.delay}`);
	if (event.reason == "targetSaved") event.reason = "terroristsWin";
	if (event.winner == "none") event.winner = "draw";
}

function onShowVguiMenu(event: ShowVguiMenuEvent) {
	console.log(`menu ${event.menu}`);
}

function onDeathMessage(event: SendDeathMessageEvent) {
	console.log(`death ${event.flags.join(",")} / ${event.rarity.join(",")}`);
	event.rarity = event.rarity.filter(name => name != "headshot");
}
