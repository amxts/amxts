// The natives the fake server answers, as AMX Mod X and its modules would.
//
// Each takes the Pawn frame as the plugin pushed it: a number is a cell, a
// float its bit pattern, and a string or a buffer the address of cells in the
// plugin's memory. A `...` tail comes through the dispatcher with every
// argument by address, as Pawn pushes one - so a native reads its tail through
// `memory.cell(ptr)` exactly as AMX Mod X reads it through the AMX.
//
// This is the part that grows. A native a plugin calls and nothing here
// answers stops the test with its name; add it below, keeping to what the real
// one does closely enough for a test to be believed.
import type { Memory } from './memory';
import type { FakePlayer, FakeServer, PluginInstance, SentForward, TeamName, Value } from './server';
import { bitsFloat, floatBits } from './memory';
import { FakeEntity, flagBits, normalizePath, TEAMS } from './server';
import { constant, tables } from './tables';

export interface NativeCall {
	server: FakeServer;
	plugin: PluginInstance;
	memory: Memory;
}

export type Native = (call: NativeCall, args: number[]) => number | void;

/** Every weapon by its WeaponIdType - the facade's WEAPON_IDS. */
export const WEAPON_NAMES = [
	'',
	'weapon_p228',
	'',
	'weapon_scout',
	'weapon_hegrenade',
	'weapon_xm1014',
	'weapon_c4',
	'weapon_mac10',
	'weapon_aug',
	'weapon_smokegrenade',
	'weapon_elite',
	'weapon_fiveseven',
	'weapon_ump45',
	'weapon_sg550',
	'weapon_galil',
	'weapon_famas',
	'weapon_usp',
	'weapon_glock18',
	'weapon_awp',
	'weapon_mp5navy',
	'weapon_m249',
	'weapon_m3',
	'weapon_m4a1',
	'weapon_tmp',
	'weapon_g3sg1',
	'weapon_flashbang',
	'weapon_deagle',
	'weapon_sg552',
	'weapon_ak47',
	'weapon_knife',
	'weapon_p90',
];

/**
 * Pawn's format: the conversions AMX Mod X plugins use, each reading its
 * argument through the address the tail holds.
 */
export function formatPawn(call: NativeCall, format: string, tail: number[]): string {
	let next = 0;

	return format.replace(/%(\.(\d+))?([dicsfxXn%])/g, (all, _, precision, kind) => {
		if (kind === '%') return '%';
		const at = tail[next++];
		if (at === undefined) return '';

		const { memory } = call;
		switch (kind) {
			case 'd': case 'i': return String(memory.cell(at));
			case 'c': return String.fromCharCode(memory.cell(at));
			case 's': return memory.text(at);
			case 'f': return memory.float(at).toFixed(precision ? Number(precision) : 6);
			case 'x': return (memory.cell(at) >>> 0).toString(16);
			case 'X': return (memory.cell(at) >>> 0).toString(16).toUpperCase();
			case 'n': return call.server.player(memory.cell(at))?.name ?? '';
		}
		return all;
	});
}

function player(call: NativeCall, id: number): FakePlayer | undefined {
	return call.server.player(id);
}

function entity(call: NativeCall, id: number): FakeEntity | undefined {
	return call.server.entities.get(id);
}

/** A float field's value as the cell a native returns: its bits; anything else as it is. */
function cellOf(field: number, value: number | number[] | string): number {
	if (typeof value !== 'number') return 0;
	return tables().floatFields.has(field) ? floatBits(value) : value | 0;
}

/**
 * A field's cell as the module reads it in memory (runtime/src/fields.h): a
 * whole number, a float's bits, an entity's index; `element` is a vector's
 * component or an array member's element.
 */
export function fieldCell(target: FakeEntity | undefined, field: number, element = 0): number {
	const { arrayFields } = tables();
	const value = target?.fields.get(FakeEntity.key(field, arrayFields.has(field) ? element : undefined));
	if (Array.isArray(value)) return floatBits(value[element] ?? 0);
	return value === undefined || (element > 0 && !arrayFields.has(field)) ? 0 : cellOf(field, value);
}

/** Writes a field's cell as the module does: a float's bits, one component of a vector, one element of an array. */
export function setFieldCell(target: FakeEntity | undefined, field: number, cell: number, element = 0): void {
	if (!target) return;
	const { arrayFields, floatFields, vectorFields } = tables();
	const key = FakeEntity.key(field, arrayFields.has(field) ? element : undefined);
	if (vectorFields.has(field)) {
		const before = target.fields.get(key);
		const vector = Array.isArray(before) ? [...before] : [0, 0, 0];
		vector[element] = bitsFloat(cell);
		target.fields.set(key, vector);
		return;
	}
	target.fields.set(key, floatFields.has(field) ? bitsFloat(cell) : cell);
}

/** get_entvar and get_member: a vector into the tail's buffer, text into its buffer, a cell returned. */
function readField(call: NativeCall, target: FakeEntity | undefined, field: number, tail: number[], element?: number): number {
	if (!target) return 0;
	const { vectorFields, stringFields } = tables();
	const value = target.fields.get(FakeEntity.key(field, element)) ?? (vectorFields.has(field) ? [0, 0, 0] : stringFields.has(field) ? '' : 0);

	if (Array.isArray(value)) {
		if (tail[0]) call.memory.setVector(tail[0], value);
		return 1;
	}
	if (typeof value === 'string') {
		if (tail[0]) return call.memory.setText(tail[0], tail[1] ? call.memory.cell(tail[1]) : 255, value);
		return 0;
	}
	return cellOf(field, value);
}

/** set_entvar and set_member: the value is at the tail's first address, typed by the field. */
function writeField(call: NativeCall, target: FakeEntity | undefined, field: number, at: number, element?: number): number {
	if (!target || !at) return 0;
	const { floatFields, vectorFields, stringFields } = tables();

	const value = vectorFields.has(field)
		? call.memory.vector(at)
		: stringFields.has(field)
			? call.memory.text(at)
			: floatFields.has(field)
				? call.memory.float(at)
				: call.memory.cell(at);

	target.fields.set(FakeEntity.key(field, element), value);
	return 1;
}

const entvars = new Map<string, number>();

/** An entity_get_* key (EV_SZ_classname) as the entvar it names (var_classname). */
function entvarOf(prefix: string, key: number): number {
	const known = entvars.get(`${prefix}${key}`);
	if (known !== undefined) return known;
	const name = [...tables().constants].find(([n, v]) => v === key && n.startsWith(prefix))?.[0];
	const field = name ? tables().constants.get(`var_${name.slice(prefix.length)}`) : undefined;
	if (field === undefined) throw new Error(`no entvar behind ${prefix}${key}`);
	entvars.set(`${prefix}${key}`, field);
	return field;
}

function kill(target: FakePlayer, keepFrags: boolean): void {
	target.alive = false;
	target.health = 0;
	target.deaths += 1;
	if (!keepFrags) target.frags -= 1;
}

/** get_players' own filtering, flag letter by flag letter. */
function playersMatching(call: NativeCall, flags: string, team: string): FakePlayer[] {
	return call.server.players.filter(p =>
		!(flags.includes('a') && !p.alive)
		&& !(flags.includes('b') && p.alive)
		&& !(flags.includes('c') && p.bot)
		&& !(flags.includes('d') && !p.bot)
		&& !(flags.includes('e') && p.team !== team)
		&& !(flags.includes('f') && !p.name.includes(team)),
	);
}

function cvarNamed(call: NativeCall, at: number) {
	return call.server.cvars.get(call.memory.text(at).toLowerCase());
}

/** How the engine writes a number into a cvar: whole ones without decimals. */
function cvarNumber(value: number): string {
	return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function giveWeapon(target: FakePlayer | undefined, name: string): number {
	if (!target) return 0;
	if (name === 'item_kevlar' || name === 'item_assaultsuit') {
		target.armor = 100;
		return 0;
	}
	if (!WEAPON_NAMES.includes(name) || !name) return 0;
	return target.give(name).id;
}

function weaponByName(target: FakePlayer | undefined, name: string) {
	return target?.items.find(w => w.kind === name);
}

function switchTo(target: FakePlayer | undefined, name: string): number {
	const weapon = weaponByName(target, name);
	if (!target || !weapon) return 0;
	target.set('m_pActiveItem', weapon.id);
	return 1;
}

function chain(call: NativeCall) {
	const running = call.server.chain;
	if (!running) throw new Error('a hookchain native was called outside a hookchain');
	return running;
}

/** A hookchain value read through the tail's address, by its ATYPE_*. */
function chainValue(call: NativeCall, type: number, at: number): Value {
	if (type === constant('ATYPE_FLOAT')) return call.memory.float(at);
	if (type === constant('ATYPE_BOOL')) return call.memory.cell(at) !== 0;
	if (type === constant('ATYPE_STRING')) return call.memory.text(at);
	return call.memory.cell(at);
}

/** The message register_message's callbacks are on: server.sendMessage's. */
function hooked(call: NativeCall) {
	const message = call.server.hookedMessage;
	if (!message) throw new Error('a message native was called outside a register_message callback');
	return message;
}

function setMessageArg(call: NativeCall, arg: number, value: number | string): number {
	hooked(call).args[arg - 1] = value;
	return 1;
}

/** ExecuteHam(B): the call kept, and with hooks the class's listeners run - the function's answer. */
function executeHam(call: NativeCall, fn: number, id: number, tail: number[], hooks: boolean): number {
	const shape = [...tables().hooks.values()].find(one => one.ham === fn);
	const args = tail.map((at, i) => shape?.floats.has(i + 1) ? call.memory.float(at) : call.memory.cell(at));
	call.server.hamCalls.push({ fn, entity: id, args, hooks });
	if (!hooks || !shape) return 0;
	return Number(call.server.runHam(shape, id, args).result) | 0;
}

/** SetHamParam*: `which` counts from 1, the entity itself. */
function setHamParam(call: NativeCall, which: number, value: Value): number {
	chain(call).args[which - 1] = value;
	return 1;
}

function setHamReturn(call: NativeCall, value: Value): number {
	chain(call).answer = value;
	chain(call).answered = true;
	return 1;
}

// The engine's own message for a temporary effect: it is no user message, so
// no name get_user_msgid handed out stands for it.
const SVC_TEMPENTITY = 23;

/**
 * message_begin: a user message by its name, or a temporary effect - with
 * who it goes to (`dest`, MSG_*) and the point it is seen from.
 */
function beginMessage(call: NativeCall, dest: number, type: number, player: number, origin: number[]): number {
	if (type === SVC_TEMPENTITY) {
		call.server.writing = { name: 'SVC_TEMPENTITY', player, args: [], dest, origin };
		return 1;
	}
	const name = [...call.server.messageIds].find(([, id]) => id === type)?.[0];
	call.server.writing = name ? { name, player, args: [] } : null;
	return 1;
}

function sendText(call: NativeCall, id: number, variant: 'chat' | 'center' | 'console' | 'notify' | 'hud', text: string): void {
	for (const target of id > 0 ? [player(call, id)] : call.server.players) target?.show(variant, text);
}

const PRINT_VARIANTS = ['', 'notify', 'console', 'chat', 'center'] as const;

/** A Pawn string of UTF-8 bytes - a path, a line of a file - as text. */
function bytesText(call: NativeCall, pointer: number): string {
	return call.memory.text(pointer, 65536);
}

function bytesAt(call: NativeCall, pointer: number): Uint8Array {
	return call.memory.bytes(pointer, 65536);
}

let nextHandle = 1;
let hudSyncObjects = 0;

/** fopen: `r` needs the file, `w` empties it, `a` writes at its end; the folder must be there. */
function openFile(call: NativeCall, path: string, mode: string): number {
	const { server } = call;
	const file = normalizePath(path);
	const folder = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';

	if (mode.startsWith('r') && !server.files.has(file)) return 0;
	if (!mode.startsWith('r') && !server.folderExists(folder)) return 0;
	if (mode.startsWith('w') || !server.files.has(file)) server.files.set(file, new Uint8Array(0));

	const handle = nextHandle++;
	server.handles.set(handle, { path: file, position: mode.startsWith('a') ? server.files.get(file)!.length : 0 });
	return handle;
}

function openedFile(call: NativeCall, handle: number) {
	const open = call.server.handles.get(handle);
	return open && 'path' in open ? open : undefined;
}

/** What open_dir lists: `.`, `..`, then every file and folder right inside. */
function folderEntries(call: NativeCall, path: string): string[] {
	const folder = normalizePath(path);
	const prefix = folder === '' ? '' : `${folder}/`;
	const names = new Set<string>();
	for (const known of [...call.server.files.keys(), ...call.server.folders]) {
		if (known.startsWith(prefix) && known.length > prefix.length) names.add(known.slice(prefix.length).split('/')[0]);
	}
	return ['.', '..', ...[...names].sort()];
}

export const NATIVES: Record<string, Native> = {
	// ------------------------------------------------------------ files

	fopen: (c, [name, mode]) => openFile(c, bytesText(c, name), c.memory.text(mode)),
	fclose: (c, [handle]) => +c.server.handles.delete(handle),
	// BLOCK_CHAR: a byte a cell.
	fread_blocks: (c, [handle, data, blocks]) => {
		const open = openedFile(c, handle);
		const bytes = open && c.server.files.get(open.path);
		if (!open || !bytes) return 0;
		const count = Math.max(0, Math.min(blocks, bytes.length - open.position));
		for (let i = 0; i < count; i++) c.memory.setCell(data + i * 4, bytes[open.position + i]);
		open.position += count;
		return count;
	},
	fputs: (c, [handle, text]) => {
		const open = openedFile(c, handle);
		if (!open) return 0;
		const before = c.server.files.get(open.path) ?? new Uint8Array(0);
		const added = bytesAt(c, text);
		const after = new Uint8Array(Math.max(before.length, open.position + added.length));
		after.set(before);
		after.set(added, open.position);
		c.server.files.set(open.path, after);
		open.position += added.length;
		return added.length;
	},
	file_exists: (c, [name]) => +c.server.files.has(normalizePath(bytesText(c, name))),
	dir_exists: (c, [name]) => +c.server.folderExists(bytesText(c, name)),
	open_dir: (c, [dir, first, length]) => {
		if (!c.server.folderExists(bytesText(c, dir))) return 0;
		const entries = folderEntries(c, bytesText(c, dir));
		c.memory.setText(first, length, entries[0]);
		const handle = nextHandle++;
		c.server.handles.set(handle, { entries, next: 1 });
		return handle;
	},
	next_file: (c, [handle, buffer, length]) => {
		const open = c.server.handles.get(handle);
		if (!open || !('entries' in open) || open.next >= open.entries.length) return 0;
		c.memory.setText(buffer, length, open.entries[open.next++]);
		return 1;
	},
	close_dir: (c, [handle]) => +c.server.handles.delete(handle),
	// 0 when made; the parent has to be there, as for the real one.
	mkdir: (c, [name]) => {
		const folder = normalizePath(bytesText(c, name));
		const parent = folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '';
		if (c.server.folderExists(folder) || !c.server.folderExists(parent)) return -1;
		c.server.folders.add(folder);
		return 0;
	},
	get_localinfo: (c, [info, buffer, length]) =>
		c.memory.setText(buffer, length, c.server.localinfo.get(c.memory.text(info)) ?? ''),

	// ------------------------------------------------------------ dynamic arrays (cellarray.inc)
	// An item is its cells; text is a byte a cell, as ArrayPushString stores it.

	ArrayCreate: (c, [cellSize]) => c.server.createCellArray(Math.max(1, cellSize)),
	ArrayPushString: (c, [handle, text]) => {
		const array = c.server.cellArrays.get(handle);
		if (!array) return -1;
		const bytes = [...bytesAt(c, text)].slice(0, array.cellSize - 1);
		array.items.push([...bytes, 0]);
		return array.items.length - 1;
	},
	ArrayPushCell: (c, [handle, value]) => {
		const array = c.server.cellArrays.get(handle);
		if (!array) return -1;
		array.items.push([value]);
		return array.items.length - 1;
	},
	ArrayPushArray: (c, [handle, cells, size]) => {
		const array = c.server.cellArrays.get(handle);
		if (!array) return -1;
		const count = size < 0 ? array.cellSize : Math.min(size, array.cellSize);
		const item: number[] = [];
		for (let i = 0; i < count; i++) item.push(c.memory.cell(cells + i * 4));
		array.items.push(item);
		return array.items.length - 1;
	},
	ArraySize: (c, [handle]) => c.server.cellArrays.get(handle)?.items.length ?? 0,
	ArrayGetCell: (c, [handle, index]) => c.server.cellArrays.get(handle)?.items[index]?.[0] ?? 0,
	ArrayGetString: (c, [handle, index, buffer, length]) => {
		const item = c.server.cellArrays.get(handle)?.items[index] ?? [0];
		const bytes = item.slice(0, Math.max(0, !item.includes(0) ? item.length : item.indexOf(0)));
		const count = Math.min(bytes.length, length);
		for (let i = 0; i < count; i++) c.memory.setCell(buffer + i * 4, bytes[i]);
		c.memory.setCell(buffer + count * 4, 0);
		return count;
	},
	ArrayGetArray: (c, [handle, index, buffer, size]) => {
		const item = c.server.cellArrays.get(handle)?.items[index] ?? [];
		const count = size < 0 ? item.length : Math.min(size, item.length);
		for (let i = 0; i < count; i++) c.memory.setCell(buffer + i * 4, item[i]);
		return count;
	},
	// ArrayDestroy takes the handle by reference and zeroes it.
	ArrayDestroy: (c, [at]) => {
		const handle = c.memory.cell(at);
		c.memory.setCell(at, 0);
		return +c.server.cellArrays.delete(handle);
	},

	// ------------------------------------------------------------ the server

	get_maxplayers: c => c.server.maxPlayers,
	get_playersnum: c => c.server.players.length,
	get_mapname: (c, [buffer, length]) => c.memory.setText(buffer, length, c.server.map),
	get_gametime: c => floatBits(c.server.time / 1000),
	LibraryExists: (c, [name]) => +c.server.modules.has(c.memory.text(name)),

	menu_create: (c, [title, handler]) => c.server.createMenu(c.memory.text(title), c.server.slotByPublic(c.memory.text(handler))),
	menu_additem: (c, [menu, name, _info, _access, callback]) => {
		c.server.menu(menu).items.push({ name: c.memory.text(name), callback });
		return 1;
	},
	menu_makecallback: (c, [fn]) => c.server.menuCallbacks.push(c.server.slotByPublic(c.memory.text(fn))) - 1,
	menu_item_setname: (c, [menu, item, name]) => {
		const entry = c.server.menu(menu).items[item];
		if (!entry) return 0;
		entry.name = c.memory.text(name);
		return 1;
	},
	menu_items: (c, [menu]) => c.server.menu(menu).items.length,
	menu_display: (c, [id, menu, page]) => {
		const target = player(c, id);
		if (!target) throw new Error(`menu_display: player ${id} is not in game`);
		c.server.displayMenu(target, c.server.menu(menu), page);
	},
	menu_destroy: (c, [menu]) => {
		c.server.destroyMenu(menu);
		return 1;
	},
	// The tail comes by address: a number's cell, or a string's.
	menu_setprop: (c, [menu, prop, value]) => {
		const made = c.server.menu(menu);
		const props: Record<string, () => void> = {
			MPROP_PERPAGE: () => made.perPage = c.memory.cell(value),
			MPROP_EXIT: () => made.exit = c.memory.cell(value) !== constant('MEXIT_NEVER'),
			MPROP_BACKNAME: () => made.back = c.memory.text(value),
			MPROP_NEXTNAME: () => made.next = c.memory.text(value),
			MPROP_EXITNAME: () => made.exitName = c.memory.text(value),
			MPROP_TITLE: () => made.title = c.memory.text(value),
			MPROP_NUMBER_COLOR: () => made.numberColor = c.memory.text(value),
		};
		const set = Object.entries(props).find(([name]) => constant(name) === prop)?.[1];
		if (!set) throw new Error(`menu_setprop: the fake server knows no menu property ${prop}`);
		set();
		return 1;
	},
	server_cmd: (c, [format, ...tail]) => {
		c.server.commands.push(formatPawn(c, c.memory.text(format), tail));
	},
	server_print: (c, [format, ...tail]) => {
		c.server.logLines.push(formatPawn(c, c.memory.text(format), tail));
	},
	client_cmd: (c, [id, format, ...tail]) => {
		const line = formatPawn(c, c.memory.text(format), tail);
		for (const target of id > 0 ? [player(c, id)] : c.server.players) target?.commands.push(line);
	},
	client_print: (c, [id, type, format, ...tail]) => {
		sendText(c, id, PRINT_VARIANTS[type] || 'chat', formatPawn(c, c.memory.text(format), tail));
	},
	console_print: (c, [id, format, ...tail]) => {
		const line = formatPawn(c, c.memory.text(format), tail);
		if (id > 0) sendText(c, id, 'console', line);
		else c.server.logLines.push(line);
	},

	set_hudmessage: (c, [r, g, b, x, y, _effects, _fxtime, hold, _fadein, _fadeout, channel]) => {
		c.server.hud = { color: [r, g, b], x: bitsFloat(x), y: bitsFloat(y), hold: bitsFloat(hold), channel };
	},
	show_hudmessage: (c, [id, format, ...tail]) => sendText(c, id, 'hud', formatPawn(c, c.memory.text(format), tail)),

	// ------------------------------------------------------------ the command being run

	read_argc: c => c.server.argv.length,
	read_argv: (c, [index, buffer, length]) => c.memory.setText(buffer, length, c.server.argv[index] ?? ''),
	get_user_userid: (c, [id]) => player(c, id)?.userid ?? -1,
	read_args: (c, [buffer, length]) => c.memory.setText(buffer, length, c.server.argv.slice(1).join(' ')),

	// ------------------------------------------------------------ players

	is_user_connected: (c, [id]) => +!!player(c, id),
	is_user_alive: (c, [id]) => +!!player(c, id)?.alive,
	is_user_bot: (c, [id]) => +!!player(c, id)?.bot,
	is_user_hltv: () => 0,
	get_user_name: (c, [id, buffer, length]) => c.memory.setText(buffer, length, id === 0 ? 'Console' : player(c, id)?.name ?? ''),
	get_user_authid: (c, [id, buffer, length]) => c.memory.setText(buffer, length, player(c, id)?.authid ?? ''),
	get_user_ip: (c, [id, buffer, length, withoutPort]) => {
		const ip = player(c, id)?.ip ?? '';
		return c.memory.setText(buffer, length, withoutPort ? ip.replace(/:\d+$/, '') : ip);
	},
	get_user_flags: (c, [id]) => player(c, id)?.flags ?? 0,
	read_flags: (c, [text]) => flagBits(c.memory.text(text)),
	get_user_health: (c, [id]) => Math.trunc(player(c, id)?.health ?? 0),
	// fun's: nothing left is the game's ClientKill, which a dead player is past -
	// user_kill without its frags. set_entvar's var_health kills nobody.
	set_user_health: (c, [id, health]) => {
		if (health <= 0) return NATIVES.user_kill(c, [id, 0]);
		const target = player(c, id);
		if (target) target.health = health;
	},
	get_user_armor: (c, [id]) => Math.trunc(player(c, id)?.armor ?? 0),
	set_user_armor: (c, [id, armor]) => {
		const t = player(c, id);
		if (t) t.armor = armor;
	},
	get_user_frags: (c, [id]) => Math.trunc(player(c, id)?.frags ?? 0),
	set_user_frags: (c, [id, frags]) => {
		const t = player(c, id);
		if (t) t.frags = frags;
	},
	get_user_deaths: (c, [id]) => player(c, id)?.deaths ?? 0,
	cs_set_user_deaths: (c, [id, deaths]) => {
		const t = player(c, id);
		if (t) t.deaths = deaths;
	},
	get_user_team: (c, [id, buffer, length]) => {
		const target = player(c, id);
		if (!target) return 0;
		if (buffer) c.memory.setText(buffer, length, target.team === 'UNASSIGNED' ? '' : target.team);
		return TEAMS.indexOf(target.team);
	},
	cs_get_user_team: (c, [id]) => TEAMS.indexOf(player(c, id)?.team ?? 'UNASSIGNED'),
	cs_set_user_team: (c, [id, team]) => {
		const t = player(c, id);
		if (t) t.team = TEAMS[team] as TeamName;
	},
	rg_set_user_team: (c, [id, team]) => {
		const target = player(c, id);
		if (!target) return 0;
		target.team = TEAMS[team] as TeamName;
		return 1;
	},
	get_players: (c, [list, count, flags, team]) => {
		const found = playersMatching(c, c.memory.text(flags), c.memory.text(team));
		found.forEach((p, i) => c.memory.setCell(list + i * 4, p.id));
		c.memory.setCell(count, found.length);
	},
	user_kill: (c, [id, keepFrags]) => {
		const target = player(c, id);
		if (target?.alive) kill(target, keepFrags !== 0);
	},
	rg_round_respawn: (c, [id]) => {
		const target = player(c, id);
		if (!target) return;
		target.alive = true;
		target.health = 100;
	},
	get_speak: (c, [id]) => player(c, id)?.speak ?? 0,
	set_speak: (c, [id, flags]) => {
		const t = player(c, id);
		if (t) t.speak = flags;
	},

	// ------------------------------------------------------------ weapons

	give_item: (c, [id, name]) => giveWeapon(player(c, id), c.memory.text(name)),
	strip_user_weapons: (c, [id]) => {
		player(c, id)?.stripWeapons();
	},
	// reapi's reach only a weapon the player carries; cstrike's any.
	rg_set_user_bpammo: (c, [id, weapon, amount]) => {
		const target = player(c, id);
		if (weaponByName(target, WEAPON_NAMES[weapon])) target?.ammo.set(WEAPON_NAMES[weapon], amount);
	},
	rg_get_user_bpammo: (c, [id, weapon]) => {
		const target = player(c, id);
		return weaponByName(target, WEAPON_NAMES[weapon]) ? target?.ammo.get(WEAPON_NAMES[weapon]) ?? 0 : 0;
	},
	cs_set_user_bpammo: (c, [id, weapon, amount]) => {
		player(c, id)?.ammo.set(WEAPON_NAMES[weapon], amount);
	},
	cs_get_user_bpammo: (c, [id, weapon]) => player(c, id)?.ammo.get(WEAPON_NAMES[weapon]) ?? 0,
	rg_find_weapon_bpack_by_name: (c, [id, name]) => weaponByName(player(c, id), c.memory.text(name))?.id ?? 0,
	rg_switch_weapon: (c, [id, weapon]) => switchTo(player(c, id), entity(c, weapon)?.classname ?? ''),
	user_has_weapon: (c, [id, weapon]) => +!!weaponByName(player(c, id), WEAPON_NAMES[weapon] ?? ''),
	engclient_cmd: (c, [id, command, arg1, arg2]) => {
		const target = player(c, id);
		const line = [command, arg1, arg2].map(p => c.memory.text(p)).filter(Boolean).join(' ');
		target?.commands.push(line);
		if (line.startsWith('weapon_')) switchTo(target, line);
		// The team menu's slots, as the game handles `jointeam`.
		const side = { 'jointeam 1': 'TERRORIST', 'jointeam 2': 'CT', 'jointeam 6': 'SPECTATOR' }[line];
		if (target && side) target.team = side as TeamName;
	},
	rg_reset_maxspeed: () => {},

	// ------------------------------------------------------------ entities

	get_entvar: (c, [id, field, ...tail]) => readField(c, entity(c, id), field, tail),
	set_entvar: (c, [id, field, at]) => writeField(c, entity(c, id), field, at),
	get_member: (c, [id, field, ...tail]) => {
		const element = tables().arrayFields.has(field) ? (tail[0] ? c.memory.cell(tail[0]) : 0) : undefined;
		return readField(c, entity(c, id), field, element === undefined ? tail : tail.slice(1), element);
	},
	set_member: (c, [id, field, at, elementAt]) => {
		const element = tables().arrayFields.has(field) ? (elementAt ? c.memory.cell(elementAt) : 0) : undefined;
		return writeField(c, entity(c, id), field, at, element);
	},
	entity_get_string: (c, [id, key, buffer, length]) =>
		c.memory.setText(buffer, length, String(entity(c, id)?.fields.get(FakeEntity.key(entvarOf('EV_SZ_', key))) ?? '')),
	entity_set_string: (c, [id, key, text]) => {
		entity(c, id)?.fields.set(FakeEntity.key(entvarOf('EV_SZ_', key)), c.memory.text(text));
	},
	entity_get_int: (c, [id, key]) => Number(entity(c, id)?.fields.get(FakeEntity.key(entvarOf('EV_INT_', key))) ?? 0) | 0,
	entity_set_int: (c, [id, key, value]) => {
		entity(c, id)?.fields.set(FakeEntity.key(entvarOf('EV_INT_', key)), value);
	},
	entity_get_float: (c, [id, key]) => floatBits(Number(entity(c, id)?.fields.get(FakeEntity.key(entvarOf('EV_FL_', key))) ?? 0)),
	entity_set_float: (c, [id, key, value]) => {
		entity(c, id)?.fields.set(FakeEntity.key(entvarOf('EV_FL_', key)), bitsFloat(value));
	},
	entity_get_edict: (c, [id, key]) => Number(entity(c, id)?.fields.get(FakeEntity.key(entvarOf('EV_ENT_', key))) ?? 0) | 0,
	entity_set_edict: (c, [id, key, value]) => {
		entity(c, id)?.fields.set(FakeEntity.key(entvarOf('EV_ENT_', key)), value);
	},
	entity_get_vector: (c, [id, key, at]) => {
		const value = entity(c, id)?.fields.get(FakeEntity.key(entvarOf('EV_VEC_', key)));
		c.memory.setVector(at, Array.isArray(value) ? value : [0, 0, 0]);
	},
	entity_set_vector: (c, [id, key, at]) => {
		entity(c, id)?.fields.set(FakeEntity.key(entvarOf('EV_VEC_', key)), c.memory.vector(at));
	},
	entity_set_origin: (c, [id, at]) => {
		const target = entity(c, id);
		if (target) target.origin = c.memory.vector(at);
	},
	create_entity: (c, [classname]) => c.server.createEntity(c.memory.text(classname)).id,
	remove_entity: (c, [id]) => +c.server.entities.delete(id),
	is_valid_ent: (c, [id]) => +c.server.entities.has(id),
	find_ent_by_class: (c, [start, classname]) => {
		const name = c.memory.text(classname);
		const found = [...c.server.entities.values()].find(e => e.id > start && e.classname === name);
		return found?.id ?? 0;
	},
	find_ent_in_sphere: (c, [start, at, radius]) => {
		const center = c.memory.vector(at);
		const reach = bitsFloat(radius);
		const found = [...c.server.entities.values()].find(e => e.id > start && Math.hypot(...e.origin.map((v, k) => v - center[k])) <= reach);
		return found?.id ?? 0;
	},
	get_global_int: (c, [key]) => key === constant('GL_maxEntities') ? Math.max(0, ...c.server.entities.keys()) + 1 : 0,

	// ------------------------------------------------------------ hookchains (reapi)

	GetHookChainReturn: (c, [type, buffer, lengthAt]) => {
		const answer = chain(c).answer;
		if (type === constant('ATYPE_STRING')) return c.memory.setText(buffer, lengthAt ? c.memory.cell(lengthAt) : 255, String(answer));
		if (type === constant('ATYPE_FLOAT')) return floatBits(Number(answer));
		return typeof answer === 'boolean' ? +answer : Number(answer) | 0;
	},
	SetHookChainReturn: (c, [type, at]) => {
		chain(c).answer = chainValue(c, type, at);
		chain(c).answered = true;
		return 1;
	},
	SetHookChainArg: (c, [number, type, at]) => {
		chain(c).args[number - 1] = chainValue(c, type, at);
		return 1;
	},

	// ------------------------------------------------------------ forwards

	CreateMultiForward: (c, [name, _stop, ...types]) => {
		c.server.forwardHandles.push({ name: c.memory.text(name), types: types.map(at => c.memory.cell(at)) });
		return c.server.forwardHandles.length - 1;
	},
	ExecuteForward: (c, [handle, returnAt, ...tail]) => {
		const forward = c.server.forwardHandles[handle];
		if (!forward) return 0;
		// An array arrives as the dispatcher's `a` argument: its count, then its cells.
		const read: Record<number, (at: number) => SentForward['args'][number]> = {
			[constant('FP_STRING')]: at => c.memory.text(at),
			[constant('FP_FLOAT')]: at => c.memory.float(at),
			[constant('FP_ARRAY')]: at => Array.from({ length: c.memory.cell(at) }, (_, k) => c.memory.cell(at + 4 + k * 4)),
		};
		const args = tail.map((at, i) => (read[forward.types[i]] ?? (a => c.memory.cell(a)))(at));
		c.server.forwards.push({ name: forward.name, args });
		if (returnAt) c.memory.setCell(returnAt, 0);
		return 1;
	},
	DestroyForward: () => 1,

	// ------------------------------------------------------------ nVault

	nvault_open: (c, [name]) => {
		const vault = c.memory.text(name);
		c.server.vault(vault);
		c.server.vaultHandles.push(vault);
		return c.server.vaultHandles.length - 1;
	},
	nvault_close: () => {},
	nvault_set: (c, [handle, key, value]) => {
		c.server.vault(c.server.vaultHandles[handle]).set(c.memory.text(key), c.memory.text(value));
	},
	nvault_lookup: (c, [handle, key, value, length, stampAt]) => {
		const found = c.server.vault(c.server.vaultHandles[handle]).get(c.memory.text(key));
		if (found === undefined) return 0;
		c.memory.setText(value, length, found);
		if (stampAt) c.memory.setCell(stampAt, 0);
		return 1;
	},
	nvault_remove: (c, [handle, key]) => {
		c.server.vault(c.server.vaultHandles[handle]).delete(c.memory.text(key));
	},

	// ------------------------------------------------------------ cvars

	create_cvar: (c, [name, value]) => {
		const existing = cvarNamed(c, name);
		return (existing ?? c.server.createCvar(c.memory.text(name), c.memory.text(value))).pointer;
	},
	get_cvar_pointer: (c, [name]) => cvarNamed(c, name)?.pointer ?? 0,
	cvar_exists: (c, [name]) => +!!cvarNamed(c, name),
	get_pcvar_string: (c, [pointer, buffer, length]) => c.memory.setText(buffer, length, c.server.cvarByPointer(pointer)?.value ?? ''),
	get_pcvar_num: (c, [pointer]) => Math.trunc(Number.parseFloat(c.server.cvarByPointer(pointer)?.value ?? '') || 0),
	get_pcvar_float: (c, [pointer]) => floatBits(Number.parseFloat(c.server.cvarByPointer(pointer)?.value ?? '') || 0),
	set_pcvar_string: (c, [pointer, value]) => {
		const cvar = c.server.cvarByPointer(pointer);
		if (cvar) c.server.changeCvar(cvar, c.memory.text(value));
	},
	set_pcvar_num: (c, [pointer, value]) => {
		const cvar = c.server.cvarByPointer(pointer);
		if (cvar) c.server.changeCvar(cvar, String(value));
	},
	set_pcvar_float: (c, [pointer, value]) => {
		const cvar = c.server.cvarByPointer(pointer);
		if (cvar) c.server.changeCvar(cvar, cvarNumber(bitsFloat(value)));
	},
	get_cvar_string: (c, [name, buffer, length]) => c.memory.setText(buffer, length, cvarNamed(c, name)?.value ?? ''),
	get_cvar_num: (c, [name]) => Math.trunc(Number.parseFloat(cvarNamed(c, name)?.value ?? '') || 0),
	get_cvar_float: (c, [name]) => floatBits(Number.parseFloat(cvarNamed(c, name)?.value ?? '') || 0),
	set_cvar_string: (c, [name, value]) => {
		const v = cvarNamed(c, name);
		if (v) c.server.changeCvar(v, c.memory.text(value));
	},
	set_cvar_num: (c, [name, value]) => {
		const v = cvarNamed(c, name);
		if (v) c.server.changeCvar(v, String(value));
	},
	set_cvar_float: (c, [name, value]) => {
		const v = cvarNamed(c, name);
		if (v) c.server.changeCvar(v, cvarNumber(bitsFloat(value)));
	},
	hook_cvar_change: (c, [pointer, callback]) => {
		const cvar = c.server.cvarByPointer(pointer);
		if (!cvar) return 0;
		cvar.hooks.push(c.server.slotByPublic(c.memory.text(callback)));
		return cvar.hooks.length;
	},

	// ------------------------------------------------------------ the game (reapi, engine, resemiclip)

	register_dictionary: (c, [file]) => (c.server.loadDictionary(c.memory.text(file)) ? 1 : 0),
	GetLangTransKey: (c, [key]) => c.server.langKey(c.memory.text(key)),
	LookupLangKey: (c, [out, size, key, id]) => {
		const text = c.server.lookupLang(c.memory.text(key), c.memory.cell(id));
		if (text === undefined) return 0;
		c.memory.setText(out, size, text);
		return 1;
	},
	precache_model: (c, [name]) => c.server.precached.push(c.memory.text(name)),
	get_member_game: (c, [member]) => c.server.rules.get(member) ?? 0,
	set_member_game: (c, [member, at]) => {
		c.server.rules.set(member, at ? c.memory.cell(at) : 0);
	},
	// CSGameRules::UpdateTeamScores: both scores set, and a TeamScore to everyone for each side.
	rg_update_teamscores: (c, [cts, ts, add]) => {
		const rules = c.server.rules;
		const scores: [string, string, number][] = [['CT', 'm_iNumCTWins', cts], ['TERRORIST', 'm_iNumTerroristWins', ts]];
		for (const [team, member, wins] of scores) {
			const score = (add ? rules.get(constant(member)) ?? 0 : 0) + wins;
			rules.set(constant(member), score);
			c.server.userMessages.push({ name: 'TeamScore', player: 0, args: [team, score] });
		}
		return 1;
	},
	rg_round_end: (c, [delay, status, event, message, sound, trigger]) => {
		c.server.roundEnds.push({
			status,
			event,
			delay: bitsFloat(delay),
			message: c.memory.text(message),
			sound: c.memory.text(sound),
			trigger: trigger !== 0,
		});
		return 1;
	},
	rg_send_audio: (c, [id, sample]) => {
		c.server.sounds.push({ entity: id, sample: c.memory.text(sample) });
	},
	rh_emit_sound2: (c, [entity, _recipient, _channel, sample]) => {
		c.server.sounds.push({ entity, sample: c.memory.text(sample) });
		return 1;
	},
	emit_sound: (c, [entity, _channel, sample]) => {
		c.server.sounds.push({ entity, sample: c.memory.text(sample) });
		return 1;
	},
	rg_send_bartime: (c, [id, seconds]) => {
		c.server.bartimes.set(id, seconds);
	},
	rg_join_team: (c, [id, team]) => {
		const target = player(c, id);
		if (target) target.team = TEAMS[team] as TeamName;
		return 1;
	},
	// CBasePlayer::Observer_SetMode, as far as a test sees it: nothing for the
	// mode he is in, "inEye" for a number past the modes, the first living
	// player as the target - "roaming" when there is none - and the last mode.
	rg_set_observer_mode: (c, [id, mode]) => {
		const target = player(c, id);
		if (!target || target.get('var_iuser1') === mode) return 1;
		const asked = mode >= 1 && mode <= 6 ? mode : 4;
		const watched = asked === 3 ? undefined : c.server.players.find(p => p !== target && p.alive);
		target.set('var_iuser1', watched || asked === 3 ? asked : 3);
		target.set('var_iuser2', watched?.id ?? 0);
		target.set('m_iObserverLastMode', asked);
		return 1;
	},
	resemiclip_take_control: (c, [take]) => {
		c.server.semiclipControlled = take !== 0;
		return 0;
	},
	resemiclip_set_user_mask: (c, [id, mask]) => {
		c.server.semiclipMasks.set(id, mask | 0);
	},
	resemiclip_get_user_mask: (c, [id]) => c.server.semiclipMasks.get(id) ?? 0,
	register_touch: (c, [touched, toucher, callback]) => {
		c.server.touches.push({ touched: c.memory.text(touched), toucher: c.memory.text(toucher), slot: c.server.slotByPublic(c.memory.text(callback)) });
		return c.server.touches.length;
	},
	// register_message: the callbacks server.sendMessage runs, by the message's id.
	register_message: (c, [id, callback]) => {
		const hooks = c.server.messageHooks.get(id) ?? [];
		hooks.push(c.server.slotByPublic(c.memory.text(callback)));
		c.server.messageHooks.set(id, hooks);
		return hooks.length;
	},
	get_msg_args: c => hooked(c).args.length,
	get_msg_argtype: (c, [arg]) => hooked(c).types[arg - 1] ?? 0,
	get_msg_arg_int: (c, [arg]) => Math.trunc(Number(hooked(c).args[arg - 1] ?? 0)),
	get_msg_arg_float: (c, [arg]) => floatBits(Number(hooked(c).args[arg - 1] ?? 0)),
	get_msg_arg_string: (c, [arg, buffer, length]) => c.memory.setText(buffer, length, String(hooked(c).args[arg - 1] ?? '')),
	set_msg_arg_int: (c, [arg, _type, value]) => setMessageArg(c, arg, value),
	set_msg_arg_float: (c, [arg, _type, value]) => setMessageArg(c, arg, bitsFloat(value)),
	set_msg_arg_string: (c, [arg, text]) => setMessageArg(c, arg, c.memory.text(text)),
	register_srvcmd: (c, [name, callback]) => {
		const slot = c.server.slotByPublic(c.memory.text(callback));
		const command = c.memory.text(name).toLowerCase();
		c.server.serverCommands.set(command, [...(c.server.serverCommands.get(command) ?? []), slot]);
		return slot.index;
	},
	query_client_cvar: (c, [id, cvar, callback]) => {
		c.server.cvarQueries.push({ player: id, cvar: c.memory.text(cvar), slot: c.server.slotByPublic(c.memory.text(callback)) });
	},
	is_entity: (c, [id]) => +c.server.entities.has(id),
	get_user_info: (c, [id, key, buffer, length]) => c.memory.setText(buffer, length, player(c, id)?.info.get(c.memory.text(key)) ?? ''),
	get_time: (c, [_format, buffer, length]) => c.memory.setText(buffer, length, '12:00 - 01.01.2026'),
	get_weaponname: (c, [id, buffer, length]) => c.memory.setText(buffer, length, WEAPON_NAMES[id] ?? ''),
	// SET_MODEL: the text, and the index of the precached model it names.
	entity_set_model: (c, [id, model]) => {
		const target = entity(c, id);
		const path = c.memory.text(model);
		target?.set('var_model', path);
		target?.set('var_modelindex', c.server.precached.indexOf(path) + 1);
	},
	entity_set_size: (c, [id, mins, maxs]) => {
		const target = entity(c, id);
		const low = c.memory.vector(mins);
		const high = c.memory.vector(maxs);
		target?.set('var_mins', low);
		target?.set('var_maxs', high);
		target?.set('var_size', high.map((v, k) => v - low[k]));
	},
	// User messages: every name has an id, as on a server, and what is written
	// between message_begin and message_end lands in server.userMessages.
	get_user_msgid: (c, [name]) => {
		const ids = c.server.messageIds;
		const text = c.memory.text(name);
		if (!ids.has(text)) ids.set(text, 100 + ids.size);
		return ids.get(text)!;
	},
	message_begin: (c, [dest, type, origin, player]) => beginMessage(c, dest, type, player, [0, 1, 2].map(i => c.memory.cell(origin + i * 4))),
	message_begin_f: (c, [dest, type, origin, player]) => beginMessage(c, dest, type, player, c.memory.vector(origin)),
	write_byte: (c, [value]) => {
		c.server.writing?.args.push(value);
		return 1;
	},
	write_string: (c, [text]) => {
		c.server.writing?.args.push(c.memory.text(text));
		return 1;
	},
	message_end: (c) => {
		const message = c.server.writing;
		c.server.writing = null;
		if (!message) return 1;
		c.server.userMessages.push(message);
		// SendAudio's byte is the player it plays to, its string the sound.
		if (message.name === 'SendAudio') c.server.sounds.push({ entity: Number(message.args[0]), sample: String(message.args[1]) });
		for (const listener of c.server.messageListeners) listener(message);
		return 1;
	},
	write_coord_f: (c, [value]) => {
		c.server.writing?.args.push(bitsFloat(value));
		return 1;
	},
	// An entity's function run by a plugin (weapon.deploy()): kept in
	// server.hamCalls; ExecuteHamB also runs the listeners of the entity's class.
	ExecuteHam: (c, [fn, id, ...tail]) => executeHam(c, fn, id, tail, false),
	ExecuteHamB: (c, [fn, id, ...tail]) => executeHam(c, fn, id, tail, true),
	// A Ham Sandwich hook's argument and answer, on the running chain as reapi's are.
	SetHamParamInteger: (c, [which, value]) => setHamParam(c, which, value),
	SetHamParamEntity: (c, [which, value]) => setHamParam(c, which, value),
	SetHamParamFloat: (c, [which, value]) => setHamParam(c, which, bitsFloat(value)),
	SetHamParamString: (c, [which, text]) => setHamParam(c, which, c.memory.text(text)),
	SetHamParamVector: (c, [which]) => setHamParam(c, which, 0),
	SetHamReturnInteger: (c, [value]) => setHamReturn(c, value),
	SetHamReturnEntity: (c, [value]) => setHamReturn(c, value),
	SetHamReturnFloat: (c, [value]) => setHamReturn(c, bitsFloat(value)),
	SetHamReturnString: (c, [text]) => setHamReturn(c, c.memory.text(text)),
	SetHamReturnVector: c => setHamReturn(c, 0),
	GetHamReturnInteger: (c, [out]) => c.memory.setCell(out, Number(chain(c).answer) | 0),
	GetHamReturnEntity: (c, [out]) => c.memory.setCell(out, Number(chain(c).answer) | 0),
	GetHamReturnFloat: (c, [out]) => c.memory.setFloat(out, Number(chain(c).answer)),
	GetHamReturnString: (c, [out, size]) => c.memory.setText(out, size, String(chain(c).answer)),
	GetHamReturnVector: (c, [out]) => c.memory.setVector(out, [0, 0, 0]),
	set_dhudmessage: (c, [r, g, b, x, y, _effects, _fxtime, hold]) => {
		c.server.hud = { color: [r, g, b], x: bitsFloat(x), y: bitsFloat(y), hold: bitsFloat(hold), channel: -1 };
	},
	// A server without reapi hears ReGameDLL's events through these (as/hlds.ts).
	// register_logevent(function[], argsnum, ...filters): server.gameLog() calls it.
	register_logevent: (c, [callback, argc, ...filters]) => {
		c.server.logEvents.push({ argc, filters: filters.map(at => c.memory.text(at)), slot: c.server.slotByPublic(c.memory.text(callback)) });
		return c.server.logEvents.length;
	},
	read_logargc: c => c.server.logArgs.length,
	read_logargv: (c, [index, buffer, length]) => c.memory.setText(buffer, length, c.server.logArgs[index] ?? ''),
	// A line logged through the engine, where the logevents hear it.
	elog_message: (c, [format, ...tail]) => {
		c.server.gameLog(formatPawn(c, c.memory.text(format), tail));
		return 1;
	},
	// register_event(event[], function[], flags[], cond[], ...): server.sendMessage() calls it once the message is sent.
	register_event: (c, [name, callback, _flags, ...conditions]) => {
		c.server.messageEvents.push({ name: c.memory.text(name), conditions: conditions.map(at => c.memory.text(at)), slot: c.server.slotByPublic(c.memory.text(callback)) });
		return c.server.messageEvents.length;
	},
	register_forward: (c, [fn, callback, post]) => {
		const key = `${fn}:${post ? 'post' : 'pre'}`;
		c.server.fakemetaForwards.set(key, [...(c.server.fakemetaForwards.get(key) ?? []), c.server.slotByPublic(c.memory.text(callback))]);
		return c.server.fakemetaForwards.size;
	},
	forward_return: (c, [type, value]) => {
		c.server.forwardAnswer = type === constant('FMV_STRING') ? c.memory.text(value) : c.memory.cell(value);
		return 1;
	},
	get_orig_retval: c => c.server.origRetval,
	register_clcmd: (c, [name, callback]) => {
		const command = c.memory.text(name).toLowerCase();
		c.server.clientCommands.set(command, [...(c.server.clientCommands.get(command) ?? []), c.server.slotByPublic(c.memory.text(callback))]);
		return 1;
	},
	// The engine's functions the hood calls: an event's index, and who hears whom.
	engfunc: (c, [type, ...tail]) => {
		if (type === constant('EngFunc_PrecacheEvent')) return c.server.precached.indexOf(c.memory.text(tail[1])) + 1 || c.server.precached.push(c.memory.text(tail[1]));
		if (type === constant('EngFunc_SetClientListening')) c.server.listening.push(tail.slice(0, 3).map(at => c.memory.cell(at)));
		return 0;
	},
	dllfunc: (c, [type, ...tail]) => {
		if (type === constant('DLLFunc_GetGameDescription')) c.memory.setText(tail[0], c.memory.cell(tail[1]), 'Counter-Strike');
		return 0;
	},
	get_ent_data: (c, [id, _class, member, element]) => fieldCell(entity(c, id) ?? player(c, id), constant(c.memory.text(member)), element),
	cs_get_user_money: (c, [id]) => fieldCell(player(c, id), constant('m_iAccount')),
	find_ent_by_model: (c, [start, classname, model]) => {
		const [wanted, path] = [c.memory.text(classname), c.memory.text(model)];
		const found = [...c.server.entities.values()].find(one => one.id > start && one.classname === wanted && one.get('var_model') === path);
		return found?.id ?? 0;
	},
	get_timeleft: () => 0,
	CreateHudSyncObj: () => ++hudSyncObjects,
	ShowSyncHudMsg: (c, [id, _sync, format, ...tail]) => sendText(c, id, 'hud', formatPawn(c, c.memory.text(format), tail)),
	ClearSyncHud: () => 1,
};

// Natives that do here what another one does, under their own names.
const SAME_AS: Record<string, string> = {
	module_exists: 'LibraryExists',
	log_amx: 'server_print',
	show_dhudmessage: 'show_hudmessage',
	cs_get_user_deaths: 'get_user_deaths',
	rg_give_item: 'give_item',
	rg_remove_all_items: 'strip_user_weapons',
	register_cvar: 'create_cvar',
	precache_sound: 'precache_model',
	precache_generic: 'precache_model',
	write_angle_f: 'write_coord_f',
	write_char: 'write_byte',
	write_short: 'write_byte',
	write_long: 'write_byte',
	// What other plugins' message listeners hear on a server; the fake hears no plugin's message either way.
	emessage_begin: 'message_begin',
	ewrite_byte: 'write_byte',
	ewrite_short: 'write_byte',
	ewrite_string: 'write_string',
	emessage_end: 'message_end',
};
for (const [name, same] of Object.entries(SAME_AS)) NATIVES[name] = NATIVES[same];
