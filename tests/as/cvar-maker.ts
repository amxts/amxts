// A fixture for tests/cvars.test.ts: makes the cvar tests/as/cvar-early.ts reads.
const knob = new Cvar("late_knob", "5");

export function maker_number() {
	return knob.number;
}
