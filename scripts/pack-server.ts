import type { System } from './system';
import { spawnSync } from 'node:child_process';
// Assembles what goes on a server, into dist-server/<os>/.
//
//   bun run serverkit                  for a server of this machine's system
//   bun run serverkit --os linux       for a Linux server (bun run build:linux first)
//
// A server that takes .ts plugins carries the compiler, the way AMX Mod X
// carries amxxpc. That is two executables and a table:
//
//   tools/amxts-compile(.exe)   asc and wamrc in one file, built by bun
//   tools/wamrc(.exe)           what turns wasm into i386 machine code
//   tools/natives.txt           the signatures that make a native call direct
//
// The executables are the server's system's: a Linux kit carries Linux ones,
// x86-64 - a 32-bit hlds_linux runs on a 64-bit system, and Bun has no
// 32-bit build - with glibc 2.27 or newer.
//
// and the API a plugin imports, which lives beside the plugins because that is
// where `import "./facade"` looks:
//
//   plugins/facade.ts, natives.ts, constants.ts and the rest of as/
//
// All of it belongs to one build of the module: the module's thunks, a
// plugin's imports and wamrc's signatures are three faces of one list.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildDefine, moduleBuild } from './build-identity';
import { serverFiles } from './server-files';
import { executable, HOST_SYSTEM, MODULE_FILE, modulePath, parseSystem, SYSTEM_NAME, wamrcPath } from './system';

// console.error is not available here: importing assemblyscript/asc brings its
// own global console, which has only log(), and it shadows node's for the whole
// program. process.stderr is the way out that keeps every script type-checked.
function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

const osArg = process.argv.indexOf('--os');
const system: System | null = osArg >= 0 ? parseSystem(process.argv[osArg + 1]) : HOST_SYSTEM;
if (!system) {
	fail('--os windows|linux');
	process.exit(1);
}

const out = join('./dist-server', system);
// The kit's wamrc runs on the server, so it is the server's system's: this
// machine's own, or the one `bun run build:linux` made.
const wamrc = process.env.AMXTS_KIT_WAMRC
	?? (system === HOST_SYSTEM ? wamrcPath() : system === 'linux' ? './runtime/build/linux/wamrc' : '');
const module_ = modulePath(system);
// Bun's baseline build: no AVX2 needed, which not every game server's CPU has.
const BUN_TARGET: Record<System, string> = { windows: 'bun-windows-x64-baseline', linux: 'bun-linux-x64-baseline' };

if (!wamrc) {
	fail(`a ${SYSTEM_NAME[system]} wamrc is built on ${SYSTEM_NAME[system]} - set AMXTS_KIT_WAMRC to one`);
	process.exit(1);
}

for (const file of ['as/facade.ts', 'as/natives.ts', 'as/constants.ts', 'as/events.ts', 'runtime/natives.txt', wamrc]) {
	if (!existsSync(file)) {
		fail(`${file} is missing — run bun run generate, and see CONTRIBUTING.md for wamrc`);
		process.exit(1);
	}
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'addons/amxts/tools'), { recursive: true });
mkdirSync(join(out, 'addons/amxts/plugins'), { recursive: true });
mkdirSync(join(out, 'addons/amxts/build'), { recursive: true });
mkdirSync(join(out, 'addons/amxmodx/modules'), { recursive: true });

// The module's build, which the compiler is built as: the module refuses a
// compiler of another (scripts/build-identity.ts).
const identity = moduleBuild();
if (!identity) {
	fail('runtime/src/embedded.h names no build - run bun run generate, then build the module');
	process.exit(1);
}

// One executable rather than a JS runtime and a node_modules: nothing on a
// game server should need `bun install`.
const build = spawnSync(process.execPath, [
	'build',
	'--compile',
	'scripts/compile-one.ts',
	buildDefine(identity),
	`--target=${BUN_TARGET[system]}`,
	'--outfile',
	join(out, 'addons/amxts/tools', executable('amxts-compile', system)),
], { encoding: 'utf-8' });

if (build.status !== 0) {
	fail(build.stdout + build.stderr);
	process.exit(1);
}

copyFileSync(wamrc, join(out, 'addons/amxts/tools', executable('wamrc', system)));
// The module sets them again before running them: an archive or an FTP
// upload may not keep them.
if (system === 'linux') {
	for (const tool of ['amxts-compile', 'wamrc']) chmodSync(join(out, 'addons/amxts/tools', tool), 0o755);
}

// The compilers and the module are built from AssemblyScript, Binaryen, Bun,
// WAMR and LLVM - two of them patched - and their licenses travel with them
// (runtime/licenses/README.md), with amxts' own.
cpSync('runtime/licenses', join(out, 'addons/amxts/tools/licenses'), { recursive: true });
copyFileSync('LICENSE', join(out, 'addons/amxts/tools/licenses/amxts-LICENSE'));

// The API a plugin imports, the editor's files, the signature table,
// plugins.ini and the example: what the module writes out on a start.
for (const file of serverFiles()) {
	const path = join(out, 'addons/amxts', file.path);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, file.text);
}

// A plugin author has no node_modules, and without AssemblyScript's types an
// editor marks every i32, every StaticArray and every @external as an error -
// on files that compile perfectly. So its standard library travels with the
// kit, and a tsconfig beside the plugins points at it. 900 KB, against the
// 178 MB of compiler already here.
const std = 'node_modules/assemblyscript/std';

if (!existsSync(std)) {
	fail(`${std} is missing - run bun install`);
	process.exit(1);
}

cpSync(join(std, 'assembly'), join(out, 'addons/amxts/plugins/.assemblyscript/assembly'), { recursive: true });
cpSync(join(std, 'types'), join(out, 'addons/amxts/plugins/.assemblyscript/types'), { recursive: true });

// The module carries the host plugin and writes it out for AMX Mod X itself.
if (existsSync(module_)) {
	copyFileSync(module_, join(out, 'addons/amxmodx/modules', MODULE_FILE[system]));
} else {
	process.stdout.write(`note: ${module_} is not built, the kit has no module\n`);
}
// The module's natives for Pawn plugins: the fields plugins add to Player.
mkdirSync(join(out, 'addons/amxmodx/scripting/include'), { recursive: true });
copyFileSync('./runtime/host/amxts.inc', join(out, 'addons/amxmodx/scripting/include/amxts.inc'));

writeFileSync(join(out, 'README.txt'), `amxts — write AMX Mod X plugins in TypeScript

Copy addons/ over your server's addons/, then add one line to
addons/amxmodx/configs/modules.ini:

  amxts_amxx

That is all: plugins.ini needs no line. The module loads its host plugin
itself - on every start it writes amxts_host.amxx into addons/amxmodx/plugins
and names it in addons/amxmodx/configs/plugins-amxts.ini, and it removes both
when the server stops.
This kit is for a ${SYSTEM_NAME[system]} server: the module is ${MODULE_FILE[system]}.

Writing a plugin
----------------
Put a .ts file in addons/amxts/plugins and name it in plugins.ini. The server
compiles it on the next map change, and every time you save it after that —
no toolchain on your machine, nothing to install, nothing to restart. Errors
go to the server console.

addons/amxts/plugins/hello.ts is a working example. facade.ts beside it is the
API; natives.ts and constants.ts are every AMX Mod X native and constant, both
generated. A plugin uses the API without an import line: the compiler adds the
imports of what it uses, and imports.d.ts tells the editor the same names.

This is AssemblyScript, not TypeScript: i32 and StaticArray are its own, and a
plugin compiles to WebAssembly rather than to JavaScript. tsconfig.json and
.assemblyscript beside your plugins are what an editor reads to know that -
open this folder, not the server root, and nothing will look like an error.

Two server commands: amxts_plugins lists what is loaded, amxts_reload starts
them over.

What is in tools/
-----------------
${executable('amxts-compile', system)} turns a .ts into WebAssembly and then into i386 machine code,
using ${executable('wamrc', system)} and natives.txt beside it. All three belong to this module —
replacing one without the others makes a plugin that cannot resolve its calls,
which the compiler refuses rather than running slowly.

tools/licenses/ has the licenses of what they are built from: AssemblyScript
and WAMR, both patched by amxts (the patches are in the amxts repository,
runtime/patches), Binaryen, Bun and LLVM - and of what the module carries for
web requests: curl, Mbed TLS, libssh2 and Mozilla's certificate authorities.
amxts itself is MIT.
`);

console.log(`✅ ${out}`);
