// A fixture for tests/messages.test.ts: the messages the server sends its
// clients as events - typed fields read and written, a message stopped, one
// whose layout the table does not know read by its arguments.

server.addEventListener("message:TextMsg", onText);
server.addEventListener("message:RoundTime", (event) => {
	event.seconds = 90;
});
server.addEventListener("message:HideWeapon", onHideWeapon);
server.addEventListener("message:TeamScore", (event) => {
	console.log(`score ${event.name} ${event.team} ${event.score}`);
	if (event.team == "CT") event.score = event.score + 1;
});
server.addEventListener("message:ItemPickup", (event) => {
	if (event.item == "weapon_knife") event.preventDefault();
});
server.addEventListener("message:DeathMsg", (event) => {
	const killer = event.killer;
	console.log(`death ${killer != null ? killer.name : "world"} ${event.victim?.name} ${event.headshot} ${event.weapon}`);
});
server.addEventListener("message:TeamInfo", (event) => {
	console.log(`team ${event.target?.name} ${event.team}`);
	if (event.team == "SPECTATOR") event.team = "CT";
});
server.addEventListener("message:ScreenFade", (event) => {
	console.log(`fade ${event.duration} ${event.hold} ${event.direction} ${event.modulate} ${event.stay} ${event.color.join(",")}`);
	event.direction = "in";
	event.stay = true;
	event.color = [255, 0, 0, 128];
});
server.addEventListener("message:StatusIcon", (event) => {
	console.log(`icon ${event.state} ${event.sprite} [${event.color.join(",")}]`);
});
server.addEventListener("message:ScoreAttrib", (event) => {
	console.log(`attrib ${event.target?.name} ${event.flags.join(",")}`);
	event.flags = event.flags.filter(flag => flag != "Bomb");
});
server.addEventListener("message:VGUIMenu", (event) => {
	if (event.menu == "team") event.preventDefault();
});
server.addEventListener("message:Damage", (event) => {
	console.log(`damage ${event.damage} ${event.origin.x} ${event.origin.y} ${event.origin.z}`);
	event.origin = [1, 2, 3];
});
server.addEventListener("message:VoiceMask", (event) => {
	console.log(`voice ${event.args.length} ${event.args.number(0)} ${event.args.isText(0)}`);
});

function onText(event: TextMsgMessage) {
	const player = event.player;
	console.log(`text ${event.destination} ${event.text} [${event.params.join("|")}] to ${player != null ? player.name : "everyone"}`);
	if (event.text == "#Round_Draw") event.preventDefault();
	if (event.text == "#Game_will_restart_in") event.params = ["5", "SECONDS"];
}

function onHideWeapon(event: HideWeaponMessage) {
	event.flags = event.flags.concat(["Money"]);
}
