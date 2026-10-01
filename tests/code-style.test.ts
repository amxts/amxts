import type { DocSource, DocText, Lang } from '../scripts/apply-docs';
import type { Renames } from '../scripts/upgrade';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
// The code-style rules, checked.
//
// Plugin code is written as familiar TypeScript. The rules that are
// mechanical are checked here rather than remembered - a rule nobody enforces
// is a rule that drifts - and every finding carries the rule's number.
// Some are judgements: for nesting (5) the check below only catches the shape
// that is plainly past it.
//
// The facade and the generated files are where AssemblyScript is meant to
// live, and they are not scanned.
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import ts from 'typescript';
import { coreSources, dedent, docsLang, elements, FILTER, LANGS, loadTable, moduleSources, pick } from '../scripts/apply-docs';
import { ENTITY_FIELDS } from '../scripts/docs/entities';
import { EVENTS, PLAYER_CHANGE } from '../scripts/docs/events';
import { GAME } from '../scripts/docs/game';
import { MESSAGES } from '../scripts/docs/messages';
import { CORE_DIR, loadProject } from '../scripts/project';
import { renamed, renamesFor, specifiers } from '../scripts/upgrade';

const ROOT = 'as';
// The modules the project uses (amxts.config.ts - the official ones, from
// their repositories beside this one): their src/ is plugin code like as/.
const MODULES = loadProject().modules.map(pkg => join(pkg.dir, 'src'));
const MODULE_WRAPPERS = new Set(['as/modules/http.ts']);
const EXEMPT = new Set(['facade.ts', 'kit.ts', 'fs.ts', 'os.ts', 'promise.ts', 'promise.types.d.ts', 'amxts.d.ts', 'natives.ts', 'remote.ts', 'constants.ts', 'events.ts', 'flags.ts', 'entities.ts', 'hooks.ts', 'vector.ts', 'effects.ts']);

/**
 * Natives the facade has its own way of doing, and that way. It grows with
 * the facade: a new replacement there is a new line here.
 */
/** User messages player.screen sends, and the method that sends each. */
const SCREEN_MESSAGES: Record<string, string> = {
	ScreenFade: 'fade',
	ScreenShake: 'shake',
	StatusIcon: 'statusIcon',
	RoundTime: 'roundTime',
	HideWeapon: 'hideHud',
	Crosshair: 'crosshair',
	Flashlight: 'flashlight',
	BarTime: 'progressBar',
};

/** The temporary effects `effects` sends, by the TE_ constant each one is. */
const TE_EFFECTS: Record<string, string> = {
	BEAMPOINTS: 'beamPoints',
	BEAMENTPOINT: 'beamEntityPoint',
	BEAMENTS: 'beamEntities',
	BEAMRING: 'beamRing',
	BEAMCYLINDER: 'beamCylinder',
	BEAMDISK: 'beamDisk',
	BEAMTORUS: 'beamTorus',
	BEAMFOLLOW: 'beamFollow',
	BEAMSPRITE: 'beamSprite',
	LIGHTNING: 'lightning',
	KILLBEAM: 'killBeams',
	EXPLOSION: 'explosion',
	TAREXPLOSION: 'tarExplosion',
	EXPLOSION2: 'particleExplosion',
	SMOKE: 'smoke',
	IMPLOSION: 'implosion',
	GUNSHOT: 'gunshot',
	SPARKS: 'sparks',
	ARMOR_RICOCHET: 'armorRicochet',
	LAVASPLASH: 'lavaSplash',
	TELEPORT: 'teleport',
	TRACER: 'tracer',
	SHOWLINE: 'showLine',
	STREAK_SPLASH: 'streakSplash',
	SPRITE: 'sprite',
	GLOWSPRITE: 'glowSprite',
	SPRITETRAIL: 'spriteTrail',
	SPRITE_SPRAY: 'spriteSpray',
	LARGEFUNNEL: 'largeFunnel',
	FIZZ: 'fizz',
	BUBBLES: 'bubbles',
	BUBBLETRAIL: 'bubbleTrail',
	DLIGHT: 'dynamicLight',
	ELIGHT: 'entityLight',
	LINE: 'line',
	BOX: 'box',
	BLOOD: 'blood',
	BLOODSTREAM: 'bloodStream',
	BLOODSPRITE: 'bloodSprite',
	MODEL: 'model',
	EXPLODEMODEL: 'explodeModel',
	BREAKMODEL: 'breakModel',
	PROJECTILE: 'projectile',
	SPRAY: 'spray',
	PLAYERSPRITES: 'playerSprites',
	PARTICLEBURST: 'particleBurst',
	FIREFIELD: 'fireField',
	PLAYERATTACHMENT: 'playerAttachment',
	KILLPLAYERATTACHMENTS: 'killPlayerAttachments',
};

const FACADE_EQUIVALENTS: Record<string, string> = {
	hook: 'game.addEventListener',
	get_user_health: 'player.health',
	set_user_health: 'player.health',
	get_user_armor: 'player.armor',
	set_user_armor: 'player.armor',
	get_user_frags: 'player.frags',
	set_user_frags: 'player.frags',
	get_user_deaths: 'player.deaths',
	get_user_authid: 'player.authid',
	get_user_ip: 'player.ip',
	is_user_bot: 'player.isBot',
	rg_set_user_team: 'player.team = ...',
	rg_join_team: 'player.joinTeam',
	precache_model: 'server.precache',
	precache_sound: 'server.precache',
	precache_generic: 'server.precache',
	emit_sound: 'entity.emitSound',
	rh_emit_sound2: 'entity.emitSound',
	rg_send_audio: 'player.playSound',
	entity_set_model: 'entity.model = ...',
	entity_set_size: 'entity.setSize',
	query_client_cvar: 'await player.queryCvar(name)',
	get_member_game: 'game.<field> (game.freezePeriod, game.numCtWins)',
	set_member_game: 'game.<field> = ...',
	rg_update_teamscores: 'game.numCtWins = ..., game.numTerroristWins = ...',
	rg_set_observer_mode: 'player.observerMode = ...',
	get_weaponname: 'weapon.classname',
	get_time: 'new Date() and its getters: getHours(), getDate(), ...',
	rg_find_weapon_bpack_by_name: 'player.items.find(item => item.classname == name)',
	register_touch: 'game.addEventListener("touch", listener, { toucher, touched })',
	RegisterHam: 'game.addEventListener(event, listener, { classname })',
	register_message: 'server.addEventListener("message:<Name>", listener)',
	get_msg_arg_int: 'event.<field>, event.args.number(i)',
	get_msg_arg_float: 'event.<field>, event.args.number(i)',
	get_msg_arg_string: 'event.<field>, event.args.text(i)',
	set_msg_arg_int: 'event.<field> = ..., event.args.setNumber(i, value)',
	set_msg_arg_float: 'event.<field> = ..., event.args.setNumber(i, value)',
	set_msg_arg_string: 'event.<field> = ..., event.args.setText(i, text)',
	resemiclip_take_control: 'semiclip.rule = (player, target) => ... of @amxts/resemiclip',
	resemiclip_set_user_mask: 'semiclip.rule = (player, target) => ... of @amxts/resemiclip',
	resemiclip_get_user_mask: 'semiclip.passesThrough(player) of @amxts/resemiclip',
	ExecuteHamB: 'the entity\'s method: weapon.deploy(), entity.use(...)',
	ExecuteHam: 'the entity\'s method with { hooks: false }',
	SetHamReturnInteger: 'return the answer from the listener',
	SetHamParamInteger: 'event.<field> = ...',
	SetHamParamFloat: 'event.<field> = ...',
	rg_give_item: 'player.give',
	rg_remove_all_items: 'player.removeAllItems',
	rg_set_user_bpammo: 'player.setAmmo',
	rg_get_user_bpammo: 'player.getAmmo',
	rg_round_respawn: 'player.respawn',
	user_kill: 'player.kill',
	rg_switch_weapon: 'player.switchWeapon',
	rg_reset_maxspeed: 'player.resetMaxSpeed',
	rg_round_end: 'game.endRound',
	client_cmd: 'player.command',
	server_cmd: 'server.command',
	// cmd, set_hudmessage, show_hudmessage, create_cvar and get/set_pcvar_* join
	// these once no plugin calls them where server.addCommand, showHud and Cvar do.
	register_clcmd: 'server.addCommand',
	register_srvcmd: 'server.addServerCommand',
	register_cvar: 'new Cvar(name, default)',
	get_cvar_pointer: 'new Cvar(name)',
	set_pcvar_float: 'cvar.number',
	hook_cvar_change: 'cvar.addEventListener("change", ...)',
	log_amx: 'console.log / console.error',
	get_gametime: 'game.time',
	register_dictionary: 'lang.load',
	LookupLangKey: 'lang.translate',
	rg_send_bartime: 'player.screen.progressBar',
	is_entity: 'entity.exists',
	is_valid_ent: 'entity.exists',
	set_speak: 'player.muted, heardByEveryone, hearsEveryone',
	get_speak: 'player.muted, heardByEveryone, hearsEveryone',
};

/** The `(`, `[` or `{` that `at` is inside of, nearest first; "" at the top. */
export function innermostBracket(code: string, at: number): string {
	let depth = 0;
	for (let i = at - 1; i >= 0; i--) {
		const c = code[i];
		if (c === ')' || c === ']' || c === '}') {
			depth++;
		} else if (c === '(' || c === '[' || c === '{') {
			if (depth === 0) return c;
			depth--;
		}
	}
	return '';
}

function pluginFiles(dir: string = ROOT): string[] {
	const found: string[] = [];

	for (const name of readdirSync(dir)) {
		const path = join(dir, name);

		// A wrapper over a third-party module's natives is hood, like the facade;
		// anything else in as/modules is ordinary TypeScript and is read as such.
		if (MODULE_WRAPPERS.has(path.replace(/\\/g, '/'))) continue;

		if (statSync(path).isDirectory()) found.push(...pluginFiles(path));
		else if (name.endsWith('.ts') && !(dir === ROOT && EXEMPT.has(name))) found.push(path);
	}

	return found;
}

/**
 * The source with comments and string contents blanked out, lines kept.
 *
 * A comment that explains why `<i32>parseInt` is a landmine is not a use of
 * it, and a string is text rather than code. Both are replaced with spaces so
 * that every line number still points where it did.
 */
function codeOnly(source: string): string {
	let out = '';
	let i = 0;

	while (i < source.length) {
		const c = source[i];
		const next = source[i + 1];

		if (c === '/' && next === '/') {
			while (i < source.length && source[i] !== '\n') {
				out += ' ';
				i++;
			}
			continue;
		}

		if (c === '/' && next === '*') {
			while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
				out += source[i] === '\n' ? '\n' : ' ';
				i++;
			}
			out += '  ';
			i += 2;
			continue;
		}

		if (c === '"' || c === '\'' || c === '`') {
			out += c;
			i++;
			while (i < source.length && source[i] !== c) {
				if (source[i] === '\\') {
					out += '  ';
					i += 2;
					continue;
				}
				out += source[i] === '\n' ? '\n' : ' ';
				i++;
			}
			out += c;
			i++;
			continue;
		}

		out += c;
		i++;
	}

	return out;
}

interface Finding {
	where: string;
	rule: string;
}

function lineOf(text: string, index: number): number {
	return text.slice(0, index).split('\n').length;
}

function scan(file: string): Finding[] {
	const source = readFileSync(file, 'utf8');
	const code = codeOnly(source);
	const found: Finding[] = [];
	const at = (index: number, rule: string) => found.push({ where: `${file}:${lineOf(code, index)}`, rule });

	// 1. No AssemblyScript vocabulary. A number is JavaScript's number - whole
	// or not - so no integer type, no f64 and no `float` either: every number
	// is `number`, and the hood turns it into a cell where Pawn wants one.
	for (const m of code.matchAll(/\b(i8|i16|i32|i64|u8|u16|u32|u64|isize|usize|bool|f32|f64|float)\b/g)) {
		// A name, not a type: config.bool("X"), function bool(id).
		if (code[m.index! - 1] === '.' || /^\s*\(/.test(code.slice(m.index! + m[0].length))) continue;
		at(m.index!, `1: ${m[1]} - write ${m[1] === 'bool' ? 'boolean' : 'number'}`);
	}
	// load and store only with a type argument: that is AssemblyScript's raw
	// memory access, and a plugin's own `load()` is just a function name - as
	// are a module's `configs.load<Settings>(...)` and a declared `function load<T>`.
	for (const m of code.matchAll(/(?<![.\w])(?<!function\s)(?:(reinterpret|changetype|unchecked)\s*[<(]|(load|store)\s*<)/g)) {
		m[1] = m[1] ?? m[2];
		at(m.index!, `1: ${m[1]} - use the facade (floatCell, cellFloat, rounded, CellBuffer)`);
	}
	for (const m of code.matchAll(/\bStaticArray\b/g)) {
		at(m.index!, '1: StaticArray - use an array, or CellBuffer for a native');
	}
	for (const m of code.matchAll(/(?<![\w$\]])<(f64|number)>\s*[\w(]/g)) {
		at(m.index!, `1: <${m[1]}> cast - use rounded() or a float literal`);
	}

	// 13. A native speaks TypeScript: no Pawn tag, no Pawn container.
	for (const m of code.matchAll(/\bCellArray\b|:\s*Float\b(?:\[\])?/g)) {
		at(m.index!, `13: ${m[0].replace(/\s+/g, ' ')} - a Pawn type; the native's .inc says what Pawn gets`);
	}

	// 10. A record is an interface: a class with fields and nothing else is one.
	for (const m of code.matchAll(/\bclass\s+([\w$]+)(?![\w$])[^{]*\{/g)) {
		let depth = 1;
		let i = m.index! + m[0].length;
		const start = i;
		for (; i < code.length && depth > 0; i++) {
			if (code[i] === '{') depth++;
			else if (code[i] === '}') depth--;
		}
		let body = code.slice(start, i - 1);
		// A constructor that only hands its parameters to fields adds nothing.
		body = body.replace(/^\s*constructor\s*\(([^)]*)\)\s*\{((?:\s*(?:super\([^)]*\)|this\.[\w$]+\s*=\s*[\w$]+);)*)\s*\}/m, (whole, params: string) => (/\b(?:public|private|protected|readonly)\s/.test(params) ? whole : ''));
		// A method, constructor or accessor is a `name(` at the start of a member line.
		const behaves = /^\s*(?:(?:private|public|protected|static|readonly|async|get|set)\s+)*[\w$]+\s*(?:<[^>]*>\s*)?\(/m.test(body);
		if (!behaves && body.trim().length > 0) at(m.index!, `10: class ${m[1]} has only fields - make it an interface`);
	}

	// 10. Options are an interface with optional fields: one left out is
	// undefined, and its default comes with `??` - not `options.x!` off a class.
	for (const m of code.matchAll(/\b(\w*[oO]ptions)\.(\w+)!(?!=)/g)) {
		at(m.index!, `10: ${m[1]}.${m[2]}! - an option left out is undefined: ${m[1]}.${m[2]} ?? its default`);
	}

	// 15. No Pawn emulated: cell limits, float32, UTF-8 byte counts.
	for (const m of code.matchAll(/\b2147483647\b|\b2147483648\b|\bMath\.fround\b|\bString\.UTF8\b/g)) {
		at(m.index!, `15: ${m[0]} - a Pawn limit; the hood converts at the boundary`);
	}

	// 15. `return true` from a function that cannot fail is Pawn's habit of
	// answering 1: a function whose every return is `return true` returns nothing.
	for (const m of code.matchAll(/^(?:export\s+)?function\s+([\w$]+)\s*\([^)]*\)\s*\{/gm)) {
		let depth = 1;
		let i = m.index! + m[0].length;
		for (; i < code.length && depth > 0; i++) {
			if (code[i] === '{') depth++;
			else if (code[i] === '}') depth--;
		}
		const returns = [...code.slice(m.index! + m[0].length, i - 1).matchAll(/\breturn\b([^;\n]*)/g)].map(r => r[1].trim());
		if (returns.length > 0 && returns.every(value => value === 'true')) {
			at(m.index!, `15: ${m[1]} always returns true - return nothing`);
		}
	}

	// 16. What other plugins read about a player is a field on Player: not a
	// pair of get/set natives per flag, and not bits. A native an include
	// contract declares (plugin({ include })) stays, for the Pawn modules
	// compiled against it - a get_user_bit native is an adapter over the fields.
	if (!/\binclude\s*:/.test(code)) {
		for (const m of code.matchAll(/^export\s+function\s+(\w+_(?:get|set)_(?:user|player)_\w+)\s*\(/gm)) {
			at(m.index!, `16: ${m[1]} - a player's state other plugins read is a field on Player: player.ghost`);
		}
	}
	for (const m of code.matchAll(/\b\w*(?:[pP]layer|bot|victim|attacker)\.data\b|\binterface\s+PlayerData\b/g)) {
		at(m.index!, `16: ${m[0]} - the fields are Player's own: declare module "@amxts/core" { interface Player { ghost: boolean } }, then player.ghost`);
	}
	for (const m of code.matchAll(/\bplayer\s*\[\s*["'`]/g)) {
		at(m.index!, '16: player[...] - a field on Player is read by its name: player.ghost');
	}

	// 17. An object built with `new` - a player, a cvar - goes into a
	// variable first and is used from there: not built inside a call, an
	// array or a chain (`new Cvar("mp_limitteams").number = 0`).
	for (const m of code.matchAll(/\bnew (Player|Cvar)\(/g)) {
		let depth = 0;
		let end = m.index! + m[0].length - 1;
		for (; end < code.length; end++) {
			if (code[end] === '(') depth++;
			if (code[end] === ')' && --depth === 0) break;
		}
		const inside = /[(,[]$/.test(code.slice(0, m.index!).trimEnd());
		const chained = code.slice(end + 1).trimStart().startsWith('.');
		const first = m[1] === 'Player' ? 'const player = new Player(id);' : 'const limitTeams = new Cvar("mp_limitteams");';
		if (inside || chained) at(m.index!, `17: new ${m[1]}(...) used in place - ${first} first`);
	}

	// 18. A fallback for a value that may be null is `??`, not a ternary
	// that names the value twice.
	for (const m of code.matchAll(/\b([\w$.]+)\s*!==?\s*null\s*\?\s*([\w$.]+)\s*(?:!\s*)?:/g)) {
		if (m[1] === m[2]) at(m.index!, `18: ${m[1]} != null ? ${m[1]} : ... - write ${m[1]} ?? ...`);
	}

	// 19. A function goes in as itself, not wrapped in an arrow that hands it
	// its first arguments. Only a name without a dot: `(x) => list.push(x)`
	// calls a method, which is not a value.
	for (const m of code.matchAll(/\((\w+)(?:\s*,\s*\w+)*\)\s*=>\s*(\w+)\(\1\)(?=\s*[,;)])/g)) {
		if (code[m.index! + m[0].indexOf(m[2]) - 1] === '.') continue;
		at(m.index!, `19: (${m[1]}) => ${m[2]}(${m[1]}) - pass ${m[2]} itself`);
	}
	for (const m of code.matchAll(/\(\w+(?:\s*,\s*\w+)*\)\s*=>\s*(\w+)\(\)(?=\s*[,;)])/g)) {
		if (code[m.index! + m[0].lastIndexOf(m[1]) - 1] === '.') continue;
		at(m.index!, `19: (...) => ${m[1]}() - pass ${m[1]} itself`);
	}

	// 20. Parameters as TypeScript writes them: an optional one is `x?: T`,
	// one with a default has no type beside it - the default says it.
	const parameter = String.raw`[(,]\s*(?:(?:public|private|protected|readonly)\s+)*(\w+)`;
	for (const m of code.matchAll(new RegExp(`${parameter}\\s*:\\s*(number|string|boolean)\\s*=(?!=)`, 'g'))) {
		at(m.index!, `20: ${m[1]}: ${m[2]} = ... - the default says the type: ${m[1]} = ...`);
	}
	for (const m of code.matchAll(new RegExp(`${parameter}\\s*:\\s*([\\w.]+)\\s*\\|\\s*null\\s*=\\s*null\\b`, 'g'))) {
		at(m.index!, `20: ${m[1]}: ${m[2]} | null = null - write ${m[1]}?: ${m[2]}`);
	}
	for (const m of code.matchAll(new RegExp(`${parameter}\\s*=\\s*""`, 'g'))) {
		// `{ label = "" }: Options` destructures: the default is what it should be.
		if (innermostBracket(code, m.index! + 1) === '{') continue;
		at(m.index!, `20: ${m[1]} = "" - an optional string is ${m[1]}?: string`);
	}

	// 14. Text is taken apart with string methods, not character codes.
	for (const m of code.matchAll(/\.charCodeAt\s*\(/g)) {
		at(m.index!, '14: charCodeAt - use trim, split, startsWith, indexOf');
	}

	// 12. One element is `find`, not the first of a filter.
	for (const m of code.matchAll(/\.filter\((?:[^()]|\([^()]*\))*\)\s*\[0\]/g)) {
		at(m.index!, '12: filter(...)[0] - use find');
	}

	// 2. No `: void` on a function. The patch that makes a missing return type
	// void covers methods too; rule 3's return-type check catches those.
	for (const m of code.matchAll(/\bfunction\s+[\w$]+\s*(?:<[^>]*>\s*)?\(/g)) {
		let depth = 0;
		let i = m.index! + m[0].length - 1;

		for (; i < code.length; i++) {
			if (code[i] === '(') depth++;
			else if (code[i] === ')' && --depth === 0) break;
		}

		if (/^\s*:\s*void\b/.test(code.slice(i + 1))) at(i, '2: : void on a function');
	}

	// 3. No type on a variable whose value already says it.
	const typedLiteral = /\b(?:let|const)\s+[\w$]+\s*:\s*(?:number|boolean|string|f64)\s*=\s*(?:-?\d|true\b|false\b|["'`])/g;
	for (const m of code.matchAll(typedLiteral)) at(m.index!, '3: type written on a literal');

	// A field the same way: `count = 0`, `parts = new Map<string, number>()`.
	// The patch reads a field's type off a literal or a `new`, as it does a
	// variable's.
	// A non-empty array literal says its type too: `open = [false, false]`.
	const typedField = /^\s*(?:(?:private|public|protected|readonly|static)\s+)*[\w$]+\??\s*:\s*(?:[^\s(;=][^=;(\n]*|[\t\v\f\r \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF])=\s*(?:-?\d|true\b|false\b|["'`]|new\b|\[\s*(?:-?\d|true\b|false\b|["'`]))[^\n]*;[ \t]*$/gm;
	for (const m of code.matchAll(typedField)) {
		if (!/^\s*(?:let|const|var|export|return)\b/.test(m[0])) at(m.index!, '3: type written on a field whose value says it');
	}

	// A return type is read off the body - a local it returns, `T | null` from
	// `return found` beside `return null` - so none is written. A `get x():
	// T` is the same.
	for (const m of code.matchAll(/^[ \t]*(?:export\s+)?(?:(?:private|public|protected|static|async)\s+)*(?:function\s+|get\s+)?([\w$]+)\s*(?:<[^>()]*>\s*)?\(/gm)) {
		if (/^(?:if|for|while|switch|catch|return|new|do|else)$/.test(m[1])) continue;

		let depth = 0;
		let i = m.index! + m[0].length - 1;
		for (; i < code.length; i++) {
			if (code[i] === '(') depth++;
			else if (code[i] === ')' && --depth === 0) break;
		}

		const written = code.slice(i + 1).match(/^\s*:([^{;=]+)\{/)?.[1].trim();
		if (written && !/^void\b/.test(written) && !written.includes('=>')) {
			at(i, `3: return type ${written} written - it is inferred`);
		}
	}

	// 4. Arrays are `[]`: `const ids: number[] = []` when empty, a literal
	// otherwise; what a plugin keeps about a player is a record per player.
	for (const m of code.matchAll(/\bnew\s+Array\b/g)) {
		at(m.index!, '4: new Array - write []');
	}

	// The cell level is the hood's too. A plugin calls a native or a facade
	// function with numbers and strings; laying out cells, addresses and
	// dispatcher ids is what the facade and the generated wrappers are for.
	for (const m of code.matchAll(/\bnew\s+Call\s*\(|\bNATIVE_\w+|\b(?:floatCell|cellFloat|cells|cell|out|text)\s*\(/g)) {
		// `.text(` on a buffer is a method; only the bare helpers count.
		if (code[m.index! - 1] === '.') continue;
		at(m.index!, `1: ${m[0].replace(/\s*\($/, '')} - hood only; call the native or the facade`);
	}

	// 6. No Pawn-internal constants. What a forward's arguments are, how a
	// handler's result is treated, which type a hookchain value has - a plugin
	// says that in TypeScript words, and the facade picks the constant. A wrong
	// one is invisible: FP_STRING declared as 1 made a string forward a float.
	for (const m of code.matchAll(/\b(?:FP|ET|ATYPE)_[A-Z]+\b/g)) {
		at(m.index!, `6: ${m[0]} - Pawn-internal; the facade takes a type word or a default`);
	}

	// 11. No decorative dividers: a comment says why, the file's shape is its
	// functions. Checked on the source, since codeOnly() blanks comments.
	for (const m of source.matchAll(/^[ \t]*\/\/\s*[-=*#]{8,}/gm)) {
		at(m.index!, '11: a divider comment - name the functions instead');
	}

	// 8. A screen message the facade sends: player.screen.fade(...), not
	// message_begin(MSG_ONE, get_user_msgid("ScreenFade"), ...). codeOnly keeps
	// positions, so the name is read from the source at the same place.
	for (const m of code.matchAll(/\bget_user_msgid\s*\(/g)) {
		const name = source.slice(m.index! + m[0].length).match(/^\s*"(\w+)"/)?.[1];
		if (name && Object.hasOwn(SCREEN_MESSAGES, name)) at(m.index!, `8: the ${name} message by hand - the facade has player.screen.${SCREEN_MESSAGES[name]}`);
	}

	// 8. A temporary effect by hand: effects.beamCylinder({ ... }), not
	// message_begin(..., SVC_TEMPENTITY) and write_byte(TE_BEAMCYLINDER).
	for (const m of code.matchAll(/TE_([A-Z0-9_]+)/g)) {
		const effect = TE_EFFECTS[m[1]];
		if (effect) at(m.index!, `8: TE_${m[1]} by hand - the facade has effects.${effect}`);
	}

	// 8. A native the facade already covers is written the facade's way, so one
	// thing is not done in two styles. Natives it does not cover stay allowed.
	for (const m of code.matchAll(/\b([a-z_]\w*)\s*\(/gi)) {
		// Own keys only: `constructor(` would otherwise find Object's own constructor.
		const instead = Object.hasOwn(FACADE_EQUIVALENTS, m[1]) ? FACADE_EQUIVALENTS[m[1]] : undefined;
		if (instead && code[m.index! - 1] !== '.') at(m.index!, `8: ${m[1]}() - the facade has ${instead}`);
	}

	// 7. Flags are a typed array. Setting, clearing and testing a bit against a
	// constant is C's vocabulary; `player.hideHud.push(HideHud.Money)` is ours.
	// `&&` is not a mask: `ok && FOREIGN_ENDINGS.includes(x)`.
	for (const m of code.matchAll(/\|=|&=\s*~|(?<!&)&\s*(?:~\s*)?\(?[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)) {
		at(m.index!, `7: ${m[0].replace(/\s+/g, ' ')} - a bit mask; use a typed flag array`);
	}

	// 32. A field that holds one of the engine's numbers takes a name:
	// `box.renderMode = "additive"`, not `= kRenderTransAdd`. A constant passed
	// to a native (rg_set_observer_mode(id, OBS_IN_EYE)) is not a field.
	for (const m of code.matchAll(/\.\w+\s*(?:[!=]==?|=)\s*(kRender\w+|(?:MOVETYPE|SOLID|DEAD|OBS|HITGROUP|ARMOR|CONTENTS|BLOOD_COLOR|IGNOREMSG|CS_THROW|MODEL)_[A-Z0-9_]+|DONT_BLEED|DAMAGE_(?:NO|YES|AIM)|Menu_\w+)\b/g)) {
		at(m.index!, `32: ${m[1]} - the field takes a name ("additive", "noclip", "alive")`);
	}

	// 33. A config of a known shape is a typed object - configs.load(name,
	// defaults) - not a path in a string and a type in a method's name. The
	// tree's getters without a path (`value.getString()`) read a file of an
	// unknown shape, and stay.
	for (const m of code.matchAll(/\.(getString|getNumber|getBoolean|getStrings)\(\s*["'`]/g)) {
		at(m.index!, `33: ${m[1]}("path") - read the config into an object: configs.load(name, defaults)`);
	}

	// 5. Flat rather than a ladder: an if three deep, or an else after a
	// branch that has already returned.
	const lines = code.split('\n');
	const ifDepths: number[] = [];
	let braces = 0;

	lines.forEach((line, n) => {
		// A branch opens a level: `if (...) {`, `else if (...) {` and a bare
		// `else {` alike, since an if inside an else is nested all the same.
		const opensIf = /\bif\s*\(.*\)\s*\{\s*$/.test(line);
		const opensBranch = opensIf || /\belse\s*\{\s*$/.test(line);
		const closes = (line.match(/\}/g) || []).length;
		const opens = (line.match(/\{/g) || []).length;

		for (let k = 0; k < closes; k++) {
			braces--;
			while (ifDepths.length && ifDepths[ifDepths.length - 1] > braces) ifDepths.pop();
		}

		if (opensBranch) {
			ifDepths.push(braces + 1);
			if (opensIf && ifDepths.length >= 3) {
				found.push({ where: `${file}:${n + 1}`, rule: '5: if nested three deep' });
			}
		}

		braces += opens;

		if (/^\s*\}\s*else\b/.test(line)) {
			const before = lines.slice(Math.max(0, n - 3), n).join('\n');
			if (/\breturn\b[^;]*;\s*$/.test(before.trimEnd())) {
				found.push({ where: `${file}:${n + 1}`, rule: '5: else after a return' });
			}
		}
	});

	// 27. A colour is a tag (`!y`), not the game's code behind an escape
	// (`\\y`): the facade's showMenu turns the tags into codes. The codes live
	// in strings, which `code` has blanked, so the source itself is read.
	for (const m of source.matchAll(/\\\\[yrwdR]/g)) {
		at(m.index!, `27: ${m[0]} - a colour code; write the tag !${m[0].slice(-1)}`);
	}
	// A tag is one colour everywhere, but not every place has every tag: a
	// tag the place lacks is dropped, so writing it is a mistake.
	for (const f of misplacedColourTags(source)) at(f.index, f.rule);

	// 22. A union's value is the literal itself: no constant per value.
	for (const m of code.matchAll(/^(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*:\s*[A-Z]\w*\s*=\s*"[^"]*"\s*;/gm)) {
		at(m.index!, `22: ${m[1]} - a constant for a union's value; write the literal`);
	}

	// 21. An if block stands apart: a blank line before it and after it,
	// unless it opens or closes the block it is in.
	for (const gap of ifBlockGaps(lines)) {
		found.push({ where: `${file}:${gap.line + 1}`, rule: `21: no blank line ${gap.side} the if block` });
	}

	return found;
}

/** Calls whose text a menu shows: an item, a row, a menu's options. */
const MENU_TEXT_CALLS = /(?:^|\.)(?:addItem|addFixedItem|listRow|textRow|showMenu)$|(?:^|\.)menus?\.create$/;
/** Calls whose text chat shows: print, and a list menu's filter message. */
const CHAT_TEXT_CALLS = /(?:^|\.)(?:print|addFilter)$/;
/** Options whose value is a name rather than text: "!IS_ALIVE" turns a condition around. */
const NAME_OPTION = /\b(?:condition|restriction|action|placeholder|activeOn|onTimeout)\s*:\s*$/;

/**
 * The call a string literal at `at` is an argument of (its name, as written:
 * `print`, `shop.addItem`), or "" when it is not in one - or is in the body
 * of a function passed to one, which is code of its own.
 */
function enclosingCall(code: string, at: number): string {
	let depth = 0;
	for (let i = at - 1; i >= 0; i--) {
		const c = code[i];
		if (c === ')' || c === ']' || c === '}') {
			depth++;
			continue;
		}
		if (c !== '(' && c !== '[' && c !== '{') continue;
		if (depth > 0) {
			depth--;
			continue;
		}
		if (c === '{' && /(?:=>|\))\s*$/.test(code.slice(0, i))) return '';
		if (c === '(') return /([\w$.]+)\s*$/.exec(code.slice(Math.max(0, i - 80), i))?.[1] ?? '';
	}
	return '';
}

/**
 * Colour tags in the text of a call that shows it where the tag does not
 * exist - a menu's `!w` or `!R` in `print`, chat's `!g`, `!b` or `!t` in a
 * menu's item - with the index of the string they are in. Only strings
 * written right in the call are read; `${...}` in a template is code.
 */
export function misplacedColourTags(source: string): { index: number; rule: string }[] {
	const code = codeOnly(source);
	const found: { index: number; rule: string }[] = [];

	for (const m of code.matchAll(/(["'`])\s*\1/g)) {
		const call = enclosingCall(code, m.index!);
		const chat = CHAT_TEXT_CALLS.test(call);
		if (!chat && !MENU_TEXT_CALLS.test(call)) continue;
		if (NAME_OPTION.test(code.slice(Math.max(0, m.index! - 40), m.index!))) continue;

		const text = source.slice(m.index! + 1, m.index! + m[0].length - 1).replace(/\$\{[^}]*\}/g, '');
		for (const tag of text.matchAll(chat ? /![wR]/g : /![gbt]/g)) {
			found.push({ index: m.index!, rule: `27: ${tag[0]} in ${call}() - ${chat ? 'a menu\'s tag, dropped in chat' : 'a chat tag, dropped in a menu'}` });
		}
	}

	return found;
}

test('27: a colour tag is only where the text shows it', () => {
	const plugin = [
		'print(player, "!gHi !wthere");',
		'print(player, `${!won ? "a" : "b"} !dgrey`);',
		'shop.addItem("!gGreen", { enabled: (player) => !player.isAlive, message: "!y(full)" });',
		'shop.addItem("x", { onSelect: (player) => { player.name = "!g"; } });',
		'menus.create("SHOP", { title: "!tTeam" });',
	].join('\n');

	expect(misplacedColourTags(plugin).map(f => f.rule)).toEqual([
		'27: !w in print() - a menu\'s tag, dropped in chat',
		'27: !g in shop.addItem() - a chat tag, dropped in a menu',
		'27: !t in menus.create() - a chat tag, dropped in a menu',
	]);
});

/**
 * Where an `if (...) { ... }` block (its else branches included) touches the
 * code around it: the line before it, or after it, is neither blank nor the
 * edge of the enclosing block. `lines` are code only - a comment above the if
 * reads as blank, and belongs to it.
 */
export function ifBlockGaps(lines: string[]): { line: number; side: 'before' | 'after' }[] {
	const gaps: { line: number; side: 'before' | 'after' }[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (!/^\s*if\s*\(.*\)\s*\{\s*$/.test(lines[i])) continue;

		let depth = 0;
		let end = i;
		for (let j = i; j < lines.length; j++) {
			depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length;
			if (depth <= 0) {
				end = j;
				break;
			}
		}

		const before = i > 0 ? lines[i - 1] : '';
		if (before.trim() !== '' && !/[{([,:]\s*$/.test(before)) gaps.push({ line: i, side: 'before' });

		const after = end + 1 < lines.length ? lines[end + 1] : '';
		if (after.trim() !== '' && !/^\s*[}\])]/.test(after)) gaps.push({ line: end, side: 'after' });
	}

	return gaps;
}

// 28. Every element a plugin author sees in the editor - a function, a
// class, an interface, a type, a constant, a namespace and their members - of
// the core's hand-written API and the modules' has words in both languages
// (scripts/docs/as/, a module's scripts/docs/src/), and the source carries
// the ones AMXTS_DOCS_LANG picks (scripts/apply-docs.ts writes them there).
const DOC_SOURCES = [...coreSources(CORE_DIR), ...loadProject().modules.flatMap(moduleSources)];

/**
 * A path in the repository (`as/natives.ts`, `runtime/src/module.cpp`,
 * `docs/en/2.core/01.plugin.md`), or how the hood works underneath
 * (AssemblyScript, call_indirect, changetype...): that goes in a `//` comment
 * in the code, not in the words a plugin author reads.
 */
const INTERNALS = /\b(?:as|scripts|runtime|docs|src|tests)\/[\w./-]+\.(?:ts|cpp|h|md)\b|AssemblyScript|WebAssembly|call_indirect|changetype|StaticArray|bit pattern|trampoline|dispatcher/;

/** ```ts blocks and the lines indented as code: the part of a text both languages share. */
function codeOf(text: string): string[] {
	const fence = /```[\s\S]*?```/g;
	return [...(text.match(fence) ?? []), ...text.replace(fence, '').split('\n').filter(line => /^(?: {2,}|\t)\S/.test(line))];
}

/** Where a `//` comment starts in a line of code, outside its strings; -1 without one. */
function commentAt(line: string): number {
	let quote = '';
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === '\\') i++;
			if (c === quote) quote = '';
			continue;
		}
		if (c === '"' || c === '\'' || c === '`') quote = c;
		if (c === '/' && line[i + 1] === '/') return i;
	}
	return -1;
}

/** The code of a text without its comments: what must not differ between the languages. */
export function codeWithoutComments(text: string): string[] {
	return codeOf(text).map(block => block.split('\n').map((line) => {
		const at = commentAt(line);
		return (at < 0 ? line : line.slice(0, at)).trimEnd();
	}).join('\n'));
}

/** Words a comment may hold untranslated: code, not English. */
const CODE_WORDS = new Set(['null', 'undefined', 'true', 'false', 'string', 'number', 'boolean', 'void', 'const', 'let', 'new', 'native', 'public', 'stock', 'forward']);

/**
 * The comments of a Russian example written in English: two English words or
 * more and no Cyrillic. Code in a comment - `// string[] | null`,
 * `// "c21_kitty"`, a Pawn declaration ending in `;` - and a name or a literal
 * inside a Russian sentence (`// команда "CT"`, `// см. player.name`) pass.
 */
export function englishComments(text: string): string[] {
	return codeOf(text).flatMap(block => block.split('\n')).flatMap((line) => {
		const at = commentAt(line);
		if (at < 0) return [];
		const comment = line.slice(at).trim();
		const body = comment.slice(2).trim();
		if (/\p{Script=Cyrillic}/u.test(body) || /;\s*$/.test(body)) return [];
		const tokens = body.replace(/"[^"]*"|'[^']*'|`[^`]*`/g, ' ').split(/\s+/).map(token => token.replace(/^[([{«]+|[)\]}»,.;:!?]+$/g, ''));
		// An English word: letters only, not a camelCase or PascalCase name, not a keyword.
		const words = tokens.filter(token => /^[a-z]{2,}$/i.test(token) && !/^[A-Z]?[a-z]+[A-Z]/.test(token) && !CODE_WORDS.has(token));
		return words.length >= 2 ? [comment] : [];
	});
}

/** A path as a finding shows it: from `from`, with forward slashes. */
function shown(path: string, from = process.cwd()): string {
	return relative(from, path).split(sep).join('/');
}

/** What is missing or wrong in the words of one source file. */
export async function docFindings(source: DocSource, lang: Lang): Promise<string[]> {
	const text = readFileSync(source.file, 'utf8');
	const found = elements(source.file, text);
	const table = existsSync(source.docs) ? await loadTable(source.docs) : {};
	const docs = shown(source.docs);
	const at = (line: number) => `${shown(source.file)}:${line + 1}`;
	const findings: string[] = [];

	for (const element of found.filter(e => e.public)) {
		const entry = table[element.key];
		if (!entry) {
			findings.push(`${at(element.line)}  28: ${element.key} - no words in ${docs}`);
			continue;
		}
		for (const language of LANGS.filter(l => !entry[l].trim())) findings.push(`${at(element.line)}  28: ${element.key} - no ${language} words in ${docs}`);
		// The examples are the same code in both languages; only their comments are translated.
		if (entry.en && entry.ru && JSON.stringify(codeWithoutComments(entry.en)) !== JSON.stringify(codeWithoutComments(entry.ru))) {
			findings.push(`${at(element.line)}  28: ${element.key} - the code in its words differs between en and ru (${docs})`);
		}
		for (const comment of englishComments(entry.ru)) findings.push(`${at(element.line)}  28: ${element.key} - an English comment in its ru example, "${comment}": translate it (${docs})`);
		// Written for a plugin author: no files of this repository, no names of one project.
		const internal = LANGS.map(l => INTERNALS.exec(entry[l])?.[0]).find(Boolean);
		if (internal) findings.push(`${at(element.line)}  28: ${element.key} - "${internal}" in its words: say what it means for the plugin author (${docs})`);
		const words = pick(entry, lang);
		if (!element.doc) findings.push(`${at(element.line)}  28: ${element.key} - no comment above it: bun run generate writes it`);
		else if (element.doc.text !== words) findings.push(`${at(element.line)}  28: ${element.key} - its comment is not the ${lang} words of ${docs}: edit them there, then bun run generate`);
	}

	const keys = new Set(found.map(e => e.key));
	for (const key of Object.keys(table).filter(k => !keys.has(k))) findings.push(`${docs}  28: ${key} - names nothing in ${shown(source.file)}`);
	return findings;
}

test('28: every public element has words in both languages, and its comment is the chosen one', async () => {
	const findings = (await Promise.all(DOC_SOURCES.map(async source => docFindings(source, docsLang())))).flat();

	expect(findings).toEqual([]);
});

test('28: an example\'s comments are translated, its code is not', () => {
	const en = '```ts\nsleep(5000); // rejects after 2 s\nconst x = lookup(); // string[] | null\n```';
	const ru = '```ts\nsleep(5000);   // отклоняется через 2 с\nconst x = lookup(); // string[] | null\n```';

	expect(codeWithoutComments(en)).toEqual(codeWithoutComments(ru));
	expect(codeWithoutComments(en)).not.toEqual(codeWithoutComments(ru.replace('5000', '2000')));
	expect(englishComments(en)).toEqual(['// rejects after 2 s']);
	expect(englishComments([
		'```ts',
		'readText(get_mapname)   // "c21_kitty"',
		'set_speed(id, speed)    // native set_speed(id, Float:speed);',
		'print(0, "Hi")          // чат всех игроков, как "CT" и player.name',
		'fn.call()               // PutinserverEvent',
		'```',
	].join('\n'))).toEqual([]);
});

test('28: the repositories store the words in English', () => {
	const roots = [...new Set(DOC_SOURCES.map(source => source.root))];
	const findings = roots.flatMap((root) => {
		const attributes = existsSync(join(root, '.gitattributes')) ? readFileSync(join(root, '.gitattributes'), 'utf8') : '';
		return DOC_SOURCES.filter(source => source.root === root)
			.map(source => shown(source.file, root))
			.filter(path => !attributes.split(/\r?\n/).includes(`${path} filter=${FILTER}`))
			.map(path => `${join(root, '.gitattributes')}  28: no "${path} filter=${FILTER}" - a tree in Russian would commit Russian`);
	});

	expect(findings).toEqual([]);
});

/** How a text is written: in quotes, or in backticks on the key's line, or indented under it. */
function formOf(value: ts.Expression, file: ts.SourceFile): string {
	if (!ts.isNoSubstitutionTemplateLiteral(value) && !ts.isTemplateExpression(value)) return 'in quotes';
	return /^`\r?\n/.test(value.getText(file)) ? 'indented under the key' : 'on the key\'s line';
}

/**
 * 29. The `{ en, ru }` pairs whose two texts are written differently - one
 * in quotes, or one on its line and the other indented under it.
 */
export function unevenPairs(fileName: string, text: string): { line: number; what: string }[] {
	const file = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
	const found: { line: number; what: string }[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isObjectLiteralExpression(node)) {
			const value = (name: string) => node.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name)?.initializer;
			const en = value('en');
			const ru = value('ru');
			if (en && ru) {
				const forms = [formOf(en, file), formOf(ru, file)];
				const what = forms.includes('in quotes') ? `a text in quotes (en ${forms[0]}, ru ${forms[1]}): both in backticks` : `en ${forms[0]}, ru ${forms[1]}: laid out alike`;
				if (forms[0] !== forms[1] || forms[0] === 'in quotes') found.push({ line: file.getLineAndCharacterOfPosition(en.getStart(file)).line, what });
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(file);
	return found;
}

function tablesIn(dir: string): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? tablesIn(path) : path.endsWith('.ts') ? [path] : [];
	});
}

test('29: an entry\'s two languages are written alike', () => {
	const roots = [CORE_DIR, ...loadProject().modules.map(pkg => pkg.dir)];
	const findings = roots.flatMap(root => tablesIn(join(root, 'scripts', 'docs')))
		.flatMap(file => unevenPairs(file, readFileSync(file, 'utf8')).map(f => `${shown(file)}:${f.line + 1}  29: ${f.what}`));

	expect(findings).toEqual([]);
});

// 30. A tooltip starts with what the thing is and whose - "The player's
// health." - in the plugin author's words. A pronoun or a question word first
// ("Its health", "Who wrote it", "Как рисуется") leaves the reader guessing
// what it is about; an engine name (pev->rendermode, m_iTeam, kRenderGlow,
// MOVETYPE_FLY, "an int") is no explanation, and belongs on the last line,
// `Pawn: ...`, for whoever ports a Pawn plugin.
const OPENING_PRONOUN: Record<Lang, RegExp> = {
	en: /^(?:it|its|it's|he|his|him|she|her|they|their|them|who|whom|whose|what|where|when|how|which|this|that|these|those)(?![\w'])/i,
	ru: /^(?:его|её|ее|их|он|она|оно|они|ему|ей|им|кто|кого|кому|кем|что|чего|чем|где|когда|как|какой|какая|какое|какие|каким|сколько|куда|откуда|чей|чья|чьё|чьи|это|этот|эта|эти|тот|та|то|те|свой|своя|своё|свои)(?![\p{L}\p{N}_])/iu,
};
const ENGINE_NAME = /pev->|\bm_[A-Za-z]\w*|\bkRender\w*|\b[A-Z]\w*::\w+|\bvar_[a-z]\w*|\b(?:[Aa]n int|[Aa] float|[Aa] bool)\b|(?<!\p{L})[Цц]елое(?!\p{L})(?! число)|\b(?:MOVETYPE|SOLID|OBS|WPNSTATE|DAMAGE|DEAD|CONTENTS|HITGROUP|ACT|FL|EF|IN|HIDEHUD|DMG|MSG|FP|ET|ATYPE|HC|PLUGIN)_[A-Z0-9_]+/u;

/** What in one text breaks rule 30: a pronoun first, an engine name off the `Pawn:` line. */
export function plainWordsFindings(text: string): string[] {
	const findings: string[] = [];
	const first = text.trim().replace(/^[`"'«(*_]+/, '');
	for (const lang of LANGS) {
		const pronoun = OPENING_PRONOUN[lang].exec(first)?.[0];
		if (pronoun) findings.push(`starts with "${pronoun}": say what it is and whose ("The player's health.")`);
	}
	// "SteamID игрока: "STEAM_0:1:12345"" reads as the only value there is: an
	// example is said to be one ("e.g.", "например"), a closed list too ("one of").
	const opening = /^([^:"`\n]+): `?"/.exec(first)?.[1];
	if (opening && !/\.\s/.test(opening) && !/(?:e\.g\.|for example|one of|any of|например|одно из|любые из)$/i.test(opening.trim())) {
		findings.push(`"${opening}: "..."" reads as the only value: say "e.g." / "например", or "one of" / "одно из" for the whole list`);
	}
	const engine = proseLines(text).map(line => ENGINE_NAME.exec(line)?.[0]).find(Boolean);
	if (engine) findings.push(`"${engine}" outside the Pawn: line: explain it in plain words, and put the engine's name on the last line, "Pawn: ..."`);
	return findings;
}

/** A tooltip's prose lines: without its ```ts blocks, its `Pawn:` line and the lines indented as code. */
function proseLines(text: string): string[] {
	return text.replace(/```[\s\S]*?```/g, '').split('\n').filter(line => !/^\s*Pawn:/.test(line) && !/^(?: {2,}|\t)\S/.test(line));
}

/** A tooltip text and where it is: a table's file and the entry's key. */
type Placed = [where: string, text: DocText];

let texts: Promise<{ where: string; text: string }[]> | undefined;

/** Every text of the core's tooltip tables and the modules', by where it is: read once, for the tests that read them. */
function coreTexts(): Promise<{ where: string; text: string }[]> {
	texts ??= readCoreTexts();
	return texts;
}

async function readCoreTexts(): Promise<{ where: string; text: string }[]> {
	const sources = [...coreSources(CORE_DIR), ...loadProject().modules.flatMap(moduleSources)].filter(s => existsSync(s.docs));
	const tables = await Promise.all(sources.map(async source => ({ file: shown(source.docs), table: await loadTable(source.docs) })));

	const placed: Placed[] = [
		...tables.flatMap(({ file, table }) => keyed(file, table)),
		...keyed('scripts/docs/entities.ts', ENTITY_FIELDS),
		...eventTexts('scripts/docs/events.ts', { ...EVENTS, playerchange: PLAYER_CHANGE }),
		...eventTexts('scripts/docs/game.ts', GAME),
		...eventTexts('scripts/docs/messages.ts', MESSAGES),
	];

	return placed.flatMap(([where, text]) => LANGS.map(lang => ({ where: `${where} (${lang})`, text: dedent(text[lang]) })));
}

/** A table's entries, each placed under its key. */
function keyed(file: string, table: Record<string, DocText>): Placed[] {
	return Object.entries(table).map(([key, text]) => [`${file} ${key}`, text]);
}

/** An event table's texts: each event's summary, its notes and its fields. */
function eventTexts(file: string, docs: Record<string, { summary: DocText; notes?: DocText[]; fields?: Record<string, DocText> }>): Placed[] {
	return Object.entries(docs).flatMap(([name, doc]): Placed[] => [
		[`${file} ${name}`, doc.summary],
		...(doc.notes ?? []).map((note): Placed => [`${file} ${name} note`, note]),
		...Object.entries(doc.fields ?? {}).map(([field, text]): Placed => [`${file} ${name}.${field}`, text]),
	]);
}

test('30: a tooltip starts with what it is, and engine names are only on its Pawn: line', async () => {
	const findings = (await coreTexts()).flatMap(({ where, text }) => plainWordsFindings(text).map(f => `${where}  30: ${f}`));

	expect(findings).toEqual([]);
});

/**
 * 35. Code values in a tooltip's prose are code: a string literal (`"chat"`),
 * `null`, a negative number (`-1`), a default (`5` by default), a file name
 * (`menu.ini`), a snake_case or camelCase name (`mp_autokick`, `renderMode`),
 * a call (`preventDefault()`) - in backticks, so the hover shows them as code.
 * What is only a judgement - a field's plain-word name (`id`, `message`), a
 * number in a sentence - is left to the author. The `Pawn:` line, ```ts
 * blocks and the lines indented as code are not prose.
 */
const CODE_IN_PROSE: [RegExp, string][] = [
	[/"[^"\n]*"/g, 'a string literal'],
	[/(?<![\w$.])(?:null|undefined)(?![\w$])/g, 'a literal'],
	[/(?<![\w$.\-])-\d+(?:\.\d+)?(?![\w.])/g, 'a negative number'],
	[/(?<![\w$.\-])\d+(?:\.\d+)?(?= by default)|(?<=по умолчанию )\d+(?:\.\d+)?(?![\w.])/g, 'a default value'],
	[/(?<![\w$.\-/])[\w-]+\.(?:ini|jsonc?|ya?ml|cfg|amxx|sma|inc|mdl|aot)(?![\w$])/g, 'a file name'],
	[/(?<![\w$.%<])[a-z][a-z0-9]*(?:_[a-z0-9]+)+(?![\w$>%])/g, 'a snake_case name'],
	[/(?<![\w$.-])[a-z]+[A-Z]\w*(?![\w$(-])/g, 'a camelCase name'],
	[/(?<![\w$.])[a-z_$][\w$]*(?:\.[a-z_$][\w$]*)*\(\)/gi, 'a call'],
];

/** What in one text's prose is code written as a word, and what it is. */
export function codeInProse(text: string): string[] {
	const prose = proseLines(text).join('\n').replace(/`[^`]*`/g, '``');
	return CODE_IN_PROSE.flatMap(([pattern, what]) => [...prose.matchAll(pattern)].map(m => `${m[0]} - ${what}`));
}

test('35: code values in a tooltip are code', async () => {
	const findings = (await coreTexts()).flatMap(({ where, text }) => codeInProse(text).map(f => `${where}  35: ${f}, in backticks`));

	expect(findings).toEqual([]);
});

test('35: what counts as code in prose', () => {
	expect(codeInProse('One of "chat" or "center"; -1 for none, 5 by default; null when none; users.ini, mp_autokick, renderMode, preventDefault().')).toEqual([
		'"chat" - a string literal',
		'"center" - a string literal',
		'null - a literal',
		'-1 - a negative number',
		'5 - a default value',
		'users.ini - a file name',
		'mp_autokick - a snake_case name',
		'renderMode - a camelCase name',
		'preventDefault() - a call',
	]);
	expect(codeInProse([
		'One of `"chat"`, `-1`; `5` by default; e.g. an AK-47, 0.6 seconds, `%name%`.',
		'```ts',
		'print(0, "Hi"); // -1',
		'```',
		'  readText(get_mapname)',
		'Pawn: `client_print`, set_task',
	].join('\n'))).toEqual([]);
});

/**
 * 36. What the build imports by itself is not imported by hand: an import of
 * a name the project's auto-imports give - the facade's API, a module's
 * namespace under the name it gives. A plugin's code, not the hood's or a
 * module's own source, which import what they use.
 */
export function autoImportedImports(file: string, source: string, table: Map<string, { from: string; namespace: boolean }>): Finding[] {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const found: Finding[] = [];
	for (const statement of parsed.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
		const from = statement.moduleSpecifier.text;
		const bindings = statement.importClause?.namedBindings;
		const names = !bindings
			? []
			: ts.isNamespaceImport(bindings)
				? [bindings.name].filter(name => table.get(name.text)?.namespace && table.get(name.text)!.from === from)
				: bindings.elements.filter(each => !each.propertyName && table.get(each.name.text)?.from === from && !table.get(each.name.text)!.namespace).map(each => each.name);
		for (const name of names) {
			const line = parsed.getLineAndCharacterOfPosition(name.getStart(parsed)).line + 1;
			found.push({ where: `${file}:${line}`, rule: `36: ${name.text} is auto-imported - drop it from the import` });
		}
	}
	return found;
}

test('36: an explicit import of what is auto-imported is found', () => {
	const table = new Map([['Player', { from: '@amxts/core', namespace: false }], ['menus', { from: '@amxts/menu-core', namespace: true }]]);
	const found = autoImportedImports('a.ts', [
		'import { Player, publicFor } from "@amxts/core";',
		'import * as menus from "@amxts/menu-core";',
		'import * as shop from "@amxts/menu-core";',
		'import { Player as Somebody } from "@amxts/core";',
	].join('\n'), table);
	expect(found.map(f => `${f.where} ${f.rule}`)).toEqual([
		'a.ts:1 36: Player is auto-imported - drop it from the import',
		'a.ts:2 36: menus is auto-imported - drop it from the import',
	]);
});

/** The files that prove an explicit import works as it always has. */
const EXPLICIT_IMPORTS = new Set(['tests/as/menu-by-name.ts', 'tests/server/cvar.ts']);

test('36: plugin code does not import what is auto-imported', () => {
	const project = loadProject();
	const table = new Map(project.autoImports.map(entry => [entry.name, entry]));
	const plugins = [
		...['tests/as', 'tests/server'].flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.ts')).map(name => `${dir}/${name}`)),
		'runtime/host/hello.ts',
		...project.modules.map(pkg => join(pkg.dir, 'playground', 'plugins')).filter(existsSync).flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.ts')).map(name => join(dir, name))),
	].filter(file => !EXPLICIT_IMPORTS.has(file));
	const findings = plugins.flatMap(file => autoImportedImports(file, readFileSync(file, 'utf8'), table)).map(f => `${f.where}  ${f.rule}`);
	expect(findings).toEqual([]);
});

test('plugin code follows the code-style rules', () => {
	const findings = [...pluginFiles(), ...MODULES.flatMap(dir => pluginFiles(dir))].flatMap(scan).map(f => `${f.where}  ${f.rule}`);

	// The list itself is the message: every line is a file, a line number and
	// the rule it breaks, so the failure says exactly what to change.
	expect(findings).toEqual([]);
});

test('every tracked JSON file is strict JSON, without comments', () => {
	// Any editor and any tool reads these as they are. No file is JSONC on
	// purpose: a note about a setting goes beside the code that reads it.
	const files = execFileSync('git', ['ls-files', '-z', '*.json'], { cwd: CORE_DIR, encoding: 'utf8' }).split('\0').filter(Boolean);
	const broken = files.filter((file) => {
		try {
			JSON.parse(readFileSync(join(CORE_DIR, file), 'utf8'));
			return false;
		} catch {
			return true;
		}
	});

	expect(files.length).toBeGreaterThan(0);
	expect(broken).toEqual([]);
});

/**
 * 38. The core's API by the package's name, a module by its package's: `~/`
 * is the project's own files. A specifier the build would refuse, with what
 * to write instead.
 */
export function coreByAlias(file: string, source: string, renames: Renames): Finding[] {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	return specifiers(parsed).flatMap((literal) => {
		const instead = renamed(literal.text, renames);
		const line = parsed.getLineAndCharacterOfPosition(literal.getStart(parsed)).line + 1;
		return instead ? [{ where: `${file}:${line}`, rule: `38: ${literal.text} - import ${instead}` }] : [];
	});
}

test('38: ~/ to the core\'s API or a module package is found', () => {
	const renames = renamesFor([{ name: '@amxts/menu-core', short: 'menu-core' }]);
	const found = coreByAlias('a.ts', [
		'import { user_slap } from "~/natives";',
		'import { twice } from "~/lib/math";',
		'import * as menus from "~/modules/menu-core";',
		'declare module "~/facade" {}',
		'const text = "~/fs";',
	].join('\n'), renames);
	expect(found.map(f => `${f.where} ${f.rule}`)).toEqual([
		'a.ts:1 38: ~/natives - import @amxts/core/natives',
		'a.ts:3 38: ~/modules/menu-core - import @amxts/menu-core',
		'a.ts:4 38: ~/facade - import @amxts/core',
	]);
});

test('38: plugin and module code imports the core\'s API by the package\'s name', () => {
	const project = loadProject();
	const renames = renamesFor(project.modules);
	const plugins = [
		...['tests/as', 'tests/server'].flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.ts')).map(name => `${dir}/${name}`)),
		'runtime/host/hello.ts',
		...project.modules.flatMap(pkg => [join(pkg.dir, 'src'), join(pkg.dir, 'playground', 'plugins')]).filter(existsSync).flatMap(dir => pluginFiles(dir)),
	];
	const findings = plugins.flatMap(file => coreByAlias(file, readFileSync(file, 'utf8'), renames)).map(f => `${f.where}  ${f.rule}`);
	expect(findings).toEqual([]);
});

/** 37. A generic's type is an interface beside the code, passed by its name: a type literal in a call's type arguments is reported. */
export function typeLiteralArguments(file: string, source: string): Finding[] {
	const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
	const found: Finding[] = [];
	const visit = (node: ts.Node) => {
		if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.typeArguments?.some(ts.isTypeLiteralNode)) {
			const line = parsed.getLineAndCharacterOfPosition(node.getStart(parsed)).line + 1;
			found.push({ where: `${file}:${line}`, rule: '37: a type written in place - declare an interface beside it and pass it by name' });
		}
		ts.forEachChild(node, visit);
	};
	visit(parsed);
	return found;
}

test('37: a type literal as a type argument is found', () => {
	const found = typeLiteralArguments('a.ts', [
		'server.addCommand<{ target: Player }>("/kick <target>", () => {});',
		'server.addCommand<KickArgs>("/kick <target>", () => {});',
		'const shop = new Menu<{ category: string }>("Shop");',
	].join('\n'));
	expect(found.map(f => f.where)).toEqual(['a.ts:1', 'a.ts:3']);
});

test('37: plugin and module code passes a generic its type by name', () => {
	const project = loadProject();
	const plugins = [
		...['tests/as', 'tests/server'].flatMap(dir => readdirSync(dir).filter(name => name.endsWith('.ts')).map(name => `${dir}/${name}`)),
		'runtime/host/hello.ts',
		...project.modules.flatMap(pkg => [join(pkg.dir, 'src'), join(pkg.dir, 'playground', 'plugins')]).filter(existsSync).flatMap(dir => pluginFiles(dir)),
	];
	expect(plugins.flatMap(file => typeLiteralArguments(file, readFileSync(file, 'utf8'))).map(f => `${f.where}  ${f.rule}`)).toEqual([]);
});
