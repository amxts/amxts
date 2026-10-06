// The test plugin of tests/closures.test.ts: timers this plugin stops itself
// - another plugin's timer does not stop because of it.

const handle = setTimeout(() => console.log("the clearer's timer fired"), 1000);

export function clear_own() {
	clearTimeout(handle);
}

let fired = 0;

/** A timer that fires at once, so the next one armed takes its slot. */
export function arm_first() {
	fired = setTimeout(() => console.log("the first timer fired"), 0);
}

/** Clears the fired timer's handle after the next timer took its slot. */
export function clear_fired() {
	setTimeout(() => console.log("the slot's next timer fired"), 1000);
	clearTimeout(fired);
}
