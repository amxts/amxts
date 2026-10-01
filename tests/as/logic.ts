// The entry the facade's text-logic test compiles (tests/as-logic.test.ts):
// the colour tags of chat and menus, a dictionary line filled from its
// arguments and a number with fixed places, which decide something without
// asking the server.

export { colorTags, menuColors, paint, swapTeam } from "@amxts/core";

/** A key no dictionary has comes back as itself, filled from the arguments: lang.translate without a server. */
export function translateKey(key: string, first: string, second: string, third: string) {
	return lang.translate(null, key, [first, second, third]);
}

/** A number written with a fixed count of places, as JavaScript's toFixed writes it. */
export function fixedText(value: number, places: number) {
	return value.toFixed(places);
}

// The class id of a string, so the test can build one in the module's memory.
// --exportRuntime gives an allocator and nothing that knows what a string is.
export const STRING_ID: i32 = idof<string>();
