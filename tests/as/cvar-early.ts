// A fixture for tests/cvars.test.ts: a cvar with no default, which a plugin
// loaded after this one makes (tests/as/cvar-maker.ts).
const knob = new Cvar("late_knob");

export function late_exists() {
	return knob.exists;
}

export function late_number() {
	return knob.number;
}

export function late_set(value: number) {
	knob.number = value;
}
