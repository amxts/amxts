// The speed check: what a native, a field, a vector, the HUD's money, text,
// an event, a forward, a timer, a command, Pawn calling this plugin, whole
// and fractional arithmetic and a real plugin's hot path cost here, against
// the same in Pawn (perf-pawn.sma), measured in one run on one machine. It
// checks ratios, not times, so it holds on any machine; each figure is the
// best of three runs. A limit is changed on purpose, with the measurement
// that moves it.
import { hook } from "@amxts/core";
import { LibType_Library } from "@amxts/core/constants";
import { DisableHookChain, get_user_name, is_user_alive, LibraryExists, rg_reset_maxspeed, strlen } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const TRIES = 3;
const MANY = 1_000_000;
const FEW = 100_000;
const FRAMES = 10_000;
const TIMERS = 300;

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
	"native": 3.5,
	"money read": 1,
	"health read": 2.5,
	"health write": 2,
	"money with its HUD": 2.5,
	"origin read": 50,
	"origin into a vector": 7,
	"string in": 6,
	"string out": 26,
	"player.name": 4,
	"raw hook": 14,
	"event": 30,
	"forward to a listener": 12,
	"relay with no listener": 6,
	"Pawn calls a plugin": 12,
	"timer armed": 20,
	"timer firing": 16,
	"command": 25,
	"remainder": 2.5,
	"fractions": 0.5,
	"hot path": 5,
};

let sink = 0;
let resets = 0;
let rawResets = 0;
let impulses = 0;
let commands = 0;

// The timers armed at once: how many have fired this round, when the first
// did, and the best round's nanoseconds from one to the next.
let fired = 0;
let firstFired = 0;
let firing = Number.POSITIVE_INFINITY;

/** The clock perf-pawn.sma times itself with: milliseconds, to the microsecond. */
export function perf_now(): Float {
	return performance.now();
}

/** One of Pawn's results. */
export function perf_report(what: string, value: Float) {
	pawn.set(what, value);
}

/** A result of this side's that only Pawn can time: a forward, a command, a call from Pawn. */
export function perf_ours(what: string, value: Float) {
	ours.set(what, value);
}

/** Starts or stops listening to impulses, for perf-pawn.sma to time its forward with and without a listener. */
export function perf_listen(on: boolean) {
	if (on) server.addEventListener("impulse", onImpulse);
	else server.removeEventListener("impulse", onImpulse);
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
	ours.set("timer armed", nsEach(FEW, () => {
		for (let i = 0; i < FEW; i++) clearTimeout(setTimeout(idle, 1000));
	}));
	ours.set("remainder", msBest(() => {
		sink += countPrimes(200_000);
	}));
	ours.set("fractions", msBest(() => {
		sink += sumDistances(MANY);
	}));

	// The bridge alone: a raw hook on the post side, so it is not the
	// facade's own hook of the same chain.
	let before = resetNs(id);
	const raw = hook("reset_max_speed", onRawReset, true);
	ours.set("raw hook", resetNs(id) - before);
	DisableHookChain(raw);

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

function compare(check: Checks, writes: number) {
	const heard = FEW * TRIES;
	check.expect(resets, "the listener heard every reset").toBe(heard);
	check.expect(rawResets, "the raw hook heard every reset").toBe(heard);
	check.expect(impulses, "the listener heard every impulse").toBe(heard);
	check.expect(commands, "the handler got every command").toBe(heard);
	check.expect(pawn.get("commands") ?? -1, "Pawn's handler got every command").toBe(heard);
	check.expect(writes, "the hot path wrote as often as Pawn's").toBe(pawn.get("hot path writes") ?? -1);
	for (const [what, limit] of Object.entries(LIMITS)) {
		// A measure one side did not make fails, not passes as nothing.
		const time = ours.get(what) ?? Number.POSITIVE_INFINITY;
		const pawnTime = pawn.get(what) ?? 0;
		const ratio = time / pawnTime;
		const rounded = Math.round(ratio * 100) / 100;
		const times = `TypeScript ${Math.round(time * 10) / 10}, Pawn ${Math.round(pawnTime * 10) / 10}`;
		check.expect(ratio <= limit, `${what}: ${rounded} times Pawn's (${times}), at most ${limit}`).toBe(true);
	}
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
	server.command(`amxts_perf_pawn ${player.id}`);
	await sleep(200);
	check.expect(pawn.size > 0, "Pawn's results came").toBe(true);
	const writes = measure(player);
	for (let round = 0; round < TRIES; round++) {
		server.command("amxts_perf_pawn_timers");
		await sleep(400);
	}

	await timeFiring();
	compare(check, writes);
	check.done();
});
