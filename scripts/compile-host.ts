// Compiles the host plugin, runtime/host/amxts_host.sma, with the AMX Mod X
// distribution's amxxpc in amxmodx/base - amxxpc.exe on Windows, amxxpc on
// Linux. `bun run host` writes the .sma first (scripts/generate-host.ts).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { amxxpcPath } from './system';

const amxxpc = amxxpcPath();
if (!existsSync(amxxpc)) {
	process.stderr.write(`${amxxpc} is missing - the scripting/ folder of AMX Mod X 1.10 goes in amxmodx/base (bun run setup:amxmodx)\n`);
	process.exit(1);
}

// From amxxpc's own folder: on Linux it loads amxxpc32.so from the current
// one. So every path is absolute.
const result = spawnSync(amxxpc, [
	resolve('runtime/host/amxts_host.sma'),
	`-i${resolve('includes')}`,
	`-i${resolve('includes/vendor')}`,
	`-i${resolve('amxmodx/base/include')}`,
	`-o${resolve('runtime/host/amxts_host.amxx')}`,
], { stdio: 'inherit', cwd: dirname(amxxpc) });

process.exit(result.status ?? 1);
