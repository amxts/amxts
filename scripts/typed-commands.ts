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
//   interface's fields, typed as the interface types them;
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

/** The generated code for one call: the class of its handler's argument, and the function that registers it. */
function commandCode(index: number, method: 'addCommand' | 'addServerCommand', args: Argument[]): string {
	const player = method === 'addCommand';
	const type = `__AmxtsCommandArgs${index}`;
	const required = args.filter(arg => !arg.optional).length;
	const lastIsText = args.length > 0 && args[args.length - 1].kind.kind === 'text';
	const reads = args.flatMap((arg, at) => {
		const lines = readOf(arg, at, at === args.length - 1, arg.optional ? '\t\t\t' : '\t\t');
		return arg.optional ? [`\t\tif (words.count > ${at}) {`, ...lines, '\t\t}'] : lines;
	});
	return [
		`class ${type} {`,
		...(player ? ['\tplayer!: __AmxtsPlayer;'] : []),
		...args.map(arg => `\t${arg.name}${arg.optional ? '?' : '!'}: ${typeOf(arg)};`),
		'}',
		`function __amxtsCommand${index}(usage: string, handler: (args: ${type}) => void${player ? ', options: __AmxtsCommandOptions = {}' : ''}): void {`,
		`\t__amxtsServer.__${method}(usage, (words: __AmxtsCommandWords): void => {`,
		`\t\tconst args = new ${type}();`,
		...(player ? ['\t\targs.player = words.player!;'] : []),
		...(required > 0 ? [`\t\tif (!words.need(${required})) return;`] : []),
		...reads,
		...(lastIsText ? [] : [`\t\tif (!words.done(${args.length})) return;`]),
		'\t\tif (words.failed) return;',
		'\t\thandler(args);',
		`\t}${player ? ', options' : ''});`,
		'}',
	].join('\n');
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
			functions.push(commandCode(functions.length, method, argumentsOf(node, usage, shapes, at, method === 'addCommand')));
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
	const facade = `import { server as __amxtsServer, Player as __AmxtsPlayer, CommandOptions as __AmxtsCommandOptions, __CommandWords as __AmxtsCommandWords } from "${FACADE}";`;
	return { text: withGenerated(path, out, code, facade), problems };
}
