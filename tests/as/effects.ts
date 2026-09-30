// A fixture for tests/effects.test.ts: files precached from the top level
// and in the precache event, and temporary effects sent to everyone, near a
// point and to one player.

const shock = server.precache("sprites/shockwave.spr");
const gibs = server.precache("models/glassgibs.mdl");

server.addEventListener("precache", () => {
	const trail = server.precache("sprites/laserbeam.spr");
	console.log(`in the event ${trail.index}`);
});

server.addCommand("fx_indexes", indexes);
server.addCommand("fx_cylinder", cylinder);
server.addCommand("fx_follow", follow);
server.addCommand("fx_explosion", explosion);
server.addCommand("fx_light", light);
server.addCommand("fx_break", breakGlass);
server.addCommand("fx_missing", notPrecached);
server.addCommand("fx_late", late);

function indexes() {
	console.log(`indexes ${shock.index} ${gibs.index} ${shock.path}`);
}

function cylinder(player: Player) {
	const here = player.origin;
	effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
}

function follow(player: Player) {
	effects.beamFollow({ entity: player, sprite: shock, life: 1, width: 5, color: "#09f" }, { to: player });
}

function explosion() {
	effects.explosion({ at: [1, 2, 3], sprite: shock, scale: 30, sound: false, particles: false });
}

function light() {
	effects.dynamicLight({ at: [0, 0, 0], radius: 200, life: 2.5, color: "red" });
}

function breakGlass(player: Player) {
	const box = new Entity(player.id);
	effects.breakModel({ at: box.origin, size: [16, 16, 16], velocity: [0, 0, 50], model: gibs, count: 8, life: 2, material: "glass", smoke: true });
}

function notPrecached() {
	const never = new Resource("sprites/never.spr");
	effects.sprite({ at: [0, 0, 0], sprite: never });
}

function late() {
	server.precache("sprites/late.spr");
	// As a plugin reloaded mid-map asks for it again: the map's index.
	const again = server.precache("sprites/shockwave.spr");
	console.log(`again ${again.index}`);
}
