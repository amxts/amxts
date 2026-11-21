// The slow-frame lines name what held the frame: a timer by its function, an
// async hold by its reactions' time, a listener walk by its slowest listener.
// The frame walk's first line is the "first observation"; the second names the
// slowest listener.
// @log first observation
// @log timerCallback (a timer) held the frame
// @log the reactions
// @log the slowest, holdFrameListener
import { Checks } from "@amxts/core/check";

const slowMs = new Cvar("amxts_slow_ms");

server.addServerCommand("amxts_test_slow_names", slowNames);

function busy(ms: number) {
	const until = performance.now() + ms;
	while (performance.now() < until) continue;
}

function timerCallback() {
	busy(10);
}

// --- Frame listeners ---
// Ten listeners that do nothing, then one that holds the frame past amxts_slow_ms.
let holdingFrame = false;
const heldFrame: () => void = holdFrameListener;

for (let i = 0; i < 10; i++) server.addEventListener("frame", () => {});
server.addEventListener("frame", heldFrame);

function holdFrameListener() {
	if (holdingFrame) {
		busy(3);
	}
}

function slowNames() {
	const check = new Checks("slow-names");
	slowMs.number = 2;

	// --- Timer: names timerCallback on the first fire ---
	setTimeout(timerCallback, 100);

	// --- Async: a .then reaction that holds the frame ---
	setTimeout(() => {
		const p = new Promise<number>(resolve => resolve(1));
		p.then(() => busy(10));
	}, 400);

	// --- server_frame: 11 listeners, the last holds 3 ms ---
	// First observation, then 10 s later the second line names the slowest.
	setTimeout(() => (holdingFrame = true), 700);
	setTimeout(() => {
		holdingFrame = false;
		slowMs.number = 5;
		check.done();
	}, 12000);
}
