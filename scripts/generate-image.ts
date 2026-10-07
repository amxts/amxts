import type { ForwardDeclaration, NativeFunction, Parameter } from '../src/types';
import type { MessageField } from './client-messages';
// Generates runtime/host/amxts_natives.sma from includes/*.inc
//
// The natives' image holds no logic. The module loads it with AMX Mod X's
// LoadAmxScript - a script, not a plugin - every map, and its native table
// is where the module resolves every native by name: AMX Mod X binds there
// what every module and every Pawn plugin gives. Its old-style library
// entries make AMX Mod X load the modules the includes name, as a plugin's
// includes do; its module filter lets it load without one.
// AMX Mod X's forwards and its modules' the module raises itself, from its
// own hooks of the functions they are raised from; this writes their table
// (runtime/src/forwards.h) and their events (as/events.ts).
// scripts/compile-image.ts compiles it into runtime/src/image.h, which the
// module carries.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IncludeParser } from '../src/parser/include-parser';
import { docsLang, docText, pick, renderDoc } from './apply-docs';
import { CLIENT_MESSAGES, MESSAGE_FIELDS, MESSAGE_GROUPS, MESSAGE_NAMES, MESSAGE_WRITES } from './client-messages';
import { EVENTS, PLAYER_CHANGE } from './docs/events';
import { ANY_MESSAGE, gameName, MESSAGES, missingField, sendFields } from './docs/messages';
import { GAME_ENUMS, memberName } from './include-enums';
import { includePath, listIncludes, parseOrder, readInclude, resolveTransitive } from './includes';

const includesDir = './includes';
const outPath = './runtime/host/amxts_natives.sma';

// The image's stack and heap, in cells (`#pragma dynamic`). The module copies
// a native's strings and arrays into this heap for the length of the call,
// each up to MAX_CROSSING_CELLS (16384) in runtime/src/module.cpp, so AMX Mod
// X's default of 4096 cells for both would not hold one long text. 512 KB.
const IMAGE_CELLS = 131072;

// The literals the module keeps as cells for a leaf native (KeptText in
// runtime/src/module.cpp, KEPT_CELLS there): an array of the image's data,
// which neither its heap nor its stack ever reaches.
const KEPT_CELLS = 16384;

// The module raises plugin_init itself, from ServerActivate, and the image
// has a plugin_natives of its own.
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
 * `__pull_natives()`. A native the server lacks does not stop the image
 * loading (its entry stays unbound), so no include needs one today; the
 * marker stays for one whose natives the image must not name at all. See
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
// Denied too: a deny marker keeps a file's natives out of the image's table, it
// does not make the file uninteresting - its forwards are still raised, and
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
// The modules the includes ask AMX Mod X for (`#pragma reqlib`, `loadlib`).
const libraries = new Set<string>();
// Forwards of the AMX Mod X distribution itself. Only these are server events:
// a forward some plugin declares (menu_core's, a project's own) is heard
// through Forward.subscribe, one way for one thing. The module raises the
// forwards AMX Mod X and its modules raise; a Pawn plugin's own reaches
// subscribe through the module, which stands in for ExecuteForward.
const stockForwards = new Set<string>();
for (const name of parseNames) {
	const text = readInclude(name);
	includeTexts.push(text);
	for (const m of text.matchAll(/^\s*#pragma\s+(?:reqlib|loadlib)\s+(\w+)/gm)) libraries.add(m[1].toLowerCase());
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
// written here with the forwards' table rather than by generate-wasm-api: a
// forward of an include absent from order.txt is absent from both.

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
	plugin_log: 'log',
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
 * Forwards no event is made of, and the module does not raise: the game's
 * events say the same (`preThink`, `postThink`, `touch`), the forward is an
 * old form of another (`client_disconnect` of `client_disconnected`), or AMX
 * Mod X calls it in one plugin about itself - paused, resumed, asked for the
 * modules it needs - and an amxts plugin is not one of its plugins.
 */
const LEFT_OUT = new Set(['client_PreThink', 'client_PostThink', 'pfn_touch', 'client_disconnect', 'plugin_pause', 'plugin_unpause', 'plugin_modules']);

// The forwards the module raises, by number: it keeps their listeners in a
// table of this order (runtime/src/forwards.h), and a registration (`on`,
// `subscribe`) names one and is looked up there once. plugin_init first, as
// the module raises it from ServerActivate.
const forwardNames = ['plugin_init', ...forwards.filter(f => !LEFT_OUT.has(f.name)).map(f => f.name)];

/**
 * One event per forward the module raises, plugin_init among them:
 * `server.addEventListener("putInServer", (event) => ...)`.
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

/** The log event's fields: the line the game logs, whole and in its arguments, as AMX Mod X splits it. */
const LOG_FIELDS: EventField[] = [
	{ name: 'text', type: 'string', decode: '__logText()', pawn: 'read_logdata' },
	{ name: 'args', type: 'string[]', decode: '__logArgs()', pawn: 'read_logargv' },
];

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
		return { name: 'player', type: 'Player', decode: `__playerOf(${cell})`, pawn };
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
		// The log's line has no argument: the module keeps it while it is told.
		if (f.name === 'plugin_log') fields.push(...LOG_FIELDS);
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
	// A field is read from the running call, or from what the object kept
	// (eventPlumbing): a number or a boolean as it is, a reference as `T | null`.
	const isValue = (f: EventField) => f.type === 'number' || f.type === 'boolean';
	const kept = (f: EventField) => `__${f.name}`;
	return [
		...classDoc,
		`export class ${e.className}${shown.length ? ' extends __ServerEvent' : ''} {`,
		...(shown.length
			? [
					...shown.map(f => `\tprivate ${kept(f)}: ${isValue(f) ? f.type : `${f.type} | null`} = ${f.type === 'boolean' ? 'false' : isValue(f) ? '0' : 'null'};`),
					``,
				]
			: []),
		...shown.flatMap((f, i) => [
			...(i > 0 ? [``] : []),
			...fieldDoc(f),
			`\tget ${f.name}(): ${f.type} {`,
			`\t\treturn this.__kept ? this.${kept(f)}${isValue(f) ? '' : '!'} : ${f.decode};`,
			`\t}`,
			``,
			`\tset ${f.name}(value: ${f.type}) {`,
			`\t\tthis.__keep();`,
			`\t\tthis.${kept(f)} = value;`,
			`\t}`,
		]),
		...(shown.length ? [``] : []),
		...(shown.length
			? [
					`\t/** @hidden Reads every field from the running call into the object, once (__ServerEvent). */`,
					`\t__keep(): void {`,
					`\t\tif (this.__kept) return;`,
					...shown.map(f => `\t\tthis.${kept(f)} = ${f.decode};`),
					`\t\tthis.__kept = true;`,
					`\t\tif (${e.short}View != this) return;`,
					`\t\t${e.short}View = null;`,
					`\t\t${e.short}Direct();`,
					`\t}`,
				]
			: []),
		`}`,
	].join('\n');
}

// The trampoline takes the forward's first cell - a player event's id - and
// hands its listeners one object of the event, made on the first call: a
// field is read from the running call's arguments when it is read (the
// module's CallArgs). An object kept - by an async function, by a listener
// that writes a field (__ServerEvent) - keeps its fields, and the next call
// makes another. One listener is called by the module itself, with the
// object, without the trampoline's walk (Direct).
function eventPlumbing(e: ServerEvent): string {
	const key = e.short;
	// An async listener of a player's event runs under that player's signal
	// (__co_ambient_player, as/promise.ts) - except when the event is the
	// player leaving, which is what aborts that signal.
	const forPlayer = e.fields.length > 0 && e.fields[0].name === 'player' && !LEAVING.has(e.forward);
	const loop = `	for (let i = 0; i < n; i++) {
		const listener = listeners.at(i);
		if (listener) listener(event);
	}`;
	const call = forPlayer
		? `	const ambient = __co_ambient_player;
	__co_ambient_player = a0;
${loop}
	__co_ambient_player = ambient;`
		: loop;
	return `const ${key}Listeners = new __Listeners<(event: ${e.className}) => void>();
let ${key}View: ${e.className} | null = null;

// @ts-ignore: decorator
@inline function ${key}Object(): ${e.className} {
	let event = ${key}View;
	if (event == null) ${key}View = event = new ${e.className}();
	return event;
}

function ${key}Trampoline(a0: i32): void {
	if (${key}Listeners.count == 0) return;
	const event = ${key}Object();
	const listeners = ${key}Listeners;
	const n = listeners.begin();
${call}
	listeners.end();
}

/** The one listener of the event is called by the module itself; with more, the trampoline walks them. */
function ${key}Direct(): void {
	const listeners = ${key}Listeners;
	if (listeners.count == 0) return;
	let listener: usize = 0;
	for (let i = 0; i < listeners.slots && listeners.count == 1; i++) {
		const one = listeners.at(i);
		if (one == null) continue;
		listener = changetype<usize>(one);
		break;
	}
	__onDirect("${e.forward}", ${key}Trampoline.index, listener, listener != 0 ? changetype<usize>(${key}Object()) : 0, ${forPlayer});
}`;
}

/** The forwards of a player leaving: their listeners do not run under the player's signal. */
const LEAVING = new Set(['client_disconnect', 'client_disconnected', 'client_remove']);

function addBranch(e: ServerEvent): string {
	const key = e.short;
	return `	if (idof<E>() == idof<${e.className}>()) {
		if (${key}Listeners.count == 0) _on("${e.forward}", ${key}Trampoline.index, 0);
		${key}Listeners.push(changetype<(event: ${e.className}) => void>(listener));
		${key}Direct();
		return;
	}`;
}

function removeBranch(e: ServerEvent): string {
	const key = e.short;
	return `	if (idof<E>() == idof<${e.className}>()) {
		if (!${key}Listeners.remove(changetype<(event: ${e.className}) => void>(listener))) return;
		if (${key}Listeners.count == 0) __off("${e.forward}", ${key}Trampoline.index);
		${key}Direct();
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

// ---------------------------------------------------------------- sending
//
// player.send(name, fields) and server.send: a name's fields are an interface
// of their own (TeamInfoFields), every field optional; __sendMessage writes
// them through the listeners' setters into a __MessageOut, then each argument
// as MESSAGE_WRITES says, through emessage_* so every listener hears it. A
// name sends the last of its messages, which carries the fields of them all
// (progressBar is BarTime2).

/** What a field left out is sent as: what its argument reads as at 0 or empty text. */
const SEND_DEFAULTS: Record<MessageField['kind'], string> = {
	number: '0',
	boolean: 'false',
	string: '""',
	texts: '[]',
	player: 'null',
	weapon: '"none"',
	team: '"UNASSIGNED"',
	teamName: '"UNASSIGNED"',
	vector: '[0, 0, 0]',
	color: '[]',
	fixed: '0',
	bit: 'false',
	fadeDirection: '"in"',
	hideHud: '[]',
	damage: '[]',
	scoreStatus: '[]',
	statusIcon: '"hide"',
	destination: '"notify"',
	vguiMenu: '"unknown"',
};

/** How each kind of argument is written: the native, and the value of argument `arg` it takes. */
const SEND_WRITERS: Record<string, (arg: number) => string> = {
	'byte': arg => `ewrite_byte(out.int(${arg}))`,
	'char': arg => `ewrite_char(out.int(${arg}))`,
	'short': arg => `ewrite_short(out.int(${arg}))`,
	'long': arg => `ewrite_long(out.int(${arg}))`,
	'coord': arg => `ewrite_coord_f(out.number(${arg}))`,
	'angle': arg => `ewrite_angle_f(out.number(${arg}))`,
	'string': arg => `ewrite_string(out.text(${arg}))`,
	'string*': arg => `for (let at = ${arg}; at <= out.count; at++) ewrite_string(out.text(at))`,
};

/** A name a plugin can send: the message it sends, the name's fields, and the message's writes in order. */
interface SendName {
	name: string;
	message: string;
	fields: NameField[];
	writes: string[];
}

function sendClass(m: SendName) {
	const words = MESSAGES[MESSAGE_GROUPS.get(m.name)![0]];
	const fields = m.fields.map((field) => {
		const accessor = MESSAGE_ACCESSORS[field.kind];
		const text = words.fields?.[field.name];
		return [
			...(text ? [`\t${renderDoc(docText(pick(text, DOCS_LANG)), '\t')}`] : []),
			`\t${field.name}?: ${accessor.takes ?? accessor.type};`,
		].join('\n');
	});
	return [renderDoc(docText(pick(sendFields(m.name, m.message), DOCS_LANG)), ''), `export interface ${m.message}Fields {`, ...fields, `}`].join('\n');
}

function sendBranch(m: SendName) {
	const sets = m.fields.map((field) => {
		const accessor = MESSAGE_ACCESSORS[field.kind];
		return `\t\t{ const value: ${accessor.takes ?? accessor.type} = fields.${field.name} ?? ${SEND_DEFAULTS[field.kind]}; ${accessor.set(field).replace(/this\./g, 'out.')}; }`;
	});
	const writes = m.writes.map((write, i) => {
		const [kind, constant] = write.split('=');
		return `\t\t${constant !== undefined ? `ewrite_${kind}(${constant})` : SEND_WRITERS[kind](i + 1)};`;
	});
	return [
		`\tif (idof<F>() == idof<${m.message}Fields>()) {`,
		`\t\tconst fields = changetype<${m.message}Fields>(given);`,
		`\t\tconst out = new __MessageOut();`,
		...sets,
		`\t\tif (!out.begin("${m.message}", dest, player, origin)) return;`,
		...writes,
		`\t\temessage_end();`,
		`\t\treturn;`,
		`\t}`,
	].join('\n');
}

const strayMessages = [...Object.keys(MESSAGE_FIELDS), ...Object.keys(MESSAGE_NAMES)].filter(name => !CLIENT_MESSAGES.includes(name));
if (strayMessages.length > 0) throw new Error(`MESSAGE_FIELDS or MESSAGE_NAMES names messages the game does not have: ${strayMessages.join(', ')}`);
const unnamed = CLIENT_MESSAGES.filter(name => !MESSAGE_NAMES[name]);
if (unnamed.length > 0) throw new Error(`messages without a name in MESSAGE_NAMES: ${unnamed.join(', ')}`);
const messageNames = [...MESSAGE_GROUPS].map(messageName);

/** The names a plugin can send, each with the last of its messages, which carries the fields of them all. */
const sendNames: SendName[] = [];
for (const m of messageNames) {
	const message = m.messages.at(-1)!;
	if (!m.fields || MESSAGE_WRITES[message] === undefined) continue;
	const writes = MESSAGE_WRITES[message].split(' ').filter(Boolean);
	const own = MESSAGE_FIELDS[message];
	if (own.length < m.fields.length) throw new Error(`${m.name}: ${message} does not carry every field of the name, so send cannot send it`);
	// Every argument is a field's, or a constant: what an author gives is the whole message.
	const covered = new Set(own.flatMap(f => f.kind === 'vector' ? [f.arg, f.arg + 1, f.arg + 2] : f.kind === 'color' ? Array.from({ length: f.of! }, (_, i) => f.arg + i) : [f.arg]));
	const loose = writes.map((write, i) => (covered.has(i + 1) || write.includes('=') ? 0 : i + 1)).filter(Boolean);
	if (loose.length > 0) throw new Error(`MESSAGE_WRITES: no field of ${message} names its argument ${loose.join(', ')}`);
	sendNames.push({ name: m.name, message, fields: m.fields, writes });
}
const unsendable = Object.keys(MESSAGE_WRITES).filter(message => !sendNames.some(m => m.message === message) && MESSAGE_GROUPS.get(MESSAGE_NAMES[message])?.at(-1) === message);
if (unsendable.length > 0) throw new Error(`MESSAGE_WRITES has messages send cannot send: ${unsendable.join(', ')}`);
const wordless = messageNames.map(m => m.messages[0]).filter(message => !MESSAGES[message]);
if (wordless.length > 0) throw new Error(`messages without words in scripts/docs/messages.ts: ${wordless.join(', ')}`);

writeFileSync('./as/events.ts', `// GENERATED by scripts/generate-image.ts — do not edit
// Source: includes/*.inc, the forwards the module raises
//
// The events a server raises, one per forward the module raises:
//
//   server.addEventListener("putInServer", (event) => print(event.player, "Welcome!"));
//
// ServerEventMap is what an editor reads - the event's name to its type, as
// the DOM's HTMLElementEventMap - and the compiler reads the same map through
// a patch (runtime/patches: \`K extends keyof M\` and \`M[K]\`), so an untyped
// \`(event) => ...\` gets the event's type. Underneath, each event keeps its
// listeners in an array and listens to its forward while the array has any.
import { Client, ClientMessage, FadeDirection, Player, PlayerChangeEvent, __MessageOut, StatusIconState, Team, VariantName, __Listeners, __ServerEvent, __forwardNumbers, __logArgs, __logText, __nativeCell, __nativeString, __nativeVector, __off, __onDirect, __playerOf } from "./facade";
import { Vector } from "./vector";
import { WeaponKind, weaponKindOf } from "./entities";
import { DAMAGE, Damage, HIDE_HUD, HideHud, SCORE_STATUS, ScoreStatus } from "./flags";
import { VguiMenu } from "./hooks";
import { emessage_end, ewrite_angle_f, ewrite_byte, ewrite_char, ewrite_coord_f, ewrite_long, ewrite_short, ewrite_string } from "./natives";

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

${sendNames.map(sendClass).join('\n\n')}

/** Every message a plugin can send, by the name player.send and server.send take. */
export interface ServerSendMap {
${sendNames.map(m => `\t${renderDoc(messageSummary(messageNames.find(n => n.name === m.name)!), '\t')}\n\t${m.name}: ${m.message}Fields;`).join('\n')}
}

/** Sends a message of the fields F - player.send's and server.send's hood. */
export function __sendMessage<F>(given: F, dest: i32, player: i32, origin: Vector | null): void {
${sendNames.map(sendBranch).join('\n')}
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

const libraryNames = [...libraries].sort();

const sma = `// GENERATED by scripts/generate-image.ts — do not edit
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

// The room for the literals the module keeps as cells (KeptText), found by
// its public name.
public __amxts_kept[${KEPT_CELLS}];

// The stack and the heap together, in cells: see IMAGE_CELLS in the generator.
#pragma dynamic ${IMAGE_CELLS}

${includes.map(i => `#include <${i}>`).join('\n')}

// One old-style library entry a module the includes name: AMX Mod X loads a
// module such an entry names as it loads the image, as it loads one a
// plugin's include names. The natives are never bound or called.
${libraryNames.map(name => `#pragma library ${name}\nnative __amxts_library_${name}();`).join('\n')}

// AMX Mod X runs it as it loads the image, before it checks the modules.
public plugin_natives()
{
	// Every module is optional. The image names the natives of reapi, cstrike,
	// fun and the rest, and without this a server lacking one of them - no
	// ReHLDS, so no reapi - would refuse to load it at all, and with it every
	// TypeScript plugin's native. The facade asks which modules are there
	// (module_exists) and goes around a missing one; a native from a missing
	// module that something calls anyway answers 0, said once.
	set_module_filter("amxts_module_filter");
	return PLUGIN_CONTINUE;
}

public amxts_module_filter(const library[], LibType:type)
{
	return PLUGIN_HANDLED;
}

// ---------------------------------------------------------------- native table
// Never executed. Its only job is to make the compiler put every native into
// the image's table, where the module looks them up by name. The guard reads
// __amxts_null, which is always 0, so the body never runs — and the read is
// what keeps that variable in the data segment.
public __pull_natives()
{
	if (!__amxts_null) return;
	__amxts_kept[0] = 0;

	new __i = 0;
	new Float:__f = 0.0;
	new __s[128];
	__s[0] = 0;
	new __s2d[1][1];
${arrayDecls}

${pulls}
${libraryNames.map(name => `\t__amxts_library_${name}();`).join('\n')}
}
`;

writeFileSync(outPath, sma);

writeFileSync('./runtime/src/forwards.h', `// GENERATED by scripts/generate-image.ts - do not edit
// Source: includes/*.inc
//
// The forwards of AMX Mod X and its modules the module raises itself, from
// its own hooks, by number: its table of their listeners has this order.

#define FORWARD_COUNT ${forwardNames.length}

static const char *const g_forwardNames[FORWARD_COUNT] = {
${forwardNames.map(name => `\t"${name}",`).join('\n')}
};

${forwardNames.map((name, i) => `#define FORWARD_${name.toUpperCase()} ${i}`).join('\n')}
`);

console.log(`✅ ${outPath}, runtime/src/forwards.h`);
console.log(`   - ${includes.length} includes: ${includes.join(', ')}`);
console.log(`   - ${natives.length} natives pulled`);
console.log(`   - ${forwardNames.length} forwards the module raises`);
console.log(`   - ${libraryNames.length} modules asked for: ${libraryNames.join(', ')}`);
