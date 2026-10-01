// Checks a module package before it is published - `npx amxts check` in the
// module's folder, as a CI step:
//
// - package.json's "amxts" field points at files that are there;
// - the module file declares itself with defineModule, meta.name its name -
//   or, for a library (`"library": true`), has none and compiles;
// - README.md and LICENSE are there;
// - the natives compile, and include/<name>.inc is what the build writes from
//   them - not stale after an edit of natives.ts. With `"contract": true`
//   the include is the original's: the natives compiling means they match it.
//
// It writes nothing into the package; what it compiles goes to a temporary
// folder.
import type { PluginNative } from './plugin-natives';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { importedName } from './auto-imports';
import { compileToWasm } from './compile';
import { includeName, pawnInclude } from './plugin-natives';
import { CORE_PLUGINS, loadProject, readDefinition, readPackage, sourcesFor } from './project';
import { compileAlone } from './shared-modules';
import { c, log } from './ui';

function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

const dir = process.cwd();
const problems: string[] = [];
const passed: string[] = [];

let pkg: ReturnType<typeof readPackage> = null;
try {
	pkg = readPackage(dir);
} catch (problem) {
	problems.push((problem as Error).message);
}

if (!pkg && problems.length === 0) {
	fail('amxts check: this folder is not a module package - package.json has no "amxts": { "module": ... }');
	process.exit(1);
}

if (pkg) {
	passed.push(`"amxts" points at ${[pkg.module, pkg.natives, pkg.include].filter(Boolean).map(file => relative(dir, file!).replace(/\\/g, '/')).join(', ')}`);

	try {
		const definition = pkg.library ? null : readDefinition(pkg.module);
		if (pkg.library) passed.push('a library: compiled into each plugin that imports it');
		else if (!definition) problems.push(`${relative(dir, pkg.module)}: no \`export default defineModule({ meta: { name: "${pkg.short}" }, ... })\``);
		else if (!definition.name) problems.push(`${relative(dir, pkg.module)}: defineModule has no meta.name - "${pkg.short}"`);
		else passed.push(`defineModule: ${definition.name}${definition.configKey ? `, options under "${definition.configKey}"` : ''}${definition.imports.length ? `, plugins use it as ${definition.imports.map(importedName).join(', ')}` : ''}`);
	} catch (problem) {
		problems.push((problem as Error).message);
	}

	for (const file of ['README.md', 'LICENSE']) {
		if (!existsSync(join(dir, file))) problems.push(`${file} is missing`);
	}

	const project = loadProject(dir);
	problems.push(...project.problems);
	if (pkg.natives && project.problems.length === 0) await checkNatives(pkg);
	if (pkg.library && project.problems.length === 0) await checkLibrary(pkg);
}

async function checkLibrary(library: NonNullable<typeof pkg>) {
	const file = relative(dir, library.module).replace(/\\/g, '/');
	try {
		await compileAlone(CORE_PLUGINS, library.short);
		passed.push(`${file} compiles`);
	} catch (problem) {
		problems.push((problem as Error).message.replace(`~/modules/${library.short}`, file));
	}
}

async function checkNatives(module: NonNullable<typeof pkg>) {
	const sources = sourcesFor(CORE_PLUGINS);
	const out = mkdtempSync(join(tmpdir(), 'amxts-check-'));
	try {
		const natives: PluginNative[] = [];
		const problem = await compileToWasm({ source: sources.ownerSource(module), root: CORE_PLUGINS }, join(out, `${module.short}.wasm`), false, natives);
		if (problem) {
			problems.push(`${relative(dir, module.natives!)} does not compile:\n${problem.trim()}`);
			return;
		}
		if (module.contract) {
			passed.push(`${natives.length} natives match the contract ${relative(dir, module.include!).replace(/\\/g, '/')}`);
			return;
		}
		const include = module.include ?? join(dir, 'include', `${includeName(module.short)}.inc`);
		const expected = pawnInclude(module.short, natives).replace(/\r\n/g, '\n');
		const actual = existsSync(include) ? readFileSync(include, 'utf8').replace(/\r\n/g, '\n') : null;
		const name = relative(dir, include).replace(/\\/g, '/');
		if (actual === null) problems.push(`${name} is missing - npx amxts build writes it from ${basename(module.natives!)}`);
		else if (actual !== expected) problems.push(`${name} is stale: it is not what ${basename(module.natives!)} gives - run npx amxts build and commit it`);
		else passed.push(`${name} is up to date with ${natives.length} natives`);
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

for (const line of passed) log.success(line);
for (const line of problems) log.error(line);
if (problems.length === 0) log.success(c.bold(`${pkg!.name} is ready to publish`));
process.exit(problems.length ? 1 : 0);
