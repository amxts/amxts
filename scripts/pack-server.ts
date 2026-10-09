import type { System } from './system';
// Assembles what goes on a server, into dist-server/<os>/.
//
//   bun run serverkit                  for a server of this machine's system
//   bun run serverkit --os linux       for a Linux server (bun run build:linux first)
//
// A server loads .aot files only, as AMX Mod X loads .amxx: plugins are built
// on the author's machine (npx amxts build) and uploaded. So the kit is the
// module, its Pawn include, a plugin list and an example built for the
// server's system - hello.aot, from runtime/host/hello.ts, which shows on the
// first start that the module works - and the licenses.
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePlugin } from './compile';
import { CORE_PLUGINS } from './project';
import { pluginList } from './server-files';
import { HOST_SYSTEM, MODULE_FILE, modulePath, parseSystem, SYSTEM_NAME, wamrcPath } from './system';

// console.error is not available here: importing assemblyscript/asc brings its
// own global console, which has only log(), and it shadows node's for the whole
// program. process.stderr is the way out that keeps every script type-checked.
function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

/** The licenses of runtime/licenses that are not of what the kit carries: the build's tools'. */
const BUILD_TOOLS_ONLY = new Set(['Binaryen-LICENSE', 'LLVM-LICENSE.TXT']);

const osArg = process.argv.indexOf('--os');
const system: System | null = osArg >= 0 ? parseSystem(process.argv[osArg + 1]) : HOST_SYSTEM;
if (!system) {
	fail('--os windows|linux');
	process.exit(1);
}

const out = join('./dist-server', system);
const amxts = join(out, 'addons/amxts');
const module_ = modulePath(system);

for (const file of ['as/facade.ts', 'runtime/natives.txt', wamrcPath()]) {
	if (!existsSync(file)) {
		fail(`${file} is missing — run bun run generate, and see CONTRIBUTING.md for wamrc`);
		process.exit(1);
	}
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(amxts, 'plugins'), { recursive: true });
mkdirSync(join(out, 'addons/amxmodx/modules'), { recursive: true });

// The example, built as `amxts build` builds a plugin, for the server's
// system: this machine's wamrc writes either system's .aot. Built aside, as
// a build leaves its .wasm beside the .aot.
const scratch = mkdtempSync(join(tmpdir(), 'amxts-kit-'));
const problem = await compilePlugin({
	source: 'runtime/host/hello.ts',
	output: join(scratch, 'hello.aot'),
	root: CORE_PLUGINS,
	wamrc: wamrcPath(),
	signatures: 'runtime/natives.txt',
	system,
});
if (problem) {
	fail(`runtime/host/hello.ts does not compile:\n${problem}`);
	process.exit(1);
}
copyFileSync(join(scratch, 'hello.aot'), join(amxts, 'plugins/hello.aot'));
rmSync(scratch, { recursive: true, force: true });

const list = pluginList(['hello.aot']);
writeFileSync(join(amxts, list.path), list.text);

// The module and the example are built from AMX Mod X's SDK and includes,
// ReHLDS' and ReGameDLL's API, WAMR, curl, Mbed TLS, libssh2, Mozilla's
// certificate authorities and AssemblyScript's runtime - their licenses travel
// with them (runtime/licenses/README.md), with amxts' own.
mkdirSync(join(amxts, 'licenses'));
for (const name of readdirSync('runtime/licenses').filter(name => !BUILD_TOOLS_ONLY.has(name) && name !== 'README.md')) {
	copyFileSync(join('runtime/licenses', name), join(amxts, 'licenses', name));
}
copyFileSync('LICENSE', join(amxts, 'licenses/amxts-LICENSE'));

// The module is all AMX Mod X needs: it carries its natives' image itself.
if (existsSync(module_)) {
	copyFileSync(module_, join(out, 'addons/amxmodx/modules', MODULE_FILE[system]));
} else {
	process.stdout.write(`note: ${module_} is not built, the kit has no module\n`);
}
// The module's natives for Pawn plugins: the fields plugins add to Player.
mkdirSync(join(out, 'addons/amxmodx/scripting/include'), { recursive: true });
cpSync('./runtime/host/amxts.inc', join(out, 'addons/amxmodx/scripting/include/amxts.inc'));

writeFileSync(join(out, 'README.txt'), `amxts — write AMX Mod X plugins in TypeScript

Copy addons/ over your server's addons/, then add one line to
addons/amxmodx/configs/modules.ini:

  amxts_amxx

That is all: AMX Mod X's plugins.ini needs no line, and no plugin of amxts
goes in addons/amxmodx/plugins.
This kit is for a ${SYSTEM_NAME[system]} server: the module is ${MODULE_FILE[system]}.

On the first start the server loads addons/amxts/plugins/hello.aot, an
example plugin; the console says "[amxts] loaded hello.aot".

Plugins
-------
A server loads plugins built on your machine, as AMX Mod X loads .amxx files
compiled from .sma: it does not build them. Make a project with
npx create-amxts, build it with npx amxts build, and put the .aot files from
its dist/ folder into addons/amxts/plugins, each named in
addons/amxts/plugins.ini. npx amxts dev does that for you on every save and
reloads the server. A .ts file put on the server is not built: the console
says so. hello.aot is built from runtime/host/hello.ts of the amxts
repository.

Server commands: amxts_plugins lists the plugins and what each is doing,
amxts_reload starts them over (amxts_reload <plugin> one of them), and
amxts_unload <plugin> and amxts_load <plugin> stop and start one.

addons/amxts/licenses/ has the licenses of what the module and the example are
built from: AMX Mod X's SDK and includes, ReHLDS and ReGameDLL, WAMR and
AssemblyScript (both patched by amxts - the patches are in the amxts
repository, runtime/patches), and what the module carries for web requests:
curl, Mbed TLS, libssh2 and Mozilla's certificate authorities. amxts itself
is MIT.
`);

console.log(`✅ ${out}`);
