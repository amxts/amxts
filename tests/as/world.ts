// A fixture for tests/world.test.ts: traces, a player's aim and sight, and angles.

const round = (v: number[]): string => `${Math.round(v[0] * 100) / 100},${Math.round(v[1] * 100) / 100},${Math.round(v[2] * 100) / 100}`;

server.addCommand("world_angles", ({ player }) => {
	const forward = Vector.fromAngles([0, 90, 0]);
	const down = Vector.fromAngles([45, 0, 0]);
	const back = new Vector(1, 1, -1).toAngles();
	const { right, up } = Vector.directions([0, 0, 0]);
	print(player, `${round(forward)} ${round(down)} ${round(back)} ${round(Vector.fromAngles(back).subtract(new Vector(1, 1, -1).normalize()))} ${round(right)} ${round(up)}`, "console");
});
server.addCommand("world_trace", ({ player }) => {
	const hit = trace.line([0, 0, 0], [200, 0, 0], { ignore: player });
	const clear = trace.hull([0, 0, 0], [0, 0, 50], "human");
	print(player, `${hit.fraction} ${round(hit.end)} ${round(hit.normal)} ${hit.entity?.id} ${hit.hit} ${clear.hit} ${clear.entity == null} ${pointContents([100, 0, 0])} ${pointContents([5, 0, 0])}`, "console");
});
server.addCommand("world_aim", ({ player }) => {
	const aim = player.aim;
	const bob = server.players.find(each => each.name == "Bob")!;
	print(player, `${aim.entity?.id} ${aim.hitGroup} ${round(aim.point)} ${player.canSee(bob)} ${player.canSeePoint([-100, 0, 0])} ${player.canSeePoint([50, 10, 0])}`, "console");
});
server.addCommand("world_view", ({ player }) => {
	const camera = Entity.create("info_target")!;
	player.view = camera;
	const through = player.view;
	player.view = null;
	print(player, `${through != null && through.id == camera.id} ${player.view == null}`, "console");
});
server.addCommand("world_drop", ({ player }) => {
	print(player, `${player.dropToFloor()}`, "console");
});
