// The speed check: what a native, a field, a vector, the HUD's money, a HUD
// message, text, the values a plugin keeps, an event, a forward, a timer, a
// variadic native, a command, a menu's choice, Pawn calling this plugin, whole
// and fractional arithmetic and a real plugin's hot path cost here, against the
// same in Pawn (perf-pawn.sma), measured in one run on one machine. It
// checks ratios, not times, so it holds on any machine; each figure is the
// best of three runs. A limit is changed on purpose, with the measurement
// that moves it.
import { hook, unhook } from "@amxts/core";
import { EngFunc_RunPlayerMove, LibType_Library } from "@amxts/core/constants";
import { engfunc, get_user_name, is_user_alive, LibraryExists, rg_reset_maxspeed, server_exec, strlen } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const TRIES = 3;
const MANY = 1_000_000;
const FEW = 100_000;
const FRAMES = 10_000;
const TIMERS = 300;
// The turns perf-pawn.sma times an impulse listener in, and the moves of each.
const IMPULSE_ROUNDS = 1001;
const IMPULSE_RUN = 200;

/** What Pawn measured, by name: nanoseconds an operation, or milliseconds a whole run. */
const pawn = new Map<string, number>();

/** The same here. */
const ours = new Map<string, number>();

/**
 * TypeScript's time over Pawn's, at most; below 1, Pawn's time that
 * TypeScript has to beat by that much. Each is what a full build measured,
 * with room for a noisy machine and another system.
 */
const LIMITS: Record<string, number> = {
	"native": 2,
	"money read": 1,
	"health read": 2,
	"health write": 1.5,
	"money with its HUD": 2.5,
	"HUD message": 2,
	"HUD message, options in place": 2,
	"origin read": 1.5,
	"origin into a vector": 1.25,
	"string in": 3,
	"string out": 6,
	"player.name": 1,
	"player.steamId": 1,
	"server.map": 0.5,
	"raw hook": 2,
	"event": 2.5,
	"forward to a listener": 2.5,
	"relay with no listener": 1.5,
	"Pawn calls a plugin": 1.5,
	"timer armed": 1.25,
	"timer firing": 1.5,
	"variadic native": 2.5,
	"command": 1.5,
	"menu choice": 2.5,
	"remainder": 2,
	"fractions": 0.5,
	"hot path": 1.5,
};

let sink = 0;
let resets = 0;
let rawResets = 0;
let impulses = 0;
let commands = 0;
let choices = 0;

// The timers armed at once: how many have fired this round, when the first
// did, and the best round's nanoseconds from one to the next.
let fired = 0;
let firstFired = 0;
let firing = Number.POSITIVE_INFINITY;

// Where perf_now counts from: a Float holds a time to the microsecond only
// while it is small, so the clock starts again before Pawn times anything.
let clockStart = 0;

/** The clock perf-pawn.sma times itself with: milliseconds, to the microsecond. */
export function perf_now(): Float {
	return performance.now() - clockStart;
}

/** One of Pawn's results. */
export function perf_report(what: string, value: Float) {
	pawn.set(what, value);
}

/** A result of this side's that only Pawn can time: a forward, a call from Pawn. */
export function perf_ours(what: string, value: Float) {
	ours.set(what, value);
}

/** The native Pawn calls here, against one another Pawn plugin registers. */
export function perf_echo(value: number) {
	return value;
}

/** The best of three runs of `run`, in nanoseconds an operation of `count`. */
function nsEach(count: number, run: () => void) {
	return msBest(run) * 1_000_000 / count;
}

/** The best of three runs of `run`, in milliseconds. */
function msBest(run: () => void) {
	let best = Number.POSITIVE_INFINITY;
	for (let i = 0; i < TRIES; i++) {
		const start = performance.now();
		run();
		best = Math.min(best, performance.now() - start);
	}
	return best;
}

function countPrimes(below: number) {
	let count = 0;
	for (let n = 2; n < below; n++) {
		let prime = true;
		for (let d = 2; d * d <= n; d++) {
			if (n % d == 0) {
				prime = false;
				break;
			}
		}

		if (prime) count++;
	}
	return count;
}

/** The greatest common divisors of every pair of numbers below `below`, by Euclid's remainders, summed. */
function sumDivisors(below: number) {
	let total = 0;
	for (let a = 1; a < below; a++) {
		for (let b = 1; b < below; b++) {
			let x = a;
			let y = b;
			while (y != 0) {
				const rest = x % y;
				x = y;
				y = rest;
			}
			total += x;
		}
	}
	return total;
}

/** Every number below `below` to the power `power`, modulo 10007 a step at a time, summed. */
function sumPowers(below: number, power: number) {
	let total = 0;
	for (let base = 1; base < below; base++) {
		let value = 1;
		for (let i = 0; i < power; i++) value = value * base % 10007;
		total += value;
	}
	return total;
}

function sumDistances(count: number) {
	let total = 0;
	for (let i = 0; i < count; i++) {
		const dx = i * 0.5 - 100;
		const dy = i * 0.25 + 3;
		const dz = 64 - i * 0.125;
		total += Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
	return total;
}

/** What a plugin keeps about a player between frames. */
class Track {
	x = 0;
	y = 0;
	speed = 0;
	top = 0;
	travelled = 0;
}

/**
 * A real plugin's hot path: every frame, for every living player, read where
 * he is and how fast he goes, work out his speed and the distance since the
 * last frame, keep it, and now and then write.
 */
function hotPath(players: Player[]) {
	const tracks = players.map(() => new Track());
	const origin = new Vector();
	const velocity = new Vector();
	let writes = 0;
	for (let frame = 0; frame < FRAMES; frame++) {
		for (let i = 0; i < players.length; i++) {
			const player = players[i];
			if (!player.isAlive) continue;
			const track = tracks[i];
			player.getOrigin(origin);
			player.getVelocity(velocity);
			const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
			const dx = origin.x - track.x;
			const dy = origin.y - track.y;
			track.travelled += Math.sqrt(dx * dx + dy * dy);
			track.x = origin.x;
			track.y = origin.y;
			track.speed = speed;
			if (speed > track.top) track.top = speed;
			if ((frame + player.id) % 2500 == 0) {
				player.health = 100;
				writes++;
			}
		}
	}
	return writes;
}

function onReset() {
	resets++;
}

function onRawReset() {
	rawResets++;
}

function onImpulse() {
	impulses++;
}

function onCommand() {
	commands++;
}

/** A timer that is cleared before it fires. */
function idle() {}

/** One of the timers armed at once: the first and the last of a round read the clock. */
function onTimer() {
	fired++;
	if (fired == 1) firstFired = performance.now();
	if (fired < TIMERS) return;
	firing = Math.min(firing, (performance.now() - firstFired) * 1_000_000 / (TIMERS - 1));
	fired = 0;
}

server.addCommand("amxts_perf_command", onCommand);

/** The menu the bot chooses from: an item that shows it again, as Pawn's handler does. */
const menu = new Menu("Perf");
menu.addItem({
	title: "choose",
	onSelect: ({ player }) => {
		choices++;
		menu.show(player);
	},
});

/**
 * Nanoseconds an impulse listener adds to a move of the bot, timed by
 * perf-pawn.sma as it times its own handler: the same loop of the bot's moves
 * drives both, so the two differ only in who hears the impulse.
 */
function timeImpulseListener(id: number) {
	server.addEventListener("impulse", onImpulse);
	clockStart = performance.now();
	server.command(`amxts_perf_pawn_impulse ${id}`);
	server_exec();
	server.removeEventListener("impulse", onImpulse);
}

/**
 * Nanoseconds a command the bot sends takes to reach a handler: through the
 * engine and every plugin's hook of the game's ClientCommand, as a player's
 * command comes.
 */
function commandNs(bot: Player, command: string) {
	return nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) bot.command(command);
	});
}

/** Nanoseconds a reset of the player's speed - a ResetMaxSpeed hookchain - takes. */
function resetNs(id: number) {
	return nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) rg_reset_maxspeed(id);
	});
}

function measure(player: Player) {
	const id = player.id;
	ours.set("native", nsEach(MANY, () => {
		for (let i = 0; i < MANY; i++) sink += is_user_alive(id);
	}));
	ours.set("money read", nsEach(MANY, () => {
		for (let i = 0; i < MANY; i++) sink += player.money;
	}));
	ours.set("health read", nsEach(MANY, () => {
		for (let i = 0; i < MANY; i++) sink += player.health;
	}));
	ours.set("health write", nsEach(MANY, () => {
		for (let i = 0; i < MANY; i++) player.health = 100;
	}));
	ours.set("money with its HUD", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) player.money = 800;
	}));
	// What perf-pawn.sma's set_hudmessage and show_hudmessage do; a bot is
	// shown nothing on either side. The options made once, as a plugin keeps
	// them, and written in place at each call.
	const red = [255, 40, 40];
	const hud: HudOptions = { color: red, hold: 2 };
	ours.set("HUD message", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) player.showHud("Round 3", hud);
	}));
	ours.set("HUD message, options in place", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) player.showHud("Round 3", { color: red, hold: 2 });
	}));
	ours.set("origin read", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) sink += player.origin.x;
	}));
	const origin = new Vector();
	ours.set("origin into a vector", nsEach(MANY, () => {
		for (let i = 0; i < MANY; i++) sink += player.getOrigin(origin).x;
	}));
	ours.set("string in", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) sink += strlen("hello, world");
	}));
	// The native itself, which player.name is written over.
	ours.set("string out", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) sink += get_user_name(id).length;
	}));
	ours.set("player.name", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) sink += player.name.length;
	}));
	ours.set("player.steamId", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) sink += player.steamId.length;
	}));
	ours.set("server.map", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) sink += server.map.length;
	}));
	// A move of the bot through the native's `...` tail, as perf-pawn.sma makes it.
	const angles = [0.0, 0.0, 0.0];
	ours.set("variadic native", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) engfunc(EngFunc_RunPlayerMove, id, angles, 0, 0, 0, 0, 0, 0);
	}));
	ours.set("timer armed", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) clearTimeout(setTimeout(idle, 1000));
	}));
	ours.set("remainder: primes", msBest(() => {
		sink += countPrimes(200_000);
	}));
	ours.set("remainder: divisors", msBest(() => {
		sink += sumDivisors(700);
	}));
	ours.set("remainder: powers", msBest(() => {
		sink += sumPowers(2000, 2000);
	}));
	ours.set("fractions", msBest(() => {
		sink += sumDistances(MANY);
	}));

	// The bridge alone: a raw hook on the post side, so it is not the
	// facade's own hook of the same chain.
	let before = resetNs(id);
	const raw = hook("reset_max_speed", onRawReset, true);
	ours.set("raw hook", resetNs(id) - before);
	unhook(raw);

	timeImpulseListener(id);

	before = resetNs(id);
	game.addEventListener("resetMaxSpeed", onReset);
	ours.set("event", resetNs(id) - before);
	game.removeEventListener("resetMaxSpeed", onReset);

	const players = server.players;
	let writes = 0;
	ours.set("hot path", msBest(() => {
		writes = hotPath(players);
	}));
	return writes;
}

/** Arms TIMERS timers at once, TRIES times, for onTimer to time their firing. */
async function timeFiring() {
	for (let round = 0; round < TRIES; round++) {
		for (let i = 0; i < TIMERS; i++) setTimeout(onTimer, 100);
		await sleep(400);
	}
	ours.set("timer firing", firing);
}

/**
 * `remainder`: the loop of the three whose ratio is the middle one. A loop of
 * pure arithmetic runs a tenth faster or slower as the code before it moves,
 * on both sides; three loops, each at a place of its own, keep one loop's
 * luck from being the measure.
 */
function medianRemainder(check: Checks) {
	const loops = ["remainder: primes", "remainder: divisors", "remainder: powers"].sort((a, b) => ratioOf(a) - ratioOf(b));
	for (const name of loops) check.expect(ratioOf(name) > 0, said(name)).toBe(true);
	ours.set("remainder", timeOf(loops[1]));
	pawn.set("remainder", pawnTimeOf(loops[1]));
}

// A measure one side did not make fails, not passes as nothing.
function timeOf(what: string) {
	return ours.get(what) ?? Number.POSITIVE_INFINITY;
}

function pawnTimeOf(what: string) {
	return pawn.get(what) ?? 0;
}

function ratioOf(what: string) {
	return timeOf(what) / pawnTimeOf(what);
}

/** A measure's ratio, and both times. */
function said(what: string) {
	const rounded = Math.round(ratioOf(what) * 100) / 100;
	return `${what}: ${rounded} times Pawn's (TypeScript ${Math.round(timeOf(what) * 10) / 10}, Pawn ${Math.round(pawnTimeOf(what) * 10) / 10})`;
}

function compare(check: Checks, writes: number) {
	const heard = FEW * TRIES;
	check.expect(resets, "the listener heard every reset").toBe(heard);
	check.expect(rawResets, "the raw hook heard every reset").toBe(heard);
	check.expect(impulses, "the listener heard every impulse").toBe(IMPULSE_ROUNDS * IMPULSE_RUN);
	check.expect(commands, "the handler got every command").toBe(heard);
	check.expect(pawn.get("commands") ?? -1, "Pawn's handler got every command").toBe(heard);
	check.expect(choices, "the menu got every choice").toBe(heard);
	check.expect(pawn.get("choices") ?? -1, "Pawn's menu got every choice").toBe(heard);
	check.expect(writes, "the hot path wrote as often as Pawn's").toBe(pawn.get("hot path writes") ?? -1);
	medianRemainder(check);
	for (const [what, limit] of Object.entries(LIMITS)) check.expect(ratioOf(what) <= limit, `${said(what)}, at most ${limit}`).toBe(true);
	check.expect(sink != 0, "the loops are counted").toBe(true);
}

server.addServerCommand("amxts_test_perf", async () => {
	const check = new Checks("perf");
	// Pawn's side is written with ReAPI, as a fast Pawn plugin is.
	if (LibraryExists("reapi", LibType_Library) == 0) {
		check.expect(true, "no ReAPI on this server: nothing to measure against").toBe(true);
		check.done();
		return;
	}

	const player = server.players.find(each => each.isBot && each.isAlive);
	check.expect(player != null, "a living bot to measure on").toBe(true);
	if (player == null) {
		check.done();
		return;
	}

	// Pawn measures first, in a frame of its own - before any listener of
	// this plugin's hooks the event it times - and this side right after, while
	// the same players are alive. Then the timers fire, a round at a time.
	clockStart = performance.now();
	server.command(`amxts_perf_pawn ${player.id}`);
	await sleep(200);
	check.expect(pawn.size > 0, "Pawn's results came").toBe(true);
	const writes = measure(player);
	for (let round = 0; round < TRIES; round++) {
		server.command("amxts_perf_pawn_timers");
		await sleep(400);
	}

	await timeFiring();

	// Pawn's handler and this plugin's, each sent the bot's command the same
	// way. Last: the commands leave garbage that a measure after them would pay for.
	pawn.set("command", commandNs(player, "amxts_perf_pawn_command"));
	ours.set("command", commandNs(player, "amxts_perf_command"));
	// A menu's item chosen, the menu shown again: Pawn's, then this plugin's over it.
	server.command(`amxts_perf_pawn_menu ${player.id}`);
	server_exec();
	pawn.set("menu choice", commandNs(player, "menuselect 1"));
	menu.show(player);
	ours.set("menu choice", commandNs(player, "menuselect 1"));
	server.command("amxts_perf_pawn_commands");
	await sleep(100);
	compare(check, writes);
	check.done();
});
