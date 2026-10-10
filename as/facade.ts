/// <reference path="./amxts.d.ts" />
// The plugin-facing API.
//
// Two layers sit under this one: as/natives.ts, which is every native in
// includes/*.inc as Pawn sees it, and the bridge natives that
// runtime/src/module.cpp registers by hand for the places where a string
// crossing as UTF-16 is worth a purpose-built thunk. Both are direct calls —
// an import whose signature wamrc knows is far cheaper than its generic call.
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
	get_user_msgid, message_begin, message_end, write_byte, write_short,
	user_kill, get_user_flags, read_flags,
	get_cvar_num, get_cvar_string, set_cvar_num, set_cvar_string, get_players, get_user_info,
	LibraryExists, module_exists, get_speak, set_speak,
	read_argc, read_args, read_argv, create_cvar, get_cvar_pointer,
	get_pcvar_float, get_pcvar_num, get_pcvar_string, set_pcvar_float, set_pcvar_num, set_pcvar_string,
	get_localinfo, register_dictionary,
	precache_model, precache_sound, precache_generic, get_user_userid,
	emessage_begin, emessage_begin_f, ewrite_byte, ewrite_short, ewrite_string, emessage_end, elog_message
} from "./natives";
import { readFileSync } from "./fs";
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
@external("env", "clcmd")        declare function _clcmd(name: string, fn: i32, flags: i32, shape: i32): void;
// @ts-ignore: decorator
@external("env", "srvcmd")       declare function _srvcmd(name: string, fn: i32, shape: i32): void;
// @ts-ignore: decorator
@external("env", "bot_cmd")      declare function _botCmd(id: i32, line: string): void;
// What a player is given and does, done by the module itself.
// @ts-ignore: decorator
@external("env", "player_give")    declare function _playerGive(id: i32, name: string): i32;
// @ts-ignore: decorator
@external("env", "player_strip")   declare function _playerStrip(id: i32, suit: i32): void;
// @ts-ignore: decorator
@external("env", "player_respawn") declare function _playerRespawn(id: i32): void;
// @ts-ignore: decorator
@external("env", "player_speed")   declare function _playerSpeed(id: i32): void;
// @ts-ignore: decorator
@external("env", "player_switch")  declare function _playerSwitch(id: i32, name: string): i32;
// @ts-ignore: decorator
@external("env", "player_join")    declare function _playerJoin(id: i32, team: i32): i32;
// @ts-ignore: decorator
@external("env", "player_team")    declare function _playerTeam(id: i32, team: i32): void;
// The game rules' RestartRound and CheckWinConditions, run by the module: 0 when the game has none.
// @ts-ignore: decorator
@external("env", "game_rules_run") declare function _gameRulesRun(action: i32): i32;
// @ts-ignore: decorator
@external("env", "player_switch_team") declare function _playerSwitchTeam(id: i32): void;
const RULES_RESTART_ROUND: i32 = 1;
const RULES_CHECK_WIN: i32 = 2;
// A player's slots, as removeItems takes them: m_rgpPlayerItems from 1.
const ITEM_SLOTS: ItemSlot[] = ["primary", "secondary", "knife", "grenades", "c4"];
// @ts-ignore: decorator
@external("env", "player_remove_slot") declare function _playerRemoveSlot(id: i32, slot: i32): i32;
// @ts-ignore: decorator
@external("env", "player_drop")    declare function _playerDrop(id: i32, name: string): void;
// What player_stat tells: the user id, the ping, the seconds since he connected.
// @ts-ignore: decorator
@external("env", "player_stat")    declare function _playerStat(id: i32, what: i32): i32;
const STAT_USER_ID: i32 = 1;
const STAT_PING: i32 = 2;
const STAT_LOSS: i32 = 3;
const STAT_CONNECTED: i32 = 4;
// @ts-ignore: decorator
@external("env", "info_get")       declare function _userInfo(id: i32, key: string, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "info_set")       declare function _setUserInfo(id: i32, key: string, value: string): void;
// An address's country from the GeoIP database: its ISO code (1) or English name (2); -1 for none.
// @ts-ignore: decorator
@external("env", "geo_country")    declare function _geoCountry(ip: string, what: i32, out: usize, max: i32): i32;
const GEO_CODE: i32 = 1;
const GEO_NAME: i32 = 2;
// The log's line being told: whole, and its arguments as AMX Mod X splits them.
// @ts-ignore: decorator
@external("env", "log_text")       declare function _logText(index: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "log_count")      declare function _logCount(): i32;
// His steps silent (1) or not (0); -1 reads which.
// @ts-ignore: decorator
@external("env", "player_silent")  declare function _playerSilent(id: i32, on: i32): i32;
// The sounds of a slap, the game's own pain sounds.
const SLAP_SOUNDS = ["player/pl_pain2.wav", "player/pl_pain4.wav", "player/pl_pain5.wav", "player/pl_pain6.wav", "player/pl_pain7.wav"];
// Reunion's answers about a client, through its API: -1 without Reunion.
// @ts-ignore: decorator
@external("env", "reunion")        declare function _reunion(what: i32, id: i32): i32;
// @ts-ignore: decorator
@external("env", "member_slot")    declare function _playerMemberSlot(className: string, name: string): i32;
// @ts-ignore: decorator
@external("env", "member_get")     declare function _playerMemberGet(id: i32, slot: i32, element: i32): i32;
// @ts-ignore: decorator
@external("env", "member_set")     declare function _playerMemberSet(id: i32, slot: i32, element: i32, cell: i32): void;
// @ts-ignore: decorator
@external("env", "task")         declare function _task(secondsBits: i32, fn: i32, repeat: i32): i32;
// @ts-ignore: decorator
@external("env", "stop_task")    declare function _stopTask(slot: i32): i32;
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
// @ts-ignore: decorator
@external("env", "stack_frames") declare function _stackFrames(out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "stack_text")   declare function _stackText(frames: usize, count: i32, out: usize, max: i32): i32;

/** The most calls an error's `stack` names. */
const STACK_FRAMES = 32;

/**
 * An error's `stack`, from the module: the frames of the calls that made the
 * error - each function's index and where in it the call is - kept when it
 * is made, and put into words through the plugin's map only when `stack` is
 * read.
 */
class ModuleStack extends ErrorStack {
	frames(): StaticArray<u32> {
		const frames = new StaticArray<u32>(STACK_FRAMES * 2);
		const count = _stackFrames(changetype<usize>(frames), STACK_FRAMES);
		return StaticArray.slice<u32>(frames, 0, count * 2);
	}

	text(frames: StaticArray<u32>): string {
		const length = _stackText(changetype<usize>(frames), frames.length / 2, changetype<usize>(stackText), stackText.length);
		return String.UTF8.decodeUnsafe(changetype<usize>(stackText), length);
	}
}
const stackText = new StaticArray<u8>(8192);
__errorStack = new ModuleStack();

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
 * A public name that calls `handler`, for what takes a callback by a public's
 * name: `register_menucmd`, and a plugin's native that calls it back with a
 * `PawnFunction` (menu-core's `mc_register_placeholder`).
 *
 * ```ts
 * const pub = publicFor(onKey, "menu:myplugin");
 * if (pub.length > 0) register_menucmd(register_menuid("myplugin"), 1023, pub);
 * ```
 *
 * An empty name means “already registered”: such a registration cannot be
 * undone and survives a hot reload, so registering again would call the
 * handler twice. `key` identifies the registration across reloads — any name
 * unique within the plugin. `fallback` is the answer when the handler returns
 * nothing: `0` for most natives, `1` where the native expects the event handled.
 *
 * A native of AMX Mod X that finds the public in the calling plugin
 * (`register_think`, `set_task`) cannot take it: a TypeScript plugin's call
 * has no Pawn plugin behind it.
 */
export function publicFor(handler: WideHandler, key: string, fallback: number = 0): string {
	const slot = _slot(hostIndex(handler, true), SHAPE_WIDE, key, fallback);

	if (slot < 0) {
		console.error(`publicFor("${key}") outside a plugin's call`);
		return "";
	}

	return (slot & SLOT_REUSED) ? "" : `__amxts_cb${slot}`;
}

// Must match SLOT_REUSED in runtime/src/module.cpp.
const SLOT_REUSED: i32 = 0x40000000;

/**
 * @hidden A registration with AMX Mod X - a hook, or a public it calls - that
 * is switched off while what it delivers has no listener and back on for the
 * next one, so that an event nobody listens to does not reach the plugin.
 * One switched off before it is made is made switched off.
 */
export class __Switch {
	private on: bool = true;
	private parts: ((on: bool) => void)[] = [];

	/** Switches every registration of it on or off. */
	set(on: bool): void {
		if (on == this.on) return;
		this.on = on;
		for (let i = 0; i < this.parts.length; i++) this.parts[i](on);
	}

	/** What switches one registration, once it is made; run at once while the switch is off. */
	add(part: (on: bool) => void): void {
		this.parts.push(part);
		if (!this.on) part(false);
	}
}

/**
 * @hidden What a server event's object is underneath (as/events.ts): its
 * listeners read a field from the forward's call when they read it, and the
 * next call hands out the same object - unless the object is kept, by an
 * async function that takes it (__co_keep) or a listener that writes a
 * field. Then it reads every field into itself and keeps them, and the next
 * call makes another.
 */
export class __ServerEvent {
	/** @hidden Whether the object keeps its fields. */
	__kept: bool = false;

	/** @hidden Reads every field from the running call into the object, once. */
	__keep(): void {}
}

/**
 * @hidden The listeners of one event, walked by its dispatch in place - no
 * copy, no allocation - with the DOM's rules: a dispatch calls the listeners
 * there when it began (`begin` gives their count), so one added meanwhile
 * waits for the next; one removed meanwhile becomes a hole the walk skips,
 * and the outermost dispatch closes the holes when it ends.
 *
 * A listener that traps ends the call without `end`: the list then keeps its
 * holes - still skipped, a few bytes each - until the plugin stops.
 *
 * `begin`, `at` and `end` are inlined into each dispatch: a call of the
 * plugin's own costs a frame of its shadow stack, more than their work.
 */
export class __Listeners<T> {
	private items: (T | null)[] = [];
	private depth: i32 = 0;
	private holes: bool = false;
	/** How many listeners there are. */
	count: i32 = 0;

	push(item: T): void {
		this.items.push(item);
		this.count++;
	}

	/** Takes `item` off; false when it is not there. */
	remove(item: T): bool {
		const at = this.items.indexOf(item);
		if (at < 0) return false;
		this.removeAt(at);
		return true;
	}

	/** Takes the listener at `at` off: a hole while a dispatch walks the list. */
	removeAt(at: i32): void {
		this.count--;
		if (this.depth == 0) {
			this.items.splice(at, 1);
			return;
		}

		unchecked(this.items[at] = null);
		this.holes = true;
	}

	/** The listener at `at`, null where one was removed; `at` below `slots`. */
	@inline at(at: i32): T | null {
		return unchecked(this.items[at]);
	}

	/** How many places a walk outside a dispatch goes over, holes included. */
	get slots(): i32 {
		return this.items.length;
	}

	/** A dispatch begins: how many places it walks. */
	@inline begin(): i32 {
		this.depth++;
		return this.items.length;
	}

	/** A dispatch ends; the outermost one closes the holes. */
	@inline end(): void {
		if (--this.depth == 0 && this.holes) this.close();
	}

	private close(): void {
		this.holes = false;
		const items = this.items;
		let kept = 0;
		for (let i = 0; i < items.length; i++) {
			const item = unchecked(items[i]);
			if (item) unchecked(items[kept++] = item);
		}
		items.length = kept;
	}
}

// The module gives AMX Mod X the name, and keeps it until the server stops: a
// reload takes the same entry back. A Pawn plugin binds its natives as it
// loads, which is why plugins are loaded from plugin_natives at all.
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

/**
 * @hidden Writes a `Float:v[3]` argument where it lies: a hookchain's vector,
 * which reapi copies back into the game's once the listener returns.
 */
export function __setNativeVector(index: i32, value: Vector): void {
	const cells = new StaticArray<i32>(3);
	unchecked(cells[0] = reinterpret<i32>(<f32>value.x));
	unchecked(cells[1] = reinterpret<i32>(<f32>value.y));
	unchecked(cells[2] = reinterpret<i32>(<f32>value.z));
	_setArgArray(index, changetype<usize>(cells), 3);
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
	return id >= 1 ? __playerOf(id) : null;
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
@external("env", "LookupLangKey") declare function _lookupLangKey(out: i32, size: i32, key: string, id: i32): i32;

/** The longest line a dictionary holds: AMX Mod X reads a value into 512 bytes. */
const LANG_TEXT: i32 = 512;

// One buffer for every lookup: a menu translates each of its lines on every draw.
// The module writes the line into it as UTF-8 bytes, up to its end.
const langOut = __textRoom(LANG_TEXT);
const langId = new StaticArray<i32>(1);

/** The key's line in the player's language (`0`: the server's), as the dictionary loaded it; empty when no dictionary has it. */
function lookupLang(key: string, player: i32): string {
	unchecked(langId[0] = player);
	_lookupLangKey(__textInto(langOut), LANG_TEXT - 1, key, changetype<i32>(langId));
	return __textFrom(langOut);
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
@external("env", "ArrayPushString") declare function _arrayPushString(handle: i32, text: string): i32;
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
		_arrayPushString(this.handle, value);
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
// whoever made the call - the natives' image for a forward or a publicFor
// name, the calling plugin for a native this one exported. The module reads it there.
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
 * mojibake one way and a truncated byte the other (a Cyrillic word arrived as "@0").
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

/** Reads the text a raw native from `@amxts/core/natives` wrote into a cell array. `stringToCells` is the other way. */
export function cellsToString(cells: StaticArray<i32>): string {
	return __cellText(changetype<usize>(cells), cells.length);
}

/** Writes text into a cell array as a Pawn string, for a raw native. */
export function stringToCells(text: string, cells: StaticArray<i32>): void {
	__writeCellText(text, cells);
}

// The natives in @amxts/core/natives take addresses, because that is what Pawn pushes: a
// string has to be in memory this plugin owns before its address means anything.
/**
 * Passes a string to a raw native from `@amxts/core/natives` without declaring a
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

/** What AMX Mod X calls the player in slot `id` now: get_user_name. */
function readName(id: i32): string {
	const len = _getName(id, changetype<i32>(nameBuf), 64);
	return String.UTF8.decodeUnsafe(changetype<usize>(nameBuf), len);
}

/** A Counter-Strike team, by the name the game gives it: one of `"TERRORIST"`, `"CT"`, `"SPECTATOR"`, `"UNASSIGNED"`. */
export type Team = "TERRORIST" | "CT" | "SPECTATOR" | "UNASSIGNED";

const TEAM_NAMES: Team[] = ["UNASSIGNED", "TERRORIST", "CT", "SPECTATOR"];

/** The way a player's game proves who he is, as Reunion tells it, e.g. `"steam"` or `"revEmu"`; `"unknown"` on a server without Reunion. */
export type AuthType =
	| "unknown" | "steam" | "steamEmu" | "revEmu" | "revEmu2013" | "oldRevEmu"
	| "sc2009" | "avsmp" | "sxei" | "sse3" | "dproto" | "hltv";

// What the reunion import is asked.
const REUNION_PROTOCOL: i32 = 1;
const REUNION_AUTH: i32 = 2;

// Reunion's client_auth_type, by its number: CA_TYPE_NONE is "unknown".
const AUTH_TYPES: AuthType[] = [
	"unknown", "dproto", "steam", "steamEmu", "revEmu", "oldRevEmu",
	"hltv", "sc2009", "avsmp", "sxei", "revEmu2013", "sse3",
];

// The key a player's game proved itself with, as Reunion read it: its length, "" without Reunion.
// @ts-ignore: decorator
@external("env", "reunion_key") declare function _reunionKey(id: i32, out: usize, max: i32): i32;

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

/**
 * A player's item slot, one of `"primary"` (a rifle, a shotgun, a sniper
 * rifle, the shield), `"secondary"` (the pistol), `"knife"`, `"grenades"` or
 * `"c4"`.
 */
export type ItemSlot = "primary" | "secondary" | "knife" | "grenades" | "c4";

/** The longest userinfo value a player's game keeps. */
const INFO_MAX: i32 = 256;
const infoBuffer = new StaticArray<u8>(INFO_MAX);

/**
 * The settings a player's game tells the server, his userinfo: keys such as
 * `"model"`, `"cl_righthand"`, `"_vgui_menus"`, each a text.
 */
export class UserInfo {
	constructor(private readonly id: number) {}

	/**
	 * A key's value: `player.info.get("cl_righthand")` is `"1"`; `""` for a key
	 * his game did not send.
	 *
	 * Pawn: `get_user_info`
	 */
	get(key: string): string {
		const length = _userInfo(<i32>this.id, key, changetype<usize>(infoBuffer), INFO_MAX);
		return String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length);
	}

	/**
	 * Writes a key: the server and his game take the new value, as when his
	 * game changes it itself.
	 *
	 * Pawn: `set_user_info`
	 */
	set(key: string, value: string): void {
		_setUserInfo(<i32>this.id, key, value);
	}
}

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

/** @hidden An address's country from the GeoIP database, for the hood's tests: its code, else its name; null for none. */
export function __countryOf(ip: string, code: bool): string | null {
	return countryOf(ip, code ? GEO_CODE : GEO_NAME);
}

/** The longest log line the game writes. */
const LOG_MAX: i32 = 1024;
const logBuffer = new StaticArray<u8>(LOG_MAX);

/** @hidden The log line being told, whole ("" outside the log event). */
export function __logText(): string {
	const length = _logText(-1, changetype<usize>(logBuffer), LOG_MAX);
	return String.UTF8.decodeUnsafe(changetype<usize>(logBuffer), length);
}

/** @hidden The log line's arguments, as AMX Mod X's read_logargv gives them. */
export function __logArgs(): string[] {
	const args: string[] = [];
	for (let i = 0, n = _logCount(); i < n; i++) {
		const length = _logText(i, changetype<usize>(logBuffer), LOG_MAX);
		args.push(String.UTF8.decodeUnsafe(changetype<usize>(logBuffer), length));
	}
	return args;
}

/** Whether a console command is a chat line. */
function isChat(name: string): bool {
	return name == "say" || name == "say_team";
}

/** @hidden The name of the console command being told: `read_argv(0)`. */
export function __commandName(): string {
	return read_argv(0);
}

/** @hidden Its text after the name: a chat line without its quotes. */
export function __commandText(): string {
	return isChat(read_argv(0)) ? chatLine() : read_args();
}

/** @hidden Its words after the name: the chat line's for `say` and `say_team`, the engine's for any other. */
export function __commandArgs(): string[] {
	if (isChat(read_argv(0))) return chatLine().split(" ").filter(word => word.length > 0);
	const words: string[] = [];
	for (let i = 1, n = <i32>read_argc(); i < n; i++) words.push(read_argv(i));
	return words;
}

/** The most of a message-of-the-day's text one MOTD message carries, in bytes. */
const MOTD_CHUNK: i32 = 175;

/** The server's name on one player's screen: the window titles read it. */
function sendServerName(id: number, name: string): void {
	message_begin(MSG_ONE, get_user_msgid("ServerName"), [0, 0, 0], <i32>id);
	write_string(name);
	message_end();
}

// The server's game, versions, map and light (runtime/src/world.h).
// @ts-ignore: decorator
@external("env", "server_text")  declare function _serverText(what: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "map_valid")    declare function _mapValid(name: string): i32;
// @ts-ignore: decorator
@external("env", "change_level") declare function _changeLevel(name: string): i32;
// @ts-ignore: decorator
@external("env", "light_style")  declare function _lightStyle(text: string): void;
// @ts-ignore: decorator
@external("env", "player_light_style") declare function _playerLightStyle(id: i32, text: string): void;
// @ts-ignore: decorator
@external("env", "player_view")  declare function _playerView(id: i32, target: i32): void;
// @ts-ignore: decorator
@external("env", "player_model") declare function _playerModel(id: i32, model: string, index: i32): void;
// @ts-ignore: decorator
@external("env", "player_model_get") declare function _playerModelGet(id: i32, out: usize, max: i32): i32;

/** The options of `player.setModel`: what goes with the model. */
export interface ModelOptions {
	/** The model's own hitboxes, not the game's: for a model shaped otherwise; `false` when left out. */
	hitboxes?: boolean;
}
// @ts-ignore: decorator
@external("env", "player_view_get") declare function _playerViewGet(id: i32): i32;
const SERVER_GAME: i32 = 1;
const SERVER_AMXTS: i32 = 2;
const SERVER_REHLDS: i32 = 3;
const SERVER_REGAMEDLL: i32 = 4;
// The light this plugin set; the map's own until then.
let lightStyle = "m";

function serverText(what: i32): string {
	const length = _serverText(what, changetype<usize>(infoBuffer), INFO_MAX);
	return String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length);
}

/** The versions of what a server runs: `server.versions`. */
export class ServerVersions {
	constructor(
		/** amxts's version, e.g. `"0.3.0"`. */
		readonly amxts: string,
		/** AMX Mod X's version, e.g. `"1.10.0.5467"`. */
		readonly amxModX: string,
		/** Metamod's version, e.g. `"1.3.0.149"`. */
		readonly metamod: string,
		/** ReHLDS's API version, e.g. `"3.14"`; `null` on another engine. */
		readonly reHlds: string | null,
		/** ReGameDLL's API version, e.g. `"5.28"`; `null` on the original game. */
		readonly reGameDll: string | null,
	) {}
}

/** The options of `player.removeAllItems`: what goes with the weapons. */
export interface RemoveAllItemsOptions {
	/** The suit too - his armour and the HUD; `false` when left out. */
	suit?: boolean;
}

// The names player.give was given that the game has no item of: each said once.
const unknownItems = new Set<string>();

// The plugins of the server: the module's list of TypeScript plugins, and AMX Mod X's of Pawn ones.
// @ts-ignore: decorator
@external("env", "plugins_count")  declare function _pluginsCount(): i32;
// @ts-ignore: decorator
@external("env", "plugin_text")    declare function _pluginText(index: i32, what: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "plugin_state")   declare function _pluginState(index: i32): i32;
// @ts-ignore: decorator
@external("env", "plugin_action")  declare function _pluginAction(name: string, action: i32): void;
// @ts-ignore: decorator
@external("env", "pawn_plugins_count") declare function _pawnPluginsCount(): i32;
// @ts-ignore: decorator
@external("env", "pawn_plugin_text")   declare function _pawnPluginText(index: i32, what: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "pawn_plugin_pause")  declare function _pawnPluginPause(file: string, on: i32): i32;
const PLUGIN_FILE: i32 = 1;
const PLUGIN_TITLE: i32 = 2;
const PLUGIN_VERSION: i32 = 3;
const PLUGIN_AUTHOR: i32 = 4;
const PLUGIN_STOP: i32 = 1;
const PLUGIN_START: i32 = 2;
const PLUGIN_RELOAD: i32 = 3;
// get_plugin's fields, in its order: the file, the title, the version, the author, the status.
const PAWN_FILE: i32 = 1;
const PAWN_TITLE: i32 = 2;
const PAWN_VERSION: i32 = 3;
const PAWN_AUTHOR: i32 = 4;
const PAWN_STATUS: i32 = 5;

function pluginText(index: i32, what: i32): string {
	const length = _pluginText(index, what, changetype<usize>(infoBuffer), INFO_MAX);
	return String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length);
}

function pawnPluginText(index: i32, what: i32): string {
	const length = _pawnPluginText(index, what, changetype<usize>(infoBuffer), INFO_MAX);
	return String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length);
}

/** The language a plugin is written in, one of `"typescript"` or `"pawn"`. */
export type PluginLanguage = "typescript" | "pawn";

/**
 * A plugin on the server, TypeScript or Pawn, as `server.plugins` lists it:
 * its file, what it says it is, whether it runs - and the means to stop it,
 * start it again and reload it.
 */
export class ServerPlugin {
	constructor(
		private readonly index: i32,
		/** `"typescript"` or `"pawn"`. */
		readonly language: PluginLanguage,
		/** The plugin's file, as the server's list names it, e.g. `"shop.aot"`, `"admin.amxx"`. */
		readonly file: string,
		/** The name it gives itself (`plugin()`, `register_plugin`). */
		readonly name: string,
		/** The version it gives. */
		readonly version: string,
		/** The author it names. */
		readonly author: string,
	) {}

	/**
	 * Whether it runs: not stopped, not refused, not paused.
	 *
	 * Pawn: `get_plugin(..., status)`
	 */
	get running(): boolean {
		if (this.language == "typescript") return _pluginState(this.index) == 0;
		return pawnPluginText(this.index, PAWN_STATUS) == "running";
	}

	/**
	 * Stops it at the next frame. A TypeScript plugin is unloaded, and what
	 * it registered with it, until `start()` or the map changes; a Pawn plugin
	 * is paused, as AMX Mod X pauses one.
	 *
	 * Pawn: `pause`, `amxts_unload`
	 */
	stop(): void {
		if (this.language == "typescript") _pluginAction(this.file, PLUGIN_STOP);
		else _pawnPluginPause(this.file, 1);
	}

	/**
	 * Starts it again: a TypeScript plugin loaded at the next frame, a Pawn
	 * plugin let run again.
	 *
	 * Pawn: `unpause`, `amxts_load`
	 */
	start(): void {
		if (this.language == "typescript") _pluginAction(this.file, PLUGIN_START);
		else _pawnPluginPause(this.file, 0);
	}

	/**
	 * Starts a TypeScript plugin over from its file at the next frame. A Pawn
	 * plugin cannot be: AMX Mod X loads its plugins once a map - it throws.
	 *
	 * Pawn: `amxts_reload`
	 */
	reload(): void {
		if (this.language == "pawn") throw new Error(`${this.file} is a Pawn plugin: AMX Mod X cannot reload it`);
		_pluginAction(this.file, PLUGIN_RELOAD);
	}

	/**
	 * Calls a public function of a Pawn plugin and gives what it returns:
	 * `ranks.call("show_rank", player)`. A number, a boolean, text or a
	 * player crosses as Pawn takes it. A TypeScript plugin is called through
	 * its module instead: it throws.
	 *
	 * Pawn: `callfunc_begin`, `callfunc_begin_i`, `get_func_id`, `callfunc_push_*`, `callfunc_end`
	 */
	call<T1 = NoArgument, T2 = NoArgument, T3 = NoArgument, T4 = NoArgument, T5 = NoArgument, T6 = NoArgument>(
		name: string, a1: T1 = zeroOf<T1>(), a2: T2 = zeroOf<T2>(), a3: T3 = zeroOf<T3>(), a4: T4 = zeroOf<T4>(), a5: T5 = zeroOf<T5>(), a6: T6 = zeroOf<T6>(),
	): number {
		if (this.language == "typescript") throw new Error(`${this.file} is a TypeScript plugin: call it through its module`);
		const fn = PawnFunction.find(this.index, name);
		if (fn == null) throw new Error(`${this.file} has no public ${name}`);
		const call = fn.call();
		pushPawn<T1>(call, a1);
		pushPawn<T2>(call, a2);
		pushPawn<T3>(call, a3);
		pushPawn<T4>(call, a4);
		pushPawn<T5>(call, a5);
		pushPawn<T6>(call, a6);
		return call.run();
	}
}

/** An argument of a Pawn public, as its type says: a number, a boolean, text, a player's index; nothing for one left out. */
function pushPawn<T>(call: PawnCall, value: T): void {
	if (isString<T>()) call.text(changetype<string>(value));
	else if (isBoolean<T>()) call.bool(<bool>value);
	else if (!isReference<T>()) call.int(<f64>value);
	// @ts-ignore: a Player's or an Entity's index, looked for at compile time
	else if (isDefined(changetype<T>(0).id)) call.int(value ? <i32>changetype<T>(value).id : 0);
	// An argument left out: known at compile time, as the type is.
	else if (!(changetype<T>(0) instanceof NoArgument)) ERROR("a Pawn public takes a number, a boolean, text or a Player");
}

/** An address's country from the GeoIP database: its code or name; null for none. */
function countryOf(ip: string, what: i32): string | null {
	const length = _geoCountry(ip, what, changetype<usize>(infoBuffer), INFO_MAX);
	return length < 0 ? null : String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length);
}

/** A member of every player, by its gamedata name, its slot looked up the first time it is used. */
class PlayerMember {
	private slot: i32 = -2;
	constructor(readonly name: string) {}

	private here(): i32 {
		if (this.slot == -2) this.slot = _playerMemberSlot("CBasePlayer", this.name);
		return this.slot;
	}

	get(id: number, element: i32 = 0): i32 {
		return _playerMemberGet(<i32>id, this.here(), element);
	}

	set(id: number, cell: i32, element: i32 = 0): void {
		_playerMemberSet(<i32>id, this.here(), element, cell);
	}
}

const TEAM = new PlayerMember("m_iTeam");
const DEATHS = new PlayerMember("m_iDeaths");
const AMMO = new PlayerMember("m_rgAmmo");

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

// ---------------------------------------------------------------- bots

import { __textFrom, __textInto, __textRoom, dllfunc, engfunc, global_get, set_pev } from "./natives";
import { DLLFunc_ClientConnect, DLLFunc_ClientPutInServer, EngFunc_CreateFakeClient, EngFunc_RunPlayerMove, glb_frametime, MAX_PLAYERS, pev_health } from "./constants";
import { BUTTON, Button } from "./flags";

// What a bot's move reads its angles into, made once: a move is made every frame.
const moveAngles = new Vector();

/** How long the server's current frame lasts, in seconds (frameTimeRead). */
function frameTime(): f64 {
	global_get(glb_frametime, frameTimeRead);
	return frameTimeRead.value;
}

/**
 * One move of a bot, `bot.move({ ... })`: the speeds are units a second, as
 * a player's keys give them - `250` runs with a knife, `-250` backs away.
 */
export interface MoveOptions {
	/** Forward, or back when negative. */
	forward?: number;
	/** To the right, or to the left when negative. */
	side?: number;
	/** Up, or down when negative: swimming and climbing a ladder. */
	up?: number;
	/** The buttons held during the move: `["jump", "duck"]`. */
	buttons?: Button[];
	/** The direction the bot looks in, `[pitch, yaw, roll]` or a Vector; where it looks now when left out. */
	angles?: number[];
	/** The move's length in milliseconds, `1` to `255`; the server frame's time when left out. */
	msec?: number;
}

// Plugins add fields of their own to this class, shared by every plugin and by
// Pawn, with `interface Player { spawnProtected: boolean }` in a
// `declare module "~/facade"` block (docs/en/3.game/02.players.md) - not written
// here as one block, which the build would take for a declaration of every
// plugin's. The build turns each into a getter and a setter over the module's
// store and adds them here (scripts/player-fields.ts).
/**
 * A connecting player, in `"connect"`, `"authorized"` and `"putInServer"`: name,
 * address, SteamID and team, but no health or weapons yet. Every Player is a
 * Client too.
 *
 * ```ts
 * server.addEventListener("putInServer", (event) => {
 * 	event.player.print(`Welcome, ${event.player.name}!`);
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
	/** The player's SteamID, e.g. `"STEAM_0:1:12345"`. A bot has `"BOT"`, HLTV has `"HLTV"`; until Steam confirms the player it is `"STEAM_ID_PENDING"` (wait for the `"authorized"` event), and on a LAN server `"STEAM_ID_LAN"`. With Reunion a game without Steam gets one made from its key (`authKey`): `"STEAM_..."` or `"VALVE_..."`, as the server's Reunion settings say. */
	readonly steamId: string;
	/** The way the player's game proved who he is, as Reunion tells it: one of `"steam"` (a Steam game), `"steamEmu"`, `"revEmu"`, `"revEmu2013"`, `"oldRevEmu"`, `"sc2009"`, `"avsmp"`, `"sxei"`, `"sse3"` (a game without Steam, by the emulator it proved itself with), `"dproto"`, `"hltv"`, or `"unknown"` on a server without Reunion. */
	readonly authType: AuthType;
	/** The network protocol of the player's game: `48` for today's game, `47` for an old one Reunion lets in. `0` on a server without Reunion. */
	readonly protocol: number;
	/** The key the player's game proved itself with, as Reunion read it: what his SteamID is made from. `""` on a server without Reunion. */
	readonly authKey: string;
	/** `true` for a bot. */
	readonly isBot: boolean;
	/**
	 * `true` for an HLTV proxy: a spectator's relay, which `server.players`
	 * leaves out.
	 */
	readonly isHltv: boolean;
	/** `true` while the player is on the server. */
	readonly isConnected: boolean;
	/** The player's admin rights, from the letters in `users.ini`: `client.access.includes("cvar")`. */
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
	/** Sends the player a message, in the chat unless `variant` says another place: `client.print("Welcome!")`. Colour tags work as in `player.print`. */
	print(message: string, variant?: VariantName): void;
	/** Runs a command in the player's console, as if he had typed it: `client.command("stop")`. */
	command(text: string): void;
	/** Kicks the player off the server, with the reason he is shown: `client.kick("Spam")`. */
	kick(reason?: string): void;
	/** Joins a side as the game joins a player who picks it in the team menu: `client.joinTeam("CT")`. `false` if the game refused. */
	joinTeam(team: Team): boolean;
	/** Asks the player's game for one of its cvars: `await client.queryCvar("fps_max")`, the value as text, or `null` when his game has none. */
	queryCvar(name: string): Promise<string | null>;
}

// @ts-ignore: decorator
@external("env", "player_slots") declare function _playerSlots(at: usize): void;
// @ts-ignore: decorator
@external("env", "player_names") declare function _playerNames(at: usize): void;

// One Player a player, so an event hands out no new object and the same
// player is the same object. The module writes 1 into `newPlayers` at a
// slot a new player connects to, and the next lookup makes him his own.
const players = new StaticArray<Player | null>(MAX_PLAYERS + 1);
const newPlayers = new StaticArray<i32>(MAX_PLAYERS + 1);
// A count of each slot's name changes, which the module keeps: a Player
// keeps its name while the count is the one it read it at. Odd while a
// change is under way - from client_infochanged, before which AMX Mod X
// takes the new name, to the next frame - and then a name is not kept.
const nameChanges = new StaticArray<i32>(MAX_PLAYERS + 1);
let playersTold = false;

/** Gives the module the tables it writes, once. */
function tellPlayers(): void {
	playersTold = true;
	_playerSlots(changetype<usize>(newPlayers));
	_playerNames(changetype<usize>(nameChanges));
}

/** @hidden The Player in slot `id`: the same object while that player stays; a new one past the players. */
export function __playerOf(id: number): Player {
	const slot = <i32>id;
	if (<u32>(slot - 1) >= <u32>MAX_PLAYERS) return new Player(id);

	if (!playersTold) tellPlayers();

	if (unchecked(newPlayers[slot]) != 0) {
		unchecked(newPlayers[slot] = 0);
		unchecked(players[slot] = null);
	}

	let player = unchecked(players[slot]);
	if (player == null) {
		player = new Player(id);
		unchecked(players[slot] = player);
	}
	return player;
}

/**
 * A player in the game: everything a Client has, plus health, armor, frags,
 * weapons and the screen.
 *
 * An event about a player gives one as `event.player`; `server.players`
 * lists everyone on the server.
 */
export class Player extends PlayerFields implements Client {
	/**
	 * @hidden The name as last read, and the slot's count of name changes then
	 * (nameChanges); -1 when it was odd - a change under way - so it is not kept.
	 * Only a player in a slot keeps one.
	 */
	__name: string | null = null;
	/** @hidden */
	__nameAt: i32 = -1;
	/**
	 * @hidden The SteamID, the IP and the auth key as last read, kept while
	 * the slot's count (nameChanges) is the one they were read at - a new
	 * player in the slot moves it; null for one not read since. A SteamID
	 * still pending is never kept: it changes when Steam answers.
	 */
	__steamId: string | null = null;
	/** @hidden */
	__ip: string | null = null;
	/** @hidden */
	__authKey: string | null = null;
	/** @hidden */
	__keptAt: i32 = -1;

	constructor(id: number) {
		super(id);
	}

	/**
	 * The player's name.
	 *
	 * Pawn: `get_user_name`
	 */
	get name(): string {
		// A kept name is a load and a compare: `kept != null` on a string is a call.
		const kept = this.__name;
		if (changetype<usize>(kept) != 0 && unchecked(nameChanges[<i32>this.id]) == this.__nameAt) return changetype<string>(kept);
		return this.__readName();
	}

	/**
	 * @hidden Whether a value read now may be kept (__steamId): in a slot,
	 * and its count even. What was kept at another count is let go.
	 */
	__keeps(): bool {
		const slot = <i32>this.id;
		if (<u32>(slot - 1) >= <u32>MAX_PLAYERS) return false;
		if (!playersTold) tellPlayers();
		const at = unchecked(nameChanges[slot]);
		if (at & 1) return false;
		if (at != this.__keptAt) {
			this.__keptAt = at;
			this.__steamId = null;
			this.__ip = null;
			this.__authKey = null;
		}
		return true;
	}

	/** @hidden Whether what is kept was kept at the slot's count now. */
	@inline __keptNow(): bool {
		return unchecked(nameChanges[<i32>this.id]) == this.__keptAt;
	}

	/** @hidden The name read from the game, kept while the slot's count stays. */
	__readName(): string {
		const slot = <i32>this.id;
		if (<u32>(slot - 1) >= <u32>MAX_PLAYERS) return readName(slot);

		if (!playersTold) tellPlayers();
		const at = unchecked(nameChanges[slot]);
		const name = readName(slot);
		this.__name = name;
		this.__nameAt = (at & 1) == 0 ? at : -1;
		return name;
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
		return DEATHS.get(this.id);
	}

	/** The deaths on the scoreboard; setting them tells the scoreboard too. */
	set deaths(value: number) {
		DEATHS.set(this.id, <i32>value);
		sendScoreInfo(this.id, this.frags, value, TEAM.get(this.id));
	}

	/**
	 * The player's team, one of `"TERRORIST"`, `"CT"`, `"SPECTATOR"` or `"UNASSIGNED"`. Correct
	 * right after a team change too. Setting it moves the player.
	 *
	 * Pawn: `cs_get_user_team`, `rg_set_user_team`
	 */
	get team(): Team {
		const index = TEAM.get(this.id);
		return index >= 0 && index < TEAM_NAMES.length ? TEAM_NAMES[index] : "UNASSIGNED";
	}

	/**
	 * Moves the player to another team, as reapi's rg_set_user_team does: the
	 * model is picked for the new team, the scoreboard is told, and the round's
	 * win conditions are not checked - the caller decides when that happens.
	 */
	set team(value: Team) {
		_playerTeam(this.id, teamCell(value));
	}

	/**
	 * Joins a side the way the game joins a player who picks it in the team
	 * menu, appearance picked for him: `player.joinTeam("CT")`. A player who
	 * has just arrived is in the game after it and can spawn, which
	 * `player.team = ...` does not do for him. A living player sent to the
	 * spectators dies quietly: no death, no frag. `false` if the game refused.
	 *
	 * Pawn: `rg_join_team`
	 */
	joinTeam(team: Team): boolean {
		if (team == "UNASSIGNED") return false;
		const joined = _playerJoin(this.id, teamCell(team));
		if (joined >= 0) return joined != 0;

		// Without ReGameDLL, what the player would type: the team menu's slot,
		// then the appearance menu's automatic pick. The menu takes a living
		// player to the spectators only in the freeze time, so he dies quietly
		// first, as ReGameDLL's JoinTeam has him: no death, no frag.
		if (team == "SPECTATOR" && this.isAlive) {
			this.deadFlag = "dead";
			set_pev(this.id, pev_health, 0);
		}
		_botCmd(this.id, `jointeam ${team == "TERRORIST" ? "1" : team == "CT" ? "2" : "6"}`);
		if (team != "SPECTATOR") _botCmd(this.id, "joinclass 5");
		return this.team == team;
	}

	/**
	 * The player's IP address without the port, e.g. `"192.168.0.10"`.
	 *
	 * Pawn: `get_user_ip`
	 */
	get ip(): string {
		const kept = this.__ip;
		if (changetype<usize>(kept) != 0 && this.__keptNow()) return changetype<string>(kept);
		// The fourth argument drops the port, which is what a plugin means by
		// an address nine times out of ten.
		const ip = get_user_ip(this.id, 1);
		if (ip.length > 0 && this.__keeps()) this.__ip = ip;
		return ip;
	}

	/**
	 * The player's SteamID, e.g. `"STEAM_0:1:12345"`. A bot has `"BOT"`, HLTV has `"HLTV"`; until Steam confirms the player it is `"STEAM_ID_PENDING"` (wait for the `"authorized"` event), and on a LAN server `"STEAM_ID_LAN"`. With Reunion a game without Steam gets one made from its key (`authKey`): `"STEAM_..."` or `"VALVE_..."`, as the server's Reunion settings say.
	 *
	 * Pawn: `get_user_authid`
	 */
	get steamId(): string {
		const kept = this.__steamId;
		if (changetype<usize>(kept) != 0 && this.__keptNow()) return changetype<string>(kept);
		const id = get_user_authid(this.id);
		if (id.length > 0 && id != "STEAM_ID_PENDING" && id != "VALVE_ID_PENDING" && this.__keeps()) this.__steamId = id;
		return id;
	}

	/**
	 * The way the player's game proved who he is, as Reunion tells it: one of `"steam"` (a Steam game), `"steamEmu"`, `"revEmu"`, `"revEmu2013"`, `"oldRevEmu"`, `"sc2009"`, `"avsmp"`, `"sxei"`, `"sse3"` (a game without Steam, by the emulator it proved itself with), `"dproto"`, `"hltv"`, or `"unknown"` on a server without Reunion.
	 *
	 * Pawn: `REU_GetAuthtype`
	 */
	get authType(): AuthType {
		const type = _reunion(REUNION_AUTH, this.id);
		return type > 0 && type < AUTH_TYPES.length ? AUTH_TYPES[type] : "unknown";
	}

	/**
	 * The network protocol of the player's game: `48` for today's game, `47` for an old one Reunion lets in. `0` on a server without Reunion.
	 *
	 * Pawn: `REU_GetProtocol`
	 */
	get protocol(): number {
		return max(_reunion(REUNION_PROTOCOL, this.id), 0);
	}

	/**
	 * The key the player's game proved itself with, as Reunion read it: what his SteamID is made from. `""` on a server without Reunion.
	 *
	 * Pawn: `REU_GetAuthKey`
	 */
	get authKey(): string {
		const kept = this.__authKey;
		if (changetype<usize>(kept) != 0 && this.__keptNow()) return changetype<string>(kept);
		const length = _reunionKey(this.id, changetype<usize>(infoBuffer), INFO_MAX);
		const key = String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length);
		if (key.length > 0 && this.__keeps()) this.__authKey = key;
		return key;
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
	 * `true` for an HLTV proxy: a spectator's relay, which `server.players`
	 * leaves out.
	 *
	 * Pawn: `is_user_hltv`
	 */
	get isHltv(): boolean { return this.flags.includes("proxy"); }

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
	 * `false` if the game did not give it. A name read from a config goes
	 * as it is; one the game has no item of is said once in the console.
	 *
	 * Pawn: `rg_give_item`, `give_item`
	 */
	give<T extends ItemName | (string & {})>(item: T): boolean {
		const name = changetype<string>(item);
		const given = _playerGive(this.id, name);
		if (given < 0 && !unknownItems.has(name)) {
			unknownItems.add(name);
			console.error(`player.give("${name}"): the game has no item of that name`);
		}
		return given > 0;
	}

	/**
	 * Takes all the player's weapons away: `player.removeAllItems()`. The
	 * suit - armour and the HUD - stays, unless `{ suit: true }`.
	 *
	 * Pawn: `rg_remove_all_items`, `strip_user_weapons`
	 */
	removeAllItems(options: RemoveAllItemsOptions = {}): void {
		_playerStrip(this.id, options.suit ?? false ? 1 : 0);
	}

	/**
	 * Sets the player's reserve ammo for a weapon he carries: `player.setAmmo("weapon_flashbang", 2)`.
	 *
	 * Pawn: `rg_set_user_bpammo`, `cs_set_user_bpammo`
	 */
	setAmmo(weapon: WeaponName, amount: number): void {
		const item = this.items.find(item => item.classname == weapon);
		if (item) AMMO.set(this.id, <i32>amount, <i32>item.ammoType);
	}

	/**
	 * The player's reserve ammo for a weapon he carries: `player.getAmmo("weapon_ak47")`;
	 * for a grenade, how many he has. `0` for a weapon he does not carry.
	 *
	 * Pawn: `rg_get_user_bpammo`, `cs_get_user_bpammo`
	 */
	getAmmo(weapon: WeaponName): number {
		const item = this.items.find(item => item.classname == weapon);
		return item ? AMMO.get(this.id, <i32>item.ammoType) : 0;
	}

	/**
	 * Respawns the player in the current round, at a spawn point the game picks.
	 *
	 * Pawn: `rg_round_respawn`
	 */
	respawn(): void {
		_playerRespawn(this.id);
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
	 * `player.access.includes("cvar")`.
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
		if (!this.items.some(item => item.classname == weapon)) return false;
		return _playerSwitch(this.id, weapon) != 0;
	}

	/**
	 * Recomputes the player's speed from the weapon in hand, after a slowdown for
	 * instance.
	 *
	 * Pawn: `rg_reset_maxspeed`
	 */
	resetMaxSpeed(): void {
		_playerSpeed(this.id);
	}

	/**
	 * Takes every item of one of the player's slots, with its ammo:
	 * `player.removeItems("primary")`. `false` when one stayed.
	 *
	 * Pawn: `rg_remove_items_by_slot`
	 */
	removeItems(slot: ItemSlot): boolean {
		return _playerRemoveSlot(this.id, ITEM_SLOTS.indexOf(slot) + 1) != 0;
	}

	/**
	 * Drops a weapon the player carries, as the game's `drop` does:
	 * `player.dropItem("weapon_c4")`; with no name, the one in his hands. The
	 * weapon, now in a box on the ground, or `null` when he has none or the
	 * game kept it (a knife).
	 *
	 * Pawn: `rg_drop_item`, `engclient_cmd(id, "drop")`
	 */
	dropItem(weapon: WeaponName | null = null): Weapon | null {
		const name = weapon ?? this.activeItem?.classname ?? "";
		const item = this.items.find(each => each.classname == name);
		if (!item) return null;

		_playerDrop(this.id, name);
		return this.items.some(each => each.id == item.id) ? null : item;
	}

	/**
	 * The model he wears, as his game knows it, e.g. `"vip"`, `"gign"`, or one
	 * of the server's own, `models/player/<model>/<model>.mdl`. Set, it
	 * stays through his respawns and team changes until `resetModel()` -
	 * `setModel` keeps its hitboxes too.
	 *
	 * Pawn: `cs_get_user_model`, `cs_set_user_model`, `rg_set_user_model`
	 */
	get model(): string {
		const length = _playerModelGet(this.id, changetype<usize>(infoBuffer), INFO_MAX);
		return length > 0 ? String.UTF8.decodeUnsafe(changetype<usize>(infoBuffer), length) : this.info.get("model");
	}

	set model(value: string) {
		this.setModel(value);
	}

	/**
	 * Puts a model on him, as `player.model = name` does; `{ hitboxes: true
	 * }` takes the model's own hitboxes too, for a model shaped other than
	 * the game's - precached with `server.precache("models/player/<name>/<name>.mdl")`.
	 *
	 * Pawn: `cs_set_user_model(id, model, true)`, `rg_set_user_model(id, model, true)`
	 */
	setModel(model: string, options: ModelOptions = {}): void {
		let index = 0;
		if (options.hitboxes ?? false) {
			const path = `models/player/${model}/${model}.mdl`;
			index = <i32>new Resource(path).index;
			if (index == 0) console.error(`player.setModel("${model}", { hitboxes: true }): precache "${path}" first`);
		}
		_playerModel(this.id, model, index);
	}

	/**
	 * Gives him back the model the game chose for him, its hitboxes too.
	 *
	 * Pawn: `cs_reset_user_model`, `rg_reset_user_model`
	 */
	resetModel(): void {
		_playerModel(this.id, "", 0);
	}

	/**
	 * The entity he sees the world through - a camera, another player -
	 * or `null` for his own eyes: `player.view = camera`, `player.view =
	 * null` back.
	 *
	 * Pawn: `attach_view`, `engset_view`, `engfunc(EngFunc_SetView, ...)`
	 */
	get view(): Entity | null {
		const id = _playerViewGet(this.id);
		return id <= 0 ? null : id <= get_maxplayers() ? __playerOf(id) : new Entity(id);
	}

	set view(entity: Entity | null) {
		_playerView(this.id, entity == null ? 0 : changetype<Entity>(entity).id);
	}

	/**
	 * The point he sees from: his origin and the view's height above it.
	 *
	 * Pawn: `get_user_origin(id, origin, 1)`
	 */
	get eyes(): Vector {
		return this.origin.add(this.viewOffset);
	}

	/**
	 * The player's aim: `player.aim.entity` is what his view meets first - a
	 * player, an entity, the world - and `player.aim.point` the point.
	 *
	 * Pawn: `get_user_aiming`, `get_user_origin(id, origin, 3)`
	 */
	get aim(): Aim {
		const eyes = this.eyes;
		const hit = trace.line(eyes, eyes.add(Vector.fromAngles(this.viewAngle).scale(AIM_REACH)), { ignore: this });
		return new Aim(hit.end, hit.fraction < 1 ? hit.entity : null, hit.hitGroup);
	}

	/**
	 * Whether he sees an entity: it is inside his field of view and nothing
	 * solid stands between his eyes and it - a player's eyes, an entity's
	 * origin. `false` for one that is gone.
	 *
	 * Pawn: `is_visible`, `is_in_viewcone`, `fm_is_ent_visible`
	 */
	canSee(entity: Entity): boolean {
		if (!entity.exists) return false;
		const id = entity.id;
		const point = id >= 1 && id <= get_maxplayers() ? __playerOf(id).eyes : entity.origin;
		if (!this.facing(point)) return false;
		const hit = trace.line(this.eyes, point, { ignore: this, monsters: false });
		return hit.fraction == 1 || (hit.entity != null && hit.entity!.id == id);
	}

	/**
	 * Whether he sees a point: it is inside his field of view and nothing
	 * solid stands between his eyes and it.
	 *
	 * Pawn: `is_in_viewcone`, `trace_line`
	 */
	canSeePoint(point: number[]): boolean {
		return this.facing(point) && trace.line(this.eyes, point, { ignore: this, monsters: false }).fraction == 1;
	}

	/** Whether a point is inside his field of view, flat as the engine's view cone is: half the fov to each side of where he looks. */
	private facing(point: number[]): bool {
		const eyes = this.eyes;
		const look = Vector.fromAngles(this.viewAngle);
		const toward = new Vector(point[0] - eyes.x, point[1] - eyes.y, 0).normalize();
		const ahead = new Vector(look.x, look.y, 0).normalize();
		const fov = this.fov > 0 ? this.fov : 90;
		return toward.dot(ahead) >= Math.cos(fov * Math.PI / 360);
	}

	/**
	 * Sends him a message of the game by its name, its fields typed as
	 * `server.addMessageListener` hears them: `player.send("team", { target:
	 * other, team: "CT" })`. A field left out goes as `0` or empty text;
	 * every message listener hears it on its way.
	 *
	 * Pawn: `message_begin(MSG_ONE, ...)`, `write_*`, `message_end`, `get_user_msgid`
	 */
	send<K extends keyof ServerSendMap>(name: K, fields: ServerSendMap[K]): void {
		__sendMessage<ServerSendMap[K]>(fields, MSG_ONE, this.id, null);
	}

	/**
	 * Shows the message-of-the-day window: `player.showMotd("Rules: ...")`,
	 * a page's address (`"https://my-server.com/rules"`) or HTML; `title` on
	 * its top, the server's name when left out. The plugins' `"motd"`
	 * listeners do not hear it, as AMX Mod X's do not hear `show_motd`.
	 *
	 * Pawn: `show_motd`
	 */
	showMotd(text: string, title: string = ""): void {
		const name = get_cvar_string("hostname");
		if (title.length > 0) sendServerName(this.id, title);
		const bytes = String.UTF8.encode(text);
		const size = bytes.byteLength;
		let at = 0;
		do {
			let end = min(at + MOTD_CHUNK, size);
			// A chunk ends between whole characters: never inside a UTF-8 sequence.
			while (end < size && (load<u8>(changetype<usize>(bytes) + end) & 0xC0) == 0x80) end--;
			const chunk = String.UTF8.decodeUnsafe(changetype<usize>(bytes) + at, end - at);
			message_begin(MSG_ONE, get_user_msgid("MOTD"), [0, 0, 0], this.id);
			write_byte(end >= size ? 1 : 0);
			write_string(chunk);
			message_end();
			at = end;
		} while (at < size);
		if (title.length > 0) sendServerName(this.id, name);
	}

	/**
	 * Slaps the player as an admin's slap does: a push in a random direction,
	 * his view jolted, a pain sound, and `damage` taken from his health - the
	 * last of it kills him.
	 *
	 * Pawn: `user_slap`
	 */
	slap(damage: number = 0): void {
		if (!this.isAlive) return;

		if (damage >= this.health) {
			this.kill();
			return;
		}
		this.health -= damage;
		const push = this.velocity;
		push.x += (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 60);
		push.y += (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 60);
		push.z += 200 + Math.random() * 50;
		this.velocity = push;
		this.punchAngle = [Math.random() * 40 - 20, Math.random() * 40 - 20, 0];
		this.emitSound(SLAP_SOUNDS[<i32>Math.floor(Math.random() * SLAP_SOUNDS.length)]);
	}

	/**
	 * The country the player connects from, in English, e.g. `"Germany"`; `null`
	 * when the GeoIP database does not know his address (a LAN, a bot) or the
	 * server has none.
	 *
	 * Pawn: `geoip_country_ex`
	 */
	get country(): string | null { return countryOf(this.ip, GEO_NAME); }

	/**
	 * The two letters of the country the player connects from, e.g. `"DE"`;
	 * `null` when the GeoIP database does not know his address or the server
	 * has none.
	 *
	 * Pawn: `geoip_code2_ex`
	 */
	get countryCode(): string | null { return countryOf(this.ip, GEO_CODE); }

	/**
	 * The player's number for the server's commands, which stays while he is
	 * on the server: `` server.command(`kick #${player.userId}`) ``.
	 *
	 * Pawn: `get_user_userid`
	 */
	get userId(): number { return _playerStat(this.id, STAT_USER_ID); }

	/**
	 * The player's ping, in milliseconds, as the scoreboard shows it.
	 *
	 * Pawn: `get_user_ping`
	 */
	get ping(): number { return _playerStat(this.id, STAT_PING); }

	/**
	 * The share of his packets lost, in percent, as the scoreboard's ping
	 * column has it.
	 *
	 * Pawn: `get_user_ping(id, ping, loss)`
	 */
	get loss(): number { return _playerStat(this.id, STAT_LOSS); }

	/**
	 * The player's time on the server since he connected, in seconds.
	 *
	 * Pawn: `get_user_time`
	 */
	get connectedSeconds(): number { return _playerStat(this.id, STAT_CONNECTED); }

	/**
	 * The settings the player's game tells the server - his userinfo:
	 * `player.info.get("cl_righthand")`, `player.info.set("_vgui_menus", "0")`.
	 *
	 * Pawn: `get_user_info`, `set_user_info`
	 */
	get info(): UserInfo { return new UserInfo(this.id); }

	/**
	 * Whether the player's steps make no sound: `player.silentSteps = true`.
	 * It lasts until he respawns.
	 *
	 * Pawn: `set_user_footsteps`, `rg_set_user_footsteps`
	 */
	get silentSteps(): boolean { return _playerSilent(this.id, -1) != 0; }
	set silentSteps(value: boolean) { _playerSilent(this.id, value ? 1 : 0); }

	/**
	 * Sends the player a message; to everyone, `server.print`.
	 *
	 * ```ts
	 * player.print("Health restored!");                // the player's chat
	 * player.print("Health restored!", "center");      // the middle of the player's screen
	 * server.print("Round starts in 5 seconds");       // everyone's chat
	 * ```
	 *
	 * `variant` is where the message shows, one of `"chat"` (the default),
	 * `"center"` - the middle of the screen, `"console"` - the player's
	 * console, `"notify"` - the console too; CS shows it on screen only with
	 * `developer 1`.
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
	print(message: string, variant: VariantName = "chat"): void {
		send(<i32>this.id, variantOf(variant), message);
	}

	/**
	 * Runs a command in the player's own console, as if he had typed it:
	 * `player.command("messagemode say_team")`, `player.command("stop")`.
	 * The player's game runs it, not the server. A bot has no game: its
	 * command goes to the server as one it sent, `bot.command("say /hp")`.
	 *
	 * Pawn: `client_cmd`
	 */
	command(text: string): void {
		if (this.isBot) _botCmd(this.id, text);
		else new Call(NATIVE_client_cmd).num(this.id).str("%s").str(text).run();
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
	 * Moves a bot `server.addBot` made, as a player's keys and mouse would for
	 * one frame: `bot.move({ forward: 250, buttons: ["jump"] })`. A bot does
	 * nothing by itself, so it is moved every frame - in the `"frame"` event -
	 * or it stands still. A player who is not a bot is refused with an error.
	 *
	 * Pawn: `engfunc(EngFunc_RunPlayerMove, ...)`
	 */
	move(options: MoveOptions = {}): void {
		if (!this.isBot) throw new Error(`move: ${this.name} is not a bot - only a bot is moved by a plugin`);

		const angles: number[] = options.angles ?? this.getViewAngle(moveAngles);
		const pressed = options.buttons;
		const buttons = pressed != null ? BUTTON.maskOf<Button>(pressed) : 0;
		const msec = options.msec ?? frameTime() * 1000;
		engfunc(EngFunc_RunPlayerMove, this.id, angles, options.forward ?? 0, options.side ?? 0, options.up ?? 0, buttons, 0, <i32>Math.round(Math.min(Math.max(msec, 1), 255)));
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

		if (!cvarAnswerHeard) {
			cvarAnswerHeard = true;
			_stockHook(STOCK_CVAR_ANSWER, hostIndex<WideHandler>(cvarAnswered, true), 0);
		}
		const request = _queryCvar(this.id, name);
		if (request == 0) {
			__co_resolve<string | null>(promise, null);
			return promise;
		}
		const query = new CvarQuery(request, promise);
		query.guard = new __AbortGuard(query, this.signal);
		cvarQueries.push(query);
		return promise;
	}
}

// ---------------------------------------------------------------- a client's cvars

// The questions sent and not answered yet, by the id the module gave each.
// The engine hands every answer to the game, which the module hears, with
// the player, the id, the cvar's name and its value.
class CvarQuery extends __AbortWatch {
	guard: __AbortGuard | null = null;

	constructor(public request: i32, public promise: Promise<string | null>) {
		super();
	}

	/** The player left, or what awaits the answer gave up. */
	run(reason: Error): void {
		forgetQuery(this);
		this.promise.__reject(reason);
	}
}

const cvarQueries: CvarQuery[] = [];
let cvarAnswerHeard = false;

function forgetQuery(query: CvarQuery): void {
	const at = cvarQueries.indexOf(query);
	if (at >= 0) cvarQueries.splice(at, 1);
	(query.guard as __AbortGuard).release();
}

/** A client's answer: (player, id, cvar, value) - its id is one of this plugin's questions, or another's. */
function cvarAnswered(player: number, request: number, c: number, d: number): void {
	for (let i = 0; i < cvarQueries.length; i++) {
		const query = cvarQueries[i];
		if (query.request != <i32>request) continue;

		forgetQuery(query);
		// What the engine answers for a cvar the client has not, or will not tell.
		const text = argText(3);
		const unknown = text == "Bad CVAR request" || text == "CVAR is privileged";
		__co_resolve<string | null>(query.promise, unknown ? null : text);
		return;
	}
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

	get_players(changetype<i32>(list), changetype<i32>(count), flags, team);

	const ids: number[] = [];
	for (let i = 0; i < unchecked(count[0]); i++) ids.push(unchecked(list[i]));
	return ids;
}

// Server's event name is typed like a DOM one - `K extends keyof ServerEventMap`,
// and a message's `K extends keyof ServerMessageMap` -
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

/** The options of a command: who may use it, its description in a listing, the chat it is heard in. */
export interface CommandOptions {
	/** The admin right a player needs to use the command; left out, everyone may. */
	access?: Access;
	/** The command's description, for `server.commands` - what a `/help` prints. */
	description?: string;
	/** The chat a chat command is heard in, one of: `"say"` the common chat, `"team"` the team's, `"both"` either (the default). */
	chat?: "say" | "team" | "both";
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
		readonly server: boolean,
		/** The command's other names, as `addCommand(["/cp", "cp"], ...)` gave them; `[]` for none. */
		readonly aliases: string[] = []
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
	/** How many words were typed. */
	count: i32;
	/** The player an async handler started before this command ran under, given back once it is done (__commandDone). */
	ambient: i32 = 0;
	private read: string[] | null;

	constructor(
		/** The player who typed it; `null` for the server's console. */
		public player: Player | null,
		public usage: string,
		/** The words; `null` for the engine's command that runs, read the first time they are asked. */
		words: string[] | null,
		/** The line from each word on, as typed: what the last text argument takes; `null` for the words joined by a space. */
		readonly rests: string[] | null = null
	) {
		this.read = words;
		this.count = words != null ? words.length : 0;
	}

	/** The object for the engine's command that runs now, typed with `argc` words, its name counted (consoleWords). */
	@inline again(player: Player | null, usage: string, argc: i32): __CommandWords {
		this.failed = false;
		this.player = player;
		this.usage = usage;
		this.read = null;
		this.count = argc - 1;
		return this;
	}

	/** The words, read from the engine's command while it runs: a command that takes none makes nothing. */
	private get words(): string[] {
		let words = this.read;
		if (words == null) {
			words = [];
			for (let i = 1; i <= this.count; i++) words.push(read_argv(i));
			this.read = words;
		}
		return words;
	}

	/** The word at `at`; `""` when it was not typed. */
	text(at: i32): string {
		return at < this.count ? this.words[at] : "";
	}

	/** The rest of the line from the word at `at`. */
	rest(at: i32): string {
		const rests = this.rests;
		if (rests != null) return at < rests.length ? rests[at] : "";
		return at < this.count ? this.words.slice(at).join(" ") : "";
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
	@inline need(count: i32): bool {
		if (this.count < count) this.fail("");
		return !this.failed;
	}

	/** Whether no word is left over after the first `count`; one more fails. */
	@inline done(count: i32): bool {
		if (this.count > count) this.fail("");
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
		if (why.length > 0) player.print(why);
		player.print(usage);
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

/** A console command's words, as the engine split them: `argc` of them, its name counted. */
// @ts-ignore: decorator
@inline function consoleWords(player: Player | null, usage: string, argc: i32): __CommandWords {
	let words = spareWords;
	spareWords = null;
	if (words == null) words = new __CommandWords(player, usage, null);
	return words.again(player, usage, argc);
}

// A console command's words are read by the build's code for the command
// before its handler is called, and kept by nothing: the next command takes
// the same object again once this one is done with it (doneWith). A command
// that runs while another is handled makes its own.
let spareWords: __CommandWords | null = null;

// @ts-ignore: decorator
@inline function doneWith(words: __CommandWords): void {
	words.player = null;
	spareWords = words;
}

// The players' commands of this plugin, by name, each with its info - a
// command of several names once for each; the chat handler finds one by the
// name in the line. commandInfos is every command, the server's too:
// server.commands.
const commandNames: string[] = [];
const commandRuns: ((words: __CommandWords) => void)[] = [];
const playerCommandInfos: CommandInfo[] = [];
// The chats a chat command is heard in: CHAT_SAY, CHAT_TEAM or both.
const commandChats: i32[] = [];
const CHAT_SAY: i32 = 1;
const CHAT_TEAM: i32 = 2;
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
 * [`"immunity"`, `"reservation"`, `"kick"`]. An unknown letter is skipped.
 *
 * Pawn: `read_flags`
 */
export function accessOf(letters: string): Access[] {
	return <Access[]>ACCESS.namesOf(read_flags(letters));
}

/** Whether a player holds the admin flag a command asks for. */
function mayRun(id: i32, at: i32): bool {
	const access = playerCommandInfos[at].access;
	if (access == null) return true;
	return (get_user_flags(id) & ACCESS.bitOf(access)) != 0;
}

/**
 * The chat line, as the game reads it: the command's arguments, without the
 * quotes a game's chat puts around them - `say /kick bob` typed in the
 * console comes unquoted.
 */
function chatLine(): string {
	const line = read_args().trim();
	return line.length >= 2 && line.startsWith("\"") && line.endsWith("\"") ? line.substring(1, line.length - 1).trim() : line;
}

/** Whether the chat command at `at` is heard in the chat the line came in; the chat is read only for one heard in a single one. */
function heardIn(at: i32): bool {
	const chats = commandChats[at];
	if (chats == (CHAT_SAY | CHAT_TEAM)) return true;
	return (chats & (read_argv(0) == "say_team" ? CHAT_TEAM : CHAT_SAY)) != 0;
}

/** say /name a b - the chat text, its first word the name; or a phrase added as "say <phrase>", the whole line. */
function chatCommand(player: number, level: number, cid: number, unused: number): void {
	const id = <i32>player;
	const text = chatLine();
	const space = text.indexOf(" ");
	const slash = text.startsWith("/");
	const at = slash ? findCommand(space < 0 ? text : text.substring(0, space)) : findCommand("say " + text);
	if (at < 0 || !heardIn(at) || !mayRun(id, at)) { _outcome(0); return; }
	runCommand(at, id, chatWords(__playerOf(id), playerCommandInfos[at].usage, slash && space >= 0 ? text.substring(space + 1) : ""));
}

/**
 * name a b - the console command at `at` - its tag less one (_tag) - as the
 * module runs a command: the player, the command's right, 0, and how many
 * words the engine split it into, its name counted.
 */
function consoleCommand(tag: i32, id: i32, access: i32, unused: i32, argc: i32): void {
	const words = __commandWords(tag, id, argc);
	commandRuns[tag - 1](words);
	__commandDone(words);
}

/**
 * @hidden The words of the player's console command at `tag` - its tag, as
 * consoleCommand takes it - with the player made the one an async handler
 * runs under (see __co_ambient_player). The build's own function for a
 * command whose handler is a function declared by name
 * (scripts/typed-commands.ts) is called by the module in consoleCommand's
 * place: it takes them, calls the handler directly, and gives them back with
 * __commandDone.
 */
// @ts-ignore: decorator
@inline export function __commandWords(tag: i32, id: i32, argc: i32): __CommandWords {
	const words = consoleWords(__playerOf(id), playerCommandInfos[tag - 1].usage, argc);
	words.ambient = __co_ambient_player;
	__co_ambient_player = id;
	return words;
}

/**
 * @hidden Tells the player who typed the command at `tag` with words it does
 * not take its usage: the build's own function for a command of no words
 * makes none to run it.
 */
export function __commandUsage(tag: i32, id: i32): void {
	const words = consoleWords(__playerOf(id), playerCommandInfos[tag - 1].usage, 2);
	words.done(0);
	doneWith(words);
}

/** @hidden Gives back the words __commandWords took, once the command is done. */
// @ts-ignore: decorator
@inline export function __commandDone(words: __CommandWords): void {
	__co_ambient_player = words.ambient;
	doneWith(words);
}

/**
 * Runs a player's chat command, under the player's signal as a console
 * command (__commandWords). A command a handler of the module's runs is
 * handled unless it says otherwise, so a chat command is not repeated in
 * chat, as a Pawn command's PLUGIN_HANDLED does.
 */
// @ts-ignore: decorator
@inline function runCommand(at: i32, id: i32, words: __CommandWords): void {
	const ambient = __co_ambient_player;
	__co_ambient_player = id;
	commandRuns[at](words);
	__co_ambient_player = ambient;
}

// The server commands of this plugin; the module finds each by its name.
const serverCommandRuns: ((words: __CommandWords) => void)[] = [];
const serverCommandUsages: string[] = [];

// A touch the module filters by class, so a touch nobody listens for - and
// there is one every frame for a player on the ground - never reaches the
// plugin. One hook per pair of classes, its listeners behind it, switched off
// while it has none.
class TouchFilter {
	listeners: __Listeners<TouchListener> = new __Listeners<TouchListener>();
	hook: __Switch = new __Switch();
	constructor(public toucher: string, public touched: string) {}
}

const touchFilters: TouchFilter[] = [];

// A Ham Sandwich function's hook waiting for plugin_init: the module makes an
// entity of the class to find the class's functions, which is not for the
// moment a plugin loads.
class HamRegistration {
	constructor(public fn: i32, public classname: string, public handler: WideHandler, public post: bool, public hook: __Switch | null) {}
}

const waitingHams: HamRegistration[] = [];

function registerHam(registration: HamRegistration): void {
	const handle = _ham(registration.fn, registration.classname, hostIndex(registration.handler, true), registration.post ? 1 : 0);
	const hook = registration.hook;
	if (hook == null || handle == 0) return;
	hook.add((on: bool): void => _hookOn(handle, on ? 1 : 0));
}

/**
 * @hidden The hood of a game event of a Ham Sandwich function (as/hooks.ts):
 * `fn` hooked on the class, switched by `hook`.
 */
export function __ham(fn: i32, classname: string, handler: WideHandler, post: bool, hook: __Switch | null = null): void {
	const registration = new HamRegistration(fn, classname, handler, post, hook);
	if (serverUp) registerHam(registration);
	else waitingHams.push(registration);
}

/** name a b - the server command at `at` (consoleCommand), typed in the server console or sent over rcon. */
function serverCommand(tag: i32, id: i32, access: i32, unused: i32, argc: i32): void {
	const at = tag - 1;
	const words = consoleWords(null, serverCommandUsages[at], argc);
	serverCommandRuns[at](words);
	doneWith(words);
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


// HUD messages, sent by the module (runtime/src/hud.h).
// @ts-ignore: decorator
@external("env", "hud_line")  declare function _hudLine(): i32;
// @ts-ignore: decorator
@external("env", "hud_show")  declare function _hudShow(id: i32, line: i32, params: usize, text: string): void;
// @ts-ignore: decorator
@external("env", "hud_clear") declare function _hudClear(id: i32, line: i32): void;

// What hud_show reads: where, the effect, the colour, the times, the channel, large.
const hudParams = new StaticArray<f64>(12);

/** A HUD message to a player or to everyone (0), on a line's channel (0: an automatic one). A field left out is AMX Mod X's own default, set_hudmessage's. */
function showHudTo(id: i32, text: string, options: HudOptions, line: i32 = 0): void {
	// Read, not kept: no default is made for a field left out.
	const color = options.color;
	const colors = color != null ? color.length : 0;
	const effect = options.effect;
	const params = hudParams;
	unchecked(params[0] = options.x ?? -1.0);
	unchecked(params[1] = options.y ?? 0.35);
	unchecked(params[2] = effect == null ? 0 : effect == "flicker" ? 1 : effect == "typewriter" ? 2 : 0);
	unchecked(params[3] = colors > 0 ? unchecked(color![0]) : 200);
	unchecked(params[4] = colors > 1 ? unchecked(color![1]) : 100);
	unchecked(params[5] = colors > 2 ? unchecked(color![2]) : 0);
	unchecked(params[6] = options.effectTime ?? 6.0);
	unchecked(params[7] = options.hold ?? 12.0);
	unchecked(params[8] = options.fadeIn ?? 0.1);
	unchecked(params[9] = options.fadeOut ?? 0.2);
	unchecked(params[10] = options.channel ?? -1);
	unchecked(params[11] = options.large ?? false ? 1 : 0);
	_hudShow(id, line, changetype<usize>(params), text);
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
	private handle: i32 = 0;

	/** Shows `text` to the player on this line, replacing what it showed him before. */
	show(player: Player, text: string, options: HudOptions = {}): void {
		showHudTo(<i32>player.id, text, options, this.line());
	}

	/** Removes the line's message from the player's screen before its time is up. */
	clear(player: Player): void {
		if (this.handle > 0) _hudClear(<i32>player.id, this.handle);
	}

	/**
	 * Shows `text` to everyone on this line: `countdown.showAll(`${left}`)`.
	 *
	 * Pawn: `ShowSyncHudMsg(0, ...)`
	 */
	showAll(text: string, options: HudOptions = {}): void {
		showHudTo(0, text, options, this.line());
	}

	/** Removes the line's message from every screen. */
	clearAll(): void {
		if (this.handle > 0) _hudClear(0, this.handle);
	}

	private line(): i32 {
		if (this.handle == 0) this.handle = _hudLine();
		return this.handle;
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

/** The options of `player.screen.progressBar`. */
export interface ProgressBarOptions {
	/** The bar's fill at the start, in percent; `0`, empty, by default. */
	startPercent?: number;
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
 * Times are in seconds. A message listener hears what the screen sends, as
 * it hears the game's: `"progressBar"` hears `progressBar(seconds)`.
 *
 * Pawn: `ScreenFade`, `ScreenShake`, `StatusIcon`, ...
 */
export class Screen {
	constructor(private id: i32) {}

	// Through the engine (emessage_*): AMX Mod X's message hooks do not see a plugin's message_begin.
	private begin(name: string, reliable: bool = true): void {
		emessage_begin(reliable ? MSG_ONE : MSG_ONE_UNRELIABLE, get_user_msgid(name), [0, 0, 0], this.id);
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
		ewrite_short(fixed(options.duration ?? 1.0, 4096.0));
		ewrite_short(fixed(options.hold ?? 0.0, 4096.0));
		ewrite_short(flags);
		for (let i = 0; i < 4; i++) ewrite_byte(i < color.length ? <i32>color[i] : 255);
		emessage_end();
	}

	/**
	 * Shakes the player's view.
	 *
	 * Pawn: `ScreenShake`
	 */
	shake(options: ShakeOptions = {}): void {
		this.begin("ScreenShake");
		ewrite_short(fixed(options.amplitude ?? 4.0, 4096.0));
		ewrite_short(fixed(options.duration ?? 1.0, 4096.0));
		ewrite_short(fixed(options.frequency ?? 5.0, 256.0));
		emessage_end();
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
		ewrite_byte(status);
		ewrite_string(sprite);
		if (status != 0) {
			for (let i = 0; i < 3; i++) ewrite_byte(i < color.length ? <i32>color[i] : 0);
		}
		emessage_end();
	}

	/**
	 * Shows a hint in the box at the top of the player's screen, as the game
	 * shows its own: `player.screen.hint("Plant the bomb")`.
	 *
	 * Pawn: `rg_hint_message`, `HudTextPro`
	 */
	hint(text: string): void {
		this.begin("HudTextPro");
		ewrite_string(text);
		ewrite_byte(1);
		emessage_end();
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
		ewrite_short(<i32>seconds);
		emessage_end();
	}

	/**
	 * Hides parts of the player's HUD right now. Setting `player.hideHud` does
	 * the same a frame later; this is for when that is too late.
	 *
	 * Pawn: `HideWeapon`
	 */
	hideHud(parts: HideHud[]): void {
		this.begin("HideWeapon");
		ewrite_byte(HIDE_HUD.maskOf(parts));
		emessage_end();
	}

	/**
	 * Shows or hides Counter-Strike's own crosshair on the player's screen.
	 *
	 * Pawn: `Crosshair`
	 */
	crosshair(shown: boolean): void {
		this.begin("Crosshair");
		ewrite_byte(shown ? 1 : 0);
		emessage_end();
	}

	/**
	 * Sets the flashlight icon on the player's HUD: on or off, and the battery in
	 * percent.
	 *
	 * Pawn: `Flashlight`
	 */
	flashlight(on: boolean, battery: number = 100): void {
		this.begin("Flashlight");
		ewrite_byte(on ? 1 : 0);
		ewrite_byte(<i32>battery);
		emessage_end();
	}

	/**
	 * Shows the progress bar in the middle of the player's screen, filling up
	 * over `seconds`; `0` hides it. With `startPercent` it starts part of the
	 * way full and fills the rest of `seconds`:
	 *
	 * ```ts
	 * player.screen.progressBar(4, { startPercent: 50 });   // half full, full in 2 seconds
	 * ```
	 *
	 * Pawn: `BarTime`, `BarTime2`, `rg_send_bartime`, `rg_send_bartime2`
	 */
	progressBar(seconds: number, options: ProgressBarOptions = {}): void {
		const startPercent = options.startPercent ?? 0;
		this.begin(startPercent == 0 ? "BarTime" : "BarTime2");
		ewrite_short(fixed(seconds, 1.0));
		if (startPercent != 0) ewrite_short(fixed(startPercent, 1.0));
		emessage_end();
	}

	/**
	 * The light the player sees, `"a"` the darkest to `"z"` the brightest, as
	 * `server.lightStyle` sets it for everyone; `""` gives him the server's
	 * again: `player.screen.lightStyle("z")` for night vision. The server's
	 * next light and the next map reach him too.
	 *
	 * Pawn: `message_begin(MSG_ONE, SVC_LIGHTSTYLE, ...)`
	 */
	lightStyle(style: string): void {
		_playerLightStyle(this.id, style);
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
 * @hidden A forward the module raises, heard by `fn` (a one-cell handler) only
 * when its argument `arg` is `value`: the module compares it, so a forward
 * that comes often crosses into the plugin for that value alone.
 */
export function __onCell(event: string, fn: i32, arg: i32, value: i32): void {
	_onCell(event, fn, 0, arg, value);
}

// @ts-ignore: decorator
@external("env", "off") declare function _off(event: string, fn: i32): void;

/** @hidden Takes the handler `fn` of a forward the module raises off again: once its event has no listener left. */
export function __off(event: string, fn: i32): void {
	_off(event, fn);
}

// @ts-ignore: decorator
@external("env", "on_direct") declare function _onDirect(event: string, fn: i32, listener: i32, env: i32, view: usize, player: i32): void;

/**
 * @hidden Has the module call `listener` itself, with the event's object
 * `view`, in place of the handler `fn` of a forward the module raises -
 * the walk of its listeners, which would call that one alone; null has the
 * handler called again. `player`: the forward's first cell is the player an
 * async function started there runs under.
 */
export function __onDirect(event: string, fn: i32, listener: usize, view: usize, player: bool): void {
	_onDirect(event, fn, __callee(listener), __calleeEnv(listener), view, player ? 1 : 0);
}

// What playbackEvent's listeners ask of the event the module is raising (runtime/src/module.cpp, PlaybackEvent).
// @ts-ignore: decorator
@external("env", "playback_block") declare function _playbackBlock(): void;
// @ts-ignore: decorator
@external("env", "playback_to") declare function _playbackTo(ids: usize, count: i32): void;

/** @hidden playbackEvent's `preventDefault()`: the module stops the event. */
export function __playbackBlock(): void {
	_playbackBlock();
}

/** @hidden playbackEvent's `recipients`: the module plays the event to these players alone. */
export function __playbackTo(players: Player[]): void {
	const ids = new StaticArray<i32>(players.length);
	for (let i = 0; i < players.length; i++) unchecked(ids[i] = <i32>players[i].id);
	_playbackTo(changetype<usize>(ids), ids.length);
}

/** @hidden The table index of a function value - what calling it calls; 0 for null. */
// @ts-ignore: decorator
@inline export function __callee(fn: usize): i32 {
	return fn != 0 ? load<i32>(fn) : 0;
}

/** @hidden A function value's closure variables, set before it is called; 0 for null or a plain function. */
// @ts-ignore: decorator
@inline export function __calleeEnv(fn: usize): i32 {
	return fn != 0 ? load<i32>(fn, 4) : 0;
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
 * server.addMessageListener("botProgress", (event) => {
 *   console.log(`${event.args.length} ${event.args.number(0)}`);
 * });
 * ```
 *
 * Pawn: `get_msg_args`, `get_msg_arg_*`, `set_msg_arg_*`
 */
export class MessageArgs {
	/** The number of arguments. */
	get length(): number {
		return _msgArgc();
	}

	/** Whether the argument at `index` is text; otherwise it is a number. */
	isText(index: number): boolean {
		return _msgArgType(<i32>index) == ARG_STRING;
	}

	/** The argument at `index` as a number: a byte, a short, a coordinate, an angle. */
	number(index: number): number {
		return _msgNumber(<i32>index);
	}

	/** The argument at `index` as text. */
	text(index: number): string {
		const length = _msgText(<i32>index, changetype<i32>(textBuf), textBuf.length);
		return String.UTF8.decodeUnsafe(changetype<usize>(textBuf), length);
	}

	/** Writes a number argument: the message goes out with it. */
	setNumber(index: number, value: number): void {
		_msgSetNumber(<i32>index, value);
	}

	/** Writes a text argument: the message goes out with it. */
	setText(index: number, value: string): void {
		_msgSetText(<i32>index, value);
	}
}

const messageArgs = new MessageArgs();

/**
 * A message the server sends its clients - a chat line, the round clock, a
 * HUD icon - heard on its way, before it leaves:
 *
 * ```ts
 * server.addMessageListener("text", (event) => {
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
	/** @hidden The player it goes to: the message's msg_entity. */
	__receiver: i32 = 0;

	/** The game's name of the message, e.g. `"TextMsg"` for `text`. */
	name: string = "";

	/** The player the message goes to; `null` for a message to everyone. */
	get player(): Player | null {
		return this.__receiver >= 1 && this.__receiver <= get_maxplayers() ? __playerOf(this.__receiver) : null;
	}

	/** The message's arguments, by their place: `event.args.text(1)`. */
	get args(): MessageArgs {
		return messageArgs;
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
		return arg <= _msgArgc();
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
		return this.__has(arg) ? this.args.text(arg - 1) : "";
	}

	/** @hidden */
	protected __setText(arg: i32, value: string): void {
		if (this.__has(arg)) this.args.setText(arg - 1, value);
	}

	/** @hidden Every text from the argument on. */
	protected __texts(arg: i32): string[] {
		const texts: string[] = [];
		for (let at = arg; this.__has(at); at++) texts.push(this.args.text(at - 1));
		return texts;
	}

	/** @hidden Writes the texts from the argument on, as many as the message has. */
	protected __setTexts(arg: i32, value: string[]): void {
		for (let i = 0; i < value.length && this.__has(arg + i); i++) this.args.setText(arg + i - 1, value[i]);
	}

	/** @hidden A player's number argument; `0` or past the players is none. */
	protected __player(arg: i32): Player | null {
		const id = <i32>this.__number(arg);
		return id >= 1 && id <= get_maxplayers() ? __playerOf(id) : null;
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

/** The options of `server.send`: the players a message goes to. */
export interface SendOptions {
	/** Only to the players who can see this point, as effects go - not reliably. */
	near?: Vector | null;
}

/**
 * @hidden A message being sent by its fields (player.send): each argument's
 * number or text by its place from 1, set as a heard message's fields set
 * theirs, then written in the message's order.
 */
export class __MessageOut {
	private numbers: f64[] = [];
	private texts: string[] = [];

	/** How many arguments it has: the last one set. */
	get count(): i32 {
		return this.numbers.length;
	}

	int(arg: i32): i32 {
		return <i32>this.__number(arg);
	}

	number(arg: i32): f64 {
		return this.__number(arg);
	}

	text(arg: i32): string {
		return arg <= this.texts.length ? this.texts[arg - 1] : "";
	}

	/** Begins the message through the engine, so every listener hears it; false for a message the game does not have. */
	begin(message: string, dest: i32, player: i32, origin: Vector | null): bool {
		const type = get_user_msgid(message);
		if (type <= 0) return false;
		emessage_begin_f(dest, type, origin != null ? [origin.x, origin.y, origin.z] : [0, 0, 0], player);
		return true;
	}

	__number(arg: i32): f64 {
		return arg <= this.numbers.length ? this.numbers[arg - 1] : 0;
	}

	__setNumber(arg: i32, value: f64): void {
		this.reach(arg);
		this.numbers[arg - 1] = value;
	}

	__setText(arg: i32, value: string): void {
		this.reach(arg);
		this.texts[arg - 1] = value;
	}

	__setTexts(arg: i32, value: string[]): void {
		for (let i = 0; i < value.length; i++) this.__setText(arg + i, value[i]);
	}

	__setVector(arg: i32, value: number[]): void {
		for (let i = 0; i < 3; i++) this.__setNumber(arg + i, i < value.length ? value[i] : 0);
	}

	__setBytes(arg: i32, value: number[]): void {
		for (let i = 0; i < value.length; i++) this.__setNumber(arg + i, value[i]);
	}

	__setBit(arg: i32, bit: i32, on: bool): void {
		const mask = <i32>this.__number(arg);
		this.__setNumber(arg, on ? mask | bit : mask & ~bit);
	}

	private reach(arg: i32): void {
		while (this.numbers.length < arg) {
			this.numbers.push(0);
			this.texts.push("");
		}
	}
}

// One hook of the module per message name, its listeners behind it: the
// module holds only the messages a plugin listens to. Made when the server is
// up - the game numbers its messages as the map loads - and switched off with
// no listener left.
class MessageChannel {
	listeners: __Listeners<(event: ClientMessage) => void> = new __Listeners<(event: ClientMessage) => void>();
	hook: __Switch = new __Switch();
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

function listenToMessage<E>(name: string, listener: (event: E) => void): void {
	let channel = messageChannel(name);

	if (channel == null) {
		channel = new MessageChannel(name, (): ClientMessage => changetype<ClientMessage>(instantiate<E>()));
		messageChannels.push(channel);
		if (serverUp) registerMessage(channel);
		else waitingMessages.push(channel);
	}

	channel.listeners.push(changetype<(event: ClientMessage) => void>(listener));
	channel.hook.set(true);
}

function stopListeningToMessage<E>(name: string, listener: (event: E) => void): void {
	const channel = messageChannel(name);
	if (channel == null) return;
	channel.listeners.remove(changetype<(event: ClientMessage) => void>(listener));
	channel.hook.set(channel.listeners.count > 0);
}

function registerMessage(channel: MessageChannel): void {
	const id = get_user_msgid(channel.name);

	if (id == 0) {
		console.error(`${channel.name} - the game has no message by that name`);
		return;
	}

	const fired = (receiver: number, message: number, dest: number, d: number): void => messageFired(channel, <i32>receiver);
	__messageHook(id, fired, channel.hook);
}

/**
 * @hidden A handler of the game's message `id` (receiver, id, destination),
 * switched by `hook`: it reads the message with a ClientMessage's `args`,
 * and handled() keeps it from the clients.
 */
export function __messageHook(id: i32, handler: WideHandler, hook: __Switch | null): void {
	const handle = _msgHook(id, hostIndex(handler, true));
	if (hook != null && handle != 0) hook.add((on: bool): void => _hookOn(handle, on ? 1 : 0));
}

/** A message's listeners: the module hands its receiver, 0 for a message to everyone. */
function messageFired(channel: MessageChannel, receiver: i32): void {
	const event = channel.make();
	event.name = channel.name;
	event.__receiver = receiver;
	const listeners = channel.listeners;
	const n = listeners.begin();
	for (let i = 0; i < n; i++) {
		const listener = listeners.at(i);
		if (listener) listener(event);
	}
	listeners.end();
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
 * server.addEventListener("playerChange", (event) => {
 *   event.player.print(event.value ? "You are protected" : "Your spawn protection is over");
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
		return __playerOf(this.__slot);
	}
}

/** The third argument of `server.addEventListener`. */
export interface ServerListenerOptions {
	/**
	 * For `"playerChange"`: the field listened for, e.g. `"spawnProtected"`, or
	 * an object field's member, `"glow.enabled"`; an object field's name
	 * hears each of its members. Left out, every field.
	 */
	field?: string;
}

// This plugin's playerChange listeners. The module wakes the plugin only for
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

const playerChangeListeners = new __Listeners<PlayerChangeListener>();
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
	for (let i = 0; i < playerChangeListeners.slots; i++) {
		const one = playerChangeListeners.at(i);
		if (one == null || one.field != field || one.listener != fn) continue;
		playerChangeListeners.removeAt(i);
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

	const n = playerChangeListeners.begin();
	for (let i = 0; i < n; i++) {
		const one = playerChangeListeners.at(i);
		if (one == null || !hears(one.field, key)) continue;
		const event = one.make();
		event.__slot = slot;
		event.field = key;
		event.__previousNumber = previousNumber;
		event.__previousText = previousText;
		event.__number = number;
		event.__text = text;
		one.listener(event);
	}
	playerChangeListeners.end();
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
 * its plugin_init at the earliest - often before this plugin's - and by then
 * the plugins have loaded, so a Cvar the native makes (a register_cvar native
 * of the plugin's) is made at once rather than when this plugin's init comes.
 */
export function __nativeCall(): void {
	if (!cvarsReady) makeWaitingCvars();
}

function cvarChanged(pointer: number, oldText: number, newText: number, unused: number): void {
	for (let i = 0; i < watchedCvars.length; i++) {
		const cvar = watchedCvars[i];
		if (cvar.pointer != <i32>pointer) continue;
		cvar.__text = null;
		if (cvar.__heard()) cvar.dispatch(new CvarChangeEvent(cvar, argText(1), argText(2)));
		return;
	}
}

// @ts-ignore: decorator
@external("env", "cvar_exact") declare function _cvarExact(): i32;

// Whether the module hears a cvar's change as it is made, so a Cvar keeps
// its text (Cvar.value); 1 or 0 once asked, -1 before. Where it compares
// the cvars once a frame instead, a Cvar reads its text every time.
let cvarsExact: i32 = -1;

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
	private listeners = new __Listeners<CvarListener>();
	private hooked: bool = false;
	/** @hidden The text as last read, kept until the cvar changes (cvarChanged); null for none. */
	__text: string | null = null;

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
		if (this.listeners.count > 0) this.hook();
	}

	private hook(): void {
		if (this.hooked || this.pointer == 0) return;
		this.hooked = true;
		watchedCvars.push(this);
		_cvarHook(this.name, hostIndex<WideHandler>(cvarChanged, true));
	}

	/** `true` when the server has this cvar. */
	get exists(): bool { return this.pointer != 0; }

	/** The cvar's value as text, e.g. `"250"`. */
	get value(): string {
		const kept = this.__text;
		if (changetype<usize>(kept) != 0) return changetype<string>(kept);
		if (this.pointer == 0) return "";
		const text = get_pcvar_string(this.pointer);
		// Kept from here on, and let go when the cvar changes.
		if (cvarsExact < 0) cvarsExact = _cvarExact();
		if (cvarsExact == 1) {
			this.hook();
			this.__text = text;
		}
		return text;
	}
	set value(text: string) {
		if (this.pointer == 0) return;
		this.__text = null;
		set_pcvar_string(this.pointer, text);
	}

	/** The cvar's value as a number. A whole number is written without a fraction: `"5"`, not `"5.000000"`. */
	get number(): number { return this.pointer != 0 ? get_pcvar_float(this.pointer) : 0; }
	set number(value: number) {
		if (this.pointer == 0) return;
		this.__text = null;
		if (value == Math.floor(value)) set_pcvar_num(this.pointer, <i32>value);
		else set_pcvar_float(this.pointer, value);
	}

	/** The cvar as an on/off switch: `true` for anything but `0`. Writing `true` sets `1`, `false` sets `0`. */
	get boolean(): bool { return this.pointer != 0 && get_pcvar_num(this.pointer) != 0; }
	set boolean(on: bool) {
		if (this.pointer == 0) return;
		this.__text = null;
		set_pcvar_num(this.pointer, on ? 1 : 0);
	}

	/** Calls `listener` whenever the cvar's value changes. */
	addEventListener(type: "change", listener: CvarListener): void {
		this.listeners.push(listener);
		this.hook();
	}

	/** Stops calling a listener added with `addEventListener`. */
	removeEventListener(type: "change", listener: CvarListener): void {
		this.listeners.remove(listener);
	}

	/** @hidden Whether anything listens to the cvar's changes, beyond keeping its text. */
	__heard(): bool {
		return this.listeners.count > 0;
	}

	/** @internal Calls the change listeners; the server does it when the cvar changes. A plugin listens with `addEventListener`. */
	dispatch(event: CvarChangeEvent): void {
		const listeners = this.listeners;
		const n = listeners.begin();
		for (let i = 0; i < n; i++) {
			const listener = listeners.at(i);
			if (listener) listener(event);
		}
		listeners.end();
	}
}

// ---------------------------------------------------------------- env

// A variable of the server's environment, else of addons/amxts/.env: its
// length in bytes, of which `max` are written; -1 when neither has it.
// @ts-ignore: decorator
@external("env", "env_get") declare function _envGet(name: string, out: usize, max: i32): i32;

/**
 * A setting of the server kept out of the plugin's code - a token, a password,
 * a key in a URL: a line of the server's `addons/amxts/.env`, or a variable of
 * its environment, which wins over the file. Without a default it is
 * required: a plugin that reads it does not start while the server has it
 * nowhere.
 *
 * ```ts
 * const token = env("MYPLUGIN_TOKEN");
 * ```
 */
export function env(name: string): string;
/**
 * A setting of the server, as text: `defaultValue` when the server has it
 * nowhere.
 *
 * ```ts
 * const mirror = env("MYPLUGIN_MIRROR", "https://example.com/maps");
 * ```
 */
export function env(name: string, defaultValue: string): string;
/**
 * A setting of the server, as a number: `defaultValue` when the server has it
 * nowhere. A plugin does not start while it is there and no number.
 *
 * ```ts
 * const maxRecords = env("MYPLUGIN_MAX_RECORDS", 100);
 * ```
 */
export function env(name: string, defaultValue: number): number;
/**
 * A setting of the server, as an on/off switch - `1`/`0`, `true`/`false`,
 * `yes`/`no` or `on`/`off`, in any case: `defaultValue` when the server has it
 * nowhere. A plugin does not start while it is there and none of these.
 *
 * ```ts
 * const debug = env("MYPLUGIN_DEBUG", false);
 * ```
 */
export function env(name: string, defaultValue: boolean): boolean;
export function env<T = string>(name: string, defaultValue: T = changetype<T>("")): T {
	const length = _envGet(name, 0, 0);
	if (length < 0) return defaultValue;
	const bytes = new ArrayBuffer(length);
	_envGet(name, changetype<usize>(bytes), length);
	const text = String.UTF8.decode(bytes);
	if (isBoolean<T>()) {
		const word = text.toLowerCase();
		return <T>(word == "1" || word == "true" || word == "yes" || word == "on");
	}
	if (isFloat<T>() || isInteger<T>()) return <T>parseFloat(text);
	return changetype<T>(text);
}

/**
 * The server, an event target like the DOM's: its events, commands, map and
 * the folders AMX Mod X keeps. Used through `server`:
 *
 * ```ts
 * server.addEventListener("putInServer", (event) => {
 *   event.player.print("Welcome!");      // event is a PutinserverEvent
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
	 * Calls `listener` every time the server raises the event `type`.
	 * `"playerChange"` takes the field it is for: `{ field: "spawnProtected" }`.
	 */
	addEventListener<K extends keyof ServerEventMap>(type: K, listener: (event: ServerEventMap[K]) => void, options: ServerListenerOptions = {}): void {
		// @ts-ignore: a field's change is told apart by its field, at compile time
		if (isDefined(changetype<ServerEventMap[K]>(0).__playerChange)) addPlayerChangeListener<ServerEventMap[K]>(options.field ?? "", listener);
		else addServerListener<ServerEventMap[K]>(listener);
	}

	/** Stops calling a listener added with `addEventListener` - the same function and the same options. */
	removeEventListener<K extends keyof ServerEventMap>(type: K, listener: (event: ServerEventMap[K]) => void, options: ServerListenerOptions = {}): void {
		// @ts-ignore: as in addEventListener
		if (isDefined(changetype<ServerEventMap[K]>(0).__playerChange)) removePlayerChangeListener<ServerEventMap[K]>(options.field ?? "", listener);
		else removeServerListener<ServerEventMap[K]>(listener);
	}

	/**
	 * Calls `listener` every time the server sends the message `name` to a
	 * client, before it leaves: the listener reads its fields, changes them, or
	 * stops it with `preventDefault()`.
	 *
	 * ```ts
	 * server.addMessageListener("death", (event) => {
	 *   if (event.headshot) console.log(`${event.killer?.name} - headshot - ${event.victim?.name}`);
	 * });
	 * ```
	 *
	 * The editor lists the names, each with the game's own one in its words:
	 * `death` is the game's `DeathMsg`. A name may hear a few of the game's
	 * messages that are one thing: `progressBar` is `BarTime` and
	 * `BarTime2`, and `event.name` says which one came.
	 *
	 * Pawn: `register_message`
	 */
	addMessageListener<K extends keyof ServerMessageMap>(name: K, listener: (event: ServerMessageMap[K]) => void): void {
		const messages = protocolMessageNames(name);
		for (let i = 0; i < messages.length; i++) listenToMessage<ServerMessageMap[K]>(messages[i], listener);
	}

	/**
	 * Sends everyone a message of the game by its name, its fields typed as
	 * `addMessageListener` hears them: `server.send("score", { target: player,
	 * frags: 10, deaths: 2, team: "CT" })`; with `near`, only the players who
	 * can see that point, as effects go. A field left out goes as `0` or empty
	 * text; every message listener hears it on its way.
	 *
	 * Pawn: `message_begin(MSG_ALL, ...)`, `write_*`, `message_end`, `get_user_msgid`
	 */
	send<K extends keyof ServerSendMap>(name: K, fields: ServerSendMap[K], options: SendOptions = {}): void {
		const near = options.near ?? null;
		__sendMessage<ServerSendMap[K]>(fields, near != null ? MSG_PVS : MSG_ALL, 0, near);
	}

	/** Stops calling a listener added with `addMessageListener` - the same name and the same function. */
	removeMessageListener<K extends keyof ServerMessageMap>(name: K, listener: (event: ServerMessageMap[K]) => void): void {
		const messages = protocolMessageNames(name);
		for (let i = 0; i < messages.length; i++) stopListeningToMessage<ServerMessageMap[K]>(messages[i], listener);
	}

	/**
	 * The current map's name, e.g. `"de_dust2"`.
	 *
	 * Pawn: `get_mapname`
	 */
	get map(): string {
		const kept = keptMap;
		if (changetype<usize>(kept) != 0) return changetype<string>(kept);
		const map = get_mapname();
		if (map.length > 0) keptMap = map;
		return map;
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
		for (let i = 0; i < ids.length; i++) list.push(__playerOf(ids[i]));
		return list;
	}

	/**
	 * Adds a bot under `name`: a player the server runs, with no game behind
	 * it and no mind of its own - it stands where it spawns until a plugin
	 * moves it with `bot.move()`. `null` when no slot is free. `"putInServer"`
	 * fires for it as for anyone, `bot.isBot` is `true` and `bot.kick()`
	 * removes it.
	 *
	 * ```ts
	 * const bot = server.addBot("Dummy");
	 * bot?.joinTeam("CT");
	 * ```
	 *
	 * Pawn: `engfunc(EngFunc_CreateFakeClient)`, `dllfunc(DLLFunc_ClientConnect)`, `dllfunc(DLLFunc_ClientPutInServer)`
	 */
	addBot(name: string): Player | null {
		// The engine takes a slot and marks the client FL_FAKECLIENT; AMX Mod X
		// connects it then and there. The game is told after, as the engine
		// tells it of anyone: it connects and puts the player in the server.
		const id = <i32>engfunc(EngFunc_CreateFakeClient, name);
		if (id <= 0) return null;

		const rejected = new Ref<string>("");
		dllfunc(DLLFunc_ClientConnect, id, name, "127.0.0.1", rejected);
		dllfunc(DLLFunc_ClientPutInServer, id);
		return __playerOf(id);
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
		let dir = keptConfigsDir;
		if (changetype<usize>(dir) != 0) return changetype<string>(dir);
		dir = get_localinfo("amxx_configsdir");
		if (dir.length == 0) dir = "addons/amxmodx/configs";
		keptConfigsDir = dir;
		return dir;
	}

	/**
	 * The AMX Mod X folder for plugins' data files: `addons/amxmodx/data` unless the server moved it.
	 *
	 * Pawn: `get_datadir`
	 */
	get dataDir(): string {
		let dir = keptDataDir;
		if (changetype<usize>(dir) != 0) return changetype<string>(dir);
		dir = get_localinfo("amxx_datadir");
		if (dir.length == 0) dir = "addons/amxmodx/data";
		keptDataDir = dir;
		return dir;
	}

	/**
	 * The AMX Mod X folder for logs: `addons/amxmodx/logs` unless the server moved it.
	 *
	 * Pawn: `get_localinfo("amxx_logs")`
	 */
	get logsDir(): string {
		let dir = keptLogsDir;
		if (changetype<usize>(dir) != 0) return changetype<string>(dir);
		dir = get_localinfo("amxx_logs");
		if (dir.length == 0) dir = "addons/amxmodx/logs";
		keptLogsDir = dir;
		return dir;
	}

	/**
	 * The game's folder, e.g. `"cstrike"`, `"czero"`.
	 *
	 * Pawn: `get_modname`
	 */
	get game(): string {
		return serverText(SERVER_GAME);
	}

	/**
	 * The versions of what the server runs: `server.versions.reGameDll
	 * != null` on ReGameDLL. ReHLDS's and ReGameDLL's are their API's,
	 * `null` on a server without them.
	 *
	 * Pawn: `get_amxx_verstring`, `is_rehlds`, `is_regamedll`
	 */
	get versions(): ServerVersions {
		const reHlds = serverText(SERVER_REHLDS);
		const reGameDll = serverText(SERVER_REGAMEDLL);
		return new ServerVersions(
			serverText(SERVER_AMXTS), get_cvar_string("amxmodx_version"), get_cvar_string("metamod_version"),
			reHlds.length > 0 ? reHlds : null, reGameDll.length > 0 ? reGameDll : null,
		);
	}

	/**
	 * Whether the server has the map: `server.mapExists("de_dust2")`.
	 *
	 * Pawn: `is_map_valid`
	 */
	mapExists(map: string): boolean {
		return _mapValid(map) != 0;
	}

	/**
	 * Goes to the map now: `false`, staying, for a map the server does not
	 * have.
	 *
	 * Pawn: `engine_changelevel`, `server_cmd("changelevel ...")`
	 */
	changeLevel(map: string): boolean {
		return _changeLevel(map) != 0;
	}

	/**
	 * The map's light, `"a"` the darkest to `"z"` the brightest, `"m"` the
	 * map's own: `server.lightStyle = "b"`. It lasts until the map changes.
	 *
	 * Pawn: `set_lights`, `engfunc(EngFunc_LightStyle, 0, ...)`
	 */
	get lightStyle(): string {
		return lightStyle;
	}

	set lightStyle(value: string) {
		lightStyle = value.length > 0 ? value : "m";
		_lightStyle(lightStyle);
	}

	/**
	 * Sends every player a message: `server.print("Round 3")`, in the chat;
	 * `variant` puts it in the middle of the screen (`"center"`) or the
	 * console. Colour tags work as in `player.print`.
	 *
	 * Pawn: `client_print(0, ...)`, `client_print_color(0, ...)`
	 */
	print(message: string, variant: VariantName = "chat"): void {
		send(0, variantOf(variant), message);
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
	 *     if (command.access == null || player.access.includes(command.access)) player.print(command.usage);
	 *   }
	 * });
	 * ```
	 */
	get commands(): CommandInfo[] {
		return commandInfos.slice(0);
	}

	/**
	 * Every plugin on the server, TypeScript and Pawn, read anew each time:
	 * `server.plugins.find(plugin => plugin.file == "shop.aot")?.stop()`.
	 *
	 * Pawn: `get_plugin`, `get_pluginsnum`, `find_plugin_byfile`, `is_plugin_loaded`
	 */
	get plugins(): ServerPlugin[] {
		const list: ServerPlugin[] = [];
		for (let i = 0, n = _pluginsCount(); i < n; i++) {
			list.push(new ServerPlugin(i, "typescript", pluginText(i, PLUGIN_FILE), pluginText(i, PLUGIN_TITLE), pluginText(i, PLUGIN_VERSION), pluginText(i, PLUGIN_AUTHOR)));
		}
		for (let i = 0, n = _pawnPluginsCount(); i < n; i++) {
			list.push(new ServerPlugin(i, "pawn", pawnPluginText(i, PAWN_FILE), pawnPluginText(i, PAWN_TITLE), pawnPluginText(i, PAWN_VERSION), pawnPluginText(i, PAWN_AUTHOR)));
		}
		return list;
	}

	/**
	 * Loads a TypeScript plugin of the server's `plugins` folder the list
	 * does not name, at the next frame: `server.loadPlugin("event.aot")`. It
	 * runs until the map changes.
	 *
	 * Pawn: `amxts_load`
	 */
	loadPlugin(file: string): void {
		_pluginAction(file, PLUGIN_START);
	}

	/**
	 * @hidden A player's command, its words read by `run` - the parser the
	 * build writes for each `addCommand` call (scripts/typed-commands.ts).
	 * `console`: the build's function the module calls for the command typed
	 * in the console, in consoleCommand's place; 0 for consoleCommand.
	 */
	__addCommand(usage: string, run: (words: __CommandWords) => void, options: CommandOptions = {}, console: i32 = 0, aliases: string[] = []): void {
		const access = options.access;
		const chats = options.chat == "say" ? CHAT_SAY : options.chat == "team" ? CHAT_TEAM : CHAT_SAY | CHAT_TEAM;
		const info = new CommandInfo(usage, options.description ?? "", access ?? null, false, aliases);
		commandInfos.push(info);

		const names = [commandName(usage)].concat(aliases);
		for (let i = 0; i < names.length; i++) {
			const name = names[i];
			commandNames.push(name.toLowerCase());
			commandRuns.push(run);
			commandChats.push(chats);
			playerCommandInfos.push(info);

			if (!name.startsWith("/") && !name.startsWith("say ")) {
				// The module finds the command by its name and checks the right.
				const flags = access != null ? ACCESS.bitOf(access) : 0;
				_tag(commandRuns.length);
				_clcmd(name, console != 0 ? console : consoleCommand.index, flags, SHAPE_WIDE);
			} else if (!chatHooked) {
				chatHooked = true;
				_clcmd("say", chatCommand.index, 0, SHAPE_WIDE);
				_clcmd("say_team", chatCommand.index, 0, SHAPE_WIDE);
			}
		}
	}

	/** @hidden A command of the server console, its words read by `run`, as `__addCommand`'s are. */
	__addServerCommand(usage: string, run: (words: __CommandWords) => void): void {
		serverCommandRuns.push(run);
		serverCommandUsages.push(usage);
		commandInfos.push(new CommandInfo(usage, "", null, true));
		_tag(serverCommandRuns.length);
		_srvcmd(commandName(usage), serverCommand.index, SHAPE_WIDE);
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

// What the server tells once a map, read the first time it is asked: a
// plugin is loaded anew with each map.
let keptMap: string | null = null;
let keptConfigsDir: string | null = null;
let keptDataDir: string | null = null;
let keptLogsDir: string | null = null;

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
 * game.addEventListener("fallDamage", (event) => event.result / 2, true);
 * ```
 *
 * The event's type follows from its name. What a listener returns is the
 * answer to the game: before the game acts it replaces what the game would
 * do, after it (`post`) it replaces the result. A listener that returns
 * nothing leaves it to the game; `event.preventDefault()` blocks without an
 * answer. A value of the wrong type is an error in the editor and in the build.
 *
 * The game rules are its fields: `game.isFreezeTime`, `game.ctWins`,
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
		if (idof<GameEventMap[K]>() == idof<EntityStateEvent>()) {
			if (!isVoid<R>()) ERROR("an entityState listener answers nothing: hide the entity with event.preventDefault()");
			addStateListener(changetype<StateListener>(listener), given.classname ?? "");
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
		if (idof<GameEventMap[K]>() == idof<EntityStateEvent>()) {
			removeStateListener(changetype<StateListener>(listener), given.classname ?? "");
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
	 * game.endRound({ winner: "none", message: "" });         // nobody scores, no message
	 * ```
	 *
	 * The winner sets the score, the message and the sound (`"Terrorists Win!"`);
	 * `message` and `sound` replace them, `""` turns them off. The next
	 * round starts after `delay`; to start it over at once, `game.restartRound()`.
	 *
	 * Pawn: `rg_round_end`
	 */
	endRound(options: EndRoundOptions): void {
		const status = max(WINNER_NAMES.indexOf(options.winner), 0);
		const delay = options.delay ?? 5.0;
		const dispatch = options.dispatch ?? false;
		// The roundEnd listeners of amxts plugins are on ReGameDLL's chain, which
		// neither ReAPI's dispatch nor the game's log lines go through: told
		// through the module, before the round ends and after, as written there.
		const cells = roundEndCells;
		if (dispatch && __hasChains(false)) {
			unchecked(cells[0] = status);
			unchecked(cells[1] = ROUND_REASONS[status]);
			unchecked(cells[2] = floatCell(delay));
			if (_chainDispatch(RG_RoundEnd, 0, changetype<usize>(cells), 3, 0) != 0) return;
			this.finishRound(unchecked(cells[0]), cellFloat(unchecked(cells[2])), options, true);
			_chainDispatch(RG_RoundEnd, 1, changetype<usize>(cells), 3, 1);
			return;
		}
		this.finishRound(status, delay, options, dispatch);
	}

	/**
	 * Starts the round over at once, as the game does when it restarts one:
	 * everyone back at a spawn point with the round's money and weapons, the
	 * map cleaned up. The score stays; with `game.completeReset = true` first
	 * it starts from zero, as after `sv_restart`. Every plugin's `newRound`
	 * listeners hear it.
	 *
	 * Pawn: `rg_restart_round`
	 */
	restartRound(): void {
		if (_gameRulesRun(RULES_RESTART_ROUND) == 0) __sayOnce("game.restartRound(): the game has no rules to restart yet, or this game's RestartRound is not where amxts looks for it");
	}

	/**
	 * Has the game check now whether the round is won - after players were
	 * moved between sides or killed by a plugin - and end it if it is, as it
	 * checks after a death.
	 *
	 * Pawn: `rg_check_win_conditions`
	 */
	checkWinConditions(): void {
		if (_gameRulesRun(RULES_CHECK_WIN) == 0) __sayOnce("game.checkWinConditions(): the game has no rules to ask yet, or this game's CheckWinConditions is not where amxts looks for it");
	}

	/**
	 * Swaps the sides: every terrorist a counter-terrorist and back, their
	 * scores too, as the game swaps them halfway through a match.
	 *
	 * Pawn: `rg_swap_all_players`
	 */
	swapTeams(): void {
		for (const player of server.players) {
			if (player.team == "TERRORIST" || player.team == "CT") _playerSwitchTeam(player.id);
		}
		const ct = this.ctWins;
		this.ctWins = this.terroristWins;
		this.terroristWins = ct;
	}

	/**
	 * Evens the sides as the game does at a round's start with
	 * `mp_autoteambalance`: from the bigger side the players who came last,
	 * four at most - on a map with a VIP, a little more counter-terrorists.
	 *
	 * Pawn: `rg_balance_teams`
	 */
	balanceTeams(): void {
		const players = server.players;
		const terrorists = players.filter(player => player.team == "TERRORIST");
		const cts = players.filter(player => player.team == "CT");
		const all = terrorists.length + cts.length;
		let from = terrorists.length > cts.length ? terrorists : cts;
		let count = (abs(terrorists.length - cts.length)) / 2;
		if (this.mapHasVipSafetyZone == "yes") {
			const wanted = all % 2 != 0 ? <i32>(all * 0.55) + 1 : all / 2;
			from = cts.length < wanted ? terrorists : cts;
			count = cts.length < wanted ? wanted - cts.length : (all - wanted) - terrorists.length;
		}
		const moving = from.filter(player => player.id != this.vip).sort((a, b) => <i32>(b.userId - a.userId));
		for (let i = 0; i < min(count, 4) && i < moving.length; i++) _playerSwitchTeam(moving[i].id);
	}

	/**
	 * Seconds until the map ends by its time limit; `Infinity` without one.
	 *
	 * Pawn: `get_timeleft`
	 */
	get timeLeft(): number {
		const end = this.timeLimit;
		return end > 0 ? max(end - this.time, 0) : Infinity;
	}

	private finishRound(status: i32, delay: f64, options: EndRoundOptions, dispatch: bool): void {
		const message = options.message ?? "default";
		const sound = options.sound ?? "default";
		// What the game's TerminateRound does: the winner, the moment the next round starts, and the
		// round marked as ending, so the game does not end it again meanwhile;
		// then the message and the sound.
		this.roundWinner = WINNER_NAMES[status];
		this.roundEnding = true;
		this.newRoundTime = this.time + delay;
		const text = message == "default" ? ROUND_MESSAGES[status] : message;
		const radio = sound == "default" ? ROUND_SOUNDS[status] : sound;
		if (!dispatch) {
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
		const score = `(CT "${this.ctWins}") (T "${this.terroristWins}")`;
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

/** The options of an entity's action such as `weapon.deploy()` or `entity.heal(...)`. */
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
		registerTouch(filter);
	}

	filter.listeners.push(listener);
	filter.hook.set(true);
}

function removeTouchListener(listener: TouchListener, toucher: string, touched: string): void {
	const filter = touchFilter(toucher, touched);
	if (filter == null) return;
	filter.listeners.remove(listener);
	filter.hook.set(filter.listeners.count > 0);
}

/** Hooks one pair of classes' touches: the module calls (touched, toucher). */
function registerTouch(filter: TouchFilter): void {
	const fired = (touched: number, toucher: number, c: number, d: number): void => touchFired(filter, touched, toucher);
	const handle = _touchHook(filter.touched, filter.toucher, hostIndex(fired, true));
	filter.hook.add((on: bool): void => _hookOn(handle, on ? 1 : 0));
}

/** A touch's listeners: (touched, toucher). */
function touchFired(filter: TouchFilter, touched: number, toucher: number): void {
	const event = new TouchEvent(new Entity(toucher), new Entity(touched));
	const listeners = filter.listeners;
	const n = listeners.begin();
	for (let i = 0; i < n; i++) {
		const listener = listeners.at(i);
		if (listener) listener(event);
	}
	listeners.end();
}

// The player's movement the game is running: 0 what he has touched so far,
// 1 the frame's seconds - a movement event's touchCount and frameTime.
// @ts-ignore: decorator
@external("env", "move_get") declare function _moveGet(field: i32): f64;

/** @hidden A field of the movement the game is running, for a movement event. */
export function __moveGet(field: i32): f64 {
	return _moveGet(field);
}

// What a player is sent of each entity (runtime/src/entitystate.h): the
// listeners of a class, the state read and written while they run.
// @ts-ignore: decorator
@external("env", "state_hook") declare function _stateHook(classname: string, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "state_get")  declare function _stateGet(field: i32): f64;
// @ts-ignore: decorator
@external("env", "state_set")  declare function _stateSet(field: i32, value: f64): void;
const STATE_ORIGIN: i32 = 0;
const STATE_ANGLES: i32 = 3;
const STATE_RENDER_MODE: i32 = 6;
const STATE_RENDER_AMOUNT: i32 = 7;
const STATE_RENDER_COLOR: i32 = 8;
const STATE_RENDER_FX: i32 = 11;
const STATE_EFFECTS: i32 = 12;
const STATE_MODEL_INDEX: i32 = 13;
const STATE_BODY: i32 = 14;
const STATE_SKIN: i32 = 15;

function stateVector(field: i32): Vector {
	return new Vector(_stateGet(field), _stateGet(field + 1), _stateGet(field + 2));
}

function setStateVector(field: i32, value: number[]): void {
	for (let i = 0; i < 3; i++) _stateSet(field + i, i < value.length ? value[i] : 0);
}

/**
 * The state of an entity a player can see, as he is sent it this frame:
 * its fields as he will see them. Writing one changes what he sees, not the
 * entity - `event.renderFx = "glowShell"` makes it glow for him alone - and
 * `preventDefault()` hides it from him.
 *
 * ```ts
 * game.addEventListener("entityState", (event) => {
 *   if (event.player.team != "CT") event.preventDefault();
 * }, { classname: "myplugin_marker" });
 * ```
 *
 * Pawn: `register_forward(FM_AddToFullPack, ..., 1)`, `get_es`, `set_es`
 */
export class EntityStateEvent {
	/** @hidden */ __player: i32 = 0;
	/** @hidden */ __entity: i32 = 0;

	/** The player it is sent to. */
	get player(): Player {
		return __playerOf(this.__player);
	}

	/** The entity it is about: a player, or another entity. */
	get entity(): Entity {
		const id = this.__entity;
		return id >= 1 && id <= get_maxplayers() ? __playerOf(id) : new Entity(id);
	}

	/**
	 * The entity's position as he sees it.
	 *
	 * Pawn: `ES_Origin`
	 */
	get origin(): Vector { return stateVector(STATE_ORIGIN); }
	set origin(value: number[]) { setStateVector(STATE_ORIGIN, value); }

	/**
	 * The entity's angles as he sees them.
	 *
	 * Pawn: `ES_Angles`
	 */
	get angles(): Vector { return stateVector(STATE_ANGLES); }
	set angles(value: number[]) { setStateVector(STATE_ANGLES, value); }

	/**
	 * The entity's render mode as he sees it, as its `renderMode`.
	 *
	 * Pawn: `ES_RenderMode`
	 */
	get renderMode(): RenderMode { return renderModeName(<i32>_stateGet(STATE_RENDER_MODE)); }
	set renderMode(value: RenderMode) {
		if (value != "unknown") _stateSet(STATE_RENDER_MODE, renderModeCell(value));
	}

	/**
	 * The entity's opacity as he sees it, `0` to `255`, as its `renderAmount`.
	 *
	 * Pawn: `ES_RenderAmt`
	 */
	get renderAmount(): number { return _stateGet(STATE_RENDER_AMOUNT); }
	set renderAmount(value: number) { _stateSet(STATE_RENDER_AMOUNT, value); }

	/**
	 * The entity's render colour as he sees it, red, green, blue, as its `renderColor`.
	 *
	 * Pawn: `ES_RenderColor`
	 */
	get renderColor(): Vector { return stateVector(STATE_RENDER_COLOR); }
	set renderColor(value: number[]) { setStateVector(STATE_RENDER_COLOR, value); }

	/**
	 * The entity's render effect as he sees it, as its `renderFx`: `"glowShell"` a shell around it.
	 *
	 * Pawn: `ES_RenderFx`
	 */
	get renderFx(): RenderFx { return renderFxName(<i32>_stateGet(STATE_RENDER_FX)); }
	set renderFx(value: RenderFx) {
		if (value != "unknown") _stateSet(STATE_RENDER_FX, renderFxCell(value));
	}

	/**
	 * The entity's effects as he sees them, as its `effects`.
	 *
	 * Pawn: `ES_Effects`
	 */
	get effects(): Effect[] { return <Effect[]>EFFECT.namesOf(<i32>_stateGet(STATE_EFFECTS)); }
	set effects(value: Effect[]) { _stateSet(STATE_EFFECTS, EFFECT.maskOf(value)); }

	/**
	 * The model he sees, by its precache index.
	 *
	 * Pawn: `ES_ModelIndex`
	 */
	get modelIndex(): number { return _stateGet(STATE_MODEL_INDEX); }
	set modelIndex(value: number) { _stateSet(STATE_MODEL_INDEX, value); }

	/**
	 * The model's body part he sees.
	 *
	 * Pawn: `ES_Body`
	 */
	get body(): number { return _stateGet(STATE_BODY); }
	set body(value: number) { _stateSet(STATE_BODY, value); }

	/**
	 * The model's skin he sees.
	 *
	 * Pawn: `ES_Skin`
	 */
	get skin(): number { return _stateGet(STATE_SKIN); }
	set skin(value: number) { _stateSet(STATE_SKIN, value); }

	/** Hides the entity from him this frame. */
	preventDefault(): void {
		handled();
	}
}

/** An entityState listener, as game.addEventListener("entityState", ...) takes one. */
type StateListener = (event: EntityStateEvent) => void;

// One hook per class, its listeners behind it, switched off while it has none.
class StateFilter {
	listeners: __Listeners<StateListener> = new __Listeners<StateListener>();
	hook: __Switch = new __Switch();
	// The one event its listeners get, made again for each entity: this hook runs for every entity a player sees.
	event: EntityStateEvent = new EntityStateEvent();
	constructor(public classname: string) {}
}

const stateFilters: StateFilter[] = [];

function stateFilter(classname: string): StateFilter | null {
	for (let i = 0; i < stateFilters.length; i++) {
		if (stateFilters[i].classname == classname) return stateFilters[i];
	}
	return null;
}

function addStateListener(listener: StateListener, classname: string): void {
	let filter = stateFilter(classname);
	if (filter == null) {
		filter = new StateFilter(classname);
		stateFilters.push(filter);
		const target = filter;
		const fired = (host: number, entity: number, c: number, d: number): void => stateFired(target, <i32>host, <i32>entity);
		const handle = _stateHook(classname, hostIndex(fired, true));
		filter.hook.add((on: bool): void => _hookOn(handle, on ? 1 : 0));
	}
	filter.listeners.push(listener);
	filter.hook.set(true);
}

function removeStateListener(listener: StateListener, classname: string): void {
	const filter = stateFilter(classname);
	if (filter == null) return;
	filter.listeners.remove(listener);
	filter.hook.set(filter.listeners.count > 0);
}

function stateFired(filter: StateFilter, host: i32, entity: i32): void {
	const event = filter.event;
	event.__player = host;
	event.__entity = entity;
	const listeners = filter.listeners;
	const n = listeners.begin();
	for (let i = 0; i < n; i++) {
		const listener = listeners.at(i);
		if (listener) listener(event);
	}
	listeners.end();
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
// ADMIN_* the includes declare, and Event is every forward the module
// raises. They are re-exported here so that a plugin imports one file.
export { Flag } from "./constants";
export * from "./events";

// Re-exporting does not bring a name into this file's own scope, and these
// are used here: `Flag` for a command's default argument, the other two to
// turn an event's short name into the forward the module raises.
import { Flag, FlagName, flagOf, HookName, hookIdOf } from "./constants";
import { Contents, Entity, GameFields, HitGroup, PlayerFields, RenderFx, RenderMode, Weapon, contentsName, hitGroupName, renderFxCell, renderFxName, renderModeCell, renderModeName } from "./entities";
import {
	MSG_ALL, MSG_ONE, MSG_ONE_UNRELIABLE, MSG_PVS, LibType_Library, SPEAK_MUTED, SPEAK_ALL, SPEAK_LISTENALL, ARG_STRING
} from "./constants";
export { Entity, Weapon, WeaponKind, weaponKindOf } from "./entities";
// The names an enum field takes and gives: `entity.renderMode = "additive"`.
export {
	RenderMode, RenderFx, MoveType, Solid, TakeDamage, DeadFlag, WaterLevel, Contents, FixAngle, HitGroup,
	ArmorType, ObserverMode, JoinState, GameMenu, PlayerModel, IgnoredChat, ThrowDirection, BloodColor, MusicState
} from "./entities";
import {
	NATIVE_server_cmd, NATIVE_client_cmd, NATIVE_CreateMultiForward, NATIVE_ExecuteForward, get_gametime, get_mapname,
	client_print
} from "./natives";
import { ET_IGNORE, ET_STOP, FP_ARRAY, FP_CELL, FP_FLOAT, FP_STRING } from "./constants";
import { ROUND_NONE, ROUND_CTS_WIN, ROUND_TERRORISTS_WIN, ROUND_END_DRAW, RG_RoundEnd, print_center } from "./constants";
import { PluginInitEvent, PluginPrecacheEvent, ServerEventMap, ServerMessageMap, ServerSendMap, __sendMessage, addServerListener, protocolMessageNames, removeServerListener } from "./events";

function variantOf(variant: VariantName): i32 {
	// Chat first: the default, and most messages - the default's own string,
	// told by where it is before what it says.
	if (changetype<usize>(variant) == changetype<usize>(Variant.chat) || variant == Variant.chat) return 3;
	if (variant == Variant.center) return 4;
	if (variant == Variant.console) return 2;
	if (variant == Variant.notify) return 1;
	return 3;
}

// One letter is one colour everywhere; a place draws the ones it can and
// drops the rest.
/** The colour tags chat draws: `!y` yellow, `!r` red, `!d` grey, `!g` green, `!b` blue, `!t` the reader's team. */
const CHAT_TAGS = "yrdgbt";
/** The colour tags a menu draws: `!y` yellow, `!r` red, `!d` grey, `!w` white, `!R` to the right edge. */
const MENU_TAGS = "yrdwR";

/** A chat tag's colour code, by its letter: `""` for a menu's tag (`!w`, `!R`), which chat drops; `null` for a letter that is no tag. */
function chatCode(letter: i32): string | null {
	switch (letter) {
		case 0x79: return "\x01";                                  // y
		case 0x67: return "\x04";                                  // g
		case 0x72: case 0x64: case 0x62: case 0x74: return "\x03"; // r d b t: the team colour
		case 0x77: case 0x52: return "";                           // w R
	}
	return null;
}

/** The team whose colour a chat tag's letter asks for: `""` for none. */
function swapOf(letter: i32): string {
	if (letter == 0x72) return "TERRORIST";
	if (letter == 0x62) return "CT";
	if (letter == 0x64) return "SPECTATOR";
	return letter == 0x74 ? SENDER_TEAM : "";
}

// The last line painted and what it became: a plugin prints one line to
// player after player, and send() paints it once.
let paintedText = "";
let painted = "";
let paintedSwap = "";

/** Turns a chat line's colour tags (`!g`, `!r`, ...) into the colour codes the client reads, and records in `swapTeam` which team colour the line needs. `player.print` calls it; exported for tests. */
export function paint(text: string): string {
	swapTeam = "";

	// The text goes over in runs between its tags, not a letter at a time.
	let out = "";
	let from = 0;

	for (let at = text.indexOf("!"); at >= 0 && at + 1 < text.length; at = text.indexOf("!", at + 1)) {
		const letter = text.charCodeAt(at + 1);
		const code = chatCode(letter);
		// Not a tag after all: the `!` stands for itself.
		if (code == null) continue;

		out += text.substring(from, at) + code;
		from = at + 2;
		at++;

		// The first colour that needs a swap decides it; the rest inherit,
		// because the swap belongs to the message and not to a character.
		if (swapTeam.length == 0) swapTeam = swapOf(letter);
	}

	out += text.substring(from);

	// The client draws no colour in a line that does not start with a colour
	// code, and shows the codes as spaces: such a line starts yellow.
	if (out.length > 0 && out.charCodeAt(0) > 0x04) out = "\x01" + out;

	paintedText = text;
	painted = out;
	paintedSwap = swapTeam;
	return out;
}

function send(id: i32, channel: i32, message: string): void {
	// Chat is the one channel with colours in it; the rest are plain text and
	// go where they always went.
	if (channel != 3) {
		_printClient(id, channel, message);
		return;
	}

	// A line printed again is painted already: the same string is the same
	// text, as a string never changes and paintedText keeps it alive.
	if (changetype<usize>(message) != changetype<usize>(paintedText)) paint(message);
	_sayText(id, painted, paintedSwap);
}

/** The team colour the last `paint()` chose for the line, one of `"TERRORIST"` (red), `"CT"` (blue), `"SPECTATOR"` (grey), or `""` - the reader's own team colour. */
export let swapTeam: string = "";

/** `!t` asks for the sender's own team, which the module fills in. */
const SENDER_TEAM = "";

// =============================================================================
// Traces through the world, and what is at a point: the engine's TraceLine,
// TraceHull and PointContents, called by the module (runtime/src/traces.h).
// =============================================================================

// @ts-ignore: decorator
@external("env", "world_trace_line") declare function _traceLine(points: usize, flags: i32, ignore: i32, out: usize): void;
// @ts-ignore: decorator
@external("env", "world_trace_hull") declare function _traceHull(points: usize, hull: i32, flags: i32, ignore: i32, out: usize): void;
// @ts-ignore: decorator
@external("env", "world_contents") declare function _worldContents(point: usize): i32;

// What a trace goes from and to, the module reads it here; and what it writes of a trace: the
// fraction, the end, the normal, the entity hit (-1 none), the flags, the hit group.
const traceIn = new StaticArray<f64>(6);
const traceOut = new StaticArray<f64>(10);

/** The start and the end into traceIn, where the module reads them. */
function tracePoints(start: number[], end: number[]): usize {
	const points = traceIn;
	for (let i = 0; i < 3; i++) {
		unchecked(points[i] = start[i]);
		unchecked(points[3 + i] = end[i]);
	}
	return changetype<usize>(points);
}
const TRACE_START_SOLID: i32 = 1;
const TRACE_ALL_SOLID: i32 = 2;
const TRACE_IN_OPEN: i32 = 4;
const TRACE_IN_WATER: i32 = 8;
const TRACE_MONSTERS: i32 = 1;
// How far a player's aim is traced: the engine's own reach for get_user_aiming.
const AIM_REACH: f64 = 8192;

/** The options of `trace.line` and `trace.hull`: what a trace passes through. */
export interface TraceOptions {
	/** An entity the trace passes through: the one it starts from, as a rule. */
	ignore?: Entity | null;
	/** Whether it stops at players and monsters too, not only at the world and solid entities; `true` when left out. */
	monsters?: boolean;
}

/** The size of what a hull trace moves: a point, a standing player, a large monster, a crouching player. */
export type TraceHull = "point" | "human" | "large" | "head";

/** A trace's result: where it stopped, at what, and how. */
export class TraceResult {
	constructor(
		/** The share of the way it went, `0` to `1`: `1` reached the end. */
		readonly fraction: number,
		/** The point it stopped at: the end when nothing was in the way. */
		readonly end: Vector,
		/** The direction the surface it hit faces; zero when it hit nothing. */
		readonly normal: Vector,
		/** The entity it hit - the world is entity `0` - or `null` when nothing was in the way. */
		readonly entity: Entity | null,
		/** Whether it started inside something solid. */
		readonly startSolid: boolean,
		/** Whether it was inside something solid all the way. */
		readonly allSolid: boolean,
		/** Whether it ended in the open air. */
		readonly inOpen: boolean,
		/** Whether it ended in water. */
		readonly inWater: boolean,
		/** The part of a player it hit, `"generic"` for anything else. */
		readonly hitGroup: HitGroup,
	) {}

	/** Whether something was in the way: `fraction` is less than `1`. */
	get hit(): boolean {
		return this.fraction < 1;
	}
}

function traceResult(): TraceResult {
	const out = traceOut;
	const id = <i32>out[7];
	const flags = <i32>out[8];
	const entity: Entity | null = id < 0 ? null : id >= 1 && id <= get_maxplayers() ? __playerOf(id) : new Entity(id);
	return new TraceResult(
		out[0], new Vector(out[1], out[2], out[3]), new Vector(out[4], out[5], out[6]), entity,
		(flags & TRACE_START_SOLID) != 0, (flags & TRACE_ALL_SOLID) != 0, (flags & TRACE_IN_OPEN) != 0, (flags & TRACE_IN_WATER) != 0,
		hitGroupName(<i32>out[9]),
	);
}

function traceFlags(options: TraceOptions): i32 {
	return options.monsters ?? true ? TRACE_MONSTERS : 0;
}

function traceIgnored(options: TraceOptions): i32 {
	const ignore = options.ignore;
	return ignore != null ? ignore.id : 0;
}

/**
 * Traces through the world: a line, `trace.line(start, end)`, or a box,
 * `trace.hull(start, end, "human")` - what a bullet or a player moving there
 * would meet.
 */
export namespace trace {
	/**
	 * Traces a line from `start` to `end` and tells where it stopped and at
	 * what: `trace.line(eyes, eyes.add(forward.scale(8192)), { ignore: player
	 * }).entity`.
	 *
	 * Pawn: `trace_line`, `engfunc(EngFunc_TraceLine, ...)`, `create_tr2`, `get_tr2`, `free_tr2`
	 */
	export function line(start: number[], end: number[], options: TraceOptions = {}): TraceResult {
		_traceLine(tracePoints(start, end), traceFlags(options), traceIgnored(options), changetype<usize>(traceOut));
		return traceResult();
	}

	/**
	 * Moves a box of a player's or a monster's size from `start` to `end`
	 * and tells where it stopped: `trace.hull(origin, origin, "human").startSolid`
	 * - a player put there would be stuck.
	 *
	 * Pawn: `trace_hull`, `engfunc(EngFunc_TraceHull, ...)`
	 */
	export function hull(start: number[], end: number[], hull: TraceHull, options: TraceOptions = {}): TraceResult {
		const size = hull == "human" ? 1 : hull == "large" ? 2 : hull == "head" ? 3 : 0;
		_traceHull(tracePoints(start, end), size, traceFlags(options), traceIgnored(options), changetype<usize>(traceOut));
		return traceResult();
	}
}

/**
 * The contents of a point of the world: `pointContents(origin) == "water"`. A
 * point inside a wall is `"solid"`; flowing water is one of the `current`
 * kinds.
 *
 * Pawn: `point_contents`, `engfunc(EngFunc_PointContents, ...)`
 */
export function pointContents(point: number[]): Contents {
	return contentsName(_worldContents(tracePoints(point, point)));
}

/** A player's aim: the point his view reaches and what is there. */
export class Aim {
	constructor(
		/** The point where his view first meets something, as far as 8192 units. */
		readonly point: Vector,
		/** The entity at that point: a player, an entity, the world (entity `0`), or `null` for nothing in reach. */
		readonly entity: Entity | null,
		/** The part of a player he aims at, `"generic"` for anything else. */
		readonly hitGroup: HitGroup,
	) {}
}

/**
 * The server's dictionaries: the files of `data/lang`, a line per key and
 * language, and each player reads them in his own.
 *
 * ```ts
 * lang.load("myplugin");                                        // data/lang/myplugin.txt
 * player.print(lang.translate(player, "MYPLUGIN_WELCOME", [player.name]));
 * ```
 *
 * Pawn: `register_dictionary`, `LookupLangKey`
 */
export namespace lang {
	// The dictionaries this plugin loaded, for languages(): AMX Mod X's own
	// list has every language of any dictionary on the server.
	const loaded: string[] = [];

	/**
	 * Loads the dictionary `data/lang/<name>.txt`: `lang.load("myplugin")`.
	 * `false` when there is no such file.
	 *
	 * Pawn: `register_dictionary`
	 */
	export function load(name: string): boolean {
		const found = register_dictionary(`${name}.txt`) != 0;
		if (found && !loaded.includes(name)) loaded.push(name);
		return found;
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

	/**
	 * The languages of a dictionary, by their codes, in the file's order:
	 * `lang.languages("myplugin")` is `["en", "ru"]`. Without a name, those of
	 * the dictionaries this plugin loaded with `lang.load` - not every
	 * language the server's dictionaries have.
	 *
	 * Pawn: `get_langsnum`, `get_lang`
	 */
	export function languages(dictionary: string = ""): string[] {
		const names = dictionary.length > 0 ? [dictionary] : loaded;
		const list: string[] = [];
		for (let i = 0; i < names.length; i++) {
			const codes = languagesOf(names[i]);
			for (let j = 0; j < codes.length; j++) {
				if (!list.includes(codes[j])) list.push(codes[j]);
			}
		}
		return list;
	}

	/** The sections of `data/lang/<name>.txt` - `[en]`, `[ru]` - in its order. */
	function languagesOf(name: string): string[] {
		const text = readFileSync(`${server.dataDir}/lang/${name}.txt`);
		const codes: string[] = [];
		if (text == null) return codes;
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (line.length == 4 && line.startsWith("[") && line.endsWith("]")) codes.push(line.substring(1, 3).toLowerCase());
		}
		return codes;
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
export function cmd(name: string, handler: Handler, flag: FlagName = "all"): void {
	_clcmd(name, hostIndex(handler, false), flagOf(flag), SHAPE_NARROW);
}

/**
 * Registers a console command for players whose handler gets the raw
 * arguments `(id, level, cid)`. `handled()` in the handler stops the command
 * from going on to other plugins.
 *
 * Pawn: `register_clcmd`
 */
export function cmdWide(name: string, handler: WideHandler, flag: FlagName = "all"): void {
	_clcmd(name, hostIndex(handler, true), flagOf(flag), SHAPE_WIDE);
}

/** The function a timer runs: `() => ...`. */
export type TimerHandler = () => void;

// The timers that are armed, by the slot the module keeps each in. The module
// fires a timer by calling timeoutFired or intervalFired with its slot, which
// call the handler from here - with its closure, which a bare table index
// would lose. A slot takes the next timer once its own is done, so a handle
// is the slot and how many timers it has had (TIMER_SLOTS apart): a handle
// kept after its timer has fired cannot stop the slot's next one.
const timers: (TimerHandler | null)[] = [];
const timerHandles: f64[] = [];
const TIMER_SLOTS: f64 = 1 << 24;
// Past it a handle would lose its slot to the f64's precision: the count starts again.
const TIMER_HANDLES_END: f64 = 4503599627370496; // 2^52

function timeoutFired(slot: i32): void {
	const handler = unchecked(timers[slot]);
	unchecked(timers[slot] = null);
	if (handler) handler();
}

function intervalFired(slot: i32): void {
	const handler = unchecked(timers[slot]);
	if (handler) handler();
}

function armTimer(handler: TimerHandler, ms: number, repeat: bool): number {
	// The delay crosses as the bit pattern of a 32-bit float: every signature
	// in the module's table is all-i on purpose.
	const slot = _task(floatCell(ms / 1000.0), repeat ? intervalFired.index : timeoutFired.index, repeat ? 1 : 0);
	if (slot < 0) return 0;
	const last = slot < timerHandles.length ? unchecked(timerHandles[slot]) : 0;
	const handle = (last > 0 && last < TIMER_HANDLES_END ? last : <f64>slot) + TIMER_SLOTS;
	timerHandles[slot] = handle;
	timers[slot] = handler;
	return handle;
}

/**
 * Runs `handler` once after `ms` milliseconds and returns the timer's handle,
 * as in the browser:
 *
 * ```ts
 * const handle = setTimeout(() => player.print("Welcome!"), 2000);
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
	const slot = <i32>(<i64>handle & (<i64>TIMER_SLOTS - 1));
	if (slot >= timers.length || unchecked(timerHandles[slot]) != handle || !unchecked(timers[slot])) return;
	unchecked(timers[slot] = null);
	_stopTask(slot);
}

/** Stops the interval with this handle; the same as `clearTimeout`. */
export function clearInterval(handle: number): void {
	clearTimeout(handle);
}

// @ts-ignore: decorator
@external("env", "call") declare function _call(id: i32, args: i32, mask: i32, argc: i32): i32;

// WebAssembly fixes an import's arity, so a native with a `...` tail cannot be
// declared in @amxts/core/natives at all - only its id is - and the module cannot infer
// the tail's types.
/**
 * A call of a Pawn native with a `...` tail, built one argument at a time -
 * the low-level way. A native from `@amxts/core/natives` is an ordinary function and
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
	// The same for strings, which the module reads where they are.
	private texts: string[] | null = null;
	private n: i32 = 0;
	// A pooled call's room for the vectors of its tail (__call): three cells
	// each, at addresses that never move; one past them is made and held.
	private vectors: StaticArray<i32> | null = null;
	private vectorsUsed: i32 = 0;
	// Its place in the pool, -1 for one made with `new`.
	private depth: i32 = -1;

	constructor(private id: i32) {}

	/** @hidden The pooled call at `depth`, emptied for native `id` (__call). */
	__reuse(id: i32, depth: i32): Call {
		this.id = id;
		this.n = 0;
		this.depth = depth;
		this.vectorsUsed = 0;
		const held = this.held;
		if (held != null) held.length = 0;
		const texts = this.texts;
		if (texts != null) texts.length = 0;
		return this;
	}

	/** @hidden Gives a pooled call back once what the native wrote is read (__call). */
	__done(): void {
		if (this.depth >= 0) callDepth = this.depth;
	}

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
		let texts = this.texts;
		if (texts == null) {
			texts = [];
			this.texts = texts;
		}
		texts.push(text);
		return this.push(changetype<i32>(text), 0x73); // s
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
		let at: usize;
		if (this.depth >= 0 && this.vectorsUsed < CALL_VECTORS) {
			let vectors = this.vectors;
			if (vectors == null) {
				vectors = new StaticArray<i32>(CALL_VECTORS * 3);
				this.vectors = vectors;
			}
			at = changetype<usize>(vectors) + <usize>this.vectorsUsed * 12;
			this.vectorsUsed++;
		} else {
			const cells = new StaticArray<i32>(3);
			this.hold(cells);
			at = changetype<usize>(cells);
		}
		store<i32>(at, reinterpret<i32>(<f32>x));
		store<i32>(at, reinterpret<i32>(<f32>y), 4);
		store<i32>(at, reinterpret<i32>(<f32>z), 8);
		return this.push(<i32>at, 0x76); // v
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

	/** The number of arguments added so far: the position the next one takes. */
	get count(): i32 {
		return this.n;
	}

	/**
	 * Adds room for text the native writes, in a `...` tail, holding `text` to
	 * begin with; its length follows by address, as `ret[], len` wants it.
	 * After `run` the text is in `cellsAt` of this position.
	 */
	textInto(text: string, length: i32): Call {
		const cells = new StaticArray<i32>(length + 1);
		__writeCellText(text, cells);
		this.hold(cells);
		return this.push(changetype<i32>(cells), 0x62).ref(length); // b
	}

	/** The cells at the address of the argument at this position, after `run`: a vector or text the native wrote. */
	cellsAt(index: i32): StaticArray<i32> {
		return changetype<StaticArray<i32>>(unchecked(this.args[index]));
	}

	/** Calls the native with the arguments added so far and returns its result. */
	run(): number {
		return _call(this.id, changetype<i32>(this.args), changetype<i32>(this.mask), this.n);
	}
}

/** A Call argument's kind: a number passed by address. */
const REF: u8 = 0x72; // r

/** The vectors a pooled call keeps room for: a native's tail rarely has more than one. */
const CALL_VECTORS: i32 = 4;

// The calls the generated natives build their arguments in (__call), one a
// depth: a native may run plugin code that calls another before it returns.
// A call given back sets the depth to its own, so one a trap left taken is
// taken again by the next call at its depth.
const calls: Call[] = [];
let callDepth = 0;

// ponytail: past this depth a call is made anew, never pooled: what a depth
// deeper than any real nesting means is calls a trap left taken.
const CALL_POOL: i32 = 16;

/**
 * @hidden A call of native `id` to build: the pooled one of this depth,
 * emptied - building and running it allocates nothing - given back with
 * `__done` once what the native wrote is read.
 */
export function __call(id: i32): Call {
	const depth = callDepth;
	if (depth >= CALL_POOL) return new Call(id);
	callDepth = depth + 1;
	if (depth < calls.length) return unchecked(calls[depth]).__reuse(id, depth);
	const call = new Call(id).__reuse(id, depth);
	calls.push(call);
	return call;
}

/** @hidden Runs a call `__call` made and gives it back: the native's result. */
export function __run(call: Call): number {
	const result = call.run();
	call.__done();
	return result;
}

/** An array as the module reads one for a forward: its count, then its cells. */
function arrayCells(values: number[], floats: bool): StaticArray<i32> {
	const cells = new StaticArray<i32>(values.length + 1);
	unchecked(cells[0] = values.length);
	for (let i = 0; i < values.length; i++) unchecked(cells[i + 1] = floats ? reinterpret<i32>(<f32>unchecked(values[i])) : <i32>unchecked(values[i]));
	return cells;
}

// ---------------------------------------------------------------- a native's `...` tail

/** The longest text a native writes into a `Ref<string>`, in bytes. */
const REF_TEXT: i32 = 1023;

/**
 * A value a native writes back through its argument, where Pawn passes a
 * variable for the native to fill: text into `ret[], len`, a number into
 * `&value`. Give it where the native takes one; after the call, `value` is
 * what the native wrote.
 *
 * ```ts
 * const reason = new Ref("");
 * if (!dllfunc(DLLFunc_ClientConnect, id, "Bot", "127.0.0.1", reason)) console.log(reason.value);
 * ```
 */
export class Ref<T> {
	constructor(/** The value the native wrote; before the call, the one it starts with. */ public value: T) {}

	/** @hidden Adds this to a call: text as room to write in with its length, a number or a boolean by address. */
	__push(call: Call, float: bool): void {
		const value = this.value;
		if (isString<T>()) call.textInto(changetype<string>(value), REF_TEXT);
		else if (isBoolean<T>()) call.ref(value ? 1 : 0);
		else if (isFloat<T>() || isInteger<T>()) call.ref(float ? floatCell(<f64>value) : <i32><f64>value);
		else ERROR("a Ref holds text, a number or a boolean");
	}

	/** @hidden Reads what the native wrote at this position of the call. */
	__back(call: Call, at: i32, float: bool): void {
		if (isString<T>()) this.value = changetype<T>(cellsToString(call.cellsAt(at)));
		else if (isBoolean<T>()) this.value = <T>(call.out(at) != 0);
		else this.value = <T>(float ? cellFloat(call.out(at)) : <f64>call.out(at));
	}
}

// What frameTime reads the frame's time into, made once: a bot's move asks every frame.
const frameTimeRead = new Ref<f64>(0.0);

/**
 * One argument of a native's `...` tail, by its type: a number or a boolean
 * by address (a number as a Float where `float` says), text as it is, a
 * Vector or `[x, y, z]` as three Floats, a Player or an Entity as its index,
 * a Ref as room for what the native writes; nothing for an argument left
 * out. Each branch is decided as it compiles, so the conditions are the
 * compiler's own. Returns the argument's position in the call, for tailBack.
 */
function tailArgument<T>(call: Call, value: T, float: bool): i32 {
	const at = call.count;
	if (isString<T>()) {
		call.str(changetype<string>(value));
	} else if (isBoolean<T>()) {
		call.ref(value ? 1 : 0);
	} else if (!isReference<T>()) {
		call.ref(float ? floatCell(<f64>value) : <i32><f64>value);
	} else if (isArray<T>()) {
		// @ts-ignore: valueof is AssemblyScript's
		if (!isFloat<valueof<T>>()) ERROR("a native's `...` takes a vector as a Vector or [x, y, z]");
		const values = changetype<number[]>(value);
		call.vec(values.length > 0 ? values[0] : 0, values.length > 1 ? values[1] : 0, values.length > 2 ? values[2] : 0);
	// @ts-ignore: a Ref's method, looked for at compile time
	} else if (isDefined(changetype<T>(0).__push)) {
		// @ts-ignore: T is a Ref here
		changetype<T>(value).__push(call, float);
	// @ts-ignore: a Player's or an Entity's index, looked for at compile time
	} else if (isDefined(changetype<T>(0).id)) {
		// @ts-ignore: T has an id here
		call.ref(value ? <i32>changetype<T>(value).id : 0);
	} else if (idof<T>() != idof<NoArgument>()) {
		ERROR("a native's `...` takes a number, a boolean, text, a Vector or [x, y, z], a Player, an Entity or a Ref");
	}
	return at;
}

/** What the native wrote back into the argument at `at`: a vector's numbers, a Ref's value. */
function tailBack<T>(call: Call, value: T, at: i32, float: bool): void {
	if (isArray<T>()) {
		const values = changetype<number[]>(value);
		const cells = call.cellsAt(at);
		for (let i = 0; i < min(values.length, 3); i++) values[i] = cellFloat(unchecked(cells[i]));
	// @ts-ignore: a Ref's method, looked for at compile time
	} else if (isDefined(changetype<T>(0).__back)) {
		// @ts-ignore: T is a Ref here
		changetype<T>(value).__back(call, at, float);
	}
}

// @ts-ignore: decorator
@external("env", "run_player_move") declare function _runPlayerMove(id: i32, pitch: i32, yaw: i32, roll: i32, forward: i32, side: i32, up: i32, buttons: i32, impulse: i32, msec: i32): i32;

/** Whether a tail's argument of type T is a number the module takes as it is: a number or a boolean. */
// @ts-ignore: decorator
@inline function plainTail<T>(): bool {
	return isBoolean<T>() || isFloat<T>() || isInteger<T>();
}

/** A number as a Float's cell, for an import that takes one. */
// @ts-ignore: decorator
@inline function floatBits(value: f64): i32 {
	return reinterpret<i32>(<f32>value);
}

/** A number or a boolean of a tail as a number (plainTail). */
// @ts-ignore: decorator
@inline function tailNumber<T>(value: T): f64 {
	if (isBoolean<T>()) return value ? 1 : 0;
	return <f64>value;
}

/**
 * @hidden engfunc(EngFunc_RunPlayerMove, ...) made by the module itself - a
 * bot's move every frame builds no call: true once made. False when the
 * arguments are not a bot's id, its angles and six numbers, or the entity
 * is one fakemeta refuses: engfunc's tail takes the call, and says why.
 */
export function __runPlayerMove<A, B, C, D, E, F, G, H>(id: A, angles: B, forward: C, side: D, up: E, buttons: F, impulse: G, msec: H): bool {
	if (!plainTail<A>() || !isArray<B>() || !plainTail<C>() || !plainTail<D>() || !plainTail<E>() || !plainTail<F>() || !plainTail<G>() || !plainTail<H>()) return false;
	const view = changetype<number[]>(angles);
	if (view.length < 3) return false;
	return _runPlayerMove(<i32>tailNumber<A>(id), floatBits(unchecked(view[0])), floatBits(unchecked(view[1])), floatBits(unchecked(view[2])),
		floatBits(tailNumber<C>(forward)), floatBits(tailNumber<D>(side)), floatBits(tailNumber<E>(up)),
		<i32>tailNumber<F>(buttons), <i32>tailNumber<G>(impulse), <i32>tailNumber<H>(msec)) != 0;
}

/** @hidden What an argument left out of a native's `...` tail stands at: nothing is sent for it. */
export function __noArgument<T>(): T {
	return zeroOf<T>();
}

/** In a native's float table: its result is a Float. Bit `i` below it: the tail's argument `i` is one. */
const TAIL_FLOAT_RESULT: i32 = 1 << 16;

/**
 * @hidden A native's `...` tail of up to twelve arguments of any kind, onto
 * `call`, and the call run: what the generated wrappers of @amxts/core/natives call.
 * `floats` is the native's float table for this call (bit `i`: the tail's
 * argument `i` is a Float; TAIL_FLOAT_RESULT: so is the result) - a
 * plugin's number cannot say whether it is one. What the native wrote into
 * a vector or a Ref is read back into it.
 */
export function __callTail<A, B, C, D, E, F, G, H, I, J, K, L>(call: Call, floats: i32, a: A, b: B, c: C, d: D, e: E, f: F, g: G, h: H, i: I, j: J, k: K, l: L): number {
	const at0 = tailArgument<A>(call, a, (floats & 1) != 0);
	const at1 = tailArgument<B>(call, b, (floats & 2) != 0);
	const at2 = tailArgument<C>(call, c, (floats & 4) != 0);
	const at3 = tailArgument<D>(call, d, (floats & 8) != 0);
	const at4 = tailArgument<E>(call, e, (floats & 16) != 0);
	const at5 = tailArgument<F>(call, f, (floats & 32) != 0);
	const at6 = tailArgument<G>(call, g, (floats & 64) != 0);
	const at7 = tailArgument<H>(call, h, (floats & 128) != 0);
	const at8 = tailArgument<I>(call, i, (floats & 256) != 0);
	const at9 = tailArgument<J>(call, j, (floats & 512) != 0);
	const at10 = tailArgument<K>(call, k, (floats & 1024) != 0);
	const at11 = tailArgument<L>(call, l, (floats & 2048) != 0);
	const result = call.run();
	tailBack<A>(call, a, at0, (floats & 1) != 0);
	tailBack<B>(call, b, at1, (floats & 2) != 0);
	tailBack<C>(call, c, at2, (floats & 4) != 0);
	tailBack<D>(call, d, at3, (floats & 8) != 0);
	tailBack<E>(call, e, at4, (floats & 16) != 0);
	tailBack<F>(call, f, at5, (floats & 32) != 0);
	tailBack<G>(call, g, at6, (floats & 64) != 0);
	tailBack<H>(call, h, at7, (floats & 128) != 0);
	tailBack<I>(call, i, at8, (floats & 256) != 0);
	tailBack<J>(call, j, at9, (floats & 512) != 0);
	tailBack<K>(call, k, at10, (floats & 1024) != 0);
	tailBack<L>(call, l, at11, (floats & 2048) != 0);
	call.__done();
	return (floats & TAIL_FLOAT_RESULT) != 0 ? cellFloat(result) : result;
}

// ---------------------------------------------------------------- field natives

// What a field of reapi's field natives - get_entvar, get_member, get_pmove -
// holds, as the generated __<native>_kind tables of @amxts/core/natives say
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
		if (!fieldTakes<T>(kind, native)) {
			call.__done();
			return changetype<T>("");
		}
		const text = new CellBuffer(FIELD_TEXT);
		call.tailBuffer(text, FIELD_TEXT - 1);
		if (kind & FIELD_ELEMENT) call.ref(element);
		__run(call);
		return changetype<T>(text.text());
	}
	if (isReference<T>()) {
		// A Vector, or number[] it is one of.
		if (!fieldTakes<T>(kind, native)) {
			call.__done();
			return changetype<T>(new Vector());
		}
		const cells = new CellBuffer(3);
		call.vecInto(cells);
		if (kind & FIELD_ELEMENT) call.ref(element);
		__run(call);
		return changetype<T>(new Vector(cells.float(0), cells.float(1), cells.float(2)));
	}
	if (!isFloat<T>() && !isInteger<T>()) ERROR("a field reads as number, boolean, string or Vector");
	if (!fieldTakes<T>(kind, native)) {
		call.__done();
		return <T>0;
	}
	if (kind & FIELD_ELEMENT) call.ref(element);
	const cell = <i32>__run(call);
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
	if (!fieldTakes<T>(kind, native)) {
		call.__done();
		return 0;
	}
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
	return __run(call);
}

// @ts-ignore: decorator
@external("env", "hook")           declare function _hook(id: i32, fn: i32, post: i32): i32;
// @ts-ignore: decorator
@external("env", "ham")            declare function _ham(id: i32, entityClass: string, fn: i32, post: i32): i32;
// @ts-ignore: decorator
@external("env", "hook_on")        declare function _hookOn(handle: i32, on: i32): void;
// @ts-ignore: decorator
@external("env", "hook_direct")    declare function _hookDirect(handle: i32, listener: i32, env: i32, view: usize): void;
// @ts-ignore: decorator
@external("env", "msg_hook")       declare function _msgHook(id: i32, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "msg_argc")       declare function _msgArgc(): i32;
// @ts-ignore: decorator
@external("env", "msg_arg_type")   declare function _msgArgType(index: i32): i32;
// @ts-ignore: decorator
@external("env", "msg_number")     declare function _msgNumber(index: i32): f64;
// @ts-ignore: decorator
@external("env", "msg_text")       declare function _msgText(index: i32, out: i32, max: i32): i32;
// @ts-ignore: decorator
@external("env", "msg_set_number") declare function _msgSetNumber(index: i32, value: f64): void;
// @ts-ignore: decorator
@external("env", "msg_set_text")   declare function _msgSetText(index: i32, text: string): void;
// @ts-ignore: decorator
@external("env", "log_hook")       declare function _logHook(argc: i32, filter: string, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "cvar_hook")      declare function _cvarHook(name: string, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "touch_hook")     declare function _touchHook(touched: string, toucher: string, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "stock_hook")     declare function _stockHook(fn: i32, handler: i32, post: i32): i32;
// @ts-ignore: decorator
@external("env", "query_cvar")     declare function _queryCvar(id: i32, name: string): i32;
// @ts-ignore: decorator
@external("env", "chain_set")      declare function _chainSet(index: i32, cell: i32): void;
// @ts-ignore: decorator
@external("env", "chain_set_text") declare function _chainSetText(index: i32, text: string): void;
// @ts-ignore: decorator
@external("env", "game_api")       declare function _gameApi(): i32;

/**
 * Hooks a ReGameDLL or ReHLDS hookchain with a raw handler of four numbers -
 * the low level under `game.addEventListener`, which is what a plugin uses.
 * The handler reads the arguments past the fourth with `arg()`, and blocks the
 * game's function with `handled()`.
 *
 * The name is reapi's, without the class where it is not needed:
 * `"restart_round"`, `"player_spawn"`; the editor completes them. Returns the
 * hook's handle for `unhook`, or `0` when the server has not the chain's API -
 * ReGameDLL for the game's chains, ReHLDS for the engine's.
 *
 * Pawn: `RegisterHookChain`
 */
export function hook(name: HookName, handler: WideHandler, post: bool = false): number {
	const id = hookIdOf(name);

	if (id < 0) {
		console.error(`no hookchain named "${name}"`);
		return 0;
	}

	return _hook(id, hostIndex(handler, true), post ? 1 : 0);
}

/**
 * Takes off a hook `hook` made: its handler is not called again.
 *
 * Pawn: `DisableHookChain`
 */
export function unhook(handle: number): void {
	_hookOn(<i32>handle, 0);
}

// A client's answer about a cvar, by stock_hook's number (StockFunction in
// runtime/src/enginehooks.h; as/hlds.ts has the others).
const STOCK_CVAR_ANSWER: i32 = 7;

/**
 * @hidden A handler of one of the engine's and the game's functions fakemeta
 * hooks (STOCK_* in as/hlds.ts), before the game's or after it, switched by
 * `hook`: it reads the call with arg() and argText(), blocks
 * it with handled() and answers it with __chainSet(-1, ...).
 */
export function __stockHook(fn: i32, handler: WideHandler, post: bool, hook: __Switch | null): void {
	const handle = _stockHook(fn, hostIndex(handler, true), post ? 1 : 0);
	if (hook != null && handle != 0) hook.add((on: bool): void => _hookOn(handle, on ? 1 : 0));
}

/**
 * @hidden A handler of the game's log lines of `argc` arguments that
 * `filter` takes - AMX Mod X's logevent filter, `"1=Round_Start"` - switched
 * by `hook`; read_logargv reads the line.
 */
export function __logHook(argc: i32, filter: string, handler: () => void, hook: __Switch): void {
	const handle = _logHook(argc, filter, hostIndex<WideHandler>((a: number, b: number, c: number, d: number): void => handler(), true));
	hook.add((on: bool): void => _hookOn(handle, on ? 1 : 0));
}

/** @hidden Switches a hook the hood made off and on (as/hooks.ts). */
export function __hookOn(handle: i32, on: bool): void {
	_hookOn(handle, on ? 1 : 0);
}

/**
 * @hidden Has the module call `listener` itself, with the event's object
 * `view`, in place of what a hook the hood made calls - the walk of its
 * listeners, which would call that one alone; null has it called again.
 */
export function __hookDirect(handle: i32, listener: usize, view: usize): void {
	_hookDirect(handle, __callee(listener), __calleeEnv(listener), view);
}

/** @hidden Writes an argument of the hooked call that is running; `-1` is its answer. */
export function __chainSet(index: i32, cell: i32): void {
	_chainSet(index, cell);
}

/** @hidden Writes a text argument of the hooked call that is running; `-1` is its answer. */
export function __chainSetText(index: i32, text: string): void {
	_chainSetText(index, text);
}

// What the server has of ReGameDLL's and ReHLDS's hookchains: 1 the game's,
// 2 the engine's, asked once; -1 not asked yet.
let gameApi: i32 = -1;

/** @hidden Whether the server has the hookchains of ReHLDS (`rehlds`) or of ReGameDLL. */
export function __hasChains(rehlds: bool): bool {
	if (gameApi < 0) gameApi = _gameApi();
	return (gameApi & (rehlds ? 2 : 1)) != 0;
}

// AMX Mod X has no entry for an amxts plugin, so this is the only place
// their names exist.
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

// A shared module's side of the calls other plugins make to it: as/remote.ts
// sets the plugin whose call runs and tells of a plugin that stopped. Here,
// not there, so that the kit's words reach the editor.
let callingRun: i32 = 0;
const stopListeners: ((plugin: number) => void)[] = [];

/**
 * The plugin whose call the module runs now, as a number: what the module
 * keeps for that plugin - a menu it made, a function it gave - is marked with
 * it, and dropped when `onPluginStop()` gives the same number. `0` when no
 * other plugin's call runs: the module's own plugin, its natives for Pawn
 * plugins, its events and timers.
 *
 * ```ts
 * export function addRule(test: Rule) {
 * 	rules.push({ test, from: callingPlugin() });
 * }
 * ```
 */
export function callingPlugin(): number {
	return callingRun;
}

/**
 * Calls `listener` when a plugin that called the module stops - unloaded,
 * reloaded, or its load failed - with the number `callingPlugin()` gave
 * during its calls. The module drops what that plugin gave it: a reloaded
 * plugin is a new one, which gives everything again, and a function of the
 * one that stopped answers nothing.
 *
 * ```ts
 * onPluginStop((plugin) => {
 * 	rules = rules.filter(rule => rule.from != plugin);
 * });
 * ```
 */
export function onPluginStop(listener: (plugin: number) => void): void {
	stopListeners.push(listener);
}

/** @hidden as/remote.ts: a call of the run `from` starts; the run whose call ran before it, to give back. */
export function __callFrom(from: i32): i32 {
	const outer = callingRun;
	callingRun = from;
	return outer;
}

/** @hidden as/remote.ts: the plugin of the run `run` stopped. */
export function __pluginStopped(run: i32): void {
	for (const listener of stopListeners) listener(run);
}

// ---------------------------------------------------------------- forwards

// @ts-ignore: decorator
@external("env", "subscribe")  declare function _subscribe(forward: string, fn: i32, tag: i32): void;
// @ts-ignore: decorator
@external("env", "emit_local") declare function _emitLocal(forward: string, mask: string, cells: i32, count: i32): void;

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

// game.endRound's arguments of ReGameDLL's RoundEnd, as its listeners leave them.
const roundEndCells = new StaticArray<i32>(3);

// @ts-ignore: decorator
@external("env", "chain_dispatch") declare function _chainDispatch(id: i32, post: i32, cells: usize, count: i32, result: i32): i32;

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
		return nameof<T>() == "Player" ? changetype<T>(__playerOf(__nativeCell(index))) : changetype<T>(0);
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
	private handlers = new __Listeners<(a1: T1, a2: T2, a3: T3, a4: T4, a5: T5, a6: T6, a7: T7, a8: T8, a9: T9, a10: T10, a11: T11, a12: T12, a13: T13, a14: T14, a15: T15, a16: T16, a17: T17, a18: T18, a19: T19, a20: T20, a21: T21, a22: T22, a23: T23, a24: T24, a25: T25, a26: T26, a27: T27, a28: T28, a29: T29, a30: T30, a31: T31, a32: T32) => void>();

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
	 * take fewer of them. A forward a Pawn plugin makes reaches it after the
	 * Pawn plugins' handlers; one emitted from TypeScript reaches every
	 * subscriber.
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
		this.handlers.remove(handler);
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
		const handlers = this.handlers;
		const n = handlers.begin();
		for (let i = 0; i < n; i++) {
			const handler = handlers.at(i);
			if (handler) handler(a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30, a31, a32);
		}
		handlers.end();
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
 * A key-to-value store on disk: a Map that survives a map change and a
 * server restart.
 *
 * ```ts
 * const points = new Storage<number>("myplugin_points");
 * const mine = points.get(player.steamId) ?? 0;   // undefined when there is none
 * points.set(player.steamId, mine + 1);
 * points.delete(player.steamId);
 * ```
 *
 * The type argument is what it holds - text by default, a number, a boolean,
 * an object of an interface - kept as JSON. The file is
 * `amxts/storage/<name>.json` in AMX Mod X's data folder, written within a
 * second of a change; a name with no file yet takes what AMX Mod X's `nvault`
 * kept under that name, once.
 *
 * Pawn: `nvault_open`, `nvault_get`, `nvault_set`, `nvault_remove`
 */
export class Storage<T = string> {
	private handle: i32 = -2;

	constructor(
		/** The storage's name, which is also its file's name. */
		public name: string
	) {}

	/**
	 * The value under `key`, or `undefined` when there is none, as
	 * `Map.get` gives: `points.get(player.steamId) ?? 0`.
	 *
	 * Pawn: `nvault_get`, `nvault_lookup`
	 */
	get(key: string): T | undefined {
		const text = this.text(key);
		if (text == null) return undefined;
		if (isString<T>()) return changetype<T>(text);
		return JSON.parse<T>(text);
	}

	/**
	 * Puts `value` under `key`, replacing what was there; it is on disk
	 * within a second.
	 *
	 * Pawn: `nvault_set`
	 */
	set(key: string, value: T): void {
		const handle = this.open();
		if (handle < 0) return;
		if (isString<T>()) _storeSet(handle, key, changetype<string>(value));
		else _storeSet(handle, key, JSON.stringify(value));
	}

	/** `true` when there is a value under `key`. */
	has(key: string): boolean {
		return this.text(key) != null;
	}

	/**
	 * Removes `key` and its value: `true` when it was there.
	 *
	 * Pawn: `nvault_remove`
	 */
	delete(key: string): boolean {
		const handle = this.open();
		return handle >= 0 && _storeDelete(handle, key) != 0;
	}

	/** Every key, in their order as text. */
	keys(): string[] {
		const handle = this.open();
		if (handle < 0) return [];
		let room = new StaticArray<u8>(4096);
		let length = _storeKeys(handle, changetype<usize>(room), room.length);
		if (length > room.length) {
			room = new StaticArray<u8>(length);
			length = _storeKeys(handle, changetype<usize>(room), room.length);
		}
		if (length == 0) return [];
		const keys = String.UTF8.decodeUnsafe(changetype<usize>(room), length - 1).split("\0");
		return keys;
	}

	/** The number of keys it holds. */
	get size(): number {
		const handle = this.open();
		return handle < 0 ? 0 : _storeCount(handle);
	}

	/**
	 * Removes what was last set before `olderThan`:
	 * `points.prune(new Date(Date.now() - 30 * 24 * 3600 * 1000))` - a month
	 * untouched. How many keys went.
	 *
	 * Pawn: `nvault_prune`
	 */
	prune(olderThan: Date): number {
		const handle = this.open();
		return handle < 0 ? 0 : _storePrune(handle, <f64>olderThan.getTime() / 1000);
	}

	private text(key: string): string | null {
		const handle = this.open();
		if (handle < 0) return null;
		let room = storeRoom;
		let length = _storeGet(handle, key, changetype<usize>(room), room.length);
		if (length > room.length) {
			room = new StaticArray<u8>(length);
			length = _storeGet(handle, key, changetype<usize>(room), room.length);
		}
		return length < 0 ? null : String.UTF8.decodeUnsafe(changetype<usize>(room), length);
	}

	private open(): i32 {
		if (this.handle == -2) {
			this.handle = _storeOpen(this.name);
			if (this.handle < 0) console.error(`new Storage("${this.name}"): a storage's name is a file's name - no / \\ : * ? " < > |`);
		}
		return this.handle;
	}
}

// The module's stores (runtime/src/storage.h): a handle a name.
// @ts-ignore: decorator
@external("env", "store_open")   declare function _storeOpen(name: string): i32;
// @ts-ignore: decorator
@external("env", "store_get")    declare function _storeGet(handle: i32, key: string, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "store_set")    declare function _storeSet(handle: i32, key: string, value: string): void;
// @ts-ignore: decorator
@external("env", "store_delete") declare function _storeDelete(handle: i32, key: string): i32;
// @ts-ignore: decorator
@external("env", "store_count")  declare function _storeCount(handle: i32): i32;
// @ts-ignore: decorator
@external("env", "store_keys")   declare function _storeKeys(handle: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "store_prune")  declare function _storePrune(handle: i32, before: f64): i32;
const storeRoom = new StaticArray<u8>(1024);

// Flag enums and the array that stands for a mask - generated, see scripts/generate-flags.ts.
export * from "./flags";
import { Access, ACCESS, EFFECT, Effect, HIDE_HUD, HideHud } from "./flags";

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
	// game's 175 bytes itself. Its keys are AMX Mod X's: a Menu the player
	// had is closed.
	show_menu(id, keys, menuColors(text), -1, title);
}

// ---------------------------------------------------------------- menus

// A menu as an object: `new Menu(title)`, items with a title, a test for when
// each is shown and when it can be chosen, and what choosing it does;
// `show(player, data)`. It is drawn here, as AMX Mod X draws its own menus -
// pages, Back, More and Exit: each show() asks the title and every item's
// title, `visible` and `enabled` then, for that player, and draws the page's
// text again only when they give a page other than the one drawn last.
// AMX Mod X's show_menu sends it, and the module hears its keys (menu_open)
// and calls menuKey with the one pressed. A menu shown over it - this
// plugin's, another plugin's, a Pawn plugin's, the game's - takes the keys,
// and a reload of the plugin or the player leaving closes it.
// @ts-ignore: decorator
@external("env", "menu_open") declare function _menuOpen(id: i32, keys: i32, fn: i32): void;

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
	 * The Back item's text; `"Back"` by default.
	 *
	 * Pawn: `MPROP_BACKNAME`
	 */
	backText?: string;
	/**
	 * The More item's text; `"More"` by default.
	 *
	 * Pawn: `MPROP_NEXTNAME`
	 */
	nextText?: string;
	/**
	 * The Exit item's text; `"Exit"` by default.
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

// show_menu's title for a Menu: one no Pawn menu is registered by
// (register_menuid), so AMX Mod X gives none of its keys to a Pawn plugin.
const MENU_TITLE = "#amxts";

/** A menu whose page a player is shown: what his keys do on it. */
abstract class ShownMenu {
	/** @hidden For the hood: the player `id` pressed `key` on the page this menu shows him, 0 for 1 and 9 for 0. */
	abstract __press(id: i32, key: i32): void;
}

// The menu whose page each player saw last from this plugin, by his id: the
// module calls menuKey only while that page is open (menu_open).
const shownMenus = new StaticArray<ShownMenu | null>(MAX_PLAYERS + 1);

/** A player pressed a key of the page this plugin shows him: `key` is 0 for 1 and 9 for 0. */
function menuKey(player: number, key: number, unused: number, unused2: number): void {
	const id = <i32>player;
	if (<u32>(id - 1) >= <u32>MAX_PLAYERS) return;
	const menu = unchecked(shownMenus[id]);
	if (menu == null) return;

	const ambient = __co_ambient_player;
	__co_ambient_player = id;
	menu.__press(id, <i32>key);
	__co_ambient_player = ambient;
}

/** A text option, or what it is when it is not given. */
function menuOption(text: string | undefined, fallback: string): string {
	if (text !== undefined) return menuColors(text);
	return fallback;
}

/** One of a page's own items, Back, More or Exit: `option` its place, 0 for key 1; grey when it cannot be chosen. */
function pageItem(color: string, option: i32, text: string, enabled: bool): string {
	const number = (option + 1) % 10;
	return enabled ? `${color}${number}. \\w${text}\n` : `\\d${number}. ${text}\n\\w`;
}

/** A text given as `string | ((context) => string)`: the compiler holds it as the function, a string as one that returns it. */
// @ts-ignore: decorator
@inline function menuText<C>(text: string | ((context: C) => string), context: C): string {
	// @ts-ignore: a function here - the editor sees the union
	return text(context);
}

/** A test given as `boolean | ((context) => boolean)`, held as the function as a text is; left out, it says yes. */
// @ts-ignore: decorator
@inline function menuTest<C>(test: boolean | ((context: C) => boolean) | undefined, context: C): boolean {
	// @ts-ignore: a function or null here - the editor sees the union
	return test == null || test(context);
}

/** A text of a menu as it is drawn: coloured, with the lines under it, made again only when its source changes. */
class MenuLine {
	// The lines of text under it (addText).
	lines: string = "";
	// The text drawn last, and the source it was drawn for.
	text: string = "";
	private source: string | null = null;

	/** The text drawn for `source`. */
	of(source: string): string {
		if (source != this.source) {
			this.source = source;
			this.text = menuColors(source) + this.lines;
		}
		return this.text;
	}

	/** Adds a line under it. */
	add(line: string): void {
		this.lines += line;
		this.source = null;
	}
}

/** An item of a Menu, with its text as drawn. */
class MenuEntry<Data extends object> extends MenuLine {
	constructor(readonly item: MenuItemOptions<Data>) {
		super();
	}
}

/** What a player is shown of a Menu: the context its functions get, the items, the page, and what each key does. */
class MenuView<Data extends object> {
	// The items shown: the menu's own, or `visible`, the ones their `visible` lets through.
	shown: MenuEntry<Data>[];
	readonly visible: MenuEntry<Data>[] = [];
	// The page: the item of its first key and how many keys are items; the
	// keys of Back and More, -1 without them. A key that cannot be chosen
	// does not come.
	page: i32 = 0;
	first: i32 = 0;
	named: i32 = 0;
	back: i32 = -1;
	more: i32 = -1;

	constructor(public context: MenuContext<Data>, items: MenuEntry<Data>[]) {
		this.shown = items;
	}
}

/** A page of a Menu as it was drawn: what it showed, and its text. */
class DrawnPage {
	constructor(
		readonly page: i32,
		readonly pages: i32,
		readonly title: string,
		readonly names: StaticArray<string>,
		readonly keys: i32,
		readonly text: string
	) {}
}

/**
 * A menu: items a player picks with the number keys, on pages with Back and
 * More, and Exit, drawn as AMX Mod X draws its own. `Data` is what it
 * is shown with, which its functions get beside the player.
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
export class Menu<Data extends object = object> extends ShownMenu {
	private readonly items: MenuEntry<Data>[] = [];
	// Whether an item can be hidden: without one, every item is shown and
	// no list of the shown ones is made.
	private hides: bool = false;
	// The page drawn last, whose text the next show of the same page - the
	// same title, items and keys - sends again rather than drawing it anew.
	private drawn: DrawnPage | null = null;
	// The title as drawn, with the lines added before the first item under it.
	private readonly head: MenuLine = new MenuLine();
	// What each player is shown, by his id: kept from show to show.
	private readonly views: StaticArray<MenuView<Data> | null> = new StaticArray<MenuView<Data> | null>(MAX_PLAYERS + 1);

	constructor(
		private readonly title: string | ((context: MenuContext<Data>) => string),
		private readonly options: MenuOptions = {}
	) {
		super();
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
		this.items.push(new MenuEntry<Data>(item));
		if (item.visible != null) this.hides = true;
	}

	/**
	 * Adds a line of text under the last item added - under the title when
	 * there is none yet - with no number: a note, a price, a heading of the
	 * next items. It is shown and hidden with that item.
	 *
	 * Pawn: `menu_addtext`, `menu_addtext2`
	 */
	addText(text: string): void {
		const line = `\n\\w${text}`;
		const count = this.items.length;
		if (count == 0) this.head.add(line);
		else this.items[count - 1].add(line);
	}

	/**
	 * Adds an empty line under the last item added: `addText("")`.
	 *
	 * Pawn: `menu_addblank`, `menu_addblank2`
	 */
	addBlank(): void {
		this.addText("");
	}

	/**
	 * Shows the menu to a player, with the data its functions get; it closes
	 * when he chooses an item or leaves it.
	 *
	 * Pawn: `menu_display`
	 */
	show(player: Player, data: Data | null = null): void {
		const id = <i32>player.id;
		if (<u32>(id - 1) >= <u32>MAX_PLAYERS) return;
		const given = changetype<Data>(data);
		let view = unchecked(this.views[id]);
		if (view == null) {
			view = new MenuView<Data>({ player, menu: this, data: given }, this.items);
			unchecked(this.views[id] = view);
		} else if (view.context.player !== player || changetype<usize>(view.context.data) != changetype<usize>(given)) {
			// A new context for another player or other data: one a function kept stays as it was.
			view.context = { player, menu: this, data: given };
		}

		let shown = this.items;
		if (this.hides) {
			shown = view.visible;
			shown.length = 0;
			for (let i = 0; i < this.items.length; i++) {
				const entry = this.items[i];
				if (menuTest(entry.item.visible, view.context)) shown.push(entry);
			}
		}
		view.shown = shown;
		this.showPage(id, view, 0);
	}

	/** @hidden For the hood: the player `id` pressed `key` on the page this menu shows him, 0 for 1 and 9 for 0. */
	__press(id: i32, key: i32): void {
		const view = unchecked(this.views[id]);
		if (view == null) return;
		if (key < view.named) unchecked(view.shown[view.first + key]).item.onSelect(view.context);
		else if (key == view.back) this.showPage(id, view, view.page - 1);
		else if (key == view.more) this.showPage(id, view, view.page + 1);
	}

	/** Shows page `page` of the items `view` shows, and keeps what each of its keys does. */
	private showPage(id: i32, view: MenuView<Data>, page: i32): void {
		const shown = view.shown;
		const count = shown.length;
		if (count == 0) return;

		const context = view.context;
		const options = this.options;
		const given = options.perPage;
		const perPage: i32 = given !== undefined ? <i32>Math.min(Math.max(given, 0), 7) : 7;
		const pages = perPage == 0 ? 1 : (count + perPage - 1) / perPage;
		const title = this.head.of(menuText(this.title, context));

		// The keys that can be chosen; and whether the page is the one drawn
		// last, whose text is sent again.
		const first = page * perPage;
		const named = (perPage > 0 ? min(first + perPage, count) : min(count, 10)) - first;
		let drawn = this.drawn;
		let same = drawn != null && drawn.page == page && drawn.pages == pages && drawn.title == title && drawn.names.length == named;
		let keys = 0;
		for (let option = 0; option < named; option++) {
			const entry = unchecked(shown[first + option]);
			const text = entry.of(menuText(entry.item.title, context));
			if (same && unchecked(drawn!.names[option]) != text) same = false;
			if (menuTest(entry.item.enabled, context)) keys |= 1 << option;
		}
		let back = -1;
		let more = -1;
		if (perPage > 0) {
			if (pages > 1) {
				back = perPage;
				more = perPage + 1;
				if (page > 0) keys |= 1 << back;
				if (first + named < count) keys |= 1 << more;
			}
			if (options.exit != false) keys |= 1 << (perPage + 2);
		}

		if (!same || drawn!.keys != keys) {
			const names = new StaticArray<string>(named);
			for (let option = 0; option < named; option++) unchecked(names[option] = unchecked(shown[first + option]).text);
			drawn = new DrawnPage(page, pages, title, names, keys, this.pageText(page, pages, perPage, title, names, keys));
			this.drawn = drawn;
		}

		view.page = page;
		view.first = first;
		view.named = named;
		view.back = back;
		view.more = more;
		show_menu(id, keys, drawn!.text, -1, MENU_TITLE);
		if (unchecked(shownMenus[id]) != this) unchecked(shownMenus[id] = this);
		_menuOpen(id, keys, hostIndex(menuKey, true));
	}

	/** The text of page `page`: its title, the items' `names`, and Back, More and Exit; an item `keys` leaves out is grey. */
	private pageText(page: i32, pages: i32, perPage: i32, title: string, names: StaticArray<string>, keys: i32): string {
		const options = this.options;
		const color = menuOption(options.numberColor, "\\r");
		let text = perPage > 0 && pages > 1 ? `\\y${title} ${page + 1}/${pages}\n\\w\n` : `\\y${title}\n\\w\n`;
		let option = 0;
		for (; option < names.length; option++) {
			const number = (option + 1) % 10;
			text += (keys & 1 << option) != 0 ? `${color}${number}.\\w ${names[option]}\n` : `\\d${number}. ${names[option]}\n\\w`;
		}
		if (perPage == 0) return text;

		for (; option < perPage; option++) text += "\n";
		text += "\n";
		if (pages > 1) {
			text += pageItem(color, option, menuOption(options.backText, "Back"), (keys & 1 << option) != 0);
			option++;
			text += pageItem(color, option, menuOption(options.nextText, "More"), (keys & 1 << option) != 0);
			option++;
		} else {
			option += 2;
		}
		if (options.exit != false) text += pageItem(color, option, menuOption(options.exitText, "Exit"), true);
		return text;
	}
}
