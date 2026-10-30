// Who walks through whom on a real server: two bots of the suite's own, one
// walking straight at the other. Without a pair the other stops him; with
// one he walks through, and the pair is both ways; dead, the other stops
// nobody; leaving, a player takes his pairs with him. A bot is sent no
// entities, so the state a partner is sent (not solid, the look by
// distance) only shows with a real client; here the look is set and the
// frames run with it.
import { Checks } from "@amxts/core/check";
import { LibType_Library } from "@amxts/core/constants";
import { LibraryExists, resemiclip_take_control } from "@amxts/core/natives";

const WALKER = "amxts semiclip walker";
const STANDING = "amxts semiclip standing";
/** How far ahead of the walker the other one stands. */
const AHEAD = 64;
/** How far ahead the way must be clear: a walk's way and more. */
const CLEAR = 256;

/** The suite's bots: the frame sends each a command, as a client sends, or the game never runs them. */
const bots: Player[] = [];
/** The one of them the frame walks toward `yaw`, while it is set. */
let walking: Player | null = null;
let yaw = 0;

// YaPB's bots play the round, and a spawn point taken kills who is on it:
// nothing may kill these two, and a spawn takes that away again.
server.addEventListener("frame", () => {
	for (const bot of bots) {
		if (bot.isAlive) bot.takeDamage = "no";
		bot.move({ forward: bot.id == walking?.id ? 250 : 0, angles: [0, yaw, 0], msec: 10 });
	}
});

/** The player whose aim the game names on his status line, and the one it names: 0 for nobody. */
let aimer = 0;
let aimedAt = -1;

server.addMessageListener("statusValue", (event) => {
	if (event.player?.id == aimer && event.slot == 2) aimedAt = event.value;
});

server.addServerCommand("amxts_test_semiclip", run);

async function run() {
	const check = new Checks("semiclip");
	const walker = await addBot(WALKER);
	const standing = await addBot(STANDING);
	if (walker == null || standing == null) {
		check.expect(false, "two bots join").toBe(true);
		check.done();
		return;
	}

	// They enter the game a moment later, and a team before that is not theirs.
	await sleep(300);
	walker.joinTeam("CT");
	standing.joinTeam("CT");
	// ReSemiclip beside amxts lets players through by its own config: for the
	// suite it lets nobody through.
	const resemiclip = LibraryExists("resemiclip", LibType_Library) != 0;
	if (resemiclip) resemiclip_take_control(true);
	bots.push(walker);
	bots.push(standing);
	aimer = walker.id;
	// A respawn comes about on the bot's own next commands.
	for (let waited = 0; waited < 3000 && !(walker.isAlive && standing.isAlive); waited += 500) {
		if (!walker.isAlive) walker.respawn();
		if (!standing.isAlive) standing.respawn();
		await sleep(500);
	}
	check.expect(walker.isAlive && standing.isAlive, "both alive").toBe(true);

	// Where the bots happen to spawn decides nothing: the walk starts on the
	// floor at a spawn point with a clear way.
	const way = clearWay(walker);
	check.expect(way != null, "a clear way from a spawn point").toBe(true);
	if (way == null) {
		if (resemiclip) resemiclip_take_control(false);
		check.done();
		return;
	}
	const start = way.start;
	yaw = way.yaw;
	// YaPB's bots spawn at the same points and run about: the walker passes
	// them, and only the world and the other one stand in his way.
	const others = server.players.filter(player => player.id != walker.id && player.id != standing.id);
	for (const other of others) walker.walksThrough.add(other);

	const blocked = await walk(walker, standing, start, true);
	check.expect(blocked < AHEAD, `without a pair the other stops him (${Math.round(blocked)} units)`).toBe(true);

	walker.walksThrough.add(standing);
	check.expect(`${walker.walksThrough.has(standing)} ${standing.walksThrough.has(walker)}`, "a pair is both ways").toBe("true true");
	const through = await walk(walker, standing, start, true);
	check.expect(through > AHEAD + 32, `with the pair he walks through (${Math.round(through)} units)`).toBe(true);

	// The look is set, a part of it at a time, and the frames run with it.
	server.walkThroughLook = { fadeDistance: 200, hideDistance: 40 };
	server.walkThroughLook = { opacity: 0.3 };
	const look = server.walkThroughLook;
	check.expect(`${look.fadeDistance} ${look.opacity} ${look.hideDistance}`, "the look reads as set").toBe("200 0.3 40");
	await walk(walker, standing, start, true);
	server.walkThroughLook = { fadeDistance: 0, hideDistance: 0 };

	// A partner not drawn for him stops none of his lines: the game's own aim,
	// which names the player under his crosshair, goes on through.
	// A new round may have put them elsewhere: they are put back, up to three times.
	const ahead = start.add([Math.cos(yaw * Math.PI / 180) * AHEAD, Math.sin(yaw * Math.PI / 180) * AHEAD, 0]);
	let drawnAim = -1;
	for (let tries = 0; tries < 3 && drawnAim != standing.id; tries++) {
		if (!walker.isAlive) walker.respawn();
		if (!standing.isAlive) standing.respawn();
		await sleep(200);
		walker.origin = start;
		walker.velocity = [0, 0, 0];
		standing.origin = ahead;
		standing.velocity = [0, 0, 0];
		// A bot's move turns his way, not his view: the game aims along the view.
		walker.viewAngle = [0, yaw, 0];
		drawnAim = await aimed(standing.id);
	}
	const line = trace.line(walker.eyes, walker.eyes.add(Vector.fromAngles(walker.viewAngle).scale(2048)), { ignore: walker }).entity?.id ?? -1;
	server.walkThroughLook = { hideDistance: AHEAD * 2 };
	const hiddenAim = await aimed(0);
	server.walkThroughLook = { hideDistance: 0 };
	check.expect(`${drawnAim == standing.id} ${hiddenAim}`, `the name under his crosshair is not of a partner not drawn for him (named ${drawnAim}, then ${hiddenAim}; standing ${standing.id}, his line meets ${line})`).toBe("true 0");

	standing.walksThrough.delete(walker);
	check.expect(walker.walksThrough.has(standing), "deleted from either side, the pair is gone").toBe(false);
	// A dead player passes everyone while a pair is set: the walker's with
	// the others keep it so.
	const pastDead = await walk(walker, standing, start, false);
	check.expect(standing.isAlive, `the other one is dead (${standing.health} health)`).toBe(false);
	check.expect(pastDead > AHEAD + 32, `a dead player stops nobody (${Math.round(pastDead)} units, ${others.length} others)`).toBe(true);

	for (const other of others) walker.walksThrough.delete(other);
	walker.walksThrough.add(standing);
	check.expect(walker.walksThrough.size, "the pair is counted").toBe(1);
	const walked: number[] = [];
	for (const other of walker.walksThrough) walked.push(other.id);
	check.expect(`${walked} ${[...walker.walksThrough].length}`, "his partners are walked as a set's values").toBe(`${standing.id} 1`);
	bots.length = 0;
	server.command(`kick "${STANDING}"`);
	await sleep(100);
	check.expect(walker.walksThrough.size, "a player who left takes his pairs").toBe(0);

	server.command(`kick "${WALKER}"`);
	if (resemiclip) resemiclip_take_control(false);
	check.done();
}

/** Where a walk starts - a standing player's origin on the floor - and toward which yaw. */
class Way {
	constructor(readonly start: Vector, readonly yaw: number) {}
}

/**
 * A spot on the floor, where the walker stands or at a spawn point, with
 * CLEAR units of nothing ahead of a standing player's box along an axis and
 * floor under the spot AHEAD of it; null for none. Along an axis he meets the
 * other's box face on: at a slant he would slide along it and round him.
 * Players are not counted: they move.
 */
function clearWay(walker: Player): Way | null {
	const spots = [walker.origin].concat(
		Entity.findAll({ classname: "info_player_start" }).concat(Entity.findAll({ classname: "info_player_deathmatch" })).map<Vector>(spot => spot.origin),
	);
	for (const spot of spots) {
		const fall = trace.hull(spot.add([0, 0, 16]), spot.subtract([0, 0, 256]), "human", { monsters: false });
		if (fall.startSolid || !fall.hit) continue;
		const start = fall.end;
		for (let turn = 0; turn < 360; turn += 90) {
			const way = new Vector(Math.cos(turn * Math.PI / 180), Math.sin(turn * Math.PI / 180), 0);
			const ahead = start.add(way.scale(AHEAD));
			if (trace.hull(start, start.add(way.scale(CLEAR)), "human", { monsters: false }).hit) continue;
			if (trace.hull(ahead, ahead.subtract([0, 0, 8]), "human", { monsters: false }).hit) return new Way(start, turn);
		}
	}
	return null;
}

/**
 * How far `walker` gets toward `yaw` from `start` in 0.8 seconds, `standing`
 * AHEAD of him, alive or dead. A walk a new round broke - the two respawned
 * elsewhere - is walked again, up to three times.
 */
async function walk(walker: Player, standing: Player, start: Vector, alive: boolean) {
	const ax = Math.cos(yaw * Math.PI / 180);
	const ay = Math.sin(yaw * Math.PI / 180);
	const ahead = new Vector(start.x + ax * AHEAD, start.y + ay * AHEAD, start.z);
	let gone = 0;
	for (let tries = 0; tries < 3; tries++) {
		if (!walker.isAlive) walker.respawn();
		if (standing.isAlive && !alive) standing.kill();
		if (!standing.isAlive && alive) standing.respawn();
		await sleep(200);
		walker.origin = start;
		walker.velocity = [0, 0, 0];
		standing.origin = ahead;
		standing.velocity = [0, 0, 0];
		await sleep(100);
		walking = walker;
		await sleep(800);
		walking = null;
		const at = walker.origin;
		gone = (at.x - start.x) * ax + (at.y - start.y) * ay;
		const aside = Math.abs((at.x - start.x) * ay - (at.y - start.y) * ax);
		if (aside < 48 && standing.origin.distanceTo(ahead) < 8 && standing.isAlive == alive) return gone;
	}
	return gone;
}

/** Who the game names under the walker's crosshair once it names id, or 2 seconds on: it says so every 0.2 s, when it changes. */
async function aimed(id: number) {
	for (let waited = 0; waited < 2000; waited += 100) {
		if (aimedAt == id) break;
		await sleep(100);
	}
	return aimedAt;
}

/** A bot of the suite's: YaPB's quota fills the server and gives a slot up a moment after one is taken. */
async function addBot(name: string) {
	let bot = server.addBot(name);
	for (let waited = 0; bot == null && waited < 3000; waited += 100) {
		await sleep(100);
		bot = server.addBot(name);
	}
	return bot;
}
