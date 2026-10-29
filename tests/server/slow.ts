// A listener that holds the frame past amxts_slow_ms is named in the
// console and AMX Mod X's log - the plugin, what it listened to, the time -
// and a plugin slow on every call is said once in a while, not every time.
// Of several listeners of one event, the time is theirs together; the line
// after the first adds the slowest and its own time - by its own name when it
// is given as a function value that takes no event, which the compiler wraps
// in an adapter - and the lines come further apart while it stays slow.
// @log [amxts] slow.aot: a timer held the frame
// @log [amxts] slow.aot: the command amxts_slow_busy held the frame
// @log [amxts] slow.aot: its async functions and promise reactions held the frame
// @log [amxts] slow.aot: the listeners of server_frame held the frame
// @log (amxts_slow_ms 5); the slowest, holdFrame (2 of 3),
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const slowMs = new Cvar("amxts_slow_ms");
let busyRuns = 0;
let holding = false;
let frames = 0;

server.addServerCommand("amxts_test_slow", slow);
server.addServerCommand("amxts_slow_busy", () => busy(30));

// Three listeners of the frame, the second slow while `holding`.
const held: () => void = holdFrame;
server.addEventListener("frame", countFrame);
server.addEventListener("frame", held);
server.addEventListener("frame", () => frames++);

function countFrame() {
	frames++;
}

function holdFrame() {
	if (holding) busy(8);
}

/** Holds the frame for `ms` milliseconds. */
function busy(ms: number) {
	const until = performance.now() + ms;
	while (performance.now() < until) continue;
	busyRuns++;
}

async function wakeBusy() {
	await sleep(10);
	busy(30);
}

function slow() {
	const check = new Checks("slow");
	check.expect(slowMs.number, "amxts_slow_ms is 5 unless the server says otherwise").toBe(5);

	// A timer, then a command, each held 30 ms; the timers after it are held
	// too, and said with the first once its quiet time is over.
	setTimeout(() => busy(30), 100);
	setTimeout(() => {
		server.command("amxts_slow_busy");
		server_exec();
		for (let i = 0; i < 3; i++) setTimeout(() => busy(10), 50 * i);
	}, 400);
	// An async function, held after its await: it runs after the timer that
	// woke it, outside the timer's time, and is said all the same.
	setTimeout(() => wakeBusy(), 600);
	setTimeout(() => {
		check.expect(busyRuns, "every slow call ran").toBe(6);
		// Every frame held for 11 s: said at once, then named 10 s later.
		holding = true;
	}, 1000);
	setTimeout(() => {
		holding = false;
		check.expect(frames > 0, "the frame's listeners ran").toBe(true);
		check.done();
	}, 12000);
}
