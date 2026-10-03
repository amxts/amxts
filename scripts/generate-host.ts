import type { ForwardDeclaration, NativeFunction, Parameter } from '../src/types';
import type { MessageField } from './client-messages';
// Generates runtime/host/amxts_host.sma from includes/*.inc
//
// The host plugin holds no logic. It exists for exactly three reasons:
//   1. pull natives into its table so the module can resolve them by name;
//   2. relay AMXX forwards into the plugins through amxts_event();
//   3. keep a pool of publics that the plugins' callbacks attach to.
// scripts/compile-host.ts compiles it into runtime/src/host.h: the module
// carries it and has AMX Mod X load it, so a server installs the module alone.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IncludeParser } from '../src/parser/include-parser';
import { docsLang, docText, pick, renderDoc } from './apply-docs';
import { CLIENT_MESSAGES, MESSAGE_FIELDS, MESSAGE_GROUPS, MESSAGE_NAMES } from './client-messages';
import { EVENTS, PLAYER_CHANGE } from './docs/events';
import { ANY_MESSAGE, gameName, MESSAGES, missingField } from './docs/messages';
import { GAME_ENUMS, memberName } from './include-enums';
import { includePath, listIncludes, parseOrder, readInclude, resolveTransitive } from './includes';

const includesDir = './includes';
const outPath = './runtime/host/amxts_host.sma';

const CALLBACK_SLOTS = 512; // must match MAX_CALLBACK_SLOTS in runtime/src/module.cpp

// The host's stack and heap, in cells (`#pragma dynamic`). The module copies a
// native's strings and arrays into this heap for the length of the call, each
// up to MAX_CROSSING_CELLS (16384) in runtime/src/module.cpp, so AMX Mod X's
// default of 4096 cells for both would not hold one long text. 512 KB.
const HOST_CELLS = 131072;

// plugin_init belongs to the host plugin itself — it bootstraps the runtime.
// Both are written by hand below: plugin_init bootstraps the runtime, and
// plugin_natives loads the plugins before AMX Mod X asks anyone for natives.
const SKIP_FORWARDS = new Set(['plugin_init', 'plugin_natives']);

function isFloat(p: Parameter): boolean {
	return /Float/.test(p.type);
}

// Pawn requires fixed-size array arguments to match the declared size exactly,
// so every distinct size gets its own dummy variable.
const fixedArrays = new Map<string, string>();

function arrayVar(size: string): string {
	const name = `__a_${size.replace(/[^A-Z0-9]/gi, '_')}`;
	fixedArrays.set(name, size);
	return name;
}

// Dummy argument: the call never runs, only the reference to the native matters.
// A 2D array (sorting.inc's `array[][]`) is not interchangeable with a 1D one
// at the call site — amxxpc rejects it with "array dimensions do not match" —
// so it gets its own dummy variable instead of falling back to __s.
function dummyArg(p: Parameter): string {
	if (p.isArray && (p.dimensions ?? 1) >= 2) return '__s2d';
	if (p.isArray) return p.arraySize ? arrayVar(p.arraySize) : '__s';
	if (isFloat(p)) return '__f';
	return '__i';
}

function pullCall(n: NativeFunction): string {
	const args = n.params.filter(p => !p.isRest).map(dummyArg);
	return `\t${n.name}(${args.join(', ')});`;
}

function forwardIsSimple(f: ForwardDeclaration): boolean {
	return !SKIP_FORWARDS.has(f.name) && f.params.every(p => !p.isRest);
}

/**
 * What a forward's parameter is: `n` a number, `f` a float, `s` a string, `a`
 * an array of numbers - an array with a tag, `Float:origin[3]`; an untagged
 * one is text.
 */
function kindOf(p: Parameter): 'n' | 'f' | 's' | 'a' {
	if (p.isArray) return p.type && p.type !== 'any' ? 'a' : 's';
	return isFloat(p) ? 'f' : 'n';
}

/** The size the include writes for an array parameter, or null: `Float:origin[3]` is 3. */
function sizeOf(p: Parameter): string | null {
	return /^\d+$/.test(p.arraySize ?? '') ? p.arraySize! : null;
}

// The module sees every parameter as an identical cell and cannot tell a number
// from a string address, so it gets a type mask, a letter per parameter
// (kindOf), an array's size after it where the include writes one - "na3s".
function typeMask(f: ForwardDeclaration): string {
	return f.params.map(p => kindOf(p) === 'a' ? `a${sizeOf(p) ?? ''}` : kindOf(p)).join('');
}

// The public must match the forward prototype down to tags and const,
// otherwise amxxpc reports "function heading differs from prototype".
function pawnParam(p: Parameter): string {
	const konst = p.isConst ? 'const ' : '';
	const tag = p.type && p.type !== 'any' ? `${p.type}:` : '';
	const dims = p.isArray ? `[${p.arraySize ?? ''}]` : '';
	return `${konst}${tag}${p.name}${dims}`;
}

function forwardStub(f: ForwardDeclaration): string {
	const sig = f.params.map(pawnParam).join(', ');
	const args = [`"${f.name}"`, `"${typeMask(f)}"`, ...f.params.map(p => p.name)].join(', ');
	return `public ${f.name}(${sig})\n{\n\treturn amxts_event(${args});\n}`;
}

// must match MAX_CALLBACK_ARGS and n_callback's arity in runtime/src/module.cpp
const CALLBACK_ARGS = 8;

const CALLBACK_PARAMS = Array.from({ length: CALLBACK_ARGS }, (_, i) => String.fromCharCode(97 + i));

/**
 * The one public behind every native a plugin exports.
 *
 * AMX Mod X implements a native as a public in some plugin, and
 * register_native names it - so every native a plugin here exports names this
 * one. It only says who called and how many arguments came: the module works
 * out which native it was from the caller, and reads the arguments itself,
 * with get_param, while this call is still the native being run - so there is
 * no limit on how many natives or arguments, and a string or an array among
 * them is read in the caller's memory rather than copied through here.
 */
const NATIVE_PUBLIC = [
	`public __amxts_native(plugin, params)`,
	`{`,
	`\treturn amxts_native(plugin, params);`,
	`}`,
].join('\n');

/**
 * The arguments arrive as declared parameters, not through getarg().
 *
 * getarg() dereferences: Pawn passes variadic arguments by reference, so
 * getarg(arg, index) reads the cell AT the argument's value. AMX Mod X and
 * reapi push a callback's arguments by value, so getarg(0) on a task id of
 * 4096 returned the cell at DAT+4096 (114, measured) and on a string returned
 * its first character instead of its address. A declared parameter is the
 * pushed cell itself: a number as a number, a string or vector as the address
 * the module needs to read it.
 *
 * Reading a declared parameter the caller never pushed is stack garbage, which
 * is why the numargs() switch stays: each branch names only the arguments that
 * actually arrived.
 */
function callbackSlot(i: number): string {
	const call = (n: number) =>
		[`${i}`, `${n}`, ...CALLBACK_PARAMS.map((p, k) => (k < n ? p : '0'))].join(', ');

	const cases = Array.from(
		{ length: CALLBACK_ARGS },
		(_, n) => `\t\tcase ${n}: return amxts_callback(${call(n)});`,
	);

	return [
		`public __amxts_cb${i}(${CALLBACK_PARAMS.join(', ')})`,
		`{`,
		`\tswitch (numargs()) {`,
		...cases,
		`\t}`,
		`\treturn amxts_callback(${call(CALLBACK_ARGS)});`,
		`}`,
	].join('\n');
}

/**
 * What to write as `#include` and in what order comes from includes/order.txt.
 *
 * The order cannot be derived from the .inc files: an include may use reapi's
 * constants without including reapi — the plugin does. The list also differs
 * from the set of files: reapi.inc already pulls in reapi_engine and
 * reapi_gamedll, whose natives we need but must not include a second time.
 *
 * A line starting with `-` is a deny marker, not an include: the file is
 * still parsed - an include that #includes it needs it on disk, and its
 * constants and forwards resolve normally - but its natives are kept out of
 * `__pull_natives()`. A native the server lacks does not stop the host
 * loading (the native filter below), so no include needs one today; the
 * marker stays for one whose natives the host must not name at all. See
 * scripts/includes.ts's parseOrder for the parsing itself.
 */
function readOrderFile(): { includes: string[]; denied: Set<string> } {
	const orderFile = join(includesDir, 'order.txt');

	if (!existsSync(orderFile)) {
		return { includes: listIncludes(), denied: new Set() };
	}

	return parseOrder(readFileSync(orderFile, 'utf-8'));
}

const { includes, denied } = readOrderFile(); // from order.txt, unchanged
// Denied too: a deny marker keeps a file's natives out of the host's table, it
// does not make the file uninteresting - its forwards still want relaying, and
// nothing links against a forward.
const parseNames = resolveTransitive(includes.concat(Array.from(denied)));
const natives: NativeFunction[] = [];
let forwards: ForwardDeclaration[] = [];

// Function-like defines are shared across includes, so collect them first.
const macros = new Map();
for (const name of parseNames) {
	IncludeParser.collectMacrosFrom(readInclude(name), macros);
}

// Parse every transitively-reachable include: we need natives from included
// ones too — except a denied one's natives, which never enter the pull table.
const includeTexts: string[] = [];
// Forwards of the AMX Mod X distribution itself. Only these are server events:
// a forward some plugin declares (menu_core's, a project's own) is heard
// through Forward.subscribe, one way for one thing. The host still relays
// every forward, which is what lets subscribe hear a Pawn plugin's.
const stockForwards = new Set<string>();
for (const name of parseNames) {
	const text = readInclude(name);
	includeTexts.push(text);
	const parsed = new IncludeParser(text, macros).parse();
	if (!denied.has(name)) natives.push(...parsed.natives);
	forwards.push(...parsed.forwards);
	if (includePath(name).replace(/\\/g, '/').includes('amxmodx/base/include/')) {
		for (const f of parsed.forwards) stockForwards.add(f.name);
	}
}

forwards = forwards.filter(forwardIsSimple);

// Order matters: pullCall fills fixedArrays, and declarations precede the calls.
const pulls = natives.map(pullCall).join('\n');
const arrayDecls = Array.from(fixedArrays, ([name, size]) => `\tnew ${name}[${size}];`).join('\n');

// The events a plugin can listen to, as/events.ts's ServerEventMap, are
// written here rather than by generate-wasm-api because the host plugin is
// what decides which forwards are relayed at all - a name absent from
// order.txt's includes is absent there too.

function camelOf(text: string): string {
	return text.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/**
 * Each forward's event by the name a plugin author says - lowerCamelCase,
 * what happened rather than the forward's prefix or its module:
 * `client_putinserver` is `putInServer`, `OnConfigsExecuted`
 * `configsExecuted`, `client_kill` `suicide` (the game's `kill` is an item
 * taken away). The forward's own name stays the tooltip's `Pawn:` line, and
 * `amxts upgrade` rewrites the old names (scripts/upgrade-names.ts).
 */
const EVENT_NAMES: Record<string, string> = {
	plugin_init: 'init',
	plugin_precache: 'precache',
	plugin_cfg: 'pluginsLoaded',
	plugin_end: 'end',
	plugin_pause: 'pause',
	plugin_unpause: 'unpause',
	plugin_log: 'log',
	plugin_modules: 'modules',
	server_changelevel: 'changeLevel',
	server_frame: 'frame',
	OnConfigsExecuted: 'configsExecuted',
	OnAutoConfigsBuffered: 'configsQueued',
	client_connect: 'connect',
	client_connectex: 'connectAttempt',
	client_authorized: 'authorized',
	client_putinserver: 'putInServer',
	client_disconnected: 'disconnected',
	client_remove: 'remove',
	client_command: 'command',
	client_kill: 'suicide',
	client_impulse: 'impulse',
	client_cmdStart: 'cmdStart',
	inconsistent_file: 'inconsistentFile',
	CS_InternalCommand: 'internalCommand',
	pfn_spawn: 'entitySpawn',
	pfn_think: 'entityThink',
	pfn_keyvalue: 'keyValue',
	pfn_playbackevent: 'playbackEvent',
};

/**
 * Forwards that are a game event, so one thing has one name: cstrike's
 * buying is `buyWeapon`, `buyItem`, `buyAmmo` and `itemRestricted`, a
 * changed info `userInfoChange`. The hood still listens to them - plain HLDS
 * hears those game events through them (as/hlds.ts) - but ServerEventMap
 * leaves them out.
 */
const HOOD_ONLY = new Set(['CS_OnBuy', 'CS_OnBuyAttempt', 'client_infochanged']);

/**
 * Forwards no event is made of: the game's events say the same
 * (`preThink`, `postThink`, `touch`), or the forward is an old form of
 * another (`client_disconnect` of `client_disconnected`).
 */
const LEFT_OUT = new Set(['client_PreThink', 'client_PostThink', 'pfn_touch', 'client_disconnect']);

/**
 * One event per forward the host relays, and plugin_init, which the module
 * fires itself: `server.addEventListener("putInServer", (event) => ...)`.
 *
 * What a listener gets is an object with the forward's arguments as typed
 * fields - `event.player` a Player rather than an index, a string read out of
 * the plugin's memory, a bool a boolean - the way a DOM listener gets an
 * Event.
 */
interface ServerEvent {
	forward: string;
	/** The key an editor completes, `putInServer`; for one only the hood listens to, the forward in camelCase. */
	short: string;
	/** Whether ServerEventMap has it: not when only the hood listens to it. */
	listed: boolean;
	className: string;
	/** Carried arguments, in order, as the module hands them over. */
	fields: EventField[];
}

interface EventField {
	/** null: the argument is carried but not shown (a buffer length). */
	name: string | null;
	type: string;
	/** How the trampoline reads it, from the running call's arguments. */
	decode: string;
	pawn: string;
}

// Hungarian prefixes the includes put on argument names: iMode, szId, bActive.
const EVENT_HUNGARIAN = /^(sz|fl|[bif])(?=[A-Z])/;

// Names that read better said out: `event.dropped`, `event.reason`, `event.command`.
const EVENT_RENAMES: Record<string, string> = {
	drop: 'dropped',
	message: 'reason',
	entid: 'entity',
	cmd: 'command',
	filename: 'file',
	eventid: 'eventIndex',
	authid: 'steamId',
};

/** The event's field for the parameter at `i`, read from the call's arguments (the facade's __native* helpers). */
function eventField(p: Parameter, i: number): EventField {
	const raw = p.name;
	const pawn = `${p.type && p.type !== 'any' ? `${p.type}:` : ''}${raw}${p.isArray ? `[${p.arraySize ?? ''}]` : ''}`;
	const cell = `__nativeCell(${i})`;

	if (/^(?:id|index)$/.test(raw)) {
		return { name: 'player', type: 'Player', decode: `new Player(${cell})`, pawn };
	}
	if (/^maxlen$/.test(raw)) {
		return { name: null, type: 'number', decode: cell, pawn };
	}

	let name = EVENT_RENAMES[raw] ?? raw.replace(EVENT_HUNGARIAN, '');
	name = name.charAt(0).toLowerCase() + name.slice(1);
	name = fixName(name);

	switch (kindOf(p)) {
		case 's': return { name, type: 'string', decode: `__nativeString(${i})`, pawn };
		case 'f': return { name, type: 'number', decode: `<f64>reinterpret<f32>(${cell})`, pawn };
		case 'a':
			return isFloat(p) && sizeOf(p) === '3'
				? { name, type: 'Vector', decode: `__nativeVector(${i})`, pawn }
				: { name, type: 'number[]', decode: `__forwardNumbers(${i}, ${isFloat(p)})`, pawn };
	}
	if (/^(?:drop|bool)$/.test(raw) || /^b[A-Z]/.test(raw)) return { name, type: 'boolean', decode: `${cell} != 0`, pawn };
	return { name, type: 'number', decode: `<f64>${cell}`, pawn };
}

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function fixName(name: string): string {
	// `function` and friends would not compile as a field or parameter name.
	return /^(?:function|class|const|let|var|new|delete|in|is|of|type|null|true|false)$/.test(name)
		? `${name}_`
		: name;
}

/** Forwards of a player not in the game yet: their event hands a Client. */
const NOT_IN_GAME = new Set(['client_connect', 'client_connectex', 'client_authorized', 'client_putinserver']);

const relayed = forwards.filter(f => stockForwards.has(f.name) && !LEFT_OUT.has(f.name));
const unnamedForwards = relayed.filter(f => !EVENT_NAMES[f.name] && !HOOD_ONLY.has(f.name)).map(f => f.name);
if (unnamedForwards.length > 0) throw new Error(`forwards without an event name in EVENT_NAMES (or in HOOD_ONLY, LEFT_OUT): ${unnamedForwards.join(', ')}`);

const serverEvents: ServerEvent[] = [
	{ forward: 'plugin_init', short: 'init', listed: true, className: 'PluginInitEvent', fields: [] },
	...relayed.map((f) => {
		const listed = !HOOD_ONLY.has(f.name);
		const short = EVENT_NAMES[f.name] ?? camelOf(f.name);
		const seen = new Set<string>();
		const fields = f.params.map((p, i) => {
			const field = eventField(p, i);
			if (field.name) {
				while (seen.has(field.name)) field.name += '_';
				seen.add(field.name);
			}
			return field;
		});
		// Before a player is in the game he has no body: no health, no weapons.
		// His events hand a Client - what he is while connecting - which the
		// Player made for him implements.
		if (NOT_IN_GAME.has(f.name) && fields[0]?.type === 'Player') fields[0].type = 'Client';
		// Named after the whole forward - ClientPutinserverEvent - so none meets a
		// hookchain's event of the same short name (reapi has its own changeLevel).
		return { forward: f.name, short, listed, className: `${upperFirst(camelOf(f.name))}Event`, fields };
	}),
];

/** What an include's doc comment says about a forward, for the editor's tooltips. */
interface ForwardDoc {
	summary: string;
	notes: string[];
	params: Map<string, string>;
}

/**
 * The `/** ... *\/` right above `forward name(` in any include, read into its
 * parts. AMX Mod X documents every forward that way - what it is, `@note`s,
 * `@param`s - and that text is what someone hovering `event.reason` wants.
 */
function forwardDoc(forward: string): ForwardDoc | null {
	for (const text of includeTexts) {
		const at = text.search(new RegExp(`\\bforward\\s+(?:\\w+:)?${forward}\\s*\\(`));
		if (at < 0) continue;

		// Only blank lines and #pragma may stand between the comment and the forward.
		const before = text.slice(0, at);
		const end = before.lastIndexOf('*/');
		if (end < 0 || /\S/.test(before.slice(end + 2).replace(/^\s*#pragma[^\n]*$/gm, ''))) return null;
		const start = before.lastIndexOf('/**', end);
		if (start < 0) return null;

		const lines = before.slice(start + 3, end).split('\n').map(l => l.replace(/^\s*\*\s?/, '').trimEnd());
		const doc: ForwardDoc = { summary: '', notes: [], params: new Map() };
		let current: { kind: 'summary' | 'note' | 'param' | 'other'; key?: string } = { kind: 'summary' };
		const summary: string[] = [];

		for (const line of lines) {
			const tag = line.match(/^@(\w+)\b(.*)$/);
			if (tag) {
				const rest = tag[2].trim();
				if (tag[1] === 'note') {
					doc.notes.push(rest);
					current = { kind: 'note' };
				} else if (tag[1] === 'param') {
					const m = rest.match(/^(\w+)\s+(\S.*)$/);
					if (m) {
						doc.params.set(m[1], m[2].trim());
						current = { kind: 'param', key: m[1] };
					} else {
						current = { kind: 'other' };
					}
				} else {
					current = { kind: 'other' };
				}
				continue;
			}
			const textLine = line.trim();
			if (!textLine) {
				if (current.kind === 'summary' && summary.length) current = { kind: 'other' };
				continue;
			}
			if (current.kind === 'summary') summary.push(textLine);
			else if (current.kind === 'note') doc.notes[doc.notes.length - 1] += ` ${textLine}`;
			else if (current.kind === 'param' && current.key) doc.params.set(current.key, `${doc.params.get(current.key)} ${textLine}`);
		}

		doc.summary = summary.join(' ');
		return doc;
	}
	return null;
}

// The language of the tooltips: AMXTS_DOCS_LANG in .env, English by default.
const DOCS_LANG = docsLang();

/** What an editor shows for an event: scripts/docs/events.ts first, the include after. */
function eventSummary(forward: string): string {
	const ours = EVENTS[forward];
	if (ours) return pick(ours.summary, DOCS_LANG);
	return forwardDoc(forward)?.summary ?? '';
}

function eventClass(e: ServerEvent): string {
	const shown = e.fields.filter(f => f.name !== null);
	const signature = e.forward === 'plugin_init'
		? 'plugin_init()'
		: `${e.forward}(${e.fields.map(f => f.pawn).join(', ')})`;
	const ours = EVENTS[e.forward];
	const inc = forwardDoc(e.forward);

	const summary = eventSummary(e.forward);
	const notes = ours?.notes ? ours.notes.map(note => pick(note, DOCS_LANG)) : (inc?.notes ?? []);
	const noteWord = DOCS_LANG === 'ru' ? 'Важно' : 'Note';
	const classDoc = [
		`/**`,
		...(summary ? [` * ${docText(summary)}`, ` *`] : []),
		...notes.map(n => ` * ${noteWord}: ${docText(n)}`),
		...(notes.length ? [` *`] : []),
		` * Pawn: \`${signature}\``,
		...(ours?.example ? [` *`, ` * @example`, ...ours.example.split('\n').map(l => ` * ${l.replace(/\*\//g, '* /')}`)] : []),
		` */`,
	];
	const fieldDoc = (f: EventField) => {
		const own = f.name ? ours?.fields?.[f.name] : undefined;
		const raw = f.pawn.replace(/^\w+:/, '').replace(/\[.*$/, '');
		// Our words, or the include's, then the parameter as Pawn has it (code-style rule 30).
		const words = own
			? pick(own, DOCS_LANG)
			: f.name === 'player'
				? (DOCS_LANG === 'ru' ? 'Игрок, о котором событие.' : 'The player the event is about.')
				: inc?.params.get(raw);
		return words ? [`\t${renderDoc(`${docText(words)}\n\nPawn: \`${f.pawn}\``, '\t')}`] : [];
	};
	return [
		...classDoc,
		`export class ${e.className} {`,
		...shown.flatMap(f => [...fieldDoc(f), `\t${f.name}: ${f.type};`]),
		...(shown.length
			? [``, `\tconstructor(${shown.map(f => `${f.name}: ${f.type}`).join(', ')}) {`, ...shown.map(f => `\t\tthis.${f.name} = ${f.name};`), `\t}`]
			: []),
		`}`,
	].join('\n');
}

// The trampoline takes the forward's first cell - a player event's id - and
// reads every field from the running call's arguments, as many as the
// forward has (the module's CallArgs).
function eventPlumbing(e: ServerEvent): string {
	const key = e.short;
	const args = e.fields.filter(f => f.name !== null).map(f => f.decode);
	// An async listener of a player's event runs under that player's signal
	// (__co_ambient_player, as/promise.ts) - except when the event is the
	// player leaving, which is what aborts that signal.
	const forPlayer = e.fields.length > 0 && e.fields[0].name === 'player' && !LEAVING.has(e.forward);
	const loop = forPlayer
		? `	const ambient = __co_ambient_player;
	__co_ambient_player = a0;
	for (let i = 0; i < listeners.length; i++) listeners[i](event);
	__co_ambient_player = ambient;`
		: `	for (let i = 0; i < listeners.length; i++) listeners[i](event);`;
	return `const ${key}Listeners: ((event: ${e.className}) => void)[] = [];
let ${key}Relayed = false;

function ${key}Trampoline(a0: i32): void {
	if (${key}Listeners.length == 0) return;
	const event = new ${e.className}(${args.join(', ')});
	// A copy: a listener that removes itself must not make the next one skip.
	const listeners = ${key}Listeners.slice(0);
${loop}
}`;
}

/** The forwards of a player leaving: their listeners do not run under the player's signal. */
const LEAVING = new Set(['client_disconnect', 'client_disconnected', 'client_remove']);

function addBranch(e: ServerEvent): string {
	const key = e.short;
	return `	if (idof<E>() == idof<${e.className}>()) {
		${key}Listeners.push(changetype<(event: ${e.className}) => void>(listener));
		if (!${key}Relayed) {
			${key}Relayed = true;
			_on("${e.forward}", ${key}Trampoline.index, 0);
		}
		return;
	}`;
}

function removeBranch(e: ServerEvent): string {
	const key = e.short;
	return `	if (idof<E>() == idof<${e.className}>()) {
		const at = ${key}Listeners.indexOf(changetype<(event: ${e.className}) => void>(listener));
		if (at >= 0) ${key}Listeners.splice(at, 1);
		return;
	}`;
}

// ---------------------------------------------------------------- client messages
//
// Every message the game sends its clients is heard through
// server.addMessageListener, by its name in the player's words
// (scripts/client-messages.ts); the ones with typed fields are a class of
// their own over ClientMessage (as/facade.ts), whose hood reads and writes an
// argument by its number.

/** A getter and a setter per kind of field, of the field - `arg` is its argument's number; `takes` what the setter takes, where more than the getter gives. */
const MESSAGE_ACCESSORS: Record<MessageField['kind'], { type: string; takes?: string; get: (f: MessageField) => string; set: (f: MessageField) => string }> = {
	number: { type: 'number', get: f => `this.__number(${f.arg})`, set: f => `this.__setNumber(${f.arg}, value)` },
	boolean: { type: 'boolean', get: f => `this.__number(${f.arg}) != 0`, set: f => `this.__setNumber(${f.arg}, value ? 1 : 0)` },
	string: { type: 'string', get: f => `this.__text(${f.arg})`, set: f => `this.__setText(${f.arg}, value)` },
	texts: { type: 'string[]', get: f => `this.__texts(${f.arg})`, set: f => `this.__setTexts(${f.arg}, value)` },
	player: { type: 'Player | null', get: f => `this.__player(${f.arg})`, set: f => `this.__setNumber(${f.arg}, value != null ? value.id : 0)` },
	weapon: { type: 'WeaponKind', get: f => `weaponKindOf(this.__number(${f.arg}))`, set: f => `this.__setNumber(${f.arg}, weaponIdOf(value))` },
	team: { type: 'Team', get: f => `MESSAGE_TEAMS[<i32>min(max(this.__number(${f.arg}), 0), 3)]`, set: f => `this.__setNumber(${f.arg}, max(MESSAGE_TEAMS.indexOf(value), 0))` },
	teamName: { type: 'Team', get: f => `messageTeam(this.__text(${f.arg}))`, set: f => `this.__setText(${f.arg}, value)` },
	vector: { type: 'Vector', takes: 'number[]', get: f => `this.__vector(${f.arg})`, set: f => `this.__setVector(${f.arg}, value)` },
	color: { type: 'number[]', get: f => `this.__bytes(${f.arg}, ${f.of})`, set: f => `this.__setBytes(${f.arg}, value)` },
	fixed: { type: 'number', get: f => `this.__number(${f.arg}) / ${f.of}.0`, set: f => `this.__setNumber(${f.arg}, Math.round(value * ${f.of}.0))` },
	bit: { type: 'boolean', get: f => `this.__bit(${f.arg}, ${f.of})`, set: f => `this.__setBit(${f.arg}, ${f.of}, value)` },
	fadeDirection: { type: 'FadeDirection', get: f => `this.__bit(${f.arg}, FFADE_OUT) ? "out" : "in"`, set: f => `this.__setBit(${f.arg}, FFADE_OUT, value == "out")` },
	hideHud: { type: 'HideHud[]', get: f => `<HideHud[]>HIDE_HUD.namesOf(<i32>this.__number(${f.arg}))`, set: f => `this.__setNumber(${f.arg}, HIDE_HUD.maskOf(value))` },
	damage: { type: 'Damage[]', get: f => `<Damage[]>DAMAGE.namesOf(<i32>this.__number(${f.arg}))`, set: f => `this.__setNumber(${f.arg}, DAMAGE.maskOf(value))` },
	scoreStatus: { type: 'ScoreStatus[]', get: f => `<ScoreStatus[]>SCORE_STATUS.namesOf(<i32>this.__number(${f.arg}))`, set: f => `this.__setNumber(${f.arg}, SCORE_STATUS.maskOf(value))` },
	statusIcon: { type: 'StatusIconState', get: f => `STATUS_ICON_STATES[<i32>min(max(this.__number(${f.arg}), 0), 2)]`, set: f => `this.__setNumber(${f.arg}, max(STATUS_ICON_STATES.indexOf(value), 0))` },
	destination: { type: 'VariantName', get: f => `MESSAGE_DESTINATIONS[<i32>min(max(this.__number(${f.arg}), 0), 4)]`, set: f => `this.__setNumber(${f.arg}, max(MESSAGE_DESTINATIONS.indexOf(value), 1))` },
	vguiMenu: { type: 'VguiMenu', get: f => `vguiMenuName(<i32>this.__number(${f.arg}))`, set: f => `this.__setNumber(${f.arg}, vguiMenuCell(value, <i32>this.__number(${f.arg})))` },
};

// VGUIMenu's menus by the names game.addEventListener("showVguiMenu") gives
// them (VguiMenu, scripts/generate-hooks.ts): the include's members, named by
// the same rule.
const VGUI_MENUS = GAME_ENUMS.get('VGUIMenu')!.map(m => ({ name: memberName(m.name.replace(/^VGUI_Menu_/, '')), value: m.value }));

/** A field of a name's event, with the messages of the name that do not carry it. */
type NameField = MessageField & { missing: string[] };

/** A name server.addMessageListener takes: the game's messages it hears, and the fields of them all - `null` for messages without a known layout. */
interface MessageName {
	name: string;
	messages: string[];
	fields: NameField[] | null;
}

/** What a field reads as on a message of its name that does not carry it. */
const MISSING_VALUE: Partial<Record<MessageField['kind'], string>> = { number: '0', player: 'null', texts: '[]' };

function messageName([name, messages]: [string, string[]]): MessageName {
	const known = messages.filter(message => MESSAGE_FIELDS[message]);
	if (known.length === 0) return { name, messages, fields: null };
	if (known.length < messages.length) throw new Error(`${name}: MESSAGE_FIELDS has the layout of some of ${messages.join(', ')}, not of all`);

	const all = messages.flatMap(message => MESSAGE_FIELDS[message]);
	const fields = all.filter((field, i) => all.findIndex(other => other.name === field.name) === i).map((field) => {
		if (all.some(other => other.name === field.name && (other.arg !== field.arg || other.kind !== field.kind || other.of !== field.of))) {
			throw new Error(`${name}: ${field.name} is not the same argument in ${messages.join(', ')}`);
		}
		const missing = messages.filter(message => !MESSAGE_FIELDS[message].some(other => other.name === field.name));
		// A message without the field must write nothing at its argument, or the field would read that.
		if (missing.some(message => MESSAGE_FIELDS[message].some(other => other.arg >= field.arg))) {
			throw new Error(`${name}: ${missing.join(', ')} writes another argument where ${field.name} is`);
		}
		if (missing.length > 0 && !MISSING_VALUE[field.kind]) throw new Error(`${name}: MISSING_VALUE has nothing for a missing ${field.kind} field, ${field.name}`);
		return { ...field, missing };
	});
	return { name, messages, fields };
}

/** A name's class, by its first message: `BarTimeMessage` for `progressBar`. */
const messageClassName = (m: MessageName) => `${m.messages[0]}Message`;

/** A name's words: what the game uses its messages for, how one without fields is read, the game's names of them and Pawn's way to hear them. */
function messageSummary(m: MessageName) {
	const args = m.fields ? '' : ` ${pick(ANY_MESSAGE.args, DOCS_LANG)}`;
	const pawn = m.messages.map(message => `\`register_message(get_user_msgid("${message}"), ...)\``).join(', ');
	return `${docText(`${pick(MESSAGES[m.messages[0]].summary, DOCS_LANG)}${args}`)}\n\n${pick(gameName(m.messages), DOCS_LANG)}\n\nPawn: ${pawn}`;
}

function messageClass(m: MessageName) {
	const fields = m.fields!.map((field) => {
		const accessor = MESSAGE_ACCESSORS[field.kind];
		const words = MESSAGES[m.messages[0]].fields?.[field.name];
		const missing = field.missing.length > 0 ? ` ${pick(missingField(field.missing, MISSING_VALUE[field.kind]!), DOCS_LANG)}` : '';
		return [
			`\t${renderDoc(`${words ? `${docText(`${pick(words, DOCS_LANG)}${missing}`)}\n\n` : ''}Pawn: \`get_msg_arg_*(${field.arg})\``, '\t')}`,
			`\tget ${field.name}(): ${accessor.type} { return ${accessor.get(field)}; }`,
			`\tset ${field.name}(value: ${accessor.takes ?? accessor.type}) { ${accessor.set(field)}; }`,
		].join('\n');
	});
	return [
		renderDoc(messageSummary(m), ''),
		`export class ${messageClassName(m)} extends ClientMessage {`,
		// What makes two message classes different types to TypeScript.
		`\tprivate readonly kind: string = "${m.messages[0]}";`,
		...fields,
		`}`,
	].join('\n');
}

function messageKey(m: MessageName) {
	return [`\t${renderDoc(messageSummary(m), '\t')}`, `\t${m.name}: ${m.fields ? messageClassName(m) : 'ClientMessage'};`].join('\n');
}

const strayMessages = [...Object.keys(MESSAGE_FIELDS), ...Object.keys(MESSAGE_NAMES)].filter(name => !CLIENT_MESSAGES.includes(name));
if (strayMessages.length > 0) throw new Error(`MESSAGE_FIELDS or MESSAGE_NAMES names messages the game does not have: ${strayMessages.join(', ')}`);
const unnamed = CLIENT_MESSAGES.filter(name => !MESSAGE_NAMES[name]);
if (unnamed.length > 0) throw new Error(`messages without a name in MESSAGE_NAMES: ${unnamed.join(', ')}`);
const messageNames = [...MESSAGE_GROUPS].map(messageName);
const wordless = messageNames.map(m => m.messages[0]).filter(message => !MESSAGES[message]);
if (wordless.length > 0) throw new Error(`messages without words in scripts/docs/messages.ts: ${wordless.join(', ')}`);

writeFileSync('./as/events.ts', `// GENERATED by scripts/generate-host.ts — do not edit
// Source: includes/*.inc, through the forwards the host plugin relays
//
// The events a server raises, one per forward the host plugin relays:
//
//   server.addEventListener("putInServer", (event) => print(event.player, "Welcome!"));
//
// ServerEventMap is what an editor reads - the event's name to its type, as
// the DOM's HTMLElementEventMap - and the compiler reads the same map through
// a patch (runtime/patches: \`K extends keyof M\` and \`M[K]\`), so an untyped
// \`(event) => ...\` gets the event's type. Underneath, each event keeps its
// listeners in an array and relays its forward from the first one on.
import { Client, ClientMessage, FadeDirection, Player, PlayerChangeEvent, StatusIconState, Team, VariantName, __forwardNumbers, __nativeCell, __nativeString, __nativeVector } from "./facade";
import { Vector } from "./vector";
import { WeaponKind, weaponKindOf } from "./entities";
import { DAMAGE, Damage, HIDE_HUD, HideHud, SCORE_STATUS, ScoreStatus } from "./flags";
import { VguiMenu } from "./hooks";

// @ts-ignore: decorator
@external("env", "on")
declare function _on(event: string, fn: i32, shape: i32): void;

${serverEvents.map(eventClass).join('\n\n')}

// The values a message's number fields stand for, in their numbers' order.
const MESSAGE_TEAMS: Team[] = ["UNASSIGNED", "TERRORIST", "CT", "SPECTATOR"];
const STATUS_ICON_STATES: StatusIconState[] = ["hide", "show", "flash"];
const MESSAGE_DESTINATIONS: VariantName[] = ["notify", "notify", "console", "chat", "center"];

// ScreenFade's flag for a fade from a clear view to the colour.
const FFADE_OUT = 1;

/** A WeaponKind's id, as a message carries it; 0 for one it does not know. */
function weaponIdOf(kind: WeaponKind): i32 {
	for (let id = 1; id < 32; id++) {
		if (weaponKindOf(id) == kind) return id;
	}
	return 0;
}

/** A team a message writes as text; one it does not name is "UNASSIGNED". */
function messageTeam(text: string): Team {
	const team = <Team>text;
	return MESSAGE_TEAMS.includes(team) ? team : "UNASSIGNED";
}

/** A VGUIMenu number as its name; a number it does not name reads as "unknown". */
function vguiMenuName(cell: i32): VguiMenu {
	switch (cell) {
${VGUI_MENUS.map(m => `\t\tcase ${m.value}: return "${m.name}";`).join('\n')}
	}
	return "unknown";
}

/** A VguiMenu name as its number; "unknown" keeps the argument as it came. */
function vguiMenuCell(name: VguiMenu, current: i32): i32 {
${VGUI_MENUS.map(m => `\tif (name == "${m.name}") return ${m.value};`).join('\n')}
	return current;
}

${messageNames.filter(m => m.fields).map(messageClass).join('\n\n')}

/** Every event a server raises, by name. */
export interface ServerEventMap {
${serverEvents.filter(e => e.listed).flatMap((e) => {
	const summary = eventSummary(e.forward);
	return [`\t${renderDoc(`${summary ? `${docText(summary)}\n\n` : ''}Pawn: \`${e.forward}\``, '\t')}`, `\t${e.short}: ${e.className};`];
}).join('\n')}
\t${renderDoc(docText(pick(PLAYER_CHANGE.summary, DOCS_LANG)), '\t')}
\tplayerChange: PlayerChangeEvent;
}

/** Every message the server sends its clients, by the name server.addMessageListener takes. */
export interface ServerMessageMap {
${messageNames.map(messageKey).join('\n')}
}

/** The game's names of the messages a name server.addMessageListener takes hears; a name it does not know as it is. */
export function protocolMessageNames(name: string): string[] {
${messageNames.map(m => `\tif (name == "${m.name}") return [${m.messages.map(message => `"${message}"`).join(', ')}];`).join('\n')}
\treturn [name];
}

${serverEvents.map(eventPlumbing).join('\n\n')}

/** Adds a listener for the event E - server.addEventListener's hood. */
export function addServerListener<E>(listener: (event: E) => void): void {
${serverEvents.map(addBranch).join('\n')}
}

/** Takes a listener off again - server.removeEventListener's hood. */
export function removeServerListener<E>(listener: (event: E) => void): void {
${serverEvents.map(removeBranch).join('\n')}
}
`);

const sma = `// GENERATED by scripts/generate-host.ts — do not edit
// Source: includes/*.inc

// Pawn passes the address of "" for an omitted \`const str[] = ""\` parameter,
// while the module has no types and fills every argument the caller left out
// with a plain 0 — so a native that reads an omitted string reads the cell at
// DAT+0. This has to be an empty string, and nothing guarantees that: whatever
// global the include chain happens to declare first lands there and is written
// at runtime. set_task read the map name out of it as its \`flags\` argument,
// whose 'd' means "fire before the map ends", and every plugin timer was silently
// deferred to map end. Declaring this before the includes puts it at address 0,
// where nothing ever writes it; __pull_natives's guard below is what keeps the
// compiler from dropping an otherwise unreferenced global.
new __amxts_null = 0;

// The stack and the heap together, in cells: see HOST_CELLS in the generator.
#pragma dynamic ${HOST_CELLS}

${includes.map(i => `#include <${i}>`).join('\n')}

native amxts_init();
native amxts_event(const name[], const types[], ...);
// Eight arguments: the arity must match n_callback in runtime/src/module.cpp,
// which reads exactly this many cells. They are in different files, so changing
// one means changing the other.
native amxts_callback(slot, argc, ${CALLBACK_PARAMS.join(', ')});
// Loads the plugins. Called from plugin_natives rather than plugin_init,
// because AMX Mod X wants a native registered before any plugin that calls it
// has been loaded - and a plugin here registers its own by running.
native amxts_natives();
// amxts_native(caller, argc) - __amxts_native below, standing in for every
// native a plugin exported. caller is the plugin that called it: the module
// reads which native it called off it, and it is where a string or an array
// argument's memory lives; the module reads the arguments with get_param.
native amxts_native(caller, argc);

public plugin_init()
{
	register_plugin("amxts Runtime Host", "0.1", "amxts");
	amxts_init();
}

// AMX Mod X asks for natives before it asks anything else, and a plugin here
// exports one by running - so this is where they are loaded. plugin_init then
// only starts them.
public plugin_natives()
{
	// Every module is optional. The host names the natives of reapi, cstrike,
	// fun and the rest, and without these two a server lacking one of them -
	// no ReHLDS, so no reapi - would refuse to load the host at all, and with
	// it every TypeScript plugin. The facade asks which modules are there
	// (module_exists) and goes around a missing one; a native from a missing
	// module that something calls anyway answers 0, said once.
	set_module_filter("amxts_module_filter");
	set_native_filter("amxts_native_filter");

	amxts_natives();
	return amxts_event("plugin_natives", "");
}

public amxts_module_filter(const library[], LibType:type)
{
	return PLUGIN_HANDLED;
}

// trap 0: the native is missing as the host loads - let it load. trap 1: it
// was called. It answers 0, and the console says so once per native rather
// than with AMX Mod X's run time error on every call - three lines a frame
// for a plugin that reads a field in its frame listener.
public amxts_native_filter(const name[], index, trap)
{
	if (!trap)
		return PLUGIN_HANDLED;

	static Trie:said;
	if (!said)
		said = TrieCreate();
	if (TrieKeyExists(said, name))
		return PLUGIN_HANDLED;

	TrieSetCell(said, name, 1);
	log_amx("[amxts] %s is not on this server: the module or plugin that provides it is not loaded. Its calls do nothing and answer 0", name);
	return PLUGIN_HANDLED;
}

// ---------------------------------------------------------------- forwards
${forwards.map(forwardStub).join('\n\n')}

// ------------------------------------------------- natives plugins export
${NATIVE_PUBLIC}

// ---------------------------------------------------------------- callback slots
${Array.from({ length: CALLBACK_SLOTS }, (_, i) => callbackSlot(i)).join('\n\n')}

// ---------------------------------------------------------------- native table
// Never executed. Its only job is to make the compiler put every native into
// the plugin's table, where the module looks them up by name. The guard reads
// __amxts_null, which is always 0, so the body never runs — and the read is
// what keeps that variable in the data segment.
public __pull_natives()
{
	if (!__amxts_null) return;

	new __i = 0;
	new Float:__f = 0.0;
	new __s[128];
	__s[0] = 0;
	new __s2d[1][1];
${arrayDecls}

${pulls}
}
`;

writeFileSync(outPath, sma);

console.log(`✅ ${outPath}`);
console.log(`   - ${includes.length} includes: ${includes.join(', ')}`);
console.log(`   - ${natives.length} natives pulled`);
console.log(`   - ${forwards.length} forwards bridged`);
console.log(`   - ${CALLBACK_SLOTS} callback slots of ${CALLBACK_ARGS} arguments`);
