// Compiles the natives' image, runtime/host/amxts_natives.sma, with the AMX
// Mod X distribution's amxxpc in amxmodx/base - amxxpc.exe on Windows,
// amxxpc on Linux - and writes it into runtime/src/image.h, which the module
// carries and loads every map. `bun run image` writes the .sma first
// (scripts/generate-image.ts); the module is built after it.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { imageHeader } from './image-header';
import { amxxpcPath } from './system';

const amxxpc = amxxpcPath();
if (!existsSync(amxxpc)) {
	process.stderr.write(`${amxxpc} is missing - the scripting/ folder of AMX Mod X 1.10 goes in amxmodx/base (bun run setup:amxmodx)\n`);
	process.exit(1);
}

const image = resolve('runtime/host/amxts_natives.amxx');

// From amxxpc's own folder: on Linux it loads amxxpc32.so from the current
// one. So every path is absolute.
const result = spawnSync(amxxpc, [
	resolve('runtime/host/amxts_natives.sma'),
	`-i${resolve('includes')}`,
	`-i${resolve('includes/vendor')}`,
	`-i${resolve('amxmodx/base/include')}`,
	`-o${image}`,
], { stdio: 'inherit', cwd: dirname(amxxpc) });

if (result.status !== 0) process.exit(result.status ?? 1);

writeFileSync('runtime/src/image.h', imageHeader(readFileSync(image)));
console.log('✅ runtime/src/image.h');
