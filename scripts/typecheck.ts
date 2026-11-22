// `amxts typecheck`: TypeScript over the project (src/typecheck.mjs), then,
// when it finds nothing, AssemblyScript's compiler over each of the project's
// plugins as the build compiles it - the same files, auto-imports, proxies,
// natives and settings - stopped before the binary (checkPlugin): what
// TypeScript takes and the build refuses. Several plugins at once, as the
// build compiles them (scripts/compile-pool.ts); each one's errors as the
// build prints them.
//
//   amxts typecheck      in the project's folder; exits 1 on any error
// @ts-ignore - plain JavaScript
import { typescriptErrors } from '../src/typecheck.mjs';
import { checkPlugin, readable } from './compile';
import { compileAll } from './compile-pool';
import { CORE_PLUGINS, loadProject, pluginName, projectPlugins } from './project';
import { c, log, progress } from './ui';

if (typescriptErrors() > 0) process.exit(1);

const project = loadProject(process.cwd());
if (project.problems.length) {
	log.error(project.problems.join('\n'));
	process.exit(1);
}

const sources = projectPlugins(project);
const step = progress(`compiling ${sources.length} plugin${sources.length === 1 ? '' : 's'} as the build does`);
// A check writes nothing: no .aot, no wamrc.
const plugins = sources.map(source => ({ source, root: CORE_PLUGINS, output: '', wamrc: '', signatures: '' }));
const checked = await compileAll(plugins, { dir: null, includes: [], here: checkPlugin, check: true }).finally(() => step.end());

const failures = checked.flatMap((each, index) => (each?.problem ? [`${c.bold(pluginName(project, sources[index]))} does not compile:\n${readable(each.problem)}\n`] : []));
if (failures.length) {
	log.error(failures.join('\n').trim());
	process.exit(1);
}
