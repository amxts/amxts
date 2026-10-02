/// <reference path="./amxts.d.ts" />
// The plugin-facing API.
//
// Two layers sit under this one: as/natives.ts, which is every native in
// includes/*.inc as Pawn sees it, and the bridge natives that
// runtime/src/module.cpp registers by hand for the places where a string
// crossing as UTF-16 is worth a purpose-built thunk. Both are direct calls —
// an import whose signature wamrc knows costs 2 ns.
//
// The `// @ts-ignore: decorator` lines are AssemblyScript's own idiom, used
// throughout its standard library: an editor reading this as TypeScript would
// otherwise mark every @external as an error, because TypeScript allows
// decorators on classes only. asc is what actually reads them.
//
// What this file adds is shape: a player as an object, a target for a message,
// a handler registered rather than the name of a public passed around. Game
// state is not cached: every read asks the server, because another plugin may
// have changed it in between.
import {
	get_user_armor, get_user_authid, get_user_deaths, get_user_frags, get_user_ip,
	get_maxplayers, is_user_alive, is_user_bot, is_user_connected,
	set_user_armor, set_user_frags,
	get_member, set_member, get_user_msgid, message_begin, message_end, write_byte, write_short,
	rg_give_item, rg_remove_all_items, rg_set_user_bpammo, rg_get_user_bpammo, cs_get_user_bpammo, rg_round_respawn, rg_switch_weapon,
	rg_reset_maxspeed, rg_set_user_team, rg_join_team, rg_find_weapon_bpack_by_name, user_kill, get_user_flags, read_flags,
	get_cvar_num, get_cvar_string, set_cvar_num, set_cvar_string, get_players, get_user_info,
	LibraryExists, module_exists, give_item, strip_user_weapons, user_has_weapon, engclient_cmd,
	cs_get_user_team, cs_set_user_team, cs_get_user_deaths, get_speak, set_speak, cs_set_user_bpammo, cs_set_user_deaths, ExecuteHamB,
	read_argc, read_argv, set_hudmessage, show_hudmessage, create_cvar, get_cvar_pointer,
	get_pcvar_float, get_pcvar_num, get_pcvar_string, set_pcvar_float, set_pcvar_num, set_pcvar_string,
	hook_cvar_change, get_localinfo, register_srvcmd, register_dictionary,
	set_dhudmessage, show_dhudmessage, CreateHudSyncObj, ShowSyncHudMsg, ClearSyncHud,
	precache_model, precache_sound, precache_generic, query_client_cvar, register_touch,
	register_message, get_msg_args, get_msg_argtype, get_msg_arg_int, get_msg_arg_float, get_msg_arg_string,
	set_msg_arg_int, set_msg_arg_float, set_msg_arg_string, get_user_userid,
	emessage_begin, ewrite_byte, ewrite_short, ewrite_string, emessage_end, elog_message
} from "./natives";
// Promise, async/await and AbortSignal, as the globals they are in JavaScript.
import "./promise";
import { Vector } from "./vector";

// @ts-ignore: decorator
@external("env", "print_client") declare function _printClient(id: i32, channel: i32, msg: string): void;
// @ts-ignore: decorator
@external("env", "say_text")     declare function _sayText(id: i32, text: string, swapTo: string): void;
// @ts-ignore: decorator
@external("env", "get_name")     declare function _getName(id: i32, out: i32, max: i32): i32;
// @ts-ignore: decorator
@external("env", "get_health")   declare function _getHealth(id: i32): i32;
// @ts-ignore: decorator
@external("env", "set_health")   declare function _setHealth(id: i32, hp: i32): void;
// @ts-ignore: decorator
@external("env", "clcmd")        declare function _clcmd(pattern: string, fn: i32, flags: i32, info: string, shape: i32): i32;
// @ts-ignore: decorator
@external("env", "task")         declare function _task(secondsBits: i32, fn: i32, id: i32, repeat: i32): i32;
// @ts-ignore: decorator
@external("env", "stop_task")    declare function _stopTask(id: i32): i32;
// @ts-ignore: decorator
@external("env", "outcome")      declare function _outcome(value: i32): void;
// @ts-ignore: decorator
@external("env", "export")       declare function _export(name: string, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "slot")         declare function _slot(fn: i32, shape: i32, key: string, fallback: i32): i32;
// @ts-ignore: decorator
@external("env", "arg")          declare function _arg(index: i32): i32;
// @ts-ignore: decorator
@external("env", "arg_text")     declare function _argText(index: i32, out: i32, max: i32): i32;
// @ts-ignore: decorator
@external("env", "set_arg_text") declare function _setArgText(index: i32, text: string, max: i32): i32;
// @ts-ignore: decorator
@external("env", "set_arg")      declare function _setArg(index: i32, value: i32): i32;
// @ts-ignore: decorator
@external("env", "caller")       declare function _caller(): i32;
// @ts-ignore: decorator
@external("env", "argc")         declare function _argc(): i32;
// @ts-ignore: decorator
@external("env", "plugin")       declare function _plugin(name: string, version: string, author: string, description: string): void;

// call_indirect checks the type on the module's side, so a handler's shape is
// fixed at registration and there are exactly two: this one and WideHandler.
/** A handler that takes a player `id` and returns nothing — what player events and commands call. */
export type Handler = (id: number) => void;

/**
 * A handler that takes up to four numbers and returns nothing: for a forward
 * that passes more than a player `id`, and for a hookchain.
 *
 * A string argument arrives as a number: read it with `argString`. To stop
 * the event, or to block what a hookchain hooks, call `handled()`.
 */
export type WideHandler = (a: number, b: number, c: number, d: number) => void;

const SHAPE_NARROW: i32 = 0;
const SHAPE_WIDE: i32 = 1;

// @ts-ignore: decorator
@external("env", "tag")   declare function _tag(tag: i32): void;
// @ts-ignore: decorator
@external("env", "co_id") declare function _uniqueId(): i32;

// A function handed to the host is called by its table index. A closure is
// its table entry and its variables together, so for a closure the host gets
// the dispatcher of the shape instead, with a tag - the closure's place here
// - which the host passes first (Handler.tag in runtime/src/module.cpp). A
// function declared by name goes as itself, as it always has.
const hostClosures: Object[] = [];

function narrowFired(tag: i32, id: i32): void {
	changetype<Handler>(hostClosures[tag - 1])(<f64>id);
}

function wideFired(tag: i32, a: i32, b: i32, c: i32, d: i32): void {
	changetype<WideHandler>(hostClosures[tag - 1])(<f64>a, <f64>b, <f64>c, <f64>d);
}

/** @hidden For the hood: what the server calls for `handler`. */
export function hostIndex<T>(handler: T, wide: bool): i32 {
	const fn = changetype<usize>(handler);
	if (load<usize>(fn, sizeof<u32>()) == 0) return load<u32>(fn);
	hostClosures.push(changetype<Object>(fn));
	_tag(hostClosures.length);
	return wide ? wideFired.index : narrowFired.index;
}

// Said rather than returned, so that the nine handlers in ten which have
// nothing to say about it end without a line about this bridge.
/**
 * Stops the event: AMX Mod X passes it to no one else, and a hookchain does
 * not call what it hooked. Applies only to the handler that is running.
 *
 *   function onSay(id: number) {
 *     if (muted(id)) handled();
 *   }
 *
 * Pawn: `return PLUGIN_HANDLED`
 */
export function handled(): void {
	_outcome(1);
}

/** @hidden Sets the handler's answer to a number other than `0` or `1`: a game event's status. */
export function __outcome(value: number): void {
	_outcome(<i32>value);
}

// Every argument and return crosses as a 32-bit cell, and a float rides in one
// as its bit pattern. A number here is 64-bit, so the narrowing is done in one
// place rather than at every call.
/**
 * Converts a number to a Pawn `Float:` cell, for a raw native or `ret()`:
 *
 *   ret(floatCell(2.5));
 *   rg_round_end(floatCell(5.0), ...);
 */
export function floatCell(value: f64): number {
	return reinterpret<i32>(<f32>value);
}

// `<i32>x` truncates, which loses a second off every round time that is not exact.
/**
 * Rounds a number to the nearest whole number: a round time of 59.6 seconds
 * is `60`, not `59`.
 *
 * Pawn: `floatround`
 */
export function rounded(value: number): number {
	return <i32>Math.round(value);
}

/** Converts a Pawn `Float:` cell back to a number. */
export function cellFloat(cell: number): f64 {
	return <f64>reinterpret<f32>(cell);
}

/** Sets the value an exported native returns to the plugin that called it. */
export function ret(value: number): void {
	_outcome(value);
}

/**
 * A public name that calls `handler`, for an AMX Mod X native that takes a
 * callback by name: `register_think`, `set_native_filter`.
 *
 * ```ts
 * const pub = publicFor(onThink, "think:myplugin_box");
 * if (pub.length > 0) register_think("myplugin_box", pub);
 * ```
 *
 * An empty name means “already registered”: such a registration cannot be
 * undone and survives a hot reload, so registering again would call the
 * handler twice. `key` identifies the registration across reloads — any name
 * unique within the plugin. `fallback` is the answer when the handler returns
 * nothing: `0` for most natives, `1` where the native expects the event handled.
 *
 * Register from the `"cfg"` event, not at the top of the file: a console
 * command registered that early (`register_concmd`, `register_srvcmd`) crashes
 * the server when typed.
 */
export function publicFor(handler: WideHandler, key: string, fallback: number = 0): string {
	// Must match SLOT_REUSED in runtime/src/module.cpp.
	const REUSED: i32 = 0x10000;

	const slot = _slot(hostIndex(handler, true), SHAPE_WIDE, key, fallback);

	if (slot < 0) {
		console.error(`no callback slot left for "${key}"`);
		return "";
	}

	return (slot & REUSED) ? "" : `__amxts_cb${slot}`;
}

// AMX Mod X implements a native as a public in some plugin, so this names the
// host plugin's one public for them all, and the module keeps the name:
// register_native cannot be undone, so a reload takes the same entry back
// rather than registering the name twice. Natives are asked for before any
// plugin starts, which is why plugins are loaded from plugin_natives at all.
/**
 * Exports a native for other plugins - Pawn ones included - to call.
 *
 *   nativeFn("myplugin_get_mode", getGameMode)
 *
 *   function getGameMode(a: number, b: number, c: number, d: number) {
 *     ret(mode);
 *   }
 *
 * The handler gets the first four arguments as numbers; `arg(i)` and
 * `argText(i)` read any of them, `setArg` and `setArgText` write back.
 * Simpler: an `export function` of the entry file is a native with real
 * types (see the Natives page).
 *
 * Call it at the top level of the file: AMX Mod X asks every plugin for its
 * natives before it starts any of them.
 *
 * Pawn: `register_native`
 */
export function nativeFn(name: string, handler: WideHandler): void {
	if (_export(name, hostIndex(handler, true)) < 0) {
		console.error(`could not export the native "${name}"`);
	}
}

/**
 * A number that a plugin's own native passes to Pawn as `Float:`.
 *
 * To TypeScript it is `number`. Write it only in the signature of an exported
 * native, where Pawn has to know which numbers are fractional; everywhere
 * else a number is `number`.
 *
 * ```ts
 * export function cfg_get_float(file: string, key: string): Float { ... }
 * //   native Float:cfg_get_float(const file[], const key[]);
 * export function set_speed(id: number, speed: Float) { ... }
 * //   native set_speed(id, Float:speed);
 * ```
 */
export type Float = number;

// The hood under `export function` in a plugin's entry file. scripts/plugin-natives.ts
// writes one wrapper per exported function: it reads the Pawn caller's
// arguments with these, calls the function, and hands its result back. A
// plugin never calls them itself.

// @ts-ignore: decorator
@external("env", "arg_string")    declare function _argString(index: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "arg_array")     declare function _argArray(index: i32, out: usize, count: i32): i32;
// @ts-ignore: decorator
@external("env", "set_arg_array") declare function _setArgArray(index: i32, cells: usize, count: i32): i32;

/** @hidden Registers a generated wrapper as the native `name`. */
export function __native(name: string, wrapper: () => void): void {
	if (_export(name, wrapper.index) < 0) console.error(`could not export the native "${name}"`);
}

/** @hidden A cell argument as a number. */
export function __nativeInt(index: i32): f64 {
	return <f64>_arg(index);
}

/**
 * A `Float:` a Pawn plugin passed, as the number it wrote: 0.1, not the
 * 0.10000000149011612 its 32 bits hold. The shortest decimal that is the same
 * float is what the Pawn source said - and what a value written back to a
 * file, a chat line or a config should say.
 */
function pawnFloat(cell: i32): f64 {
	return parseFloat(reinterpret<f32>(cell).toString());
}

/** @hidden A `Float:` argument. */
export function __nativeFloat(index: i32): f64 {
	return pawnFloat(_arg(index));
}

/** @hidden A `bool:` argument. */
export function __nativeBool(index: i32): bool {
	return _arg(index) != 0;
}

/**
 * @hidden A string argument, whole: the module says how long it is first, so
 * there is no buffer to outgrow.
 */
export function __nativeString(index: i32): string {
	const length = _argString(index, 0, 0);
	if (length <= 0) return "";
	const bytes = new ArrayBuffer(length);
	_argString(index, changetype<usize>(bytes), length);
	return String.UTF8.decode(bytes);
}

function nativeCells(index: i32, count: i32): StaticArray<i32> {
	const cells = new StaticArray<i32>(count > 0 ? count : 0);
	if (count > 0) _argArray(index, changetype<usize>(cells), count);
	return cells;
}

/** Cells as numbers: whole ones, or `Float:` ones read as the number they are. */
function numbersOf(cells: StaticArray<i32>, floats: bool): f64[] {
	const values = new Array<f64>(cells.length);
	for (let i = 0; i < cells.length; i++) unchecked(values[i] = floats ? pawnFloat(unchecked(cells[i])) : <f64>unchecked(cells[i]));
	return values;
}

/**
 * Numbers into the caller's `x[], size` at `index`, as many as it has room
 * for: whole ones, or `Float:` ones. Returns how many.
 */
function writeNumbers(values: f64[], index: i32, floats: bool): i32 {
	const count = min(values.length, _arg(index + 1));
	const cells = new StaticArray<i32>(count > 0 ? count : 0);
	for (let i = 0; i < count; i++) unchecked(cells[i] = floats ? reinterpret<i32>(<f32>unchecked(values[i])) : <i32>unchecked(values[i]));
	_setArgArray(index, changetype<usize>(cells), count);
	return count;
}

/** @hidden An array argument whose size is the argument after it. */
export function __nativeInts(index: i32): f64[] {
	return numbersOf(nativeCells(index, _arg(index + 1)), false);
}

/** @hidden A `Float:` array argument whose size is the argument after it. */
export function __nativeFloats(index: i32): f64[] {
	return numbersOf(nativeCells(index, _arg(index + 1)), true);
}

/** @hidden A `Float:v[3]` argument. */
export function __nativeVector(index: i32): Vector {
	const cells = nativeCells(index, 3);
	return new Vector(pawnFloat(cells[0]), pawnFloat(cells[1]), pawnFloat(cells[2]));
}

// @ts-ignore: decorator
@external("env", "arg_length") declare function _argLength(index: i32): i32;

/**
 * @hidden A forward's array argument, as many numbers as it has: what the
 * emitting plugin sent, or the size the include declares; none when neither
 * says. `floats` reads them as `Float:`.
 */
export function __forwardNumbers(index: i32, floats: bool): f64[] {
	return numbersOf(nativeCells(index, _argLength(index)), floats);
}

/**
 * @hidden What the function returned, handed back the way its type says:
 * a string into the caller's `out[], len`, a `string | null` the same and
 * `true` or `false` as the result, an array into `out[], max` with the count
 * as the result, a number or a boolean as the result itself.
 */
export function __nativeReturn<T>(value: T, out: i32): void {
	if (isString<T>()) {
		const max = _arg(out + 1);
		if (isNullable<T>()) {
			if (changetype<usize>(value) == 0) {
				_setArgText(out, "", max);
				_outcome(0);
				return;
			}
			_setArgText(out, changetype<string>(value), max);
			_outcome(1);
			return;
		}
		_outcome(_setArgText(out, changetype<string>(value), max));
		return;
	}
	if (isArray<T>()) {
		// @ts-ignore: valueof is AssemblyScript's
		if (isBoolean<valueof<T>>() || !isFloat<valueof<T>>()) ERROR("an exported native returns number[] or Float[]");
		_outcome(writeNumbers(changetype<f64[]>(value), out, false));
		return;
	}
	if (isBoolean<T>()) {
		_outcome(value ? 1 : 0);
		return;
	}
	if (isFloat<T>() || isInteger<T>()) {
		_outcome(<i32>value);
		return;
	}
	// @ts-ignore: nonnull is AssemblyScript's
	if (isReference<T>() && idof<nonnull<T>>() == idof<CellArray>()) {
		__nativeReturnArray(changetype<CellArray | null>(value));
		return;
	}
	ERROR("an exported native returns string, string | null, number, Float, boolean, number[], Float[], CellArray or an exported enum");
}

/** @hidden A cell argument under one of the plugin's exported enums. */
export function __nativeCell(index: i32): i32 {
	return _arg(index);
}

/**
 * @hidden Whether a `Player` argument is a player slot, 1 to maxPlayers -
 * or 0, for a `Player | null` one. The wrapper calls the function only then.
 */
export function __nativeTarget(index: i32, orNone: bool): bool {
	const id = _arg(index);
	return (orNone && id == 0) || (id >= 1 && id <= get_maxplayers());
}

/** @hidden A `Player` argument: the player in that slot, null for 0. */
export function __nativePlayer(index: i32): Player | null {
	const id = _arg(index);
	return id >= 1 ? new Player(id) : null;
}

/**
 * @hidden Whether a `Team` argument - `TeamName:` in the include - is a
 * TeamName number, 0 to 3. The wrapper calls the function only then.
 */
export function __nativeIsTeam(index: i32): bool {
	const team = _arg(index);
	return team >= 0 && team < TEAM_NAMES.length;
}

/** @hidden A `Team` argument: its TeamName number as the name. */
export function __nativeTeam(index: i32): Team {
	return TEAM_NAMES[_arg(index)];
}

/**
 * @hidden A native not called because a `Player` argument was no player:
 * its result's default - 0, which Pawn reads as false, 0.0 or no array, and
 * "" in the caller's out[] when it passed one (`cells` is how many it passes
 * without).
 */
export function __nativeSkip(out: i32, cells: i32): void {
	if (_argc() > cells) _setArgText(out, "", _arg(out + 1));
	_outcome(0);
}

/**
 * @hidden How far past its own place a parameter after the result buffer
 * is: 2 when the caller passed `out[], len`, 0 when it passed only the
 * parameters' `cells`. See indexes() in scripts/plugin-natives.ts.
 */
export function __nativeShift(cells: i32): i32 {
	return _argc() > cells ? 2 : 0;
}

/** @hidden A CellArray result: its handle, Invalid_Array (0) for null. */
export function __nativeReturnArray(value: CellArray | null): void {
	_outcome(value != null ? value.handle : 0);
}

/** @hidden A `Float:` result. */
export function __nativeReturnFloat(value: f64): void {
	_outcome(reinterpret<i32>(<f32>value));
}

/** @hidden How many cells the Pawn caller passed. */
export function __nativeCount(): i32 {
	return _argc();
}

/** @hidden A number an `any:...` tail passes, which Pawn does by address. */
export function __nativeRef(index: i32): f64 {
	return <f64>nativeCells(index, 1)[0];
}

/**
 * @hidden The result of a native whose include declares no out-argument: a
 * number or a boolean as the cell the native returns.
 */
export function __nativeResult<T>(value: T): void {
	if (isBoolean<T>()) {
		_outcome(value ? 1 : 0);
		return;
	}
	if (isFloat<T>() || isInteger<T>()) {
		_outcome(<i32>value);
		return;
	}
	ERROR("a native whose include declares no out-argument returns a number or a boolean");
}

/**
 * @hidden One field of a native's result, written through the argument the
 * include declares for it: text into `x[], len`, a number through `&x`, an
 * array into `x[], size`.
 */
export function __nativeOut<T>(value: T, index: i32): void {
	if (isString<T>()) {
		_setArgText(index, changetype<string>(value), _arg(index + 1));
		return;
	}
	if (isArray<T>()) {
		writeNumbers(changetype<f64[]>(value), index, false);
		return;
	}
	if (isBoolean<T>()) {
		_setArg(index, value ? 1 : 0);
		return;
	}
	if (isFloat<T>() || isInteger<T>()) {
		_setArg(index, <i32>value);
		return;
	}
	ERROR("a native's out-argument takes a string, a number, a boolean or number[]");
}

/** @hidden The same for a `Float:&x` or `Float:x[], size` out-argument. */
export function __nativeOutFloat<T>(value: T, index: i32): void {
	if (isArray<T>()) {
		writeNumbers(changetype<f64[]>(value), index, true);
		return;
	}
	_setArg(index, reinterpret<i32>(<f32><f64>value));
}

/**
 * @hidden A `const fmt[], any:...` pair, formatted as AMX Mod X's format()
 * would: %s %d %i %u %c %x %f (with width, `-`, `0` and a precision) and %L,
 * which takes a player and a key and formats that player's translation with
 * the arguments after them. The tail is passed by address, as Pawn passes
 * `any:...`: a string is read there, a number through it.
 */
export function __nativeFormat(index: i32): string {
	return formatPawn(__nativeString(index), new FormatCursor(index + 1));
}

// Where format()'s arguments come from: the `any:...` tail of a native's
// call, read by address as Pawn passes it...
class FormatCursor {
	constructor(public next: i32) {}

	has(): bool {
		return true;
	}

	text(): string {
		return __nativeString(this.next++);
	}

	cell(): i32 {
		return <i32>__nativeRef(this.next++);
	}

	float(): f64 {
		return <f64>reinterpret<f32>(this.cell());
	}
}

// ...or a list of texts, as lang.translate takes them: a number is read out
// of its text.
class TextCursor extends FormatCursor {
	constructor(public args: string[]) {
		super(0);
	}

	has(): bool {
		return this.next < this.args.length;
	}

	text(): string {
		const at = this.next++;
		return at < this.args.length ? unchecked(this.args[at]) : "";
	}

	cell(): i32 {
		const value = this.float();
		return isFinite(value) ? <i32>value : 0;
	}

	float(): f64 {
		return parseFloat(this.text());
	}
}

function formatPawn(template: string, cursor: FormatCursor): string {
	let out = "";
	let i = 0;
	const length = template.length;
	while (i < length) {
		const c = template.charCodeAt(i);
		if (c != 0x25 || i + 1 >= length) {
			out += template.charAt(i);
			i++;
			continue;
		}

		let j = i + 1;
		let left = false;
		let zero = false;
		for (; j < length; j++) {
			const flag = template.charCodeAt(j);
			if (flag == 0x2D) left = true;
			else if (flag == 0x30) zero = true;
			else break;
		}
		let width = 0;
		while (j < length && isDigitCode(template.charCodeAt(j))) width = width * 10 + template.charCodeAt(j++) - 0x30;
		let precision = -1;
		if (j < length && template.charCodeAt(j) == 0x2E) {
			precision = 0;
			j++;
			while (j < length && isDigitCode(template.charCodeAt(j))) precision = precision * 10 + template.charCodeAt(j++) - 0x30;
		}
		if (j >= length) {
			out += template.substring(i);
			break;
		}

		const type = template.charAt(j);
		let piece = "";
		let numeric = false;
		// Not a placeholder, or one whose argument the call did not pass: it stays as written.
		const written = !"%sdiucxXfL".includes(type) || (type != "%" && !cursor.has());
		if (written) piece = template.substring(i, j + 1);
		else if (type == "%") piece = "%";
		else if (type == "s") {
			piece = cursor.text();
			if (precision >= 0 && piece.length > precision) piece = piece.substring(0, precision);
		} else if (type == "d" || type == "i" || type == "u") {
			piece = cursor.cell().toString();
			numeric = true;
		} else if (type == "c") piece = String.fromCharCode(cursor.cell());
		else if (type == "x" || type == "X") {
			piece = (<u32>cursor.cell()).toString(16);
			if (type == "X") piece = piece.toUpperCase();
			numeric = true;
		} else if (type == "f") {
			piece = fixedFloat(cursor.float(), precision < 0 ? 6 : precision);
			numeric = true;
		} else if (type == "L") {
			const player = cursor.cell();
			const key = cursor.text();
			const found = lookupLang(key, player > 0 ? player : 0);
			piece = formatPawn(found.length > 0 ? found : `ML_NOTFOUND: ${key}`, cursor);
		}

		while (!written && piece.length < width) piece = left ? piece + " " : zero && numeric ? "0" + piece : " " + piece;
		out += piece;
		i = j + 1;
	}
	return out;
}

// @ts-ignore: decorator
@external("env", "LookupLangKey") declare function _lookupLangKey(out: i32, size: i32, key: i32, id: i32): i32;

/** The longest line a dictionary holds: AMX Mod X reads a value into 512 bytes. */
const LANG_TEXT: i32 = 512;

// One buffer for every lookup: a menu translates each of its lines on every draw.
const langOut = new StaticArray<i32>(LANG_TEXT);
const langId = new StaticArray<i32>(1);

/** The key's line in the player's language (`0`: the server's), as the dictionary loaded it; empty when no dictionary has it. */
function lookupLang(key: string, player: i32): string {
	unchecked(langId[0] = player);
	unchecked(langOut[0] = 0);
	_lookupLangKey(changetype<i32>(langOut), LANG_TEXT - 1, changetype<i32>(__cellsOf(key)), changetype<i32>(langId));
	return __cellText(changetype<usize>(langOut), LANG_TEXT);
}

function isDigitCode(code: i32): bool {
	return code >= 0x30 && code <= 0x39;
}

/** `%.Nf`: the number with exactly `digits` digits after the point, rounded. */
function fixedFloat(value: f64, digits: i32): string {
	const text = value.toFixed(Math.min(digits, 100));
	// A minus the rounding left nothing of is not written: -0.001 is "0.00".
	return text.startsWith("-") && parseFloat(text) == 0 ? text.substring(1) : text;
}

/**
 * @hidden A value as a new AMX Mod X `Array:` - the handle, or
 * Invalid_Array (0) for null. Text is an item a string; a number a Float
 * cell (a TypeScript number is a float); a list of lists an Array of their
 * handles, except rows of numbers, which are items of whole-number cells, as
 * a list-menu row is. The Pawn plugin that gets it destroys it.
 */
export function __nativePawnArray<T>(value: T): i32 {
	if (isNullable<T>() && changetype<usize>(value) == 0) return 0;
	if (!isArray<T>()) ERROR("an Array: result is a list");
	// @ts-ignore: valueof is AssemblyScript's
	if (isString<valueof<T>>()) return CellArray.fromStrings(changetype<string[]>(value)).handle;
	// @ts-ignore: valueof is AssemblyScript's
	if (isFloat<valueof<T>>()) return CellArray.fromFloats(changetype<f64[]>(value)).handle;
	// @ts-ignore: valueof is AssemblyScript's
	if (isString<valueof<valueof<T>>>()) {
		const lists = changetype<string[][]>(value);
		const handles = new Array<i32>(lists.length);
		for (let i = 0; i < lists.length; i++) handles[i] = CellArray.fromStrings(lists[i]).handle;
		return __nativePawnHandles(handles);
	}
	const rows = changetype<f64[][]>(value);
	const array = new CellArray(rows.length > 0 ? rows[0].length : 1);
	for (let i = 0; i < rows.length; i++) array.pushCells(rows[i]);
	return array.handle;
}

/** @hidden An `Array:` of handles, a cell each. */
export function __nativePawnHandles(handles: i32[]): i32 {
	const array = new CellArray(1);
	for (let i = 0; i < handles.length; i++) array.pushCell(handles[i]);
	return array.handle;
}

/** @hidden A `Float:out[], max` result; the count is what the native returns. */
export function __nativeReturnFloats(values: f64[], out: i32): void {
	_outcome(writeNumbers(values, out, true));
}

// @ts-ignore: decorator
@external("env", "ArrayCreate")     declare function _arrayCreate(cellSize: i32, reserved: i32): i32;
// @ts-ignore: decorator
@external("env", "ArrayPushString") declare function _arrayPushString(handle: i32, text: usize): i32;
// @ts-ignore: decorator
@external("env", "ArrayPushCell")   declare function _arrayPushCell(handle: i32, value: i32): i32;
// @ts-ignore: decorator
@external("env", "ArrayPushArray")  declare function _arrayPushArray(handle: i32, cells: usize, size: i32): i32;
// @ts-ignore: decorator
@external("env", "ArraySize")       declare function _arraySize(handle: i32): i32;

/**
 * A dynamic array of AMX Mod X, for returning a list to a Pawn plugin that
 * expects an `Array:` handle.
 *
 * ```ts
 * export function cfg_get_value_array(section: ConfigSection, key: string) {
 *   const words = lookup(section, key);                // string[] | null
 *   return words != null ? CellArray.fromStrings(words) : null;
 * }
 * // native Array:cfg_get_value_array(ConfigSection:section, const key[]);
 * ```
 *
 * The Pawn plugin that gets the array owns it and destroys it; `null` reaches
 * it as `Invalid_Array`. Inside TypeScript a list is a `string[]` or a
 * `number[]`: this class is only for handing one to Pawn.
 *
 * Pawn: `ArrayCreate`, `Array:`
 */
export class CellArray {
	/** The array's handle, the `Array:` Pawn gets. */
	readonly handle: i32;

	/** An empty array whose items are `cellSize` cells each: 1 for a number, the buffer size for text. */
	constructor(cellSize: number = 1) {
		this.handle = _arrayCreate(<i32>cellSize, 32);
	}

	/** A new array of strings, each up to `cellSize - 1` bytes. */
	static fromStrings(values: string[], cellSize: number = 512): CellArray {
		const array = new CellArray(cellSize);
		for (let i = 0; i < values.length; i++) array.pushString(values[i]);
		return array;
	}

	/** A new array of fractional numbers, which Pawn reads as `Float:`. */
	static fromFloats(values: number[]): CellArray {
		const array = new CellArray(1);
		for (let i = 0; i < values.length; i++) array.pushFloat(values[i]);
		return array;
	}

	/** The number of items in the array. */
	get length(): number {
		return _arraySize(this.handle);
	}

	/** Adds a string; it must fit in `cellSize - 1` bytes of UTF-8. */
	pushString(value: string): void {
		_arrayPushString(this.handle, changetype<usize>(__cellsOf(value)));
	}

	/** Adds a whole number, or another array's handle. */
	pushCell(value: number): void {
		_arrayPushCell(this.handle, <i32>value);
	}

	/** Adds a fractional number, which Pawn reads as `Float:`. */
	pushFloat(value: number): void {
		_arrayPushCell(this.handle, reinterpret<i32>(<f32>value));
	}

	/** Adds one item of several numbers: `[a, b]` into an array made with `new CellArray(2)`. */
	pushCells(values: number[]): void {
		pushCellArrayRow(this.handle, values);
	}
}

// A handler takes four cells because the module calls it through one fixed type.
/**
 * Reads an argument of the running handler by position; `0` is its first
 * parameter. Useful past the fourth, which a handler does not get as a
 * parameter.
 *
 *   function onSomething(a: number, b: number, c: number, d: number) {
 *     const fifth = arg(4);
 *   }
 */
export function arg(index: number): number {
	return _arg(index);
}

// A string does not cross as text: what arrives is an address in the memory of
// whoever made the call - the host plugin for a command or a hook, the calling
// plugin for a native this one exported. The module reads it there.
/**
 * Reads an argument of the running callback as a string.
 *
 * A forward's strings need no call: its handler gets them as text already.
 */
export function argText(index: number): string {
	const len = _argText(index, changetype<i32>(textBuf), 512);
	return String.UTF8.decodeUnsafe(changetype<usize>(textBuf), len);
}

/**
 * The number of arguments the running call actually carried.
 *
 * A handler always gets four, padded with zeros, so a native with optional
 * arguments tells a passed zero from a missing one by this:
 *
 *   const flashes = argc() >= 2 ? arg(1) : -1;
 */
export function argc(): number {
	return _argc();
}

/**
 * The `id` of the plugin that called the running exported native, or `-1`.
 *
 * For a native that is about its caller: a cvar registered by a plugin, a
 * chat prefix set for one.
 */
export function caller(): number {
	return _caller();
}

/**
 * Writes a number back through an argument passed by reference (`&value`
 * in Pawn).
 *
 * Pawn: `set_param_byref`
 */
export function setArg(index: number, value: number): void {
	_setArg(index, value);
}

/**
 * Writes text back through a string argument.
 *
 * For a callback that hands over a buffer to fill rather than text to read.
 * `max` is the room the caller gave, usually the argument right after the
 * buffer.
 *
 *   function placeholder(id: number, target: number, out: number, max: number) {
 *     setArgText(2, "ready", max);
 *   }
 */
export function setArgText(index: number, text: string, max: number): void {
	_setArgText(index, text, max);
}

const textBuf = new StaticArray<u8>(512);

/** Reads a string argument that a wide handler got as a number. */
export function argString(pointer: number): string {
	return pointer == 0 ? "" : __cellText(<usize>pointer, 512);
}

/**
 * @hidden A Pawn string at `pointer`: a byte of UTF-8 in each cell, up to the
 * zero cell or `max` cells. AMX Mod X, the engine and the game keep text as
 * bytes - get_amxstring takes the low byte of each cell - so a letter outside
 * ASCII is two or three cells, and a cell per UTF-16 unit came out as
 * mojibake one way and a truncated byte the other ("раз" arrived as "@0").
 */
export function __cellText(pointer: usize, max: i32): string {
	let length = 0;
	while (length < max && load<i32>(pointer + (<usize>length << 2)) != 0) length++;

	const bytes = new Uint8Array(length);
	for (let i = 0; i < length; i++) unchecked(bytes[i] = <u8>load<i32>(pointer + (<usize>i << 2)));
	return String.UTF8.decode(bytes.buffer);
}

/**
 * @hidden Text as a Pawn string, a byte of UTF-8 a cell, into `cells` - at
 * most `cells.length - 1` bytes and never half a letter - and the zero cell.
 * Returns how many bytes went in.
 */
export function __writeCellText(text: string, cells: StaticArray<i32>, at: i32 = 0): i32 {
	const bytes = Uint8Array.wrap(String.UTF8.encode(text));
	let n = min(bytes.length, cells.length - 1 - at);
	if (n < 0) return 0;
	// A continuation byte (10xxxxxx) where the text is cut belongs to a letter
	// that does not fit: leave all of it out.
	if (n < bytes.length) while (n > 0 && (unchecked(bytes[n]) & 0xC0) == 0x80) n--;
	for (let i = 0; i < n; i++) unchecked(cells[at + i] = <i32>unchecked(bytes[i]));
	unchecked(cells[at + n] = 0);
	return n;
}

/** @hidden Text as a Pawn string in a buffer of its own size. */
export function __cellsOf(text: string): StaticArray<i32> {
	const cells = new StaticArray<i32>(String.UTF8.byteLength(text) + 1);
	__writeCellText(text, cells);
	return cells;
}

/** Reads the text a raw native from `~/natives` wrote into a cell array. `stringToCells` is the other way. */
export function cellsToString(cells: StaticArray<i32>): string {
	return __cellText(changetype<usize>(cells), cells.length);
}

/** Writes text into a cell array as a Pawn string, for a raw native. */
export function stringToCells(text: string, cells: StaticArray<i32>): void {
	__writeCellText(text, cells);
}

// The natives in ~/natives take addresses, because that is what Pawn pushes: a
// string has to be in memory this plugin owns before its address means anything.
/**
 * Passes a string to a raw native from `~/natives` without declaring a
 * buffer for it:
 *
 *   cfg_set_base_dir(cells("myplugin"));
 *
 * Up to eight strings in one call; a ninth overwrites the first. Only for
 * arguments going in: a native that writes text back needs `out()`.
 */
export function cells(text: string): number {
	ring = (ring + 1) % 8;
	const buffer = unchecked(rings[ring]);
	stringToCells(text, buffer);
	return changetype<i32>(buffer);
}

const rings: StaticArray<i32>[] = [
	new StaticArray<i32>(256), new StaticArray<i32>(256),
	new StaticArray<i32>(256), new StaticArray<i32>(256),
	new StaticArray<i32>(256), new StaticArray<i32>(256),
	new StaticArray<i32>(256), new StaticArray<i32>(256)
];

let ring: i32 = 0;

// Without it a plugin would declare a StaticArray, changetype it and decode it
// by hand at every call.
/**
 * A buffer for a raw native to write text into; `text()` reads it back.
 *
 *   const name = out();
 *   get_user_name(id, name, TEXT_MAX);
 *   console.log(text(name));
 *
 * Up to four at once. A number a native writes through a `&reference` needs
 * one too; `cell()` reads it back.
 */
export function out(): number {
	slot = (slot + 1) % 4;
	const buffer = unchecked(outs[slot]);
	unchecked(buffer[0] = 0);
	return changetype<i32>(buffer);
}

/** Reads the text a native wrote into an `out()` buffer. */
export function text(buffer: number): string {
	return __cellText(<usize>buffer, TEXT_MAX);
}

// So that a plugin never writes changetype or StaticArray: those are how
// AssemblyScript reaches raw memory, and they belong here.
/**
 * A row of numbers for a native to read from or write into: a vector, a list
 * of players, a line of text. Used like an ordinary array - `buffer[0]`,
 * `buffer.float(2)`, `buffer.text()` - and its `address` is what the native
 * takes.
 *
 *   const origin = new CellBuffer(3);
 *   entity_set_origin(cube, origin.address);
 */
export class CellBuffer {
	private data: StaticArray<i32>;

	constructor(length: number) {
		this.data = new StaticArray<i32>(length);
	}

	/** A buffer of three fractional numbers, for a native that takes a vector: an origin, a size, a colour. */
	static vector(x: f64, y: f64, z: f64): CellBuffer {
		const buffer = new CellBuffer(3);
		buffer.setFloat(0, x);
		buffer.setFloat(1, y);
		buffer.setFloat(2, z);
		return buffer;
	}

	/** The number of cells in the buffer. */
	get length(): number {
		return this.data.length;
	}

	/** The buffer's address, the argument a native that takes an array needs. */
	get address(): number {
		return changetype<i32>(this.data);
	}

	/** The whole number in the cell at `index`: `buffer[0]`. */
	@operator("[]") get(index: number): number {
		return this.data[index];
	}

	/** Puts a whole number in the cell at `index`: `buffer[0] = 5`. */
	@operator("[]=") set(index: number, value: number): void {
		this.data[index] = value;
	}

	/** The fractional number in the cell at `index`, which a native wrote as `Float:`. */
	float(index: number): f64 {
		return cellFloat(this.data[index]);
	}

	/** Puts a fractional number in the cell at `index`, for a native that reads `Float:`. */
	setFloat(index: number, value: f64): void {
		this.data[index] = floatCell(value);
	}

	/** The text a native wrote into the buffer. */
	text(): string {
		return cellsToString(this.data);
	}

	/** Writes text into the buffer from the cell `at`, as a Pawn string. */
	write(at: number, value: string): void {
		__writeCellText(value, this.data, <i32>at);
	}

	/** Sets every cell to `value`: `buffer.fill(0)` clears it. */
	fill(value: number): void {
		this.data.fill(value);
	}
}

// `Array(33).fill(0)` needs a type argument AssemblyScript cannot infer; this
// takes the type from `value`.
/** An array of `length` copies of `value`: `arrayOf(33, 0)`. Every slot is the same `value` - for objects, give each slot its own. */
export function arrayOf<T>(length: number, value: T): T[] {
	return new Array<T>(length).fill(value);
}

/** Reads the number a native wrote through an `out()` buffer passed as a `&reference`. */
export function cell(buffer: number): number {
	return load<i32>(buffer);
}

/** Puts a number in an `out()` buffer, for a reference a native reads as well as writes. */
export function putCell(buffer: number, value: number): number {
	store<i32>(buffer, value);
	return buffer;
}

/**
 * An empty origin for a message sent to one player:
 *
 *   message_begin(MSG_ONE, msgid, noOrigin(), id);
 *
 * Only messages sent to players near a point read the origin.
 */
export function noOrigin(): number[] {
	return [0, 0, 0];
}

/** The length of text an `out()` buffer holds: `255`. */
export const TEXT_MAX: i32 = 255;

const outs: StaticArray<i32>[] = [
	new StaticArray<i32>(TEXT_MAX + 1), new StaticArray<i32>(TEXT_MAX + 1),
	new StaticArray<i32>(TEXT_MAX + 1), new StaticArray<i32>(TEXT_MAX + 1)
];

let slot: i32 = 0;

// Scratch for readText, so a read does not allocate per call.
const scratch = new StaticArray<i32>(256);
const nameBuf = new StaticArray<u8>(64);

/** A Counter-Strike team, by the name the game gives it: one of `"TERRORIST"`, `"CT"`, `"SPECTATOR"`, `"UNASSIGNED"`. */
export type Team = "TERRORIST" | "CT" | "SPECTATOR" | "UNASSIGNED";

const TEAM_NAMES: Team[] = ["UNASSIGNED", "TERRORIST", "CT", "SPECTATOR"];

/** A weapon a player can hold, by its class name, e.g. `"weapon_ak47"` or `"weapon_knife"`. */
export type WeaponName =
	| "weapon_p228" | "weapon_scout" | "weapon_hegrenade" | "weapon_xm1014" | "weapon_c4"
	| "weapon_mac10" | "weapon_aug" | "weapon_smokegrenade" | "weapon_elite" | "weapon_fiveseven"
	| "weapon_ump45" | "weapon_sg550" | "weapon_galil" | "weapon_famas" | "weapon_usp"
	| "weapon_glock18" | "weapon_awp" | "weapon_mp5navy" | "weapon_m249" | "weapon_m3"
	| "weapon_m4a1" | "weapon_tmp" | "weapon_g3sg1" | "weapon_flashbang" | "weapon_deagle"
	| "weapon_sg552" | "weapon_ak47" | "weapon_knife" | "weapon_p90";

// Spelled out rather than `WeaponName | "item_kevlar" | ...`: AssemblyScript
// reads a union of string literals as `string`, but not one that mixes a named
// type in.
/** An item `player.give` hands over: a weapon, armour (`"item_kevlar"`, `"item_assaultsuit"`) or the defuse kit (`"item_thighpack"`). */
export type ItemName =
	| "weapon_p228" | "weapon_scout" | "weapon_hegrenade" | "weapon_xm1014" | "weapon_c4"
	| "weapon_mac10" | "weapon_aug" | "weapon_smokegrenade" | "weapon_elite" | "weapon_fiveseven"
	| "weapon_ump45" | "weapon_sg550" | "weapon_galil" | "weapon_famas" | "weapon_usp"
	| "weapon_glock18" | "weapon_awp" | "weapon_mp5navy" | "weapon_m249" | "weapon_m3"
	| "weapon_m4a1" | "weapon_tmp" | "weapon_g3sg1" | "weapon_flashbang" | "weapon_deagle"
	| "weapon_sg552" | "weapon_ak47" | "weapon_knife" | "weapon_p90"
	| "item_kevlar" | "item_assaultsuit" | "item_thighpack";

const WEAPON_IDS = [
	"", "weapon_p228", "", "weapon_scout", "weapon_hegrenade", "weapon_xm1014", "weapon_c4",
	"weapon_mac10", "weapon_aug", "weapon_smokegrenade", "weapon_elite", "weapon_fiveseven",
	"weapon_ump45", "weapon_sg550", "weapon_galil", "weapon_famas", "weapon_usp",
	"weapon_glock18", "weapon_awp", "weapon_mp5navy", "weapon_m249", "weapon_m3",
	"weapon_m4a1", "weapon_tmp", "weapon_g3sg1", "weapon_flashbang", "weapon_deagle",
	"weapon_sg552", "weapon_ak47", "weapon_knife", "weapon_p90"
];

/** @hidden Every weapon's class name: what Ham Sandwich hooks a weapon's event on for "every weapon". */
export function __weaponClassnames(): string[] {
	return WEAPON_IDS.filter((name) => name.length > 0);
}

/** An AMX Mod X module a plugin can check for, one of `"reapi"`, `"cstrike"`, `"fun"`, `"hamsandwich"`, `"engine"`, `"fakemeta"`. */
export type ModuleName = "reapi" | "cstrike" | "fun" | "hamsandwich" | "engine" | "fakemeta";

// Asked once each: a module is either loaded for the whole map or not at all.
const moduleNames: string[] = [];
const moduleLoaded: boolean[] = [];

/**
 * `true` when the server has the module: `if (hasModule("reapi")) ...`.
 * Check it before a native that only one module has.
 *
 * Pawn: `LibraryExists`, `module_exists`
 */
export function hasModule(name: ModuleName): boolean {
	const at = moduleNames.indexOf(name);
	if (at >= 0) return moduleLoaded[at];

	const loaded = LibraryExists(name, LibType_Library) != 0 || module_exists(name) != 0;
	moduleNames.push(name);
	moduleLoaded.push(loaded);
	return loaded;
}

// The backend the hood picks for a game event, an action or a field of
// ReGameDLL's own, asked once rather than on every call: 1 reapi, 0 the
// stock modules, -1 not asked yet.
let reapiHere: i32 = -1;

/** @hidden Whether the server has reapi: the hood's choice of backend, made once. */
export function __hasReapi(): bool {
	if (reapiHere < 0) reapiHere = hasModule("reapi") ? 1 : 0;
	return reapiHere == 1;
}

const saidOnce = new Set<string>();

/**
 * @hidden A line in the console the first time it is said: what this server
 * cannot do, where a plugin asks for it - not on every call, which a field
 * read in a frame listener makes every frame.
 */
export function __sayOnce(text: string): void {
	if (saidOnce.has(text)) return;
	saidOnce.add(text);
	console.warn(text);
}

/** Tells everyone's scoreboard a player's frags and deaths - what cs_set_user_deaths sends. */
function sendScoreInfo(id: number, frags: number, deaths: number, team: number) {
	message_begin(MSG_ALL, get_user_msgid("ScoreInfo"), [0, 0, 0], 0);
	write_byte(id);
	write_short(frags);
	write_short(deaths);
	write_short(0);
	write_short(team);
	message_end();
}

/** The options of `player.kill()`. */
export interface KillOptions {
	/** Keeps the player's frags: no penalty for the suicide. */
	keepFrags?: boolean;
}

// Plugins add fields of their own to this class, shared by every plugin and by
// Pawn, with `interface Player { spawnProtected: boolean }` in a
// `declare module "~/facade"` block (docs/en/3.game/02.players.md) - not written
// here as one block, which the build would take for a declaration of every
// plugin's. The build turns each into a getter and a setter over the module's
// store and adds them here (scripts/player-fields.ts).
/**
 * A connecting player, in `"connect"`, `"authorized"` and `"putinserver"`: name,
 * address, SteamID and team, but no health or weapons yet. Every Player is a
 * Client too.
 *
 * ```ts
 * server.addEventListener("putinserver", (event) => {
 * 	print(event.player, `Welcome, ${event.player.name}!`);
 * });
 * ```
 */
export interface Client {
	/** The player's slot, `1` to `32`. */
	readonly id: number;
	/** The player's name. */
	readonly name: string;
	/** The player's IP address without the port, e.g. `"192.168.0.10"`. */
	readonly ip: string;
	/** The player's SteamID, e.g. `"STEAM_0:1:12345"`. A bot has `"BOT"`, HLTV has `"HLTV"`; until Steam confirms the player it is `"STEAM_ID_PENDING"` (wait for the `"authorized"` event), and on a LAN server `"STEAM_ID_LAN"`. */
	readonly authid: string;
	/** `true` for a bot. */
	readonly isBot: boolean;
	/** `true` while the player is on the server. */
	readonly isConnected: boolean;
	/** The player's admin rights, from the letters in `users.ini`: `client.access.includes("Cvar")`. */
	readonly access: Access[];
	/** The player's team, one of `"TERRORIST"`, `"CT"`, `"SPECTATOR"` or `"UNASSIGNED"` (until the player joins a team). Setting it moves the player, as `player.team` does. */
	team: Team;
	/** `true` when nobody hears the player on the voice chat. Setting it mutes or unmutes him. */
	muted: boolean;
	/** `true` when every player hears him on the voice chat, whatever the side. */
	heardByEveryone: boolean;
	/** `true` when he hears every player on the voice chat, whatever the side. */
	hearsEveryone: boolean;
	/** The language the player reads the server's text in, e.g. `"en"`, `"ru"`: the one `lang.translate` picks for him. */
	readonly language: string;
	/** A signal that aborts when the player leaves the server: `fetch(url, { signal: client.signal })`. */
	readonly signal: AbortSignal;
	/** Runs a command in the player's console, as if he had typed it: `client.command("stop")`. */
	command(text: string): void;
	/** Kicks the player off the server, with the reason he is shown: `client.kick("Spam")`. */
	kick(reason?: string): void;
	/** Joins a side as the game joins a player who picks it in the team menu: `client.joinTeam("CT")`. `false` if the game refused. */
	joinTeam(team: Team): boolean;
	/** Asks the player's game for one of its cvars: `await client.queryCvar("fps_max")`, the value as text, or `null` when his game has none. */
	queryCvar(name: string): Promise<string | null>;
}

/**
 * A player in the game: everything a Client has, plus health, armor, frags,
 * weapons and the screen.
 *
 * An event about a player gives one as `event.player`; `server.players`
 * lists everyone on the server.
 */
export class Player extends PlayerFields implements Client {
	constructor(id: number) {
		super(id);
	}

	/**
	 * The player's name.
	 *
	 * Pawn: `get_user_name`
	 */
	get name(): string {
		const len = _getName(this.id, changetype<i32>(nameBuf), 64);
		return String.UTF8.decodeUnsafe(changetype<usize>(nameBuf), len);
	}

	/**
	 * The player's health. `100` at spawn. Setting it to `0` or less kills the player.
	 *
	 * Pawn: `get_user_health`, `set_user_health`
	 */
	get health(): number { return _getHealth(this.id); }
	set health(hp: number) { _setHealth(this.id, hp); }

	/**
	 * The player's armor points: `100` with a bought vest, `0` without one.
	 *
	 * Pawn: `get_user_armor`, `set_user_armor`
	 */
	get armor(): number { return get_user_armor(this.id); }
	set armor(value: number) { set_user_armor(this.id, value); }

	/**
	 * The player's frags on the scoreboard.
	 *
	 * Pawn: `get_user_frags`, `set_user_frags`
	 */
	get frags(): number { return get_user_frags(this.id); }
	set frags(value: number) { set_user_frags(this.id, value); }

	/**
	 * The player's deaths on the scoreboard. Setting it updates the scoreboard
	 * at once.
	 *
	 * Pawn: `cs_get_user_deaths`, `cs_set_user_deaths`
	 */
	get deaths(): number {
		return __hasReapi() ? get_member(this.id, m_iDeaths) : cs_get_user_deaths(this.id);
	}

	/** The deaths on the scoreboard; setting them tells the scoreboard too. */
	set deaths(value: number) {
		if (__hasReapi()) {
			set_member(this.id, m_iDeaths, value);
			sendScoreInfo(this.id, this.frags, value, get_member(this.id, m_iTeam));
			return;
		}
		cs_set_user_deaths(this.id, value);
	}

	/**
	 * The player's team, one of `"TERRORIST"`, `"CT"`, `"SPECTATOR"` or `"UNASSIGNED"`. Correct
	 * right after a team change too. Setting it moves the player.
	 *
	 * Pawn: `cs_get_user_team`, `rg_set_user_team`
	 */
	get team(): Team {
		const index = __hasReapi() ? get_member(this.id, m_iTeam) : cs_get_user_team(this.id);
		return index >= 0 && index < TEAM_NAMES.length ? TEAM_NAMES[index] : "UNASSIGNED";
	}

	/**
	 * Moves the player to another team, as reapi's rg_set_user_team does: the
	 * model is picked for the new team, the scoreboard is told, and the round's
	 * win conditions are not checked - the caller decides when that happens.
	 */
	set team(value: Team) {
		const index = teamCell(value);
		if (__hasReapi()) {
			rg_set_user_team(this.id, index, MODEL_AUTO, true, false);
			return;
		}
		// cstrike keeps the model unless told: the first one of the new side.
		const model = value == "TERRORIST" ? CS_T_TERROR : value == "CT" ? CS_CT_URBAN : CS_DONTCHANGE;
		cs_set_user_team(this.id, index, model);
	}

	/**
	 * Joins a side the way the game joins a player who picks it in the team
	 * menu, appearance picked for him: `player.joinTeam("CT")`. A player who
	 * has just arrived is in the game after it and can spawn, which
	 * `player.team = ...` does not do for him. `false` if the game refused.
	 *
	 * Pawn: `rg_join_team`
	 */
	joinTeam(team: Team): boolean {
		if (team == "UNASSIGNED") return false;
		if (__hasReapi()) return rg_join_team(this.id, teamCell(team)) != 0;

		// Without reapi, what the player would type: the team menu's slot, then
		// the appearance menu's automatic pick.
		engclient_cmd(this.id, "jointeam", team == "TERRORIST" ? "1" : team == "CT" ? "2" : "6");
		if (team != "SPECTATOR") engclient_cmd(this.id, "joinclass", "5");
		return this.team == team;
	}

	/**
	 * The player's IP address without the port, e.g. `"192.168.0.10"`.
	 *
	 * Pawn: `get_user_ip`
	 */
	get ip(): string {
		// The fourth argument drops the port, which is what a plugin means by
		// an address nine times out of ten.
		return get_user_ip(this.id, 1);
	}

	/**
	 * The player's SteamID, e.g. `"STEAM_0:1:12345"`. A bot has `"BOT"`, HLTV has `"HLTV"`; until Steam confirms the player it is `"STEAM_ID_PENDING"` (wait for the `"authorized"` event), and on a LAN server `"STEAM_ID_LAN"`.
	 *
	 * Pawn: `get_user_authid`
	 */
	get authid(): string {
		return get_user_authid(this.id);
	}

	/**
	 * `true` while the player is alive.
	 *
	 * Pawn: `is_user_alive`
	 */
	get isAlive(): boolean { return is_user_alive(this.id) != 0; }
	/**
	 * `true` while the player is on the server.
	 *
	 * Pawn: `is_user_connected`
	 */
	get isConnected(): boolean { return is_user_connected(this.id) != 0; }
	/**
	 * `true` for a bot.
	 *
	 * Pawn: `is_user_bot`
	 */
	get isBot(): boolean { return is_user_bot(this.id) != 0; }

	/**
	 * A signal that aborts when the player leaves the server, with an Error named
	 * `"AbortError"`; the next player in the slot gets a new one.
	 *
	 * ```ts
	 * const response = await fetch(url, { signal: player.signal });
	 * ```
	 *
	 * An async command handler or player event already runs under it: its
	 * `await`s stop quietly when the player leaves.
	 */
	get signal(): AbortSignal { return __co_player_signal(this.id); }

	/**
	 * `true` when nobody hears the player on the voice chat, with alltalk or
	 * without. Setting it mutes or unmutes him; his other voice settings stay.
	 *
	 * Pawn: `set_speak`, `SPEAK_MUTED`
	 */
	get muted(): boolean { return (get_speak(this.id) & SPEAK_MUTED) != 0; }
	set muted(value: boolean) { this.setSpeak(SPEAK_MUTED, value); }

	/**
	 * `true` when every player hears him on the voice chat, whatever the side
	 * and without alltalk. A mute (`muted`) still silences him.
	 *
	 * Pawn: `set_speak`, `SPEAK_ALL`
	 */
	get heardByEveryone(): boolean { return (get_speak(this.id) & SPEAK_ALL) != 0; }
	set heardByEveryone(value: boolean) { this.setSpeak(SPEAK_ALL, value); }

	/**
	 * `true` when he hears every player on the voice chat, whatever the side
	 * and without alltalk: a spectator who hears both sides.
	 *
	 * Pawn: `set_speak`, `SPEAK_LISTENALL`
	 */
	get hearsEveryone(): boolean { return (get_speak(this.id) & SPEAK_LISTENALL) != 0; }
	set hearsEveryone(value: boolean) { this.setSpeak(SPEAK_LISTENALL, value); }

	// One voice setting of set_speak's, the others kept.
	private setSpeak(flag: i32, on: bool): void {
		const flags = get_speak(this.id);
		set_speak(this.id, on ? flags | flag : flags & ~flag);
	}

	/**
	 * The language the player reads the server's text in, e.g. `"en"`, `"ru"`:
	 * the one `lang.translate` picks for him. It is his `setinfo lang`, or the
	 * server's language when he has none or `amx_client_languages` is `0`.
	 *
	 * Pawn: `get_user_info(id, "lang")`, `amx_language`
	 */
	get language(): string {
		// AMX Mod X's own rule (playerlang, translate): a language starts with a letter.
		const own = get_cvar_num("amx_client_languages") != 0 ? get_user_info(this.id, "lang") : "";
		const first = own.length > 0 ? own.charCodeAt(0) | 0x20 : 0;
		return first >= 0x61 && first <= 0x7a ? own : get_cvar_string("amx_language");
	}

	/**
	 * Shows a line of text on the player's screen:
	 * `player.showHud("-35 HP", { color: [255, 40, 40], x: 0.02, y: 0.88, hold: 2 })`.
	 * Every option has a default.
	 *
	 * Pawn: `set_hudmessage`, `show_hudmessage`
	 */
	showHud(text: string, options: HudOptions = {}): void {
		showHudTo(this.id, text, options);
	}

	/**
	 * Plays a sound to the player alone, the way the radio does - heard as it
	 * is wherever he stands: `player.playSound("vox/one.wav")`. The path is
	 * under `sound/`, as `server.precache` takes it.
	 *
	 * Pawn: `SendAudio`, `rg_send_audio`
	 */
	playSound(sample: string): void {
		message_begin(MSG_ONE, get_user_msgid("SendAudio"), [0, 0, 0], this.id);
		write_byte(this.id);
		write_string(sample);
		write_short(100);
		message_end();
	}

	/** The player's screen effects: `player.screen.fade({ ... })`, `.shake(...)`, `.statusIcon(...)` — see Screen. */
	get screen(): Screen { return new Screen(this.id); }

	// ------------------------------------------------------------ actions
	//
	// reapi where the server has it, the stock AMX Mod X modules where it does
	// not: fun, cstrike, hamsandwich and the core.

	/**
	 * Gives the player a weapon or an item: `player.give("weapon_flashbang")`.
	 * `false` if the game did not give it.
	 *
	 * Pawn: `rg_give_item`, `give_item`
	 */
	give(item: ItemName): boolean {
		if (__hasReapi()) return rg_give_item(this.id, item) > 0;
		return give_item(this.id, item) > 0;
	}

	/**
	 * Takes all the player's weapons away. The suit (armour, HUD) stays unless
	 * `removeSuit` is `true`.
	 *
	 * Pawn: `rg_remove_all_items`, `strip_user_weapons`
	 */
	removeAllItems(removeSuit: boolean = false): void {
		if (__hasReapi()) {
			rg_remove_all_items(this.id, removeSuit);
			return;
		}
		strip_user_weapons(this.id);
	}

	/**
	 * Sets the player's reserve ammo for a weapon he carries: `player.setAmmo("weapon_flashbang", 2)`.
	 *
	 * Pawn: `rg_set_user_bpammo`, `cs_set_user_bpammo`
	 */
	setAmmo(weapon: WeaponName, amount: number): void {
		const id = WEAPON_IDS.indexOf(weapon);
		if (id <= 0) return;
		if (__hasReapi()) rg_set_user_bpammo(this.id, id, amount);
		else cs_set_user_bpammo(this.id, id, amount);
	}

	/**
	 * The player's reserve ammo for a weapon he carries: `player.getAmmo("weapon_ak47")`;
	 * for a grenade, how many he has. `0` for a weapon he does not carry.
	 *
	 * Pawn: `rg_get_user_bpammo`, `cs_get_user_bpammo`
	 */
	getAmmo(weapon: WeaponName): number {
		const id = WEAPON_IDS.indexOf(weapon);
		if (id <= 0) return 0;
		return __hasReapi() ? rg_get_user_bpammo(this.id, id) : cs_get_user_bpammo(this.id, id);
	}

	/**
	 * Respawns the player in the current round, at a spawn point the game picks.
	 *
	 * Pawn: `rg_round_respawn`
	 */
	respawn(): void {
		if (__hasReapi()) rg_round_respawn(this.id);
		else ExecuteHamB(Ham_CS_RoundRespawn, this.id);
	}

	/**
	 * Kills the player, as the `kill` console command does. With
	 * `{ keepFrags: true }` the death costs no frags.
	 *
	 * Pawn: `user_kill`, `user_silentkill`
	 */
	kill(options: KillOptions = {}): void {
		user_kill(this.id, options.keepFrags ? 1 : 0);
	}

	/**
	 * The player's admin rights, from the letters in `users.ini`:
	 * `player.access.includes("Cvar")`.
	 *
	 * Pawn: `get_user_flags`
	 */
	get access(): Access[] {
		return <Access[]>ACCESS.namesOf(get_user_flags(this.id));
	}

	/**
	 * Puts a weapon the player carries into his hands. `false` if he does not
	 * have it.
	 *
	 * Pawn: `rg_switch_weapon`
	 */
	switchWeapon(weapon: WeaponName): boolean {
		if (__hasReapi()) {
			const entity = rg_find_weapon_bpack_by_name(this.id, weapon);
			return entity > 0 && rg_switch_weapon(this.id, entity) != 0;
		}

		const id = WEAPON_IDS.indexOf(weapon);
		if (id <= 0 || user_has_weapon(this.id, id) == 0) return false;
		engclient_cmd(this.id, weapon);
		return true;
	}

	/**
	 * Recomputes the player's speed from the weapon in hand, after a slowdown for
	 * instance.
	 *
	 * Pawn: `rg_reset_maxspeed`
	 */
	resetMaxSpeed(): void {
		if (__hasReapi()) rg_reset_maxspeed(this.id);
		else ExecuteHamB(Ham_CS_Player_ResetMaxSpeed, this.id);
	}

	/**
	 * Runs a command in the player's own console, as if he had typed it:
	 * `player.command("messagemode say_team")`, `player.command("stop")`.
	 * The player's game runs it, not the server.
	 *
	 * Pawn: `client_cmd`
	 */
	command(text: string): void {
		new Call(NATIVE_client_cmd).num(this.id).str("%s").str(text).run();
	}

	/**
	 * Kicks the player off the server, with the reason he is shown:
	 * `player.kick("Spam")`; without one, the game's own.
	 *
	 * Pawn: `server_cmd("kick #%d")`
	 */
	kick(reason: string = ""): void {
		const said = reason.replaceAll("\"", "'");
		server.command(said.length > 0 ? `kick #${get_user_userid(this.id)} "${said}"` : `kick #${get_user_userid(this.id)}`);
	}

	/**
	 * Asks the player's game for one of its cvars: `await
	 * player.queryCvar("fps_max")` is the value as text, e.g. `"100"`, or
	 * `null` when his game has no such cvar or will not tell. The answer is
	 * what his game says, a claim a cheat can change. A bot has no game to ask
	 * and answers `null` at once; when the player leaves before he answers, the
	 * promise is rejected with an `"AbortError"`.
	 *
	 * Pawn: `query_client_cvar`
	 */
	queryCvar(name: string): Promise<string | null> {
		const promise = __co_promise<string | null>();

		if (this.isBot || !this.isConnected) {
			__co_resolve<string | null>(promise, null);
			return promise;
		}

		if (cvarAnswer.length == 0) cvarAnswer = callbackName(cvarAnswered, "querycvar");
		const query = new CvarQuery(this.id, name.toLowerCase(), promise);
		query.guard = new __AbortGuard(query, this.signal);
		cvarQueries.push(query);
		query_client_cvar(this.id, name, cvarAnswer);
		return promise;
	}
}

// ---------------------------------------------------------------- a client's cvars

// The questions sent and not answered yet, in the order asked. The engine
// hands every answer to one public, with the player and the cvar's name.
class CvarQuery extends __AbortWatch {
	guard: __AbortGuard | null = null;

	constructor(public player: i32, public name: string, public promise: Promise<string | null>) {
		super();
	}

	/** The player left, or what awaits the answer gave up. */
	run(reason: Error): void {
		forgetQuery(this);
		this.promise.__reject(reason);
	}
}

const cvarQueries: CvarQuery[] = [];
let cvarAnswer = "";

function forgetQuery(query: CvarQuery): void {
	const at = cvarQueries.indexOf(query);
	if (at >= 0) cvarQueries.splice(at, 1);
	(query.guard as __AbortGuard).release();
}

/** public cvar_answer(id, const cvar[], const value[], const param[]) */
function cvarAnswered(id: number, cvar: number, value: number, param: number): void {
	const name = argText(1).toLowerCase();

	for (let i = 0; i < cvarQueries.length; i++) {
		const query = cvarQueries[i];
		if (query.player != <i32>id || query.name != name) continue;

		forgetQuery(query);
		// What the engine answers for a cvar the client has not, or will not tell.
		const text = argText(2);
		const unknown = text == "Bad CVAR request" || text == "CVAR is privileged";
		__co_resolve<string | null>(query.promise, unknown ? null : text);
		return;
	}
}

/**
 * The public name that calls `handler`, whether the slot is new or taken back
 * after a reload: for a native handed a callback on every call
 * (query_client_cvar), not a registration made once (see publicFor).
 */
function callbackName(handler: WideHandler, key: string): string {
	const slot = _slot(hostIndex(handler, true), SHAPE_WIDE, key, 0);
	return slot < 0 ? "" : `__amxts_cb${slot & 0xffff}`;
}

// A Pawn string is one character per cell, so calling such a native directly
// means a StaticArray<i32>, its address, and decoding it afterwards.
/**
 * Calls a native that fills a text buffer and returns the text. The native
 * itself is passed in:
 *
 *   readText(get_mapname)                 // "c21_kitty"
 *   readText(get_user_name, 32, id)       // not this one: see Player.name
 */
export function readText(fill: (out: number, max: number) => number, max: number = 255): string {
	fill(changetype<i32>(scratch), min(max, 255));
	return cellsToString(scratch);
}

/**
 * The ids of the players on the server, as an array. `flags`: `"a"` living,
 * `"b"` dead, `"c"` no bots, `"h"` no HLTV, `"e"` only `team`. `server.players` is
 * everyone, as players, to filter as an array.
 *
 * Pawn: `get_players`
 */
export function playerIds(flags: string = "", team: string = ""): number[] {
	const list = new StaticArray<i32>(33);
	const count = new StaticArray<i32>(1);

	get_players(changetype<i32>(list), changetype<i32>(count), cells(flags), cells(team));

	const ids: number[] = [];
	for (let i = 0; i < unchecked(count[0]); i++) ids.push(unchecked(list[i]));
	return ids;
}

// Server's event name is typed like a DOM one - `K extends keyof ServerEventMap` -
// so an editor completes it, refuses a misspelled one, and hands the listener
// the event's own type. The compiler reads the same signature through a patch
// (runtime/patches): the name has to be written out as a string literal,
// because a string held in a variable says nothing about which event it is.
// Its words for the plugin author are the Server entry of scripts/docs/as/facade.ts.

// ---------------------------------------------------------------- commands

// A command is added by its usage - "/kick <target> [reason]" - and its words
// are read by code the build writes for that call (scripts/typed-commands.ts):
// a parser over __CommandWords, which reads each word as the argument's type
// says and answers the one who typed it with the usage when a word is wrong.
// The editor's signatures of addCommand and addServerCommand are in amxts.d.ts.

/** The options of a command: who may use it and its description in a listing. */
export interface CommandOptions {
	/** The admin right a player needs to use the command; left out, everyone may. */
	access?: Access;
	/** The command's description, shown by `amx_help` and in `server.commands`. */
	description?: string;
}

/** A command the plugin added, as `server.commands` lists it: what a `/help` shows. */
export class CommandInfo {
	constructor(
		/** The command's usage, as it is typed, e.g. `"/kick <target> [reason]"`. */
		readonly usage: string,
		/** The command's description, as its `description` option gave it; `""` without one. */
		readonly description: string,
		/** The admin right the command needs; `null` when everyone may use it. */
		readonly access: Access | null,
		/** Whether it is a command of the server console rather than a player's. */
		readonly server: boolean
	) {}
}

/** A command's name: the usage's first word - or, for a chat phrase, `"say <phrase>"` whole. */
function commandName(usage: string): string {
	const text = usage.trim();
	if (text.startsWith("say ")) return text;
	const space = text.indexOf(" ");
	return space < 0 ? text : text.substring(0, space);
}

/** The players a command's word names: `#userid`; else the whole name, in any case; else a part of it. */
function playersNamed(word: string): Player[] {
	const players = server.players;
	if (word.startsWith("#")) {
		const userid = <i32>Number(word.substring(1));
		return players.filter((player: Player) => get_user_userid(player.id) == userid);
	}
	const lower = word.toLowerCase();
	const whole = players.filter((player: Player) => player.name.toLowerCase() == lower);
	return whole.length > 0 ? whole : players.filter((player: Player) => player.name.toLowerCase().includes(lower));
}

let commonLoaded = false;

/** A line of AMX Mod X's `common.txt` in the player's language: the words of its own admin commands. */
function commonText(player: Player | null, key: string): string {
	if (!commonLoaded) commonLoaded = lang.load("common");
	return lang.translate(player, key);
}

/**
 * @hidden The words a command was typed with, as the build's code for one
 * command reads its arguments (scripts/typed-commands.ts): each by its place,
 * as its type says. A word that is not what the command takes answers the
 * one who typed it with the usage, and sets `failed`: the handler does not run.
 */
export class __CommandWords {
	/** Set once a word is wrong: the one who typed it has been told. */
	failed: bool = false;

	constructor(
		/** The player who typed it; `null` for the server's console. */
		readonly player: Player | null,
		readonly usage: string,
		readonly words: string[],
		/** The line from each word on, as typed: what the last text argument takes. */
		readonly rests: string[]
	) {}

	get count(): i32 {
		return this.words.length;
	}

	/** The word at `at`; `""` when it was not typed. */
	text(at: i32): string {
		return at < this.words.length ? this.words[at] : "";
	}

	/** The rest of the line from the word at `at`. */
	rest(at: i32): string {
		return at < this.rests.length ? this.rests[at] : "";
	}

	/** The word at `at` as a number; a word that is not one fails. */
	number(at: i32): number {
		const word = this.text(at);
		const value = Number(word);
		if (word.length == 0 || isNaN(value)) this.fail("");
		return value;
	}

	/** The word at `at`, one of `names`; another fails. */
	name(at: i32, names: string[]): string {
		const word = this.text(at);
		if (!names.includes(word)) this.fail("");
		return word;
	}

	/** The player the word at `at` names - `#userid`, the whole name or a part of it. None, or several, fails. */
	target(at: i32): Player | null {
		const found = playersNamed(this.text(at));
		if (found.length == 1) return found[0];
		this.fail(found.length == 0
			? commonText(this.player, "CL_NOT_FOUND")
			: `${commonText(this.player, "MORE_CL_MATCHT")}: ${found.map<string>((one: Player) => one.name).join(", ")}`);
		return null;
	}

	/** Whether at least `count` words were typed; fewer fails. */
	need(count: i32): bool {
		if (this.words.length < count) this.fail("");
		return !this.failed;
	}

	/** Whether no word is left over after the first `count`; one more fails. */
	done(count: i32): bool {
		if (this.words.length > count) this.fail("");
		return !this.failed;
	}

	/** Tells the one who typed it what was wrong, and the usage. */
	private fail(why: string): void {
		if (this.failed) return;
		this.failed = true;
		const usage = `${commonText(this.player, "USAGE")}: ${this.usage}`;
		const player = this.player;
		if (player == null) {
			if (why.length > 0) console.log(why);
			console.log(usage);
			return;
		}
		if (why.length > 0) print(player, why);
		print(player, usage);
	}
}

/** A chat line's words - one in double quotes is one word - and the line from each word on. */
function chatWords(player: Player, usage: string, line: string): __CommandWords {
	const words: string[] = [];
	const rests: string[] = [];
	let i = 0;
	while (i < line.length) {
		while (i < line.length && line.charAt(i) == " ") i++;
		if (i >= line.length) break;
		const quoted = line.charAt(i) == "\"";
		const close = quoted ? line.indexOf("\"", i + 1) : line.indexOf(" ", i);
		const end = close < 0 ? line.length : close;
		const word = line.substring(quoted ? i + 1 : i, end);
		// A quoted last word is the rest without its quotes.
		rests.push(quoted && close >= 0 && line.substring(close + 1).trim().length == 0 ? word : line.substring(i).trim());
		words.push(word);
		i = end + 1;
	}
	return new __CommandWords(player, usage, words, rests);
}

/** A console command's words, as the engine split them. */
function consoleWords(player: Player | null, usage: string): __CommandWords {
	const words: string[] = [];
	const count = read_argc();
	for (let i = 1; i < count; i++) words.push(read_argv(i));
	const rests: string[] = [];
	for (let i = 0; i < words.length; i++) rests.push(words.slice(i).join(" "));
	return new __CommandWords(player, usage, words, rests);
}

// The commands of this plugin, by name. One trampoline serves them all - the
// host calls it by its table index - and it finds the command by the name the
// player typed.
const commandNames: string[] = [];
const commandRuns: ((words: __CommandWords) => void)[] = [];
const commandInfos: CommandInfo[] = [];
let chatHooked = false;

function findCommand(name: string): i32 {
	const lower = name.toLowerCase();
	for (let i = 0; i < commandNames.length; i++) {
		if (commandNames[i] == lower) return i;
	}
	return -1;
}

/**
 * Converts `users.ini` letters to rights: `accessOf("abc")` is
 * [`"Immunity"`, `"Reservation"`, `"Kick"`]. An unknown letter is skipped.
 *
 * Pawn: `read_flags`
 */
export function accessOf(letters: string): Access[] {
	return <Access[]>ACCESS.namesOf(read_flags(letters));
}

/** Whether a player holds the admin flag a command asks for. */
function mayRun(id: i32, at: i32): bool {
	const access = commandInfos[at].access;
	if (access == null) return true;
	return (get_user_flags(id) & ACCESS.bitOf(access)) != 0;
}

/** say /name a b - the chat text, its first word the name; or a phrase added as "say <phrase>", the whole line. */
function chatCommand(player: number, level: number, cid: number, unused: number): void {
	const id = <i32>player;
	const text = read_argv(1).trim();
	const space = text.indexOf(" ");
	const slash = text.startsWith("/");
	const at = slash ? findCommand(space < 0 ? text : text.substring(0, space)) : findCommand("say " + text);
	if (at < 0 || !mayRun(id, at)) { _outcome(0); return; }
	runCommand(at, id, chatWords(new Player(id), commandInfos[at].usage, slash && space >= 0 ? text.substring(space + 1) : ""));
}

/** name a b - a console command, its arguments as the engine split them. */
function consoleCommand(player: number, level: number, cid: number, unused: number): void {
	const id = <i32>player;
	const at = findCommand(read_argv(0));
	if (at < 0 || !mayRun(id, at)) { _outcome(0); return; }
	runCommand(at, id, consoleWords(new Player(id), commandInfos[at].usage));
}

/**
 * Runs a player's command. An async handler runs under the player's signal
 * (see __co_ambient_player); the command is handled, so a chat command is not
 * repeated in chat, as a Pawn command's PLUGIN_HANDLED does.
 */
function runCommand(at: i32, id: i32, words: __CommandWords): void {
	const ambient = __co_ambient_player;
	__co_ambient_player = id;
	commandRuns[at](words);
	__co_ambient_player = ambient;
	handled();
}

// The server commands of this plugin, by name, and the ones still waiting for
// plugin_init. One trampoline serves them all, as it does the player commands.
const serverCommandNames: string[] = [];
const serverCommandRuns: ((words: __CommandWords) => void)[] = [];
const serverCommandUsages: string[] = [];
const waitingServerCommands: string[] = [];

// A touch the engine module filters by class, so a touch nobody listens for -
// and there is one every frame for a player on the ground - never reaches the
// plugin. One register_touch per pair of classes, its listeners behind it.
class TouchFilter {
	listeners: TouchListener[] = [];
	constructor(public toucher: string, public touched: string) {}
}

const touchFilters: TouchFilter[] = [];
const waitingTouches: TouchFilter[] = [];

// A Ham Sandwich hook waiting for plugin_init: RegisterHam makes an entity of
// the class to find its function, which is not for the moment a plugin loads.
class HamRegistration {
	constructor(public fn: i32, public classname: string, public handler: WideHandler, public post: bool) {}
}

const waitingHams: HamRegistration[] = [];

function registerHam(registration: HamRegistration): void {
	_ham(registration.fn, registration.classname, hostIndex(registration.handler, true), registration.post ? 1 : 0);
}

/**
 * @hidden The hood of a game event Ham Sandwich delivers (as/hooks.ts):
 * `fn` hooked on the class, a reload taking its slot back.
 */
export function __ham(fn: i32, classname: string, handler: WideHandler, post: bool): void {
	const registration = new HamRegistration(fn, classname, handler, post);
	if (serverUp) registerHam(registration);
	else waitingHams.push(registration);
}

/** name a b - typed in the server console or sent over rcon. */
function serverCommand(a: number, b: number, c: number, d: number): void {
	const at = serverCommandNames.indexOf(read_argv(0).toLowerCase());
	if (at < 0) { _outcome(0); return; }

	serverCommandRuns[at](consoleWords(null, serverCommandUsages[at]));
	handled();
}

/**
 * Hands one name to the engine. Not from a plugin's top level: that runs
 * during plugin_natives, and a command registered then crashes the server
 * when it is typed (see publicFor). A reload takes the same public back, and
 * the engine still knows the name, so nothing is registered twice.
 */
function registerServerCommand(name: string): void {
	const pub = publicFor(serverCommand, "srvcmd:" + name, 1);
	if (pub.length > 0) register_srvcmd(name, pub);
}

// ---------------------------------------------------------------- HUD

/**
 * The look of a HUD message. Every field has a default, so
 * `{ color: [255, 40, 40] }` is enough.
 *
 * Pawn: `set_hudmessage`
 */
export interface HudOptions {
	/** The text's colour: red, green, blue, `0` to `255` each. */
	color?: number[];
	/** The horizontal position: `0` is the left edge, `1` the right; `-1` centres the text. */
	x?: number;
	/** The vertical position: `0` is the top, `1` the bottom; `-1` centres the text. */
	y?: number;
	/** The time the message stays on screen, in seconds. */
	hold?: number;
	/** The appearance effect, one of: `"fade"` in and out, `"flicker"`, or `"typewriter"` — letter by letter. */
	effect?: HudEffect;
	/** The fade-in time, in seconds. */
	fadeIn?: number;
	/** The fade-out time, in seconds. */
	fadeOut?: number;
	/** The HUD channel, `1` to `4`; `-1` picks a free one. */
	channel?: number;
	/** The duration of the `"flicker"` and `"typewriter"` effects, in seconds. */
	effectTime?: number;
	/**
	 * Large letters, for a result or a headline. They have no channels, so
	 * `channel` does not apply.
	 *
	 * Pawn: `set_dhudmessage`
	 */
	large?: boolean;
}

/** A HUD message's appearance effect, one of: `"fade"` in and out, `"flicker"`, or `"typewriter"` — letter by letter. */
export type HudEffect = "fade" | "flicker" | "typewriter";

function hudEffect(options: HudOptions): i32 {
	return options.effect == "flicker" ? 1 : options.effect == "typewriter" ? 2 : 0;
}

// A field left out is AMX Mod X's own default, set_hudmessage's.
function setHud(options: HudOptions): void {
	const color = options.color ?? [200, 100, 0];
	const red = color.length > 0 ? color[0] : 200;
	const green = color.length > 1 ? color[1] : 100;
	const blue = color.length > 2 ? color[2] : 0;
	const x = options.x ?? -1.0;
	const y = options.y ?? 0.35;
	const effectTime = options.effectTime ?? 6.0;
	const hold = options.hold ?? 12.0;
	const fadeIn = options.fadeIn ?? 0.1;
	const fadeOut = options.fadeOut ?? 0.2;
	if (options.large) {
		set_dhudmessage(red, green, blue, x, y, hudEffect(options), effectTime, hold, fadeIn, fadeOut);
		return;
	}
	set_hudmessage(red, green, blue, x, y, hudEffect(options), effectTime, hold, fadeIn, fadeOut, options.channel ?? -1);
}

function showHudTo(id: i32, text: string, options: HudOptions): void {
	setHud(options);
	if (options.large) show_dhudmessage(id, text);
	else show_hudmessage(id, text);
}

/**
 * A HUD line for one message: showing a new one replaces the old instead of
 * taking another channel — for a countdown redrawn every second, a warning
 * that changes. `clear` removes it early.
 *
 * ```ts
 * const countdown = new HudLine();
 * countdown.show(player, `${left}`, { color: [255, 50, 50], hold: 1.1 });
 * countdown.clear(player);
 * countdown.clearAll();
 * ```
 *
 * Pawn: `CreateHudSyncObj`, `ShowSyncHudMsg`
 */
export class HudLine {
	private handle: i32 = -1;

	/** Shows `text` to the player on this line, replacing what it showed him before. */
	show(player: Player, text: string, options: HudOptions = {}): void {
		if (this.handle < 0) this.handle = <i32>CreateHudSyncObj();
		setHud(options);
		ShowSyncHudMsg(player.id, this.handle, text);
	}

	/** Removes the line's message from the player's screen before its time is up. */
	clear(player: Player): void {
		if (this.handle >= 0) ClearSyncHud(player.id, this.handle);
	}

	/** Removes the line's message from every screen. */
	clearAll(): void {
		if (this.handle >= 0) ClearSyncHud(0, this.handle);
	}
}

// ---------------------------------------------------------------- the screen

/** A fade's direction, one of: `"in"` from the colour to a clear view, `"out"` from a clear view to the colour. */
export type FadeDirection = "in" | "out";

/** The options of `player.screen.fade`. Times are in seconds. */
export interface FadeOptions {
	/** The colour: red, green, blue and alpha, `0` to `255` each; black by default. */
	color?: number[];
	/** The fade's duration, in seconds; `1` by default. */
	duration?: number;
	/** The time the full colour holds, in seconds; `0` by default. */
	hold?: number;
	/** The fade's direction, one of: `"in"` (the default) from the colour to a clear view, `"out"` from a clear view to the colour. */
	direction?: FadeDirection;
	/** Keeps the colour on the screen until the next fade. */
	stay?: boolean;
	/** Tints what is on the screen rather than painting over it. */
	modulate?: boolean;
}

/** The options of `player.screen.shake`. */
export interface ShakeOptions {
	/** The shake's strength: how far the view moves, up to 16 units; `4` by default. */
	amplitude?: number;
	/** The shake's duration, in seconds; `1` by default. */
	duration?: number;
	/** The shake's frequency, in jolts a second; `5` by default. */
	frequency?: number;
}

/** A status icon's state, one of `"hide"`, `"show"` (lit) or `"flash"`. */
export type StatusIconState = "hide" | "show" | "flash";

/** A time or a size as a message's fixed point: `units` of it make one, capped at 16 bits. */
function fixed(value: number, units: number): i32 {
	return <i32>Math.max(0.0, Math.min(65535.0, Math.round(value * units)));
}

/**
 * The effects one player sees over the world: fades, shakes, status icons and
 * the parts of the HUD the game draws itself.
 *
 * ```ts
 * player.screen.fade({ color: [0, 0, 0, 255], duration: 0.5, hold: 1, stay: true });
 * player.screen.shake({ amplitude: 8, duration: 1, frequency: 5 });
 * player.screen.statusIcon("dmg_cold", "show", [0, 160, 255]);
 * ```
 *
 * Times are in seconds.
 *
 * Pawn: `ScreenFade`, `ScreenShake`, `StatusIcon`, ...
 */
export class Screen {
	constructor(private id: i32) {}

	private begin(name: string, reliable: bool = true): void {
		message_begin(reliable ? MSG_ONE : MSG_ONE_UNRELIABLE, get_user_msgid(name), [0, 0, 0], this.id);
	}

	/**
	 * Colours the player's screen, fading in or out.
	 *
	 * Pawn: `ScreenFade`
	 */
	fade(options: FadeOptions = {}): void {
		const color = options.color ?? [0, 0, 0, 255];
		let flags = options.direction == "out" ? FFADE_OUT : FFADE_IN;
		if (options.modulate) flags |= FFADE_MODULATE;
		if (options.stay) flags |= FFADE_STAYOUT;

		this.begin("ScreenFade");
		write_short(fixed(options.duration ?? 1.0, 4096.0));
		write_short(fixed(options.hold ?? 0.0, 4096.0));
		write_short(flags);
		for (let i = 0; i < 4; i++) write_byte(i < color.length ? <i32>color[i] : 255);
		message_end();
	}

	/**
	 * Shakes the player's view.
	 *
	 * Pawn: `ScreenShake`
	 */
	shake(options: ShakeOptions = {}): void {
		this.begin("ScreenShake");
		write_short(fixed(options.amplitude ?? 4.0, 4096.0));
		write_short(fixed(options.duration ?? 1.0, 4096.0));
		write_short(fixed(options.frequency ?? 5.0, 256.0));
		message_end();
	}

	/**
	 * Shows, flashes or hides a status icon by its sprite name (`"dmg_cold"`,
	 * `"buyzone"`, `"c4"`, ...), in a colour.
	 *
	 * Pawn: `StatusIcon`
	 */
	statusIcon(sprite: string, state: StatusIconState, color: number[] = [0, 160, 0]): void {
		const status = state == "show" ? 1 : state == "flash" ? 2 : 0;
		this.begin("StatusIcon");
		write_byte(status);
		write_string(sprite);
		if (status != 0) {
			for (let i = 0; i < 3; i++) write_byte(i < color.length ? <i32>color[i] : 0);
		}
		message_end();
	}

	/**
	 * Sets the round clock at the top of the player's HUD, in seconds. Sent
	 * unreliably, as the game does: a client with a lagging connection may skip
	 * it.
	 *
	 * Pawn: `RoundTime`
	 */
	roundTime(seconds: number): void {
		this.begin("RoundTime", false);
		write_short(<i32>seconds);
		message_end();
	}

	/**
	 * Hides parts of the player's HUD right now. Setting `player.hideHud` does
	 * the same a frame later; this is for when that is too late.
	 *
	 * Pawn: `HideWeapon`
	 */
	hideHud(parts: HideHud[]): void {
		this.begin("HideWeapon");
		write_byte(HIDE_HUD.maskOf(parts));
		message_end();
	}

	/**
	 * Shows or hides Counter-Strike's own crosshair on the player's screen.
	 *
	 * Pawn: `Crosshair`
	 */
	crosshair(shown: boolean): void {
		this.begin("Crosshair");
		write_byte(shown ? 1 : 0);
		message_end();
	}

	/**
	 * Sets the flashlight icon on the player's HUD: on or off, and the battery in
	 * percent.
	 *
	 * Pawn: `Flashlight`
	 */
	flashlight(on: boolean, battery: number = 100): void {
		this.begin("Flashlight");
		write_byte(on ? 1 : 0);
		write_byte(<i32>battery);
		message_end();
	}

	/**
	 * Shows the progress bar in the middle of the player's screen, filling up
	 * over `seconds`; `0` hides it.
	 *
	 * Pawn: `BarTime`, `rg_send_bartime`
	 */
	progressBar(seconds: number): void {
		this.begin("BarTime");
		write_short(fixed(seconds, 1.0));
		message_end();
	}
}

/**
 * The channel a sound plays on, one of `"auto"` (the default), `"weapon"`,
 * `"voice"`, `"item"`, `"body"`, `"stream"`, `"static"`. A new sound on an
 * entity's channel cuts the one playing there; `"auto"` never cuts.
 */
export type SoundChannel = "auto" | "weapon" | "voice" | "item" | "body" | "stream" | "static";

/** The options of `entity.emitSound`; every one has a default. */
export interface SoundOptions {
	/** The entity's channel the sound plays on; `"auto"` by default. */
	channel?: SoundChannel;
	/** The volume, `0` to `1`; `1` by default. */
	volume?: number;
	/** The sound's fall-off with distance: `0` is heard across the map, `0.8` (the default) as a footstep, `2` only close by. */
	attenuation?: number;
	/** The pitch in percent: `100` (the default) as recorded, `50` an octave lower, up to `255`. */
	pitch?: number;
}

// A precached file's index lives in the module's store of player fields, in
// slot 0, which no player has: the store lasts as long as the map - as a
// precache does - and keeps what it holds through amxts_reload, when a
// plugin comes back after the map has loaded and can precache nothing.
// @ts-ignore: decorator
@external("env", "player_data_get") declare function _storedIndex(slot: i32, key: string): f64;
// @ts-ignore: decorator
@external("env", "player_data_set") declare function _storeIndex(slot: i32, key: string, index: f64): void;

/**
 * A file the game has precached - a sprite, a model, a sound - as
 * `server.precache` returns it. An effect takes it where it draws a sprite or
 * a model:
 *
 * ```ts
 * const shock = server.precache("sprites/shockwave.spr");
 * effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60 });
 * ```
 */
export class Resource {
	constructor(
		/** The file's path, as `server.precache` was given it, e.g. `"sprites/shockwave.spr"`. */
		public readonly path: string
	) {}

	/**
	 * The file's index in the game's precache list, as a native takes it; `0`
	 * while it is not precached.
	 */
	get index(): number {
		return _storedIndex(0, `precache:${this.path}`);
	}
}

// Files asked for before the map loads - at the top level of a plugin - and
// precached when it does.
const waitingPrecaches: string[] = [];
let precacheOpen = false;

function precacheNow(path: string): void {
	const lower = path.toLowerCase();
	const index = lower.endsWith(".wav") ? precache_sound(path)
		: lower.endsWith(".mdl") || lower.endsWith(".spr") ? precache_model(path)
		: precache_generic(path);
	_storeIndex(0, `precache:${path}`, index);
}

function precacheWaiting(event: PluginPrecacheEvent): void {
	precacheOpen = true;
	for (let i = 0; i < waitingPrecaches.length; i++) precacheNow(waitingPrecaches[i]);
	waitingPrecaches.length = 0;
	runWaiting(waitingAtPrecache);
}

// The stock hooks a server without reapi hears ReGameDLL's events through
// (as/hlds.ts), asked for before natives may be called - at a plugin's top
// level, during plugin_natives: a precache's hook at plugin_precache, before
// the game's own precaches, and every other at plugin_init, as a command is.
const waitingAtPrecache: (() => void)[] = [];
const waitingAtInit: (() => void)[] = [];

function runWaiting(list: (() => void)[]): void {
	const now = list.slice(0);
	list.length = 0;
	for (let i = 0; i < now.length; i++) now[i]();
}

// @ts-ignore: decorator
@external("env", "on_cell") declare function _onCell(event: string, fn: i32, shape: i32, arg: i32, value: i32): void;

/**
 * @hidden A forward the host relays, heard by `fn` (a one-cell handler) only
 * when its argument `arg` is `value`: the module compares it, so a forward
 * that comes often crosses into the plugin for that value alone.
 */
export function __onCell(event: string, fn: i32, arg: i32, value: i32): void {
	_onCell(event, fn, 0, arg, value);
}

/** @hidden Runs `register` from plugin_init on: now, or when it comes. */
export function __whenUp(register: () => void): void {
	if (serverUp) register();
	else waitingAtInit.push(register);
}

/** @hidden Runs `register` from plugin_precache on - or plugin_init, after a reload mid-map. */
export function __whenPrecache(register: () => void): void {
	if (precacheOpen || serverUp) register();
	else waitingAtPrecache.push(register);
}
addServerListener<PluginPrecacheEvent>(precacheWaiting);

// ScreenFade's flags (hlsdk shake.h), which no include carries.
const FFADE_IN = 0x0000;
const FFADE_OUT = 0x0001;
const FFADE_MODULATE = 0x0002;
const FFADE_STAYOUT = 0x0004;

// ---------------------------------------------------------------- client messages

/**
 * The arguments of a message, by their place, `0` for the first: a number
 * or a text, as the message wrote it.
 *
 * ```ts
 * server.addEventListener("message:BotProgress", (event) => {
 *   console.log(`${event.args.length} ${event.args.number(0)}`);
 * });
 * ```
 *
 * Pawn: `get_msg_args`, `get_msg_arg_*`, `set_msg_arg_*`
 */
export class MessageArgs {
	/** The number of arguments. */
	get length(): number {
		return get_msg_args();
	}

	/** Whether the argument at `index` is text; otherwise it is a number. */
	isText(index: number): boolean {
		return get_msg_argtype(<i32>index + 1) == ARG_STRING;
	}

	/** The argument at `index` as a number: a byte, a short, a coordinate, an angle. */
	number(index: number): number {
		const arg = <i32>index + 1;
		const type = get_msg_argtype(arg);
		return type == ARG_COORD || type == ARG_ANGLE ? get_msg_arg_float(arg) : get_msg_arg_int(arg);
	}

	/** The argument at `index` as text. */
	text(index: number): string {
		return get_msg_arg_string(<i32>index + 1);
	}

	/** Writes a number argument: the message goes out with it. */
	setNumber(index: number, value: number): void {
		const arg = <i32>index + 1;
		const type = get_msg_argtype(arg);
		if (type == ARG_COORD || type == ARG_ANGLE) set_msg_arg_float(arg, type, value);
		else set_msg_arg_int(arg, type, value);
	}

	/** Writes a text argument: the message goes out with it. */
	setText(index: number, value: string): void {
		set_msg_arg_string(<i32>index + 1, value);
	}
}

/**
 * A message the server sends its clients - a chat line, the round clock, a
 * HUD icon - heard on its way, before it leaves:
 *
 * ```ts
 * server.addEventListener("message:TextMsg", (event) => {
 *   if (event.text == "#Round_Draw") event.preventDefault();
 * });
 * ```
 *
 * A message whose layout is known has a typed field for each argument
 * (`event.text`), and writing one changes what the client gets; a message
 * without a known layout is read by place, through `event.args`, which
 * every message has.
 *
 * Pawn: `register_message`
 */
export class ClientMessage {
	/** @hidden What a message's event is told apart by, at compile time. */
	__message: bool = true;
	/** @hidden The player it goes to: the message's msg_entity. */
	__receiver: i32 = 0;

	/** The message's name, e.g. `"TextMsg"`. */
	name: string = "";

	/** The player the message goes to; `null` for a message to everyone. */
	get player(): Player | null {
		return this.__receiver >= 1 && this.__receiver <= get_maxplayers() ? new Player(this.__receiver) : null;
	}

	/** The message's arguments, by their place: `event.args.text(1)`. */
	get args(): MessageArgs {
		return new MessageArgs();
	}

	/**
	 * Stops the message: the client does not get it.
	 *
	 * Pawn: `return PLUGIN_HANDLED`
	 */
	preventDefault(): void {
		handled();
	}

	// A field reads an argument by its number, 1 for the first. One the
	// message did not write - StatusIcon's colour when it hides the icon, a
	// game text without words to put in - reads as 0 or "", and writing it
	// does nothing: AMX Mod X reports an argument past the last as an error.

	/** @hidden Whether the message has the argument. */
	protected __has(arg: i32): bool {
		return arg <= get_msg_args();
	}

	/** @hidden An argument as a number. */
	protected __number(arg: i32): f64 {
		return this.__has(arg) ? this.args.number(arg - 1) : 0;
	}

	/** @hidden */
	protected __setNumber(arg: i32, value: f64): void {
		if (this.__has(arg)) this.args.setNumber(arg - 1, value);
	}

	/** @hidden */
	protected __text(arg: i32): string {
		return this.__has(arg) ? get_msg_arg_string(arg) : "";
	}

	/** @hidden */
	protected __setText(arg: i32, value: string): void {
		if (this.__has(arg)) set_msg_arg_string(arg, value);
	}

	/** @hidden Every text from the argument on. */
	protected __texts(arg: i32): string[] {
		const texts: string[] = [];
		for (let at = arg; this.__has(at); at++) texts.push(get_msg_arg_string(at));
		return texts;
	}

	/** @hidden Writes the texts from the argument on, as many as the message has. */
	protected __setTexts(arg: i32, value: string[]): void {
		for (let i = 0; i < value.length && this.__has(arg + i); i++) set_msg_arg_string(arg + i, value[i]);
	}

	/** @hidden A player's number argument; `0` or past the players is none. */
	protected __player(arg: i32): Player | null {
		const id = <i32>this.__number(arg);
		return id >= 1 && id <= get_maxplayers() ? new Player(id) : null;
	}

	/** @hidden Three coordinates from the argument on. */
	protected __vector(arg: i32): Vector {
		return new Vector(this.__number(arg), this.__number(arg + 1), this.__number(arg + 2));
	}

	/** @hidden */
	protected __setVector(arg: i32, value: number[]): void {
		for (let i = 0; i < 3; i++) this.__setNumber(arg + i, value[i]);
	}

	/** @hidden `count` bytes from the argument on: a colour. */
	protected __bytes(arg: i32, count: i32): number[] {
		const bytes: number[] = [];
		for (let i = 0; i < count; i++) bytes.push(this.__number(arg + i));
		return bytes;
	}

	/** @hidden */
	protected __setBytes(arg: i32, value: number[]): void {
		for (let i = 0; i < value.length; i++) this.__setNumber(arg + i, value[i]);
	}

	/** @hidden Whether the argument has the bit. */
	protected __bit(arg: i32, bit: i32): bool {
		return (<i32>this.__number(arg) & bit) != 0;
	}

	/** @hidden Sets or clears one bit of the argument, keeping the others. */
	protected __setBit(arg: i32, bit: i32, on: bool): void {
		const mask = <i32>this.__number(arg);
		this.__setNumber(arg, on ? mask | bit : mask & ~bit);
	}
}

// One register_message per message name, its listeners behind it: the engine
// hands the plugin only the messages it listens to. Registered when the
// server is up - a message's id is known from plugin_init - and a reload
// takes the same public back.
class MessageChannel {
	listeners: ((event: ClientMessage) => void)[] = [];
	constructor(public name: string, public make: () => ClientMessage) {}
}

const messageChannels: MessageChannel[] = [];
const waitingMessages: MessageChannel[] = [];

function messageChannel(name: string): MessageChannel | null {
	for (let i = 0; i < messageChannels.length; i++) {
		if (messageChannels[i].name == name) return messageChannels[i];
	}
	return null;
}

function addMessageListener<E>(name: string, listener: (event: E) => void): void {
	let channel = messageChannel(name);

	if (channel == null) {
		channel = new MessageChannel(name, (): ClientMessage => changetype<ClientMessage>(instantiate<E>()));
		messageChannels.push(channel);
		if (serverUp) registerMessage(channel);
		else waitingMessages.push(channel);
	}

	channel.listeners.push(changetype<(event: ClientMessage) => void>(listener));
}

function removeMessageListener<E>(name: string, listener: (event: E) => void): void {
	const channel = messageChannel(name);
	if (channel == null) return;
	const at = channel.listeners.indexOf(changetype<(event: ClientMessage) => void>(listener));
	if (at >= 0) channel.listeners.splice(at, 1);
}

function registerMessage(channel: MessageChannel): void {
	const id = get_user_msgid(channel.name);

	if (id == 0) {
		console.error(`message:${channel.name} - the game has no message by that name`);
		return;
	}

	const fired = (message: number, dest: number, receiver: number, d: number): void => messageFired(channel, <i32>receiver);
	const pub = publicFor(fired, `msg:${channel.name}`);
	if (pub.length > 0) register_message(id, pub);
}

/** The public register_message calls: (message, dest, receiver). */
function messageFired(channel: MessageChannel, receiver: i32): void {
	const event = channel.make();
	event.name = channel.name;
	event.__receiver = receiver;
	// A copy: a listener that removes itself must not make the next one skip.
	const listeners = channel.listeners.slice(0);
	for (let i = 0; i < listeners.length; i++) listeners[i](event);
}

// ---------------------------------------------------------------- player fields changing

// @ts-ignore: decorator
@external("env", "player_change_listen")   declare function _playerChangeListen(field: string, fn: i32): void;
// @ts-ignore: decorator
@external("env", "player_change_get")      declare function _playerChangeGet(which: i32): f64;
// @ts-ignore: decorator
@external("env", "player_change_get_text") declare function _playerChangeGetText(which: i32, out: usize, max: i32): i32;

/**
 * A field plugins added to `Player` changed on a player - written by any
 * plugin, TypeScript or Pawn:
 *
 * ```ts
 * server.addEventListener("playerchange", (event) => {
 *   print(event.player, event.value ? "You are protected" : "Your spawn protection is over");
 * }, { field: "spawnProtected" });
 * ```
 *
 * With `field`, `event.value` and `event.previous` have the field's type; a
 * named listener takes `PlayerChangeEvent<"spawnProtected">`. Without it
 * every field is heard, and `event.field` says which.
 */
export class PlayerChangeEvent<F extends string = string> {
	/** @hidden What a change's event is told apart by, at compile time. */
	__playerChange: bool = true;
	/** @hidden The player's slot. */
	__slot: i32 = 0;
	/** @hidden The value before the change, as the module keeps it: a number, or a text. */
	__previousNumber: f64 = 0;
	/** @hidden */
	__previousText: string = "";
	/** @hidden The value after it. */
	__number: f64 = 0;
	/** @hidden */
	__text: string = "";

	/** The field that changed, e.g. `"spawnProtected"`; a member of an object field is dotted, `"glow.enabled"`. */
	field: string = "";

	/** The player whose field changed. */
	get player(): Player {
		return new Player(this.__slot);
	}
}

/** The third argument of `server.addEventListener`. */
export interface ServerListenerOptions {
	/**
	 * For `"playerchange"`: the field listened for, e.g. `"spawnProtected"`, or
	 * an object field's member, `"glow.enabled"`; an object field's name
	 * hears each of its members. Left out, every field.
	 */
	field?: string;
}

// This plugin's playerchange listeners. The module wakes the plugin only for
// the fields they are for (player_change_listen), and the trampoline hands a
// change to the ones it concerns, each as its own event class - the field's
// typed one, which the build makes (scripts/player-fields.ts).
class PlayerChangeListener {
	constructor(
		public field: string,
		public listener: (event: PlayerChangeEvent) => void,
		public make: () => PlayerChangeEvent
	) {}
}

const playerChangeListeners: PlayerChangeListener[] = [];
const heardFields: string[] = [];

/** Whether a listener for `field` hears `key`: the field itself, a member of it, or "" for every one. */
function hears(field: string, key: string): bool {
	return field.length == 0 || key == field || (key.startsWith(field) && key.charCodeAt(field.length) == 46);
}

function addPlayerChangeListener<E>(field: string, listener: (event: E) => void): void {
	const make = (): PlayerChangeEvent => changetype<PlayerChangeEvent>(instantiate<E>());
	playerChangeListeners.push(new PlayerChangeListener(field, changetype<(event: PlayerChangeEvent) => void>(listener), make));
	if (heardFields.includes(field)) return;
	heardFields.push(field);
	_playerChangeListen(field, playerChanged.index);
}

function removePlayerChangeListener<E>(field: string, listener: (event: E) => void): void {
	const fn = changetype<(event: PlayerChangeEvent) => void>(listener);
	for (let i = 0; i < playerChangeListeners.length; i++) {
		const one = playerChangeListeners[i];
		if (one.field != field || one.listener != fn) continue;
		playerChangeListeners.splice(i, 1);
		return;
	}
}

/** The change's key (0) or its text before (1) or after (2). */
function changeText(which: i32): string {
	const length = _playerChangeGetText(which, 0, 0);
	if (length <= 0) return "";
	const bytes = new ArrayBuffer(length);
	_playerChangeGetText(which, changetype<usize>(bytes), length);
	return String.UTF8.decode(bytes);
}

/** What the module calls when a field this plugin listens for changes on player `slot`. */
function playerChanged(slot: i32): void {
	const key = changeText(0);
	const previousNumber = _playerChangeGet(1);
	const previousText = changeText(1);
	const number = _playerChangeGet(2);
	const text = changeText(2);

	// A copy: a listener that removes itself must not make the next one skip.
	const listeners = playerChangeListeners.slice(0);
	for (let i = 0; i < listeners.length; i++) {
		const one = listeners[i];
		if (!hears(one.field, key)) continue;
		const event = one.make();
		event.__slot = slot;
		event.field = key;
		event.__previousNumber = previousNumber;
		event.__previousText = previousText;
		event.__number = number;
		event.__text = text;
		one.listener(event);
	}
}

// ---------------------------------------------------------------- cvars

/** The event a cvar's change listener receives: the cvar, its old and its new value. */
export class CvarChangeEvent {
	constructor(
		/** The cvar that changed. */
		public cvar: Cvar,
		/** The cvar's value before the change, as text. */
		public oldValue: string,
		/** The cvar's new value, as text. */
		public value: string
	) {}
}

/** A cvar's change listener: `(event) => ...`, with the old and the new value in `event`. */
export type CvarListener = (event: CvarChangeEvent) => void;

// Every Cvar with a change listener, for the one trampoline that hears them.
const watchedCvars: Cvar[] = [];

// Cvars made before plugin_init, attached when it comes. The facade's own init
// listener is added before any plugin's, so a plugin's init sees them ready.
const waitingCvars: Cvar[] = [];
let serverUp = false;

// A Cvar may be made from here on: plugin_natives is over.
let cvarsReady = false;

function attachWaitingCvars(event: PluginInitEvent): void {
	serverUp = true;
	// No precache came - the plugin was reloaded mid-map: what it asked for
	// is found in the store, or was never precached.
	precacheOpen = false;
	waitingPrecaches.length = 0;
	makeWaitingCvars();
	for (let i = 0; i < waitingServerCommands.length; i++) registerServerCommand(waitingServerCommands[i]);
	waitingServerCommands.length = 0;
	for (let i = 0; i < waitingTouches.length; i++) registerTouch(waitingTouches[i]);
	waitingTouches.length = 0;
	for (let i = 0; i < waitingHams.length; i++) registerHam(waitingHams[i]);
	waitingHams.length = 0;
	for (let i = 0; i < waitingMessages.length; i++) registerMessage(waitingMessages[i]);
	waitingMessages.length = 0;
	runWaiting(waitingAtPrecache);
	runWaiting(waitingAtInit);
}
addServerListener<PluginInitEvent>(attachWaitingCvars);


function makeWaitingCvars(): void {
	cvarsReady = true;
	for (let i = 0; i < waitingCvars.length; i++) waitingCvars[i].attach();
	waitingCvars.length = 0;
}

/**
 * @hidden The start of every exported native. A Pawn plugin calls one from
 * its plugin_init at the earliest - often before the host's own - and by then
 * plugin_natives is over, so a Cvar the native makes (a register_cvar native
 * of the plugin's) is made at once rather than when this plugin's init comes.
 */
export function __nativeCall(): void {
	if (!cvarsReady) makeWaitingCvars();
}

function cvarChanged(pointer: number, oldText: number, newText: number, unused: number): void {
	for (let i = 0; i < watchedCvars.length; i++) {
		const cvar = watchedCvars[i];
		if (cvar.pointer != <i32>pointer) continue;
		cvar.dispatch(new CvarChangeEvent(cvar, argText(1), argText(2)));
		return;
	}
}

/**
 * A server cvar, read and written like an input's `value`:
 *
 * ```ts
 * const freeze = new Cvar("mp_freezetime");
 * freeze.number = 5;
 * const speed = new Cvar("my_speed", "250");     // made with 250 if it does not exist
 * speed.addEventListener("change", (event) => console.log(`${event.oldValue} -> ${event.value}`));
 * ```
 *
 * `value` is the cvar's text; `number` and `boolean` read and write the same
 * cvar as a number and as an on/off switch.
 *
 * Pawn: `get_cvar_pointer`, `create_cvar`, `get_pcvar_string`, `set_pcvar_num`, `hook_cvar_change`
 */
export class Cvar {
	/**
	 * The cvar's handle in the engine; `0` when the server has no such cvar.
	 *
	 * Pawn: `get_cvar_pointer`
	 */
	pointer: i32 = 0;
	private listeners: CvarListener[] = [];
	private hooked: bool = false;

	constructor(
		/** The cvar's name, as the console knows it, e.g. `"mp_timelimit"`. */
		public name: string,
		private defaultValue: string | null = null
	) {
		if (cvarsReady) this.attach();
		else waitingCvars.push(this);
	}

	/**
	 * @internal Finds or creates the cvar and starts hearing its changes. A Cvar
	 * made at the top level of a plugin waits for `plugin_init`: creating a cvar
	 * while plugins are still loading takes the server down.
	 */
	attach(): void {
		let pointer = get_cvar_pointer(this.name);
		const fallback = this.defaultValue;
		if (pointer == 0 && fallback != null) pointer = create_cvar(this.name, fallback);
		this.pointer = pointer;
		if (this.listeners.length > 0) this.hook();
	}

	private hook(): void {
		if (this.hooked || this.pointer == 0) return;
		this.hooked = true;
		watchedCvars.push(this);
		const pub = publicFor(cvarChanged, "cvarchange:" + this.name);
		if (pub.length > 0) hook_cvar_change(this.pointer, pub);
	}

	/** `true` when the server has this cvar. */
	get exists(): bool { return this.pointer != 0; }

	/** The cvar's value as text, e.g. `"250"`. */
	get value(): string { return this.pointer != 0 ? get_pcvar_string(this.pointer) : ""; }
	set value(text: string) { if (this.pointer != 0) set_pcvar_string(this.pointer, text); }

	/** The cvar's value as a number. A whole number is written without a fraction: `"5"`, not `"5.000000"`. */
	get number(): number { return this.pointer != 0 ? get_pcvar_float(this.pointer) : 0; }
	set number(value: number) {
		if (this.pointer == 0) return;
		if (value == Math.floor(value)) set_pcvar_num(this.pointer, <i32>value);
		else set_pcvar_float(this.pointer, value);
	}

	/** The cvar as an on/off switch: `true` for anything but `0`. Writing `true` sets `1`, `false` sets `0`. */
	get boolean(): bool { return this.pointer != 0 && get_pcvar_num(this.pointer) != 0; }
	set boolean(on: bool) { if (this.pointer != 0) set_pcvar_num(this.pointer, on ? 1 : 0); }

	/** Calls `listener` whenever the cvar's value changes. */
	addEventListener(type: "change", listener: CvarListener): void {
		this.listeners.push(listener);
		this.hook();
	}

	/** Stops calling a listener added with `addEventListener`. */
	removeEventListener(type: "change", listener: CvarListener): void {
		const at = this.listeners.indexOf(listener);
		if (at >= 0) this.listeners.splice(at, 1);
	}

	/** @internal Calls the change listeners; the server does it when the cvar changes. A plugin listens with `addEventListener`. */
	dispatch(event: CvarChangeEvent): void {
		const listeners = this.listeners.slice(0);
		for (let i = 0; i < listeners.length; i++) listeners[i](event);
	}
}

/**
 * The server, an event target like the DOM's: its events, commands, map and
 * the folders AMX Mod X keeps. Used through `server`:
 *
 * ```ts
 * server.addEventListener("putinserver", (event) => {
 *   print(event.player, "Welcome!");      // event is a PutinserverEvent
 * });
 * server.map;                             // "de_dust2"
 * server.maxPlayers;                      // 32
 * server.command("echo hi");
 * ```
 *
 * The event's name is written out as a string: the editor completes it and
 * hands the listener the event's own type. A listener may use the variables
 * of the function it is written in - it is a closure, as in JavaScript.
 */
export class Server {
	/**
	 * Calls `listener` every time the server raises the event `type` - or,
	 * for `"message:<Name>"`, every time it sends that message to a client.
	 * `"playerchange"` takes the field it is for: `{ field: "spawnProtected" }`.
	 */
	addEventListener<K extends keyof ServerEventMap>(type: K, listener: (event: ServerEventMap[K]) => void, options: ServerListenerOptions = {}): void {
		// @ts-ignore: a message's event is told apart by its field, at compile time
		if (isDefined(changetype<ServerEventMap[K]>(0).__message)) addMessageListener<ServerEventMap[K]>(type.slice(8), listener);
		// @ts-ignore: and so is a field's change
		else if (isDefined(changetype<ServerEventMap[K]>(0).__playerChange)) addPlayerChangeListener<ServerEventMap[K]>(options.field ?? "", listener);
		else addServerListener<ServerEventMap[K]>(listener);
	}

	/** Stops calling a listener added with `addEventListener` - the same function and the same options. */
	removeEventListener<K extends keyof ServerEventMap>(type: K, listener: (event: ServerEventMap[K]) => void, options: ServerListenerOptions = {}): void {
		// @ts-ignore: as in addEventListener
		if (isDefined(changetype<ServerEventMap[K]>(0).__message)) removeMessageListener<ServerEventMap[K]>(type.slice(8), listener);
		// @ts-ignore: as in addEventListener
		else if (isDefined(changetype<ServerEventMap[K]>(0).__playerChange)) removePlayerChangeListener<ServerEventMap[K]>(options.field ?? "", listener);
		else removeServerListener<ServerEventMap[K]>(listener);
	}

	/**
	 * The current map's name, e.g. `"de_dust2"`.
	 *
	 * Pawn: `get_mapname`
	 */
	get map(): string {
		return get_mapname();
	}

	/**
	 * The number of player slots on the server, e.g. `32`.
	 *
	 * Pawn: `get_maxplayers`
	 */
	get maxPlayers(): number {
		return get_maxplayers();
	}

	/**
	 * The AMX Mod X configs folder, relative to the game folder, as `fs` takes it:
	 * `addons/amxmodx/configs` unless the server moved it.
	 *
	 * ```ts
	 * const text = fs.readFileSync(`${server.configsDir}/myplugin.ini`);
	 * ```
	 *
	 * Pawn: `get_configsdir`
	 */
	get configsDir(): string {
		const dir = get_localinfo("amxx_configsdir");
	/**
	 * The players on the server, every one connected - never an HLTV proxy -
	 * read anew each time. Narrow them with the array's `filter`:
	 *
	 * ```ts
	 * const alive = server.players.filter(player => player.isAlive);
	 * const cts = server.players.filter(player => player.team === "CT" && !player.isBot);
	 * ```
	 *
	 * Pawn: `get_players`
	 */
	get players(): Player[] {
		const ids = playerIds("h");
		const list: Player[] = [];
		for (let i = 0; i < ids.length; i++) list.push(new Player(ids[i]));
		return list;
	}

		return dir.length > 0 ? dir : "addons/amxmodx/configs";
	}

	/**
	 * The AMX Mod X folder for plugins' data files: `addons/amxmodx/data` unless the server moved it.
	 *
	 * Pawn: `get_datadir`
	 */
	get dataDir(): string {
		const dir = get_localinfo("amxx_datadir");
		return dir.length > 0 ? dir : "addons/amxmodx/data";
	}

	/**
	 * Runs a command in the server console, as if typed there:
	 * `server.command("changelevel de_dust2")`. The text goes as it is: a `%` stays a `%`.
	 *
	 * Pawn: `server_cmd`
	 */
	command(text: string): void {
		// server_cmd takes a `...` tail, so it goes through Call; the text is an
		// argument, not the format, or a `%` in a map name would be a conversion.
		new Call(NATIVE_server_cmd).str("%s").str(text).run();
	}

	/**
	 * The commands this plugin added, players' and the server's, in the order
	 * they were added: each one's `usage`, `description` and `access` - what a
	 * `/help` prints.
	 *
	 * ```ts
	 * server.addCommand("/help", ({ player }) => {
	 *   for (const command of server.commands) {
	 *     if (command.access == null || player.access.includes(command.access)) print(player, command.usage);
	 *   }
	 * });
	 * ```
	 */
	get commands(): CommandInfo[] {
		return commandInfos.slice(0);
	}

	/**
	 * @hidden A player's command, its words read by `run` - the parser the
	 * build writes for each `addCommand` call (scripts/typed-commands.ts).
	 */
	__addCommand(usage: string, run: (words: __CommandWords) => void, options: CommandOptions = {}): void {
		const name = commandName(usage);
		const chat = name.startsWith("/") || name.startsWith("say ");
		const access = options.access;

		commandNames.push(name.toLowerCase());
		commandRuns.push(run);
		commandInfos.push(new CommandInfo(usage, options.description ?? "", access ?? null, false));

		if (!chat) {
			const flags = access != null ? ACCESS.bitOf(access) : 0;
			_clcmd(name, consoleCommand.index, flags, options.description ?? "", SHAPE_WIDE);
			return;
		}

		if (chatHooked) return;
		chatHooked = true;
		_clcmd("say", chatCommand.index, 0, "", SHAPE_WIDE);
		_clcmd("say_team", chatCommand.index, 0, "", SHAPE_WIDE);
	}

	/** @hidden A command of the server console, its words read by `run`, as `__addCommand`'s are. */
	__addServerCommand(usage: string, run: (words: __CommandWords) => void): void {
		const lower = commandName(usage).toLowerCase();
		serverCommandNames.push(lower);
		serverCommandRuns.push(run);
		serverCommandUsages.push(usage);
		commandInfos.push(new CommandInfo(usage, "", null, true));

		if (serverUp) registerServerCommand(lower);
		else waitingServerCommands.push(lower);
	}

	/** Shows a HUD message to every player, with the same options as `player.showHud`. */
	showHud(text: string, options: HudOptions = {}): void {
		showHudTo(0, text, options);
	}

	/**
	 * Precaches a file, so the game can use it and players download it:
	 * `const shock = server.precache("sprites/shockwave.spr")`. At the top level
	 * of the file it is precached when the map loads; in the `"precache"` event,
	 * at once. A sound is written as the game plays it, under `sound/`:
	 * `"myplugin/hit.wav"`. Returns the file as a `Resource` - what an effect
	 * takes for a sprite or a model.
	 *
	 * Pawn: `precache_model`, `precache_sound`, `precache_generic`
	 */
	precache(path: string): Resource {
		const resource = new Resource(path);
		if (precacheOpen) precacheNow(path);
		else if (!serverUp) waitingPrecaches.push(path);
		else if (resource.index == 0) console.error(`"${path}" is not precached: precache it at the top level of the plugin or in the "precache" event`);
		return resource;
	}
}

/** The server the plugin runs on: its events, commands and map. */
export const server = new Server();

/**
 * The game's events (reapi hookchains and Ham Sandwich functions) and round
 * control, as an event target like the DOM's:
 *
 * ```ts
 * game.addEventListener("takeDamage", (event) => {
 *   if (event.player.isBot) event.preventDefault();
 * });
 * game.addEventListener("canPlayerHearPlayer", (event) => event.listener.team == event.sender.team);
 * game.addEventListener("flPlayerFallDamage", (event) => event.result / 2, true);
 * ```
 *
 * The event's type follows from its name. What a listener returns is the
 * answer to the game: before the game acts it replaces what the game would
 * do, after it (`post`) it replaces the result. A listener that returns
 * nothing leaves it to the game; `event.preventDefault()` blocks without an
 * answer. A value of the wrong type is an error in the editor and in the build.
 *
 * The game rules are its fields: `game.freezePeriod`, `game.numCtWins`,
 * `game.roundWinner`.
 *
 * Pawn: `RegisterHookChain`, `RegisterHam`, `get_member_game`
 */
export class Game extends GameFields {
	/**
	 * Calls `listener` every time the game runs `type`. With `true` - or
	 * `{ post: true }` - it runs after the game has acted, with the game's answer
	 * in `event.result`; by default it runs before and can stop it.
	 * `classname` narrows it to one class of entity, and only that class's
	 * reach the plugin: `{ classname: "weapon_knife" }`. A `"touch"` listener
	 * takes the classes it is about instead: `{ toucher: "player", touched: "player" }`.
	 *
	 * Pawn: `RegisterHookChain`, `RegisterHam`, `register_touch`
	 */
	addEventListener<K extends keyof GameEventMap, R extends GameAnswerMap[K] | void | Promise<GameAnswerMap[K] | void> = void>(
		type: K, listener: (event: GameEventMap[K]) => R, options: boolean | GameListenerOptions = {}
	): void {
		const given = options as GameListenerOptions;
		if (idof<GameEventMap[K]>() == idof<TouchEvent>()) {
			if (!isVoid<R>()) ERROR("a touch listener answers nothing: block the touch with event.preventDefault()");
			addTouchListener(changetype<TouchListener>(listener), given.toucher ?? "*", given.touched ?? "*");
			return;
		}
		addGameListener<GameEventMap[K], R>(listener, given.post == true, given.classname ?? "");
	}

	/** Stops calling a listener added with `addEventListener` - the same function and the same options. */
	removeEventListener<K extends keyof GameEventMap, R extends GameAnswerMap[K] | void | Promise<GameAnswerMap[K] | void> = void>(
		type: K, listener: (event: GameEventMap[K]) => R, options: boolean | GameListenerOptions = {}
	): void {
		const given = options as GameListenerOptions;
		if (idof<GameEventMap[K]>() == idof<TouchEvent>()) {
			removeTouchListener(changetype<TouchListener>(listener), given.toucher ?? "*", given.touched ?? "*");
			return;
		}
		removeGameListener<GameEventMap[K], R>(listener, given.post == true, given.classname ?? "");
	}

	/**
	 * The game's clock: seconds since the map started. Entity fields that hold a
	 * moment - `nextThink`, `damageTime` - are on it:
	 * `grenade.damageTime = game.time + 1`. The attack timers - a weapon's
	 * `nextPrimaryAttack`, a player's `nextAttack` - count from now instead:
	 * `weapon.nextPrimaryAttack = 1` is a second away.
	 *
	 * Pawn: `get_gametime`
	 */
	get time(): number {
		return get_gametime();
	}

	/**
	 * Ends the round now:
	 *
	 * ```ts
	 * game.endRound({ winner: "TERRORIST" });                 // terrorists win, next round in 5 s
	 * game.endRound({ winner: "draw", delay: 3 });            // a draw, next round in 3 s
	 * game.endRound({ winner: "none", message: "" });         // a quiet restart: no message
	 * ```
	 *
	 * The winner sets the score, the message and the sound (`"Terrorists Win!"`);
	 * `message` and `sound` replace them, `""` turns them off.
	 *
	 * Pawn: `rg_round_end`
	 */
	endRound(options: EndRoundOptions): void {
		const status = max(WINNER_NAMES.indexOf(options.winner), 0);
		const delay = options.delay ?? 5.0;
		const message = options.message ?? "default";
		const sound = options.sound ?? "default";
		if (__hasReapi()) {
			rg_round_end(delay, status, ROUND_REASONS[status], message, sound, options.dispatch ?? false);
			return;
		}

		// Without reapi, what rg_round_end does through the game's
		// TerminateRound: the winner, the moment the next round starts, and the
		// round marked as ending, so the game does not end it again meanwhile;
		// then the message and the sound.
		this.roundWinner = options.winner;
		this.roundTerminating = true;
		this.restartRoundTime = this.time + delay;
		const text = message == "default" ? ROUND_MESSAGES[status] : message;
		const radio = sound == "default" ? ROUND_SOUNDS[status] : sound;
		if (!(options.dispatch ?? false)) {
			if (text.length > 0) client_print(0, print_center, text);
			if (radio.length > 0) broadcastAudio(`%!MRAD_${radio}`);
			return;
		}

		// Told as the game tells a round's end - the message and the sound
		// through the engine, where every plugin's hooks hear them, then its
		// log lines, which the roundEnd listeners hear on plain HLDS - Pawn
		// plugins' logevents too.
		if (text.length > 0) {
			emessage_begin(MSG_ALL, get_user_msgid("TextMsg"));
			ewrite_byte(print_center);
			ewrite_string(text);
			emessage_end();
		}
		if (radio.length > 0) {
			emessage_begin(MSG_ALL, get_user_msgid("SendAudio"));
			ewrite_byte(0);
			ewrite_string(`%!MRAD_${radio}`);
			ewrite_short(100);
			emessage_end();
		}
		const score = `(CT "${this.numCtWins}") (T "${this.numTerroristWins}")`;
		if (status == 3) elog_message(`World triggered "Round_Draw" ${score}`);
		else if (status > 0) elog_message(`Team "${status == 1 ? "CT" : "TERRORIST"}" triggered "${status == 1 ? "CTs_Win" : "Terrorists_Win"}" ${score}`);
		elog_message(`World triggered "Round_End"`);
	}
}

/**
 * The third argument of `game.addEventListener`: `true` stands for
 * `{ post: true }`; a `"touch"` listener names the classes it is about.
 */
export interface GameListenerOptions {
	/** Runs the listener after the game has acted, with its answer in `event.result`. */
	post?: boolean;
	/** The class of entity the event is listened for on, e.g. `"weapon_knife"`: only its entities reach the listener. */
	classname?: string;
	/** For `"touch"`: the class of the entity that moves into the other, e.g. `"player"`; left out, any. */
	toucher?: string;
	/** For `"touch"`: the class of the entity touched, e.g. `"func_door"`; left out, any. */
	touched?: string;
}

/**
 * The way one entity uses another - a button pressed, a door opened - one of
 * `"off"`, `"on"`, `"set"` or `"toggle"`.
 *
 * Pawn: `USE_OFF`, `USE_ON`, `USE_SET`, `USE_TOGGLE`
 */
export type UseType = "off" | "on" | "set" | "toggle";

/** The options of an entity's action such as `weapon.deploy()` or `entity.takeHealth(...)`. */
export interface ActionOptions {
	/**
	 * Whether the game's listeners run too - this plugin's and every other's,
	 * Pawn ones included; `true` by default. `false` runs the game's own
	 * function alone.
	 *
	 * Pawn: `ExecuteHamB`, `ExecuteHam`
	 */
	hooks?: boolean;
}

/**
 * Two entities touched: `toucher` moved into `touched`. Only the classes a
 * listener asked for reach it:
 *
 * ```ts
 * game.addEventListener("touch", onTouch, { toucher: "player", touched: "player" });
 * ```
 *
 * Pawn: `register_touch`
 */
export class TouchEvent {
	constructor(
		/** The entity that moved into the other. */
		public toucher: Entity,
		/** The entity it touched. */
		public touched: Entity
	) {}

	/** Blocks the touch: the game does not act on it. */
	preventDefault(): void {
		handled();
	}
}

/** A touch listener, as game.addEventListener("touch", ...) takes one. */
type TouchListener = (event: TouchEvent) => void;

function touchFilter(toucher: string, touched: string): TouchFilter | null {
	for (let i = 0; i < touchFilters.length; i++) {
		const filter = touchFilters[i];
		if (filter.toucher == toucher && filter.touched == touched) return filter;
	}
	return null;
}

function addTouchListener(listener: TouchListener, toucher: string, touched: string): void {
	let filter = touchFilter(toucher, touched);

	if (filter == null) {
		filter = new TouchFilter(toucher, touched);
		touchFilters.push(filter);
		if (serverUp) registerTouch(filter);
		else waitingTouches.push(filter);
	}

	filter.listeners.push(listener);
}

function removeTouchListener(listener: TouchListener, toucher: string, touched: string): void {
	const filter = touchFilter(toucher, touched);
	if (filter == null) return;
	const at = filter.listeners.indexOf(listener);
	if (at >= 0) filter.listeners.splice(at, 1);
}

/** Hands one pair of classes to the engine module; a reload takes the same public back. */
function registerTouch(filter: TouchFilter): void {
	const fired = (touched: number, toucher: number, c: number, d: number): void => touchFired(filter, touched, toucher);
	const pub = publicFor(fired, `touch:${filter.toucher}:${filter.touched}`);
	if (pub.length > 0) register_touch(filter.touched, filter.toucher, pub);
}

/** The public register_touch calls: (touched, toucher), in its order. */
function touchFired(filter: TouchFilter, touched: number, toucher: number): void {
	const event = new TouchEvent(new Entity(toucher), new Entity(touched));
	// A copy: a listener that removes itself must not make the next one skip.
	const listeners = filter.listeners.slice(0);
	for (let i = 0; i < listeners.length; i++) listeners[i](event);
}

/** The winner of a round, one of `"TERRORIST"`, `"CT"`, `"draw"`, or `"none"` - a restart without a winner. */
export type RoundWinner = "TERRORIST" | "CT" | "draw" | "none";

/** The options of `game.endRound`; only `winner` is required. */
export interface EndRoundOptions {
	/** The round's winner, one of `"TERRORIST"`, `"CT"`, `"draw"`, or `"none"` - a restart. */
	winner: RoundWinner;
	/** Seconds until the next round starts; `5` by default. */
	delay?: number;
	/** The message in the middle of the screen, or a game text such as `"#Terrorists_Win"`; `"default"` is the usual one for this winner, `""` none. */
	message?: string;
	/** The sound, a radio phrase such as `"terwin"`; `"default"` is the usual one for this winner, `""` none. */
	sound?: string;
	/**
	 * `true` to tell the `roundEnd` listeners of every plugin, Pawn ones too, as when
	 * the game ends a round itself. `false` by default: a `roundEnd` listener that
	 * ends the round would call itself.
	 *
	 * Pawn: `rg_round_end(..., trigger)`
	 */
	dispatch?: boolean;
}

/** The game the plugin runs in: its events (reapi hookchains and Ham Sandwich functions), its rules' fields and `endRound`. */
export const game = new Game();

/**
 * The places a message can show: `Variant.chat`, `center`, `console`, `notify`.
 * A plain string works the same - `"center"`; an unknown name goes to chat.
 *
 * Pawn: `print_chat`, `print_center`, `print_console`, `print_notify`
 */
export namespace Variant {
	/** A line in the player's chat. */
	export const chat: string = "chat";
	/** Text in the middle of the player's screen. */
	export const center: string = "center";
	/** A line in the player's console. */
	export const console: string = "console";
	/** A line in the player's console, sent as a notification; with `developer 1` CS also shows it in the top-left corner of the screen. */
	export const notify: string = "notify";
}

/** The place a message shows, as a string: one of `"chat"`, `"center"`, `"console"` or `"notify"`. */
export type VariantName = "chat" | "center" | "console" | "notify";

// Both come from the generator, so neither can fall behind: Flag is every
// ADMIN_* the includes declare, and Event is every forward the host plugin
// relays. They are re-exported here so that a plugin imports one file.
export { Flag } from "./constants";
export * from "./events";

// Re-exporting does not bring a name into this file's own scope, and these
// are used here: `Flag` for a command's default argument, the other two to
// turn an event's short name into the forward the host plugin relays.
import { Flag, FlagName, flagOf, HookName, hookIdOf } from "./constants";
import { Entity, GameFields, PlayerFields } from "./entities";
import {
	MSG_ALL, MSG_ONE, MSG_ONE_UNRELIABLE, MODEL_AUTO, m_iDeaths, m_iTeam, LibType_Library, SPEAK_MUTED, SPEAK_ALL, SPEAK_LISTENALL, CS_T_TERROR, CS_CT_URBAN, CS_DONTCHANGE,
	Ham_CS_RoundRespawn, Ham_CS_Player_ResetMaxSpeed, ARG_ANGLE, ARG_COORD, ARG_STRING
} from "./constants";
export { Entity, Weapon, WeaponKind, weaponKindOf } from "./entities";
// The names an enum field takes and gives: `entity.renderMode = "additive"`.
export {
	RenderMode, RenderFx, MoveType, Solid, TakeDamage, DeadFlag, WaterLevel, Contents, FixAngle, HitGroup,
	ArmorType, ObserverMode, JoinState, GameMenu, PlayerModel, IgnoredChat, ThrowDirection, BloodColor, MonsterState, MusicState
} from "./entities";
import {
	NATIVE_server_cmd, NATIVE_client_cmd, NATIVE_CreateMultiForward, NATIVE_ExecuteForward, get_gametime, get_mapname,
	nvault_open, nvault_set, nvault_remove, rg_round_end, client_print
} from "./natives";
import { ET_IGNORE, ET_STOP, FP_ARRAY, FP_CELL, FP_FLOAT, FP_STRING } from "./constants";
import { ROUND_NONE, ROUND_CTS_WIN, ROUND_TERRORISTS_WIN, ROUND_END_DRAW, print_center } from "./constants";
import { PluginInitEvent, PluginPrecacheEvent, ServerEventMap, addServerListener, removeServerListener } from "./events";

function variantOf(variant: VariantName): number {
	if (variant == Variant.center) return 4;
	if (variant == Variant.console) return 2;
	if (variant == Variant.notify) return 1;
	return 3;
}

/** A message's recipient together with its place: `{ id: 0, variant: "center" }`. `id` is a player's `id`, `0` for everyone. */
export interface Target {
	/** The recipient's player `id`; `0` for every player. */
	id: number;
	/** The place the message shows, one of `"chat"` (the default), `"center"`, `"console"` or `"notify"`. */
	variant?: VariantName;
}

// One letter is one colour everywhere; a place draws the ones it can and
// drops the rest.
/** The colour tags chat draws: `!y` yellow, `!r` red, `!d` grey, `!g` green, `!b` blue, `!t` the reader's team. */
const CHAT_TAGS = "yrdgbt";
/** The colour tags a menu draws: `!y` yellow, `!r` red, `!d` grey, `!w` white, `!R` to the right edge. */
const MENU_TAGS = "yrdwR";

/** Turns a chat line's colour tags (`!g`, `!r`, ...) into the colour codes the client reads, and records in `swapTeam` which team colour the line needs. `print` calls it; exported for tests. */
export function paint(text: string): string {
	swapTeam = "";

	let out = "";

	for (let i = 0; i < text.length; i++) {
		const tag = i + 1 < text.length ? text.charAt(i + 1) : "";

		if (text.charAt(i) != "!" || tag.length == 0 || !(CHAT_TAGS.includes(tag) || MENU_TAGS.includes(tag))) {
			// Not a tag after all: the `!` stands for itself.
			out += text.charAt(i);
			continue;
		}

		i++;

		// A menu's tag (`!w`, `!R`) means nothing in chat: it goes.
		if (!CHAT_TAGS.includes(tag)) continue;

		let code: i32 = 0x03;
		let swap = "";

		if (tag == "g") code = 0x04;
		else if (tag == "y") code = 0x01;
		else if (tag == "t") swap = SENDER_TEAM;
		else if (tag == "r") swap = "TERRORIST";
		else if (tag == "b") swap = "CT";
		else if (tag == "d") swap = "SPECTATOR";

		out += String.fromCharCode(code);

		// The first colour that needs a swap decides it; the rest inherit,
		// because the swap belongs to the message and not to a character.
		if (swap.length > 0 && swapTeam.length == 0) swapTeam = swap;
	}

	return out;
}

function send(id: i32, channel: i32, message: string): void {
	// Chat is the one channel with colours in it; the rest are plain text and
	// go where they always went.
	if (channel != 3) {
		_printClient(id, channel, message);
		return;
	}

	const painted = paint(message);
	_sayText(id, painted, swapTeam);
}

/** The team colour the last `paint()` chose for the line, one of `"TERRORIST"` (red), `"CT"` (blue), `"SPECTATOR"` (grey), or `""` - the reader's own team colour. `print` reads it right after. */
export let swapTeam: string = "";

/** `!t` asks for the sender's own team, which the module fills in. */
const SENDER_TEAM = "";

/**
 * Sends a message to a player, or to every player (`0`).
 *
 * ```ts
 * print(player, "Health restored!");                    // the player's chat
 * print(0, "Round starts in 5 seconds");                // everyone's chat
 * print(player, "Health restored!", "center");          // the middle of the player's screen
 * print({ id: 0, variant: "center" }, "Go!");           // the middle of everyone's screen
 * ```
 *
 * The first argument is a player, a player's `id`, or `0` for everyone. The third
 * is where the message shows, one of `"chat"` (the default), `"center"` - the middle of
 * the screen, `"console"` - the player's console, `"notify"` - the console too; CS
 * shows it on screen only with `developer 1`.
 *
 * Colour tags work in chat only, and a letter is the same colour as in a menu:
 * - `!y` yellow (the usual chat colour), `!g` green
 * - `!r` red, `!b` blue, `!d` grey, `!t` the colour of the reader's team
 *
 * A menu's own tags (`!w`, `!R`) are dropped from a chat line. Red, blue,
 * grey and `!t` share the message's one team colour: the first one used wins.
 *
 * Pawn: `client_print`, `client_print_color`
 */
export function print<T extends Target | Client | number = Target>(to: T, message: string, variant: VariantName = "chat"): void {
	// A player id is a number - an f64, since number is JavaScript's.
	if (isInteger<T>() || isFloat<T>()) {
		send(<i32>to, variantOf(variant), message);
	} else if (isReference<T>() && idof<T>() == idof<Client>()) {
		send(<i32>changetype<Client>(to).id, variantOf(variant), message);
	} else if (isReference<T>() && idof<T>() == idof<Player>()) {
		send(<i32>changetype<Player>(to).id, variantOf(variant), message);
	} else if (isReference<T>() && idof<T>() == idof<Target>()) {
		const target = changetype<Target>(to);
		send(<i32>target.id, variantOf(target.variant ?? "chat"), message);
	} else {
		ERROR("print takes a player, a player id or a target object");
	}
}

/**
 * The server's dictionaries: the files of `data/lang`, a line per key and
 * language, and each player reads them in his own.
 *
 * ```ts
 * lang.load("myplugin");                                        // data/lang/myplugin.txt
 * print(player, lang.translate(player, "MYPLUGIN_WELCOME", [player.name]));
 * ```
 *
 * Pawn: `register_dictionary`, `LookupLangKey`
 */
export namespace lang {
	/**
	 * Loads the dictionary `data/lang/<name>.txt`: `lang.load("myplugin")`.
	 * `false` when there is no such file.
	 *
	 * Pawn: `register_dictionary`
	 */
	export function load(name: string): boolean {
		return register_dictionary(`${name}.txt`) != 0;
	}

	/**
	 * The key's line in the player's language, `null` for the server's:
	 * `lang.translate(player, "MYPLUGIN_WELCOME", [player.name])`.
	 *
	 * `%s`, `%d`, `%f` (`%.1f`, `%02d`, ...) are filled from `args` in order;
	 * one no argument is left for stays as written. The dictionary's colour
	 * codes come back as tags - `\y` as `!y`, `^4` as `!g` - so the line goes
	 * to a menu and to chat alike. A key no dictionary has comes back as it is.
	 *
	 * Pawn: `LookupLangKey`, `format` with `%L`
	 */
	export function translate(player: Client | null, key: string, args: string[] = []): string {
		const found = lookupLang(key, player != null ? <i32>player.id : 0);
		return found.length > 0 ? formatPawn(colorTags(found), new TextCursor(args)) : key;
	}
}

/**
 * Reads and sets a cvar by name in one call: `cvar.num("mp_freezetime")`.
 *
 * For a cvar used more than once `Cvar` is the better choice: it creates a
 * missing cvar, hears its changes and reads it as text, a number or a switch.
 */
export namespace cvar {
	/**
	 * The cvar's value as a whole number: `cvar.num("mp_freezetime")`.
	 *
	 * Pawn: `get_cvar_num`
	 */
	export function num(name: string): number {
		return get_cvar_num(name);
	}

	/**
	 * Sets the cvar to a whole number: `cvar.setNum("mp_freezetime", 5)`.
	 *
	 * Pawn: `set_cvar_num`
	 */
	export function setNum(name: string, value: number): void {
		set_cvar_num(name, value);
	}

	/**
	 * The cvar's value as text: `cvar.str("hostname")`.
	 *
	 * Pawn: `get_cvar_string`
	 */
	export function str(name: string): string {
		return get_cvar_string(name);
	}

	/**
	 * Sets the cvar's text: `cvar.setStr("hostname", "My Server")`.
	 *
	 * Pawn: `set_cvar_string`
	 */
	export function setStr(name: string, value: string): void {
		set_cvar_string(name, value);
	}
}

/**
 * Registers a console command for players; the handler gets the `id` of the
 * player who typed it. `server.addCommand` is the usual way.
 *
 * Pawn: `register_clcmd`
 */
export function cmd(pattern: string, handler: Handler, flag: FlagName = "ALL", info: string = ""): void {
	_clcmd(pattern, hostIndex(handler, false), flagOf(flag), info, SHAPE_NARROW);
}

/**
 * Registers a console command for players whose handler gets the raw
 * arguments `(id, level, cid)`. `handled()` in the handler stops the command
 * from going on to other plugins.
 *
 * Pawn: `register_clcmd`
 */
export function cmdWide(pattern: string, handler: WideHandler, flag: FlagName = "ALL", info: string = ""): void {
	_clcmd(pattern, hostIndex(handler, true), flagOf(flag), info, SHAPE_WIDE);
}

/** The function a timer runs: `() => ...`. */
export type TimerHandler = () => void;

// The timers that are armed, by handle. The host fires a task by calling one
// function with the task's id; that function is timerFired, which calls the
// handler from here - with its closure, which a bare table index would lose.
class Timer {
	constructor(public handler: TimerHandler, public repeat: bool) {}
}

const timers = new Map<i32, Timer>();

function timerFired(handle: i32): void {
	if (!timers.has(handle)) return;
	const timer = timers.get(handle);
	if (!timer.repeat) timers.delete(handle);
	timer.handler();
}

function armTimer(handler: TimerHandler, ms: number, repeat: bool): i32 {
	// The host's task ids are one space for every plugin, and a timer is
	// stopped by its id: the handle comes from the host, so no other plugin
	// has it and clearTimeout here cannot stop a timer there.
	const handle = _uniqueId();
	timers.set(handle, new Timer(handler, repeat));
	// The delay crosses as the bit pattern of a 32-bit float, because a Pawn
	// native takes cells and every signature in the table is all-i on purpose.
	_task(floatCell(ms / 1000.0), timerFired.index, handle, repeat ? 1 : 0);
	return handle;
}

/**
 * Runs `handler` once after `ms` milliseconds and returns the timer's handle,
 * as in the browser:
 *
 * ```ts
 * const handle = setTimeout(() => print(player, "Welcome!"), 2000);
 * clearTimeout(handle);
 * ```
 *
 * The handler may use the variables around it. The precision is one server frame.
 *
 * Pawn: `set_task`
 */
export function setTimeout(handler: TimerHandler, ms: number = 0): number {
	return armTimer(handler, ms, false);
}

/** The options of `sleep()`. */
export interface SleepOptions {
	/** An AbortSignal that cancels the wait: the promise then rejects with the signal's reason. */
	signal?: AbortSignal;
}

/**
 * Returns a promise fulfilled after `ms` milliseconds - the way to wait inside
 * an async function:
 *
 * ```ts
 * await sleep(1000);
 * await sleep(5000, { signal: AbortSignal.timeout(2000) }); // rejects after 2 s
 * ```
 *
 * The precision is one server frame. Inside an async command handler or
 * player event the wait also ends when that player leaves.
 *
 * Pawn: `set_task`
 */
export function sleep(ms: number, options: SleepOptions = {}): Promise<void> {
	return __co_sleep(ms, options.signal ?? null);
}

/**
 * Runs `handler` every `ms` milliseconds until `clearInterval` stops it;
 * returns the timer's handle.
 *
 * Pawn: `set_task` with the "b" flag
 */
export function setInterval(handler: TimerHandler, ms: number): number {
	return armTimer(handler, ms, true);
}

/**
 * Stops the timer with this handle. A timer that has already fired or been
 * stopped is ignored. Only this stops these timers: Pawn's task natives do not
 * see them.
 *
 * Pawn: `remove_task`
 */
export function clearTimeout(handle: number): void {
	if (!timers.has(<i32>handle)) return;
	timers.delete(<i32>handle);
	_stopTask(<i32>handle);
}

/** Stops the interval with this handle; the same as `clearTimeout`. */
export function clearInterval(handle: number): void {
	clearTimeout(handle);
}

// @ts-ignore: decorator
@external("env", "call") declare function _call(id: i32, args: i32, mask: i32, argc: i32): i32;

// WebAssembly fixes an import's arity, so a native with a `...` tail cannot be
// declared in ~/natives at all - only its id is - and the module cannot infer
// the tail's types.
/**
 * A call of a Pawn native with a `...` tail, built one argument at a time -
 * the low-level way. A native from `~/natives` is an ordinary function and
 * needs none of this.
 *
 *   new Call(NATIVE_server_print).str("%s").str(text).run();
 *
 * Find the `...` in the native's declaration. Arguments before it go as they
 * are, with `num` or `str`. A number in the tail goes with `ref`, which passes
 * it by address, and `out(i)` reads back what the native wrote there; a string
 * goes with `str` anywhere.
 *
 *   ExecuteHam(Ham:function, this, any:...)      num, num, then the tail
 *   SetHookChainArg(number, AType:type, any:...) num, num, then the tail
 *   ExecuteForward(handle, &ret, any:...)        num, ref for &ret, then tail
 *
 * A wrong kind of argument fails quietly, somewhere else.
 */
export class Call {
	// Room for eight arguments, doubled whenever a call needs more: a native
	// read on every frame takes two or three, a forward's ExecuteForward 34.
	private args: StaticArray<i32> = new StaticArray<i32>(8);
	private mask: StaticArray<u8> = new StaticArray<u8>(8);
	private cells: StaticArray<i32> = new StaticArray<i32>(8);
	// Strings have to outlive the call, and one shared buffer would have the
	// second overwrite the first. Most calls - a field read - hold none, so
	// the list is made by the first.
	private held: StaticArray<i32>[] | null = null;
	private n: i32 = 0;

	constructor(private id: i32) {}

	/** Keeps an argument's cells alive until the call is done. */
	private hold(cells: StaticArray<i32>): void {
		let held = this.held;
		if (held == null) {
			held = [];
			this.held = held;
		}
		held.push(cells);
	}

	/** Puts an argument and its kind at the next place. */
	private push(value: i32, kind: u8): Call {
		if (this.n == this.args.length) this.grow();
		unchecked(this.args[this.n] = value);
		unchecked(this.mask[this.n] = kind);
		this.n++;
		return this;
	}

	// A `ref` argument is an address inside `cells`, so it moves with it.
	private grow(): void {
		const size = this.n * 2;
		const args = new StaticArray<i32>(size);
		const mask = new StaticArray<u8>(size);
		const cells = new StaticArray<i32>(size);
		for (let i = 0; i < this.n; i++) {
			const ref = unchecked(this.mask[i]) == REF;
			unchecked(args[i] = ref ? changetype<i32>(cells) + i * 4 : unchecked(this.args[i]));
			unchecked(mask[i] = unchecked(this.mask[i]));
			unchecked(cells[i] = unchecked(this.cells[i]));
		}
		this.args = args;
		this.mask = mask;
		this.cells = cells;
	}

	/** Adds a number argument as it is: an entity index, a constant, a count. */
	num(value: number): Call {
		return this.push(<i32>value, 0x6e); // n
	}

	/** Adds a fractional number argument, one the native declares as `Float:`. */
	float(value: f64): Call {
		return this.num(reinterpret<i32>(<f32>value));
	}

	/** Adds a string argument, before the `...` or in the tail alike. */
	str(text: string): Call {
		const buffer = __cellsOf(text);
		this.hold(buffer);
		return this.push(changetype<i32>(buffer), 0x73); // s
	}

	/** Adds an array of cells the native reads and may write into, followed by its length. */
	buffer(cells: CellBuffer, length: number): Call {
		return this.push(cells.address, 0x62).num(length); // b
	}

	/**
	 * Adds an array of cells the native writes into, in a `...` tail: its length
	 * follows by address, as a tail's numbers do - `get_member(id, member,
	 * dest[], len)`.
	 */
	tailBuffer(cells: CellBuffer, length: number): Call {
		return this.push(cells.address, 0x62).ref(length); // b
	}

	/** Adds a vector: three fractional numbers at one address - an origin, angles, a colour. Unlike `buffer`, no length follows it. */
	vec(x: f64, y: f64, z: f64): Call {
		const cells = new StaticArray<i32>(3);
		unchecked(cells[0] = reinterpret<i32>(<f32>x));
		unchecked(cells[1] = reinterpret<i32>(<f32>y));
		unchecked(cells[2] = reinterpret<i32>(<f32>z));
		this.hold(cells);
		return this.push(changetype<i32>(cells), 0x76); // v
	}

	/** Adds a vector the native fills in; after `run` the result is in `cells`. */
	vecInto(cells: CellBuffer): Call {
		return this.push(cells.address, 0x76); // v
	}

	/**
	 * Adds an array to a forward's `...` tail: `ExecuteForward` gets it as
	 * `PrepareArray` makes it. `floats` sends the numbers as `Float:`.
	 */
	array(values: number[], floats: bool = false): Call {
		const cells = arrayCells(values, floats);
		this.hold(cells);
		return this.push(changetype<i32>(cells), 0x61); // a
	}

	/** Adds a number passed by address, as a `...` tail argument must be; `out` reads what the native wrote into it. */
	ref(value: number): Call {
		if (this.n == this.args.length) this.grow();
		unchecked(this.cells[this.n] = <i32>value);
		return this.push(changetype<i32>(this.cells) + this.n * 4, REF);
	}

	/** The value the native left in the `ref` argument at this position, after `run`. */
	out(index: i32): number {
		return unchecked(this.cells[index]);
	}

	/** Calls the native with the arguments added so far and returns its result. */
	run(): number {
		return _call(this.id, changetype<i32>(this.args), changetype<i32>(this.mask), this.n);
	}
}

/** A Call argument's kind: a number passed by address. */
const REF: u8 = 0x72; // r

/** An array as the module reads one for a forward: its count, then its cells. */
function arrayCells(values: number[], floats: bool): StaticArray<i32> {
	const cells = new StaticArray<i32>(values.length + 1);
	unchecked(cells[0] = values.length);
	for (let i = 0; i < values.length; i++) unchecked(cells[i + 1] = floats ? reinterpret<i32>(<f32>unchecked(values[i])) : <i32>unchecked(values[i]));
	return cells;
}

// ---------------------------------------------------------------- field natives

// What a field of reapi's field natives - get_entvar, get_member, get_pmove -
// holds, as the generated __<native>_kind tables of ~/natives say
// (scripts/generate-wasm-api.ts): a whole number, a Float, a vector or text,
// and FIELD_ELEMENT on top for an array member.
const FIELD_FLOAT: i32 = 1;
const FIELD_VECTOR: i32 = 2;
const FIELD_STRING: i32 = 3;
const FIELD_ELEMENT: i32 = 4;

/** The longest text a field native writes back: reapi's longest member holds 256 bytes. */
const FIELD_TEXT: i32 = 1024;

/** The type a field of this kind reads as - what `T` has to be. */
function fieldType(kind: i32): string {
	const base = kind & 3;
	return base == FIELD_VECTOR ? "Vector" : base == FIELD_STRING ? "string" : "number";
}

/** Whether T is what a field of this kind reads as; says so in the console when it is not. */
function fieldTakes<T>(kind: i32, native: string): bool {
	const base = kind & 3;
	const vector = isArray<T>() || isVector<T>();
	const fits = isString<T>() ? base == FIELD_STRING : vector ? base == FIELD_VECTOR : base < FIELD_VECTOR;
	if (!fits) console.error(`${native}: this field is a ${fieldType(kind)} - write ${native}<${fieldType(kind)}>(...)`);
	return fits;
}

/**
 * @hidden A field of a reapi field native, as T: a whole number or a Float
 * as a number (or a boolean), a vector as a Vector, text as a string. A T the
 * field is not reads as nothing, and the console says which one to write.
 */
export function __getField<T>(call: Call, kind: i32, element: number, native: string): T {
	if (isString<T>()) {
		if (!fieldTakes<T>(kind, native)) return changetype<T>("");
		const text = new CellBuffer(FIELD_TEXT);
		call.tailBuffer(text, FIELD_TEXT - 1);
		if (kind & FIELD_ELEMENT) call.ref(element);
		call.run();
		return changetype<T>(text.text());
	}
	if (isReference<T>()) {
		// A Vector, or number[] it is one of.
		if (!fieldTakes<T>(kind, native)) return changetype<T>(new Vector());
		const cells = new CellBuffer(3);
		call.vecInto(cells);
		if (kind & FIELD_ELEMENT) call.ref(element);
		call.run();
		return changetype<T>(new Vector(cells.float(0), cells.float(1), cells.float(2)));
	}
	if (!isFloat<T>() && !isInteger<T>()) ERROR("a field reads as number, boolean, string or Vector");
	if (!fieldTakes<T>(kind, native)) return <T>0;
	if (kind & FIELD_ELEMENT) call.ref(element);
	const cell = <i32>call.run();
	if (isBoolean<T>()) return <T>(cell != 0);
	return <T>((kind & 3) == FIELD_FLOAT ? cellFloat(cell) : <f64>cell);
}

/**
 * @hidden Writes a field of a reapi field native from a value of its kind:
 * a number - a Float where the field is one - a boolean, a vector (a Vector or
 * any three numbers), text. A value of another kind writes nothing, and the
 * console says so. The native's result: 1 when it wrote.
 */
export function __setField<T>(call: Call, kind: i32, value: T, element: number, native: string): number {
	if (!fieldTakes<T>(kind, native)) return 0;
	if (isString<T>()) {
		call.str(changetype<string>(value));
	} else if (isArray<T>()) {
		const vector = changetype<number[]>(value);
		call.vec(vector[0], vector[1], vector[2]);
	} else if (isBoolean<T>()) {
		call.ref(value ? 1 : 0);
	} else {
		call.ref((kind & 3) == FIELD_FLOAT ? floatCell(<f64>value) : <i32>value);
	}
	if (kind & FIELD_ELEMENT) call.ref(element);
	return call.run();
}

// @ts-ignore: decorator
@external("env", "hook") declare function _hook(id: i32, fn: i32, post: i32): i32;
// @ts-ignore: decorator
@external("env", "ham")  declare function _ham(id: i32, entityClass: string, fn: i32, post: i32): i32;

/**
 * Registers a reapi hookchain with a raw handler of four numbers - the low
 * level under `game.addEventListener`, which is what a plugin uses.
 *
 * The name is reapi's, without the class where it is not needed:
 * `"restart_round"`, `"player_spawn"`; the editor completes them. The numbers
 * behind the names come from reapi's includes, so they must be the ones of the
 * reapi the server runs. Returns the hook's handle.
 *
 * Pawn: `RegisterHookChain`, `EnableHookChain`, `DisableHookChain`
 */
export function hook(name: HookName, handler: WideHandler, post: bool = false): number {
	const id = hookIdOf(name);

	if (id < 0) {
		console.error(`no hookchain named "${name}"`);
		return 0;
	}

	return _hook(id, hostIndex(handler, true), post ? 1 : 0);
}

// AMX Mod X has one entry per .amxx file and every plugin here shares the
// host's, so this is the only place their names exist.
/** The plugin's name, version, author and description, given to `plugin({ ... })`; `amxts_plugins` in the server console lists them. */
export interface PluginInfo {
	/** The plugin's name, e.g. `"My Plugin"`. */
	name: string;
	/** The plugin's version, e.g. `"1.0.0"`. */
	version: string;
	/** The plugin's author. */
	author: string;
	/** The plugin's description, in one line. */
	description?: string;
	/**
	 * The Pawn include whose natives the plugin implements, e.g. `"myplugin.inc"`, from
	 * `includes/` or beside the plugin. Each exported function reaches Pawn as the
	 * include declares it, and Pawn plugins use that include.
	 */
	include?: string;
}

/**
 * Declares the plugin: its name, version, author and description, as the
 * server's plugin list shows them. Called once, at the top level:
 *
 * ```ts
 * plugin({ name: "Hello", version: "1.0.0", author: "you", description: "An example" });
 * ```
 *
 * `include` names the Pawn include whose natives the plugin implements.
 *
 * Pawn: `register_plugin`
 */
export function plugin(info: PluginInfo): void {
	_plugin(info.name, info.version, info.author, info.description ?? "");
}

// ---------------------------------------------------------------- modules

/**
 * The modules' settings in `amxts.config.ts`, each under its module's `configKey`.
 * Empty here: a module adds its key by augmenting this interface in
 * `"@amxts/core"` - `menus?: Partial<MenuCoreOptions>` - and the editor checks
 * the config against it.
 */
export interface ModuleOptions {}

/**
 * Defines a module: `export default defineModule<Options>({ meta, requires,
 * defaults, setup })` in its module file. `setup` runs once,
 * when the server loads the module, with `defaults` and what `amxts.config.ts`
 * sets over them. Global; `import { defineModule } from "@amxts/core"` works too.
 */
// @ts-ignore: decorator
@global export function defineModule<T>(definition: AmxtsModule<T>): AmxtsModule<T> {
	return definition;
}

// ---------------------------------------------------------------- forwards

// @ts-ignore: decorator
@external("env", "subscribe")  declare function _subscribe(forward: string, fn: i32, tag: i32): void;
// @ts-ignore: decorator
@external("env", "emit_local") declare function _emitLocal(forward: string, mask: string, cells: i32, count: i32): void;

// @ts-ignore: decorator
@external("env", "nvault_lookup") declare function _nvaultLookup(vault: i32, key: i32, value: i32, maxlen: i32, timestamp: i32): i32;

/**
 * The forward's stopping rule, one of: `"never"` - every plugin hears it, whatever it
 * returns; `"handled"` - the first plugin that says it handled the forward
 * stops it.
 *
 * Pawn: `ET_IGNORE`, `ET_STOP`
 */
export type ForwardStop = "never" | "handled";

/** A placeholder for an unused type argument of `Forward`: `Forward<number>` has one argument. */
export class NoArgument {}

function isArgument<T>(): bool {
	return !(isReference<T>() && !isString<T>() && nameof<T>() == "NoArgument");
}

/**
 * How a Forward's argument crosses, as the build read it off the forward's
 * Pawn declaration or its type (scripts/plugin-natives.ts, crossForwards): one
 * letter per argument - `t` a Team as its TeamName number, `w` a RoundWinner
 * as its WinStatus number, `f` a number as a Float, `F` an array of numbers as
 * Floats, `_` (or nothing) as its type says.
 */
const CROSS_TEAM = "t";
const CROSS_WINNER = "w";
const CROSS_FLOAT = "f";
const CROSS_FLOATS = "F";

/** The most arguments an AMX Mod X forward takes (FORWARD_MAX_PARAMS), and so a Forward. */
const MAX_FORWARD_ARGS: i32 = 32;

/** WinStatus by number: WINSTATUS_NONE 0, CTS 1, TERRORISTS 2, DRAW 3. */
const WINNER_NAMES: RoundWinner[] = ["none", "CT", "TERRORIST", "draw"];

/** The reason a round ends with, by WinStatus number: rg_round_end's `event`. */
const ROUND_REASONS: i32[] = [ROUND_NONE, ROUND_CTS_WIN, ROUND_TERRORISTS_WIN, ROUND_END_DRAW];

// The game's message and radio phrase for a round's end, by WinStatus
// number: what rg_round_end's "default" stands for.
const ROUND_MESSAGES: string[] = ["", "#CTs_Win", "#Terrorists_Win", "#Round_Draw"];
const ROUND_SOUNDS: string[] = ["", "ctwin", "terwin", "rounddraw"];

/** A radio phrase to everyone, as the game broadcasts the round's end. */
function broadcastAudio(sample: string): void {
	message_begin(MSG_ALL, get_user_msgid("SendAudio"), [0, 0, 0], 0);
	write_byte(0);
	write_string(sample);
	write_short(100);
	message_end();
}

/** A name that crosses as a number - a Team or a RoundWinner - as that number. */
function nameCell(name: string, crossing: string): i32 {
	if (crossing == CROSS_WINNER) return max(WINNER_NAMES.indexOf(name as RoundWinner), 0);
	return teamCell(name);
}

/** The other way: a number a subscriber received, as the name. */
function nameOfCell(cell: i32, crossing: string): string {
	if (crossing == CROSS_WINNER) return cell >= 0 && cell < WINNER_NAMES.length ? WINNER_NAMES[cell] : "none";
	return cell >= 0 && cell < TEAM_NAMES.length ? TEAM_NAMES[cell] : "UNASSIGNED";
}

/** Whether the argument is a name that crosses as a number. */
function crossesAsNumber(crossing: string): bool {
	return crossing == CROSS_TEAM || crossing == CROSS_WINNER;
}

/** A team's TeamName number: TEAM_UNASSIGNED 0, TERRORIST 1, CT 2, SPECTATOR 3. */
function teamCell(team: string): i32 {
	return max(TEAM_NAMES.indexOf(team as Team), 0);
}

/** The crossing letter of the argument at `index`; `_` past the end. */
function crossingAt(crossing: string, index: i32): string {
	return index < crossing.length ? crossing.charAt(index) : "_";
}

/** Whether a Forward's argument of type T is a Vector: three Floats, whatever the declaration. */
function isVector<T>(): bool {
	return isReference<T>() && !isString<T>() && nameof<T>() == "Vector";
}

/** Whether an array argument of type T crosses as Floats. */
function crossesAsFloats<T>(crossing: string): bool {
	return isVector<T>() || crossing == CROSS_FLOATS;
}

/** The FP_* constant for a forward argument of type T. */
function forwardParam<T>(crossing: string): i32 {
	// A plugin's number is an f64, but what a forward carries is a Pawn cell -
	// a round end's status and every forward like it. Declaring it Float
	// handed Pawn plugins the bits of a double where they read a whole number,
	// so a Float is only what the declaration, or the type Float, says is one.
	if (isArray<T>()) return FP_ARRAY;
	if (crossing == CROSS_FLOAT) return FP_FLOAT;
	if (crossesAsNumber(crossing)) return FP_CELL;
	if (isString<T>()) return FP_STRING;
	return FP_CELL;
}

/** The value an unused argument stands at: null for a reference, 0 for the rest. */
function zeroOf<T>(): T {
	if (isReference<T>()) return changetype<T>(0);
	return <T>0;
}

/** CreateMultiForward's FP_* for the argument at `index`, when T is one. */
function declareArgument<T>(call: Call, crossing: string, index: i32): void {
	if (isArgument<T>()) call.ref(forwardParam<T>(crossingAt(crossing, index)));
}

/** A number, a boolean, a Player or a name as the cell Pawn gets. */
function cellOf<T>(value: T, crossing: string): i32 {
	if (isString<T>()) return nameCell(changetype<string>(value), crossing);
	if (isReference<T>()) return nameof<T>() == "Player" && value ? changetype<Player>(value).id : 0;
	if (isBoolean<T>()) return value ? 1 : 0;
	if (crossing == CROSS_FLOAT) return reinterpret<i32>(<f32>value);
	return <i32>value;
}

/**
 * What an emit hands the module for this server's TypeScript subscribers
 * (emit_local): a cell and a letter per argument - `n` a cell, `s` a string,
 * `a` an array as arrayCells lays it out.
 */
class LocalArguments {
	cells: StaticArray<i32> = new StaticArray<i32>(MAX_FORWARD_ARGS);
	mask: string = "";
	count: i32 = 0;
	// The arrays have to outlive the call, as a Call's do.
	private held: StaticArray<i32>[] = [];

	add(cell: i32, kind: string): void {
		unchecked(this.cells[this.count++] = cell);
		this.mask += kind;
	}

	array(cells: StaticArray<i32>): void {
		this.held.push(cells);
		this.add(changetype<i32>(cells), "a");
	}
}

/**
 * The argument at `index` of an emit: onto ExecuteForward's call the way it
 * wants it - a number by address, a string, an array PrepareArray makes - and
 * into what this server's TypeScript subscribers get. Each branch is decided
 * as it compiles, so only the one for T is built.
 */
function sendArgument<T>(call: Call, local: LocalArguments, value: T, crossing: string, index: i32): void {
	if (!isArgument<T>()) return;
	const cross = crossingAt(crossing, index);

	if (isArray<T>()) {
		// @ts-ignore: valueof is AssemblyScript's
		if (!isFloat<valueof<T>>()) ERROR("a Forward's array argument is number[] or a Vector");
		const values = changetype<number[]>(value);
		const floats = crossesAsFloats<T>(cross);
		call.array(values, floats);
		local.array(arrayCells(values, floats));
		return;
	}
	if (isString<T>() && !crossesAsNumber(cross)) {
		call.str(changetype<string>(value));
		local.add(changetype<i32>(value), "s");
		return;
	}
	const cell = cellOf<T>(value, cross);
	call.ref(cell);
	local.add(cell, "n");
}

/** The argument at `index` of the forward being delivered, as T - read from the running call (the module's CallArgs). */
function argumentOf<T>(crossing: string, index: i32): T {
	if (!isArgument<T>()) return zeroOf<T>();
	const cross = crossingAt(crossing, index);

	if (isString<T>()) {
		if (crossesAsNumber(cross)) return changetype<T>(nameOfCell(__nativeCell(index), cross));
		return changetype<T>(__nativeString(index));
	}
	// A reference's branches are chosen as it runs, so they stay among references.
	if (isReference<T>()) {
		if (isVector<T>()) return changetype<T>(__nativeVector(index));
		if (isArray<T>()) return changetype<T>(__forwardNumbers(index, crossesAsFloats<T>(cross)));
		return nameof<T>() == "Player" ? changetype<T>(new Player(__nativeCell(index))) : changetype<T>(0);
	}
	if (isBoolean<T>()) return <T>(__nativeCell(index) != 0);
	if (isFloat<T>() && cross == CROSS_FLOAT) return <T>reinterpret<f32>(__nativeCell(index));
	return <T>__nativeCell(index);
}

/** What subscribe() hangs on: a Forward, reached by its tag - see forwardTrampoline. */
abstract class ForwardListener {
	abstract deliver(): void;
}

/** Every Forward of this plugin that has subscribers; a Forward's tag is its index. */
const subscribedForwards: ForwardListener[] = [];

/**
 * What the module calls for a forward someone subscribed to.
 *
 * One function for every Forward: a trampoline cannot capture the Forward it
 * belongs to, so the module hands back the tag subscribe() gave it, and the
 * Forward reads its arguments by its own type arguments.
 */
function forwardTrampoline(tag: i32): void {
	if (tag >= 0 && tag < subscribedForwards.length) subscribedForwards[tag].deliver();
}

/**
 * A forward other plugins listen to, Pawn and TypeScript alike. Its arguments
 * are its type parameters, up to 32 - as many as AMX Mod X gives a forward:
 *
 * ```ts
 * const roundStart = new Forward("myplugin_on_round_start");
 * const roundEnd = new Forward<RoundWinner>("myplugin_on_round_end");
 * const configChanged = new Forward<string, string>("myplugin_on_config_changed");
 *
 * roundStart.emit();
 * roundEnd.emit(winner);
 * configChanged.emit(id, value);
 *
 * const swapped = new Forward<Player, Player>("myplugin_on_player_swapped");
 * swapped.emit(catcher, caught);              // Pawn gets their ids
 * ```
 *
 * A Pawn plugin listens with `public myplugin_on_round_end(winner)`, as usual;
 * a TypeScript plugin with `subscribe(handler)`. A number, a boolean and a
 * Player (its `id`) reach Pawn as numbers, a `Float` as a Float, a string as
 * a string, a `number[]` or a `Vector` as an array. A `Team` or a
 * `RoundWinner` goes as Pawn's number where an include declares the forward
 * with that tag; a `Team` for a forward no include declares is a build error.
 *
 * The forward is created on its first emit, or earlier by `create()` - once
 * every plugin has loaded (`plugin_cfg` or later), or those loaded after it
 * would not hear it.
 *
 * Pawn: `CreateMultiForward`, `ExecuteForward`
 */
export class Forward<T1 = NoArgument, T2 = NoArgument, T3 = NoArgument, T4 = NoArgument, T5 = NoArgument, T6 = NoArgument, T7 = NoArgument, T8 = NoArgument, T9 = NoArgument, T10 = NoArgument, T11 = NoArgument, T12 = NoArgument, T13 = NoArgument, T14 = NoArgument, T15 = NoArgument, T16 = NoArgument, T17 = NoArgument, T18 = NoArgument, T19 = NoArgument, T20 = NoArgument, T21 = NoArgument, T22 = NoArgument, T23 = NoArgument, T24 = NoArgument, T25 = NoArgument, T26 = NoArgument, T27 = NoArgument, T28 = NoArgument, T29 = NoArgument, T30 = NoArgument, T31 = NoArgument, T32 = NoArgument> extends ForwardListener {
	/** The forward's stopping rule, one of `"never"` (the default) or `"handled"`. Set it before the first emit. */
	stopWhen: ForwardStop = "never";

	private handle: i32 = -1;
	private tag: i32 = -1;
	private handlers: ((a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7, a8: T8, a9: T9, a10: T10, a11: T11, a12: T12, a13: T13, a14: T14, a15: T15, a16: T16, a17: T17, a18: T18, a19: T19, a20: T20, a21: T21, a22: T22, a23: T23, a24: T24, a25: T25, a26: T26, a27: T27, a28: T28, a29: T29, a30: T30, a31: T31, a32: T32) => void)[] = [];

	/**
	 * @param name The forward's name, as Pawn plugins hook it.
	 * @param crossing @internal Written by the build from the forward's Pawn
	 * declaration in an include, or its types; a plugin leaves it out.
	 */
	constructor(
		/** The forward's name, as Pawn plugins listen to it. */
		public name: string,
		private crossing: string = ""
	) {
		super();
	}

	/**
	 * Calls `handler` each time the forward is emitted - by this plugin, another
	 * TypeScript plugin or a Pawn plugin:
	 *
	 * ```ts
	 * const greeted = new Forward<string, number>("showcase_on_greeted");
	 * greeted.subscribe((name, count) => console.log(`${name}: ${count}`));
	 * ```
	 *
	 * The handler's parameters take the forward's types; a named function may
	 * take fewer of them. A forward created by a Pawn plugin reaches TypeScript
	 * only when one of the amxts host plugin's includes declares it; one emitted
	 * from TypeScript reaches every subscriber.
	 */
	subscribe(handler: (a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7, a8: T8, a9: T9, a10: T10, a11: T11, a12: T12, a13: T13, a14: T14, a15: T15, a16: T16, a17: T17, a18: T18, a19: T19, a20: T20, a21: T21, a22: T22, a23: T23, a24: T24, a25: T25, a26: T26, a27: T27, a28: T28, a29: T29, a30: T30, a31: T31, a32: T32) => void): void {
		if (this.tag < 0) {
			this.tag = subscribedForwards.length;
			subscribedForwards.push(this);
			_subscribe(this.name, forwardTrampoline.index, this.tag);
		}
		this.handlers.push(handler);
	}

	/** Stops calling a handler given to `subscribe()`. */
	unsubscribe(handler: (a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7, a8: T8, a9: T9, a10: T10, a11: T11, a12: T12, a13: T13, a14: T14, a15: T15, a16: T16, a17: T17, a18: T18, a19: T19, a20: T20, a21: T21, a22: T22, a23: T23, a24: T24, a25: T25, a26: T26, a27: T27, a28: T28, a29: T29, a30: T30, a31: T31, a32: T32) => void): void {
		const at = this.handlers.indexOf(handler);
		if (at >= 0) this.handlers.splice(at, 1);
	}

	/** Passes the forward's arguments to every `subscribe()` handler; the server calls it, not a plugin. */
	deliver(): void {
		const a1 = argumentOf<T1>(this.crossing, 0);
		const a2 = argumentOf<T2>(this.crossing, 1);
		const a3 = argumentOf<T3>(this.crossing, 2);
		const a4 = argumentOf<T4>(this.crossing, 3);
		const a5 = argumentOf<T5>(this.crossing, 4);
		const a6 = argumentOf<T6>(this.crossing, 5);
		const a7 = argumentOf<T7>(this.crossing, 6);
		const a8 = argumentOf<T8>(this.crossing, 7);
		const a9 = argumentOf<T9>(this.crossing, 8);
		const a10 = argumentOf<T10>(this.crossing, 9);
		const a11 = argumentOf<T11>(this.crossing, 10);
		const a12 = argumentOf<T12>(this.crossing, 11);
		const a13 = argumentOf<T13>(this.crossing, 12);
		const a14 = argumentOf<T14>(this.crossing, 13);
		const a15 = argumentOf<T15>(this.crossing, 14);
		const a16 = argumentOf<T16>(this.crossing, 15);
		const a17 = argumentOf<T17>(this.crossing, 16);
		const a18 = argumentOf<T18>(this.crossing, 17);
		const a19 = argumentOf<T19>(this.crossing, 18);
		const a20 = argumentOf<T20>(this.crossing, 19);
		const a21 = argumentOf<T21>(this.crossing, 20);
		const a22 = argumentOf<T22>(this.crossing, 21);
		const a23 = argumentOf<T23>(this.crossing, 22);
		const a24 = argumentOf<T24>(this.crossing, 23);
		const a25 = argumentOf<T25>(this.crossing, 24);
		const a26 = argumentOf<T26>(this.crossing, 25);
		const a27 = argumentOf<T27>(this.crossing, 26);
		const a28 = argumentOf<T28>(this.crossing, 27);
		const a29 = argumentOf<T29>(this.crossing, 28);
		const a30 = argumentOf<T30>(this.crossing, 29);
		const a31 = argumentOf<T31>(this.crossing, 30);
		const a32 = argumentOf<T32>(this.crossing, 31);
		// A copy: a handler that unsubscribes itself must not make the next one skip.
		const handlers = this.handlers.slice(0);
		for (let i = 0; i < handlers.length; i++) {
			handlers[i](a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30, a31, a32);
		}
	}

	/**
	 * Creates the forward now rather than on its first emit; later calls do nothing.
	 *
	 * Pawn: `CreateMultiForward`
	 */
	create(): void {
		if (this.handle >= 0) return;

		const call = new Call(NATIVE_CreateMultiForward)
			.str(this.name)
			.num(this.stopWhen == "handled" ? ET_STOP : ET_IGNORE);
		declareArgument<T1>(call, this.crossing, 0);
		declareArgument<T2>(call, this.crossing, 1);
		declareArgument<T3>(call, this.crossing, 2);
		declareArgument<T4>(call, this.crossing, 3);
		declareArgument<T5>(call, this.crossing, 4);
		declareArgument<T6>(call, this.crossing, 5);
		declareArgument<T7>(call, this.crossing, 6);
		declareArgument<T8>(call, this.crossing, 7);
		declareArgument<T9>(call, this.crossing, 8);
		declareArgument<T10>(call, this.crossing, 9);
		declareArgument<T11>(call, this.crossing, 10);
		declareArgument<T12>(call, this.crossing, 11);
		declareArgument<T13>(call, this.crossing, 12);
		declareArgument<T14>(call, this.crossing, 13);
		declareArgument<T15>(call, this.crossing, 14);
		declareArgument<T16>(call, this.crossing, 15);
		declareArgument<T17>(call, this.crossing, 16);
		declareArgument<T18>(call, this.crossing, 17);
		declareArgument<T19>(call, this.crossing, 18);
		declareArgument<T20>(call, this.crossing, 19);
		declareArgument<T21>(call, this.crossing, 20);
		declareArgument<T22>(call, this.crossing, 21);
		declareArgument<T23>(call, this.crossing, 22);
		declareArgument<T24>(call, this.crossing, 23);
		declareArgument<T25>(call, this.crossing, 24);
		declareArgument<T26>(call, this.crossing, 25);
		declareArgument<T27>(call, this.crossing, 26);
		declareArgument<T28>(call, this.crossing, 27);
		declareArgument<T29>(call, this.crossing, 28);
		declareArgument<T30>(call, this.crossing, 29);
		declareArgument<T31>(call, this.crossing, 30);
		declareArgument<T32>(call, this.crossing, 31);
		this.handle = call.run();
	}

	/**
	 * Sends the forward to every plugin that listens to it; `true` if it went out.
	 *
	 * Pawn: `ExecuteForward`
	 */
	emit(
		a1: T1 = zeroOf<T1>(),
		a2: T2 = zeroOf<T2>(),
		a3: T3 = zeroOf<T3>(),
		a4: T4 = zeroOf<T4>(),
		a5: T5 = zeroOf<T5>(),
		a6: T6 = zeroOf<T6>(),
		a7: T7 = zeroOf<T7>(),
		a8: T8 = zeroOf<T8>(),
		a9: T9 = zeroOf<T9>(),
		a10: T10 = zeroOf<T10>(),
		a11: T11 = zeroOf<T11>(),
		a12: T12 = zeroOf<T12>(),
		a13: T13 = zeroOf<T13>(),
		a14: T14 = zeroOf<T14>(),
		a15: T15 = zeroOf<T15>(),
		a16: T16 = zeroOf<T16>(),
		a17: T17 = zeroOf<T17>(),
		a18: T18 = zeroOf<T18>(),
		a19: T19 = zeroOf<T19>(),
		a20: T20 = zeroOf<T20>(),
		a21: T21 = zeroOf<T21>(),
		a22: T22 = zeroOf<T22>(),
		a23: T23 = zeroOf<T23>(),
		a24: T24 = zeroOf<T24>(),
		a25: T25 = zeroOf<T25>(),
		a26: T26 = zeroOf<T26>(),
		a27: T27 = zeroOf<T27>(),
		a28: T28 = zeroOf<T28>(),
		a29: T29 = zeroOf<T29>(),
		a30: T30 = zeroOf<T30>(),
		a31: T31 = zeroOf<T31>(),
		a32: T32 = zeroOf<T32>()
	): boolean {
		this.create();
		if (this.handle < 0) return false;

		const call = new Call(NATIVE_ExecuteForward).num(this.handle).ref(0);
		const local = new LocalArguments();
		sendArgument<T1>(call, local, a1, this.crossing, 0);
		sendArgument<T2>(call, local, a2, this.crossing, 1);
		sendArgument<T3>(call, local, a3, this.crossing, 2);
		sendArgument<T4>(call, local, a4, this.crossing, 3);
		sendArgument<T5>(call, local, a5, this.crossing, 4);
		sendArgument<T6>(call, local, a6, this.crossing, 5);
		sendArgument<T7>(call, local, a7, this.crossing, 6);
		sendArgument<T8>(call, local, a8, this.crossing, 7);
		sendArgument<T9>(call, local, a9, this.crossing, 8);
		sendArgument<T10>(call, local, a10, this.crossing, 9);
		sendArgument<T11>(call, local, a11, this.crossing, 10);
		sendArgument<T12>(call, local, a12, this.crossing, 11);
		sendArgument<T13>(call, local, a13, this.crossing, 12);
		sendArgument<T14>(call, local, a14, this.crossing, 13);
		sendArgument<T15>(call, local, a15, this.crossing, 14);
		sendArgument<T16>(call, local, a16, this.crossing, 15);
		sendArgument<T17>(call, local, a17, this.crossing, 16);
		sendArgument<T18>(call, local, a18, this.crossing, 17);
		sendArgument<T19>(call, local, a19, this.crossing, 18);
		sendArgument<T20>(call, local, a20, this.crossing, 19);
		sendArgument<T21>(call, local, a21, this.crossing, 20);
		sendArgument<T22>(call, local, a22, this.crossing, 21);
		sendArgument<T23>(call, local, a23, this.crossing, 22);
		sendArgument<T24>(call, local, a24, this.crossing, 23);
		sendArgument<T25>(call, local, a25, this.crossing, 24);
		sendArgument<T26>(call, local, a26, this.crossing, 25);
		sendArgument<T27>(call, local, a27, this.crossing, 26);
		sendArgument<T28>(call, local, a28, this.crossing, 27);
		sendArgument<T29>(call, local, a29, this.crossing, 28);
		sendArgument<T30>(call, local, a30, this.crossing, 29);
		sendArgument<T31>(call, local, a31, this.crossing, 30);
		sendArgument<T32>(call, local, a32, this.crossing, 31);
		const sent = call.run() != 0;

		// TypeScript subscribers, which AMX Mod X reaches only through a host
		// public - the module skips the forwards it has one for.
		_emitLocal(this.name, local.mask, changetype<i32>(local.cells), local.count);
		return sent;
	}
}

// ---------------------------------------------------------------- storage

/**
 * A key-to-text store on disk: a Map that survives a map change and a server
 * restart.
 *
 * ```ts
 * const demos = new Storage("core_demo_counters");
 * const last = demos.get(auth);      // string | null
 * demos.set(auth, "3");
 * if (demos.has(auth)) ...
 * demos.delete(auth);
 * ```
 *
 * The file is named after the storage, kept in the `vault` folder of the AMX
 * Mod X data folder, and opened on first use. Values are text: a number goes
 * in with `toString()` and comes out with `parseInt`.
 *
 * Pawn: `nvault_open`, `nvault_get`, `nvault_set`, `nvault_remove`
 */
export class Storage {
	private vault: i32 = -1;

	constructor(
		/** The storage's name, which is also its file's name. */
		public name: string
	) {}

	/** The value under `key`, or `null` when there is none. */
	get(key: string): string | null {
		const vault = this.open();
		if (vault < 0) return null;

		const value = new CellBuffer(TEXT_MAX + 1);
		const stamp = new CellBuffer(1);

		// nvault_lookup rather than nvault_get: the length of nvault_get's
		// buffer rides in its `...` tail by address, which the dispatcher's
		// buffer argument cannot say; nvault_lookup takes it as a plain
		// argument, and answers whether the key exists besides.
		const found = _nvaultLookup(vault, changetype<i32>(__cellsOf(key)), value.address, TEXT_MAX, stamp.address);
		return found != 0 ? value.text() : null;
	}

	/** Puts `value` under `key`, replacing what was there. */
	set(key: string, value: string): void {
		const vault = this.open();
		if (vault >= 0) nvault_set(vault, key, value);
	}

	/** `true` when there is a value under `key`. */
	has(key: string): boolean {
		return this.get(key) != null;
	}

	/** Removes `key` and its value; a key that is not there is ignored. */
	delete(key: string): void {
		const vault = this.open();
		if (vault >= 0) nvault_remove(vault, key);
	}

	private open(): i32 {
		if (this.vault < 0) this.vault = nvault_open(this.name);
		return this.vault;
	}
}

// Flag enums and the array that stands for a mask - generated, see scripts/generate-flags.ts.
export * from "./flags";
import { Access, ACCESS, HIDE_HUD, HideHud } from "./flags";

// Hookchain events and game.addEventListener's hood - generated, see scripts/generate-hooks.ts.
export * from "./hooks";
import { GameAnswerMap, GameEventMap, addGameListener, removeGameListener } from "./hooks";

// Three numbers with vector math - what entity.origin and the rest return.
export * from "./vector";
export * from "./effects";
// fetch, URL and useFetch, over the module's network client.
export * from "./fetch";
export { EntityFilter } from "./entities";

// =============================================================================
// What modules call through the kit (as/kit.ts): another plugin's public by
// name, AMX Mod X `Array:` rows, and an old-style menu. Hood, like the rest of
// this file.
// =============================================================================

// get_user_msgid, message_begin, message_end, write_byte and write_short are
// imported at the top of the file.
import {
	callfunc_begin_i, callfunc_push_int, get_func_id, show_menu, write_string, ArrayGetArray, ArrayDestroy
} from "./natives";

/**
 * A public function of another plugin - a Pawn plugin's public, or a
 * TypeScript plugin's `publicFor` name - to call from here:
 *
 * ```ts
 * const fn = PawnFunction.find(caller(), "OnAction");       // null when there is none
 * if (fn != null) fn.call().int(id).text("KEY").run();
 * const call = fn.call().int(id).int(target).buffer(256).int(255);
 * call.run();
 * const value = call.bufferText;                            // what it wrote into value[]
 * ```
 *
 * Pawn: `get_func_id`, `callfunc_begin_i`
 */
export class PawnFunction {
	constructor(
		/** The `id` of the plugin the function belongs to. */
		readonly plugin: i32,
		/**
		 * The function's index in its plugin.
		 *
		 * Pawn: `get_func_id`
		 */
		readonly index: i32
	) {}

	/**
	 * Finds the public `name` in the plugin with this `id` (a native's `caller()`);
	 * `null` when the plugin has no such public.
	 *
	 * Pawn: `get_func_id`
	 */
	static find(plugin: number, name: string): PawnFunction | null {
		const index = get_func_id(name, plugin);
		return index >= 0 ? new PawnFunction(<i32>plugin, <i32>index) : null;
	}

	/** Starts a call of the function: add its arguments in order, then `run()`. */
	call(): PawnCall {
		return new PawnCall(this);
	}
}

const PAWN_INT: u8 = 0;
const PAWN_TEXT: u8 = 1;
const PAWN_BUFFER: u8 = 2;

// @ts-ignore: decorator
@external("env", "callfunc_text")   declare function _callfuncText(text: string): i32;
// @ts-ignore: decorator
@external("env", "callfunc_buffer") declare function _callfuncBuffer(cells: usize, count: i32): i32;
// @ts-ignore: decorator
@external("env", "callfunc_finish") declare function _callfuncFinish(): i32;

/**
 * One call of a PawnFunction: its arguments in order, then `run()`. Any
 * number of strings and arrays may be passed, and what the function writes
 * into a `buffer()` is read afterwards from `bufferText`.
 *
 * Pawn: `callfunc_push_int`, `callfunc_push_str`, `callfunc_push_array`, `callfunc_end`
 */
export class PawnCall {
	private kinds: u8[] = [];
	private ints: i32[] = [];
	private texts: string[] = [];
	private cells: StaticArray<i32> | null = null;
	/** The text the function wrote into its `buffer()`, once `run()` is over. */
	bufferText: string = "";

	constructor(private fn: PawnFunction) {}

	/** Adds a number argument. */
	int(value: number): PawnCall {
		return this.add(PAWN_INT, <i32>value, "");
	}

	/** Adds a boolean argument; the function gets `1` or `0`. */
	bool(value: boolean): PawnCall {
		return this.add(PAWN_INT, value ? 1 : 0, "");
	}

	/** Adds a string argument. */
	text(value: string): PawnCall {
		return this.add(PAWN_TEXT, 0, value);
	}

	/** Adds an array of `size` cells for the function to fill - its `value[]`; one per call. The text is then in `bufferText`. */
	buffer(size: number): PawnCall {
		return this.add(PAWN_BUFFER, <i32>size, "");
	}

	/** Calls the function and returns its result, or `0` when it could not be called. */
	run(): number {
		if (callfunc_begin_i(this.fn.index, this.fn.plugin) != 1) return 0;

		for (let i = 0; i < this.kinds.length; i++) {
			const kind = unchecked(this.kinds[i]);
			if (kind == PAWN_INT) callfunc_push_int(unchecked(this.ints[i]));
			else if (kind == PAWN_TEXT) _callfuncText(unchecked(this.texts[i]));
			else {
				const cells = new StaticArray<i32>(unchecked(this.ints[i]));
				this.cells = cells;
				_callfuncBuffer(changetype<usize>(cells), cells.length);
			}
		}

		const result = _callfuncFinish();
		const filled = this.cells;
		if (filled != null) this.bufferText = __cellText(changetype<usize>(filled), filled.length);
		return result;
	}

	private add(kind: u8, value: i32, text: string): PawnCall {
		this.kinds.push(kind);
		this.ints.push(value);
		this.texts.push(text);
		return this;
	}
}

/**
 * Creates an AMX Mod X `Array:` of `cellSize` cells an item and returns its handle.
 *
 * Pawn: `ArrayCreate`
 */
export function createCellArray(cellSize: number): number {
	return _arrayCreate(<i32>cellSize, 32);
}

/**
 * Frees an `Array:` made by `createCellArray`; its handle is no good afterwards.
 *
 * Pawn: `ArrayDestroy`
 */
export function destroyCellArray(handle: number): void {
	ArrayDestroy(handle);
}

/**
 * Reads every item of an `Array:` of `cellSize` cells an item, each as an array of numbers.
 *
 * Pawn: `ArrayGetArray`
 */
export function cellArrayRows(handle: number, cellSize: number): number[][] {
	const rows: number[][] = [];
	const count = _arraySize(<i32>handle);
	const cells = new StaticArray<i32>(<i32>cellSize);
	for (let i = 0; i < count; i++) {
		ArrayGetArray(<i32>handle, i, changetype<i32>(cells), <i32>cellSize);
		const row: number[] = [];
		for (let k = 0; k < cells.length; k++) row.push(unchecked(cells[k]));
		rows.push(row);
	}
	return rows;
}

/**
 * Adds one item, an array of numbers, to the end of an `Array:`.
 *
 * Pawn: `ArrayPushArray`
 */
export function pushCellArrayRow(handle: number, row: number[]): void {
	const cells = new StaticArray<i32>(row.length);
	for (let i = 0; i < row.length; i++) unchecked(cells[i] = <i32>row[i]);
	_arrayPushArray(<i32>handle, changetype<usize>(cells), row.length);
}

/** Reads a Pawn string from `count` cells of a row, from `start`: a UTF-8 byte a cell, up to the first zero. */
export function cellsText(row: number[], start: number, count: number): string {
	const cells = new StaticArray<i32>(<i32>count + 1);
	for (let i = 0; i < <i32>count && <i32>start + i < row.length; i++) unchecked(cells[i] = <i32>row[<i32>start + i]);
	return __cellText(changetype<usize>(cells), <i32>count);
}

/** Writes text as `count` cells of a Pawn string: at most `count - 1` bytes, never half a letter, the rest zeros. */
export function textCells(text: string, count: number): number[] {
	const cells = new StaticArray<i32>(<i32>count);
	__writeCellText(text, cells);
	const row: number[] = [];
	for (let i = 0; i < cells.length; i++) row.push(unchecked(cells[i]));
	return row;
}

/** Turns a menu's colour tags (`!y`, `!R`, ...) into the codes the game draws, and drops the ones only chat has (`!g`, `!b`, `!t`) and the game's own codes written into the text (`\y`); any other `!` stays. `showMenu` calls it, and a module hands its result to Pawn. */
export function menuColors(text: string): string {
	if (!text.includes("!") && !text.includes("\\")) return text;

	let out = "";

	for (let i = 0; i < text.length; i++) {
		const tag = i + 1 < text.length ? text.charAt(i + 1) : "";

		// Text is written with tags: a code is Pawn's, and a module turns Pawn's text into tags first.
		if (text.charAt(i) == "\\" && tag.length > 0 && MENU_TAGS.includes(tag)) {
			i++;
			continue;
		}

		if (text.charAt(i) != "!" || tag.length == 0 || !(CHAT_TAGS.includes(tag) || MENU_TAGS.includes(tag))) {
			out += text.charAt(i);
			continue;
		}

		i++;

		// The game's own code is the same letter: `!y` is `\y`.
		if (MENU_TAGS.includes(tag)) out += "\\" + tag;
	}

	return out;
}

/**
 * Text from Pawn - a dictionary's line, a Pawn plugin's argument - with its
 * colour codes made tags: a menu's `\y` `\r` `\d` `\w` `\R` are `!y` `!r`
 * `!d` `!w` `!R`, and chat's bytes `^1` `^3` `^4` are `!y` `!t` `!g`.
 */
export function colorTags(text: string): string {
	let out = "";

	for (let i = 0; i < text.length; i++) {
		const c = text.charAt(i);
		const tag = i + 1 < text.length ? text.charAt(i + 1) : "";

		if (c == "\\" && tag.length > 0 && MENU_TAGS.includes(tag)) {
			out += "!" + tag;
			i++;
		} else if (c == "\x01") out += "!y";
		else if (c == "\x03") out += "!t";
		else if (c == "\x04") out += "!g";
		else out += c;
	}

	return out;
}

/**
 * Shows a player an old-style menu of any length: `keys` are the keys it
 * accepts, `title` the name its key presses come back under.
 *
 * Colour tags, the same letters as in chat: `!y` yellow, `!r` red, `!d` grey,
 * `!w` white, `!R` to the right edge. Chat's own tags (`!g`, `!b`, `!t`)
 * are dropped, and so are the game's own codes (`\y`): text is written with tags.
 *
 * Pawn: `show_menu`, `register_menucmd`
 */
export function showMenu(id: number, keys: number, text: string, title: string): void {
	// show_menu takes the text whole and sends it in ShowMenu messages of the
	// game's 175 bytes itself.
	show_menu(id, keys, menuColors(text), -1, title);
}

// ---------------------------------------------------------------- menus

// AMX Mod X's own menus (newmenus) as an object: `new Menu(title)`, items
// with a title, a test for when each is shown and when it can be chosen, and
// what choosing it does; `show(player, data)`. AMX Mod X draws the pages,
// Back, More and Exit.
//
// What a menu shows depends on the player and the data it is shown with, so
// each show() builds AMX Mod X's menu afresh - the title and every item's
// title, `visible` and `enabled` asked then, for that player - and the menu
// is destroyed when the player chooses or leaves it: the handler AMX Mod X
// calls once per display destroys it before it runs the item. Every menu of
// a plugin answers through one public, which finds the item by the menu's id;
// a grey item is one an item callback that always says ITEM_DISABLED draws.
// A menu left open by a plugin a reload took away answers the new one's
// public, which knows nothing of it and destroys it.
import { menu_additem, menu_create, menu_destroy, menu_display, menu_makecallback, NATIVE_menu_setprop } from "./natives";
import {
	ITEM_DISABLED, MEXIT_NEVER, MPROP_BACKNAME, MPROP_EXIT, MPROP_EXITNAME, MPROP_NEXTNAME, MPROP_NUMBER_COLOR, MPROP_PERPAGE
} from "./constants";

/** A colour of a menu's item numbers: a menu's colour tag, `"!y"`, `"!r"`, `"!d"` or `"!w"`. */
export type MenuColor = "!y" | "!r" | "!d" | "!w";

/** The options of a `Menu`: its pages and the texts of its own items. */
export interface MenuOptions {
	/**
	 * Items on a page, `7` at most: Back, More and Exit go below them. `0`
	 * puts every item on one page, without Back and More - `10` at most.
	 *
	 * Pawn: `MPROP_PERPAGE`
	 */
	perPage?: number;
	/**
	 * Whether the menu has an Exit item; `true` by default.
	 *
	 * Pawn: `MPROP_EXIT`
	 */
	exit?: boolean;
	/**
	 * The Back item's text; AMX Mod X's `"Back"`, in the player's language, by default.
	 *
	 * Pawn: `MPROP_BACKNAME`
	 */
	backText?: string;
	/**
	 * The More item's text; AMX Mod X's `"More"` by default.
	 *
	 * Pawn: `MPROP_NEXTNAME`
	 */
	nextText?: string;
	/**
	 * The Exit item's text; AMX Mod X's `"Exit"` by default.
	 *
	 * Pawn: `MPROP_EXITNAME`
	 */
	exitText?: string;
	/**
	 * The colour of the item numbers; `"!r"`, red, by default.
	 *
	 * Pawn: `MPROP_NUMBER_COLOR`
	 */
	numberColor?: MenuColor;
}

/** The context a menu's functions get: the player it is shown to, the menu and the data it was shown with. */
export interface MenuContext<Data extends object = object> {
	/** The player the menu is shown to. */
	player: Player;
	/** The menu itself: `menu.show(player, data)` keeps it open after a choice. */
	menu: Menu<Data>;
	/** The data `show` was given. */
	data: Data;
}

/** An item of a `Menu`: its title, when it is shown and can be chosen, and what choosing it does. */
export interface MenuItemOptions<Data extends object = object> {
	/** The item's text - or a function that gives it for the player it is shown to. */
	title: string | ((context: MenuContext<Data>) => string);
	/** Whether the player can choose it; one he cannot is drawn grey and does nothing. `true` by default. */
	enabled?: boolean | ((context: MenuContext<Data>) => boolean);
	/** Whether it is shown at all; a hidden item takes no place. `true` by default. */
	visible?: boolean | ((context: MenuContext<Data>) => boolean);
	/** The item's action, run when the player chooses it. The menu closes, unless this shows it again. */
	onSelect: (context: MenuContext<Data>) => void;
}

// The menus on players' screens, by AMX Mod X's id: what choosing item N of
// each runs.
const shownMenus = new Map<i32, (item: i32) => void>();
let menuHandler = "";
let greyItem: i32 = -1;

/** A player chose an item of a menu this plugin showed - or left it, an item below `0`. */
function menuChosen(player: number, menu: number, item: number, unused: number): void {
	const id = <i32>menu;
	const choose = shownMenus.has(id) ? shownMenus.get(id) : null;
	shownMenus.delete(id);
	menu_destroy(id);

	if (choose != null && item >= 0) {
		const ambient = __co_ambient_player;
		__co_ambient_player = <i32>player;
		choose(<i32>item);
		__co_ambient_player = ambient;
	}
	handled();
}

/** An item AMX Mod X draws grey: the item callback of the items that cannot be chosen. */
function itemDisabled(player: number, menu: number, item: number, unused: number): void {
	ret(ITEM_DISABLED);
}

/** Sets a menu property that is text, when it is given, its colour tags made the game's codes. */
function setMenuText(menu: i32, prop: i32, text: string | undefined): void {
	if (text !== undefined) new Call(NATIVE_menu_setprop).num(menu).num(prop).str(menuColors(text)).run();
}

/** A text given as `string | ((context) => string)`: the compiler holds it as the function, a string as one that returns it. */
function menuText<C>(text: string | ((context: C) => string), context: C): string {
	// @ts-ignore: a function here - the editor sees the union
	return menuColors(text(context));
}

/** A test given as `boolean | ((context) => boolean)`, held as the function as a text is; left out, it says yes. */
function menuTest<C>(test: boolean | ((context: C) => boolean) | undefined, context: C): boolean {
	// @ts-ignore: a function or null here - the editor sees the union
	return test == null || test(context);
}

/**
 * A menu of AMX Mod X's own: items a player picks with the number keys, on
 * pages with Back and More, and Exit. `Data` is what it is shown with, which
 * its functions get beside the player.
 *
 * ```ts
 * interface ShopData {
 *   category: string;
 * }
 *
 * const shop = new Menu<ShopData>("!yShop");
 * shop.addItem({
 *   title: "Armor - $1000",
 *   enabled: ({ player }) => player.armor < 100,
 *   onSelect: ({ player }) => {
 *     player.armor = 100;
 *   },
 * });
 * shop.show(player, { category: "armor" });
 * ```
 *
 * The title and each item's title, `visible` and `enabled` are asked at
 * every `show`, for that player. Colour tags as in `showMenu`: `!y` yellow,
 * `!r` red, `!d` grey, `!w` white, `!R` to the right edge.
 *
 * Pawn: `menu_create`, `menu_setprop`
 */
export class Menu<Data extends object = object> {
	private readonly items: MenuItemOptions<Data>[] = [];

	constructor(
		private readonly title: string | ((context: MenuContext<Data>) => string),
		private readonly options: MenuOptions = {}
	) {
		// Asked for now, not at the first show: after a reload, a menu the last
		// start left open answers here, and is destroyed.
		if (menuHandler.length == 0) menuHandler = callbackName(menuChosen, "menu");
	}

	/**
	 * Adds an item: its title, when it is shown and can be chosen, and what
	 * choosing it does.
	 *
	 * ```ts
	 * shop.addItem({
	 *   title: ({ player }) => `Heal (${player.health} HP)`,
	 *   visible: ({ player }) => player.isAlive,
	 *   enabled: ({ player }) => player.health < 100,
	 *   onSelect: ({ player }) => {
	 *     player.health = 100;
	 *   },
	 * });
	 * ```
	 *
	 * Pawn: `menu_additem`
	 */
	addItem(item: MenuItemOptions<Data>): void {
		this.items.push(item);
	}

	/**
	 * Shows the menu to a player, with the data its functions get; it closes
	 * when he chooses an item or leaves it.
	 *
	 * Pawn: `menu_display`
	 */
	show(player: Player, data: Data | null = null): void {
		const context: MenuContext<Data> = { player, menu: this, data: changetype<Data>(data) };
		const id = menu_create(menuText(this.title, context), menuHandler);

		const options = this.options;
		const perPage = options.perPage;
		if (perPage !== undefined) new Call(NATIVE_menu_setprop).num(id).num(MPROP_PERPAGE).ref(perPage).run();
		if (options.exit == false) new Call(NATIVE_menu_setprop).num(id).num(MPROP_EXIT).ref(MEXIT_NEVER).run();
		setMenuText(id, MPROP_BACKNAME, options.backText);
		setMenuText(id, MPROP_NEXTNAME, options.nextText);
		setMenuText(id, MPROP_EXITNAME, options.exitText);
		setMenuText(id, MPROP_NUMBER_COLOR, options.numberColor);

		const shown = this.items.filter((item: MenuItemOptions<Data>) => menuTest(item.visible, context));
		for (let i = 0; i < shown.length; i++) {
			const item = shown[i];
			const enabled = menuTest(item.enabled, context);
			if (!enabled && greyItem < 0) greyItem = menu_makecallback(callbackName(itemDisabled, "menu-grey"));
			menu_additem(id, menuText(item.title, context), "", 0, enabled ? -1 : greyItem);
		}

		shownMenus.set(id, (item: i32) => shown[item].onSelect(context));
		menu_display(player.id, id);
	}
}
