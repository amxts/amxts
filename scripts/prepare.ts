// What an editor needs to read a project: .amxts/tsconfig.json, which the
// project's tsconfig.json extends.
//
//   npx amxts prepare        (also the first step of `amxts build`, with --quiet:
//                            the line it prints only under --debug)
//
// The project's own tsconfig.json extends it: { "extends": "./.amxts/tsconfig.json" }.
// It says what the build says - `~/` is the project's plugins over the
// core's as/, "@amxts/core" is the facade, a module package is its module
// file - and it takes in amxts.config.ts and every module the config lists, so
// that the options each module declares (ModuleOptions) type the config.
// Beside it, imports.d.ts makes what plugins use without an import - the
// facade's API, the modules' namespaces - globals for the editor
// (scripts/auto-imports.ts).
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { applyProject, docsLang } from './apply-docs';
import { importsDeclaration } from './auto-imports';
import { CONFIG_FILE, CORE_DIR, CORE_PLUGINS, loadProject } from './project';
import { c, debug, log } from './ui';

function fail(message: string): void {
	log.error(message);
}

const project = loadProject(process.cwd());
if (project.problems.length) {
	for (const problem of project.problems) fail(problem);
	const missing = project.problems.map(problem => problem.match(/module "([^"]+)" is not installed/)?.[1]).filter(Boolean);
	if (missing.length) log.hint(`Install ${missing.length > 1 ? 'them' : 'it'}: amxts module add ${missing.join(' ')}`);
	process.exit(1);
}

// The hood's tooltips - the core's and the modules' - in the language .env
// picks (AMXTS_DOCS_LANG), as the generated API has them. A core it cannot
// write to keeps English: the editor still has words, only not these.
let docs = '';
try {
	docs = await applyProject(project.dir, docsLang());
} catch (error) {
	fail(`docs: ${(error as Error).message}`);
}

// A module's own folder, without a project config, has its own tsconfig.json
// (extending the core's as/tsconfig.json): nothing to write there.
if (!project.config && project.packages.some(pkg => pkg.dir === project.dir)) process.exit(0);

const out = join(project.dir, '.amxts');
/** A path as the generated config writes it: from .amxts/, with forward slashes. */
function from(path: string) {
	const rel = relative(out, path).replace(/\\/g, '/');
	// Another drive has no relative path: the absolute one, then.
	if (isAbsolute(rel)) return rel;
	return rel.startsWith('.') ? rel : `./${rel}`;
}

// AssemblyScript's own config - its types for the standard library - is the
// core's: the project does not install AssemblyScript itself.
const assembly = createRequire(join(CORE_DIR, 'package.json')).resolve('assemblyscript/std/assembly.json');

/**
 * Whether `name` is found from the project as a package - in node_modules, as
 * Node looks, and the same folder the build takes (a link counts as its
 * target). Such a package is resolved by its package.json ("exports",
 * "types"), not mapped to a file: tools that read tsconfig (knip) take a
 * mapped name for a folder of the project, and its dependency for unused.
 */
function installed(name: string, dir: string) {
	for (let at = project.dir; ; at = dirname(at)) {
		const path = join(at, 'node_modules', name);
		if (existsSync(path)) return realpathSync(path) === realpathSync(dir);
		if (dirname(at) === at) return false;
	}
}

// `~/` is not a package. The core and the modules are, once installed; one
// that is not (a module in modules/, a core run from elsewhere) is mapped to
// its file, as the build finds it.
const paths: Record<string, string[]> = {
	'~/*': [...new Set([`${from(project.pluginsDir)}/*`, `${from(CORE_PLUGINS)}/*`])],
};
if (!installed('@amxts/core', CORE_DIR)) {
	paths['@amxts/core'] = [from(join(CORE_PLUGINS, 'facade.ts'))];
	paths['@amxts/core/*'] = [`${from(CORE_PLUGINS)}/*`];
}
for (const pkg of project.modules) {
	if (!installed(pkg.name, pkg.dir)) paths[pkg.name] = [from(pkg.module)];
}

const tsconfig = {
	extends: from(assembly),
	compilerOptions: {
		// The core's: the lowest target TypeScript 7 keeps. `for (const x of
		// list)` checks against the iterator the core's patched typings give
		// arrays and strings; the compiler lowers the loop itself.
		target: 'es2015',
		// A package by its package.json "exports", as Bun and TypeScript 6 and
		// later read it; TypeScript 5.9 takes "bundler" only with an ES module.
		// asc does not read this: scripts/project.ts answers the names for it.
		module: 'esnext',
		moduleResolution: 'bundler',
		// Every file is a module, one without an import line too: what a
		// plugin declares is its own, never a global another plugin's name
		// collides with.
		moduleDetection: 'force',
		paths,
	},
	include: [
		`${from(project.pluginsDir)}/**/*.ts`,
		from(join(project.dir, CONFIG_FILE)),
		`${from(CORE_PLUGINS)}/*.d.ts`,
		'./modules.d.ts',
		'./imports.d.ts',
	],
};

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, '\t')}\n`);
writeFileSync(join(out, 'modules.d.ts'), [
	'// GENERATED by amxts prepare: the modules amxts.config.ts lists, for the',
	'// options each one adds to ModuleOptions.',
	...project.modules.map(pkg => `import "${pkg.name}";`),
	'',
	'export {};',
	'',
].join('\n'));

writeFileSync(join(out, 'imports.d.ts'), importsDeclaration(project.autoImports));

// A step of dev, build and typecheck, which say what the project is
// themselves: they pass --quiet, and --debug shows it all the same.
const modules = project.modules.map(pkg => pkg.short).join(', ') || 'no modules';
if (!process.argv.includes('--quiet') || debug()) log.step(c.dim(`prepared ${(relative(process.cwd(), out) || '.').replace(/\\/g, '/')}/tsconfig.json (${modules})${docs ? ` · ${docs}` : ''}`));
