// Commands with typed arguments: `server.addCommand` and `addServerCommand`.
//
//   interface KickArgs {
//     target: Player;
//     reason?: string;
//   }
//
//   server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
//     target.kick(reason ?? "Kicked by admin");
//   });
//
// The editor types the handler with amxts.d.ts's signatures: the type
// argument's fields and `player`; without one, text for every name the usage
// has. AssemblyScript has neither intersection types nor reflection, so the
// build writes, for each call - reading each file on its way to the compiler
// (Sources.read), after the typed configs:
//
// - the usage's names, `<name>` required and `[name]` optional, checked
//   against the interface both ways: a name in one and not the other, an
//   optional one in one and a required one in the other, a required one after
//   an optional one, stop the build with the place and the fix;
// - a class of the handler's argument: `player` (a player's command) and the
//   interface's fields, typed as the interface types them, which implements
//   the interface, so the argument goes where the interface is expected;
// - a function that registers the command with a parser of its words, each
//   read as its type says (`CommandWords` in the facade): a `number` parsed,
//   a `Player` found by `#userid`, the whole name or a part of it, a union of
//   string literals one of them, a `string` as it is, the last argument, when
//   it is text, the rest of the line. A word that is not what the command
//   takes answers the one who typed it with the usage, and the handler does
//   not run;
// - the call's `server.addCommand<KickArgs>` becomes that function's name,
//   padded, so the rest of the line keeps its columns.
//
// A player's command added at the top level of the file with a function
// declared there by name, `server.addCommand("/hp", onHp)`, gets no closure:
// its parser is a function of its own that calls the handler by its name, and
// the module calls another for the command typed in the console - in the
// facade's place, the words taken from __commandWords.
//
// The interface is read from the source text - a syntax tree, no type checker
// - in this file or imported, as the typed configs read theirs.
import type { ImportReader } from './typed-configs';
import ts from 'typescript';
import { ShapeError, Shapes, withGenerated } from './typed-configs';

/** The facade by its place in the tree, as the files' imports have it once rewritten (scripts/project.ts). */
const FACADE = '~/facade';

/**
 * A call's usage: a string in place; a template whose substitutions make the
 * name, `${name} [value]`, its arguments the text after them; or, from any
 * other expression, a name alone, made at run time, without arguments - a
 * command it is given by a variable takes no words.
 */
function usageOf(node: ts.Expression, typed: boolean, file: ts.SourceFile): Usage {
	if (ts.isStringLiteralLike(node)) return usageOrFail(parseUsage(node.text), node, file);
	if (ts.isTemplateExpression(node)) {
		const text = node.head.text + node.templateSpans.map(span => `$name${span.literal.text}`).join('');
		return usageOrFail(parseUsage(text), node, file);
	}
	if (typed) throw new ShapeError(node, file, 'a command with arguments has its usage in place - "/kick <target>", or `${name} <target>` for a name made at run time: the build reads the arguments from it');
	return { name: '', args: [] };
}

function usageOrFail(usage: Usage | string, node: ts.Node, file: ts.SourceFile): Usage {
	if (typeof usage === 'string') throw new ShapeError(node, file, usage);
	return usage;
}

/** What an argument is read as. */
type Kind = { kind: 'number' } | { kind: 'text' } | { kind: 'player' } | { kind: 'name'; names: string[] };

interface Argument {
	name: string;
	optional: boolean;
	kind: Kind;
}

interface Usage {
	name: string;
	args: { name: string; optional: boolean }[];
}

interface Place { path: string; file: ts.SourceFile }

/** A usage's command name and arguments, in order: `"/kick <target> [reason]"`; a chat phrase, `"say rules"`, has none. Text: what is wrong with it. */
export function parseUsage(usage: string): Usage | string {
	const text = usage.trim();
	if (text.startsWith('say ')) return { name: text, args: [] };
	const [name, ...rest] = text.split(/\s+/);
	if (!name) return 'the usage is empty: write the command\'s name first, e.g. "/hp"';
	const args: Usage['args'] = [];
	for (const word of rest) {
		const match = word.match(/^(?:<([A-Z_$][\w$]*)>|\[([A-Z_$][\w$]*)\])$/i);
		if (!match) return `"${word}" - an argument is one word, <name> or [name]: ${name} <target> [reason]`;
		const optional = match[2] !== undefined;
		const argName = match[1] ?? match[2];
		if (!optional && args.some(arg => arg.optional)) return `<${argName}> - a required argument cannot follow an optional one`;
		if (args.some(arg => arg.name === argName)) return `${argName} - the usage names it twice`;
		args.push({ name: argName, optional });
	}
	return { name, args };
}

/** What one argument's type is read as. */
function kindOf(type: ts.TypeNode, shapes: Shapes, at: Place): Kind {
	if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === 'Player' && !type.typeArguments) return { kind: 'player' };
	const shape = shapes.ofType(type, at);
	if (shape.kind === 'number' || shape.kind === 'text') return { kind: shape.kind };
	if (shape.kind === 'name') return { kind: 'name', names: shape.names };
	throw new ShapeError(type, at.file, `${type.getText(at.file)} - a command's argument is a number, a string, a Player or a union of string literals`);
}

/** The arguments a call's type says: each usage name with its interface field's type; text for each without a type. */
function argumentsOf(call: ts.CallExpression, usage: Usage, shapes: Shapes, at: Place, player: boolean): Argument[] {
	const typeArgument = call.typeArguments?.[0];
	if (!typeArgument) return usage.args.map(arg => ({ ...arg, kind: { kind: 'text' } }));

	if (!ts.isTypeReferenceNode(typeArgument)) {
		throw new ShapeError(typeArgument, at.file, `${typeArgument.getText(at.file)} - a command's arguments are an interface declared beside it, passed by its name: interface KickArgs { target: Player }, then addCommand<KickArgs>(...)`);
	}
	const found = shapes.declaration(typeArgument.typeName, at);
	if (!found || !ts.isInterfaceDeclaration(found.node)) {
		throw new ShapeError(typeArgument, at.file, `${typeArgument.getText(at.file)} - a command's arguments are an interface, declared in this file or imported into it`);
	}

	const fields = new Map<string, Argument & { node: ts.Node }>();
	for (const member of found.node.members) {
		if (!ts.isPropertySignature(member) || !member.type || !ts.isIdentifier(member.name)) {
			throw new ShapeError(member, found.at.file, `${member.getText(found.at.file).trim()} - a command's argument is a field with its type`);
		}
		const name = member.name.text;
		if (name === 'player' && player) throw new ShapeError(member, found.at.file, 'player - the handler gets the player who typed the command as player: name the argument otherwise');
		fields.set(name, { name, optional: !!member.questionToken, kind: kindOf(member.type, shapes, found.at), node: member });
	}

	const type = typeArgument.getText(at.file);
	for (const arg of usage.args) {
		const field = fields.get(arg.name);
		if (!field) throw new ShapeError(call.arguments[0], at.file, `${arg.name} - the usage has it and ${type} does not: add ${arg.name}${arg.optional ? '?' : ''}: string (or a number, a Player) to ${type}, or take it out of the usage`);
		if (field.optional !== arg.optional) {
			throw new ShapeError(field.node, found.at.file, arg.optional
				? `${arg.name} - the usage has it optional, [${arg.name}]: write ${arg.name}?: in ${type}, or <${arg.name}> in the usage`
				: `${arg.name} - the usage requires it, <${arg.name}>: write ${arg.name}: without the ? in ${type}, or [${arg.name}] in the usage`);
		}
	}
	for (const [name, field] of fields) {
		if (!usage.args.some(arg => arg.name === name)) throw new ShapeError(field.node, found.at.file, `${name} - ${type} has it and the usage does not: write <${name}> or [${name}] in the usage, or take it out of ${type}`);
	}
	return usage.args.map(arg => fields.get(arg.name)!);
}

/** The type of a field of the handler's argument in the generated class. */
function typeOf(arg: Argument): string {
	if (arg.kind.kind === 'number') return 'number';
	return arg.kind.kind === 'player' ? '__AmxtsPlayer' : 'string';
}

/** The parser's lines that read the word at `at` into the argument, indented by `tabs`. */
function readOf(arg: Argument, at: number, last: boolean, tabs: string): string[] {
	switch (arg.kind.kind) {
		case 'number': return [`${tabs}args.${arg.name} = words.number(${at});`];
		case 'name': return [`${tabs}args.${arg.name} = words.name(${at}, ${JSON.stringify(arg.kind.names)});`];
		case 'player': return [
			`${tabs}const __${arg.name} = words.target(${at});`,
			`${tabs}if (__${arg.name} == null) return;`,
			`${tabs}args.${arg.name} = __${arg.name};`,
		];
		default: return [`${tabs}args.${arg.name} = words.${last ? 'rest' : 'text'}(${at});`];
	}
}

/**
 * A handler declared by name that the parser calls directly: its name, and the
 * type its parameter is declared with - the interface, which the generated
 * class implements - or null when it takes none.
 */
interface Direct {
	name: string;
	takes: string | null;
}

/**
 * The generated code for one call: the class of its handler's argument - an
 * implementation of `shape`, the interface the call names - and the function
 * that registers it; with `direct`, the parser and the console's function
 * besides, which call the handler by its name.
 */
function commandCode(index: number, method: 'addCommand' | 'addServerCommand', args: Argument[], shape: string | undefined, kept: boolean, direct: Direct | null): string {
	const player = method === 'addCommand';
	const type = `__AmxtsCommandArgs${index}`;
	const required = args.filter(arg => !arg.optional).length;
	const lastIsText = args.length > 0 && args[args.length - 1].kind.kind === 'text';
	const reads = args.flatMap((arg, at) => {
		const lines = readOf(arg, at, at === args.length - 1, arg.optional ? '\t\t\t' : '\t\t');
		return arg.optional ? [`\t\tif (words.count > ${at}) {`, ...lines, '\t\t}'] : lines;
	});
	// The words read into the handler's argument, inside the closure; one tab less in a function of its own.
	const parse = [
		`\t\tconst args = ${kept ? `__amxtsArgs${index}` : `new ${type}()`};`,
		...(player ? ['\t\targs.player = words.player!;'] : []),
		...(required > 0 ? [`\t\tif (!words.need(${required})) return;`] : []),
		...reads,
		...(lastIsText ? [] : [`\t\tif (!words.done(${args.length})) return;`]),
		'\t\tif (words.failed) return;',
	];
	const closure = [
		`function __amxtsCommand${index}(usage: string, handler: (args: ${type}) => void${player ? ', options: __AmxtsCommandOptions = {}' : ''}): void {`,
		`\t__amxtsServer.__${method}(usage, (words: __AmxtsCommandWords): void => {`,
		...parse,
		'\t\thandler(args);',
		`\t}${player ? ', options' : ''});`,
		'}',
	];
	return [
		`class ${type}${shape ? ` implements ${shape}` : ''} {`,
		...(player ? ['\tplayer!: __AmxtsPlayer;'] : []),
		...args.map(arg => `\t${arg.name}${arg.optional ? '?' : '!'}: ${typeOf(arg)};`),
		'}',
		...(kept ? [`const __amxtsArgs${index} = new ${type}();`] : []),
		...(direct ? directCode(index, direct, args.length > 0, parse) : closure),
	].join('\n');
}

/**
 * A command's functions for a handler the parser calls by its name: the
 * parser, the one the module calls for the command typed in the console - a
 * command of no words for a handler of none reads only a word too many - and
 * the one that registers them.
 */
function directCode(index: number, direct: Direct, words: boolean, parse: string[]): string[] {
	const run = `__amxtsCommandRun${index}`;
	const entry = direct.takes == null && !words
		? [
				'\tif (argc > 1) {',
				'\t\t__amxtsCommandUsage(tag, id);',
				'\t\treturn;',
				'\t}',
				'\tconst ambient = __co_ambient_player;',
				'\t__co_ambient_player = id;',
				`\t${direct.name}();`,
				'\t__co_ambient_player = ambient;',
			]
		: [
				'\tconst words = __amxtsCommandWords(tag, id, argc);',
				`\t${run}(words);`,
				'\t__amxtsCommandDone(words);',
			];
	return [
		`function ${run}(words: __AmxtsCommandWords): void {`,
		...parse.map(line => line.slice(1)),
		`\t${direct.name}(${direct.takes != null ? 'args' : ''});`,
		'}',
		`function __amxtsCommandConsole${index}(tag: i32, id: i32, access: i32, unused: i32, argc: i32): void {`,
		...entry,
		'}',
		`function __amxtsCommand${index}(usage: string, handler: (args: ${direct.takes ?? `__AmxtsCommandArgs${index}`}) => void, options: __AmxtsCommandOptions = {}): void {`,
		`\t__amxtsServer.__addCommand(usage, ${run}, options, __amxtsCommandConsole${index}.index);`,
		'}',
	];
}

/**
 * The handler the parser can call by its name: a function declared by name at
 * the top level of the file, not async, not generic, given to a player's
 * command added at the top level too - where no other declaration can take
 * its name.
 */
function directOf(call: ts.CallExpression, method: string, file: ts.SourceFile): Direct | null {
	const handler = call.arguments[1];
	if (method !== 'addCommand' || !handler || !ts.isIdentifier(handler)) return null;
	if (!ts.isExpressionStatement(call.parent) || call.parent.parent !== file) return null;
	const fn = file.statements.find((each): each is ts.FunctionDeclaration => ts.isFunctionDeclaration(each) && each.name?.text === handler.text);
	if (!fn || fn.typeParameters || fn.modifiers?.some(each => each.kind === ts.SyntaxKind.AsyncKeyword)) return null;
	const parameter = fn.parameters[0];
	if (parameter && !parameter.type) return null;
	return { name: handler.text, takes: parameter ? parameter.type!.getText(file) : null };
}

/**
 * Whether a handler can keep nothing of the object its arguments come in: it
 * takes none, or takes them apart as it starts - `({ player, target }) =>`,
 * or a function of this file declared so. Then every call of the command
 * hands it the same object, filled anew: a command allocates nothing. One
 * with an optional argument gets a new one, which leaves an argument not
 * typed unset.
 */
function keepsNothing(handler: ts.Expression | undefined, file: ts.SourceFile): boolean {
	const named = handler && ts.isIdentifier(handler) ? handler.text : null;
	const fn = handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
		? handler
		: file.statements.find((each): each is ts.FunctionDeclaration => ts.isFunctionDeclaration(each) && named != null && each.name?.text === named);
	if (!fn) return false;
	const first = fn.parameters[0];
	return !first || (ts.isObjectBindingPattern(first.name) && first.name.elements.every(each => !each.dotDotDotToken));
}

export interface TypedCommands {
	text: string;
	problems: string[];
}

/** The file with its commands' calls made the generated functions'; what does not build, with its place. */
export function typedCommands(path: string, display: string, text: string, imports: ImportReader): TypedCommands {
	if (!text.includes('addCommand') && !text.includes('addServerCommand')) return { text, problems: [] };

	const shapes = new Shapes(imports);
	const file = shapes.parsed(path, text);
	// The facade's `server`, by the names this file imports it as.
	const servers = new Set<string>();
	for (const statement of file.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== FACADE) continue;
		const bindings = statement.importClause?.namedBindings;
		if (!bindings || !ts.isNamedImports(bindings)) continue;
		for (const element of bindings.elements) {
			if ((element.propertyName ?? element.name).text === 'server') servers.add(element.name.text);
		}
	}
	if (!servers.size) return { text, problems: [] };

	const edits: { start: number; end: number; with: string }[] = [];
	const functions: string[] = [];
	const problems: string[] = [];
	const at: Place = { path, file };

	const visit = (node: ts.Node) => {
		ts.forEachChild(node, visit);
		if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
		const method = node.expression.name.text;
		if (method !== 'addCommand' && method !== 'addServerCommand') return;
		if (!ts.isIdentifier(node.expression.expression) || !servers.has(node.expression.expression.text)) return;

		try {
			const usageNode = node.arguments[0];
			if (!usageNode) throw new ShapeError(node, file, 'the usage is missing: server.addCommand("/hp", ({ player }) => ...)');
			const usage = usageOf(usageNode, !!node.typeArguments?.length, file);
			const name = `__amxtsCommand${functions.length}`;
			const shape = node.typeArguments?.[0]?.getText(file);
			const args = argumentsOf(node, usage, shapes, at, method === 'addCommand');
			const kept = !args.some(arg => arg.optional) && keepsNothing(node.arguments[1], file);
			functions.push(commandCode(functions.length, method, args, shape, kept, directOf(node, method, file)));
			const start = node.expression.getStart(file);
			const end = node.arguments.pos - 1;
			edits.push({ start, end, with: name.padEnd(end - start) });
		} catch (problem) {
			if (!(problem instanceof ShapeError)) throw problem;
			const place = problem.file.getLineAndCharacterOfPosition(problem.node.getStart(problem.file));
			const where = problem.file === file ? display : problem.file.fileName;
			problems.push(`${where}:${place.line + 1}:${place.character + 1}: server.${method} - ${problem.message}`);
		}
	};
	visit(file);

	if (!edits.length) return { text, problems };

	let out = text;
	for (const edit of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, edit.start) + edit.with + out.slice(edit.end);

	const code = ['// GENERATED by scripts/typed-commands.ts: the commands this file adds, each word read as its type says.', ...functions].join('\n');
	const facade = `import { server as __amxtsServer, Player as __AmxtsPlayer, CommandOptions as __AmxtsCommandOptions, __CommandWords as __AmxtsCommandWords, __commandWords as __amxtsCommandWords, __commandDone as __amxtsCommandDone, __commandUsage as __amxtsCommandUsage } from "${FACADE}";`;
	return { text: withGenerated(path, out, code, facade), problems };
}
