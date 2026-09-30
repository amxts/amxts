// A fixture for tests/messages.test.ts: the messages the server sends its
// clients as events - typed fields read and written, a message stopped, one
// the editor has no fields for read by its arguments.

server.addEventListener("message:TextMsg", onText);
server.addEventListener("message:RoundTime", (event) => {
	event.seconds = 90;
});
server.addEventListener("message:HideWeapon", onHideWeapon);
server.addEventListener("message:TeamScore", (event) => {
	console.log(`score ${event.name} ${event.args.text(0)} ${event.args.number(1)} ${event.args.length} ${event.args.isText(0)}`);
});
server.addEventListener("message:ItemPickup", (event) => {
	if (event.item == "weapon_knife") event.preventDefault();
});

function onText(event: TextMsgMessage) {
	const player = event.player;
	console.log(`text ${event.destination} ${event.text} to ${player != null ? player.name : "everyone"}`);
	if (event.text == "#Round_Draw") event.preventDefault();
}

function onHideWeapon(event: HideWeaponMessage) {
	event.flags = event.flags.concat(["Money"]);
}
