// Modules with one instance on the server.
//
// A module at ~/modules/<name> whose name a plugin at ~/<name>.ts has belongs
// to that plugin. A module package is put there by scripts/project.ts: its
// module file is ~/modules/menu-core, its natives (or a generated owner)
// ~/menu-core.ts. Every plugin reaches it the same way - `menus`, which the
// build imports for it (scripts/auto-imports.ts), or its own
//
//   import * as menus from "@amxts/menu-core";
//
// In the owner it is the module. In any other plugin the build reads, in its
// place, a proxy generated here: the same exported functions and types, each
// function writing its arguments into a buffer (as/remote.ts) that the amxts
// module (runtime/src/module.cpp) hands to the owner, whose generated
// dispatcher calls the real function and writes the answer back. The plugin
// cannot tell the difference, and its editor reads the real module.
//
// What crosses, and how:
//
// - number, boolean, string (and a union of string literals, which is a
//   string), arrays of them, `T | null`;
// - Player, by its id;
// - an object the module hands out and takes back - it is returned by one
//   exported function and taken by another: a config, a section - or hands
//   out with methods of its own - a menu - by a number in the owner's table.
//   The proxy's type of the same name is a class whose fields and accessors
//   read and write the owner's object and whose methods run on it there; its
//   private fields stay the owner's, and a readonly one has no setter. An
//   object the module exports - `export const semiclip = new Semiclip()` -
//   is one too, with a number fixed when the owner starts: the proxy's
//   `semiclip` is the owner's;
// - any other object (an interface, a class of fields - options, a row) by
//   value, field by field; a class with methods (an event) comes back after
//   the call with the fields the other side changed - preventDefault() works;
// - a function (a condition, an action, a list source): it stays in the
//   plugin that wrote it, and the other side gets a stand-in with the same
//   signature that calls it back.
//
// Anything else stops the build with the function and the parameter named.
//
// The types come from compiling the module on its own with asc: its exported
// functions are compiled as exports, so every result type the compiler
// inferred is known, and so is every field. That compile is done before the
// plugin's (asc is not reentrant). What a plugin's compile needs of it - the
// proxy and the dispatcher, its surface - is remembered while the files it
// read are unchanged: in memory, and on disk in the project's
// node_modules/.cache/amxts/analysis, so another process - a build started
// again, a parallel compile - takes it from there. A module package from npm
// carries its surface beside its prebuilt .aot (scripts/prebuilt.ts), taken
// while the project would make the same one.
import type { Project, Sources } from './project';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore - shipped as JavaScript, with types beside it we do not need here
import * as as from '../runtime/deps/assemblyscript/dist/assemblyscript.js';
import { ascMain } from './asc';
import { codeIdentity, diskCache } from './compile-cache';
import { playerFieldsBuild } from './player-fields';
import { prebuiltSurface } from './prebuilt';
import { ascPath, currentProjectDir, sourcesFor } from './project';
import { existsSync, statSync } from './tracked-fs';

/** Where the owner's dispatcher is parsed: beside the plugin, like its natives' wrappers. */
const SERVE_FILE = '__amxts_serve.ts';
/** The entry that exports __amxts_rpc from ~/remote. */
const EXPORT_FILE = '__amxts_remote.ts';
const EXPORT_SOURCE = 'export { __amxts_rpc } from "~/remote";\n';

// ---------------------------------------------------------------- ownership

/** `menu-core` for as/modules/menu-core.ts; null for a file that is not a module of its own. */
function moduleName(root: string, path: string): string | null {
	const rel = relative(resolve(root), resolve(path)).replace(/\\/g, '/');
	const match = rel.match(/^modules\/([^/]+)\.ts$/);
	return match ? match[1] : null;
}

/**
 * Whether a plugin owns `~/modules/<name>`: as/<name>.ts beside it - or, on a
 * server, where plugins are compiled from the plugins folder, <name>.aot.
 */
export function hasOwner(root: string, name: string): boolean {
	return sourcesFor(root).exists(join(root, `${name}.ts`)) || existsSync(join(root, `${name}.aot`));
}

/** The module a plugin owns: `menu-core` for as/menu-core.ts, when as/modules/menu-core.ts exists. */
function ownedModule(root: string, entry: string): string | null {
	const rel = entry.replace(/\\/g, '/');
	if (rel.includes('/')) return null;
	const name = rel.replace(/\.ts$/, '');
	return sourcesFor(root).exists(join(root, 'modules', `${name}.ts`)) ? name : null;
}

// ---------------------------------------------------------------- what crosses

type Wire
	= | { kind: 'num'; as: string }
		| { kind: 'bool' }
		| { kind: 'str' }
		| { kind: 'player' }
		| { kind: 'null'; of: Wire }
		| { kind: 'array'; of: Wire }
		| { kind: 'fn'; params: Wire[]; result: Wire | null; sig: number }
		| { kind: 'record'; cls: ClassInfo }
		| { kind: 'handle'; cls: ClassInfo };

interface ClassInfo {
	/** As written: `Menu`. */
	name: string;
	/** The compiler's name: `modules/menu-core/Menu`. */
	internal: string;
	/** Where to import it from: `~/facade`; null for the module's own. */
	from: string | null;
	/**
	 * `optional`: an optional boolean (`force?: boolean`) - whether it was
	 * given crosses too, so `options.force ?? true` reads the same on the other
	 * side. An optional number crosses as its undefined, an optional object as null.
	 */
	fields: { name: string; wire: Wire; optional?: boolean; readonly?: boolean; declared?: string }[];
	/** It has methods: a record goes back after a call, as the other side left it. */
	methods: boolean;
	/** A handle's public methods, which the proxy calls on the owner's object. */
	calls: ExportedFunction[];
	/** Import alias for a class the module does not declare. */
	alias: string;
}

interface ExportedFunction {
	name: string;
	/** The parameters as the module writes them, defaults included. */
	params: string[];
	paramNames: string[];
	wires: Wire[];
	result: Wire | null;
}

export interface ModuleAnalysis {
	name: string;
	/** The module's source. */
	text: string;
	functions: ExportedFunction[];
	/** Exported types other than handles, as the module writes them: copied into the proxy. */
	declarations: string[];
	/** The module's imports, as `import` lines, with the names they bring in. */
	imports: { names: string[]; line: (used: Set<string>) => string | null }[];
	handles: ClassInfo[];
	classes: ClassInfo[];
	/** The objects the module exports, `export const semiclip = new Semiclip()`: handles numbered 1, 2, ... in this order. */
	objects: { name: string; cls: ClassInfo }[];
	fns: Wire[];
	hash: number;
}

/** What a plugin's compile needs of a module: the proxy, the owner's dispatcher, and whether functions cross. */
export interface ModuleSurface {
	proxy: string;
	serve: string;
	callbacks: boolean;
}

export function surfaceOf(analysis: ModuleAnalysis): ModuleSurface {
	return { proxy: proxySource(analysis), serve: serveSource(analysis), callbacks: analysis.fns.length > 0 };
}

const HERE = dirname(fileURLToPath(import.meta.url));

/** The surfaces kept on disk, per project folder; none where the project has no node_modules (a server). */
const kept = new Map<string, ReturnType<typeof diskCache>>();

/** The current project's surfaces on disk. */
export function keptSurfaces() {
	const dir = currentProjectDir();
	const modules = join(dir, 'node_modules');
	if (!kept.has(dir)) kept.set(dir, diskCache(existsSync(modules) ? join(modules, '.cache', 'amxts', 'analysis') : null, () => codeIdentity([join(HERE, 'shared-modules.ts')])));
	return kept.get(dir)!;
}

/**
 * The places a module reaches, as files on disk with their times: it is the
 * same module while they are. A file that takes another's place changes it.
 */
function stampOf(sources: Sources, places: string[]): string {
	return places.map((place) => {
		const file = sources.real(place);
		if (!file) return place;
		const info = statSync(file);
		return `${file}:${info.mtimeMs}:${info.size}`;
	}).join('|');
}

/** The surfaces made in this process, by project - its config gives the modules their options - and module file. */
const surfaces = new WeakMap<Project, Map<string, { places: string[]; stamp: string; surface: Promise<ModuleSurface> }>>();

/**
 * The module's surface: the one its package came with, else one kept on
 * disk, else made from its analysis. Remembered while the files it reaches -
 * the module and everything it imports: a field added to a facade class
 * changes what crosses - are unchanged.
 */
export function moduleSurface(root: string, name: string): Promise<ModuleSurface> {
	const path = join(root, 'modules', `${name}.ts`);
	const sources = sourcesFor(root);
	if (!surfaces.has(sources.project)) surfaces.set(sources.project, new Map());
	const made = surfaces.get(sources.project)!;
	const known = made.get(path);
	if (known && known.stamp === stampOf(sources, known.places)) return known.surface;

	const places = [...sources.reach(path)];
	const pkg = sources.project.modules.find(each => each.short === name && each.module === sources.real(path));
	const shipped = pkg ? prebuiltSurface(pkg, sources) : null;
	const surface = shipped && 'surface' in shipped
		? Promise.resolve(shipped.surface)
		: keptSurfaces().cached(['surface', resolve(root), name], async () => surfaceOf(await analyzeModule(root, name)));
	made.set(path, { places, stamp: stampOf(sources, places), surface });
	surface.catch(() => made.delete(path));
	return surface;
}

/** The module's exports, as the compiler sees them. */
export async function analyzeModule(root: string, name: string): Promise<ModuleAnalysis> {
	return describe(await compileAlone(root, name), name);
}

/**
 * Compiles `~/modules/<name>` on its own, its exported functions as exports:
 * the compiler's program, or an error with what asc said.
 */
export async function compileAlone(root: string, name: string): Promise<any> {
	let program: any = null;
	const playerFields = playerFieldsBuild();
	const sources = sourcesFor(root);
	const entry = `modules/${name}.ts`;

	const { error, stderr } = await ascMain([entry, '--noEmit'], {
		readFile(filename: string, baseDir: string): string | null {
			const path = ascPath(root, filename, baseDir);
			const text = sources.read(path);
			return text === null ? null : playerFields.read(relative('.', (sources.real(path) ?? path)), text);
		},
		writeFile() {},
		listFiles: () => [],
		transforms: [playerFields.transform, class { afterCompile() { program = (this as any).program; } }],
	});
	if (error || !program) throw new Error(`~/modules/${name} does not compile:\n${stderr.toString() || String(error?.message ?? error)}`);
	return program;
}

function describe(program: any, name: string): ModuleAnalysis {
	const internalPath = `modules/${name}`;
	const file = program.filesByName.get(internalPath);
	const source = file.source;
	const text: string = source.text;
	const problems: string[] = [];
	const where = (what: string) => `~/modules/${name}: ${what}`;

	// A module package may keep part of its API in other files it re-exports -
	// `export * from "./types"`. Those files are the module too: their exports
	// are its exports, their types are copied into the proxy like its own.
	// Reached from the module file as ~/modules/<name>/..., a library path.
	const inPackage = (path: string) => path.startsWith(`${internalPath}/`) || path.startsWith(`~lib/~/${internalPath}/`);
	const files: any[] = [];
	const collectFiles = (each: any) => {
		if (files.includes(each)) return;
		files.push(each);
		for (const star of each.exportsStar ?? []) {
			if (inPackage(star.internalName)) collectFiles(star);
		}
	};
	collectFiles(file);
	/** Every export of the module and of the files it re-exports, with the file it is in. */
	const allExports: [string, any, any][] = [];
	for (const each of files) {
		for (const [exportName, element] of each.exports ?? []) {
			if (!allExports.some(([known]) => known === exportName)) allExports.push([exportName, element, each]);
		}
	}

	const classes = new Map<string, ClassInfo>();
	const fns: Wire[] = [];
	const functions: ExportedFunction[] = [];
	const declarations: string[] = [];
	const handleNames = new Set<string>();

	const slice = (node: any) => node.range.source.text.slice(node.range.start, node.range.end);
	const isPackageFile = (path: string) => files.some(each => each.internalName === path);

	// First the module's own classes that go both ways: handed out and taken back.
	const returned = new Set<string>();
	const taken = new Set<string>();
	const own = (type: any, into: Set<string>) => {
		const t = type.isNullableReference ? type.nonNullableType : type;
		const cls = t.getClass();
		if (!cls) return;
		if (cls.prototype === program.arrayPrototype) return own(cls.typeArguments[0], into);
		if (inPackage(cls.internalName)) into.add(cls.internalName);
	};

	const exported: { name: string; element: any; instance: any }[] = [];
	/** `export const semiclip = new Semiclip()`: an object of a class of the module's own, one on the server. */
	const objects: { name: string; cls: any }[] = [];
	for (const [exportName, element] of allExports) {
		if (element.kind === as.ElementKind.Global) {
			const cls = element.is(as.CommonFlags.Const) ? element.type?.getClass?.() : null;
			if (cls && inPackage(cls.internalName)) objects.push({ name: exportName, cls });
			continue;
		}
		if (element.kind !== as.ElementKind.FunctionPrototype) continue;
		const instance = program.instancesByName.get(element.internalName);
		exported.push({ name: exportName, element, instance });
		if (!instance?.signature) continue;
		for (const type of instance.signature.parameterTypes) own(type, taken);
		own(instance.signature.returnType, returned);
	}
	for (const each of returned) {
		if (taken.has(each) || hasMethods(program.instancesByName.get(each))) handleNames.add(each);
	}
	for (const object of objects) handleNames.add(object.cls.internalName);

	const numeric = /^(?:i8|i16|i32|u8|u16|u32|f32|f64)$/;

	/** A class with public instance methods of its own - a menu - rather than a record of fields. */
	function hasMethods(cls: any): boolean {
		for (let c = cls; c; c = c.base) {
			for (const [memberName, member] of c.members ?? []) {
				if (memberName === 'constructor' || member.kind !== as.ElementKind.FunctionPrototype) continue;
				if (!member.is(as.CommonFlags.Static) && !member.is(as.CommonFlags.Private) && !member.is(as.CommonFlags.Protected)) return true;
			}
		}
		return false;
	}

	/** Handles' methods met while their classes were read: resolved once every handle is known. */
	const methodsToRead: { info: ClassInfo; name: string; prototype: any; context: string }[] = [];

	function classInfo(cls: any, context: string): ClassInfo | null {
		const known = classes.get(cls.internalName);
		if (known) return known;
		const path = cls.internalName.replace(/<.*$/, '').replace(/\/[^/]*$/, '');
		if (path.startsWith('~lib/') && !path.startsWith('~lib/~/')) {
			problems.push(`${context}: ${cls.prototype.name} from the standard library cannot cross - pass its contents as an array or a record`);
			return null;
		}
		if (cls.typeArguments?.length) {
			problems.push(`${context}: ${cls.prototype.name} is generic - an object crosses when it is a plain interface or class`);
			return null;
		}
		let from: string | null = null;
		if (!isPackageFile(path)) {
			from = path.startsWith('~lib/~/') ? `~/${path.slice(7)}` : `~/${path}`;
		} else if (!file.lookupExport(cls.name)) {
			problems.push(`${context}: ${cls.name} is not exported - a type that crosses has to be`);
			return null;
		}
		const info: ClassInfo = { name: cls.name, internal: cls.internalName, from, fields: [], methods: false, calls: [], alias: `__F${classes.size}_${cls.name}` };
		classes.set(cls.internalName, info);
		const handle = handleNames.has(cls.internalName);

		const chain: any[] = [];
		for (let c = cls; c; c = c.base) chain.unshift(c);
		for (const c of chain) {
			if (!c.members) continue;
			for (const [memberName, member] of c.members) {
				if (memberName === 'constructor') continue;
				const hidden = member.is(as.CommonFlags.Private) || member.is(as.CommonFlags.Protected);
				if (member.kind === as.ElementKind.PropertyPrototype && member.isField) {
					// A handle's private field stays in the owner's object; a record is copied whole.
					if (hidden && handle) continue;
					if (hidden) {
						problems.push(`${context}: ${cls.name}.${memberName} is private - an object crosses with all its fields`);
						continue;
					}
					if (info.fields.some(f => f.name === memberName)) continue;
					const property = program.resolver.resolveProperty(member);
					if (!property) continue;
					const wire = toWire(property.type, `${context} - ${cls.name}.${memberName}`);
					// A function field keeps its type as written - `string | (...) => string`
					// takes a string in the proxy too (FunctionTypeNode.acceptsText), and
					// `(...) => R | T[]` a function (NamedTypeNode.acceptsFunction).
					const typeNode = member.fieldDeclaration?.type;
					const bare = wire?.kind === 'null' ? wire.of : wire;
					const declared = wire && typeNode && (bare?.kind === 'fn' || (bare?.kind === 'array' && typeNode.acceptsFunction)) ? slice(typeNode) : undefined;
					if (wire) info.fields.push({ name: memberName, wire, optional: property.presenceOffset >= 0, readonly: member.is(as.CommonFlags.Readonly), declared });
				} else if (member.kind === as.ElementKind.FunctionPrototype || member.kind === as.ElementKind.PropertyPrototype) {
					if (!member.is(as.CommonFlags.Static)) info.methods = true;
					// A handle's accessor - `get rule()`, `set rule(...)` - is read and
					// written in the owner, as a field is: the setter runs there.
					if (handle && member.kind === as.ElementKind.PropertyPrototype && !member.is(as.CommonFlags.Static) && !hidden) {
						if (info.fields.some(f => f.name === memberName)) continue;
						const getter = program.resolver.resolveProperty(member)?.getterInstance;
						const wire = getter ? toWire(getter.signature.returnType, `${context} - ${cls.name}.${memberName}`) : null;
						if (wire) info.fields.push({ name: memberName, wire, readonly: !member.setterPrototype });
						continue;
					}
					const method = member.kind === as.ElementKind.FunctionPrototype && !member.is(as.CommonFlags.Static) && !hidden;
					if (handle && method && !methodsToRead.some(m => m.info === info && m.name === memberName)) {
						methodsToRead.push({ info, name: memberName, prototype: member, context: `${context} - ${cls.name}.${memberName}` });
					}
				}
			}
		}
		return info;
	}

	function toWire(type: any, context: string): Wire | null {
		if (type.isNullableReference) {
			const of = toWire(type.nonNullableType, context);
			return of ? { kind: 'null', of } : null;
		}
		const text = String(type.toString());
		if (text === 'bool') return { kind: 'bool' };
		if (numeric.test(text)) return { kind: 'num', as: text };

		const signature = type.getSignature?.();
		if (signature) {
			const params: Wire[] = [];
			signature.parameterTypes.forEach((param: any, i: number) => {
				const wire = toWire(param, `${context} - its parameter ${i + 1}`);
				if (wire) params.push(wire);
			});
			const returns = signature.returnType;
			const result = String(returns.toString()) === 'void' ? null : toWire(returns, `${context} - its result`);
			const fn: Wire = { kind: 'fn', params, result, sig: 0 };
			const same = fns.find(f => wireKey(f) === wireKey(fn));
			if (same) return same;
			(fn as any).sig = fns.length;
			fns.push(fn);
			return fn;
		}

		const cls = type.getClass?.();
		if (cls) {
			if (cls.internalName === '~lib/string/String') return { kind: 'str' };
			if (cls.prototype === program.arrayPrototype) {
				const of = toWire(cls.typeArguments[0], context);
				return of ? { kind: 'array', of } : null;
			}
			if (cls.internalName === '~lib/~/facade/Player') return { kind: 'player' };
			const info = classInfo(cls, context);
			if (!info) return null;
			if (handleNames.has(cls.internalName)) return { kind: 'handle', cls: info };
			return { kind: 'record', cls: info };
		}

		problems.push(`${context}: ${text} cannot cross between plugins - number, boolean, string, arrays, Player, objects and functions of them can`);
		return null;
	}

	/** A function as the other side calls it: an exported function, or a handle's method. Null when it cannot cross. */
	function callOf(fnName: string, element: any, instance: any, context: string): ExportedFunction | null {
		const declaration = element.declaration;
		if (element.typeParameterNodes?.length || declaration.typeParameters?.length) {
			problems.push(where(`${context} - a generic function cannot be called in another plugin`));
			return null;
		}
		if (!instance?.signature) {
			problems.push(where(`${context} - not compiled`));
			return null;
		}
		const params: string[] = [];
		const paramNames: string[] = [];
		const wires: Wire[] = [];
		declaration.signature.parameters.forEach((param: any, i: number) => {
			const paramName = param.name.text;
			const pcontext = where(`${context} - parameter "${paramName}"`);
			if (param.parameterKind === as.ParameterKind.Rest) {
				problems.push(`${pcontext}: a rest parameter cannot cross - take an array`);
				return;
			}
			if (param.initializer && !plainDefault(param.initializer)) {
				problems.push(`${pcontext}: its default is computed - the proxy evaluates it in the other plugin, so it has to be a literal`);
				return;
			}
			const wire = toWire(instance.signature.parameterTypes[i], pcontext);
			if (!wire) return;
			params.push(slice(param));
			paramNames.push(paramName);
			wires.push(wire);
		});
		const returns = instance.signature.returnType;
		const returned = String(returns.toString());
		if (/Promise/.test(returned)) {
			problems.push(where(`${context} - an async function cannot be called in another plugin`));
			return null;
		}
		const result = returned === 'void' ? null : toWire(returns, where(`${context} - its result`));
		if (returned !== 'void' && !result) return null;
		return { name: fnName, params, paramNames, wires, result };
	}

	for (const { name: fnName, element, instance } of exported) {
		const call = callOf(fnName, element, instance, `export function ${fnName}`);
		if (call) functions.push(call);
	}
	for (const object of objects) classInfo(object.cls, where(`export const ${object.name}`));

	// A method may take or give a class met only in another method: read until none is left.
	for (let i = 0; i < methodsToRead.length; i++) {
		const { info, name: methodName, prototype, context } = methodsToRead[i];
		const instance = program.resolver.resolveFunction(prototype, null, new Map(), as.ReportMode.Swallow);
		const call = callOf(methodName, prototype, instance, context);
		if (call) info.calls.push(call);
	}

	for (const [exportName, element] of allExports) {
		if (element.kind === as.ElementKind.FunctionPrototype) continue;
		if (element.kind === as.ElementKind.Global) {
			if (!objects.some(object => object.name === exportName)) problems.push(where(`export ${exportName}: a variable is not shared - export a function that reads or sets it, or an object of a class of the module's own`));
			continue;
		}
		const declaration = element.declaration;
		if (!declaration || !files.some(each => each.source === declaration.range.source)) continue;
		if (handleNames.has(element.internalName)) continue;
		const written = slice(declaration).replace(/^(?!export\b)/, 'export ');
		declarations.push(/[;}]\s*$/.test(written) ? written : `${written};`);
	}

	// Every handle's fields became wires with its class: the proxy's getters and setters.
	const handles = [...handleNames].map(n => classes.get(n)).filter((c): c is ClassInfo => !!c);

	const imports: ModuleAnalysis['imports'] = [];
	for (const statement of files.flatMap(each => each.source.statements)) {
		if (statement.kind !== as.NodeKind.Import) continue;
		// An import of another file of the package: its types are copied in.
		if (isPackageFile(statement.internalPath)) continue;
		const path = statement.path.value;
		if (statement.namespaceName) {
			const ns = statement.namespaceName.text;
			imports.push({ names: [ns], line: used => (used.has(ns) ? `import * as ${ns} from "${path}";` : null) });
		} else if (statement.declarations?.length) {
			const specs: { local: string; foreign: string }[] = statement.declarations.map((d: any) => ({ local: d.name.text, foreign: d.foreignName.text }));
			imports.push({
				names: specs.map(s => s.local),
				line: (used) => {
					const kept = specs.filter(s => used.has(s.local));
					if (kept.length === 0) return null;
					return `import { ${kept.map(s => (s.local === s.foreign ? s.local : `${s.foreign} as ${s.local}`)).join(', ')} } from "${path}";`;
				},
			});
		} else {
			// `import "~/myplugin/player"`: for what it declares, kept.
			imports.push({ names: [], line: () => `import "${path}";` });
		}
	}

	if (problems.length) throw new Error(problems.join('\n'));

	const schema = [
		...functions.map(f => `${f.name}(${f.wires.map(wireKey).join(',')}):${f.result ? wireKey(f.result) : 'void'}`),
		...[...classes.values()].map(c => `${c.internal}{${c.fields.map(f => `${f.name}${f.optional ? '?' : ''}:${wireKey(f.wire)}`).join(',')}}`),
		...handles.map(h => `handle ${h.internal}{${h.fields.filter(f => f.readonly).map(f => f.name).join(',')}}${h.calls.map(c => ` ${c.name}(${c.wires.map(wireKey).join(',')}):${c.result ? wireKey(c.result) : 'void'}`).join('')}`),
		...objects.map(object => `object ${object.name} ${object.cls.internalName}`),
	].join('\n');

	const shared = objects.map(object => ({ name: object.name, cls: classes.get(object.cls.internalName)! }));
	return { name, text, functions, declarations, imports, handles, classes: [...classes.values()], objects: shared, fns, hash: fnv(schema) };
}

/** A default the proxy can evaluate as well: a literal, `{}`, `[]`, `null`, `-1`. */
function plainDefault(node: any): boolean {
	if (node.kind === as.NodeKind.Null || node.kind === as.NodeKind.True || node.kind === as.NodeKind.False) return true;
	if (node.kind === as.NodeKind.UnaryPrefix) return plainDefault(node.operand);
	if (node.kind !== as.NodeKind.Literal) return false;
	if (node.literalKind === as.LiteralKind.Array) return node.elementExpressions.every((e: any) => e && plainDefault(e));
	if (node.literalKind === as.LiteralKind.Object) return node.values.every((v: any) => plainDefault(v));
	return node.literalKind !== as.LiteralKind.Template || node.expressions.length === 0;
}

function wireKey(wire: Wire): string {
	switch (wire.kind) {
		case 'num': return wire.as;
		case 'bool': return 'bool';
		case 'str': return 'str';
		case 'player': return 'player';
		case 'null': return `${wireKey(wire.of)}?`;
		case 'array': return `${wireKey(wire.of)}[]`;
		case 'fn': return `(${wire.params.map(wireKey).join(',')})=>${wire.result ? wireKey(wire.result) : 'void'}`;
		case 'record': return `rec ${wire.cls.internal}`;
		case 'handle': return `handle ${wire.cls.internal}`;
	}
}

/** FNV-1a, as an i32: what both sides of a module check they agree on. */
function fnv(text: string): number {
	let hash = 0x811C9DC5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash | 0;
}

// ---------------------------------------------------------------- code

type Side = 'proxy' | 'serve';

/** The functions both sides write and read values with. */
class Codec {
	private ids = new Map<string, number>();
	private body: string[] = [];

	constructor(private analysis: ModuleAnalysis, private side: Side) {}

	/** The type as the generated file writes it. */
	type(wire: Wire): string {
		switch (wire.kind) {
			case 'num': return wire.as;
			case 'bool': return 'bool';
			case 'str': return 'string';
			case 'player': return '__Player';
			case 'null': return wire.of.kind === 'fn' ? `(${this.type(wire.of)}) | null` : `${this.type(wire.of)} | null`;
			case 'array': return `Array<${this.type(wire.of)}>`;
			case 'fn': return `(${wire.params.map((p, i) => `a${i}: ${this.type(p)}`).join(', ')}) => ${wire.result ? this.type(wire.result) : 'void'}`;
			case 'record':
			case 'handle': return this.className(wire.cls);
		}
	}

	className(cls: ClassInfo): string {
		if (cls.from !== null) return cls.alias;
		return this.side === 'proxy' ? cls.name : `__M_${cls.name}`;
	}

	/** The number of the write/read pair for this wire, generating it on first use. */
	private id(wire: Wire): number {
		const key = wireKey(wire);
		const known = this.ids.get(key);
		if (known !== undefined) return known;
		const id = this.ids.size;
		this.ids.set(key, id);
		this.generate(wire, id);
		return id;
	}

	write(wire: Wire, w: string, value: string): string {
		return `__w${this.id(wire)}(${w}, ${value})`;
	}

	read(wire: Wire, r: string): string {
		return `__r${this.id(wire)}(${r})`;
	}

	/** Puts the fields in `r` back into `value`: a class with methods, after a call. */
	update(wire: Wire, r: string, value: string): string | null {
		if (wire.kind !== 'record' || !wire.cls.methods) return null;
		return `__u${this.id(wire)}(${r}, ${value})`;
	}

	private generate(wire: Wire, n: number) {
		const T = this.type(wire);
		const lines = this.body;
		switch (wire.kind) {
			case 'num':
				lines.push(`function __w${n}(w: __Writer, v: ${T}): void { w.f64(<f64>v); }`);
				lines.push(`function __r${n}(r: __Reader): ${T} { return <${T}>r.f64(); }`);
				break;
			case 'bool':
				lines.push(`function __w${n}(w: __Writer, v: bool): void { w.bool(v); }`);
				lines.push(`function __r${n}(r: __Reader): bool { return r.bool(); }`);
				break;
			case 'str':
				lines.push(`function __w${n}(w: __Writer, v: string): void { w.str(v); }`);
				lines.push(`function __r${n}(r: __Reader): string { return r.str(); }`);
				break;
			case 'player':
				lines.push(`function __w${n}(w: __Writer, v: __Player): void { w.i32(<i32>v.id); }`);
				lines.push(`function __r${n}(r: __Reader): __Player { return new __Player(r.i32()); }`);
				break;
			case 'null': {
				const inner = this.id(wire.of);
				lines.push(`function __w${n}(w: __Writer, v: ${T}): void {\n\tif (v == null) {\n\t\tw.bool(false);\n\t\treturn;\n\t}\n\tw.bool(true);\n\t__w${inner}(w, v!);\n}`);
				lines.push(`function __r${n}(r: __Reader): ${T} {\n\tif (!r.bool()) return null;\n\treturn __r${inner}(r);\n}`);
				break;
			}
			case 'array': {
				const inner = this.id(wire.of);
				lines.push(`function __w${n}(w: __Writer, v: ${T}): void {\n\tw.i32(v.length);\n\tfor (let i: i32 = 0; i < v.length; i++) __w${inner}(w, v[i]);\n}`);
				lines.push(`function __r${n}(r: __Reader): ${T} {\n\tconst count = r.i32();\n\tconst list = new Array<${this.type(wire.of)}>();\n\tfor (let i: i32 = 0; i < count; i++) list.push(__r${inner}(r));\n\treturn list;\n}`);
				break;
			}
			case 'fn':
				lines.push(`function __w${n}(w: __Writer, v: ${T}): void { w.i32(__sendFunction(changetype<usize>(v), ${wire.sig}, __invoke)); }`);
				lines.push(`function __r${n}(r: __Reader): ${T} { return changetype<${T}>(__receiveFunction(r, changetype<usize>(__stub${wire.sig}))); }`);
				break;
			case 'record': {
				const fields = wire.cls.fields;
				const writes = fields.map(f => (f.optional
					? `\tw.bool(v.${f.name} !== undefined);\n\tif (v.${f.name} !== undefined) ${this.write(f.wire, 'w', `v.${f.name}`)};`
					: `\t${this.write(f.wire, 'w', `v.${f.name}`)};`));
				const reads = fields.map(f => (f.optional
					? `\tif (r.bool()) o.${f.name} = ${this.read(f.wire, 'r')};\n\telse o.${f.name} = undefined;`
					: `\to.${f.name} = ${this.read(f.wire, 'r')};`));
				lines.push(`function __w${n}(w: __Writer, v: ${T}): void {\n${writes.join('\n')}\n}`);
				lines.push(`function __u${n}(r: __Reader, o: ${T}): void {\n${reads.join('\n')}\n}`);
				// The fields are all set here, so the object is made without its
				// constructor - a class with parameters has one too.
				lines.push(`function __r${n}(r: __Reader): ${T} {\n\tconst o = changetype<${T}>(__new(offsetof<${T}>(), idof<${T}>()));\n\t__u${n}(r, o);\n\treturn o;\n}`);
				break;
			}
			case 'handle':
				if (this.side === 'proxy') {
					lines.push(`const __h${n} = new Map<i32, ${T}>();`);
					lines.push(`function __w${n}(w: __Writer, v: ${T}): void { w.i32(v.__handle); }`);
					lines.push(`function __r${n}(r: __Reader): ${T} {\n\tconst id = r.i32();\n\tif (__h${n}.has(id)) return __h${n}.get(id);\n\tconst o = new ${T}(id);\n\t__h${n}.set(id, o);\n\treturn o;\n}`);
				} else {
					lines.push(`function __w${n}(w: __Writer, v: ${T}): void { w.i32(__handles.id(changetype<usize>(v))); }`);
					lines.push(`function __r${n}(r: __Reader): ${T} { return changetype<${T}>(__handles.at(r.i32())); }`);
				}
				break;
		}
	}

	/** A stand-in for each function signature, and the switch that calls a real one. */
	callbacks(): string {
		const lines: string[] = [];
		const cases: string[] = [];
		for (const fn of this.analysis.fns) {
			if (fn.kind !== 'fn') continue;
			const T = this.type(fn);
			const params = fn.params.map((p, i) => `a${i}: ${this.type(p)}`).join(', ');
			const result = fn.result ? this.type(fn.result) : 'void';
			const body = [
				'\tconst target = __remoteTarget();',
				'\tconst w = __beginCallback(target);',
				...fn.params.map((p, i) => `\t${this.write(p, 'w', `a${i}`)};`),
				'\tconst r = __callBack(target, w);',
				...fn.params.map((p, i) => this.update(p, 'r', `a${i}`)).filter(Boolean).map(line => `\t${line};`),
				...(fn.result ? [`\treturn ${this.read(fn.result, 'r')};`] : []),
			];
			lines.push(`function __stub${fn.sig}(${params}): ${result} {\n${body.join('\n')}\n}`);

			const args = fn.params.map((_, i) => `a${i}`).join(', ');
			const call = [
				...fn.params.map((p, i) => `\t\t\tconst a${i} = ${this.read(p, 'r')};`),
				`\t\t\tconst f = changetype<${T}>(fn);`,
				fn.result ? `\t\t\tconst result = f(${args});` : `\t\t\tf(${args});`,
				...fn.params.map((p, i) => (this.update(p, 'r', `a${i}`) ? `\t\t\t${this.write(p, 'w', `a${i}`)};` : null)).filter(Boolean),
				...(fn.result ? [`\t\t\t${this.write(fn.result, 'w', 'result')};`] : []),
				'\t\t\tbreak;',
			];
			cases.push(`\t\tcase ${fn.sig}: {\n${call.join('\n')}\n\t\t}`);
		}
		lines.push(`function __invoke(fn: usize, sig: i32, r: __Reader, w: __Writer): void {\n\tswitch (sig) {\n${cases.join('\n')}\n\t}\n}`);
		return lines.join('\n\n');
	}

	/** Everything generated so far - call last, after every write/read/update. */
	functions(): string {
		return this.body.join('\n\n');
	}

	/** `import { Player as __Player } ...` and the rest of the classes from elsewhere. */
	imports(): string {
		const lines = ['import { Player as __Player } from "~/facade";'];
		const bySource = new Map<string, string[]>();
		for (const cls of this.analysis.classes) {
			const from = cls.from ?? (this.side === 'serve' ? `~/modules/${this.analysis.name}` : null);
			if (!from) continue;
			const alias = this.className(cls);
			if (!bySource.has(from)) bySource.set(from, []);
			bySource.get(from)!.push(`${cls.name} as ${alias}`);
		}
		for (const [from, names] of bySource) lines.push(`import { ${names.join(', ')} } from "${from}";`);
		return lines.join('\n');
	}
}

const REMOTE_IMPORT = 'import { Reader as __Reader, Writer as __Writer, beginCallback as __beginCallback, callBack as __callBack, receiveFunction as __receiveFunction, remoteTarget as __remoteTarget, sendFunction as __sendFunction';

/**
 * Operation numbers after the functions': for each handle, a getter and - a
 * field that is not readonly - a setter for each field, then its methods.
 * Both sides count them here.
 */
function handleOps(analysis: ModuleAnalysis) {
	let op = analysis.functions.length;
	return analysis.handles.map(handle => ({
		fields: handle.fields.map(field => ({ get: op++, set: field.readonly ? null : op++ })),
		calls: handle.calls.map(() => op++),
	}));
}

/**
 * A function of the proxy that runs `fn` in the owner: an exported function,
 * or - with `handle`, the object it is called on - a handle's method.
 */
function callSource(codec: Codec, fn: ExportedFunction, op: number, indent: string, handle: string | null): string {
	const result = fn.result ? codec.type(fn.result) : 'void';
	const body = [
		`const __w = __service.begin(${op});`,
		...(handle ? [`__w.i32(${handle});`] : []),
		...fn.paramNames.map((p, i) => `${codec.write(fn.wires[i], '__w', p)};`),
		'const __r = __service.call(__w);',
		...fn.paramNames.map((p, i) => codec.update(fn.wires[i], '__r', p)).filter(Boolean).map(line => `${line};`),
		...(fn.result ? [`return ${codec.read(fn.result, '__r')};`] : []),
	];
	return `${indent}${fn.name}(${fn.params.join(', ')}): ${result} {\n${body.map(line => `${indent}\t${line}`).join('\n')}\n${indent}}`;
}

/** The module as a plugin that does not own it reads it. */
export function proxySource(analysis: ModuleAnalysis): string {
	const codec = new Codec(analysis, 'proxy');
	const name = analysis.name;
	const parts: string[] = [];

	const ops = handleOps(analysis);

	const handleClasses = analysis.handles.map((handle, h) => {
		const members = handle.fields.map((field, f) => {
			const T = codec.type(field.wire);
			const given = field.declared ?? T;
			const { get, set } = ops[h].fields[f];
			const getter = [
				`\tget ${field.name}(): ${T} {`,
				`\t\tconst w = __service.begin(${get});`,
				'\t\tw.i32(this.__handle);',
				`\t\treturn ${codec.read(field.wire, '__service.call(w)')};`,
				'\t}',
			];
			if (set === null) return getter.join('\n');
			return [
				...getter,
				`\tset ${field.name}(value: ${given}) {`,
				`\t\tconst w = __service.begin(${set});`,
				'\t\tw.i32(this.__handle);',
				`\t\t${codec.write(field.wire, 'w', 'value')};`,
				'\t\t__service.call(w);',
				'\t}',
			].join('\n');
		});
		const methods = handle.calls.map((call, c) => callSource(codec, call, ops[h].calls[c], '\t', 'this.__handle'));
		return `/** ${handle.name} in ${name}'s plugin: each field is read and written there, each method runs there. */\nexport class ${handle.name} {\n\tconstructor(public __handle: i32) {}\n\n${[...members, ...methods].join('\n\n')}\n}`;
	});

	const functions = analysis.functions.map((fn, index) => `export function ${callSource(codec, fn, index, '', null)}`);
	// The owner numbers its exported objects first, in this order (serveSource).
	const objects = analysis.objects.map((object, index) => `export const ${object.name} = new ${object.cls.name}(${index + 1});`);

	const callbacks = codec.callbacks();
	const body = [
		analysis.declarations.join('\n\n'),
		handleClasses.join('\n\n'),
		objects.join('\n'),
		`const __service = new __Service("${name}", ${analysis.hash});`,
		codec.functions(),
		callbacks,
		functions.join('\n\n'),
	].join('\n\n');

	const used = new Set(body.match(/[A-Z_$][\w$]*/gi) ?? []);
	// A name two files of the package both import comes in once.
	const moduleImports = analysis.imports.map((each) => {
		const line = each.line(used);
		for (const name of each.names) used.delete(name);
		return line;
	}).filter((line): line is string => line !== null);

	parts.push(
		`// GENERATED by scripts/shared-modules.ts: ~/modules/${name} in a plugin that does not own it.`,
		`// Each function runs in ${name}.aot, the one instance on the server.`,
		`${REMOTE_IMPORT}, Service as __Service } from "~/remote";`,
		codec.imports(),
		...moduleImports,
		'',
		body,
		'',
	);
	return parts.join('\n');
}

/** The owner's side: the dispatcher that runs each call on the real module. */
export function serveSource(analysis: ModuleAnalysis): string {
	const codec = new Codec(analysis, 'serve');
	const name = analysis.name;
	const cases: string[] = [];

	/** A call of `fn` on `target` - the module, or a handle's object read first. */
	const callCase = (op: number, fn: ExportedFunction, target: string, before: string[]) => {
		const args = fn.paramNames.map((_, i) => `a${i}`).join(', ');
		const lines = [
			...before,
			...fn.wires.map((wire, i) => `\t\t\tconst a${i} = ${codec.read(wire, 'r')};`),
			fn.result ? `\t\t\tconst result = ${target}.${fn.name}(${args});` : `\t\t\t${target}.${fn.name}(${args});`,
			...fn.wires.map((wire, i) => (codec.update(wire, 'r', `a${i}`) ? `\t\t\t${codec.write(wire, 'w', `a${i}`)};` : null)).filter(Boolean),
			...(fn.result ? [`\t\t\t${codec.write(fn.result, 'w', 'result')};`] : []),
			'\t\t\tbreak;',
		];
		cases.push(`\t\tcase ${op}: {\n${lines.join('\n')}\n\t\t}`);
	};

	analysis.functions.forEach((fn, index) => callCase(index, fn, '__m', []));

	const ops = handleOps(analysis);
	analysis.handles.forEach((handle, h) => {
		const wire: Wire = { kind: 'handle', cls: handle };
		handle.fields.forEach((field, f) => {
			const { get, set } = ops[h].fields[f];
			cases.push(`\t\tcase ${get}: {\n\t\t\tconst o = ${codec.read(wire, 'r')};\n\t\t\t${codec.write(field.wire, 'w', `o.${field.name}`)};\n\t\t\tbreak;\n\t\t}`);
			if (set !== null) cases.push(`\t\tcase ${set}: {\n\t\t\tconst o = ${codec.read(wire, 'r')};\n\t\t\to.${field.name} = ${codec.read(field.wire, 'r')};\n\t\t\tbreak;\n\t\t}`);
		});
		handle.calls.forEach((call, c) => callCase(ops[h].calls[c], call, 'o', [`\t\t\tconst o = ${codec.read(wire, 'r')};`]));
	});

	const dispatch = `function __dispatch(op: i32, r: __Reader, w: __Writer): void {\n\tswitch (op) {\n${cases.join('\n')}\n\t}\n}`;
	const callbacks = codec.callbacks();

	return [
		`// GENERATED by scripts/shared-modules.ts: ~/modules/${name}, run by this plugin for every other.`,
		`${REMOTE_IMPORT}, Handles as __Handles, serve as __serve } from "~/remote";`,
		`import * as __m from "~/modules/${name}";`,
		codec.imports(),
		'',
		'const __handles = new __Handles();',
		'// The exported objects are handles 1, 2, ... - the numbers the proxies have.',
		...analysis.objects.map(object => `__handles.id(changetype<usize>(__m.${object.name}));`),
		'',
		dispatch,
		'',
		callbacks,
		'',
		codec.functions(),
		'',
		`__serve("${name}", ${analysis.hash}, __dispatch);`,
		'',
	].join('\n');
}

// ---------------------------------------------------------------- one compile

/**
 * One compile's shared modules: which of the modules it reaches it runs and
 * which it calls, worked out - and the modules analysed - before asc starts.
 * `read` goes into the compile's readFile, `transform` into its transforms.
 */
export async function sharedModulesBuild(root: string, entry: string) {
	const owned = ownedModule(root, entry);
	const proxies = new Map<string, string>();
	let serve: string | null = null;
	let callbacks = false;

	for (const path of sourcesFor(root).reach(join(root, entry))) {
		const name = moduleName(root, path);
		if (!name || !hasOwner(root, name)) continue;
		const surface = await moduleSurface(root, name);
		if (surface.callbacks) callbacks = true;
		if (name === owned) serve = surface.serve;
		else proxies.set(resolve(path), surface.proxy);
	}

	return {
		/** The proxy in place of a module this plugin does not own. */
		read(path: string, text: string): string {
			return proxies.get(resolve(path)) ?? text;
		},

		transform: class {
			afterParse(parser: any): void {
				if (!serve && proxies.size === 0) return;
				// A function that crosses is a stand-in with its place in `_env`,
				// which the compiler passes on every indirect call only when asked.
				if (callbacks) parser.needsCallEnv = true;
				const path = entry.replace(/\\/g, '/');
				const dir = path.includes('/') ? path.replace(/\/[^/]*$/, '/') : '';
				if (serve) parser.parseFile(serve, `${dir}${SERVE_FILE}`, true);
				parser.parseFile(EXPORT_SOURCE, `${dir}${EXPORT_FILE}`, true);
			}
		},
	};
}
