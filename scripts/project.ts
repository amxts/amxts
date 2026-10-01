// A project: its amxts.config.ts, the module packages it lists, and the one
// tree of sources a plugin compiles from.
//
//   // amxts.config.ts
//   export default defineConfig({
//     modules: ["@amxts/config-core", "@amxts/menu-core"],
//     menus: { file: "myplugin/menu" },
//   });
//
// A module package says what it is in package.json:
//
//   "amxts": { "module": "src/index.ts", "natives": "src/natives.ts", "include": "include/menu_core.inc" }
//
// - or, for a library, `"amxts": { "module": "src/index.ts", "library": true }`:
// code compiled into each plugin that imports it, as an npm library is, with
// no instance on the server, no owner, no proxy and no defineModule.
//
// and in its module file, with the global defineModule:
//
//   export default defineModule<MenuCoreOptions>({     // src/index.ts
//     meta: { name: "menu-core", configKey: "menus" },
//     requires: ["@amxts/config-core"],
//     defaults: { folder: "" },
//     imports: [{ from: "@amxts/menu-core", as: "menus" }],
//     setup(options) { ... },
//   });
//
// The config is read here, at build time, with the build's own TypeScript
// runtime - it is configuration, not plugin code. A module's definition is
// read from its source with the TypeScript parser: meta, requires, defaults
// and imports are literals, and `setup` becomes a plain function of the module
// that its top level calls with the merged options (module defaults, then
// the config under configKey) - so it runs where the module runs: in the
// owner plugin, once, when the server loads it.
//
// The tree asc reads is virtual. `~/` is the core's as/ folder, and over it:
//
//   ~/<file>                    the project's plugins folder first, then the core's
//   ~/modules/<name>.ts         a module package's module file
//   ~/modules/<name>/<path>     any other file of that package
//   ~/<name>.ts                 the module's owner: its natives file, or one
//                               generated for a module without natives
//
// Imports are rewritten on the way in: "@amxts/core" is the facade,
// "@amxts/core/<x>" is ~/<x>, a module package's name is ~/modules/<name>,
// and a relative import inside a package is the same file by its place in
// the tree. So everything downstream - the shared-modules proxy, the natives,
// the fields on Player - sees modules where it always has. Before that a
// plugin's file gets the imports of what it uses without importing it
// (scripts/auto-imports.ts), so they are rewritten like its own.
import type { AutoImport, ModuleImport } from './auto-imports';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { coreImports, importedName, importTable, withAutoImports } from './auto-imports';
import { includeDirs } from './includes';
import { existsSync, readdirSync, readFileSync, statSync } from './tracked-fs';
import { typedCommands } from './typed-commands';
import { typedConfigs } from './typed-configs';

/** The core's folder: the package this file ships in. */
export const CORE_DIR = resolve(fileURLToPath(new URL('..', import.meta.url)));
/** What `~/` is: the core's facade, natives and libraries. */
export const CORE_PLUGINS = join(CORE_DIR, 'as');

export const CONFIG_FILE = 'amxts.config.ts';

/**
 * The facade a compile reads, whose exports plugins use without an import:
 * the core's - or, on a server, where the plugins folder holds the core's
 * as/, the one there.
 */
function facadeFile(dir: string): string {
	const core = join(CORE_PLUGINS, 'facade.ts');
	return existsSync(core) ? core : join(dir, 'facade.ts');
}

/**
 * A project's folders of game files and where each goes in the game folder,
 * as the amxts-server image lays a project out (docker/server/start.sh): its
 * modules (.so) and Pawn plugins in addons, its dictionaries in data, the
 * files its plugins precache in the game's own folders.
 */
export const PROJECT_GAME_FOLDERS: [string, string][] = [
	['addons', 'addons'],
	['data', 'addons/amxmodx/data'],
	...['maps', 'models', 'sound', 'sprites', 'gfx', 'overviews', 'resource'].map((dir): [string, string] => [dir, dir]),
];

/** What amxts.config.ts exports, before any module's own key. */
export interface AmxtsConfig {
	modules?: string[];
	/** Where the project's plugins are, from the project's folder: "plugins". */
	pluginsDir?: string;
	/** Where the build writes the .aot files and plugins.ini: "dist". */
	outDir?: string;
	/** The server the project is for, "rehlds" or "hlds": which includes the amxts command fetches without a server. */
	target?: 'rehlds' | 'hlds';
	/** `{ autoImport: false }`: plugins import what they use themselves. */
	imports?: { autoImport?: boolean };
	/** The modules Pawn plugins call the natives of: built even when no plugin of the project uses them. */
	pawn?: string[];
	[configKey: string]: unknown;
}

export type OptionValue = string | number | boolean | null | OptionValue[] | { [key: string]: OptionValue };
export type Options = Record<string, OptionValue>;

/** What a module file's defineModule({...}) says, read from its source. */
export interface ModuleDefinition {
	name: string | null;
	configKey: string | null;
	requires: string[];
	defaults: Options;
	/** What plugins use without an import: `[{ from: "@amxts/menu-core", as: "menus" }]`, `[{ from: "@amxts/resemiclip", name: "semiclip" }]`. */
	imports: ModuleImport[];
	/** `defineModule<MenuCoreOptions>`: the type setup's parameter is. */
	optionsType: string | null;
	hasSetup: boolean;
}

export interface ModulePackage {
	/** The package name: "@amxts/menu-core". */
	name: string;
	/** Its name without the scope - the module's name in the tree and on the server: "menu-core". */
	short: string;
	dir: string;
	/** The module file: the API plugins import. */
	module: string;
	/**
	 * `"library": true`: compiled into each plugin that imports it, like an
	 * npm library - no instance on the server, so no owner, no proxy, no
	 * defineModule, natives, include or test kit.
	 */
	library: boolean;
	/**
	 * Its Pawn natives: the plugin that owns the module - its one instance on
	 * the server. Without one, the build generates an owner that only runs it.
	 */
	natives: string | null;
	/** The Pawn include the natives implement. */
	include: string | null;
	/**
	 * `"contract": true`: the include is the original's, kept as it is - the
	 * build checks the natives against it instead of writing it.
	 */
	contract: boolean;
	/**
	 * Its test kit - `"amxts": { "testing": "testing/index.ts" }` - a file for
	 * the test runner whose default export extends the fake server with what
	 * the module needs there (defineTestKit in @amxts/core/test-utils).
	 */
	testing: string | null;
	version: string;
	description: string;
	definition: ModuleDefinition;
}

export interface Project {
	dir: string;
	config: AmxtsConfig | null;
	pluginsDir: string;
	outDir: string;
	/** Every module package found: the project itself, modules/*, node_modules. */
	packages: ModulePackage[];
	/** The ones this project uses, in load order: every module after what it requires. */
	modules: ModulePackage[];
	/** What plugins use without an import - the facade's API, the modules' namespaces - unless the config turns it off. */
	autoImports: AutoImport[];
	/** What is wrong with the project: a missing module, a requirement not listed. */
	problems: string[];
}

// ---------------------------------------------------------------- definitions

/** The literal value of an expression in a module definition, or a problem. */
function literal(node: ts.Expression, where: string, problems: string[]): OptionValue {
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, where, problems);
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isNumericLiteral(node)) return Number(node.text);
	if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
	if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (node.kind === ts.SyntaxKind.NullKeyword) return null;
	if (ts.isArrayLiteralExpression(node)) return node.elements.map((element, i) => literal(element, `${where}[${i}]`, problems));
	if (ts.isObjectLiteralExpression(node)) {
		const object: Options = {};
		for (const property of node.properties) {
			if (!ts.isPropertyAssignment(property) || !property.name || !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) {
				problems.push(`${where}: only \`key: value\` goes here`);
				continue;
			}
			object[property.name.text] = literal(property.initializer, `${where}.${property.name.text}`, problems);
		}
		return object;
	}
	problems.push(`${where}: a literal goes here - a string, a number, a boolean, an array or an object of them - not "${node.getText()}"`);
	return null;
}

/** The `export default defineModule(...)` statement of a module file, if it has one. */
function definitionCall(file: ts.SourceFile): { statement: ts.ExportAssignment; call: ts.CallExpression } | null {
	for (const statement of file.statements) {
		if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
		const call = statement.expression;
		if (ts.isCallExpression(call) && ts.isIdentifier(call.expression) && call.expression.text === 'defineModule') return { statement, call };
	}
	return null;
}

function parse(path: string, text: string) {
	return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** A module file's definition; null when it has none. Throws on one it cannot read. */
export function readDefinition(path: string, text = readFileSync(path, 'utf8')): ModuleDefinition | null {
	if (!text.includes('defineModule')) return null;
	const found = definitionCall(parse(path, text));
	if (!found) return null;

	const where = `${path.replace(/\\/g, '/')}: defineModule`;
	const problems: string[] = [];
	const [argument] = found.call.arguments;
	if (!argument || !ts.isObjectLiteralExpression(argument)) throw new Error(`${where} takes an object literal: { meta, requires, defaults, imports, setup }`);

	const definition: ModuleDefinition = {
		name: null,
		configKey: null,
		requires: [],
		defaults: {},
		imports: [],
		optionsType: found.call.typeArguments?.[0]?.getText() ?? null,
		hasSetup: false,
	};

	for (const property of argument.properties) {
		const key = property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : '';
		if (key === 'setup') {
			definition.hasSetup = true;
			continue;
		}
		if (!ts.isPropertyAssignment(property)) {
			problems.push(`${where}: ${key || 'this member'} - only setup is a function`);
			continue;
		}
		const value = literal(property.initializer, `${where} ${key}`, problems);
		if (key === 'meta') {
			const meta = (value ?? {}) as Options;
			if (typeof meta.name === 'string') definition.name = meta.name;
			if (typeof meta.configKey === 'string') definition.configKey = meta.configKey;
		} else if (key === 'requires') {
			if (!Array.isArray(value) || value.some(each => typeof each !== 'string')) problems.push(`${where} requires: a list of package names`);
			else definition.requires = value as string[];
		} else if (key === 'defaults') {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) problems.push(`${where} defaults: an object`);
			else definition.defaults = value as Options;
		} else if (key === 'imports') {
			const named = (each: Options) => [each.as, each.name].filter(one => one !== undefined);
			const valid = Array.isArray(value) && value.every(each => isObject(each) && typeof each.from === 'string' && Object.keys(each).length === 2
				&& named(each).length === 1 && named(each).every(one => typeof one === 'string' && /^[A-Z_$][\w$]*$/i.test(one)));
			if (!valid) problems.push(`${where} imports: a list of { from, as } or { from, name } - { from: "@you/greeter", as: "greeter" } is the module as a namespace, { from: "@you/greeter", name: "greeter" } its export greeter; plugins use either without an import`);
			else definition.imports = value as unknown as ModuleImport[];
		} else {
			problems.push(`${where}: "${key}" is not a part of a module - meta, requires, defaults, imports and setup are`);
		}
	}

	if (definition.hasSetup && !definition.optionsType && Object.keys(definition.defaults).length > 0) {
		problems.push(`${where}: name the options' type - defineModule<MyOptions>({ ... }) - setup's parameter is that type`);
	}
	if (problems.length) throw new Error(problems.join('\n'));
	return definition;
}

/** A string of spaces as long as `text`, its line breaks kept: offsets after it stay put. */
function blank(text: string): string {
	return text.replace(/[^\r\n]/g, ' ');
}

/** An options value as AssemblyScript source: an object literal the options' interface takes. */
export function optionsSource(value: OptionValue): string {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) return `[${value.map(optionsSource).join(', ')}]`;
	return `{ ${Object.entries(value).map(([key, each]) => `${/^[A-Z_$][\w$]*$/i.test(key) ? key : JSON.stringify(key)}: ${optionsSource(each)}`).join(', ')} }`;
}

/**
 * The module file as asc reads it: `export default defineModule({ ... })`
 * becomes `function __amxts_setup(options: T) { ... }`, in the same place and
 * on the same lines, and the file's last line calls it with `options`. What
 * the editor needs and asc cannot read - `declare module "@amxts/core"` with
 * the module's ModuleOptions - is blanked.
 */
export function moduleSource(path: string, text: string, options: Options): string {
	let out = withoutOptionsAugmentation(text);
	if (!out.includes('defineModule')) return out;
	const file = parse(path, out);
	const found = definitionCall(file);
	if (!found) return out;

	const definition = found.call.arguments[0] as ts.ObjectLiteralExpression;
	const setup = definition.properties.find(p => p.name && ts.isIdentifier(p.name) && p.name.text === 'setup');
	let fn: ts.FunctionLikeDeclaration | null = null;
	if (setup && ts.isMethodDeclaration(setup)) fn = setup;
	else if (setup && ts.isPropertyAssignment(setup) && (ts.isArrowFunction(setup.initializer) || ts.isFunctionExpression(setup.initializer))) fn = setup.initializer;

	const start = found.statement.getStart(file);
	const end = found.statement.end;
	if (!fn || !fn.body || !ts.isBlock(fn.body)) return out.slice(0, start) + blank(out.slice(start, end)) + out.slice(end);

	// A setup that takes no options - a module without any - is called without them.
	const type = found.call.typeArguments?.[0]?.getText(file) ?? 'Record<string, string>';
	const param = fn.parameters[0]?.name.getText(file);
	const head = fn.getStart(file);
	const body = fn.body.getStart(file);
	out = [
		out.slice(0, start),
		blank(out.slice(start, head)),
		`function __amxts_setup(${param ? `${param}: ${type}` : ''}): void `,
		out.slice(body, fn.body.end),
		blank(out.slice(fn.body.end, end)),
		out.slice(end),
	].join('');
	return `${out.replace(/\s*$/, '')}\n__amxts_setup(${param ? optionsSource(options) : ''});\n`;
}

/**
 * `declare module "@amxts/core" { interface ModuleOptions { ... } }` blanked:
 * it types amxts.config.ts in the editor and means nothing to asc. Anything
 * else in the block (Player's fields) is left for scripts/player-fields.ts.
 */
function withoutOptionsAugmentation(text: string): string {
	if (!text.includes('ModuleOptions')) return text;
	let out = text;
	for (const match of text.matchAll(/declare\s+module\s+["'](?:@amxts\/core|~\/facade)["']\s*\{/g)) {
		const open = match.index! + match[0].length - 1;
		const close = closing(text, open);
		if (close < 0) continue;
		let block = out.slice(open + 1, close);
		for (const inner of block.matchAll(/(?:export\s+)?interface\s+ModuleOptions\s*\{/g)) {
			const innerOpen = inner.index! + inner[0].length - 1;
			const innerClose = closing(block, innerOpen);
			if (innerClose < 0) continue;
			block = block.slice(0, inner.index!) + blank(block.slice(inner.index!, innerClose + 1)) + block.slice(innerClose + 1);
		}
		const emptied = !/\S/.test(block.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''));
		out = emptied
			? out.slice(0, match.index!) + blank(out.slice(match.index!, close + 1)) + out.slice(close + 1)
			: out.slice(0, open + 1) + block + out.slice(close);
	}
	return out;
}

function closing(text: string, open: number): number {
	let depth = 0;
	for (let i = open; i < text.length; i++) {
		if (text[i] === '{') depth++;
		else if (text[i] === '}' && --depth === 0) return i;
	}
	return -1;
}

// ---------------------------------------------------------------- packages

function readJson(path: string): any {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

/** The module package in `dir`, when its package.json has an "amxts" field with a module. */
export function readPackage(dir: string): ModulePackage | null {
	const json = readJson(join(dir, 'package.json'));
	const amxts = json?.amxts;
	if (!json?.name || !amxts || typeof amxts.module !== 'string') return null;

	const module = resolve(dir, amxts.module);
	if (!existsSync(module)) throw new Error(`${json.name}: its module ${amxts.module} is not there (package.json, "amxts".module)`);
	const natives = typeof amxts.natives === 'string' ? resolve(dir, amxts.natives) : null;
	if (natives && !existsSync(natives)) throw new Error(`${json.name}: its natives ${amxts.natives} are not there (package.json, "amxts".natives)`);
	const include = typeof amxts.include === 'string' ? resolve(dir, amxts.include) : null;

	const short = String(json.name).replace(/^@[^/]+\//, '');
	const library = amxts.library === true;
	const owned = ['natives', 'include', 'contract', 'testing'].filter(key => amxts[key] !== undefined);
	if (library && owned.length) {
		throw new Error(`${json.name}: a library is compiled into each plugin that imports it and runs no plugin of its own - it has no ${owned.map(key => `"${key}"`).join(', ')} (package.json, "amxts")`);
	}
	const read = readDefinition(module);
	if (library && read) {
		throw new Error(`${json.name}: a library has no defineModule - no options, no instance on the server; plugins import what it exports. Leave "library": true out to make it a module`);
	}
	const definition = read ?? { name: null, configKey: null, requires: [], defaults: {}, imports: [], optionsType: null, hasSetup: false };
	if (definition.name && definition.name !== short) {
		throw new Error(`${json.name}: defineModule's meta.name is "${definition.name}" - it is the package's name without the scope, "${short}"`);
	}
	// A module gives its own API, whose one instance runs on the server; what
	// another package exports is that package's to give.
	const foreign = definition.imports.find(each => each.from !== json.name);
	if (foreign) throw new Error(`${json.name}: defineModule's imports give ${importedName(foreign)} from "${foreign.from}" - a module gives its own API, from "${json.name}"`);
	if (amxts.contract === true && !include) throw new Error(`${json.name}: "contract": true needs the include it keeps ("amxts".include)`);
	if (include && amxts.contract === true && !existsSync(include)) throw new Error(`${json.name}: its contract ${amxts.include} is not there (package.json, "amxts".include)`);
	const testing = typeof amxts.testing === 'string' ? resolve(dir, amxts.testing) : null;
	if (testing && !existsSync(testing)) throw new Error(`${json.name}: its test kit ${amxts.testing} is not there (package.json, "amxts".testing)`);
	return { name: json.name, short, dir: resolve(dir), module, library, natives, include, contract: amxts.contract === true, testing, version: String(json.version ?? '0.0.0'), description: String(json.description ?? ''), definition };
}

/**
 * Every module package the project can see: itself, its modules/ folder, then
 * node_modules - its own, then each folder's above it, as Node looks for a
 * package: a module's playground finds what the module installed.
 */
function discover(dir: string): ModulePackage[] {
	const found = new Map<string, ModulePackage>();
	const add = (packageDir: string) => {
		if (!existsSync(join(packageDir, 'package.json'))) return;
		const found_ = readPackage(packageDir);
		if (found_ && !found.has(found_.name)) found.set(found_.name, found_);
	};
	const each = (folder: string, visit: (path: string, name: string) => void) => {
		if (!existsSync(folder)) return;
		for (const name of readdirSync(folder)) {
			const path = join(folder, name);
			// A package that cannot be read says why; only a path that cannot be stat'ed is skipped.
			let directory = false;
			try {
				directory = statSync(path).isDirectory();
			} catch {}
			if (directory) visit(path, name);
		}
	};

	add(dir);
	// A `file:` dependency is read where it is: a module being written beside
	// the project, installed or not (Bun copies a file: folder, npm links it).
	const json = readJson(join(dir, 'package.json'));
	for (const deps of [json?.dependencies, json?.devDependencies, json?.peerDependencies]) {
		for (const spec of Object.values(deps ?? {})) {
			if (typeof spec === 'string' && spec.startsWith('file:')) add(resolve(dir, spec.slice(5)));
		}
	}
	each(join(dir, 'modules'), path => add(path));
	for (let at = resolve(dir); ; at = dirname(at)) {
		each(join(at, 'node_modules'), (path, name) => {
			if (name.startsWith('.')) return;
			if (name.startsWith('@')) each(path, inner => add(inner));
			else add(path);
		});
		if (dirname(at) === at) break;
	}
	return [...found.values()];
}

// ---------------------------------------------------------------- config

/** amxts.config.ts's default export, read with a global defineConfig; null without the file. */
export function readConfig(dir: string): AmxtsConfig | null {
	const path = join(dir, CONFIG_FILE);
	if (!existsSync(path)) return null;

	const scope = globalThis as any;
	scope.defineConfig ??= (config: AmxtsConfig) => config;
	const require = createRequire(import.meta.url);
	delete require.cache[path];
	let loaded;
	try {
		loaded = require(path);
	} catch (error) {
		// Bun's parse error carries where it is, not a stack.
		const at = (error as { position?: { line: number; column: number; lineText: string } }).position;
		const where = at ? `:${at.line}:${at.column + 1}` : '';
		const line = at ? `\n  ${at.lineText.trim()}` : '';
		throw new Error(`${CONFIG_FILE}${where} - ${(error as Error).message}${line}`);
	}
	const config = loaded?.default ?? loaded;
	if (!config || typeof config !== 'object') throw new Error(`${CONFIG_FILE}: export default defineConfig({ modules: [...] })`);
	if (config.modules !== undefined && (!Array.isArray(config.modules) || config.modules.some((m: unknown) => typeof m !== 'string'))) {
		throw new Error(`${CONFIG_FILE}: modules is a list of package names - ["@amxts/menu-core"]`);
	}
	if (config.target !== undefined && config.target !== 'rehlds' && config.target !== 'hlds') {
		throw new Error(`${CONFIG_FILE}: target is "rehlds" (ReHLDS, ReGameDLL and ReAPI) or "hlds" (plain HLDS), not ${JSON.stringify(config.target)}`);
	}
	if (config.imports !== undefined && (!isObject(config.imports) || Object.entries(config.imports).some(([key, value]) => key !== 'autoImport' || typeof value !== 'boolean'))) {
		throw new Error(`${CONFIG_FILE}: imports is { autoImport: false } - plugins import what they use themselves - or left out`);
	}
	if (config.pawn !== undefined && (!Array.isArray(config.pawn) || config.pawn.some((m: unknown) => typeof m !== 'string'))) {
		throw new Error(`${CONFIG_FILE}: pawn is a list of package names, the modules whose natives Pawn plugins call - ["@amxts/menu-core"]`);
	}
	return config;
}

/** Every listed module after what it requires, in the order the config lists them otherwise. */
function ordered(listed: ModulePackage[], problems: string[]): ModulePackage[] {
	const byName = new Map(listed.map(pkg => [pkg.name, pkg]));
	const out: ModulePackage[] = [];
	const state = new Map<string, 'visiting' | 'done'>();
	const visit = (pkg: ModulePackage, chain: string[]) => {
		if (state.get(pkg.name) === 'done') return;
		if (state.get(pkg.name) === 'visiting') {
			problems.push(`${CONFIG_FILE}: modules require each other in a circle - ${[...chain, pkg.name].join(' -> ')}`);
			return;
		}
		state.set(pkg.name, 'visiting');
		for (const required of pkg.definition.requires) {
			const dependency = byName.get(required);
			if (dependency) visit(dependency, [...chain, pkg.name]);
		}
		state.set(pkg.name, 'done');
		out.push(pkg);
	};
	for (const pkg of listed) visit(pkg, []);
	return out;
}

const projects = new Map<string, { stamp: string; project: Project }>();

function stampOf(dir: string): string {
	const path = join(dir, CONFIG_FILE);
	return existsSync(path) ? String(statSync(path).mtimeMs) : 'none';
}

/**
 * The project in `dir`: its config, its modules in load order and what is
 * wrong with them. Without amxts.config.ts every module package it can see
 * is in use, in dependency order - a module's own repository, testing itself.
 */
export function loadProject(dir = process.cwd()): Project {
	const at = resolve(dir);
	const stamp = stampOf(at);
	const known = projects.get(at);
	if (known && known.stamp === stamp) return known.project;

	const config = readConfig(at);
	const packages = discover(at);
	const problems: string[] = [];
	const byName = new Map(packages.map(pkg => [pkg.name, pkg]));

	let listed: ModulePackage[];
	if (config) {
		listed = [];
		for (const name of config.modules ?? []) {
			const pkg = byName.get(name);
			if (!pkg) problems.push(`${CONFIG_FILE}: module "${name}" is not installed - no package of that name with an "amxts" field in modules/ or node_modules`);
			else if (!listed.includes(pkg)) listed.push(pkg);
		}
		// What a listed module requires comes along: `modules:
		// ["@amxts/menu-core"]` is enough. The package manager has put it in
		// node_modules already (a peer dependency).
		for (let i = 0; i < listed.length; i++) {
			for (const required of listed[i].definition.requires) {
				if (listed.some(each => each.name === required)) continue;
				const pkg = byName.get(required);
				if (pkg) listed.push(pkg);
				else problems.push(`${CONFIG_FILE}: ${listed[i].name} requires ${required}, which is not installed - npm install ${required}`);
			}
		}
	} else {
		listed = packages;
	}

	const pluginsDir = resolve(at, config?.pluginsDir ?? 'plugins');
	const modules = ordered(listed, problems);
	const project: Project = {
		dir: at,
		config,
		pluginsDir: existsSync(pluginsDir) ? pluginsDir : CORE_PLUGINS,
		outDir: resolve(at, config?.outDir ?? 'dist'),
		packages,
		modules,
		autoImports: config?.imports?.autoImport === false
			? []
			: [...importTable(coreImports(facadeFile(at)), modules.map(pkg => ({ name: pkg.name, imports: pkg.definition.imports })), problems).values()],
		problems,
	};
	if (config) checkOptionKeys(project, problems);
	projects.set(at, { stamp, project });
	return project;
}

/** Keys under a module's configKey that it has no default for: a typo, or an option it does not have. */
function checkOptionKeys(project: Project, problems: string[]) {
	// A key no listed module takes would be dropped without a word.
	const keys = new Set(['modules', 'pluginsDir', 'outDir', 'target', 'imports', 'pawn', ...project.modules.map(pkg => pkg.definition.configKey).filter(Boolean)]);
	for (const key of Object.keys(project.config!)) {
		if (!keys.has(key)) problems.push(`${CONFIG_FILE}: ${key} - no module in modules takes it (its defineModule has no configKey "${key}")`);
	}
	for (const name of project.config!.pawn ?? []) {
		if (!project.modules.some(pkg => pkg.name === name)) problems.push(`${CONFIG_FILE}: pawn names ${name}, which modules does not list`);
	}

	for (const pkg of project.modules) {
		const key = pkg.definition.configKey;
		if (!key || project.config![key] === undefined) continue;
		const given = project.config![key];
		if (given === null || typeof given !== 'object' || Array.isArray(given)) {
			problems.push(`${CONFIG_FILE}: ${key} is ${pkg.name}'s options - an object`);
			continue;
		}
		for (const option of Object.keys(given)) {
			if (!(option in pkg.definition.defaults)) {
				problems.push(`${CONFIG_FILE}: ${key}.${option} - ${pkg.name} has no such option (${Object.keys(pkg.definition.defaults).join(', ') || 'it has none'})`);
			}
		}
	}
}

function isObject(value: unknown): value is Record<string, OptionValue> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Defaults, then the config's values over them: objects merged key by key, anything else replaced. */
export function mergeOptions(defaults: Options, given: unknown): Options {
	if (!isObject(given)) return { ...defaults };
	const out: Options = { ...defaults };
	for (const [key, value] of Object.entries(given)) {
		if (value === undefined) continue;
		out[key] = isObject(out[key]) && isObject(value) ? mergeOptions(out[key] as Options, value) : value as OptionValue;
	}
	return out;
}

/** The options a module's setup gets in this project. */
export function optionsOf(project: Project, definition: ModuleDefinition): Options {
	const key = definition.configKey;
	return mergeOptions(definition.defaults, key && project.config ? project.config[key] : undefined);
}

/**
 * Everything in the core's as/ that is not a plugin: the facade a plugin
 * imports, the kit a module imports and the generated native layer under them.
 */
export const NOT_PLUGINS = new Set(['facade.ts', 'kit.ts', 'promise.ts', 'vector.ts', 'effects.ts', 'fetch.ts', 'fs.ts', 'os.ts', 'natives.ts', 'remote.ts', 'constants.ts', 'events.ts', 'entities.ts', 'flags.ts', 'hooks.ts', 'hlds.ts']);

/**
 * The core's API a plugin imports, by the package's name, and its file in
 * the core's as/ - its place in the tree. package.json's "exports" gives
 * the same files to the editor.
 */
export const CORE_ENTRIES: Record<string, string> = {
	'@amxts/core': 'facade.ts',
	'@amxts/core/natives': 'natives.ts',
	'@amxts/core/constants': 'constants.ts',
	'@amxts/core/fs': 'fs.ts',
	'@amxts/core/os': 'os.ts',
	'@amxts/core/kit': 'kit.ts',
	'@amxts/core/check': 'lib/check.ts',
};

/** Every place of the core's as/ in the tree: what `~/` must not reach from a plugin. */
const CORE_PLACES = new Set([...NOT_PLUGINS, ...Object.values(CORE_ENTRIES), 'amxts.d.ts']);

/** How a plugin names the core's file at a place: its entry, or the facade, which exports the rest. */
export function coreEntryOf(place: string): string {
	return Object.entries(CORE_ENTRIES).find(([, file]) => file === place)?.[0] ?? '@amxts/core';
}

/**
 * The project's own plugins: the .ts files at the top of its plugins folder.
 * A module's own folder, without a plugins folder, has none - only the core's
 * repository builds the core's as/.
 */
export function projectPlugins(project: Project): string[] {
	const core = resolve(project.pluginsDir) === resolve(CORE_PLUGINS);
	if (core && resolve(project.dir) !== resolve(CORE_DIR)) return [];
	return readdirSync(project.pluginsDir)
		.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && !(core && NOT_PLUGINS.has(f)))
		.map(f => join(project.pluginsDir, f));
}

/** The modules that run on the server - each in its owner plugin: every one but a library. */
export function shared(modules: ModulePackage[]): ModulePackage[] {
	return modules.filter(pkg => !pkg.library);
}

/** plugins.ini: the modules' owners in load order, then the project's plugins. */
export function pluginList(project: Project, plugins: string[], modules = shared(project.modules)): string[] {
	const owners = modules.map(pkg => `${pkg.short}.aot`);
	return [...owners, ...plugins.filter(plugin => !owners.includes(plugin))];
}

/**
 * The modules the project needs on the server, in load order: the ones its
 * plugins import - by hand or through an auto-import, themselves or through
 * the files they import - with what those modules import and require, and
 * the ones `pawn` keeps for Pawn plugins, whose use no build can see.
 * Without amxts.config.ts every module is in use: a module's own
 * repository, testing itself. A library is never one: it is compiled into
 * the plugins, and what it imports is reached through them.
 */
export function modulesInUse(sources: Sources, plugins: string[]): ModulePackage[] {
	const { project } = sources;
	if (!project.config) return shared(project.modules);
	const used = new Set(project.config.pawn ?? []);
	const reached = new Set<string>();
	const reach = (source: string) => sources.reach(join(sources.root, sources.entry(source)), reached);
	plugins.forEach(reach);
	// A module in use brings what its owner imports and what it requires.
	for (let before = -1; used.size !== before;) {
		before = used.size;
		for (const pkg of shared(project.modules)) {
			const imported = reached.has(join(sources.root, 'modules', `${pkg.short}.ts`));
			if (!imported && !used.has(pkg.name)) continue;
			reach(sources.ownerSource(pkg));
			used.add(pkg.name);
			for (const required of pkg.definition.requires) used.add(required);
		}
	}
	return shared(project.modules).filter(pkg => used.has(pkg.name));
}

// ---------------------------------------------------------------- the tree

const IMPORT = /(\bfrom\s*|\bimport(?:\s*\()?\s*|\bdeclare\s+module\s+)(["'])([^"'\n]+)\2/g;

function posix(path: string): string {
	return path.replace(/\\/g, '/');
}

/** Whether `path` is `dir` or under it - on the same drive. */
function inside(dir: string, path: string): boolean {
	const rel = relative(dir, path);
	return !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Whether a file on disk is the package's own: in its folder, but not what it
 * installed - its node_modules, the core among them when it is a copy there.
 */
function ofPackage(pkg: ModulePackage, path: string): boolean {
	return inside(pkg.dir, path) && !inside(join(pkg.dir, 'node_modules'), path) && !inside(CORE_DIR, path);
}

/** Plugins with their auto-imports added, by the project's table: a compile's Sources are made anew, the table is the project's. */
const importedFiles = new WeakMap<AutoImport[], { table: Map<string, AutoImport>; texts: Map<string, { text: string; out: string }> }>();

/**
 * The sources one compile reads: the core's as/ as `~/`, the project's plugins
 * over it, and the module packages mapped into it. Every path in and out is an
 * absolute path in that tree; `real` says which file on disk it is.
 */
export class Sources {
	/** A plugin that imports a module package the config does not list. */
	readonly problems: string[] = [];

	constructor(readonly root: string, readonly project: Project) {}

	/**
	 * Whether a file is a plugin's code, which auto-imports reach: the
	 * project's plugins folder but its modules/, or a plugin outside every
	 * package (a test's). The core's as/ and a module - a package, or a file
	 * under modules/ - import what they use: a module is compiled in projects
	 * and on servers whose settings it does not know.
	 */
	private isPlugin(real: string): boolean {
		const own = resolve(this.project.pluginsDir) !== resolve(CORE_PLUGINS);
		if (own && inside(this.project.pluginsDir, real)) return !posix(relative(this.project.pluginsDir, real)).startsWith('modules/');
		if (inside(CORE_PLUGINS, real) || this.packageOf(real)) return false;
		// On a server the plugins folder holds the core's as/ and the modules too.
		const place = this.rel(this.place(real));
		return !place.startsWith('modules/') && !NOT_PLUGINS.has(place);
	}

	/** A plugin's text with the imports of what it uses without importing (scripts/auto-imports.ts). */
	private withImports(real: string, text: string): string {
		const imports = this.project.autoImports;
		if (imports.length === 0 || !this.isPlugin(real)) return text;
		let files = importedFiles.get(imports);
		if (!files) importedFiles.set(imports, files = { table: new Map(imports.map(entry => [entry.name, entry])), texts: new Map() });
		const known = files.texts.get(real);
		if (known?.text === text) return known.out;
		const out = withAutoImports(real, text, files.table);
		files.texts.set(real, { text, out });
		return out;
	}

	private rel(path: string): string {
		return posix(relative(this.root, resolve(path)));
	}

	private moduleNamed(short: string): ModulePackage | null {
		return this.project.modules.find(pkg => pkg.short === short) ?? null;
	}

	/** The package a file on disk belongs to. */
	packageOf(real: string): ModulePackage | null {
		const path = resolve(real);
		return this.project.modules.find(pkg => path === pkg.module || path === pkg.natives || ofPackage(pkg, path)) ?? null;
	}

	/** The file on disk at this place in the tree, or null. */
	real(path: string): string | null {
		const rel = this.rel(path);
		if (!inside(this.root, resolve(path))) return existsSync(path) ? resolve(path) : null;

		if (this.project.pluginsDir !== resolve(this.root)) {
			const own = join(this.project.pluginsDir, rel);
			if (existsSync(own)) return own;
		}
		const core = resolve(this.root, rel);
		if (existsSync(core)) return core;

		const moduleFile = rel.match(/^modules\/([^/]+)\.ts$/);
		if (moduleFile) return this.moduleNamed(moduleFile[1])?.module ?? null;
		const packageFile = rel.match(/^modules\/([^/]+)\/(.+)$/);
		if (packageFile) {
			const pkg = this.moduleNamed(packageFile[1]);
			const file = pkg ? join(pkg.dir, packageFile[2]) : null;
			return file && existsSync(file) ? file : null;
		}
		const owner = rel.match(/^([^/]+)\.ts$/);
		if (owner) return this.moduleNamed(owner[1])?.natives ?? null;
		return null;
	}

	/** The owner the build writes for a module without natives, at ~/<name>.ts. */
	generated(path: string): string | null {
		const owner = this.rel(path).match(/^([^/]+)\.ts$/);
		const pkg = owner ? this.moduleNamed(owner[1]) : null;
		if (!pkg || pkg.natives || pkg.library || this.real(path)) return null;
		return [
			`// GENERATED by scripts/project.ts: the plugin that runs ${pkg.name} - its one instance on the server.`,
			'import { plugin } from "~/facade";',
			`import "~/modules/${pkg.short}";`,
			'',
			`plugin({ name: ${JSON.stringify(pkg.short)}, version: ${JSON.stringify(pkg.version)}, author: "", description: ${JSON.stringify(pkg.description)} });`,
			'',
		].join('\n');
	}

	exists(path: string): boolean {
		return this.real(path) !== null || this.generated(path) !== null;
	}

	/** What the build compiles as a module's owner: its natives file, or the generated one's place. */
	ownerSource(pkg: ModulePackage): string {
		return pkg.natives ?? join(this.root, `${pkg.short}.ts`);
	}

	/** Where a file on disk is in the tree: a package's plugin is ~/<name>.ts. */
	place(real: string): string {
		const path = resolve(real);
		for (const pkg of this.project.modules) {
			if (path === pkg.natives) return join(this.root, `${pkg.short}.ts`);
			if (path === pkg.module) return join(this.root, 'modules', `${pkg.short}.ts`);
			if (ofPackage(pkg, path)) return join(this.root, 'modules', pkg.short, relative(pkg.dir, path));
		}
		if (this.project.pluginsDir !== resolve(this.root) && inside(this.project.pluginsDir, path)) {
			return join(this.root, relative(this.project.pluginsDir, path));
		}
		return path;
	}

	/** An entry for asc: the plugin's place in the tree, relative to it. */
	entry(real: string): string {
		return this.rel(this.place(real));
	}

	/** Each file's typed configs and commands, made once a compile (scripts/typed-configs.ts, scripts/typed-commands.ts). */
	private typed = new Map<string, { text: string; out: string }>();

	/**
	 * The file's text as asc reads it: auto-imports added, imports rewritten,
	 * a module's definition turned into its setup, its typed configs' code
	 * generated.
	 */
	read(path: string): string | null {
		const text = this.readPlain(path);
		if (text === null) return null;
		const at = resolve(path);
		const known = this.typed.get(at);
		if (known && known.text === text) return known.out;

		const display = posix(relative(this.project.dir, this.real(at) ?? at));
		const reader = (from: string, spec: string) => {
			const file = this.resolveImport(from, spec);
			const found = file ? this.readPlain(file) : null;
			return file && found !== null ? { path: file, text: found } : null;
		};
		const configs = typedConfigs(at, display, text, reader);
		const made = typedCommands(at, display, configs.text, reader);
		for (const problem of [...configs.problems, ...made.problems]) this.problem(problem);
		this.typed.set(at, { text, out: made.text });
		return made.text;
	}

	/** The file's text with its auto-imports added, its imports rewritten and a module's definition turned into its setup. */
	private readPlain(path: string): string | null {
		const real = this.real(path);
		if (!real) return this.generated(path);
		const raw = readFileSync(real, 'utf8');
		const at = resolve(path);
		const known = this.plain.get(at);
		if (known?.raw === raw) return known.out;
		const out = this.plainOf(path, real, raw);
		this.plain.set(at, { raw, out });
		return out;
	}

	/** Each file's plain text, made once a compile: a build reaches the facade from every plugin. */
	private plain = new Map<string, { raw: string; out: string }>();

	private plainOf(path: string, real: string, raw: string): string {
		// A module's ModuleOptions augmentation may be in any of its files (types.ts).
		const text = withoutOptionsAugmentation(this.rewrite(real, this.withImports(real, raw)));
		const pkg = this.project.modules.find(each => each.module === real);
		if (pkg) return moduleSource(real, text, optionsOf(this.project, pkg.definition));
		if (/^modules\/[^/]+\.ts$/.test(this.rel(path)) && text.includes('defineModule')) {
			const definition = readDefinition(real, text);
			return moduleSource(real, text, definition ? optionsOf(this.project, definition) : {});
		}
		return text;
	}

	private problem(text: string) {
		if (!this.problems.includes(text)) this.problems.push(text);
	}

	/**
	 * Whether a file on disk is the core's as/: the hood, which names its
	 * places by `~/`. On a server the plugins folder holds them, by place.
	 */
	private isCore(real: string): boolean {
		if (inside(CORE_PLUGINS, real)) return true;
		const own = resolve(this.project.pluginsDir) !== resolve(CORE_PLUGINS) && inside(this.project.pluginsDir, real);
		return !own && !this.packageOf(real) && CORE_PLACES.has(this.rel(this.place(real)));
	}

	/**
	 * `~/` in a plugin or a module is the project's own files: the core's API
	 * goes by `@amxts/core/<entry>` and a module package by its name. What
	 * to write instead, or null for a file of the project's own.
	 */
	private notOwn(real: string, spec: string): string | null {
		const file = this.resolveImport(this.place(real), spec);
		const target = file ? this.real(file) : null;
		if (!target) return file && this.generated(file) ? '' : null;
		const pkg = this.packageOf(target);
		if (pkg) return pkg.module === target ? pkg.name : `${pkg.name}/${posix(relative(pkg.dir, target)).replace(/\.ts$/, '')}`;
		return this.isCore(target) ? coreEntryOf(this.rel(file!)) : null;
	}

	/** A specifier as the tree has it: a package by its place, a relative import inside a package likewise. */
	private specifier(real: string, spec: string): string {
		const display = () => posix(relative(this.project.dir, real));
		if (spec === '@amxts/core' || spec.startsWith('@amxts/core/')) {
			const place = CORE_ENTRIES[spec];
			if (place) return `~/${place.replace(/\.ts$/, '')}`;
			this.problem(`${display()}: imports ${spec}, which @amxts/core does not export - its API is ${Object.keys(CORE_ENTRIES).join(', ')}`);
			return spec;
		}

		if (spec.startsWith('~/')) {
			const instead = this.isCore(real) ? null : this.notOwn(real, spec);
			if (instead !== null) this.problem(`${display()}: ${spec} is not a file of the project - \`~/\` is the plugins folder; import ${instead || 'the module by its package name'} (npx amxts upgrade rewrites these imports)`);
			return spec;
		}

		if (spec.startsWith('.')) {
			const pkg = this.packageOf(real);
			if (!pkg) return spec;
			// Always by its `~/` place: asc tells files apart by the path they
			// were reached by, so the plugin's `./module` and another plugin's
			// "@amxts/menu-core" have to be one path, or the owner would carry
			// two copies of the module.
			const target = resolve(dirname(real), spec);
			const file = [target, `${target}.ts`, join(target, 'index.ts')].find(each => existsSync(each) && statSync(each).isFile());
			if (file === pkg.module) return `~/modules/${pkg.short}`;
			if (file === pkg.natives) return `~/${pkg.short}`;
			return `~/modules/${pkg.short}/${posix(relative(pkg.dir, target))}`;
		}

		const name = spec.match(/^(@[^/]+\/[^/]+|[^@/][^/]*)/)?.[1];
		const active = this.project.modules.find(pkg => pkg.name === name);
		if (active) return spec === active.name ? `~/modules/${active.short}` : `~/modules/${active.short}/${spec.slice(name!.length + 1)}`;
		if (this.project.packages.some(pkg => pkg.name === name)) {
			const problem = `${posix(relative(this.project.dir, real))}: imports ${name}, which ${CONFIG_FILE} does not list - add it to modules`;
			if (!this.problems.includes(problem)) this.problems.push(problem);
		}
		return spec;
	}

	rewrite(real: string, text: string): string {
		if (!text.includes('@') && !text.includes('~/') && !(this.packageOf(real) && /["']\.\.?\//.test(text))) return text;
		return text.replace(IMPORT, (whole, head: string, quote: string, spec: string) => {
			const next = this.specifier(real, spec);
			return next === spec ? whole : `${head}${quote}${next}${quote}`;
		});
	}

	/** The tree place a specifier in `from` points at, before the .ts is tried. */
	private target(from: string, spec: string): string | null {
		if (spec.startsWith('~/')) return join(this.root, spec.slice(2));
		if (spec.startsWith('.')) return join(dirname(from), spec);
		return null;
	}

	/** The file in the tree an import in `from` leads to, or null. */
	resolveImport(from: string, spec: string): string | null {
		const next = this.target(resolve(from), spec);
		if (!next) return null;
		return [next.endsWith('.ts') ? next : `${next}.ts`, join(next, 'index.ts')].find(each => this.exists(each)) ?? null;
	}

	/** Every place in the tree a source reaches through its imports, itself included. */
	reach(path: string, seen = new Set<string>()): Set<string> {
		const at = resolve(path);
		if (seen.has(at)) return seen;
		const text = this.read(at);
		if (text === null) return seen;
		seen.add(at);
		for (const [, , , spec] of text.matchAll(IMPORT)) {
			const file = this.resolveImport(at, spec);
			if (file) this.reach(file, seen);
		}
		return seen;
	}

	/** The include a plugin's natives must match: its package's, when the package says `"contract": true`. */
	contractOf(entry: string): string | null {
		const place = join(this.root, entry);
		const real = this.real(place);
		const pkg = real ? this.packageOf(real) : null;
		return pkg && pkg.contract && pkg.natives === real ? pkg.include : null;
	}

	/** Where a plugin's `include: "x.inc"` may be: beside it, its package's include, the plugins folders, then the include folders (`includeDirs`). */
	includeCandidates(entry: string, file: string): string[] {
		const place = join(this.root, entry);
		const real = this.real(place);
		const pkg = real ? this.packageOf(real) : null;
		return [
			...(real ? [join(dirname(real), file)] : []),
			...(pkg?.include && basename(pkg.include) === file ? [pkg.include] : []),
			...(pkg ? [join(pkg.dir, 'include', file), join(pkg.dir, file)] : []),
			join(dirname(place), file),
			join(this.project.pluginsDir, file),
			join(this.root, file),
			...includeDirs(this.project.dir).map(dir => join(dir, file)),
		];
	}
}

/** The tree for `root` in the current project (process.cwd(), or setProjectDir); one per compile. */
export function sourcesFor(root: string): Sources {
	return new Sources(resolve(root), loadProject(projectDir));
}

/**
 * The file asc asks for, as a path. asc reads any non-relative import as a
 * library, so `~/facade` arrives as node_modules/~/facade.ts: `~/` is the
 * plugins folder `root`, which spares a plugin in a subfolder from counting
 * dots back to it. Anything else is where asc looked, from `baseDir`.
 */
export function ascPath(root: string, filename: string, baseDir: string): string {
	const alias = filename.replace(/\\/g, '/').match(/(?:^|\/)node_modules\/~\/(.*)$/);
	return alias ? resolve(root, alias[1]) : resolve(baseDir && baseDir !== '.' ? baseDir : root, filename);
}

let projectDir = process.cwd();

/** The project builds and tests read from; process.cwd() until set. */
export function setProjectDir(dir: string) {
	projectDir = resolve(dir);
}

export function currentProjectDir(): string {
	return projectDir;
}
