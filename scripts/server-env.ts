// env(): the settings a plugin reads of the server's environment and of its
// addons/amxts/.env, and the ones a plugin cannot start without.
//
//   const token = env("KZ_MAP_TOKEN");           // required text: the plugin does not start without it
//   const limit = env("KZ_MAX_RECORDS", 100);    // a number, 100 when the server has none
//   const debug = env("KZ_DEBUG", false);        // an on/off switch
//
// Each call's name, and the kind and value of its default, go into the
// plugin's .aot as the section amxts.env, a line each: `KZ_MAP_TOKEN` for a
// required one, `KZ_MAX_RECORDS number 100`, `KZ_DEBUG boolean false`,
// `KZ_MIRROR string https://...`. The module refuses the plugin while a
// required one is nowhere or one is there and not of its kind
// (runtime/src/module.cpp, MissingEnv; envProblems here is the same), and
// `amxts dev` warns of one the server's .env lacks. The name and the default
// are written out in the call: the build reads them there. The module reads
// .env as parseDotenv does.
import ts from 'typescript';

/** The custom section of a plugin that lists the variables it reads: wamrc copies it into the .aot. */
export const ENV_SECTION = 'amxts.env';

/** What a plugin imports the facade's env() from, once the build has rewritten its imports. */
const FACADE = new Set(['~/facade', '@amxts/core']);

/** A number as env() takes one: decimal, a fraction and an exponent allowed. */
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/** The words of an on/off switch, in any case. */
const SWITCH = new Set(['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off']);

/**
 * A .env file's variables: `KEY=value` lines, `#` comments, a value in
 * quotes kept as it is - `#` and spaces too - and one without them cut at a
 * ` #` comment and trimmed. A line without `=` is no variable.
 */
export function parseDotenv(text: string): Map<string, string> {
	const variables = new Map<string, string>();
	for (const raw of text.split('\n')) {
		const line = raw.trim();
		const at = line.indexOf('=');
		if (line.startsWith('#') || at <= 0) continue;
		const value = line.slice(at + 1).trim();
		const quote = value[0];
		const end = quote === '"' || quote === '\'' ? value.indexOf(quote, 1) : -1;
		variables.set(line.slice(0, at).trim(), end > 0 ? value.slice(1, end) : value.replace(/\s+#.*$/, ''));
	}
	return variables;
}

/** One call of the facade's env(): its section line - null when its name or default is not written out - and its line in the file. */
export interface EnvCall {
	entry: string | null;
	line: number;
}

/** A default as the section writes it - `number 100`, `boolean false`, `string text` - or null when it is not written out. */
function defaultOf(node: ts.Expression): string | null {
	if (ts.isStringLiteralLike(node)) return `string ${node.text}`;
	if (ts.isNumericLiteral(node)) return `number ${node.text}`;
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return `number -${node.operand.text}`;
	if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return `boolean ${node.getText()}`;
	return null;
}

/** The calls of the facade's env() in a file, by the name it imports env() under. */
export function envCallsOf(text: string): EnvCall[] {
	if (!text.includes('env')) return [];
	const source = ts.createSourceFile('file.ts', text, ts.ScriptTarget.Latest, true);
	const local = source.statements.flatMap((statement) => {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !FACADE.has(statement.moduleSpecifier.text)) return [];
		const bindings = statement.importClause?.namedBindings;
		return bindings && ts.isNamedImports(bindings) ? bindings.elements.filter(each => (each.propertyName ?? each.name).text === 'env').map(each => each.name.text) : [];
	})[0];
	if (!local) return [];

	const calls: EnvCall[] = [];
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === local) {
			const [name, fallback] = node.arguments;
			const kind = fallback ? defaultOf(fallback) : '';
			calls.push({
				entry: name && ts.isStringLiteralLike(name) && kind !== null ? `${name.text}${kind ? ` ${kind}` : ''}` : null,
				line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
			});
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return calls;
}

/**
 * One compile's section lines: `read` goes into the compile's readFile with
 * every file the plugin reaches, `entries` gives them after, one a name, and
 * `problems` each call whose name or default is not written out; a new one
 * for every compile.
 */
export function envBuild() {
	const entries = new Map<string, string>();
	const problems: string[] = [];
	return {
		read(file: string, text: string): void {
			for (const call of envCallsOf(text)) {
				if (call.entry === null) {
					problems.push(`${file.replace(/\\/g, '/')}:${call.line}: env() takes its name and its default written out - env("MYPLUGIN_TOKEN"), env("MYPLUGIN_LIMIT", 100), env("MYPLUGIN_DEBUG", false), env("MYPLUGIN_URL", "https://...") - the build reads what a plugin needs from the call`);
					continue;
				}
				const name = call.entry.split(' ', 1)[0];
				// Required wherever one call has no default.
				if (!entries.has(name) || call.entry === name) entries.set(name, call.entry);
			}
		},
		entries: () => [...entries.keys()].sort().map(name => entries.get(name)!),
		problems,
	};
}

/**
 * What the section's lines need that `variables` has not, as the module's
 * line names it: `KZ_MAP_TOKEN` for a required one missing,
 * `KZ_MAX_RECORDS as a number` for one there and of another kind.
 */
export function envProblems(entries: string[], variables: Map<string, string>): string[] {
	return entries.flatMap((entry) => {
		const [name, kind] = entry.split(' ');
		const value = variables.get(name);
		if (value === undefined) return kind ? [] : [name];
		if (kind === 'number' && !NUMBER.test(value)) return [`${name} as a number`];
		if (kind === 'boolean' && !SWITCH.has(value.toLowerCase())) return [`${name} as a boolean`];
		return [];
	});
}

/** The section of a plugin's .aot by its name, as the module reads it (AotSection); null when it has none. */
export function aotSection(aot: Uint8Array, wanted: string): string | null {
	const view = new DataView(aot.buffer, aot.byteOffset, aot.byteLength);
	const name = new TextEncoder().encode(`${wanted}\0`);
	for (let at = 8; at + 8 <= aot.length; at = (at + 8 + view.getUint32(at + 4, true) + 3) & ~3) {
		const length = view.getUint32(at + 4, true);
		const body = at + 8;
		if (view.getUint32(at, true) !== 100 || length < 6 + name.length || view.getUint32(body, true) !== 0 || view.getUint16(body + 4, true) !== name.length) continue;
		if (name.every((byte, i) => aot[body + 6 + i] === byte)) return new TextDecoder().decode(aot.subarray(body + 6 + name.length, body + length));
	}
	return null;
}
