// A fixture for tests/world.test.ts: traces, a player's aim and sight, angles, and what the server sends and is sent.

const round = (v: number[]): string => `${Math.round(v[0] * 100) / 100},${Math.round(v[1] * 100) / 100},${Math.round(v[2] * 100) / 100}`;

server.addCommand("world_angles", ({ player }) => {
	const forward = Vector.fromAngles([0, 90, 0]);
	const down = Vector.fromAngles([45, 0, 0]);
	const back = new Vector(1, 1, -1).toAngles();
	const { right, up } = Vector.directions([0, 0, 0]);
	player.print(`${round(forward)} ${round(down)} ${round(back)} ${round(Vector.fromAngles(back).subtract(new Vector(1, 1, -1).normalize()))} ${round(right)} ${round(up)}`, "console");
});
server.addCommand("world_trace", ({ player }) => {
	const hit = trace.line([0, 0, 0], [200, 0, 0], { ignore: player });
	const clear = trace.hull([0, 0, 0], [0, 0, 50], "human");
	player.print(`${hit.fraction} ${round(hit.end)} ${round(hit.normal)} ${hit.entity?.id} ${hit.hit} ${clear.hit} ${clear.entity == null} ${pointContents([100, 0, 0])} ${pointContents([5, 0, 0])}`, "console");
});
server.addCommand("world_aim", ({ player }) => {
	const aim = player.aim;
	const bob = server.players.find(each => each.name == "Bob")!;
	player.print(`${aim.entity?.id} ${aim.hitGroup} ${round(aim.point)} ${player.canSee(bob)} ${player.canSeePoint([-100, 0, 0])} ${player.canSeePoint([50, 10, 0])}`, "console");
});
server.addCommand("world_view", ({ player }) => {
	const camera = Entity.create("info_target")!;
	player.view = camera;
	const through = player.view;
	player.view = null;
	player.print(`${through != null && through.id == camera.id} ${player.view == null}`, "console");
});
server.addCommand("world_model", ({ player }) => {
	player.model = "vip";
	const worn = player.model;
	player.setModel("santa", { hitboxes: true });
	player.resetModel();
	player.print(`${worn} ${player.model}`, "console");
});
game.addEventListener("entityState", (event) => {
	if (event.player.name == "Bob") {
		event.preventDefault();
		return;
	}
	event.renderFx = "glowShell";
	event.renderColor = [255, 0, 0];
	event.origin = event.origin.add([0, 0, 10]);
	event.sequence = event.sequence + 1;
	event.gaitSequence = 6;
	event.frame = event.frame / 2;
	event.frameRate = 0;
	event.animTime = event.animTime + 0.5;
	event.ducking = !event.ducking;
}, { classname: "myplugin_marker" });
game.addEventListener("clientData", (event) => {
	if (event.player.name != "Bob") return;
	event.fov = 45;
	event.maxSpeed = event.maxSpeed / 2;
	event.velocity = [0, 0, 0];
	event.punchAngle = event.punchAngle.add([1, 0, 0]);
	event.viewOffset = [0, 0, 12];
	event.origin = event.origin.add([0, 0, 10]);
	event.flags = ["onGround", "ducking"];
});
game.addEventListener("visibility", (event) => {
	if (event.player.name != "Bob") return;
	event.origin = event.origin.add([0, 0, 1000]);
	event.addOrigin([0, 0, 0]);
});
game.addEventListener("visibility", (event) => {
	if (event.player.name != "Carol") return;
	for (let i = 0; i < 20; i++) event.addOrigin([i, 0, 0]);
});

server.addEventListener("cmdStart", (event) => {
	if (event.player.name != "Bob") return;
	event.player.print(`${event.forward} ${event.side} ${event.up} ${round(event.angles)} ${event.buttons.join("+")} ${event.msec} ${event.impulse}`, "console");
	// A side speed without its strafe key is taken away.
	if (event.side != 0 && !event.buttons.includes("moveLeft") && !event.buttons.includes("moveRight")) event.side = 0;
	event.forward = -event.forward;
	event.up = 10;
	event.angles = event.angles.add([0, 90, 0]);
	event.buttons = [...event.buttons, "duck"];
	event.msec = event.msec / 2;
	event.impulse = 0;
});
server.addEventListener("cmdStart", async (event) => {
	if (event.player.name != "Carol") return;
	await sleep(10);
	event.player.print(`kept ${event.forward} ${event.angles.y} ${event.buttons.join("+")} ${event.msec}`, "console");
});

server.addCommand("world_view_body", ({ player }) => {
	const weapon = player.activeItem;
	if (weapon == null) return;
	weapon.viewBody = 3;
	const set = `${weapon.viewBody} ${weapon.body}`;
	weapon.viewBody = 0;
	player.print(`${set} ${weapon.viewBody} ${weapon.body}`, "console");
});

server.addCommand("world_drop", ({ player }) => {
	player.print(`${player.dropToFloor()}`, "console");
});

server.addCommand("world_lip", ({ player }) => {
	const door = Entity.find({ classname: "func_door" });
	if (door != null) player.print(`${door.lip}`, "console");
});
