// A fixture for tests/entity-api.test.ts: what an entity does - whether it is
// still in the world, its model and size, a sound from it, its health.

server.addCommand("ent_exists", exists);
server.addCommand("ent_sound", sound);
server.addCommand("ent_box", box);
server.addCommand("ent_health", health);

const precached: number[] = [];

server.addEventListener("precache", () => {
	for (const path of ["myplugin/hit.wav", "models/myplugin/box.mdl", "sprites/myplugin.spr", "myplugin/readme.txt"]) precached.push(server.precache(path).index);
	console.log(`precached ${precached.join(" ")}`);
});

function exists(player: Player, args: string[]) {
	const entity = new Entity(parseInt(args[0]));
	print(player, `${entity.exists}`, "console");
}

function sound(player: Player) {
	player.emitSound("myplugin/hit.wav", { channel: "voice", volume: 0.5 });
}

function box(player: Player) {
	const cube = Entity.create("info_target");
	if (cube == null) return;

	cube.model = "models/myplugin/box.mdl";
	cube.setSize([-16, -8, 0], [16, 8, 40]);
	cube.setSize([0, 0, 50], [1, 1, 40]);
	print(player, `${cube.model} ${cube.modelIndex} ${cube.mins} ${cube.maxs} ${cube.size}`, "console");
}

/** An entity's health is a number, a fraction too; a player's stays whole, and fov his own. */
function health(player: Player) {
	const cube = Entity.create("func_breakable");
	if (cube == null) return;

	cube.health = 50.5;
	player.health = 75;
	player.fov = 110;
	const entity: Entity = player;
	print(player, `${cube.health} ${player.health} ${entity.health} ${player.fov}`, "console");
}
