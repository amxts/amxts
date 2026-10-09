// A fixture for tests/entity-api.test.ts: what an entity does - whether it is
// still in the world, its model and size, a sound from it, its health.

server.addCommand<EntityArgs>("ent_exists <id>", ({ player, id }) => exists(player, id));
server.addCommand("ent_sound", ({ player }) => sound(player));
server.addCommand("ent_box", ({ player }) => box(player));
server.addCommand("ent_health", ({ player }) => health(player));

const precached: number[] = [];

server.addEventListener("precache", () => {
	for (const path of ["myplugin/hit.wav", "models/myplugin/box.mdl", "sprites/myplugin.spr", "myplugin/readme.txt"]) precached.push(server.precache(path).index);
	console.log(`precached ${precached.join(" ")}`);
});

interface EntityArgs {
	id: number;
}

function exists(player: Player, id: number) {
	const entity = new Entity(id);
	player.print(`${entity.exists}`, "console");
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
	player.print(`${cube.model} ${cube.modelIndex} ${cube.mins} ${cube.maxs} ${cube.size}`, "console");
}

/** An entity's health is a number, a fraction too; a player's stays whole, and fov his own. */
function health(player: Player) {
	const cube = Entity.create("func_breakable");
	if (cube == null) return;

	cube.health = 50.5;
	player.health = 75;
	player.fov = 110;
	const entity: Entity = player;
	player.print(`${cube.health} ${player.health} ${entity.health} ${player.fov}`, "console");
}
