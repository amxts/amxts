// The compiler a server runs: .ts in, .aot out.
//
//   amxts-compile <source.ts> <out.aot>
//
// This is what the module spawns when it finds a plugin whose source is newer
// than its compiled form, so that a server takes .ts files the way AMX Mod X
// takes .sma. `bun run serverkit` builds it into a single executable, which is
// why it reads its neighbours by path: there is no node_modules beside it on a
// game server.
//
// wamrc and the signature table sit next to this file, and both belong to the
// module that spawned it - the module's thunks, the plugin's imports and
// wamrc's signatures are three faces of one list - so they travel together.
//
// It compiles for the system it runs on - the server's - unless
// AMXTS_SERVER_OS says otherwise (scripts/system.ts).
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { compilePlugin } from './compile';
import { setProjectDir } from './project';
import { executable, HOST_SYSTEM, parseSystem } from './system';

function fail(message: string): void {
	process.stderr.write(`${message}\n`);
}

const [source, output] = process.argv.slice(2);

if (!source || !output) {
	fail('usage: amxts-compile <source.ts> <out.aot>');
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

// The plugins folder is the project: a server has no amxts.config.ts, and
// its modules are the files in plugins/modules.
setProjectDir(dirname(resolve(source)));

const problem = await compilePlugin({
	source: resolve(source),
	output: resolve(output),
	// `~/` is the folder the plugin sits in, which on a server is
	// addons/amxts/plugins - where the facade and the generated API live too.
	root: dirname(resolve(source)),
	wamrc,
	signatures,
	system: parseSystem(process.env.AMXTS_SERVER_OS) ?? HOST_SYSTEM,
});

if (problem) {
	fail(problem);
	process.exit(1);
}

console.log(`compiled ${source}`);
