// A fixture for tests/messages.test.ts: the messages the server sends its
// clients as events - typed fields read and written, a message stopped, one
// name hearing two of the game's messages, one whose layout the table does
// not know read by its arguments.

server.addMessageListener("text", onText);
server.addMessageListener("roundTime", (event) => {
	event.seconds = 90;
});
server.addMessageListener("hideWeapon", onHideWeapon);
server.addMessageListener("teamScore", (event) => {
	console.log(`score ${event.name} ${event.team} ${event.score}`);
	if (event.team == "CT") event.score = event.score + 1;
});
server.addMessageListener("itemPickup", (event) => {
	if (event.item == "weapon_knife") event.preventDefault();
});
server.addMessageListener("death", (event) => {
	const killer = event.killer;
	console.log(`death ${killer != null ? killer.name : "world"} ${event.victim?.name} ${event.headshot} ${event.weapon}`);
});
server.addMessageListener("team", (event) => {
	console.log(`team ${event.target?.name} ${event.team}`);
	if (event.team == "SPECTATOR") event.team = "CT";
});
server.addMessageListener("screenFade", (event) => {
	console.log(`fade ${event.duration} ${event.hold} ${event.direction} ${event.modulate} ${event.stay} ${event.color.join(",")}`);
	event.direction = "in";
	event.stay = true;
	event.color = [255, 0, 0, 128];
});
server.addMessageListener("statusIcon", (event) => {
	console.log(`icon ${event.state} ${event.sprite} [${event.color.join(",")}]`);
});
server.addMessageListener("scoreAttribute", (event) => {
	console.log(`attrib ${event.target?.name} ${event.flags.join(",")}`);
	event.flags = event.flags.filter(flag => flag != "bomb");
});
server.addMessageListener("vguiMenu", (event) => {
	if (event.menu == "team") event.preventDefault();
});
server.addMessageListener("damage", (event) => {
	console.log(`damage ${event.damage} ${event.origin.x} ${event.origin.y} ${event.origin.z}`);
	event.origin = [1, 2, 3];
});
server.addMessageListener("progressBar", (event) => {
	console.log(`bar ${event.name} ${event.seconds} ${event.startPercent}`);
	if (event.seconds == 9) event.preventDefault();
	event.startPercent = 25;
});
server.addCommand("msg_bar", ({ player }) => {
	player.screen.progressBar(3, { startPercent: 50 });
});
server.addMessageListener("spectatedHealth", (event) => {
	console.log(`spectated ${event.name} ${event.health} ${event.target?.name}`);
});
server.addMessageListener("voiceMask", (event) => {
	console.log(`voice ${event.args.length} ${event.args.number(0)} ${event.args.isText(0)}`);
});

function onText(event: TextMsgMessage) {
	const player = event.player;
	console.log(`text ${event.destination} ${event.text} [${event.params.join("|")}] to ${player != null ? player.name : "everyone"}`);
	if (event.text == "#Round_Draw") event.preventDefault();
	if (event.text == "#Game_will_restart_in") event.params = ["5", "SECONDS"];
}

function onHideWeapon(event: HideWeaponMessage) {
	event.flags = event.flags.concat(["money"]);
}
