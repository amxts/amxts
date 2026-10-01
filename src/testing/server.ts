import type { PluginNative } from '../../scripts/plugin-natives';
import type { Native, NativeCall } from './natives';
import type { HookShape } from './tables';
import { pawnLayout } from '../../scripts/plugin-natives';
// A game server in TypeScript, standing where runtime/src/module.cpp and AMX
// Mod X stand on a real one.
//
// A plugin's wasm imports two things from "env": the bridge externals the
// facade declares (slot, clcmd, task, on, hook, call, arg_text, say_text ...)
// and the natives as/natives.ts declares, which take Pawn cells. The bridge is
// implemented here the way module.cpp implements it - callback slots, the
// events registry, Fire with its outcome - and the natives in natives.ts,
// against the players and entities below. An import neither covers throws,
// naming itself, the first time the plugin calls it.
import { compile } from './compile';
import { Coroutines, nextTaskId } from './coroutines';
import { installKitFor } from './kits';
import { bitsFloat, floatBits, Memory, utf8Fit } from './memory';
import { fieldCell, NATIVES, setFieldCell, WEAPON_NAMES } from './natives';
import { FakeNetwork } from './network';
import { constant, tables } from './tables';

declare const WebAssembly: any;

/** What a test hands the plugin: a cell, a flag, or text. */
export type Value = number | boolean | string;

/**
 * One argument of a call the plugin is handling, as the caller's frame holds
 * it: a cell, text, or an array (a Pawn array passed by reference - the
 * plugin can read it and write into it).
 */
export type ArgValue = Value | number[] | Pointer;

/**
 * An argument another plugin passed by address - an `any:...` tail - read
 * in its memory as text or as a cell, whichever the native asks for.
 */
export class Pointer {
	constructor(readonly plugin: PluginInstance, readonly at: number) {}
}

/** What `server.native()` gives back: the result decoded the way Pawn would read it. */
export type NativeResult = number | boolean | string | number[] | string[] | null | undefined;

/** A path as AMX Mod X takes it, relative to the game folder: `a/b/c.txt`. */
export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** A parameter's include default as the value Pawn passes when the call leaves it out. */
function pawnDefaultValue(text: string | null): Value {
	if (text === null) return 0;
	if (text === 'true' || text === 'false') return text === 'true';
	if (text.startsWith('"')) return text.slice(1, -1).replace(/\^(.)/g, (_, c: string) => c === 'n' ? '\n' : c === 't' ? '\t' : c);
	return Number(text);
}

/** A wasm function the server calls back, and how. */
interface Handler {
	plugin: PluginInstance;
	/** Its index in the plugin's function table. */
	fn: number;
	/** 0: one cell, the player id. 1: four cells. See SHAPE_* in as/facade.ts. */
	shape: number;
	/** A closure's number: fn is then the plugin's dispatcher, called with it first (Handler.tag in module.cpp). */
	tag?: number;
}

/** A host public standing in for a handler: `__amxts_cb<index>`. */
interface Slot extends Handler {
	index: number;
	/** What the call answers when the handler says nothing. */
	fallback: number;
	key: string;
}

interface Task {
	slot: Slot;
	id: number;
	interval: number;
	due: number;
	repeat: boolean;
	order: number;
}

interface Cvar {
	name: string;
	value: string;
	pointer: number;
	hooks: Slot[];
}

/** The hookchain being run, for GetHookChainReturn and friends. */
export interface Chain {
	shape: HookShape;
	answer: Value;
	args: Value[];
	/** SetHookChainReturn ran: reapi lets a chain that answers be stopped only then. */
	answered?: boolean;
}

/** What firing a hookchain came to. */
export interface HookResult {
	/** A pre listener stopped the game's function: preventDefault, or an answer. */
	prevented: boolean;
	/** The chain's answer after every listener: a number, a boolean or text, by the chain. */
	result: Value;
	/** The arguments as the listeners left them (`event.damage = 10`). */
	args: Value[];
}

/** A user message a plugin sent: ScreenFade, StatusIcon, ... */
export interface UserMessage {
	name: string;
	/** The player it went to; 0 for everyone. */
	player: number;
	/** What was written, in order: bytes, shorts and longs as numbers, strings as text. */
	args: (number | string)[];
	/** For a temporary effect (`SVC_TEMPENTITY`): who it went to, as `MSG_*` - `0` everyone, `4` those who see `origin`, `8` one player. */
	dest?: number;
	/** For a temporary effect: the point it is seen from, with `dest` `4`. */
	origin?: number[];
}

/** A forward a plugin sent out through ExecuteForward. */
export interface SentForward {
	name: string;
	/** Each argument as Pawn got it: a cell, a Float, text, or an array's cells. */
	args: (Value | number[])[];
}

/** A menu of AMX Mod X's own, made by menu_create, as the fake keeps it. */
export interface FakeMenu {
	id: number;
	title: string;
	/** The public menu_create was given: called with (player, menu, item). */
	handler: Slot;
	/** Each item's name and its callback's number from menu_makecallback, or -1. */
	items: { name: string; callback: number }[];
	/** MPROP_PERPAGE: `0` is one page, without Back and More. */
	perPage: number;
	/** MPROP_EXIT is not MEXIT_NEVER. */
	exit: boolean;
	back: string;
	next: string;
	exitName: string;
	numberColor: string;
}

/** A menu of AMX Mod X's own on a player's screen, as menu_display drew it. */
export interface MenuScreen {
	menu: number;
	page: number;
	/** What he sees, with the game's colour codes: `\r1.\w Armor`. */
	text: string;
	/** The keys that answer: 1-9 and 0. */
	keys: number[];
	/** The keys of the items drawn grey, which do nothing. */
	disabled: number[];
}

/** One line a player was shown. */
export interface Message {
	variant: 'chat' | 'center' | 'console' | 'notify' | 'hud';
	text: string;
}

export interface ServerOptions {
	/** "de_dust2" unless said. */
	map?: string;
	/** 32 unless said. */
	maxPlayers?: number;
	/** The modules hasModule() finds. All of reapi, cstrike, fun, hamsandwich, engine, fakemeta, nvault, resemiclip unless said. */
	modules?: string[];
	/** Cvars the server has before the plugin loads: `{ mp_freezetime: "5" }`. */
	cvars?: Record<string, string>;
	/** Files in the game folder before the plugin loads, by path: `{ "addons/amxmodx/configs/x.ini": "..." }`. */
	files?: Record<string, string>;
	/**
	 * The system the server runs on, as `@amxts/core/os` finds it: "win32" puts the amxts
	 * module's amxts_amxx.dll in the modules folder. "linux" unless said.
	 */
	platform?: 'win32' | 'linux';
	/** The server's time zone, what Date's local getters read: "Asia/Yerevan". This machine's unless said. */
	timeZone?: string;
}

export type TeamName = 'UNASSIGNED' | 'TERRORIST' | 'CT' | 'SPECTATOR';

export const TEAMS: TeamName[] = ['UNASSIGNED', 'TERRORIST', 'CT', 'SPECTATOR'];

export interface JoinOptions {
	team?: TeamName;
	health?: number;
	armor?: number;
	alive?: boolean;
	bot?: boolean;
	authid?: string;
	ip?: string;
	/** Admin flags as users.ini writes them: "abcdefghijklmnopqrstu". "z" - a plain user - unless said. */
	flags?: string;
	origin?: number[];
	/** What he carries; the first is in his hands. A knife unless said. */
	weapons?: string[];
}

const SHAPE_NARROW = 0;
const SHAPE_WIDE = 1;
/** A slot taken back after a reload: SLOT_REUSED in module.cpp. */
const SLOT_REUSED = 0x10000;
const PLUGIN_HANDLED = 1;
const HC_SUPERCEDE = 1;
const HC_BREAK = 2;
// A Ham Sandwich hook's answer that blocks the game's function.
const HAM_SUPERCEDE = 4;
// A message argument's types, as get_msg_argtype answers.
const ARG_BYTE = 1;
const ARG_COORD = 6;
const ARG_STRING = 7;

/**
 * Date#getTimezoneOffset() in a time zone: minutes from its wall clock at
 * that moment to UTC, UTC+4 being -240. This machine's without one.
 */
function timezoneOffset(time: number, timeZone: string | undefined): number {
	if (timeZone === undefined) return new Date(time).getTimezoneOffset();
	const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(time);
	const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
	const wall = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second'));
	return (Math.floor(time / 1000) * 1000 - wall) / 60_000;
}

/** Any entity: its entvars and members, as the natives read and write them. */
export class FakeEntity {
	/** Keyed by the constant's value, and `value:element` for an array member. */
	readonly fields = new Map<string, number | number[] | string>();

	constructor(readonly server: FakeServer, readonly id: number, classname: string) {
		this.set('var_classname', classname);
		this.set('var_gravity', 1);
	}

	/**
	 * A field by its constant's name, with or without the prefix:
	 * `get("gravity")`, `get("var_renderfx")`, `get("m_iHideHUD")`. A float
	 * is a number, a vector an array of three.
	 */
	get(name: string, element?: number): number | number[] | string {
		return this.fields.get(FakeEntity.key(fieldOf(name), element)) ?? 0;
	}

	set(name: string, value: number | number[] | string, element?: number): void {
		this.fields.set(FakeEntity.key(fieldOf(name), element), value);
	}

	static key(field: number, element?: number): string {
		return element === undefined ? `${field}` : `${field}:${element}`;
	}

	get classname(): string { return String(this.get('var_classname')); }

	get origin(): number[] { return vector(this.get('var_origin')); }
	set origin(value: number[]) { this.set('var_origin', [...value]); }
}

function vector(value: number | number[] | string): number[] {
	return Array.isArray(value) ? value : [0, 0, 0];
}

function fieldOf(name: string): number {
	const { constants } = tables();
	const value = constants.get(name) ?? constants.get(`var_${name}`) ?? constants.get(`m_${name}`);
	if (value === undefined) throw new Error(`no entvar or member named ${name}`);
	return value;
}

/** A weapon a player carries. */
export class FakeWeapon extends FakeEntity {
	constructor(server: FakeServer, id: number, readonly kind: string, owner: number) {
		super(server, id, kind);
		this.set('m_iId', WEAPON_NAMES.indexOf(kind));
		this.set('var_owner', owner);
		this.set('m_pPlayer', owner);
	}
}

/** Which of m_rgpPlayerItems a weapon goes in: 1 primary, 2 pistol, 3 knife, 4 grenades, 5 C4. */
function slotOf(kind: string): number {
	if (kind === 'weapon_knife') return 3;
	if (kind === 'weapon_c4') return 5;
	if (/grenade|flashbang/.test(kind)) return 4;
	if (/p228|elite|fiveseven|usp|glock18|deagle/.test(kind)) return 2;
	return 1;
}

/** A player: what the natives read, and what he was shown. */
export class FakePlayer extends FakeEntity {
	connected = true;
	alive: boolean;
	readonly bot: boolean;
	readonly authid: string;
	readonly ip: string;
	/** Admin flags as bits: ADMIN_* . */
	flags: number;
	/** SPEAK_* flags: `muted` is SPEAK_MUTED. */
	speak = 0;
	/** Backpack ammo by weapon name. */
	readonly ammo = new Map<string, number>();
	/** Every line he was shown, in order. */
	readonly messages: Message[] = [];
	/** What was run in his console: client_cmd, engclient_cmd. */
	readonly commands: string[] = [];
	/** His userinfo keys - `lang` says his language. */
	readonly info = new Map<string, string>();
	/** The menu of AMX Mod X's own on his screen (menu_display), or null; `menuselect <key>` answers it. */
	menu: MenuScreen | null = null;
	/** His userid, the number `#12` names him by in a command: the server counts them up as players come. */
	readonly userid: number;

	constructor(server: FakeServer, id: number, public name: string, options: JoinOptions) {
		super(server, id, 'player');
		this.alive = options.alive ?? true;
		this.bot = options.bot ?? false;
		this.authid = options.authid ?? (this.bot ? 'BOT' : `STEAM_0:0:${id}`);
		this.ip = options.ip ?? `127.0.0.${id}:27005`;
		this.flags = flagBits(options.flags ?? 'z');
		this.userid = server.nextUserid();
		this.team = options.team ?? 'CT';
		this.health = options.health ?? 100;
		this.armor = options.armor ?? 0;
		this.set('var_max_health', 100);
		this.set('var_netname', name);
		this.set('var_flags', constant('FL_CLIENT') | constant('FL_ONGROUND'));
		this.origin = options.origin ?? [0, 0, 0];

		for (const weapon of options.weapons ?? ['weapon_knife']) this.give(weapon);
		const first = this.items[0];
		if (first) this.set('m_pActiveItem', first.id);
	}

	get health(): number { return Number(this.get('var_health')); }
	set health(value: number) { this.set('var_health', value); }

	get armor(): number { return Number(this.get('var_armorvalue')); }
	set armor(value: number) { this.set('var_armorvalue', value); }

	get frags(): number { return Number(this.get('var_frags')); }
	set frags(value: number) { this.set('var_frags', value); }

	get deaths(): number { return Number(this.get('m_iDeaths')); }
	set deaths(value: number) { this.set('m_iDeaths', value); }

	get team(): TeamName { return TEAMS[Number(this.get('m_iTeam'))] ?? 'UNASSIGNED'; }
	set team(value: TeamName) { this.set('m_iTeam', Math.max(TEAMS.indexOf(value), 0)); }

	get muted(): boolean { return (this.speak & constant('SPEAK_MUTED')) !== 0; }

	/** The chat lines he was shown, one a line, colour bytes taken out. */
	get chat(): string { return this.lines('chat'); }
	/** What was printed in the middle of his screen. */
	get center(): string { return this.lines('center'); }
	/** What was printed in his console. */
	get console(): string { return this.lines('console'); }
	/** HUD messages. */
	get hud(): string { return this.lines('hud'); }

	private lines(variant: Message['variant']): string {
		return this.messages.filter(m => m.variant === variant).map(m => m.text).join('\n');
	}

	/** A line for him. @internal */
	show(variant: Message['variant'], text: string): void {
		// The colour codes ^1-^4 a chat line carries are not text.
		// oxlint-disable-next-line no-control-regex
		this.messages.push({ variant, text: text.replace(/[\x01-\x04]/g, '') });
	}

	/** Forgets what he was shown, for a test that checks one step at a time. */
	clearMessages(): void {
		this.messages.length = 0;
	}

	/** Every weapon he carries, slot by slot. */
	get items(): FakeWeapon[] {
		const list: FakeWeapon[] = [];
		for (let slot = 0; slot < 6; slot++) {
			let id = Number(this.get('m_rgpPlayerItems', slot));
			while (id > 0) {
				const weapon = this.server.entities.get(id);
				if (!(weapon instanceof FakeWeapon)) break;
				list.push(weapon);
				id = Number(weapon.get('m_pNext'));
			}
		}
		return list;
	}

	/** What is in his hands. */
	get activeItem(): FakeWeapon | null {
		const weapon = this.server.entities.get(Number(this.get('m_pActiveItem')));
		return weapon instanceof FakeWeapon ? weapon : null;
	}

	/** Hands him a weapon, at the end of its slot's chain. */
	give(kind: string): FakeWeapon {
		const weapon = new FakeWeapon(this.server, this.server.nextEntityId(), kind, this.id);
		this.server.entities.set(weapon.id, weapon);

		const slot = slotOf(kind);
		const first = Number(this.get('m_rgpPlayerItems', slot));
		if (first <= 0) {
			this.set('m_rgpPlayerItems', weapon.id, slot);
		} else {
			let last = this.server.entities.get(first)!;
			while (Number(last.get('m_pNext')) > 0) last = this.server.entities.get(Number(last.get('m_pNext')))!;
			last.set('m_pNext', weapon.id);
		}
		return weapon;
	}

	/** Takes every weapon away. */
	stripWeapons(): void {
		for (const weapon of this.items) this.server.entities.delete(weapon.id);
		for (let slot = 0; slot < 6; slot++) this.set('m_rgpPlayerItems', 0, slot);
		this.set('m_pActiveItem', 0);
	}

	/** `say <text>` - a chat line, and a chat command if it is one. True if a plugin swallowed it. */
	say(text: string): boolean {
		return this.chatLine('say', text);
	}

	/** `say_team <text>`. */
	sayTeam(text: string): boolean {
		return this.chatLine('say_team', text);
	}

	private chatLine(command: string, text: string): boolean {
		if (this.server.clientCommand(this, [command, text])) return true;

		// Nobody took it: the game shows it, to everyone or to the team.
		for (const player of this.server.players) {
			if (command === 'say' || player.team === this.team) player.show('chat', `${this.name}: ${text}`);
		}
		return false;
	}

	/**
	 * A console command, split the way the engine splits it: `amx_slap "Some One" 5`.
	 * `menuselect <key>` goes to his menu first, as AMX Mod X takes it. True if handled.
	 */
	command(line: string): boolean {
		const argv = splitCommand(line);
		if (argv[0] === 'menuselect' && this.menu && this.server.selectMenu(this, Number(argv[1]))) return true;
		return this.server.clientCommand(this, argv);
	}

	/** Leaves the server: the disconnect events, then the slot is free. */
	disconnect(options: { dropped?: boolean; reason?: string } = {}): void {
		const dropped = options.dropped ?? false;
		const reason = options.reason ?? 'Client sent \'drop\'';
		this.server.fire('client_disconnected', this.id, dropped, reason, 192);
		this.server.clearPlayerData(this.id);
		this.server.fire('client_disconnect', this.id);
		this.connected = false;
		this.alive = false;
		this.server.fire('client_remove', this.id, dropped, reason);
		this.server.entities.delete(this.id);
	}
}

/** A line a plugin prints to the server's console, into the log. */
function logLine(this: FakeServer, plugin: PluginInstance, message: number): void {
	this.logLines.push(plugin.memory.string(message));
}

/** users.ini letters as AMX Mod X reads them: `a` is bit 0, `b` bit 1 ... */
export function flagBits(letters: string): number {
	let bits = 0;
	for (const letter of letters) {
		const at = letter.charCodeAt(0) - 97;
		if (at >= 0 && at < 26) bits |= 1 << at;
	}
	return bits;
}

/** What stops a test that calls a native nothing here answers. */
function unsimulated(name: string): Error {
	return new Error(`the plugin called the native "${name}", which the fake server does not simulate: answer it in the test with server.defineNative("${name}", (call, args) => ...)`);
}

/** A command line as the engine splits it: on spaces, a quoted part kept whole. */
function splitCommand(line: string): string[] {
	return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map(m => m[1] ?? m[2]);
}

/** A loaded plugin: its instance and its memory. */
export class PluginInstance {
	instance: any;
	memory!: Memory;
	/** What plugin() said about it. */
	info = { name: '', version: '', author: '', description: '' };
	/** Taken off the server (FakeServer.unload): its slots answer nothing until the same file takes them back. */
	unloaded = false;

	/** The coroutine scheduler, for a plugin that awaits; null for one that does not. */
	readonly coroutines: Coroutines | null;

	constructor(readonly server: FakeServer, readonly source: string, module: any, readonly natives: PluginNative[] = [], binary?: Uint8Array) {
		this.coroutines = binary ? new Coroutines(binary) : null;
		const scheduler = this.coroutines?.imports() ?? {};
		const env: Record<string, (...args: any[]) => any> = {};
		for (const { module: from, name } of WebAssembly.Module.imports(module)) {
			if (from === 'env') env[name] = Object.hasOwn(scheduler, name) ? scheduler[name] : this.importFor(name);
		}

		this.instance = new WebAssembly.Instance(module, { env });
		this.memory = new Memory(this.instance.exports);
		this.coroutines?.attach(this.instance.exports);
	}

	/** Runs the file's top level. */
	start(): void {
		this.server.within(this, () => this.instance.exports._start?.());
	}

	get table(): any {
		return this.instance.exports.table;
	}

	private importFor(name: string): (...args: any[]) => any {
		if (Object.hasOwn(this.server.bridge, name)) {
			const bridge = (this.server.bridge as Record<string, (...args: any[]) => any>)[name];
			return (...args: number[]) => bridge.call(this.server, this, ...args);
		}

		if (this.server.hasNative(name)) return (...args: number[]) => this.server.callNativeImpl(this, name, args);

		// Another plugin's `export function`, called through @amxts/core/natives as AMX
		// Mod X would route it; whether one exports it is known only at the call.
		return (...cells: number[]) => {
			if (this.server.exported.has(name)) return this.server.callFromPlugin(this, name, cells);
			throw unsimulated(name);
		};
	}
}

/**
 * The server a plugin runs on in a test.
 *
 * ```ts
 * const server = await loadPlugin("plugins/myplugin.ts");
 * const player = server.join("Alice", { team: "CT" });
 * player.say("/tour");
 * server.advance(5000);
 * ```
 */
export class FakeServer {
	readonly map: string;
	readonly maxPlayers: number;
	readonly modules: Set<string>;
	/** Milliseconds since the map started; advance() moves it. */
	time = 0;
	/** Date.now() when the map started. */
	readonly startedAt = Date.now();
	/** The server's time zone; this machine's when undefined. */
	readonly timeZone: string | undefined;

	readonly plugins: PluginInstance[] = [];
	/** Players by slot, 1 to maxPlayers; weapons and other entities after them. */
	readonly entities = new Map<number, FakeEntity>();
	/** What console.log and server_print wrote, one entry a line. */
	readonly logLines: string[] = [];
	/** What server_cmd ran. */
	readonly commands: string[] = [];
	/** Forwards the plugins sent out with ExecuteForward, in order. */
	readonly forwards: SentForward[] = [];
	/** nVault files, by name. */
	readonly vaults = new Map<string, Map<string, string>>();
	/**
	 * The game folder's files, by path relative to it
	 * (`addons/amxmodx/data/x.txt`): what fs and the file natives read and
	 * write. A test fills it before the plugin reads, and reads it after.
	 */
	readonly files = new Map<string, Uint8Array>();
	/** Folders that are there with nothing in them; a file's folders are there anyway. */
	readonly folders = new Set<string>(['addons', 'addons/amxmodx', 'addons/amxmodx/configs', 'addons/amxmodx/data']);
	/** What get_localinfo answers: the folders AMX Mod X was told about. */
	readonly localinfo = new Map<string, string>([
		['amxx_basedir', 'addons/amxmodx'],
		['amxx_configsdir', 'addons/amxmodx/configs'],
		['amxx_datadir', 'addons/amxmodx/data'],
		['amxx_modulesdir', 'addons/amxmodx/modules'],
	]);

	/**
	 * The dynamic arrays (cellarray.inc) plugins made, by handle: an item is
	 * its cells, text a byte a cell. `cellArrayStrings(handle)` and
	 * `cellArrayCells(handle)` read one the way a Pawn plugin would.
	 */
	readonly cellArrays = new Map<number, { cellSize: number; items: number[][] }>();
	private nextCellArray = 1;
	/** fopen's and open_dir's handles. @internal */
	readonly handles = new Map<number, { path: string; position: number } | { entries: string[]; next: number }>();

	/** Everything below is the module's state. @internal */
	readonly events = new Map<string, Handler[]>();
	readonly subscriptions = new Map<string, { handler: Handler; tag: number }[]>();
	readonly slots: Slot[] = [];
	readonly clientCommands = new Map<string, Slot[]>();
	readonly serverCommands = new Map<string, Slot[]>();
	readonly hookchains = new Map<string, { pre: Slot[]; post: Slot[] }>();
	readonly tasks: Task[] = [];
	readonly exported = new Map<string, Handler>();
	readonly cvars = new Map<string, Cvar>();
	readonly vaultHandles: string[] = [];
	readonly forwardHandles: { name: string; types: number[] }[] = [];
	hud = { color: [200, 100, 0], x: -1, y: 0.35, hold: 12, channel: -1 };

	/** The game rules' members a plugin set (set_member_game), by member. */
	readonly rules = new Map<number, number>();
	/** The members plugins asked member_slot for, by slot: each one's reapi constant. */
	private readonly memberSlots: number[] = [];
	/** Rounds a plugin ended with rg_round_end, in order. */
	readonly roundEnds: { status: number; event: number; delay: number; message: string; sound: string; trigger: boolean }[] = [];
	/** Sounds played: from an entity (emit_sound, rh_emit_sound2), or to a player alone (SendAudio, rg_send_audio). */
	readonly sounds: { entity: number; sample: string }[] = [];
	/**
	 * User messages plugins sent, in order: the message's name, the player it
	 * went to (0 for everyone), and what was written, write_* by write_*.
	 */
	readonly userMessages: UserMessage[] = [];
	/** The ids get_user_msgid handed out, by name - ShowMenu's is the game's 96. @internal */
	readonly messageIds = new Map<string, number>([['ShowMenu', 96]]);
	/** The message between message_begin and message_end. @internal */
	writing: UserMessage | null = null;
	/** Told of every message as it ends: the menu kit reads ShowMenu here. @internal */
	readonly messageListeners: ((message: UserMessage) => void)[] = [];
	/** resemiclip's masks, by player: bit N set - player N+1 is not solid to him. */
	readonly semiclipMasks = new Map<number, number>();
	/** Whether a plugin took resemiclip's rules over (resemiclip_take_control). */
	semiclipControlled = false;
	/** The progress bar each player was last shown (rg_send_bartime), in seconds. */
	readonly bartimes = new Map<number, number>();
	/** RegisterHam's callbacks, by `<function id>:<class>:pre|post`. */
	readonly hams = new Map<string, Slot[]>();
	/**
	 * The entity functions plugins ran - `weapon.deploy()`, `entity.use(...)` -
	 * in order: the Ham_* constant's number, the entity, the arguments after it
	 * as cells, and whether every plugin's listeners ran on it (ExecuteHamB).
	 */
	readonly hamCalls: { fn: number; entity: number; args: number[]; hooks: boolean }[] = [];
	/** register_message's callbacks, by the message's id. */
	readonly messageHooks = new Map<number, Slot[]>();
	/** The message register_message's callbacks are reading and writing: its arguments and their ARG_* types. @internal */
	hookedMessage: { args: (number | string)[]; types: number[] } | null = null;
	/** register_touch's callbacks. */
	readonly touches: { touched: string; toucher: string; slot: Slot }[] = [];
	/** query_client_cvar's questions, waiting for answerCvar(). */
	readonly cvarQueries: { player: number; cvar: string; slot: Slot }[] = [];
	/** The menus menu_create made and menu_destroy has not taken away, by id. */
	readonly menus = new Map<number, FakeMenu>();
	/** menu_makecallback's publics, by the number it gave. @internal */
	readonly menuCallbacks: Slot[] = [];
	private menuIds = 0;
	private userids = 1;

	/** A userid for a player who comes: one more than the last. @internal */
	nextUserid(): number {
		return this.userids++;
	}

	/** What precache_model and precache_sound were asked for, in order: the index is the place + 1. */
	readonly precached: string[] = [];
	/**
	 * The fields plugins add to Player, by slot and field name, as the module
	 * keeps them: a number
	 * (a boolean is 1 or 0) or a text. Cleared when a player leaves.
	 */
	readonly playerData = new Map<number, Map<string, number | string>>();
	/** Which of those texts are lists of player ids ("3,5"), by `slot:key`: a player who leaves goes from them. */
	readonly playerLists = new Set<string>();
	/**
	 * The playerchange listeners, as the module keeps them: per plugin, the
	 * fields it hears ("" for every one) and the trampoline that hands a change
	 * to its listeners.
	 */
	readonly fieldListeners: { plugin: PluginInstance; fn: number; fields: string[] }[] = [];
	/** The change being told, which the player_change_* imports read. @internal */
	fieldChange: { key: string; previous: number | string | undefined; value: number | string } | null = null;

	/** The arguments of the callback that is running, for arg() and arg_text(). */
	callArgs: ArgValue[] | null = null;
	/** The command being handled, for read_argv. */
	argv: string[] = [];
	chain: Chain | null = null;
	current: PluginInstance | null = null;
	private outcome = 0;
	private outcomeSaid = false;
	private taskOrder = 0;
	private hookHandles = 0;
	private entityIds: number;

	constructor(options: ServerOptions = {}) {
		this.map = options.map ?? 'de_dust2';
		this.maxPlayers = options.maxPlayers ?? 32;
		this.modules = new Set(options.modules ?? ['reapi', 'cstrike', 'fun', 'hamsandwich', 'engine', 'fakemeta', 'nvault', 'resemiclip']);
		this.entityIds = this.maxPlayers + 1;
		this.timeZone = options.timeZone;
		// AMX Mod X's own, which a test may set: the languages.
		const cvars = { amx_language: 'en', amx_client_languages: '1', ...options.cvars };
		for (const [name, value] of Object.entries(cvars)) this.createCvar(name, value);
		for (const [path, text] of Object.entries(options.files ?? {})) this.writeFile(path, text);
		if (options.platform === 'win32') this.writeFile('addons/amxmodx/modules/amxts_amxx.dll', '');
	}

	/**
	 * The test kits of the module packages loaded here, by package name: what
	 * each kit's install() gave back (defineTestKit). @internal
	 */
	readonly kits = new Map<string, unknown>();
	/** Natives a test kit answers on this server, over the fake's own. */
	private readonly ownNatives = new Map<string, Native>();
	/** The `export function` natives of the loaded plugins, by name: the first plugin's where two export one. */
	private readonly pluginNatives = new Map<string, PluginNative>();

	/**
	 * Answers a native on this server - for a module's test kit, which adds
	 * what its plugin calls (a menu's show_menu, callfunc into Pawn). Before
	 * the plugins load: a plugin is given its natives as it loads.
	 */
	defineNative(name: string, native: Native): void {
		this.ownNatives.set(name, native);
	}

	/** Whether a native is answered here: by a test kit, or by the fake itself. @internal */
	hasNative(name: string): boolean {
		return this.ownNatives.has(name) || Object.hasOwn(NATIVES, name);
	}

	/**
	 * Loads a plugin: its top level runs now, its init when start() is called.
	 * A module package by name - "@amxts/menu-core" - is its plugin, and its
	 * test kit, when it has one, is installed first.
	 */
	async load(source: string): Promise<PluginInstance> {
		await installKitFor(this, source);
		const { module, natives, binary, async } = await compile(source);
		const plugin = new PluginInstance(this, source, module, natives, async ? binary : undefined);
		this.plugins.push(plugin);
		for (const native of natives) {
			if (!this.pluginNatives.has(native.name)) this.pluginNatives.set(native.name, native);
		}
		plugin.start();
		return plugin;
	}

	/** plugin_precache, plugin_init and plugin_cfg, as a map start sends them. */
	start(): void {
		this.fire('plugin_precache');
		this.fire('plugin_init');
		this.fire('plugin_cfg');
	}

	// ------------------------------------------------------------ what a test reads

	/** Everything logged, one line a line. */
	get log(): string {
		return this.logLines.join('\n');
	}

	/** The players on the server. */
	get players(): FakePlayer[] {
		return [...this.entities.values()].filter((e): e is FakePlayer => e instanceof FakePlayer && e.connected);
	}

	player(id: number): FakePlayer | undefined {
		const entity = this.entities.get(id);
		return entity instanceof FakePlayer && entity.connected ? entity : undefined;
	}

	/** A cvar's value, or undefined when the server has no such cvar. */
	cvar(name: string): string | undefined {
		return this.cvars.get(name.toLowerCase())?.value;
	}

	/** Sets a cvar as the console would: `mp_freezetime 5`, and its change listeners hear it. */
	setCvar(name: string, value: string | number): void {
		const cvar = this.cvars.get(name.toLowerCase()) ?? this.createCvar(name, '');
		this.changeCvar(cvar, String(value));
	}

	/** A file's text, or undefined when there is no such file. */
	file(path: string): string | undefined {
		const bytes = this.files.get(normalizePath(path));
		return bytes && new TextDecoder().decode(bytes);
	}

	/** Puts a file in the game folder, as UTF-8. */
	writeFile(path: string, text: string): void {
		this.files.set(normalizePath(path), new TextEncoder().encode(text));
	}

	// ------------------------------------------------------------ dictionaries

	/** The dictionaries' lines by language, then key: what register_dictionary loaded and translate() added. */
	readonly dictionary = new Map<string, Map<string, string>>();
	/** Every key in the order it came, as GetLangTransKey numbers them. */
	private readonly langKeys: string[] = [];

	/**
	 * Lines as a dictionary file writes them - `^n` a line break, `^4` chat's
	 * green, `\y` a menu's yellow: `server.translate({ MYPLUGIN_HELLO: "Hello, %s" })`,
	 * `server.translate({ ... }, "ru")`.
	 */
	translate(lines: Record<string, string>, language = 'en'): void {
		for (const [key, text] of Object.entries(lines)) this.addLangLine(language, key, text);
	}

	/**
	 * Reads `addons/amxmodx/data/lang/<file>` as register_dictionary does:
	 * `[en]` sections of `KEY = text` lines. False when there is no such file.
	 */
	loadDictionary(file: string): boolean {
		const text = this.file(`addons/amxmodx/data/lang/${file}`);
		if (text === undefined) return false;
		let language = '';
		for (const raw of text.split(/\r?\n/)) {
			const line = raw.trim();
			const section = line.match(/^\[(\w+)\]$/);
			const at = line.indexOf('=');
			if (section) language = section[1].toLowerCase();
			else if (language && at > 0 && !line.startsWith(';')) this.addLangLine(language, line.slice(0, at).trim(), line.slice(at + 1).trim());
		}
		return true;
	}

	/**
	 * The key's line for a player (`0`: the server), as LookupLangKey finds
	 * it: in the player's language, then the server's, then English.
	 */
	lookupLang(key: string, id: number): string | undefined {
		const own = id > 0 ? this.languageOf(id) : undefined;
		for (const language of [own, this.cvar('amx_language') || 'en', 'en']) {
			const text = language ? this.dictionary.get(language)?.get(key) : undefined;
			if (text !== undefined) return text;
		}
		return undefined;
	}

	/**
	 * The language AMX Mod X reads a player's text in (playerlang): his `lang`
	 * setinfo while `amx_client_languages` is on and it starts with a letter,
	 * `amx_language` otherwise.
	 */
	languageOf(id: number): string {
		const own = this.cvar('amx_client_languages') !== '0' ? this.player(id)?.info.get('lang') ?? '' : '';
		return /^[a-z]/i.test(own) ? own : this.cvar('amx_language') ?? 'en';
	}

	/** The key's number, as GetLangTransKey gives it; -1 when no dictionary has it. */
	langKey(key: string): number {
		return this.langKeys.indexOf(key);
	}

	/** One line, with the escapes AMX Mod X turns into characters as it loads a file. */
	private addLangLine(language: string, key: string, text: string): void {
		const escapes: Record<string, string> = { n: '\n', t: '\t', 1: '\x01', 2: '\x02', 3: '\x03', 4: '\x04' };
		const lines = this.dictionary.get(language) ?? new Map<string, string>();
		lines.set(key, text.replace(/\^([nt1-4])/g, (_, code: string) => escapes[code]));
		this.dictionary.set(language, lines);
		if (!this.langKeys.includes(key)) this.langKeys.push(key);
	}

	/** Whether a folder is there: named in `folders`, or holding a file. */
	folderExists(path: string): boolean {
		const folder = normalizePath(path);
		if (folder === '' || this.folders.has(folder)) return true;
		for (const file of this.files.keys()) {
			if (file.startsWith(`${folder}/`)) return true;
		}
		for (const known of this.folders) {
			if (known.startsWith(`${folder}/`)) return true;
		}
		return false;
	}

	/** ArrayCreate. @internal */
	createCellArray(cellSize: number): number {
		const handle = this.nextCellArray++;
		this.cellArrays.set(handle, { cellSize, items: [] });
		return handle;
	}

	/** A dynamic array's items as text (ArrayGetString), or null for a handle that is not there - Invalid_Array is 0. */
	cellArrayStrings(handle: number): string[] | null {
		const array = this.cellArrays.get(handle);
		if (!array) return null;
		return array.items.map((item) => {
			const end = item.indexOf(0);
			return new TextDecoder().decode(Uint8Array.from(end < 0 ? item : item.slice(0, end)));
		});
	}

	/** A dynamic array's items as cells - each item's cells when it holds more than one - or null. */
	cellArrayCells(handle: number): (number | number[])[] | null {
		const array = this.cellArrays.get(handle);
		if (!array) return null;
		return array.items.map(item => array.cellSize === 1 ? item[0] : [...item]);
	}

	/** A storage's nVault, as a Map a test can fill before the plugin reads it. */
	vault(name: string): Map<string, string> {
		let vault = this.vaults.get(name);
		if (!vault) this.vaults.set(name, vault = new Map());
		return vault;
	}

	// ------------------------------------------------------------ what a test does

	/** A player connects: client_connect, client_authorized, client_putinserver. */
	join(name: string, options: JoinOptions = {}): FakePlayer {
		let id = 1;
		while (id <= this.maxPlayers && this.player(id)) id++;
		if (id > this.maxPlayers) throw new Error(`the server is full (${this.maxPlayers} slots)`);

		const player = new FakePlayer(this, id, name, options);
		this.entities.set(id, player);

		this.fire('client_connect', id);
		this.fire('client_authorized', id, player.authid);
		this.fire('client_putinserver', id);
		return player;
	}

	/** The module's network client: the requests plugins sent with fetch. @internal */
	readonly network = new FakeNetwork(this);

	/**
	 * Waits for the responses to the requests the plugins sent with `fetch`,
	 * and hands each to its plugin as the server's next frame would; a
	 * request sent on the way is waited for too. A timer between two tries
	 * waits for `advance()`.
	 *
	 * ```ts
	 * player.say("/weather");
	 * await server.responses();
	 * ```
	 */
	async responses(): Promise<void> {
		await this.network.settle();
	}

	/**
	 * Moves the clock forward and runs every timer that comes due on the way,
	 * in order - a repeating one as many times as it fits.
	 */
	advance(ms: number): void {
		const until = this.time + ms;

		for (;;) {
			const due = this.tasks
				.filter(t => t.due <= until)
				.sort((a, b) => a.due - b.due || a.order - b.order)[0];
			if (!due) break;

			this.time = due.due;
			if (due.repeat) due.due += due.interval;
			else this.tasks.splice(this.tasks.indexOf(due), 1);

			this.withCallArgs([due.id], () => this.call(due.slot, [due.id], 0));
		}

		this.time = until;
	}

	/**
	 * Raises a forward the host plugin relays - "client_putinserver",
	 * "plugin_cfg" - or one a Pawn plugin sends: every handler and every
	 * Forward.subscribe() of that name hears it. Text arrives as text, a
	 * boolean as 1 or 0, an array as its cells (a Float's as its bits). As in
	 * the module, a listener reads every argument from the call's context and
	 * is handed the first cell. Returns the highest answer, as the module does.
	 */
	fire(name: string, ...args: ArgValue[]): number {
		const first = typeof args[0] === 'number' || typeof args[0] === 'boolean' ? Number(args[0]) : 0;
		return this.withCallArgs(args, () => {
			this.deliver(name);

			let result = 0;
			for (const handler of [...(this.events.get(name) ?? [])]) {
				const one = this.call(handler, [first], 0);
				if (one > result) result = one;
			}
			return result;
		});
	}

	/** Every Forward.subscribe() of a forward, called with its tag; the arguments are the context's. */
	private deliver(forward: string): void {
		for (const { handler, tag } of [...(this.subscriptions.get(forward) ?? [])]) this.call(handler, [tag], 0);
	}

	/**
	 * Runs a reapi hookchain the way the game would: the pre listeners, then
	 * the game's own function unless one of them stopped it, then the post
	 * listeners.
	 *
	 * ```ts
	 * server.fireHook("takeDamage", [victim.id, 0, attacker.id, 30.0, 2]);
	 * server.fireHook("flPlayerFallDamage", [player.id], { result: 40 });
	 * ```
	 *
	 * `event` is the name game.addEventListener takes, or reapi's short one
	 * ("take_damage"). `args` are the chain's arguments in order; a float is
	 * written as a number and goes as one. `result` is what the game's own
	 * function answers when it runs - what a post listener reads as
	 * event.result.
	 */
	fireHook(event: string, args: Value[] = [], options: { result?: Value } = {}): HookResult {
		const shape = tables().hooks.get(event);
		if (!shape) throw new Error(`no hookchain named "${event}" in as/hooks.ts`);

		const cells = args.map((a, i) => typeof a === 'string'
			? a
			: typeof a === 'boolean'
				? (a ? 1 : 0)
				: shape.floats.has(i) ? floatBits(a) : a | 0);
		const handed = cells.slice(0, 4).map(c => typeof c === 'number' ? c : 0);

		const nothing: Value = shape.answer === constant('ATYPE_BOOL') ? false : shape.answer === constant('ATYPE_STRING') ? '' : 0;
		const chain: Chain = { shape, answer: nothing, args: [...args] };
		const listeners = this.hookchains.get(shape.kind) ?? { pre: [], post: [] };

		const previous = this.chain;
		this.chain = chain;

		try {
			let prevented = false;
			let broken = false;

			for (const slot of [...listeners.pre]) {
				const said = this.withCallArgs(cells, () => this.call(slot, handed, slot.fallback));
				// What reapi answers a plugin that blocks a chain with a return value
				// before setting one - a run time error, and the block does not hold.
				if ((said === HC_SUPERCEDE || said === HC_BREAK) && shape.answer >= 0 && !chain.answered) {
					throw new Error(`${event}: Can't suppress original function call without new return value set, so you must call SetHookChainReturn.`);
				}
				if (said === HC_SUPERCEDE) prevented = true;
				if (said === HC_BREAK) {
					prevented = broken = true;
					break;
				}
			}

			if (!prevented) chain.answer = options.result ?? nothing;

			if (!broken) {
				for (const slot of [...listeners.post]) {
					this.withCallArgs(cells, () => this.call(slot, handed, slot.fallback));
				}
			}

			return { prevented, result: chain.answer, args: chain.args };
		} finally {
			this.chain = previous;
		}
	}

	/**
	 * Sends a message to a client the way the game would, through the
	 * register_message callbacks of its name: they read and change its
	 * arguments, and may stop it.
	 *
	 * ```ts
	 * server.sendMessage("TextMsg", [3, "#Round_Draw"], { player: alice });
	 * const sent = server.sendMessage("RoundTime", [120]);   // sent.args: [90] with a listener that writes 90
	 * ```
	 *
	 * A text argument is a string; a whole number is written as a byte, a
	 * fraction as a coordinate, unless `types` gives each argument's ARG_*.
	 * Returns whether a callback stopped it, and the arguments as they left.
	 */
	sendMessage(name: string, args: (number | string)[], options: { player?: FakePlayer; types?: number[] } = {}): { prevented: boolean; args: (number | string)[] } {
		const id = this.messageIds.get(name);
		const message = {
			args: [...args],
			types: options.types ?? args.map(a => typeof a === 'string' ? ARG_STRING : Number.isInteger(a) ? ARG_BYTE : ARG_COORD),
		};
		const receiver = options.player?.id ?? 0;
		const previous = this.hookedMessage;
		this.hookedMessage = message;
		try {
			let prevented = false;
			for (const slot of [...(id !== undefined ? this.messageHooks.get(id) ?? [] : [])]) {
				const handed = [id ?? 0, receiver ? 1 : 0, receiver, 0];
				if (this.withCallArgs(handed, () => this.call(slot, handed, 0)) === PLUGIN_HANDLED) prevented = true;
			}
			return { prevented, args: message.args };
		} finally {
			this.hookedMessage = previous;
		}
	}

	/**
	 * Runs one entity's function the way the game would, through the Ham
	 * Sandwich hooks registered for its class: the pre listeners, then the
	 * game's own function unless one of them blocked it, then the post
	 * listeners.
	 *
	 * ```ts
	 * server.fireHam("primaryAttack", knife);
	 * server.fireHam("takeDamage", box, [0, alice.id, 30.0, 2], { result: 1 });
	 * ```
	 *
	 * `event` is the name game.addEventListener takes; `args` are the
	 * function's arguments after the entity, a float as a number and a vector
	 * as an array of three.
	 */
	fireHam(event: string, entity: FakeEntity | number, args: Value[] = [], options: { result?: Value } = {}): HookResult {
		const shape = tables().hooks.get(event);
		if (shape?.ham === undefined) throw new Error(`no Ham Sandwich function under the event "${event}" in as/hooks.ts`);
		return this.runHam(shape, typeof entity === 'number' ? entity : entity.id, args, options.result);
	}

	/**
	 * fireHam's work, and ExecuteHamB's: `args` without the entity.
	 * @internal
	 */
	runHam(shape: HookShape, id: number, args: (Value | number[])[], result?: Value): HookResult {
		const classname = this.entities.get(id)?.classname ?? (id >= 1 && id <= this.maxPlayers ? 'player' : '');
		const all = [id, ...args];
		const cells: ArgValue[] = all.map((a, i) => Array.isArray(a)
			? a.map(floatBits)
			: typeof a === 'string'
				? a
				: typeof a === 'boolean'
					? (a ? 1 : 0)
					: shape.floats.has(i) ? floatBits(a) : a | 0);
		const handed = cells.slice(0, 4).map(c => typeof c === 'number' ? c : 0);
		const nothing: Value = shape.answer === constant('ATYPE_STRING') ? '' : 0;
		const chain: Chain = { shape, answer: nothing, args: all.map(a => Array.isArray(a) ? 0 : a) };
		const listeners = (post: boolean) => this.hams.get(`${shape.ham}:${classname}:${post ? 'post' : 'pre'}`) ?? [];

		const previous = this.chain;
		this.chain = chain;

		try {
			let prevented = false;
			for (const slot of [...listeners(false)]) {
				if (this.withCallArgs(cells, () => this.call(slot, handed, slot.fallback)) >= HAM_SUPERCEDE) prevented = true;
			}
			if (!prevented) chain.answer = result ?? nothing;
			for (const slot of [...listeners(true)]) this.withCallArgs(cells, () => this.call(slot, handed, slot.fallback));
			return { prevented, result: chain.answer, args: chain.args };
		} finally {
			this.chain = previous;
		}
	}

	/**
	 * One of the module's own natives for Pawn plugins, as a Pawn plugin calls
	 * it: the amxts_*_player_data natives over the fields plugins add to Player
	 * (runtime/host/amxts.inc).
	 *
	 * ```ts
	 * server.amxtsNative("amxts_get_player_data", bot.id, "spawnProtected");   // 1
	 * server.amxtsNative("amxts_set_player_data_string", bot.id, "tag", "x");
	 * ```
	 *
	 * A number comes back whole, a Float as a number, a text as the text
	 * `out[]` holds (`len` is the last argument, 4095 when left out).
	 */
	amxtsNative(name: string, ...args: Value[]): number | string {
		const [id, key, value] = [Number(args[0]), String(args[1]), args[2]];
		switch (name) {
			case 'amxts_get_player_data': return Math.trunc(this.playerNumber(id, key)) | 0;
			case 'amxts_set_player_data':
				this.setPlayerData(id, key, Math.trunc(Number(value)) | 0);
				return 1;
			case 'amxts_get_player_data_float': return bitsFloat(floatBits(this.playerNumber(id, key)));
			case 'amxts_set_player_data_float':
				this.setPlayerData(id, key, bitsFloat(floatBits(Number(value))));
				return 1;
			case 'amxts_get_player_data_string': {
				const bytes = new TextEncoder().encode(this.playerText(id, key));
				const length = utf8Fit(bytes, Math.max(0, value === undefined ? 4095 : Number(value)));
				return new TextDecoder().decode(bytes.subarray(0, length));
			}
			case 'amxts_set_player_data_string':
				this.setPlayerData(id, key, String(value ?? ''));
				return 1;
		}
		throw new Error(`the module has no native named "${name}"`);
	}

	/** A Player field's number: 0 when never written, or a text. @internal */
	playerNumber(id: number, key: string): number {
		const value = this.playerData.get(id)?.get(key);
		return typeof value === 'number' ? value : 0;
	}

	/** A Player field's text: "" when never written, or a number. @internal */
	playerText(id: number, key: string): string {
		const value = this.playerData.get(id)?.get(key);
		return typeof value === 'string' ? value : '';
	}

	/** Writes a Player field, as the module does: only for a slot, and a change is told. @internal */
	setPlayerData(id: number, key: string, value: number | string, players = false): void {
		if (id < 0 || id > 32) return;
		const previous = this.playerData.get(id)?.get(key);
		const changed = typeof value === 'number'
			? this.playerNumber(id, key) !== value || this.playerText(id, key) !== ''
			: this.playerText(id, key) !== value || this.playerNumber(id, key) !== 0;
		const list = `${id}:${key}`;
		if (typeof value === 'number') this.playerLists.delete(list);
		else if (players) this.playerLists.add(list);
		if (!this.playerData.has(id)) this.playerData.set(id, new Map());
		this.playerData.get(id)!.set(key, value);
		if (changed) this.fieldChanged(id, key, previous);
	}

	/** Every plugin listening for `key` hears it changed on player `id`, once, as the module tells them. */
	private fieldChanged(id: number, key: string, previous: number | string | undefined): void {
		if (this.fieldListeners.length === 0) return;
		const outer = this.fieldChange;
		this.fieldChange = { key, previous, value: this.playerData.get(id)!.get(key)! };
		try {
			for (const { plugin, fn, fields } of [...this.fieldListeners]) {
				if (fields.some(field => field === '' || key === field || key.startsWith(`${field}.`))) this.call({ plugin, fn, shape: SHAPE_NARROW }, [id], 0);
			}
		} finally {
			this.fieldChange = outer;
		}
	}

	/** A player left: his fields go, and he goes from everyone's lists of players. Nobody is told. @internal */
	clearPlayerData(id: number): void {
		for (const key of this.playerData.get(id)?.keys() ?? []) this.playerLists.delete(`${id}:${key}`);
		this.playerData.delete(id);

		for (const list of this.playerLists) {
			const [slot, key] = [Number(list.slice(0, list.indexOf(':'))), list.slice(list.indexOf(':') + 1)];
			const ids = this.playerText(slot, key);
			this.playerData.get(slot)!.set(key, ids.split(',').filter(one => one !== '' && Number(one) !== id).join(','));
		}
	}

	/**
	 * Calls a native a plugin exported with nativeFn, as another plugin would.
	 * Returns what it gave back with ret(); a `setArg` it made lands in `args`.
	 */
	callNative(name: string, ...args: ArgValue[]): number {
		const handler = this.exported.get(name);
		if (!handler) throw new Error(`no plugin exports a native named "${name}"`);
		const handed = args.slice(0, 4).map(a => typeof a === 'number' ? a : typeof a === 'boolean' ? +a : 0);
		return this.withCallArgs(args, () => this.call(handler, handed, 0));
	}

	/**
	 * Calls a plugin's own native - an `export function` of its entry file -
	 * the way a Pawn plugin would, with its `.inc` signature: text as a Pawn
	 * string, a `Float` as its bits, an array followed by its size, and an
	 * out-buffer for a string or array result. Returns the result as Pawn
	 * reads it back: the text in `out[]` for a string (null for a `string |
	 * null` that returned false), the cells written for an array, a float for
	 * a `Float`, a boolean for a `boolean`.
	 */
	native(name: string, ...args: ArgValue[]): NativeResult {
		return this.nativeWithRoom(name, 4095, args);
	}

	/** native(), with an out-buffer of `room` cells: `charsmax(out)` for a string, `max` for an array. */
	nativeWithRoom(name: string, room: number, args: ArgValue[]): NativeResult {
		const handler = this.exported.get(name);
		const native = this.pluginNatives.get(name);
		if (!handler || !native) throw new Error(`no plugin exports a native named "${name}" with export function`);

		// The .inc's order: the result's buffer sits before the first parameter
		// with a default. A parameter left out takes its default, as Pawn fills it in.
		// A native that implements an include lays them out as its declaration
		// does: out-arguments where it puts them, a tail passed by address.
		const layout = pawnLayout(native);
		const frame: ArgValue[] = [];
		const outputs: { at: number; kind: string }[] = [];
		let out = -1;
		const fixed = layout.filter(slot => 'param' in slot && !slot.byRef).length;
		for (const slot of layout) {
			if ('out' in slot) {
				out = frame.length;
				if (native.result === 'string' || native.result === 'string?') frame.push('', room);
				else frame.push([], room);
				continue;
			}
			if ('output' in slot) {
				outputs.push({ at: frame.length, kind: slot.output });
				if (slot.output === 'string') frame.push('', room);
				else if (slot.output === 'ints' || slot.output === 'floats') frame.push([], room);
				else frame.push([0]);
				continue;
			}
			if ('format' in slot) {
				for (const value of args.slice(fixed)) {
					frame.push(typeof value === 'number' ? [value] : typeof value === 'boolean' ? [+value] : value);
				}
				continue;
			}
			const { param, index, byRef } = slot;
			if (byRef) {
				// A tail parameter: only what the test passed.
				const value = args[index];
				if (index < args.length) frame.push(typeof value === 'string' ? value : [Number(value)]);
				continue;
			}
			const value = index < args.length ? args[index] : pawnDefaultValue(param.pawnDefault);
			if (param.kind === 'float') {
				frame.push(floatBits(Number(value)));
			} else if (param.kind === 'vector') {
				frame.push((value as number[]).map(floatBits));
			} else if (param.kind === 'ints' || param.kind === 'floats') {
				const list = value as number[];
				frame.push(param.kind === 'floats' ? list.map(floatBits) : [...list], list.length);
			} else {
				frame.push(value as Value);
			}
		}

		const cell = this.withCallArgs(frame, () => this.call(handler, [], 0));

		// Several outputs, or one through a reference: what the native wrote,
		// in order - or null when it returned false.
		if (outputs.length > 1 || outputs.some(o => o.kind === 'ref' || o.kind === 'float-ref')) {
			if (cell === 0) return null;
			return outputs.map(({ at, kind }) => {
				const value = frame[at];
				if (kind === 'ref') return String((value as number[])[0]);
				if (kind === 'float-ref') return String(bitsFloat((value as number[])[0]));
				return value as string;
			});
		}
		if (outputs.length === 1) out = outputs[0].at;

		switch (native.result) {
			// Pawn gets a cell even from a native that returns nothing: a player
			// native answers 1 when it ran, 0 for a bad slot (plugin-natives.ts).
			case 'void': return cell;
			case 'int': case 'tag': case 'array': return cell;
			case 'float': return bitsFloat(cell);
			case 'bool': return cell !== 0;
			case 'string': return frame[out] as string;
			case 'string?': return cell !== 0 ? frame[out] as string : null;
			case 'ints': return (frame[out] as number[]).slice(0, cell);
			case 'floats': return (frame[out] as number[]).slice(0, cell).map(bitsFloat);
		}
	}

	/**
	 * A plugin calling another plugin's `export function` native
	 * through its @amxts/core/natives wrapper: the cells it pushed - text and buffers as
	 * addresses in its memory - turned into the frame the native reads, and
	 * what the native wrote into a buffer copied back, as AMX Mod X does.
	 * @internal
	 */
	callFromPlugin(caller: PluginInstance, name: string, cells: number[]): number {
		const handler = this.exported.get(name)!;
		const native = this.pluginNatives.get(name);
		if (!native) return this.call(handler, cells.slice(0, 4), 0);

		const frame: ArgValue[] = [];
		const buffers: { at: number; pointer: number; room: number }[] = [];
		let next = 0;
		for (const slot of pawnLayout(native)) {
			if ('out' in slot || ('output' in slot && slot.output !== 'ref' && slot.output !== 'float-ref')) {
				const pointer = cells[next++];
				const room = cells[next++];
				buffers.push({ at: frame.length, pointer, room });
				const text = 'out' in slot ? native.result === 'string' || native.result === 'string?' : slot.output === 'string';
				frame.push(text ? '' : [], room);
				continue;
			}
			if ('output' in slot) {
				const pointer = cells[next++];
				buffers.push({ at: frame.length, pointer, room: 1 });
				frame.push([caller.memory.cell(pointer)]);
				continue;
			}
			if ('format' in slot || slot.byRef) {
				// The tail, by address in the caller's memory.
				while (next < cells.length) frame.push(new Pointer(caller, cells[next++]));
				if ('format' in slot) continue;
				break;
			}
			const { kind } = slot.param;
			if (kind === 'string') {
				frame.push(caller.memory.text(cells[next++]));
			} else if (kind === 'vector') {
				frame.push([0, 1, 2].map(i => caller.memory.cell(cells[next] + i * 4)));
				next++;
			} else if (kind === 'ints' || kind === 'floats') {
				const pointer = cells[next++];
				const size = cells[next++];
				frame.push(Array.from({ length: size }, (_, i) => caller.memory.cell(pointer + i * 4)), size);
			} else {
				frame.push(cells[next++] ?? 0);
			}
		}

		const result = this.withCallArgs(frame, () => this.call(handler, [], 0));

		for (const { at, pointer, room } of buffers) {
			const value = frame[at];
			if (typeof value === 'string') caller.memory.setText(pointer, room, value);
			else if (Array.isArray(value)) value.slice(0, room).forEach((cell, i) => caller.memory.setCell(pointer + i * 4, cell));
		}
		return result;
	}

	// ------------------------------------------------------------ the module's half

	/** Fire in module.cpp: one handler, its outcome, and the state put back. @internal */
	call(handler: Handler, args: number[], fallback: number): number {
		if (handler.plugin.unloaded) return fallback;
		const fn = handler.plugin.table.get(handler.fn);
		const cells = handler.shape === SHAPE_WIDE ? [0, 1, 2, 3].map(i => args[i] ?? 0) : [args[0] ?? 0];
		if (handler.tag) cells.unshift(handler.tag);

		const said = this.outcomeSaid;
		const before = this.outcome;
		this.outcomeSaid = false;

		try {
			this.within(handler.plugin, () => fn(...cells));
			return this.outcomeSaid ? this.outcome : fallback;
		} finally {
			this.outcomeSaid = said;
			this.outcome = before;
		}
	}

	/** Runs `body` as `plugin`: what its natives are called on behalf of. @internal */
	within<T>(plugin: PluginInstance, body: () => T): T {
		const previous = this.current;
		this.current = plugin;
		const coroutines = plugin.coroutines;
		if (coroutines) coroutines.depth++;
		try {
			return body();
		} finally {
			this.current = previous;
			// The plugin's jobs - what an await was waiting for - once nothing of it is on the stack.
			if (coroutines && --coroutines.depth === 0 && coroutines.waiting) {
				const outer = this.current;
				this.current = plugin;
				coroutines.depth++;
				try {
					coroutines.drain();
				} finally {
					coroutines.depth--;
					this.current = outer;
				}
			}
		}
	}

	/** The arguments arg() and arg_text() read while `body` runs. @internal */
	withCallArgs<T>(args: ArgValue[], body: () => T): T {
		const previous = this.callArgs;
		this.callArgs = args;
		try {
			return body();
		} finally {
			this.callArgs = previous;
		}
	}

	/** A client command: client_command, then every handler of it until one takes it. @internal */
	clientCommand(player: FakePlayer, argv: string[]): boolean {
		return this.withArgv(argv, () =>
			this.fire('client_command', player.id) >= PLUGIN_HANDLED || this.handleCommand(this.clientCommands, player.id));
	}

	/**
	 * A line typed in the server console or sent over rcon, split the way the
	 * engine splits it: every `register_srvcmd` handler of it until one takes
	 * it. True if handled.
	 */
	serverCommand(line: string): boolean {
		return this.withArgv(splitCommand(line), () => this.handleCommand(this.serverCommands, 0));
	}

	/** The handlers of the command in argv, in order, until one takes it. */
	private handleCommand(handlers: Map<string, Slot[]>, id: number): boolean {
		return [...(handlers.get(this.argv[0].toLowerCase()) ?? [])].some((slot) => {
			const args = [id, 0, slot.index];
			return this.withCallArgs(args, () => this.call(slot, args, slot.fallback)) >= PLUGIN_HANDLED;
		});
	}

	/** The command read_argv reads while `body` runs. */
	private withArgv<T>(argv: string[], body: () => T): T {
		const previous = this.argv;
		this.argv = argv;
		try {
			return body();
		} finally {
			this.argv = previous;
		}
	}

	/**
	 * Takes a plugin off the server, as `amxts_reload` does before it loads
	 * the plugins again: a call to one of its slots answers nothing, until a
	 * plugin of the same file asks for the same key and takes the slot back.
	 * `load` the file again for the reload's second half.
	 */
	unload(plugin: PluginInstance): void {
		plugin.unloaded = true;
		this.plugins.splice(this.plugins.indexOf(plugin), 1);
	}

	/** A menu by its id, or the error AMX Mod X gives for another number. @internal */
	menu(id: number): FakeMenu {
		const menu = this.menus.get(id);
		if (!menu) throw new Error(`Invalid menu id ${id}`);
		return menu;
	}

	/** menu_create: a menu of seven items a page, with Back, More and Exit. @internal */
	createMenu(title: string, handler: Slot): number {
		const id = this.menuIds++;
		this.menus.set(id, { id, title, handler, items: [], perPage: 7, exit: true, back: 'Back', next: 'More', exitName: 'Exit', numberColor: '\\r' });
		return id;
	}

	/** menu_destroy: whoever has it open sees it close, and its handler hears MENU_EXIT. @internal */
	destroyMenu(id: number): void {
		const menu = this.menu(id);
		this.menus.delete(id);
		for (const player of this.players.filter(one => one.menu?.menu === id)) {
			player.menu = null;
			this.menuAnswer(menu, player, constant('MENU_EXIT'));
		}
	}

	/**
	 * menu_display: a page drawn for a player. An item with a callback is
	 * asked as AMX Mod X asks it, as it is drawn - the callback may name it
	 * for him, and its answer greys it out. Another menu he had open is
	 * closed first: its handler hears MENU_EXIT. @internal
	 */
	displayMenu(player: FakePlayer, menu: FakeMenu, page: number): void {
		const before = player.menu;
		player.menu = null;
		const replaced = before && before.menu !== menu.id ? this.menus.get(before.menu) : undefined;
		if (replaced) this.menuAnswer(replaced, player, constant('MENU_EXIT'));

		const perPage = menu.perPage === 0 ? Math.min(menu.items.length, 10) : menu.perPage;
		const pages = Math.max(1, Math.ceil(menu.items.length / Math.max(perPage, 1)));
		const at = Math.min(Math.max(page, 0), pages - 1);
		const lines = [`${menu.title}${pages > 1 ? ` ${at + 1}/${pages}` : ''}`, ''];
		const keys: number[] = [];
		const disabled: number[] = [];
		const line = (key: number, text: string) => lines.push(`${menu.numberColor}${key}.\\w ${text}`);

		for (let i = 0; i < perPage && at * perPage + i < menu.items.length; i++) {
			const item = at * perPage + i;
			const callback = this.menuCallbacks[menu.items[item].callback];
			const args = [player.id, menu.id, item];
			const answer = callback ? this.withCallArgs(args, () => this.call(callback, args, constant('ITEM_IGNORE'))) : constant('ITEM_IGNORE');
			const key = (i + 1) % 10;
			keys.push(key);
			if (answer !== constant('ITEM_DISABLED')) {
				line(key, menu.items[item].name);
				continue;
			}
			disabled.push(key);
			lines.push(`\\d${key}. ${menu.items[item].name}`);
		}

		const paged = menu.perPage > 0;
		if (paged) lines.push('');
		if (paged && at > 0) {
			keys.push(8);
			line(8, menu.back);
		}
		if (paged && at < pages - 1) {
			keys.push(9);
			line(9, menu.next);
		}
		if (paged && menu.exit) {
			keys.push(0);
			line(0, menu.exitName);
		}

		player.menu = { menu: menu.id, page: at, text: lines.join('\n'), keys, disabled };
	}

	/** A key on a menu of AMX Mod X's own: an item to the handler, Back and More a page, Exit MENU_EXIT. Whether the menu took it. @internal */
	selectMenu(player: FakePlayer, key: number): boolean {
		const screen = player.menu;
		const menu = screen ? this.menus.get(screen.menu) : undefined;
		if (!screen || !menu || !screen.keys.includes(key)) return false;

		const paged = menu.perPage > 0;
		const turn = paged && key === 8 ? -1 : paged && key === 9 ? 1 : 0;
		if (turn !== 0 || screen.disabled.includes(key)) {
			this.displayMenu(player, menu, screen.page + turn);
			return true;
		}

		player.menu = null;
		const perPage = paged ? menu.perPage : 10;
		this.menuAnswer(menu, player, paged && key === 0 ? constant('MENU_EXIT') : screen.page * perPage + (key === 0 ? 10 : key) - 1);
		return true;
	}

	private menuAnswer(menu: FakeMenu, player: FakePlayer, item: number): void {
		const args = [player.id, menu.id, item];
		this.withCallArgs(args, () => this.call(menu.handler, args, 0));
	}

	/** A slot by the public name a native was given: "__amxts_cb3". @internal */
	slotByPublic(name: string): Slot {
		const match = name.match(/^__amxts_cb(\d+)$/);
		const slot = match ? this.slots[Number(match[1])] : undefined;
		if (!slot) throw new Error(`the fake server knows no public named "${name}"`);
		return slot;
	}

	/**
	 * One entity moving into another: the register_touch callbacks whose
	 * classes match ("*" or "" is any), called as the engine module calls
	 * them - (touched, toucher). The largest answer, as the module takes it.
	 */
	touch(toucher: FakeEntity, touched: FakeEntity): number {
		const matches = (name: string, entity: FakeEntity) => name === '' || name === '*' || name === entity.classname;
		let answer = 0;
		for (const { slot } of this.touches.filter(t => matches(t.touched, touched) && matches(t.toucher, toucher))) {
			answer = Math.max(answer, this.withCallArgs([touched.id, toucher.id], () => this.call(slot, [touched.id, toucher.id], 0)));
		}
		return answer;
	}

	/** A client answering query_client_cvar: every question about that cvar it had. */
	answerCvar(player: FakePlayer, cvar: string, value: string): void {
		for (const query of this.cvarQueries.filter(q => q.player === player.id && q.cvar === cvar)) {
			this.withCallArgs([player.id, cvar, value], () => this.call(query.slot, [player.id, 0, 0, 0], 0));
		}
	}

	/** An entity on the map, as create_entity makes one. */
	createEntity(classname: string): FakeEntity {
		const created = new FakeEntity(this, this.nextEntityId(), classname);
		this.entities.set(created.id, created);
		return created;
	}

	/** @internal */
	nextEntityId(): number {
		return this.entityIds++;
	}

	/** @internal */
	createCvar(name: string, value: string): Cvar {
		const cvar: Cvar = { name, value, pointer: this.cvars.size + 1, hooks: [] };
		this.cvars.set(name.toLowerCase(), cvar);
		return cvar;
	}

	/** @internal */
	cvarByPointer(pointer: number): Cvar | undefined {
		for (const cvar of this.cvars.values()) {
			if (cvar.pointer === pointer) return cvar;
		}
		return undefined;
	}

	/** A new value, and hook_cvar_change's callbacks told (pcvar, old, new). @internal */
	changeCvar(cvar: Cvar, value: string): void {
		const old = cvar.value;
		cvar.value = value;
		if (old === value) return;

		for (const slot of [...cvar.hooks]) {
			const args = [cvar.pointer, old, value];
			this.withCallArgs(args, () => this.call(slot, [cvar.pointer, 0, 0], slot.fallback));
		}
	}

	/** A native from natives.ts, called by `plugin`. @internal */
	callNativeImpl(plugin: PluginInstance, name: string, args: number[]): number {
		const call: NativeCall = { server: this, plugin, memory: plugin.memory };
		const result = (this.ownNatives.get(name) ?? NATIVES[name])(call, args);
		return typeof result === 'number' ? result | 0 : 0;
	}

	/** Modules a plugin runs for the others (module.cpp's g_services), and the bytes of the call in flight. @internal */
	private services: { name: string; hash: number; plugin: number }[] = [];
	private rpcRequest = new Uint8Array(0);
	private rpcReply = new Uint8Array(0);
	private rpcResult = new Uint8Array(0);

	/**
	 * The externals the facade declares, as module.cpp registers
	 * them in g_wasmNatives. Each is called with the plugin that called it.
	 * @internal
	 */
	readonly bridge = {
		// Shared modules: module.cpp's w_serve, w_owner, w_rpc and the three that move the bytes.
		amxts_serve(this: FakeServer, plugin: PluginInstance, name: number, hash: number) {
			const wanted = plugin.memory.string(name);
			const index = this.plugins.indexOf(plugin);
			const known = this.services.find(s => s.name === wanted);
			if (known) Object.assign(known, { hash, plugin: index });
			else this.services.push({ name: wanted, hash, plugin: index });
		},

		amxts_owner(this: FakeServer, plugin: PluginInstance, name: number, hash: number) {
			const wanted = plugin.memory.string(name);
			const index = this.services.findIndex(s => s.name === wanted);
			if (index < 0 || this.services[index].plugin < 0) return -1;
			return this.services[index].hash === hash ? index : -2;
		},

		amxts_rpc(this: FakeServer, plugin: PluginInstance, service: number, target: number, data: number, length: number) {
			const index = service >= 0 ? (this.services[service]?.plugin ?? -1) : target;
			const callee = this.plugins[index];
			const rpc = callee?.instance.exports.__amxts_rpc;
			if (!rpc) return -1;
			this.rpcRequest = new Uint8Array(plugin.instance.exports.memory.buffer, data, length).slice();
			this.rpcReply = new Uint8Array(0);
			this.within(callee, () => rpc(length, this.plugins.indexOf(plugin)));
			const answer = new Uint8Array(4 + this.rpcReply.length);
			new DataView(answer.buffer).setInt32(0, index, true);
			answer.set(this.rpcReply, 4);
			this.rpcResult = answer;
			return answer.length;
		},

		amxts_rpc_take(this: FakeServer, plugin: PluginInstance, to: number) {
			plugin.memory.setRaw(to, this.rpcRequest);
			this.rpcRequest = new Uint8Array(0);
		},

		amxts_rpc_reply(this: FakeServer, plugin: PluginInstance, data: number, length: number) {
			this.rpcReply = new Uint8Array(plugin.instance.exports.memory.buffer, data, length).slice();
		},

		amxts_rpc_result(this: FakeServer, plugin: PluginInstance, to: number) {
			plugin.memory.setRaw(to, this.rpcResult);
			this.rpcResult = new Uint8Array(0);
		},

		// The network client: module.cpp's w_net_*, over Bun's fetch (network.ts).
		net_open(this: FakeServer, plugin: PluginInstance, url: number) {
			return this.network.open(plugin, plugin.memory.string(url));
		},
		net_option(this: FakeServer, plugin: PluginInstance, id: number, name: number, value: number) {
			return this.network.option(plugin, id, plugin.memory.string(name), plugin.memory.string(value));
		},
		net_body(this: FakeServer, plugin: PluginInstance, id: number, data: number, length: number) {
			this.network.body(plugin, id, new Uint8Array(plugin.instance.exports.memory.buffer, data, length).slice());
		},
		net_send(this: FakeServer, plugin: PluginInstance, id: number, fn: number) {
			return this.network.send(plugin, id, fn);
		},
		net_cancel(this: FakeServer, plugin: PluginInstance, id: number) {
			this.network.cancel(plugin, id);
		},
		net_close(this: FakeServer, plugin: PluginInstance, id: number) {
			this.network.cancel(plugin, id);
		},
		net_status(this: FakeServer, plugin: PluginInstance, id: number) {
			return this.network.status(plugin, id);
		},
		net_redirects(this: FakeServer, plugin: PluginInstance, id: number) {
			return this.network.redirects(plugin, id);
		},
		net_text(this: FakeServer, plugin: PluginInstance, id: number, what: number, out: number, max: number) {
			return this.network.text(plugin, id, what, out, max);
		},
		net_size(this: FakeServer, plugin: PluginInstance, id: number) {
			return this.network.size(plugin, id);
		},
		net_read(this: FakeServer, plugin: PluginInstance, id: number, out: number, max: number) {
			return this.network.read(plugin, id, out, max);
		},

		abort(this: FakeServer, plugin: PluginInstance, message: number, file: number, line: number, column: number) {
			const text = message ? plugin.memory.string(message) : 'assertion failed';
			throw new Error(`abort: ${text} (${file ? plugin.memory.string(file) : '?'}:${line}:${column})`);
		},

		seed() {
			return Date.now();
		},

		// On the fake clock, so advance() moves them: the map starts at the
		// real moment the server was made.
		'Date.now': function (this: FakeServer) {
			return this.startedAt + this.time;
		},
		'Date.getTimezoneOffset': function (this: FakeServer, _plugin: PluginInstance, time: number) {
			return timezoneOffset(time, this.timeZone);
		},
		'performance.now': function (this: FakeServer) {
			return this.time;
		},

		'console.log': logLine,
		'console.info': logLine,
		'console.debug': logLine,
		'console.warn': function (this: FakeServer, plugin: PluginInstance, message: number) {
			this.logLines.push(`warning: ${plugin.memory.string(message)}`);
		},
		'console.error': function (this: FakeServer, plugin: PluginInstance, message: number) {
			this.logLines.push(`error: ${plugin.memory.string(message)}`);
		},
		'console.assert': function (this: FakeServer, plugin: PluginInstance, condition: number, message: number) {
			if (!condition) this.logLines.push(`assertion failed: ${plugin.memory.string(message)}`);
		},
		'console.time': function () {},
		'console.timeLog': function () {},
		'console.timeEnd': function () {},

		print_client(this: FakeServer, plugin: PluginInstance, id: number, channel: number, message: number) {
			const variant = channel === 4 ? 'center' : channel === 3 ? 'chat' : channel === 2 ? 'console' : 'notify';
			const text = plugin.memory.string(message);
			for (const player of id > 0 ? [this.player(id)] : this.players) player?.show(variant, text);
		},

		say_text(this: FakeServer, plugin: PluginInstance, id: number, text: number) {
			const line = plugin.memory.string(text);
			for (const player of id > 0 ? [this.player(id)] : this.players) player?.show('chat', line);
		},

		get_name(this: FakeServer, plugin: PluginInstance, id: number, out: number, max: number) {
			return plugin.memory.setBytes(out, max, this.player(id)?.name ?? '');
		},

		get_health(this: FakeServer, plugin: PluginInstance, id: number) {
			return Math.trunc(this.player(id)?.health ?? 0);
		},

		// The module's is set_user_health.
		set_health(this: FakeServer, plugin: PluginInstance, id: number, hp: number) {
			NATIVES.set_user_health({ server: this, plugin, memory: plugin.memory }, [id, hp]);
		},

		outcome(this: FakeServer, plugin: PluginInstance, value: number) {
			this.outcome = value;
			this.outcomeSaid = true;
		},

		on(this: FakeServer, plugin: PluginInstance, name: number, fn: number, shape: number) {
			const event = plugin.memory.string(name);
			let list = this.events.get(event);
			if (!list) this.events.set(event, list = []);
			list.push({ plugin, fn, shape });
		},

		subscribe(this: FakeServer, plugin: PluginInstance, name: number, fn: number, tag: number) {
			const forward = plugin.memory.string(name);
			let list = this.subscriptions.get(forward);
			if (!list) this.subscriptions.set(forward, list = []);
			list.push({ handler: { plugin, fn, shape: SHAPE_NARROW }, tag });
		},

		// No forward is relayed by a host plugin here, so every one a
		// TypeScript plugin emits reaches its subscribers this way: `s` a
		// string, `a` an array as its count and then its cells, the rest cells.
		emit_local(this: FakeServer, plugin: PluginInstance, name: number, mask: number, cells: number, argc: number) {
			const forward = plugin.memory.string(name);
			const types = plugin.memory.string(mask);
			const { memory } = plugin;
			const args: ArgValue[] = [];
			for (let i = 0; i < argc; i++) {
				const cell = memory.cell(cells + i * 4);
				if (types[i] === 's') args.push(memory.string(cell));
				else if (types[i] === 'a') args.push(Array.from({ length: memory.cell(cell) }, (_, k) => memory.cell(cell + 4 + k * 4)));
				else args.push(cell);
			}

			this.withCallArgs(args, () => this.deliver(forward));
		},

		// A slot a reload left takes the same file's plugin back, as SLOT_REUSED says in module.cpp.
		slot(this: FakeServer, plugin: PluginInstance, fn: number, shape: number, key: number, fallback: number) {
			const name = plugin.memory.string(key);
			const left = name ? this.slots.find(one => one.key === name && one.plugin.unloaded && one.plugin.source === plugin.source) : undefined;
			if (!left) return this.takeSlot(plugin, fn, shape, name, fallback).index;
			Object.assign(left, { plugin, fn, shape, fallback, tag: this.takeTag() });
			return left.index | SLOT_REUSED;
		},

		clcmd(this: FakeServer, plugin: PluginInstance, pattern: number, fn: number, flags: number, info: number, shape: number) {
			const name = plugin.memory.string(pattern);
			const slot = this.takeSlot(plugin, fn, shape, `clcmd:${name}`, PLUGIN_HANDLED);
			let list = this.clientCommands.get(name.toLowerCase());
			if (!list) this.clientCommands.set(name.toLowerCase(), list = []);
			list.push(slot);
			return slot.index;
		},

		task(this: FakeServer, plugin: PluginInstance, secondsBits: number, fn: number, id: number, repeat: number) {
			const slot = this.takeSlot(plugin, fn, 0, '', 0);
			const interval = Math.round(bitsFloat(secondsBits) * 1000);
			this.tasks.push({ slot, id, interval, due: this.time + interval, repeat: repeat !== 0, order: this.taskOrder++ });
			return slot.index;
		},

		// remove_task with `outside`: every task of that id, whoever armed it.
		stop_task(this: FakeServer, plugin: PluginInstance, id: number) {
			const before = this.tasks.length;
			for (let i = this.tasks.length - 1; i >= 0; i--) {
				if (this.tasks[i].id === id) this.tasks.splice(i, 1);
			}
			return before - this.tasks.length;
		},

		hook(this: FakeServer, plugin: PluginInstance, id: number, fn: number, post: number) {
			const kind = tables().hookNames.get(id);
			if (!kind) throw new Error(`no hookchain with the number ${id} in as/constants.ts`);

			const slot = this.takeSlot(plugin, fn, SHAPE_WIDE, `hook:${id}:${post}`, 0);
			let chain = this.hookchains.get(kind);
			if (!chain) this.hookchains.set(kind, chain = { pre: [], post: [] });
			(post ? chain.post : chain.pre).push(slot);
			return ++this.hookHandles;
		},

		// RegisterHam: kept by the function's id and the class, for hamCall().
		ham(this: FakeServer, plugin: PluginInstance, id: number, entityClass: number, fn: number, post: number) {
			const slot = this.takeSlot(plugin, fn, SHAPE_WIDE, `ham:${id}:${post}`, 0);
			const key = `${id}:${plugin.memory.string(entityClass)}:${post ? 'post' : 'pre'}`;
			const list = this.hams.get(key) ?? [];
			list.push(slot);
			this.hams.set(key, list);
			return ++this.hookHandles;
		},

		tag(this: FakeServer, _plugin: PluginInstance, tag: number) {
			this.pendingTag = tag;
		},

		// A plugin that never awaits still takes its timers' handles from here.
		co_id(this: FakeServer, _plugin: PluginInstance) {
			return nextTaskId();
		},

		export(this: FakeServer, plugin: PluginInstance, name: number, fn: number) {
			this.exported.set(plugin.memory.string(name), { plugin, fn, shape: SHAPE_WIDE, tag: this.takeTag() });
			return this.exported.size - 1;
		},

		plugin(this: FakeServer, plugin: PluginInstance, name: number, version: number, author: number, description: number) {
			const text = (p: number) => plugin.memory.string(p);
			plugin.info = { name: text(name), version: text(version), author: text(author), description: text(description) };
		},

		arg(this: FakeServer, plugin: PluginInstance, index: number) {
			const value = this.callArgs?.[index];
			return typeof value === 'number' ? value | 0 : typeof value === 'boolean' ? +value : 0;
		},

		arg_text(this: FakeServer, plugin: PluginInstance, index: number, out: number, max: number) {
			const value = this.callArgs?.[index];
			return plugin.memory.setBytes(out, max, typeof value === 'string' ? value : '');
		},

		// A string argument whole: its UTF-8 length, and as much of it as fits.
		arg_string(this: FakeServer, plugin: PluginInstance, index: number, out: number, max: number) {
			const value = this.callArgs?.[index];
			const text = value instanceof Pointer ? value.plugin.memory.text(value.at) : typeof value === 'string' ? value : '';
			return plugin.memory.setUtf8(out, max, text);
		},

		// How many cells a forward's array argument has; -1 for any other.
		arg_length(this: FakeServer, plugin: PluginInstance, index: number) {
			const value = this.callArgs?.[index];
			return Array.isArray(value) ? value.length : -1;
		},

		arg_array(this: FakeServer, plugin: PluginInstance, index: number, out: number, count: number) {
			const given = this.callArgs?.[index];
			const value = given instanceof Pointer
				? Array.from({ length: count }, (_, i) => given.plugin.memory.cell(given.at + i * 4))
				: given;
			if (!Array.isArray(value) || !out || count <= 0) return 0;
			for (let i = 0; i < count; i++) plugin.memory.setCell(out + i * 4, value[i] ?? 0);
			return count;
		},

		set_arg_array(this: FakeServer, plugin: PluginInstance, index: number, cells: number, count: number) {
			const value = this.callArgs?.[index];
			if (!Array.isArray(value) || count < 0) return 0;
			for (let i = 0; i < count; i++) value[i] = plugin.memory.cell(cells + i * 4);
			return count;
		},

		// set_param_byref: through the reference - a one-cell array here.
		set_arg(this: FakeServer, plugin: PluginInstance, index: number, value: number) {
			if (!this.callArgs || index < 0 || index >= this.callArgs.length) return 0;
			const target = this.callArgs[index];
			if (Array.isArray(target)) target[0] = value;
			else this.callArgs[index] = value;
			return 1;
		},

		// set_amxstring: at most `max` bytes, cut where a UTF-8 character starts.
		set_arg_text(this: FakeServer, plugin: PluginInstance, index: number, text: number, max: number) {
			if (!this.callArgs || index < 0 || index >= this.callArgs.length || max <= 0) return 0;
			const bytes = new TextEncoder().encode(plugin.memory.string(text));
			const length = utf8Fit(bytes, max);
			this.callArgs[index] = new TextDecoder().decode(bytes.subarray(0, length));
			return length;
		},

		// Entity fields and members, as the module reads them where the game
		// keeps them (runtime/src/fields.h): an entvar by its offset in
		// entvars_t, a member by the slot member_slot gave its gamedata name,
		// the game rules' by the id -1.
		ent_get(this: FakeServer, plugin: PluginInstance, id: number, offset: number) {
			const at = tables().entvarAt.get(offset);
			return at ? fieldCell(this.entities.get(id), at.field, at.component) : 0;
		},

		ent_set(this: FakeServer, plugin: PluginInstance, id: number, offset: number, cell: number) {
			const at = tables().entvarAt.get(offset);
			if (at) setFieldCell(this.entities.get(id), at.field, cell, at.component);
		},

		ent_entity(this: FakeServer, plugin: PluginInstance, id: number, offset: number) {
			const at = tables().entvarAt.get(offset);
			return at ? fieldCell(this.entities.get(id), at.field) : 0;
		},

		ent_set_entity(this: FakeServer, plugin: PluginInstance, id: number, offset: number, index: number) {
			const at = tables().entvarAt.get(offset);
			if (at) setFieldCell(this.entities.get(id), at.field, Math.max(index, 0));
		},

		member_slot(this: FakeServer, plugin: PluginInstance, className: number, name: number) {
			const key = `${plugin.memory.string(className)}::${plugin.memory.string(name)}`;
			const field = tables().memberNamed.get(key);
			if (field === undefined) throw new Error(`no reapi member is ${key} in the gamedata`);
			const slot = this.memberSlots.indexOf(field);
			return slot >= 0 ? slot : this.memberSlots.push(field) - 1;
		},

		member_get(this: FakeServer, plugin: PluginInstance, id: number, slot: number, element: number) {
			const field = this.memberSlots[slot];
			if (id === -1) return this.rules.get(field) ?? 0;
			return fieldCell(this.entities.get(id), field, element);
		},

		member_set(this: FakeServer, plugin: PluginInstance, id: number, slot: number, element: number, cell: number) {
			const field = this.memberSlots[slot];
			if (id === -1) this.rules.set(field, cell);
			else setFieldCell(this.entities.get(id), field, cell, element);
		},

		member_text(this: FakeServer, plugin: PluginInstance, id: number, slot: number, out: number, max: number) {
			const value = this.entities.get(id)?.fields.get(FakeEntity.key(this.memberSlots[slot]));
			return plugin.memory.setUtf8(out, max, typeof value === 'string' ? value : '');
		},

		member_set_text(this: FakeServer, plugin: PluginInstance, id: number, slot: number, text: number) {
			this.entities.get(id)?.fields.set(FakeEntity.key(this.memberSlots[slot]), plugin.memory.string(text));
		},

		// The fake keeps its game rules where the module would find them.
		game_rules() {
			return 1;
		},

		// The fields plugins add to Player: the imports their generated accessors call.
		player_data_get(this: FakeServer, plugin: PluginInstance, id: number, key: number) {
			return this.playerNumber(id, plugin.memory.string(key));
		},

		player_data_set(this: FakeServer, plugin: PluginInstance, id: number, key: number, value: number) {
			this.setPlayerData(id, plugin.memory.string(key), value);
		},

		// The text's UTF-8 length, and as much of it as fits.
		player_data_get_text(this: FakeServer, plugin: PluginInstance, id: number, key: number, out: number, max: number) {
			return plugin.memory.setUtf8(out, max, this.playerText(id, plugin.memory.string(key)));
		},

		player_data_set_text(this: FakeServer, plugin: PluginInstance, id: number, key: number, value: number) {
			this.setPlayerData(id, plugin.memory.string(key), plugin.memory.string(value));
		},

		// A Player[] field: the ids as text, "3,5".
		player_data_set_players(this: FakeServer, plugin: PluginInstance, id: number, key: number, value: number) {
			this.setPlayerData(id, plugin.memory.string(key), plugin.memory.string(value), true);
		},

		// playerchange: the module wakes a plugin for the fields it listens for.
		player_change_listen(this: FakeServer, plugin: PluginInstance, field: number, fn: number) {
			const name = plugin.memory.string(field);
			const known = this.fieldListeners.find(one => one.plugin === plugin);
			if (!known) this.fieldListeners.push({ plugin, fn, fields: [name] });
			else if (!known.fields.includes(name)) known.fields.push(name);
		},

		// The change being told: 1 its number before, 2 after.
		player_change_get(this: FakeServer, _plugin: PluginInstance, which: number) {
			const value = which === 1 ? this.fieldChange?.previous : this.fieldChange?.value;
			return typeof value === 'number' ? value : 0;
		},

		// 0 its key, 1 its text before, 2 after.
		player_change_get_text(this: FakeServer, plugin: PluginInstance, which: number, out: number, max: number) {
			const change = this.fieldChange;
			const value = which === 0 ? change?.key : which === 1 ? change?.previous : change?.value;
			return plugin.memory.setUtf8(out, max, typeof value === 'string' ? value : '');
		},

		argc(this: FakeServer) {
			return this.callArgs?.length ?? 0;
		},

		// Only a plugin's exported native has a caller, and here a test is it.
		caller() {
			return -1;
		},

		// The dispatcher: a native with a `...` tail, its arguments laid out as
		// cells. Every mask letter but `n` is an address in the plugin's memory,
		// which is what a Pawn frame holds too - so the native gets the cells as
		// they are, and reads through the addresses itself.
		call(this: FakeServer, plugin: PluginInstance, id: number, argsPtr: number, maskPtr: number, argc: number) {
			const name = tables().dispatched.get(id);
			if (!name) throw new Error(`the dispatcher has no native with id ${id}`);

			const args: number[] = [];
			for (let i = 0; i < argc; i++) args.push(plugin.memory.cell(argsPtr + i * 4));

			if (!this.hasNative(name)) throw unsimulated(name);
			return this.callNativeImpl(plugin, name, args);
		},
	};

	/** What `tag()` said for the next registration (w_tag in module.cpp). */
	private pendingTag = 0;

	private takeTag(): number {
		const tag = this.pendingTag;
		this.pendingTag = 0;
		return tag;
	}

	private takeSlot(plugin: PluginInstance, fn: number, shape: number, key: string, fallback: number): Slot {
		const slot: Slot = { plugin, fn, shape, fallback, key, index: this.slots.length, tag: this.takeTag() };
		this.slots.push(slot);
		return slot;
	}
}
