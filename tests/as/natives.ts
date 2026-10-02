// A check on the server: the plugin's own natives with real types, and fs.
//
// Every `export function` of this file is an AMX Mod X native of the same name;
// the build puts `api_natives.inc` beside it for Pawn. The Pawn plugin
// runtime/test/natives_caller.sma calls the natives and writes ok/FAIL to the log itself. Here is fs:
// `say /fs` in chat.
import { Checks } from "@amxts/core/check";
import * as fs from "@amxts/core/fs";

plugin({ name: "api-natives", version: "1.0.0", author: "amxts", description: "Own natives and fs" });

const SETTINGS = "addons/amxmodx/data/amxts-natives.ini";

// The file xn_lookup reads from: written when the plugin loads.
// Cyrillic on purpose: the settings file is UTF-8.
fs.writeFileSync(SETTINGS, "greeting=привет\nround_time=2.5\n");

/** Three strings joined by `|`: strings in, a string in out[] out. */
export function xn_join(a: string, b: string, c: string) {
	return `${a}|${b}|${c}`;
}

/** A string's length in characters: a string of any length in. */
export function xn_length(text: string) {
	return text.length;
}

/** A number from text, or a fallback: a parameter with a default value. */
export function xn_parse_int(text: string, fallback = -1) {
	const value = parseInt(text);
	if (isNaN(value)) return fallback;
	return value;
}

/** A half: Float in and out. */
export function xn_half(value: Float): Float {
	return value / 2;
}

/** An array's sum: an array and its size in. */
export function xn_sum(values: number[]) {
	let total = 0;
	for (let i = 0; i < values.length; i++) total += values[i];
	return total;
}

/** Every value times a factor: a Float array in out[], the count written is the result. */
export function xn_scale(values: Float[], factor: Float): Float[] {
	const scaled: number[] = [];
	for (let i = 0; i < values.length; i++) scaled.push(values[i] * factor);
	return scaled;
}

/** The numbers from 0 to count - 1: an array of integers in out[]. */
export function xn_range(count: number) {
	const list: number[] = [];
	for (let i = 0; i < count; i++) list.push(i);
	return list;
}

/** A vector's length: `Float:v[3]` in. */
export function xn_magnitude(v: Vector): Float {
	return v.magnitude();
}

/** A logical "not": bool in and out. */
export function xn_not(flag: boolean) {
	return !flag;
}

/** The value for a key from the settings file, or false: `string | null` is a bool and text in out[]. */
export function xn_lookup(key: string) {
	const text = fs.readFileSync(SETTINGS);
	if (text == null) return null;

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith(`${key}=`)) return line.substring(key.length + 1);
	}
	return null;
}

/** Writes text to a file - fs from a native. */
export function xn_save(path: string, text: string) {
	return fs.writeFileSync(path, text);
}

/** Whether a file or folder exists. */
export function xn_exists(path: string) {
	return fs.existsSync(path);
}

/** The names in a folder joined by commas, or false if there is no folder. */
export function xn_list(path: string) {
	const names = fs.readdirSync(path);
	if (names == null) return null;
	return names.join(",");
}

/** A player's name: Player in - for Pawn it is an id, not a player - and the native answers "". */
export function xn_player_name(player: Player) {
	return player.name;
}

/** A player's id, or -1 for 0: `Player | null` - 0 is null. */
export function xn_player_or_none(player?: Player) {
	if (player == null) return -1;
	return player.id;
}

/** A greeting: the name is optional - Pawn passes "" without it, and that is "no" too. */
export function xn_greet(name?: string) {
	return name ? `hello, ${name}` : "nobody";
}

/** Two players and a number after them: whether everything arrived in its place. */
export function xn_player_pair(first: Player, second: Player, extra: number) {
	return first.id * 100 + second.id * 10 + extra;
}

/** Reads a whole file - text of any length in out[]. */
export function xn_load(path: string) {
	return fs.readFileSync(path) || "";
}

server.addCommand("/fs", ({ player }) => checkFs(player));

async function checkFs(player: Player) {
	const check = new Checks("api-natives", player);
	const path = "addons/amxmodx/data/amxts-fs-check.txt";

	// Cyrillic on purpose: a long text, over 255 characters and more than one read block.
	let long = "";
	for (let i = 0; i < 200; i++) long += `строка ${i};`;

	check.expect(fs.writeFileSync(path, long), "writeFileSync").toBe(true);
	check.expect(fs.existsSync(path), "existsSync after the write").toBe(true);

	const back = fs.readFileSync(path);
	check.expect(back == null ? -1 : back.length, "readFileSync: the length").toBe(long.length);
	check.expect(back == long, "readFileSync: the same text").toBe(true);

	check.expect(fs.appendFileSync(path, "!end"), "appendFileSync").toBe(true);
	const appended = fs.readFileSync(path);
	check.expect(appended != null && appended.endsWith("!end"), "appendFileSync appended at the end").toBe(true);

	check.expect(fs.readFileSync("addons/amxmodx/data/no-such-file.txt") == null, "readFileSync: no file - null").toBe(true);
	check.expect(fs.existsSync("addons/amxmodx/data/no-such-file.txt"), "existsSync: no file").toBe(false);
	check.expect(fs.existsSync("addons/amxmodx"), "existsSync: a folder").toBe(true);

	const names = fs.readdirSync("addons/amxmodx/data");
	check.expect(names != null && names.includes("amxts-fs-check.txt"), "readdirSync sees the file").toBe(true);
	check.expect(names != null && !names.includes("."), "readdirSync without . and ..").toBe(true);
	check.expect(fs.readdirSync("addons/no-such-folder") == null, "readdirSync: no folder - null").toBe(true);

	await fs.writeFile(path, "from a promise");
	const text = await fs.readFile(path);
	check.expect(text, "writeFile + readFile through await").toBe("from a promise");
	check.expect(await fs.exists(path), "exists through await").toBe(true);

	const missing = await fs.readFile("addons/amxmodx/data/no-such-file.txt").catch(error => `rejected: ${error.message}`);
	check.expect(missing.startsWith("rejected: ENOENT"), "readFile: no file - rejected with ENOENT").toBe(true);

	// Cyrillic on purpose: the settings file is UTF-8.
	check.expect(xn_lookup("greeting"), "the settings file is written on load").toBe("привет");
	check.done();
}
