// The compiler a server runs: .ts in, .aot out, in two stages.
//
//   amxts-compile --stage-wasm <source.ts> <out.aot>   asc and Binaryen: the .wasm beside the .aot
//   amxts-compile --stage-aot <source.ts> <out.aot>    wamrc: the .aot, from that .wasm
//   amxts-compile --version                            the build it is of: 0.2.0+1bf291c0ab
//
// This is what the module spawns when it finds a plugin whose source is newer
// than its compiled form, so that a server takes .ts files the way AMX Mod X
// takes .sma. `bun run serverkit` builds it into a single executable, which is
// why it reads its neighbours by path: there is no node_modules beside it on a
// game server.
//
// A game server has little memory to spare, so the module runs the stages one
// after the other, each a process of its own that gives its memory back as it
// exits: a compile takes the larger stage's memory, not their sum. The build
// is a light one (scripts/compile.ts). Not `--wasm`: asc takes that off the
// command line for itself.
//
// wamrc and the signature table sit next to this file, and both belong to the
// module that spawned it - the module's thunks, the plugin's imports and
// wamrc's signatures are three faces of one list - so they travel together.
//
// It compiles for the system it runs on - the server's - unless
// AMXTS_SERVER_OS says otherwise (scripts/system.ts).
import type { PluginNative } from './plugin-natives';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compileToMachineCode, compileToWasm } from './compile';
import { nativesBeside, setNativesBeside } from './plugin-natives';
import { setProjectDir } from './project';
import { executable, HOST_SYSTEM, parseSystem } from './system';

function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

// `bun run serverkit` builds it as the module's build (scripts/build-identity.ts);
// the module asks before it compiles, and refuses a compiler of another. The
// plugins it compiles carry the module's ABI, built in as AMXTS_ABI.
declare const AMXTS_BUILD: string;

const [stage, source, output] = process.argv.slice(2);

if (stage === '--version') {
	process.stdout.write(`${typeof AMXTS_BUILD === 'string' ? AMXTS_BUILD : 'unknown'}\n`);
	process.exit(0);
}

if ((stage !== '--stage-wasm' && stage !== '--stage-aot') || !source || !output) {
	fail('usage: amxts-compile --stage-wasm|--stage-aot <source.ts> <out.aot>');
	process.exit(2);
}

// Beside the executable, not beside the source: a plugin can live anywhere.
const here = dirname(process.execPath);
const wamrc = process.env.AMXTS_WAMRC ?? join(here, executable('wamrc'));
const signatures = process.env.AMXTS_NATIVES ?? join(here, 'natives.txt');

for (const file of [wamrc, signatures]) {
	if (!existsSync(file)) {
		fail(`${file} is missing`);
		process.exit(2);
	}
}

const plugin = {
	source: resolve(source),
	output: resolve(output),
	// `~/` is the folder the plugin sits in, which on a server is
	// addons/amxts/plugins - where the facade and the generated API live too.
	root: dirname(resolve(source)),
	wamrc,
	signatures,
	light: true,
	system: parseSystem(process.env.AMXTS_SERVER_OS) ?? HOST_SYSTEM,
};
const wasm = plugin.output.replace(/\.aot$/, '.wasm');
// What the first stage hands the second beside the wasm: the plugin's natives, for its include.
const natives = `${wasm}.natives.json`;

let problem: string | null;
if (stage === '--stage-wasm') {
	// The plugins folder is the project: a server has no amxts.config.ts, and
	// its modules are the files in plugins/modules.
	setProjectDir(plugin.root);
	const found: PluginNative[] = [];
	problem = await compileToWasm(plugin, wasm, false, found);
	if (!problem) writeFileSync(natives, JSON.stringify({ natives: found, beside: nativesBeside(found) }));
} else {
	const made = JSON.parse(readFileSync(natives, 'utf8'));
	rmSync(natives, { force: true });
	setNativesBeside(made.natives, made.beside);
	problem = compileToMachineCode(plugin, wasm, made.natives);
}

if (problem) {
	fail(problem);
	process.exit(1);
}

if (stage === '--stage-aot') console.log(`compiled ${source}`);
