// The test plugin of tests/closures.test.ts: a timer this plugin stops itself
// - another plugin's timer does not stop because of it.

const handle = setTimeout(() => console.log("the clearer's timer fired"), 1000);

export function clear_own() {
	clearTimeout(handle);
}
