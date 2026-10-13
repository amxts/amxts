// The TypeScript side of module-forwards.sma: subscribes to the forwards the
// suites' own C++ module makes and executes through AMX Mod X's functions for
// modules, and tells the Pawn suite what it heard.

const args = new Forward<number, Float, string, number[], number[], number, Float, string>("testmodule_args");
let heardArgs = "";

args.subscribe((id, speed, word, numbers, bytes, count, rate, text) => {
	heardArgs = `${id} ${speed} ${word} ${numbers.join(",")} ${bytes.join(",")} ${count} ${rate} ${text}`;
});

/** What the subscriber of testmodule_args heard, into out[]. */
export function modfw_heard_args() {
	return heardArgs;
}

// testmodule_stop, _stop2 and _continue: each n the subscriber heard, in order.
let heardStops = "";

const stop = new Forward<number>("testmodule_stop");
const stop2 = new Forward<number>("testmodule_stop2");
const always = new Forward<number>("testmodule_continue");

stop.subscribe((n) => {
	heardStops += `stop:${n} `;
});
stop2.subscribe((n) => {
	heardStops += `stop2:${n} `;
});
always.subscribe((n) => {
	heardStops += `continue:${n} `;
});

/** What the subscribers of testmodule_stop, _stop2 and _continue heard, into out[]. */
export function modfw_heard_stops() {
	return heardStops.trim();
}
