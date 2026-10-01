// Compiles the host plugin, runtime/host/amxts_host.sma, with the AMX Mod X
// distribution's amxxpc in amxmodx/base - amxxpc.exe on Windows, amxxpc on
// Linux - and writes it into runtime/src/host.h, which the module carries:
// the module writes it out for AMX Mod X on every start, so a server installs
// the module alone. `bun run host` writes the .sma first
// (scripts/generate-host.ts); the module is built after it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { hostHeader } from './host-header';
import { amxxpcPath } from './system';

const amxxpc = amxxpcPath();
if (!existsSync(amxxpc)) {
	process.stderr.write(`${amxxpc} is missing - the scripting/ folder of AMX Mod X 1.10 goes in amxmodx/base (bun run setup:amxmodx)\n`);
	process.exit(1);
}

const plugin = resolve('runtime/host/amxts_host.amxx');

// From amxxpc's own folder: on Linux it loads amxxpc32.so from the current
// one. So every path is absolute.
const result = spawnSync(amxxpc, [
	resolve('runtime/host/amxts_host.sma'),
	`-i${resolve('includes')}`,
	`-i${resolve('includes/vendor')}`,
	`-i${resolve('amxmodx/base/include')}`,
	`-o${plugin}`,
], { stdio: 'inherit', cwd: dirname(amxxpc) });

if (result.status !== 0) process.exit(result.status ?? 1);

writeFileSync('runtime/src/host.h', hostHeader(readFileSync(plugin)));
console.log('✅ runtime/src/host.h');
