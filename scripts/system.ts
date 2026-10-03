// The server's system for the build (src/system.mjs says how it is decided and
// why it matters), and where the core keeps what each system needs.
import type { System } from '../src/system.mjs';
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executable, MODULE_FILE } from '../src/system.mjs';

export type { ServerSystem, System } from '../src/system.mjs';
export { describeSystem, detectServerSystem, executable, HOST_SYSTEM, manifestName, MODULE_FILE, moduleVersion, parseSystem, serverFiles, serverFolder, serverImage, serverSystem, SYSTEM_NAME, SYSTEMS, TARGET_ABI, WAMRC_PACKAGE, wamrcPath } from '../src/system.mjs';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Where the amxts module of a system is built: CMake's Release folder on Windows, runtime/build/linux from the Linux toolchain. */
export function modulePath(system: System): string {
	return system === 'windows'
		? join(CORE, 'runtime/build/Release', MODULE_FILE.windows)
		: join(CORE, 'runtime/build/linux', MODULE_FILE.linux);
}

/**
 * The API a plugin imports, and the declarations an editor reads with it
 * (the globals of amxts.d.ts, promise.types.d.ts): every file at the top of
 * as/. A server kit carries them beside its plugins.
 */
export function apiFiles(): string[] {
	return readdirSync(join(CORE, 'as')).filter(name => name.endsWith('.ts'));
}

/** AMX Mod X's Pawn compiler in amxmodx/base, for this machine. */
export function amxxpcPath(): string {
	return join(CORE, 'amxmodx/base', executable('amxxpc'));
}
