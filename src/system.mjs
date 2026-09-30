// Which system a server runs - Windows or Linux - and what that decides.
//
// A plugin's .aot is machine code in the target system's object format: wamrc
// writes COFF for Windows and ELF for Linux, and each system's loader knows
// only its own relocations. The code, the natives and the calls are the same;
// the file is not. So what a build compiles for is the server's system, not
// the one the build runs on: `--target-abi=msvc` or `gnu`, which either wamrc
// - Windows' or Linux' - produces byte for byte the same.
//
// The server's system is, first to last: `--os windows|linux`, AMXTS_SERVER_OS,
// what AMXTS_SERVER holds (hlds.exe or hlds_linux beside the game folder, else
// the modules' files), and this machine's own.
//
// Plain JavaScript: the build (scripts/system.ts) and the amxts command, through
// cli-api, both read it.
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {'windows' | 'linux'} System */

/** @type {readonly System[]} */
export const SYSTEMS = ['windows', 'linux'];

/** The system this machine runs. @type {System} */
export const HOST_SYSTEM = process.platform === 'win32' ? 'windows' : 'linux';

/** How a person writes it. @type {Record<System, string>} */
export const SYSTEM_NAME = { windows: 'Windows', linux: 'Linux' };

/** wamrc's --target-abi: the object format the machine code is written in. @type {Record<System, string>} */
export const TARGET_ABI = { windows: 'msvc', linux: 'gnu' };

/** The amxts module's file, as AMX Mod X on that system looks it up for `amxts_amxx` in modules.ini. @type {Record<System, string>} */
export const MODULE_FILE = { windows: 'amxts_amxx.dll', linux: 'amxts_amxx_i386.so' };

/**
 * `windows`, `win32`, `linux`, any case; null for anything else.
 * @param {string | undefined | null} value
 * @returns {System | null} the system, or null
 */
export function parseSystem(value) {
	const text = (value ?? '').trim().toLowerCase();
	if (text === 'windows' || text === 'win32' || text === 'win') return 'windows';
	if (text === 'linux') return 'linux';
	return null;
}

/**
 * What a server's files say it runs. `amxtsDir` is AMXTS_SERVER: the server's
 * addons/amxts, so hlds sits three folders up. Null when nothing there says.
 * @param {string} amxtsDir
 * @returns {{ system: System, reason: string } | null} the system and the file that said so, or null
 */
export function detectServerSystem(amxtsDir) {
	if (!amxtsDir) return null;
	const gameDir = resolve(amxtsDir, '..', '..');
	const hldsDir = resolve(gameDir, '..');
	if (existsSync(join(hldsDir, 'hlds_linux'))) return { system: 'linux', reason: 'hlds_linux' };
	if (existsSync(join(hldsDir, 'hlds.exe'))) return { system: 'windows', reason: 'hlds.exe' };

	// A server reached over a share may have only its game folder there: the
	// modules say which system they were built for.
	for (const dir of [join(gameDir, 'addons', 'amxmodx', 'modules'), join(gameDir, 'addons', 'amxmodx', 'dlls')]) {
		const files = existsSync(dir) ? readdirSync(dir) : [];
		const so = files.find(file => file.endsWith('.so'));
		const dll = files.find(file => file.toLowerCase().endsWith('.dll'));
		if (so && !dll) return { system: 'linux', reason: so };
		if (dll && !so) return { system: 'windows', reason: dll };
	}
	return null;
}

/**
 * @typedef {object} ServerSystem
 * @property {System} system Windows or Linux
 * @property {'flag' | 'env' | 'server' | 'host'} from how it was decided
 * @property {string} [reason] what in the server's folder said so, when that decided it
 */

/**
 * The system a build compiles for; see the top of this file.
 * @param {string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {ServerSystem} the system and how it was decided
 */
export function serverSystem(argv = process.argv, env = process.env) {
	const at = argv.findIndex(arg => arg === '--os' || arg.startsWith('--os='));
	if (at >= 0) {
		const value = argv[at].includes('=') ? argv[at].slice(argv[at].indexOf('=') + 1) : argv[at + 1];
		const system = parseSystem(value);
		if (!system) throw new Error(`--os ${value ?? ''}: windows or linux`);
		return { system, from: 'flag' };
	}
	if (env.AMXTS_SERVER_OS) {
		const system = parseSystem(env.AMXTS_SERVER_OS);
		if (!system) throw new Error(`AMXTS_SERVER_OS=${env.AMXTS_SERVER_OS}: windows or linux`);
		return { system, from: 'env' };
	}
	const found = detectServerSystem(env.AMXTS_SERVER ?? '');
	if (found) return { system: found.system, from: 'server', reason: found.reason };
	return { system: HOST_SYSTEM, from: 'host' };
}

/**
 * The server's system as the build reports it: "Linux (hlds_linux)".
 * @param {ServerSystem} found
 */
export function describeSystem(found) {
	const why = found.from === 'flag' ? '--os' : found.from === 'env' ? 'AMXTS_SERVER_OS' : found.from === 'server' ? found.reason : 'this machine';
	return `${SYSTEM_NAME[found.system]} (${why})`;
}

/**
 * An executable's file name on that system.
 * @param {string} name
 * @param {System} [system]
 */
export function executable(name, system = HOST_SYSTEM) {
	return system === 'windows' ? `${name}.exe` : name;
}

/**
 * wamrc as the core has it for this machine: AMXTS_WAMRC, else the one built
 * in runtime/deps/wamr (a multi-config build puts it in Release/, a Makefile
 * build beside it), else the one `bun run build:linux` made in
 * runtime/build/linux. Either system's wamrc compiles for either system.
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} its path, which may not exist
 */
export function wamrcPath(env = process.env) {
	if (env.AMXTS_WAMRC) return env.AMXTS_WAMRC;
	const name = executable('wamrc');
	const build = join(CORE, 'runtime/deps/wamr/wamr-compiler/build');
	const candidates = [join(build, 'Release', name), join(build, name), ...(HOST_SYSTEM === 'linux' ? [join(CORE, 'runtime/build/linux', name)] : [])];
	return candidates.find(file => existsSync(file)) ?? candidates[0];
}
