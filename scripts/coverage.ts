// scripts/coverage.ts
/**
 * Which natives of AMX Mod X and its standard modules the API covers, and how.
 *
 * Every native of the modules below is one of three: covered by an element of
 * the API - read off the `Pawn:` line of the element's tooltip in
 * scripts/docs/as/, or named in API below where one native is many fields or
 * events - covered by plain TypeScript (PLAIN: `format` is a template string,
 * `ArrayGetString` an array's index), or not covered, which a plugin calls
 * from `@amxts/core/natives`. A native the API covers for one use only
 * (`get_user_info(id, "lang")`) is not covered: its other uses are the
 * native's.
 *
 *   bun scripts/coverage.ts            checks the "From Pawn" pages
 *   bun scripts/coverage.ts --write    writes them
 *   bun scripts/coverage.ts --table <dir> [--plugins <dir>...]
 *       writes <dir>/API-COVERAGE.md and <dir>/ru/API-COVERAGE.md, the whole
 *       map; with --plugins the natives are ranked by how many of the .sma
 *       files under those folders call them, a file counted once however
 *       many copies of it there are.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { IncludeParser } from '../src/parser/include-parser';
import { HOOD } from './auto-imports';
import { readInclude } from './includes';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** The modules, each with the includes that declare its natives. */
export const MODULES: Record<string, string[]> = {
	amxmodx: ['amxmodx', 'core', 'string', 'float', 'file', 'cvars', 'lang', 'messages', 'newmenus', 'cellarray', 'cellstack', 'celltrie', 'datapack', 'sorting', 'vector', 'textparse_ini', 'textparse_smc', 'vault', 'gameconfig'],
	fun: ['fun'],
	cstrike: ['cstrike'],
	csx: ['csx', 'csstats'],
	engine: ['engine'],
	fakemeta: ['fakemeta'],
	hamsandwich: ['hamsandwich'],
	nvault: ['nvault'],
	geoip: ['geoip'],
	sqlx: ['sqlx'],
	regex: ['regex'],
	json: ['json'],
	sockets: ['sockets'],
	reapi: ['reapi', 'reapi_engine', 'reapi_gamedll', 'reapi_reunion', 'reapi_vtc', 'reapi_rechecker'],
};

/** Text in both languages; code is the same in both and is a plain string. */
type Words = string | { en: string; ru: string };

const FIELD = 'entity.<field>, player.<field>';
const RETURN = { en: 'the listener\'s `return` value', ru: '`return значение` из слушателя' };
const ARGS = { en: 'the command\'s arguments: `server.addCommand<Args>(usage, ...)`', ru: 'аргументы команды: `server.addCommand<Args>(usage, ...)`' };
const PARAMS = { en: 'the parameters of an `export function`', ru: 'параметры `export function`' };
const RESULT = { en: 'the result of an `export function`', ru: 'результат `export function`' };
const fs = (code: string): Words => ({ en: `\`${code}\` of \`@amxts/core/fs\``, ru: `\`${code}\` из \`@amxts/core/fs\`` });

/**
 * Natives the API covers without a tooltip naming them: one native that is
 * many fields or events, and the ones an element covers beside the native its
 * tooltip names.
 */
export const API: Record<string, Words> = {
	// Fields: the entity's, the player's, the weapon's and the game's.
	...Object.fromEntries([
		'pev set_pev set_pev_string get_entvar set_entvar get_member set_member get_member_s set_member_s',
		'entity_get_int entity_set_int entity_get_float entity_set_float entity_get_vector entity_set_vector entity_get_edict',
		'entity_get_edict2 entity_set_edict entity_get_string entity_set_string entity_get_byte entity_set_byte',
		'get_pdata_int set_pdata_int get_pdata_float set_pdata_float get_pdata_ent set_pdata_ent get_pdata_bool set_pdata_bool',
		'get_pdata_byte set_pdata_byte get_pdata_short set_pdata_short get_pdata_vector set_pdata_vector get_pdata_ehandle',
		'set_pdata_ehandle get_pdata_string set_pdata_string get_pdata_cbase set_pdata_cbase get_pdata_cbase_safe',
		'get_ent_data set_ent_data get_ent_data_float set_ent_data_float get_ent_data_vector set_ent_data_vector',
		'get_ent_data_entity set_ent_data_entity get_ent_data_string set_ent_data_string',
	].flatMap(line => line.split(' ')).map(name => [name, FIELD])),
	...Object.fromEntries([
		'get_gamerules_int set_gamerules_int get_gamerules_float set_gamerules_float get_gamerules_vector set_gamerules_vector',
		'get_gamerules_entity set_gamerules_entity get_gamerules_string set_gamerules_string set_member_game',
	].flatMap(line => line.split(' ')).map(name => [name, 'game.<field>'])),

	// Events: the game's, the server's, the messages.
	EnableHookChain: 'game.addEventListener',
	DisableHookChain: 'game.removeEventListener',
	SetHookChainReturn: RETURN,
	GetHookChainReturn: 'event.result',
	SetHookChainArg: 'event.<field> = ...',
	RegisterHamFromEntity: 'game.addEventListener(name, listener, { classname })',
	EnableHamForward: 'game.addEventListener',
	DisableHamForward: 'game.removeEventListener',
	GetHamReturnStatus: 'event.result',
	GetHamReturnInteger: 'event.result',
	GetHamReturnFloat: 'event.result',
	GetHamReturnVector: 'event.result',
	GetHamReturnEntity: 'event.result',
	GetHamReturnString: 'event.result',
	GetOrigHamReturnInteger: 'event.result',
	GetOrigHamReturnFloat: 'event.result',
	GetOrigHamReturnVector: 'event.result',
	GetOrigHamReturnEntity: 'event.result',
	GetOrigHamReturnString: 'event.result',
	SetHamReturnInteger: RETURN,
	SetHamReturnFloat: RETURN,
	SetHamReturnVector: RETURN,
	SetHamReturnEntity: RETURN,
	SetHamReturnString: RETURN,
	SetHamParamInteger: 'event.<field> = ...',
	SetHamParamFloat: 'event.<field> = ...',
	SetHamParamVector: 'event.<field> = ...',
	SetHamParamEntity: 'event.<field> = ...',
	SetHamParamEntity2: 'event.<field> = ...',
	SetHamParamString: 'event.<field> = ...',
	register_think: 'game.addEventListener("think", listener, { classname })',
	register_touch: 'game.addEventListener("touch", listener, { toucher, touched })',
	unregister_think: 'game.removeEventListener',
	unregister_touch: 'game.removeEventListener',
	register_impulse: 'server.addEventListener("impulse", listener)',
	unregister_impulse: 'server.removeEventListener',
	register_event: 'server.addMessageListener(name, listener)',
	register_event_ex: 'server.addMessageListener(name, listener)',
	enable_event: 'server.addMessageListener',
	disable_event: 'server.removeMessageListener',
	unregister_message: 'server.removeMessageListener',
	read_data: 'event.<field>, event.args',
	read_datanum: 'event.args.length',
	read_datatype: 'event.args.isText(i)',
	get_msg_argtype: 'event.args.isText(i)',
	set_msg_block: 'event.preventDefault()',
	RegisterMessage: 'server.addMessageListener(name, listener)',
	UnregisterMessage: 'server.removeMessageListener',
	EnableHookMessage: 'server.addMessageListener',
	DisableHookMessage: 'server.removeMessageListener',
	SetMessageData: 'event.<field> = ...',
	GetMessageData: 'event.<field>',
	GetMessageArgType: 'event.args.isText(i)',
	GetMessageArgsNum: 'event.args.length',
	SetMessageBlock: 'event.preventDefault()',

	// Players.
	get_user_deaths: 'player.deaths',
	get_user_team: 'player.team',
	cs_set_user_team: 'player.team = ...',
	get_user_index: 'server.players.find(player => player.name == name)',
	find_player: 'server.players.find(...)',
	find_player_ex: 'server.players.find(...)',
	get_playersnum: 'server.players.length',
	get_user_weapon: 'player.activeItem',
	get_user_weapons: 'player.items',
	user_has_weapon: 'player.items.some(item => item.kind == "ak47")',
	rg_has_item_by_name: 'player.items.some(item => item.classname == name)',
	cs_get_user_weapon_entity: 'player.activeItem',
	cs_get_user_weapon: 'player.activeItem?.kind',
	cs_get_user_money: 'player.money',
	cs_set_user_money: 'player.money = ...',
	rg_add_account: 'player.money += ...',
	cs_get_user_defuse: 'player.hasDefuser',
	cs_set_user_defuse: 'player.hasDefuser = ...',
	rg_give_defusekit: 'player.hasDefuser = true',
	cs_get_user_nvg: 'player.hasNightVision',
	cs_set_user_nvg: 'player.hasNightVision = ...',
	cs_get_user_hasprim: 'player.hasPrimary',
	cs_get_user_vip: 'player.isVip',
	cs_set_user_vip: 'player.isVip = ...',
	cs_get_user_tked: 'player.justKilledTeammate',
	cs_set_user_tked: 'player.justKilledTeammate = ...',
	cs_get_user_shield: 'player.ownsShield',
	cs_get_user_armor: 'player.armor, player.kevlar',
	cs_set_user_armor: 'player.armor, player.kevlar',
	rg_get_user_armor: 'player.armor, player.kevlar',
	rg_set_user_armor: 'player.armor, player.kevlar',
	cs_get_user_lastactivity: 'player.lastMovement',
	cs_set_user_lastactivity: 'player.lastMovement = ...',
	cs_get_user_hostagekills: 'player.hostagesKilled',
	cs_set_user_hostagekills: 'player.hostagesKilled = ...',
	cs_user_spawn: 'player.respawn()',
	get_user_godmode: 'player.takeDamage',
	set_user_godmode: 'player.takeDamage = "no"',
	set_user_origin: 'player.origin = ...',
	get_user_rendering: 'player.renderMode, renderFx, renderColor, renderAmount',
	set_user_rendering: 'player.renderMode, renderFx, renderColor, renderAmount',
	set_ent_rendering: 'entity.renderMode, renderFx, renderColor, renderAmount',
	get_user_maxspeed: 'player.maxSpeed',
	set_user_maxspeed: 'player.maxSpeed = ...',
	get_user_gravity: 'player.gravity',
	set_user_gravity: 'player.gravity = ...',
	get_user_noclip: 'player.moveType == "noclip"',
	set_user_noclip: 'player.moveType = "noclip"',
	rh_drop_client: 'player.kick(reason)',
	rg_remove_item: 'player.removeItem(weapon)',
	set_speak: 'player.muted, heardByEveryone, hearsEveryone',
	get_speak: 'player.muted, heardByEveryone, hearsEveryone',
	console_print: 'print(player, text, "console")',
	log_amx: 'console.log, console.error',
	server_print: 'console.log',

	// Weapons.
	get_weaponname: 'weapon.classname',
	cs_get_weapon_ammo: 'weapon.clip',
	cs_set_weapon_ammo: 'weapon.clip = ...',
	rg_get_user_ammo: 'weapon.clip',
	rg_set_user_ammo: 'weapon.clip = ...',
	cs_get_weapon_id: 'weapon.kind',
	cs_get_weapon_silen: 'weapon.weaponState.includes("uspSilenced")',
	cs_set_weapon_silen: 'weapon.weaponState',
	cs_get_weapon_burst: 'weapon.weaponState.includes("glockBurstMode")',
	cs_set_weapon_burst: 'weapon.weaponState',
	rg_weapon_deploy: 'weapon.deploy()',
	rg_weapon_reload: 'weapon.reload()',
	rg_weapon_send_animation: 'weapon.sendWeaponAnim(...)',
	rg_find_weapon_bpack_by_name: 'player.items.find(item => item.classname == name)',

	// Entities.
	is_entity: 'entity.exists',
	is_valid_ent: 'entity.exists',
	pev_valid: 'entity.exists',
	create_entity: 'Entity.create(classname)',
	rg_create_entity: 'Entity.create(classname)',
	cs_create_entity: 'Entity.create(classname)',
	remove_entity: 'entity.remove()',
	rg_remove_entity: 'entity.remove()',
	find_ent_by_class: 'Entity.find({ classname })',
	rg_find_ent_by_class: 'Entity.find({ classname })',
	cs_find_ent_by_class: 'Entity.find({ classname })',
	find_ent_by_owner: 'Entity.find({ owner })',
	rg_find_ent_by_owner: 'Entity.find({ owner })',
	cs_find_ent_by_owner: 'Entity.find({ owner })',
	find_ent_by_model: 'Entity.find({ model })',
	find_ent_in_sphere: 'Entity.findAll({ near, radius })',
	find_sphere_class: 'Entity.findAll({ classname, near, radius })',
	has_map_ent_class: 'Entity.find({ classname }) != null',
	entity_set_origin: 'entity.origin = ...',
	entity_set_model: 'entity.model = ...',
	entity_set_size: 'entity.setSize(mins, maxs)',
	cs_set_ent_class: 'entity.classname = ...',
	FClassnameIs: 'entity.classname == name',
	entity_range: 'a.origin.distanceTo(b.origin)',
	force_use: 'entity.use(...)',
	call_think: 'entity.think()',
	DispatchSpawn: 'entity.spawn()',
	spawn: 'entity.spawn()',
	rh_emit_sound2: 'entity.emitSound',
	emit_sound: 'entity.emitSound',
	get_distance: 'a.distanceTo(b)',
	get_distance_f: 'a.distanceTo(b)',
	vector_distance: 'a.distanceTo(b)',
	vector_length: 'vector.magnitude()',

	// The game and the server.
	get_member_game: 'game.<field>',
	rg_update_teamscores: 'game.ctWins = ..., game.terroristWins = ...',
	rg_set_observer_mode: 'player.observerMode = ...',
	halflife_time: 'game.time',
	rh_get_mapname: 'server.map',
	show_dhudmessage: 'player.showHud(text, { large: true })',
	next_hudchannel: 'player.showHud',
	ClearSyncHud: 'hudLine.clear(player)',
	ShowSyncHudMsg: 'hudLine.show(player, text)',
	register_concmd: 'server.addCommand',
	read_argv: ARGS,
	read_argv_int: ARGS,
	read_argv_float: ARGS,
	read_args: ARGS,
	read_argc: ARGS,
	register_menuid: 'new Menu(title, options)',
	register_menucmd: 'new Menu(title, options)',
	show_menu: 'menu.show(player, data)',
	menu_makecallback: 'menu.addItem({ enabled, visible })',
	menu_item_setname: 'menu.addItem({ title: context => ... })',
	menu_item_setcall: 'menu.addItem({ enabled, visible })',
	register_cvar: 'new Cvar(name, default)',
	cvar_exists: 'cvar.exists',
	hook_cvar_change: 'cvar.addEventListener("change", ...)',
	enable_cvar_hook: 'cvar.addEventListener',
	disable_cvar_hook: 'cvar.removeEventListener',
	get_cvar_float: 'cvar.number',
	set_cvar_float: 'cvar.number = ...',
	get_pcvar_num: 'cvar.number',
	set_pcvar_num: 'cvar.number = ...',
	get_pcvar_float: 'cvar.number',
	set_pcvar_float: 'cvar.number = ...',
	get_pcvar_bool: 'cvar.boolean',
	set_pcvar_bool: 'cvar.boolean = ...',
	get_pcvar_string: 'cvar.value',
	set_pcvar_string: 'cvar.value = ...',
	bind_pcvar_num: 'cvar.number',
	bind_pcvar_float: 'cvar.number',
	bind_pcvar_string: 'cvar.value',
	GetLangTransKey: 'lang.translate(player, key)',
	SetGlobalTransTarget: 'lang.translate(player, key)',
	register_native: 'export function',
	get_param: PARAMS,
	get_param_f: PARAMS,
	get_param_byref: PARAMS,
	get_float_byref: PARAMS,
	get_string: PARAMS,
	get_array: PARAMS,
	get_array_f: PARAMS,
	set_string: RESULT,
	set_param_byref: RESULT,
	set_float_byref: RESULT,
	set_array: RESULT,
	set_array_f: RESULT,
	param_convert: PARAMS,
	CreateOneForward: 'new Forward(name)',
	PrepareArray: 'forward.emit(array)',
	get_vaultdata: 'storage.get(key)',
	set_vaultdata: 'storage.set(key, value)',
	remove_vaultdata: 'storage.delete(key)',
	vaultdata_exists: 'storage.has(key)',
};

const STRING = { en: 'string methods', ru: 'методы строк' };
const ARRAY = { en: 'an array: `list[i]`, `push`, `length`, `splice`, `indexOf`', ru: 'массив: `list[i]`, `push`, `length`, `splice`, `indexOf`' };
const MAP = { en: 'a `Map` or a `Record`: `get`, `set`, `has`, `delete`, `size`', ru: '`Map` или `Record`: `get`, `set`, `has`, `delete`, `size`' };
const NONE = { en: 'nothing: a plugin does not need it', ru: 'ничего: плагину это не нужно' };

/** Includes whose every native is the language's or a library's, and what stands for them. */
const PLAIN_INCLUDES: Record<string, Words> = {
	string: STRING,
	float: 'Math, Number(text), number.toFixed(n)',
	cellarray: ARRAY,
	cellstack: { en: 'an array: `push`, `pop`', ru: 'массив: `push`, `pop`' },
	celltrie: MAP,
	datapack: { en: 'an object, or a closure\'s variables', ru: 'объект или переменные замыкания' },
	sorting: 'array.sort((a, b) => a - b)',
	regex: 'RegExp: /.../.exec(text), text.match, text.replace',
	json: 'JSON.parse<T>(text), JSON.stringify(value)',
	textparse_ini: { en: '`configs.read(name)` of `@amxts/config-core`', ru: '`configs.read(name)` из `@amxts/config-core`' },
	textparse_smc: { en: '`configs.read(name)` of `@amxts/config-core`', ru: '`configs.read(name)` из `@amxts/config-core`' },
};

/** Natives plain TypeScript or a library covers, one by one. */
export const PLAIN: Record<string, Words> = {
	format: '`${a} ${b}`',
	formatex: '`${a} ${b}`',
	vformat: '`${a} ${b}`',
	vdformat: '`${a} ${b}`',
	format_args: '...args',
	copy: 'a = b',
	copyc: 'text.slice(0, text.indexOf(c))',
	add: 'a + b',
	strcat: 'a + b',
	strlen: 'text.length',
	equal: 'a == b',
	equali: 'a.toLowerCase() == b.toLowerCase()',
	strcmp: 'a == b, a.localeCompare(b)',
	strncmp: 'a.startsWith(b)',
	contain: 'text.indexOf(part)',
	containi: 'text.toLowerCase().indexOf(part)',
	strfind: 'text.indexOf(part)',
	replace: 'text.replace(a, b)',
	replace_string: 'text.replaceAll(a, b)',
	replace_stringex: 'text.replace(a, b)',
	num_to_str: 'String(n)',
	str_to_num: 'parseInt(text)',
	strtol: 'parseInt(text, radix)',
	strtof: 'parseFloat(text)',
	str_to_float: 'parseFloat(text)',
	float_to_str: 'String(n), n.toFixed(2)',
	parse: 'text.split(" ")',
	strtok: 'text.split(...)',
	strtok2: 'text.split(...)',
	argparse: 'text.split(" ")',
	split_string: 'text.split(...)',
	trim: 'text.trim()',
	remove_quotes: 'text.replaceAll("\\"", "")',
	strtolower: 'text.toLowerCase()',
	strtoupper: 'text.toUpperCase()',
	mb_strtolower: 'text.toLowerCase()',
	mb_strtoupper: 'text.toUpperCase()',
	tolower: 'text.toLowerCase()',
	toupper: 'text.toUpperCase()',
	ucfirst: 'text[0].toUpperCase() + text.slice(1)',
	mb_ucfirst: 'text[0].toUpperCase() + text.slice(1)',
	setc: '"a".repeat(n)',
	numargs: '...args',
	getarg: '...args',
	setarg: '...args',
	min: 'Math.min(a, b)',
	max: 'Math.max(a, b)',
	clamp: 'Math.min(Math.max(x, low), high)',
	power: 'a ** b',
	sqroot: 'Math.sqrt(x)',
	random: 'Math.floor(Math.random() * n)',
	random_num: 'Math.floor(Math.random() * (b - a + 1)) + a',
	random_float: 'Math.random() * (b - a) + a',
	swapchars: { en: 'bitwise operators', ru: 'побитовые операторы' },
	time: 'new Date().getHours(), getMinutes(), getSeconds()',
	date: 'new Date().getFullYear(), getMonth(), getDate()',
	tickcount: 'performance.now()',
	get_time: 'new Date() and its getters: getHours(), getDate(), ...',
	format_time: 'new Date() and its getters, padStart',
	get_systime: 'Date.now() / 1000',
	arrayset: 'array.fill(value)',
	heapspace: NONE,
	funcidx: NONE,
	set_fail_state: 'throw new Error(message)',
	log_error: 'throw new Error(message)',
	abort: 'throw new Error(message)',
	set_native_filter: { en: 'nothing: a missing native answers 0 and says so once', ru: 'ничего: отсутствующий натив отвечает 0 и пишет об этом один раз' },
	set_module_filter: { en: 'nothing: a missing native answers 0 and says so once', ru: 'ничего: отсутствующий натив отвечает 0 и пишет об этом один раз' },
	set_error_filter: 'try { ... } catch (error) { ... }',
	dbg_trace_begin: 'error.stack',
	dbg_trace_next: 'error.stack',
	dbg_trace_info: 'error.stack',
	dbg_fmt_error: 'error.message',
	DestroyForward: NONE,
	menu_destroy: NONE,
	nvault_close: NONE,
	change_task: 'clearTimeout(handle); handle = setTimeout(...)',
	task_exists: { en: 'the handle `setTimeout` returned, kept in a variable', ru: 'дескриптор, который вернул `setTimeout`, в переменной' },
	log_to_file: fs('appendFileSync(path, line)'),
	read_file: fs('readFileSync(path).split("\\n")[i]'),
	write_file: fs('writeFileSync, appendFileSync'),
	file_exists: fs('existsSync(path)'),
	dir_exists: fs('existsSync(path)'),
	read_dir: fs('readdirSync(path)'),
	open_dir: fs('readdirSync(path)'),
	next_file: fs('readdirSync(path)'),
	close_dir: fs('readdirSync(path)'),
	mkdir: fs('mkdirSync(path)'),
	fopen: fs('readFileSync, writeFileSync, appendFileSync'),
	fclose: fs('readFileSync, writeFileSync, appendFileSync'),
	fgets: fs('readFileSync(path).split("\\n")'),
	feof: fs('readFileSync(path).split("\\n")'),
	fputs: fs('writeFileSync, appendFileSync'),
	fprintf: fs('appendFileSync(path, `${a} ${b}`)'),
	LoadFileForMe: fs('readFileSync(path)'),
};

/** How an element's key in the tooltip tables is written in a plugin, where the rule does not say it. */
const DISPLAY: Record<string, string> = {
	'HudOptions': 'player.showHud(text, options)',
	'HudOptions.large': 'player.showHud(text, { large: true })',
	'HudLine': 'new HudLine()',
	'MessageArgs': 'event.args',
	'ClientMessage': 'server.addMessageListener(name, listener)',
	'ClientMessage.preventDefault': 'event.preventDefault()',
	'TouchEvent': 'game.addEventListener("touch", listener, { toucher, touched })',
	'Variant': 'print(player, text, "chat")',
	'EndRoundOptions.dispatch': 'game.endRound({ dispatch })',
	'ActionOptions.hooks': 'weapon.deploy(), weapon.deploy({ hooks: false })',
	'Cvar': 'new Cvar(name)',
	'Storage': 'new Storage(name)',
	'Forward': 'new Forward(name)',
	'Menu': 'new Menu(title, options)',
	'Screen': 'player.screen',
	'Game': 'game',
	'lang': 'lang',
	'effects': 'effects.beamPoints(...), effects.explosion(...), ...',
	'trace': 'trace.line(...), trace.hull(...)',
};

/** The instance a class's member is reached through. */
const INSTANCES: Record<string, string> = { Client: 'player', Screen: 'player.screen', HudLine: 'hudLine', ServerPlugin: 'plugin', TraceResult: 'hit', Stats: 'stats', ServerVersions: 'server.versions', Aim: 'player.aim' };

export interface Native {
	name: string;
	module: string;
	include: string;
}

/** Every native of the modules, once, by the first include that declares it. */
export function natives(): Native[] {
	const seen = new Set<string>();
	return Object.entries(MODULES).flatMap(([module, includes]) => includes.flatMap(include =>
		new IncludeParser(readInclude(include)).parse().natives.filter(native => !seen.has(native.name) && seen.add(native.name)).map(native => ({ name: native.name, module, include }))));
}

/** One native's way in amxts. */
export interface Way {
	kind: 'api' | 'plain' | 'none';
	/** What to write; for a native covered for one use, that use's element. */
	what?: Words;
	/** The use an element covers, as the tooltip names it: `get_user_info(id, "lang")`. */
	partly?: string;
}

/** The element a tooltip key names, as a plugin writes it; `methods` are the names the source calls, not reads. */
function display(key: string, methods: Set<string>): string {
	if (DISPLAY[key]) return DISPLAY[key];
	const [owner, member] = key.split('.');
	const call = methods.has(member ?? owner) ? '()' : '';
	if (!member) return `${owner}${call}`;
	if (/^[a-z]/.test(owner)) return `${owner}.${member}${call}`;
	return `${INSTANCES[owner] ?? owner[0].toLowerCase() + owner.slice(1)}.${member}${call}`;
}

/** The names a source declares as functions and methods, but not as getters, setters or fields. */
function methodsOf(source: string): Set<string> {
	const declared = (pattern: RegExp) => [...source.matchAll(pattern)].map(m => m[1]);
	const properties = new Set(declared(/^\s*(?:static\s+)?(?:get|set)\s+(\w+)\s*\(|^\s*(?:readonly\s+)?(\w+)\??\s*:/gm));
	return new Set(declared(/^\s*(?:export\s+)?(?:static\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*[<(]/gm).filter(name => !properties.has(name)));
}

/**
 * What each tooltip of the hand-written API names on its `Pawn:` line: a
 * native's name, or one use of it (`get_user_info(id, "lang")`) - each to the
 * element. A member's tooltip wins over its class's.
 */
export async function tooltips(names: Set<string>): Promise<{ whole: Map<string, Words>; partly: Map<string, { use: string; what: Words }> }> {
	const dir = join(CORE, 'scripts', 'docs', 'as');
	const whole = new Map<string, Words>();
	const partly = new Map<string, { use: string; what: Words }>();
	for (const file of readdirSync(dir).filter(name => name.endsWith('.ts'))) {
		const source = join(CORE, 'as', file);
		const methods = existsSync(source) ? methodsOf(readFileSync(source, 'utf8')) : new Set<string>();
		const table: Record<string, { en: string }> = (await import(join(dir, file))).default;
		const entries = Object.entries(table).sort(([a], [b]) => Number(b.includes('.')) - Number(a.includes('.')));
		for (const [key, text] of entries) {
			const line = text.en.match(/^\s*Pawn:(.*)$/m)?.[1];
			if (!line || HOOD.has(key.split('.')[0]) || text.en.trimStart().startsWith('@hidden')) continue;

			const element = display(key, methods);
			const what = file === 'fs.ts' ? fs(element) : element;
			for (const [, token] of line.matchAll(/`([^`]+)`/g)) {
				const name = token.match(/^\w+/)?.[0] ?? '';
				const each = token.endsWith('*') ? [...names].filter(n => n.startsWith(token.slice(0, -1))) : token === name && names.has(name) ? [name] : [];
				for (const native of each.filter(native => !whole.has(native))) whole.set(native, what);
				if (!each.length && names.has(name) && !partly.has(name)) partly.set(name, { use: token, what });
			}
		}
	}
	return { whole, partly };
}

/**
 * The way of every native. The hand tables come first: PLAIN where the
 * language is the answer, API where one native is many elements; then the
 * tooltips; then an include the language covers whole.
 */
export async function coverage(): Promise<Map<Native, Way>> {
	const all = natives();
	const { whole, partly } = await tooltips(new Set(all.map(n => n.name)));
	return new Map(all.map((native): [Native, Way] => {
		const plain = PLAIN[native.name];
		if (plain) return [native, { kind: 'plain', what: plain }];

		const api = API[native.name] ?? whole.get(native.name);
		if (api) return [native, { kind: 'api', what: api }];

		const language = PLAIN_INCLUDES[native.include];
		if (language) return [native, { kind: 'plain', what: language }];

		const part = partly.get(native.name);
		return [native, part ? { kind: 'none', what: part.what, partly: part.use } : { kind: 'none' }];
	}));
}

// ------------------------------------------------------------ the corpus

function smaFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === 'include' ? [] : smaFiles(path);
		return name.endsWith('.sma') ? [path] : [];
	});
}

/** Pawn without its comments and strings, so a word in either is not a call. */
function code(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*|"(?:[^"\\^\n]|[\\^].)*"|'(?:[^'\\^\n]|[\\^].)*'/g, ' ');
}

/** How many distinct plugins under the folders call each native, and how many plugins there are. */
export function usage(dirs: string[], names: Set<string>): { counts: Map<string, number>; plugins: number } {
	const sources = new Map<string, string>();
	for (const path of dirs.flatMap(smaFiles)) {
		const text = readFileSync(path, 'latin1');
		sources.set(createHash('sha1').update(text).digest('hex'), text);
	}

	const counts = new Map<string, number>();
	for (const source of sources.values()) {
		const called = new Set([...code(source).matchAll(/\b([A-Z_]\w*)\s*\(/gi)].map(m => m[1]).filter(name => names.has(name)));
		for (const name of called) counts.set(name, (counts.get(name) ?? 0) + 1);
	}
	return { counts, plugins: sources.size };
}

// ------------------------------------------------------------ the pages

type Lang = 'en' | 'ru';

function say(words: Words, lang: Lang): string {
	return typeof words === 'string' ? words : words[lang];
}

/** A table cell: code in backticks, words as they are; `|` escaped. */
function cell(words: Words | undefined, lang: Lang): string {
	if (words === undefined) return '';
	const text = say(words, lang).replaceAll('|', '\\|');
	if (typeof words !== 'string') return text;
	return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

const PAGE = {
	en: {
		title: 'From Pawn',
		intro: `
Each native of AMX Mod X and its standard modules that amxts covers, and what
a plugin writes in its place: an element of the API, or plain TypeScript. A
native that is not here is called as it is, from \`@amxts/core/natives\`
([Natives](./01.natives.md#calling-natives-directly)).

\`entity.<field>\` is any field of an entity, a player or a weapon by its own
name (\`player.gravity\`, \`weapon.clip\`); \`game.<field>\` a field of the game
rules (\`game.ctWins\`); \`event.<field>\` an argument of an event or a message
(\`event.attacker\`). The [entities](../3.game/01.entities.md),
[players](../3.game/02.players.md), [hooks](../2.core/02.hooks.md) and
[messages](../3.game/06.messages.md) pages list them.`,
		head: '| Pawn | amxts |\n| --- | --- |',
	},
	ru: {
		title: 'С Pawn',
		intro: `
Каждый натив AMX Mod X и его стандартных модулей, который покрывает amxts, и
что плагин пишет вместо него: элемент API или обычный TypeScript. Натив, которого
здесь нет, вызывается как есть, из \`@amxts/core/natives\`
([Нативы](./01.natives.md#нативы-напрямую)).

\`entity.<field>\` - любое поле сущности, игрока или оружия под его собственным
именем (\`player.gravity\`, \`weapon.clip\`); \`game.<field>\` - поле правил игры
(\`game.ctWins\`); \`event.<field>\` - аргумент события или сообщения
(\`event.attacker\`). Их перечисляют страницы [сущности](../3.game/01.entities.md),
[игроки](../3.game/02.players.md), [хуки](../2.core/02.hooks.md) и
[сообщения](../3.game/06.messages.md).`,
		head: '| Pawn | amxts |\n| --- | --- |',
	},
};

/** The "From Pawn" page in one language. */
export function page(ways: Map<Native, Way>, lang: Lang): string {
	const text = PAGE[lang];
	const all = [...ways.keys()];
	const sections = Object.keys(MODULES).flatMap((module) => {
		// Natives with one replacement share a row; a whole include is named as the include.
		const groups = new Map<string, Native[]>();
		for (const [native, way] of ways) {
			if (native.module !== module || (way.kind === 'none' && !way.partly)) continue;
			const key = `${way.partly ?? ''}\n${say(way.what!, lang)}`;
			groups.set(key, [...(groups.get(key) ?? []), native]);
		}
		const rows = [...groups].map(([key, group]) => {
			const way = ways.get(group[0])!;
			const include = group[0].include;
			const whole = group.length > 2 && group.length === all.filter(n => n.include === include).length;
			const names = way.partly ? cell(way.partly, lang) : whole ? `\`${include}.inc\`` : group.map(n => n.name).sort().map(name => `\`${name}\``).join(', ');
			return { sortBy: whole ? include : group.map(n => n.name).sort()[0], row: `| ${names} | ${cell(way.what, lang)} |`, key };
		}).sort((a, b) => a.sortBy.toLowerCase().localeCompare(b.sortBy.toLowerCase())).map(each => each.row);
		return rows.length ? [`## ${module}\n\n${text.head}\n${rows.join('\n')}`] : [];
	});
	return `---\ntitle: ${text.title}\n---\n${text.intro}\n\n${sections.join('\n\n')}\n`;
}

const TABLE = {
	en: {
		title: 'API coverage',
		intro: (plugins: number) => `
Generated by \`bun scripts/coverage.ts --table\`. Every native of AMX Mod X and
its standard modules: covered by the API (its element), by plain TypeScript,
or not covered. ${plugins ? `"Plugins" is how many of ${plugins} distinct plugins of real servers and AMX Mod X's own call it.` : ''}`,
		summary: '| module | natives | API | TypeScript | not covered |\n| --- | ---: | ---: | ---: | ---: |',
		ranked: '## Not covered, most used first',
		head: '| native | plugins | way | amxts |\n| --- | ---: | --- | --- |',
		kinds: { api: 'API', plain: 'TypeScript', none: '-' },
		partly: 'partly',
	},
	ru: {
		title: 'Покрытие API',
		intro: (plugins: number) => `
Создан \`bun scripts/coverage.ts --table\`. Каждый натив AMX Mod X и его
стандартных модулей: покрыт API (его элемент), обычным TypeScript или не покрыт.
${plugins ? `«Плагины» - сколько из ${plugins} разных плагинов реальных серверов и самого AMX Mod X его вызывают.` : ''}`,
		summary: '| модуль | нативов | API | TypeScript | не покрыто |\n| --- | ---: | ---: | ---: | ---: |',
		ranked: '## Не покрытые, по частоте',
		head: '| натив | плагины | как | amxts |\n| --- | ---: | --- | --- |',
		kinds: { api: 'API', plain: 'TypeScript', none: '-' },
		partly: 'частично',
	},
};

/** The internal table in one language. */
export function table(ways: Map<Native, Way>, counts: Map<string, number>, plugins: number, lang: Lang): string {
	const text = TABLE[lang];
	const count = (native: Native) => counts.get(native.name) ?? 0;
	const row = ([native, way]: [Native, Way]) => `| \`${native.name}\` | ${count(native)} | ${way.partly ? `${text.partly}: ${cell(way.partly, lang)}` : text.kinds[way.kind]} | ${cell(way.what, lang)} |`;
	const summary = Object.keys(MODULES).map((module) => {
		const of = [...ways].filter(([native]) => native.module === module);
		const n = (kind: Way['kind']) => of.filter(([, way]) => way.kind === kind).length;
		return `| ${module} | ${of.length} | ${n('api')} | ${n('plain')} | ${n('none')} |`;
	});
	const ranked = [...ways].filter(([native, way]) => way.kind === 'none' && count(native) > 0).sort(([a], [b]) => count(b) - count(a) || a.name.localeCompare(b.name));
	const modules = Object.keys(MODULES).map(module => `### ${module}\n\n${text.head}\n${[...ways].filter(([native]) => native.module === module).sort(([a], [b]) => count(b) - count(a) || a.name.localeCompare(b.name)).map(row).join('\n')}`);
	return `# ${text.title}\n${text.intro(plugins)}\n\n${text.summary}\n${summary.join('\n')}\n\n${text.ranked}\n\n${text.head}\n${ranked.map(row).join('\n')}\n\n${modules.join('\n\n')}\n`;
}

const PAGES = { en: join(CORE, 'docs/en/6.pawn/02.from-pawn.md'), ru: join(CORE, 'docs/ru/6.pawn/02.from-pawn.md') };

/** The pages as they should be, beside where they are. */
export async function pages(): Promise<{ path: string; text: string }[]> {
	const ways = await coverage();
	return (['en', 'ru'] as const).map(lang => ({ path: PAGES[lang], text: page(ways, lang) }));
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const after = (flag: string) => args.flatMap((arg, i) => args[i - 1] === flag ? [arg] : []);
	const out = after('--table')[0];

	if (out) {
		const ways = await coverage();
		const { counts, plugins } = usage(after('--plugins'), new Set([...ways.keys()].map(n => n.name)));
		mkdirSync(join(out, 'ru'), { recursive: true });
		writeFileSync(join(out, 'API-COVERAGE.md'), table(ways, counts, plugins, 'en'));
		writeFileSync(join(out, 'ru', 'API-COVERAGE.md'), table(ways, counts, plugins, 'ru'));
		console.log(`${out}: API-COVERAGE.md, ru/API-COVERAGE.md (${plugins} plugins read)`);
	} else {
		const stale = (await pages()).filter(({ path, text }) => !existsSync(path) || readFileSync(path, 'utf8') !== text);
		const write = args.includes('--write');
		if (!write && stale.length) {
			process.stderr.write(`out of date: ${stale.map(p => p.path).join(', ')} - bun scripts/coverage.ts --write
`);
			process.exit(1);
		}

		for (const { path, text } of stale) writeFileSync(path, text);
		console.log(write ? `written: ${stale.length}` : 'the "From Pawn" pages are up to date');
	}
}
