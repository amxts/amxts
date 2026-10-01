// Fields on Player that plugins add, shared by all of them.
//
// A plugin declares its fields as TypeScript does, by augmenting the facade's
// Player:
//
//   import "@amxts/core";
//   declare module "@amxts/core" {
//     interface Player {
//       spawnProtected: boolean;
//       glow: {
//         enabled: true | false | "default";
//         seenBy: Player[];
//       };
//     }
//   }
//
// and reads and writes them as properties: `if (player.spawnProtected) ...`,
// `player.spawnProtected = true`, `player.glow.enabled = true`. The values live in
// the module, by player slot and field name, so every plugin - and Pawn,
// through the amxts_*_player_data natives - sees the same ones. A member of an
// object field is stored under a dotted key, "glow.enabled".
//
// A field or member is boolean, number, string, a union of string literals
// (with true and false among them if it likes - "true | false | "default""
// is one value, see Parser.parseType), or Player[]. A field may also be an
// object of those: written inline, or an interface declared in the same file.
//
// AssemblyScript has neither module augmentation nor a property looked up by a
// name held in a string, so the build does both:
//
// - reading a file (`read`), it records the members of every
//   `interface Player` in a `declare module "@amxts/core"` block (the
//   facade, `~/facade` once the specifiers are the tree's) and blanks the
//   block out - spaces, so every line and column after it stays where it was.
//   An interface of the same file that a field is typed with becomes
//   `import { Name } from "~/facade";` (and `export { Name };` if it was
//   exported): the build makes
//   the class of that name in the facade, so the file's own uses of it are
//   the same type as the field;
// - once everything the plugin imports is parsed (`afterParse`), it parses a
//   hidden library file: global helpers over the module's store, a holder
//   class with one getter and one setter per field, and a class per object
//   field. The holder's members are then moved into the facade's
//   `class Player` declaration and the holder itself is dropped, so the
//   accessors are Player's own members - no other class, no
//   `player.something.` in between. The object classes move into the
//   facade's file. Their bodies are resolved in the facade's scope, which is
//   why the helpers they call are @global.
//
// An object field reads as a live view: `player.glow.enabled = true`
// writes the store at once, and `player.glow = { ... }` writes every
// member. The same class made by an object literal holds its own values until
// it is assigned to a player. A Player[] reads as a list whose `push` writes
// back, as a flag list does (FlagList); the module takes a player who leaves
// out of every such list.
//
// A field whose name Player already has - `solid` is Entity's var_solid - is
// refused: it would silently replace the engine's property.
//
// A change is an event, `"playerchange"`, which the module raises on every
// write that changes a value (runtime/src/module.cpp). With
// `{ field: "spawnProtected" }` its listener gets the field's own event class, whose `value` and `previous`
// have the field's type - one per field, per object member and per object
// field, made here. The compiler binds an event's type to the name in the
// call (`K extends keyof ServerEventMap`), and the field is in the options, so
// the call's name becomes `"playerchange:spawnProtected"` and ServerEventMap is given
// that key; `PlayerChangeEvent<"spawnProtected">` written as a type becomes the class.

// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import * as asc from '../runtime/deps/assemblyscript/dist/assemblyscript.js';

/**
 * What one value is: a primitive, `Player[]` ('players'), or a union of
 * string literals - with true and false among them when `boolean` is set.
 * Until written, a union reads its first literal.
 */
export type ValueType
	= | 'boolean' | 'number' | 'string' | 'players'
		| { literals: string[]; boolean: boolean };

export interface ObjectMember {
	name: string;
	type: ValueType;
}

/** An object field: its members, and the interface it was declared as, if any. */
export interface ObjectType {
	members: ObjectMember[];
	interface: string | null;
}

export type FieldType = ValueType | ObjectType;

export interface PlayerField {
	name: string;
	type: FieldType;
	/** Where it was declared: `file:line`. */
	where: string;
}

/** Where the generated accessors are parsed: a library file, so the hood's rules apply to them. */
export const PLAYER_FIELDS_FILE = '~lib/amxts/player-fields.ts';

/** The holder class in that file whose members go into Player. */
const HOLDER = '__AmxtsPlayerFields';

/** The list a Player[] field reads as. */
const PLAYER_LIST = '__AmxtsPlayerList';

/** The event a field's change is, and the facade's class for it. */
const CHANGE_EVENT = 'playerchange';
const CHANGE_CLASS = 'PlayerChangeEvent';

/** The interface in that file whose members - `"playerchange:spawnProtected": ...` - go into ServerEventMap. */
const CHANGES = '__AmxtsPlayerChanges';

const DECLARE_MODULE = /\bdeclare\s+module\s*(["'])~\/facade\1\s*\{/g;

const KINDS = 'boolean, number, string, a union of string literals (true and false may be among them), Player[], or an object of those';

/**
 * One compile's fields. `read` goes into the compile's readFile, `transform`
 * into its transforms; a new one for every compile.
 */
export function playerFieldsBuild() {
	const fields = new Map<string, PlayerField>();
	const problems: string[] = [];

	function read(path: string, text: string): string {
		const file = path.replace(/\\/g, '/');
		if (!text.includes('declare') || !/\bdeclare\s+module\b/.test(text)) return text;

		const blocks: { start: number; open: number; close: number }[] = [];
		for (const match of text.matchAll(DECLARE_MODULE)) {
			const open = match.index! + match[0].length - 1;
			const close = closingBrace(text, open);
			if (close < 0) {
				problems.push(`${file}:${lineOf(text, match.index!)}: declare module "@amxts/core" - no closing brace`);
				continue;
			}
			blocks.push({ start: match.index!, open, close });
		}

		const local = localInterfaces(text, blocks);
		const used = new Set<string>();
		for (const block of blocks) collect(file, text, block.open + 1, block.close, local, used);

		// Last to first, so an earlier span's offsets still hold.
		const spans = [
			...blocks.map(block => ({ start: block.start, end: block.close + 1, with: '' })),
			...[...used].map((name) => {
				const found = local.get(name)!;
				const imported = `import { ${name} } from "~/facade";`;
				return { start: found.start, end: found.end, with: found.exported ? `${imported} export { ${name} };` : imported };
			}),
		].sort((a, b) => b.start - a.start);

		let out = text;
		for (const span of spans) {
			const original = out.slice(span.start, span.end);
			const replaced = span.with ? span.with + (original.match(/\r?\n/g) ?? []).join('') : blank(original);
			out = out.slice(0, span.start) + replaced + out.slice(span.end);
		}
		return out;
	}

	function collect(file: string, text: string, from: number, to: number, local: Map<string, LocalInterface>, used: Set<string>) {
		let body = withoutComments(text.slice(from, to));
		const found: { start: number; end: number }[] = [];
		for (const match of body.matchAll(/\b(?:export\s+)?interface\s+Player\s*\{/g)) {
			const open = match.index! + match[0].length - 1;
			const close = closingBrace(body, open);
			if (close < 0) continue;
			found.push({ start: match.index!, end: close + 1 });
			for (const piece of members(body, open + 1, close)) {
				add(piece.text, `${file}:${lineOf(text, from + piece.at)}`, local, used);
			}
		}

		// Anything else in the block would be dropped with it: say so instead.
		for (const span of found) body = body.slice(0, span.start) + blank(body.slice(span.start, span.end)) + body.slice(span.end);
		const rest = body.search(/\S/);
		if (rest >= 0) {
			const what = body.slice(rest).trim().split('\n')[0].trim();
			problems.push(`${file}:${lineOf(text, from + rest)}: declare module "@amxts/core" - only \`interface Player { ... }\` goes here, not "${what}"`);
		}
	}

	function add(member: string, where: string, local: Map<string, LocalInterface>, used: Set<string>) {
		const shape = memberShape(member);
		if (!shape) {
			problems.push(`${where}: Player - "${member}" is not a field`);
			return;
		}
		const { name, optional, written } = shape;
		if (optional) {
			problems.push(`${where}: Player.${name} - a field is never missing: it reads false, 0 or "" until written; drop the ?`);
			return;
		}
		if (name.startsWith('__')) {
			problems.push(`${where}: Player.${name} - names starting with __ are the hood's`);
			return;
		}

		const type = fieldType(written, local);
		if (typeof type === 'string' && type.startsWith('!')) {
			problems.push(`${where}: Player.${name}${type.slice(1)}`);
			return;
		}
		const resolved = type as FieldType;
		if (isObject(resolved) && resolved.interface) used.add(resolved.interface);

		const earlier = fields.get(name);
		if (earlier && describe(earlier.type) !== describe(resolved)) {
			problems.push(`${where}: Player.${name} is ${describe(resolved)} here and ${describe(earlier.type)} at ${earlier.where} - one field, one type`);
			return;
		}
		if (!earlier) fields.set(name, { name, type: resolved, where });
	}

	const transform = class {
		afterParse(parser: any): void {
			if (problems.length) throw new Error(problems.join('\n'));
			const listened = typeChangeListeners(parser, new Map(changeEvents([...fields.values()]).map(event => [event.key, event.name])));
			if (listened.length) throw new Error(listened.join('\n'));
			if (!fields.size) return;

			const { classes, facade, topLevel } = classDeclarations(parser);
			const player = classes.get('Player');
			if (!player) {
				const first = [...fields.values()][0];
				throw new Error(`${first.where}: Player.${first.name} - the facade's Player is not part of this compile; import "@amxts/core"`);
			}

			// Player's members and those of every class it extends.
			const taken = new Map<string, string>();
			for (let node: any = player; node;) {
				for (const member of node.members) {
					const name = member.name?.text;
					if (name && !taken.has(name)) taken.set(name, node.name.text);
				}
				const base = node.extendsType?.name?.identifier?.text;
				node = base ? classes.get(base) : null;
			}
			const clashes = [...fields.values()].filter(field => taken.has(field.name));
			if (clashes.length) {
				throw new Error(clashes.map(field =>
					`${field.where}: Player.${field.name} - ${taken.get(field.name)} already has ${field.name}; name the field something else`,
				).join('\n'));
			}
			const named = [...fields.values()].filter((field) => {
				const type = field.type;
				return isObject(type) && type.interface && topLevel.has(type.interface);
			});
			if (named.length) {
				throw new Error(named.map(field =>
					`${field.where}: Player.${field.name} - the facade already has a ${(field.type as ObjectType).interface}; name the interface something else`,
				).join('\n'));
			}

			parser.parseFile(playerFieldsSource([...fields.values()]), PLAYER_FIELDS_FILE, false);
			const source = parser.sources.find((s: any) => s.normalizedPath === PLAYER_FIELDS_FILE);
			const at = source.statements.findIndex((s: any) =>
				s.kind === asc.NodeKind.ClassDeclaration && s.name.text === HOLDER);
			const holder = source.statements[at];
			source.statements.splice(at, 1);
			player.members.push(...holder.members);

			// The change events by the names typeChangeListeners gave the calls. A
			// compile without the server's events has no listener to give them.
			const changes = source.statements.find((s: any) => isNamed(s, CHANGES));
			source.statements = source.statements.filter((s: any) => s !== changes);
			declarationNamed(parser, 'ServerEventMap')?.members.push(...changes.members);

			// The object classes, the list and the change events use Player: they live in its file.
			const moved = source.statements.filter((s: any) => s.kind === asc.NodeKind.ClassDeclaration);
			source.statements = source.statements.filter((s: any) => !moved.includes(s));
			facade.statements.push(...moved);
		}
	};

	// asc takes a transform as a class it instantiates; its own type is not ours to import.
	return { read, transform: transform as any, fields };
}

interface LocalInterface {
	body: string;
	start: number;
	end: number;
	exported: boolean;
}

/** The interfaces a file declares at its top level, outside the declare module blocks. */
function localInterfaces(text: string, blocks: { start: number; close: number }[]): Map<string, LocalInterface> {
	const found = new Map<string, LocalInterface>();
	const plain = withoutComments(text);
	for (const match of plain.matchAll(/\b(export\s+)?interface\s+([A-Za-z_$][\w$]*)\s*\{/g)) {
		const start = match.index!;
		if (blocks.some(block => start > block.start && start < block.close)) continue;
		const open = start + match[0].length - 1;
		const close = closingBrace(plain, open);
		if (close < 0) continue;
		found.set(match[2], { body: plain.slice(open + 1, close), start, end: close + 1, exported: !!match[1] });
	}
	return found;
}

/**
 * The members between `from` and `to`, each with where it starts. A member
 * ends at `;` or `,` outside braces, or at the end of a line that does not go
 * on - `mode:` and a union spread over lines stay one member.
 */
function members(text: string, from: number, to: number): { text: string; at: number }[] {
	const found: { text: string; at: number }[] = [];
	let depth = 0;
	let start = from;
	const flush = (end: number) => {
		const piece = text.slice(start, end);
		const member = piece.trim();
		if (member) found.push({ text: member, at: start + piece.length - piece.trimStart().length });
		start = end + 1;
	};
	for (let i = from; i < to; i++) {
		const c = text[i];
		if (c === '"' || c === '\'' || c === '`') {
			for (i++; i < to && text[i] !== c; i++) {
				if (text[i] === '\\') i++;
			}
			continue;
		}
		if (c === '{' || c === '(' || c === '[' || c === '<') depth++;
		if (c === '}' || c === ')' || c === ']' || c === '>') depth--;
		if (depth > 0) continue;
		if (c === ';' || c === ',') flush(i);
		if (c === '\n') {
			const sofar = text.slice(start, i).trim();
			const next = text.slice(i + 1, to).trimStart();
			if (sofar && !/[:|&]$/.test(sofar) && !/^[|&]/.test(next)) flush(i);
		}
	}
	flush(to);
	return found;
}

function memberShape(member: string) {
	const shape = member.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*(?:(\?)\s*)?:\s*(\S[\s\S]*)$/);
	return shape ? { name: shape[1], optional: !!shape[2], written: shape[3].trim() } : null;
}

/** A field's type, or "!..." - what is wrong with it, to follow `Player.name`. */
function fieldType(written: string, local: Map<string, LocalInterface>): FieldType | string {
	const type = written.replace(/\s+/g, ' ').trim();
	const inline = type.startsWith('{') && type.endsWith('}');
	const name = local.has(type) ? type : null;
	if (!inline && !name) return valueType(type) ?? `!: ${type} - a field is ${KINDS}`;

	const body = inline ? written.trim().slice(1, -1) : local.get(name!)!.body;
	const object: ObjectType = { members: [], interface: name };
	for (const piece of members(body, 0, body.length)) {
		const shape = memberShape(piece.text);
		if (!shape) return `! - "${piece.text}" is not a member`;
		if (shape.optional) return `!.${shape.name} - a member is never missing: drop the ?`;
		if (shape.name.startsWith('__')) return `!.${shape.name} - names starting with __ are the hood's`;
		const member = valueType(shape.written.replace(/\s+/g, ' ').trim());
		if (!member) return `!.${shape.name}: ${shape.written.replace(/\s+/g, ' ').trim()} - a member is ${KINDS.replace(', or an object of those', ' - not an object')}`;
		object.members.push({ name: shape.name, type: member });
	}
	if (!object.members.length) return `!: ${type} - an object field has members`;
	return object;
}

function valueType(type: string): ValueType | null {
	if (type === 'boolean' || type === 'number' || type === 'string') return type;
	if (type === 'Player[]' || type === 'Array<Player>') return 'players';

	const parts = type.replace(/^\|/, '').split('|').map(part => part.trim());
	if (parts.length < 2) return null;
	const literals: string[] = [];
	let boolean = false;
	for (const part of parts) {
		if (part === 'true' || part === 'false' || part === 'boolean') {
			boolean = true;
			continue;
		}
		const literal = part.match(/^"([^"\\]*)"$|^'([^'\\]*)'$/);
		if (!literal) return null;
		literals.push(literal[1] ?? literal[2]);
	}
	if (!literals.length) return 'boolean';
	return { literals, boolean };
}

function isObject(type: FieldType): type is ObjectType {
	return typeof type === 'object' && 'members' in type;
}

/** A type as it is written, to compare two declarations and to name one. */
export function describe(type: FieldType): string {
	if (type === 'players') return 'Player[]';
	if (typeof type === 'string') return type;
	if (isObject(type)) return `{ ${type.members.map(member => `${member.name}: ${describe(member.type)}`).join('; ')} }`;
	return [...(type.boolean ? ['true', 'false'] : []), ...type.literals.map(literal => JSON.stringify(literal))].join(' | ');
}

/**
 * The facade's classes by name: Player and what it extends, the file Player
 * is in, and every name declared at its top level. Only a source that
 * declares `class Player extends PlayerFields` counts as the facade, so a
 * fixture's own class Player cannot take its place.
 */
function classDeclarations(parser: any) {
	const classes = new Map<string, any>();
	let player: any = null;
	let facade: any = null;
	for (const source of parser.sources) {
		for (const statement of source.statements) {
			if (statement.kind !== asc.NodeKind.ClassDeclaration) continue;
			const name = statement.name.text;
			if (name === 'Player') {
				if (statement.extendsType?.name?.identifier?.text === 'PlayerFields') {
					player = statement;
					facade = source;
				}
				continue;
			}
			if (!classes.has(name)) classes.set(name, statement);
		}
	}
	if (player) classes.set('Player', player);

	const topLevel = new Set<string>();
	for (const statement of facade?.statements ?? []) {
		if (statement.name?.text) topLevel.add(statement.name.text);
		for (const declaration of statement.declarations ?? []) {
			if (declaration.name?.text) topLevel.add(declaration.name.text);
		}
	}
	return { classes, facade, topLevel };
}

/**
 * Whether a statement declares the class or interface `name` - an interface
 * of fields only is a class once parsed (Parser.parseClassOrInterface).
 */
function isNamed(statement: any, name: string): boolean {
	const kind = statement.kind;
	return (kind === asc.NodeKind.ClassDeclaration || kind === asc.NodeKind.InterfaceDeclaration) && statement.name.text === name;
}

/** The declaration of the class or interface `name` in the compile, or null. */
function declarationNamed(parser: any, name: string): any {
	for (const source of parser.sources) {
		const found = source.statements.find((s: any) => isNamed(s, name));
		if (found) return found;
	}
	return null;
}

/** One field's change event: the key it is heard by - `"spawnProtected"`, `"glow.enabled"`, `"glow"` - and its class. */
interface ChangeEvent {
	key: string;
	name: string;
	/** A value's type, or the object field whose members `value` holds. */
	type: ValueType | PlayerField;
}

/** The change events of these fields: one a field, and one each member of an object field. */
function changeEvents(fields: PlayerField[]): ChangeEvent[] {
	return fields.flatMap((field): ChangeEvent[] => {
		const type = field.type;
		const own = `__PlayerChange$${field.name}`;
		if (!isObject(type)) return [{ key: field.name, name: own, type }];
		return [
			{ key: field.name, name: own, type: field },
			...type.members.map(member => ({ key: `${field.name}.${member.name}`, name: `${own}$${member.name}`, type: member.type })),
		];
	});
}

/**
 * A `"playerchange"` listener's `{ field: "spawnProtected" }` and a
 * `PlayerChangeEvent<"spawnProtected">` written as a type, turned into the field's own
 * event class: the call's name becomes `"playerchange:spawnProtected"`, the key
 * ServerEventMap is given for it, and the type the class. A field the compile
 * has no declaration of is a problem, and so is one not written out.
 */
function typeChangeListeners(parser: any, classes: Map<string, string>): string[] {
	const problems: string[] = [];
	const where = (node: any) => `${node.range.source.normalizedPath}:${lineOf(node.range.source.text, node.range.start)}`;
	const known = (field: string, node: any) => {
		if (classes.has(field)) return true;
		const names = [...classes.keys()].map(name => `"${name}"`).join(', ');
		problems.push(`${where(node)}: playerchange - "${field}" is not a field of Player in what this plugin imports (${names || 'it imports none'})`);
		return false;
	};

	for (const source of parser.sources) {
		if (!source.text.includes(CHANGE_EVENT) && !source.text.includes(CHANGE_CLASS)) continue;
		walk(source.statements, (node) => {
			if (node.kind === asc.NodeKind.Call) {
				const field = listenedField(node);
				if (field === null) problems.push(`${where(node)}: playerchange - the field is written out, as the event's name is: { field: "spawnProtected" }`);
				else if (field !== undefined && known(field, node)) node.args[0].value = `${CHANGE_EVENT}:${field}`;
				return;
			}
			const field = node.kind === asc.NodeKind.NamedType ? typedField(node) : undefined;
			if (field === undefined || !known(field, node)) return;
			node.name = asc.Node.createSimpleTypeName(classes.get(field)!, node.name.range);
			node.typeArguments = null;
		});
	}
	return problems;
}

function isStringLiteral(node: any): boolean {
	return node?.kind === asc.NodeKind.Literal && node.literalKind === asc.LiteralKind.String;
}

/** The field a `"playerchange"` listener names in its options; undefined for any other call, null when not written out. */
function listenedField(call: any): string | null | undefined {
	const method = call.expression.kind === asc.NodeKind.PropertyAccess ? call.expression.property.text : '';
	const [type, , options] = call.args;
	if (method !== 'addEventListener' && method !== 'removeEventListener') return undefined;
	if (!isStringLiteral(type) || type.value !== CHANGE_EVENT || !options) return undefined;
	if (options.kind !== asc.NodeKind.Literal || options.literalKind !== asc.LiteralKind.Object) return null;

	const at = options.names.findIndex((name: any) => name.text === 'field');
	if (at < 0) return undefined;
	return isStringLiteral(options.values[at]) ? options.values[at].value : null;
}

/** The field of a `PlayerChangeEvent<"spawnProtected">`; undefined for any other type. */
function typedField(node: any): string | undefined {
	if (node.name.identifier.text !== CHANGE_CLASS || node.name.next || node.typeArguments?.length !== 1) return undefined;
	// A literal in a type is read as `string`: its text is where it stood.
	const range = node.typeArguments[0].range;
	const literal = range.source.text.slice(range.start, range.end).trim().match(/^"([^"\\]*)"$|^'([^'\\]*)'$/);
	return literal ? literal[1] ?? literal[2] : undefined;
}

/** Calls `visit` on every node under `node`, the node first. */
function walk(node: any, visit: (node: any) => void) {
	if (Array.isArray(node)) {
		for (const each of node) walk(each, visit);
		return;
	}
	if (!node || typeof node !== 'object' || typeof node.kind !== 'number') return;
	visit(node);
	for (const key in node) {
		if (key !== 'range') walk(node[key], visit);
	}
}

/** The class an object field reads as: the interface's name, or one of the hood's. */
function objectClass(field: PlayerField): string {
	const type = field.type as ObjectType;
	return type.interface ?? `__AmxtsPlayer_${field.name}`;
}

/** What the AssemblyScript type of a value is, in the hood. */
function hoodType(type: ValueType): string {
	if (type === 'boolean') return 'bool';
	if (type === 'number') return 'f64';
	if (type === 'players') return 'Player[]';
	// A union of literals is text, `true | false | "..."` too: false is the
	// interned "false", as the compiler holds it in a plugin's own types.
	return 'string';
}

/** Reading a value from slot `slot`, key `key` (both expressions). */
function readValue(type: ValueType, slot: string, key: string): string {
	if (type === 'boolean') return `__amxts_pf_get(${slot}, ${key}) != 0`;
	if (type === 'number') return `__amxts_pf_get(${slot}, ${key})`;
	if (type === 'string') return `__amxts_pf_text(${slot}, ${key})`;
	if (type === 'players') return `${PLAYER_LIST}.read(${slot}, ${key})`;
	const first = JSON.stringify(type.literals[0]);
	return type.boolean ? `__amxts_pf_choice(${slot}, ${key}, ${first})` : `__amxts_pf_text_or(${slot}, ${key}, ${first})`;
}

/** Writing `value` (an expression) there. */
function writeValue(type: ValueType, slot: string, key: string, value: string): string {
	if (type === 'boolean') return `__amxts_pf_set(${slot}, ${key}, ${value} ? 1 : 0)`;
	if (type === 'number') return `__amxts_pf_set(${slot}, ${key}, ${value})`;
	if (type === 'players') return `${PLAYER_LIST}.write(${slot}, ${key}, ${value})`;
	return `__amxts_pf_set_text(${slot}, ${key}, ${value})`;
}

/** A value from what the module keeps of it - a number and a text, both expressions - as a change event reads it. */
function decode(type: ValueType, number: string, text: string): string {
	if (type === 'boolean') return `${number} != 0`;
	if (type === 'number') return number;
	if (type === 'string') return text;
	if (type === 'players') return `${PLAYER_LIST}.parse(${text})`;
	return `${type.boolean ? '__amxts_pf_choose' : '__amxts_pf_or'}(${text}, ${JSON.stringify(type.literals[0])})`;
}

/**
 * A field's change event: `value` and `previous` of its type. An object
 * field's holds the object, each member as it is but the one that changed.
 * `@global`, so ServerEventMap's file finds it.
 */
function changeEventClass(event: ChangeEvent): string[] {
	const lines = [`// "${CHANGE_EVENT}" with { field: "${event.key}" }.`, '// @ts-ignore: decorator', `@global export class ${event.name} extends ${CHANGE_CLASS} {`];
	const type = event.type;
	if (typeof type === 'string' || 'literals' in type) {
		const hood = hoodType(type);
		return [
			...lines,
			`\tget value(): ${hood} { return ${decode(type, 'this.__number', 'this.__text')}; }`,
			`\tget previous(): ${hood} { return ${decode(type, 'this.__previousNumber', 'this.__previousText')}; }`,
			'}',
			'',
		];
	}

	const name = objectClass(type);
	const members = (type.type as ObjectType).members.map((member) => {
		const key = JSON.stringify(`${type.name}.${member.name}`);
		const stored = decode(member.type, `__amxts_pf_get(this.__slot, ${key})`, `__amxts_pf_text(this.__slot, ${key})`);
		return `\t\tvalue.${member.name} = this.field == ${key} ? ${decode(member.type, 'n', 't')} : ${stored};`;
	});
	return [
		...lines,
		`\tget value(): ${name} { return this.__object(this.__number, this.__text); }`,
		`\tget previous(): ${name} { return this.__object(this.__previousNumber, this.__previousText); }`,
		'',
		`\t__object(n: f64, t: string): ${name} {`,
		`\t\tconst value = new ${name}();`,
		...members,
		'\t\treturn value;',
		'\t}',
		'}',
		'',
	];
}

/** What a value holds before it is written: what reading it unwritten gives. */
function initial(type: ValueType): string {
	if (type === 'boolean') return 'false';
	if (type === 'number') return '0.0';
	if (type === 'string') return '""';
	if (type === 'players') return '[]';
	return JSON.stringify(type.literals[0]);
}

/** The hidden file: the helpers the accessors call, the holder of the accessors, and the classes they read as. */
export function playerFieldsSource(fields: PlayerField[]): string {
	const accessors: string[] = [];
	const classes: string[] = [];
	const events = changeEvents(fields);
	let lists = false;

	for (const field of fields) {
		const key = JSON.stringify(field.name);
		const type = field.type;
		if (!isObject(type)) {
			if (type === 'players') lists = true;
			accessors.push(
				`\tget ${field.name}(): ${hoodType(type)} { return ${readValue(type, 'this.id', key)}; }`,
				`\tset ${field.name}(value: ${hoodType(type)}) { ${writeValue(type, 'this.id', key, 'value')}; }`,
			);
			continue;
		}

		const name = objectClass(field);
		accessors.push(
			`\tget ${field.name}(): ${name} { const value = new ${name}(); value.__slot = this.id; return value; }`,
			`\tset ${field.name}(value: ${name}) { const mine = this.${field.name}; ${type.members.map(member => `mine.${member.name} = value.${member.name};`).join(' ')} }`,
		);

		const body: string[] = [];
		body.push('\t/** Whose field this is; -1: an object of its own, holding the values below. */', '\t__slot: i32 = -1;');
		for (const member of type.members) {
			if (member.type === 'players') lists = true;
			body.push(`\t__${member.name}: ${hoodType(member.type)} = ${initial(member.type)};`);
		}
		for (const member of type.members) {
			const memberKey = JSON.stringify(`${field.name}.${member.name}`);
			const hood = hoodType(member.type);
			body.push(
				`\tget ${member.name}(): ${hood} { return this.__slot < 0 ? this.__${member.name} : ${readValue(member.type, 'this.__slot', memberKey)}; }`,
				`\tset ${member.name}(value: ${hood}) { if (this.__slot < 0) this.__${member.name} = value; else ${writeValue(member.type, 'this.__slot', memberKey, 'value')}; }`,
			);
		}
		classes.push(
			`// Player.${field.name}: a player's, read and written where the module keeps it, or one of its own.`,
			`export class ${name} {`,
			...body,
			'}',
			'',
		);
	}

	if (lists) {
		classes.push(
			'// A Player[] field: its push writes back, and a player is found by his id.',
			`class ${PLAYER_LIST} extends Array<Player> {`,
			'\t__slot: i32 = -1;',
			'\t__key: string = "";',
			'',
			'\tpush(value: Player): i32 {',
			'\t\tconst length = super.push(value);',
			`\t\tif (this.__slot >= 0) ${PLAYER_LIST}.write(this.__slot, this.__key, this);`,
			'\t\treturn length;',
			'\t}',
			'',
			'\tindexOf(value: Player, fromIndex: i32 = 0): i32 {',
			'\t\tfor (let i = max(fromIndex, 0); i < this.length; i++) {',
			'\t\t\tif (unchecked(this[i]).id == value.id) return i;',
			'\t\t}',
			'\t\treturn -1;',
			'\t}',
			'',
			'\tincludes(value: Player, fromIndex: i32 = 0): bool {',
			'\t\treturn this.indexOf(value, fromIndex) >= 0;',
			'\t}',
			'',
			'\t// A list of its own, from the ids as the module keeps them: "3,5".',
			`\tstatic parse(text: string): ${PLAYER_LIST} {`,
			`\t\tconst list = new ${PLAYER_LIST}();`,
			'\t\tconst ids = text.split(",");',
			'\t\tfor (let i = 0; i < ids.length; i++) {',
			'\t\t\tconst id = I32.parseInt(unchecked(ids[i]));',
			'\t\t\tif (id > 0) list.push(new Player(id));',
			'\t\t}',
			'\t\treturn list;',
			'\t}',
			'',
			`\tstatic read(slot: i32, key: string): ${PLAYER_LIST} {`,
			`\t\tconst list = ${PLAYER_LIST}.parse(__amxts_pf_text(slot, key));`,
			'\t\t// Only now: building the list must not write what it just read.',
			'\t\tlist.__slot = slot;',
			'\t\tlist.__key = key;',
			'\t\treturn list;',
			'\t}',
			'',
			'\tstatic write(slot: i32, key: string, list: Player[]): void {',
			'\t\tlet ids = "";',
			'\t\tfor (let i = 0; i < list.length; i++) ids += (i > 0 ? "," : "") + (<i32>unchecked(list[i]).id).toString();',
			'\t\t__amxts_pf_set_players(slot, key, ids);',
			'\t}',
			'}',
			'',
		);
	}

	return [
		'// GENERATED by scripts/player-fields.ts: the fields plugins add to Player.',
		'// @ts-ignore: decorator',
		'@external("env", "player_data_get") declare function _get(id: i32, key: string): f64;',
		'// @ts-ignore: decorator',
		'@external("env", "player_data_set") declare function _set(id: i32, key: string, value: f64): void;',
		'// @ts-ignore: decorator',
		'@external("env", "player_data_get_text") declare function _getText(id: i32, key: string, out: usize, max: i32): i32;',
		'// @ts-ignore: decorator',
		'@external("env", "player_data_set_text") declare function _setText(id: i32, key: string, value: string): void;',
		'// @ts-ignore: decorator',
		'@external("env", "player_data_set_players") declare function _setPlayers(id: i32, key: string, value: string): void;',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_get(id: i32, key: string): f64 {',
		'\treturn _get(id, key);',
		'}',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_set(id: i32, key: string, value: f64): void {',
		'\t_set(id, key, value);',
		'}',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_text(id: i32, key: string): string {',
		'\tconst length = _getText(id, key, 0, 0);',
		'\tif (length <= 0) return "";',
		'\tconst bytes = new ArrayBuffer(length);',
		'\t_getText(id, key, changetype<usize>(bytes), length);',
		'\treturn String.UTF8.decode(bytes);',
		'}',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_set_text(id: i32, key: string, value: string): void {',
		'\t_setText(id, key, value);',
		'}',
		'',
		'// A union of literals: its first until written.',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_or(text: string, first: string): string {',
		'\treturn text.length > 0 ? text : first;',
		'}',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_text_or(id: i32, key: string, first: string): string {',
		'\treturn __amxts_pf_or(__amxts_pf_text(id, key), first);',
		'}',
		'',
		'// `true | false | "..."`: stored as "true", "false" or the literal. false comes',
		'// back as the interned "false", the one Compiler.makeIsTrueish reads as false.',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_choose(text: string, first: string): string {',
		'\tconst value = __amxts_pf_or(text, first);',
		'\treturn value == "false" ? "false" : value;',
		'}',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_choice(id: i32, key: string, first: string): string {',
		'\treturn __amxts_pf_choose(__amxts_pf_text(id, key), first);',
		'}',
		'',
		'// @ts-ignore: decorator',
		'@global export function __amxts_pf_set_players(id: i32, key: string, ids: string): void {',
		'\t_setPlayers(id, key, ids);',
		'}',
		'',
		...classes,
		...events.flatMap(changeEventClass),
		`// Its members are moved into the facade's Player; the class itself is dropped.`,
		`class ${HOLDER} {`,
		...accessors,
		'}',
		'',
		`// Its members are moved into ServerEventMap: the name a listener's call is given, and its event.`,
		`interface ${CHANGES} {`,
		...events.map(event => `\t"${CHANGE_EVENT}:${event.key}": ${event.name};`),
		'}',
		'',
	].join('\n');
}

/** The `}` that closes the `{` at `open`, past strings and comments; -1 if none. */
function closingBrace(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		const c = text[i];
		if (c === '/' && text[i + 1] === '/') {
			i = text.indexOf('\n', i);
			if (i < 0) return -1;
			continue;
		}
		if (c === '/' && text[i + 1] === '*') {
			i = text.indexOf('*/', i + 2);
			if (i < 0) return -1;
			i++;
			continue;
		}
		if (c === '"' || c === '\'' || c === '`') {
			for (i++; i < text.length && text[i] !== c; i++) {
				if (text[i] === '\\') i++;
			}
			continue;
		}
		if (c === '{') depth++;
		if (c === '}' && --depth === 0) return i;
	}
	return -1;
}

/** Comments as spaces, so what is left keeps its offsets. */
function withoutComments(text: string): string {
	return text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, blank);
}

function blank(text: string): string {
	return text.replace(/[^\r\n]/g, ' ');
}

function lineOf(text: string, at: number): number {
	return text.slice(0, at).split('\n').length;
}
