// Who walks through whom on a real server: two bots of the suite's own, one
// walking straight at the other. Without a pair the other stops him; with
// one he walks through, and the pair is both ways; dead, the other stops
// nobody; leaving, a player takes his pairs with him. A bot is sent no
// entities, so the state a partner is sent (not solid, the look by
// distance) only shows with a real client; here the look is set and the
// frames run with it.
import { Call, floatCell } from "@amxts/core";
import { Checks } from "@amxts/core/check";
import { DMG_GENERIC, Ham_TakeDamage, LibType_Library } from "@amxts/core/constants";
import { LibraryExists, NATIVE_ExecuteHamB, resemiclip_take_control } from "@amxts/core/natives";

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
	// A respawn comes about on the bot's own next commands.
	for (let waited = 0; waited < 3000 && !(walker.isAlive && standing.isAlive); waited += 500) {
		if (!walker.isAlive) walker.respawn();
		if (!standing.isAlive) standing.respawn();
		await sleep(500);
	}
	check.expect(walker.isAlive && standing.isAlive, "both alive").toBe(true);

	// A spawn point may be above the floor: the walk starts where he lands.
	for (let waited = 0; waited < 1000 && !walker.flags.includes("onGround"); waited += 100) await sleep(100);
	const start = walker.origin;
	yaw = clearWay(walker);
	check.expect(yaw >= 0, "a clear way ahead of the walker").toBe(true);
	if (yaw < 0) {
		if (resemiclip) resemiclip_take_control(false);
		check.done();
		return;
	}

	const blocked = await walk(walker, standing, start, true);
	check.expect(blocked < AHEAD, `without a pair the other stops him (${Math.round(blocked)} units)`).toBe(true);

	walker.walksThrough.add(standing);
	check.expect(`${walker.walksThrough.has(standing)} ${standing.walksThrough.has(walker)}`, "a pair is both ways").toBe("true true");
	const through = await walk(walker, standing, start, true);
	check.expect(through > AHEAD + 32, `with the pair he walks through (${Math.round(through)} units)`).toBe(true);

	// The look is set and the frames run with it.
	const look = server.walkThroughLook;
	look.fadeDistance = 200;
	look.opacity = 0.3;
	look.hideDistance = 40;
	check.expect(`${look.fadeDistance} ${look.opacity} ${look.hideDistance}`, "the look reads as set").toBe("200 0.3 40");
	await walk(walker, standing, start, true);
	look.fadeDistance = 0;
	look.hideDistance = 0;

	standing.walksThrough.delete(walker);
	check.expect(walker.walksThrough.has(standing), "deleted from either side, the pair is gone").toBe(false);
	// A dead player passes everyone while a pair is set: one of the walker's
	// with a third player keeps it so.
	const third = server.players.find(player => player.id != walker.id && player.id != standing.id);
	if (third != null) walker.walksThrough.add(third);
	const pastDead = await walk(walker, standing, start, false);
	if (third != null) walker.walksThrough.delete(third);
	check.expect(standing.isAlive, `the other one is dead (${standing.health} health)`).toBe(false);
	check.expect(pastDead > AHEAD + 32, `a dead player stops nobody (${Math.round(pastDead)} units, a third player ${third != null})`).toBe(true);

	walker.walksThrough.add(standing);
	check.expect(walker.walksThrough.size, "the pair is counted").toBe(1);
	bots.length = 0;
	server.command(`kick "${STANDING}"`);
	await sleep(100);
	check.expect(walker.walksThrough.size, "a player who left takes his pairs").toBe(0);

	server.command(`kick "${WALKER}"`);
	if (resemiclip) resemiclip_take_control(false);
	check.done();
}

/**
 * A yaw along an axis the walker has CLEAR units of nothing ahead of, at his
 * eyes and at his knees; -1 for none. Along an axis he meets the other's box
 * face on: at a slant he would slide along it and round him.
 */
function clearWay(walker: Player) {
	for (let turn = 0; turn < 360; turn += 90) {
		const way = new Vector(Math.cos(turn * Math.PI / 180), Math.sin(turn * Math.PI / 180), 0);
		const knees = walker.origin.subtract([0, 0, 20]);
		const high = trace.line(walker.eyes, walker.eyes.add(way.scale(CLEAR)), { ignore: walker });
		const low = trace.line(knees, knees.add(way.scale(CLEAR)), { ignore: walker });
		if (!high.hit && !low.hit) return turn;
	}
	return -1;
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
		if (standing.isAlive && !alive) die(standing);
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

/** A bot of the suite's: YaPB's quota fills the server and gives a slot up a moment after one is taken. */
async function addBot(name: string) {
	let bot = server.addBot(name);
	for (let waited = 0; bot == null && waited < 3000; waited += 100) {
		await sleep(100);
		bot = server.addBot(name);
	}
	return bot;
}

/**
 * The game's death by damage, from the world. Not `kill()`: on plain HLDS
 * the game turns the kill command down for a bot the plugin added.
 */
function die(player: Player) {
	player.takeDamage = "yes";
	new Call(NATIVE_ExecuteHamB).num(Ham_TakeDamage).num(player.id).ref(0).ref(0).ref(floatCell(1000)).ref(DMG_GENERIC).run();
}
