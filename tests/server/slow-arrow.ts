// An arrow function that holds the frame is named by where it starts: the
// name the compiler gives it, or the adapter it is called through, means
// nothing to the author.
// @log [amxts] slow-arrow.aot: the listeners of server_frame held the frame
// @log (amxts_slow_ms 5); the slowest, a function at tests/server/slow-arrow.ts:17 (2 of 2),
import { Checks } from "@amxts/core/check";

let holding = false;
let frames = 0;

server.addServerCommand("amxts_test_slow_arrow", slowArrow);

// Two listeners of the frame, the arrow given as a function value that takes
// no event, as a wrapper gives one.
server.addEventListener("frame", () => frames++);
const holdFrame: () => void = () => {
	if (!holding) return;
	const until = performance.now() + 8;
	while (performance.now() < until) continue;
};
server.addEventListener("frame", holdFrame);

function slowArrow() {
	const check = new Checks("slow-arrow");
	// Every frame held for 11 s: said at once, then named 10 s later.
	holding = true;
	setTimeout(() => {
		holding = false;
		check.expect(frames > 0, "the frame's listeners ran").toBe(true);
		check.done();
	}, 11000);
}
