import type { System } from './system';
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
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildConstants, moduleAbi, moduleBuild } from './build-identity';
import { serverFiles } from './server-files';
import { executable, HOST_SYSTEM, MODULE_FILE, modulePath, parseSystem, SYSTEM_NAME, wamrcPath } from './system';

// console.error is not available here: importing assemblyscript/asc brings its
// own global console, which has only log(), and it shadows node's for the whole
// program. process.stderr is the way out that keeps every script type-checked.
function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

/** Bun's bundler, as this script uses it: the scripts are typed for Node. */
interface BunBuild {
	build: (options: object) => Promise<{ success: boolean; logs: unknown[] }>;
}
const bun = (globalThis as unknown as { Bun: BunBuild }).Bun;

interface Loading {
	onLoad: (options: { filter: RegExp }, load: (args: { path: string }) => { loader: string; contents: string }) => void;
}

/** What an escape in a JavaScript string stands for, by the letter after the backslash. */
const ESCAPED: Record<string, string> = { n: '\n', r: '\r', t: '\t', v: '\v', b: '\b', f: '\f', 0: '\0' };

/**
 * Binaryen's wasm as a file inside the executable rather than the string
 * literal its JavaScript carries it in: the literal, the source around it
 * and the string made of it stayed in memory beside the bytes, in each stage
 * of every compile on a server. The bytes are written to `dir` for the
 * bundler to take in.
 */
function binaryenWasmFile(dir: string) {
	return {
		name: 'binaryen-wasm',
		setup(build: Loading) {
			build.onLoad({ filter: /[\\/]binaryen[\\/]index\.js$/ }, ({ path }) => {
				const source = readFileSync(path, 'latin1');
				const literal = 'WA??=L6(`';
				const start = source.indexOf(literal) + literal.length;
				if (start < literal.length) throw new Error(`${path}: no ${literal} - Binaryen carries its wasm another way now`);
				const bytes: number[] = [];
				let at = start;
				while (source[at] !== '`') {
					const char = source[at++];
					if (char !== '\\') {
						bytes.push(char.charCodeAt(0));
						continue;
					}
					const escape = source[at++];
					if (escape === 'x') {
						bytes.push(Number.parseInt(source.slice(at, at + 2), 16));
						at += 2;
					} else {
						bytes.push((ESCAPED[escape] ?? escape).charCodeAt(0));
					}
				}
				const wasm = new Uint8Array(bytes);
				if (Buffer.from(wasm.subarray(0, 4)).toString('latin1') !== '\0asm') throw new Error(`${path}: what ${literal} holds is not wasm`);
				const file = join(dir, 'binaryen.wasm');
				writeFileSync(file, wasm);
				return {
					loader: 'js',
					contents: [
						`import __binaryenWasm from ${JSON.stringify(file)} with { type: "file" };`,
						`import { readFileSync as __readBinaryenWasm } from "node:fs";`,
						`${source.slice(0, start - literal.length)}WA??=new Uint8Array(__readBinaryenWasm(__binaryenWasm))${source.slice(at + 2)}`,
					].join('\n'),
				};
			});
		},
	};
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
// compiler of another (scripts/build-identity.ts). Its plugins are stamped
// with the module's ABI.
const identity = moduleBuild();
const abi = moduleAbi();
if (!identity || !abi) {
	fail('runtime/src/embedded.h names no build - run bun run generate, then build the module');
	process.exit(1);
}

// One executable rather than a JS runtime and a node_modules: nothing on a
// game server should need `bun install`.
const build = await bun.build({
	entrypoints: ['scripts/compile-one.ts'],
	compile: { target: BUN_TARGET[system], outfile: join(out, 'addons/amxts/tools', executable('amxts-compile', system)) },
	define: buildConstants(identity, abi),
	plugins: [binaryenWasmFile(mkdtempSync(join(tmpdir(), 'amxts-binaryen-')))],
});

if (!build.success) {
	fail(build.logs.join('\n'));
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

// The module is all AMX Mod X needs: it carries its natives' image itself.
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

That is all: AMX Mod X's plugins.ini needs no line, and no plugin of amxts
goes in addons/amxmodx/plugins.
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

Server commands: amxts_plugins lists the plugins and what each is doing,
amxts_reload starts them over (amxts_reload <plugin> one of them), and
amxts_unload <plugin> and amxts_load <plugin> stop and start one.

What is in tools/
-----------------
${executable('amxts-compile', system)} turns a .ts into WebAssembly and then into i386 machine code,
using ${executable('wamrc', system)} and natives.txt beside it. All three belong to this module —
replacing one without the others makes a plugin that cannot resolve its calls,
which the compiler refuses rather than running slowly.

A compile needs about 500 MB of memory beside the game, and only while it
runs: one plugin at a time, its two steps one after the other. To fit there
the server optimises less than npx amxts build, so a plugin it compiles runs
slower. In a container with a memory limit too low for that the compiler is
killed, and the console says so: build the plugins on your machine
(npx amxts build) and put the .aot files on the server.

tools/licenses/ has the licenses of what they are built from: AssemblyScript
and WAMR, both patched by amxts (the patches are in the amxts repository,
runtime/patches), Binaryen, Bun and LLVM - and of what the module carries for
web requests: curl, Mbed TLS, libssh2 and Mozilla's certificate authorities.
amxts itself is MIT.
`);

console.log(`✅ ${out}`);
