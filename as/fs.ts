// Files, the way Node's fs reads and writes them:
//
//   import * as fs from "~/fs";
//
//   const text = fs.readFileSync("addons/amxmodx/configs/myplugin.ini");
//   fs.writeFileSync("addons/amxmodx/data/last.txt", "de_dust2");
//   const later = await fs.readFile("addons/amxmodx/configs/myplugin.ini");
//
// Underneath are AMX Mod X's own file natives - fopen, fread_blocks, fputs,
// open_dir - so a path means what it means to a Pawn plugin: relative to the
// game folder (cstrike/), `addons/amxmodx/configs/...` for configs.
//
// Text is UTF-8 both ways. A file is read whole, whatever its size: 128 bytes
// a native call (the thunk's buffer for an array it does not know the size
// of), never through a 255-character line buffer.
//
// There are no exceptions in AssemblyScript, so the synchronous functions say
// they failed by their result - null, false - and the promise ones reject
// with an Error, as Node's do.
//
// Written with explicit integer types: outside the facade a bare literal is
// a JavaScript number, and every count here is a cell.

// Promise, for the promise versions, whether or not the plugin imports the facade.
import "./promise";

// @ts-ignore: decorator
@external("env", "fopen")        declare function _fopen(name: usize, mode: usize, valve: i32, pathId: usize): i32;
// @ts-ignore: decorator
@external("env", "fclose")       declare function _fclose(file: i32): i32;
// @ts-ignore: decorator
@external("env", "fread_blocks") declare function _freadBlocks(file: i32, data: usize, blocks: i32, mode: i32): i32;
// @ts-ignore: decorator
@external("env", "fputs")        declare function _fputs(file: i32, text: usize, nullTerm: i32): i32;
// @ts-ignore: decorator
@external("env", "file_exists")  declare function _fileExists(name: usize, valve: i32): i32;
// @ts-ignore: decorator
@external("env", "dir_exists")   declare function _dirExists(name: usize, valve: i32): i32;
// @ts-ignore: decorator
@external("env", "open_dir")     declare function _openDir(dir: usize, first: usize, length: i32, type: usize, valve: i32, pathId: usize): i32;
// @ts-ignore: decorator
@external("env", "next_file")    declare function _nextFile(handle: i32, name: usize, length: i32, type: usize): i32;
// @ts-ignore: decorator
@external("env", "close_dir")    declare function _closeDir(handle: i32): i32;
// @ts-ignore: decorator
@external("env", "mkdir")        declare function _mkdir(name: usize, mode: i32, valve: i32, pathId: usize): i32;

// fread_blocks' mode for one byte per cell.
const BLOCK_CHAR: i32 = 1;
// What one fread_blocks call reads: the module's thunk copies exactly this
// many cells of an array whose size it cannot know.
const READ_CELLS: i32 = 128;
// What one fputs call writes: the thunk copies a string up to 511 cells.
const WRITE_BYTES: i32 = 500;
// A name from open_dir / next_file.
const NAME_CELLS: i32 = 256;
// mkdir's FPERM_DIR_DEFAULT: rwxrwxr-x, where the system has permissions.
const DIR_MODE: i32 = 0o775;

/** Text as a Pawn string: its UTF-8 bytes, a byte a cell, and a zero cell. */
function cells(text: string): StaticArray<i32> {
	const bytes = Uint8Array.wrap(String.UTF8.encode(text));
	const out = new StaticArray<i32>(bytes.length + 1);
	for (let i: i32 = 0; i < bytes.length; i++) unchecked(out[i] = <i32>unchecked(bytes[i]));
	return out;
}

/** A Pawn string of UTF-8 bytes back as text. */
function textOf(from: StaticArray<i32>): string {
	const bytes = new Array<u8>();
	for (let i: i32 = 0; i < from.length; i++) {
		const c = unchecked(from[i]);
		if (c == 0) break;
		bytes.push(<u8>c);
	}
	return String.UTF8.decodeUnsafe(bytes.dataStart, <usize>bytes.length);
}

function open(path: string, mode: string): i32 {
	return _fopen(changetype<usize>(cells(path)), changetype<usize>(cells(mode)), 0, 0);
}

function write(path: string, data: string, mode: string): bool {
	const file = open(path, mode);
	if (file == 0) return false;

	const bytes = Uint8Array.wrap(String.UTF8.encode(data));
	const chunk = new StaticArray<i32>(WRITE_BYTES + 1);

	for (let at: i32 = 0; at < bytes.length; at += WRITE_BYTES) {
		const count = min(WRITE_BYTES, bytes.length - at);
		for (let i: i32 = 0; i < count; i++) unchecked(chunk[i] = <i32>unchecked(bytes[at + i]));
		unchecked(chunk[count] = 0);
		_fputs(file, changetype<usize>(chunk), 0);
	}

	_fclose(file);
	return true;
}

function missing(path: string, call: string): Error {
	return new Error(`ENOENT: no such file or directory, ${call} '${path}'`);
}

/**
 * Reads a whole file as text; `null` when it cannot be opened.
 *
 * ```ts
 * const text = fs.readFileSync("addons/amxmodx/configs/myplugin.ini");
 * if (text == null) return;
 * ```
 *
 * The path is relative to the game folder (`cstrike/`), as for any AMX Mod X
 * plugin. The file is UTF-8; it is read whole, whatever its size.
 *
 * Pawn: `fopen`, `fread_blocks`
 */
export function readFileSync(path: string): string | null {
	const file = open(path, "rb");
	if (file == 0) return null;

	const bytes = new Array<u8>();
	const chunk = new StaticArray<i32>(READ_CELLS);

	for (;;) {
		const read = _freadBlocks(file, changetype<usize>(chunk), READ_CELLS, BLOCK_CHAR);
		for (let i: i32 = 0; i < read; i++) bytes.push(<u8>(unchecked(chunk[i]) & 0xFF));
		if (read < READ_CELLS) break;
	}

	_fclose(file);
	return String.UTF8.decodeUnsafe(bytes.dataStart, <usize>bytes.length);
}

/**
 * Writes text to a file, replacing what was there; `false` when it cannot be
 * opened (a folder that does not exist, for one).
 *
 * ```ts
 * fs.writeFileSync("addons/amxmodx/data/last-map.txt", server.map);
 * ```
 *
 * Pawn: `fopen`, `fputs`
 */
export function writeFileSync(path: string, data: string): boolean {
	return write(path, data, "wb");
}

/**
 * Adds text to the end of a file, making it if there is none; `false` when it cannot be opened.
 *
 * Pawn: `fopen(path, "a")`, `fputs`
 */
export function appendFileSync(path: string, data: string): boolean {
	return write(path, data, "ab");
}

/**
 * `true` when the file or folder exists.
 *
 * Pawn: `file_exists`, `dir_exists`
 */
export function existsSync(path: string): boolean {
	const name = changetype<usize>(cells(path));
	return _fileExists(name, 0) != 0 || _dirExists(name, 0) != 0;
}

/**
 * Lists the names in a folder, without `.` and `..`; `null` when there is no
 * such folder.
 *
 * ```ts
 * const maps = fs.readdirSync("maps");
 * ```
 *
 * Pawn: `open_dir`, `next_file`
 */
export function readdirSync(path: string): string[] | null {
	const name = new StaticArray<i32>(NAME_CELLS);
	const type = new StaticArray<i32>(1);
	const handle = _openDir(changetype<usize>(cells(path)), changetype<usize>(name), NAME_CELLS - 1, changetype<usize>(type), 0, 0);
	if (handle == 0) return null;

	const names: string[] = [];
	for (;;) {
		const entry = textOf(name);
		if (entry != "." && entry != "..") names.push(entry);
		if (_nextFile(handle, changetype<usize>(name), NAME_CELLS - 1, changetype<usize>(type)) == 0) break;
	}

	_closeDir(handle);
	return names;
}

/** The options of `mkdirSync`: `{ recursive: true }` makes the missing folders above too. */
export class MakeDirectoryOptions {
	/** `true` to make every missing folder on the way too; `false` by default. */
	recursive: boolean = false;
}

/**
 * Makes a folder; `false` when it cannot be made, or - without `recursive` -
 * when it is there already or its parent is not.
 *
 * ```ts
 * fs.mkdirSync("addons/amxmodx/data/stats", { recursive: true });
 * ```
 *
 * With `{ recursive: true }` every missing folder on the way is made, and a
 * folder that is already there is fine, as in Node.
 *
 * Pawn: `mkdir`
 */
export function mkdirSync(path: string, options: MakeDirectoryOptions = new MakeDirectoryOptions()): boolean {
	if (!options.recursive) return makeOne(path);

	const parts = path.replaceAll("\\", "/").split("/");
	let at = "";
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		at = at.length > 0 ? `${at}/${part}` : part;
		// "a//b" and a Windows drive ("C:") are not folders to make.
		if (part.length == 0 || (i == 0 && part.endsWith(":"))) continue;
		if (isFolder(at)) continue;
		if (!makeOne(at)) return false;
	}
	return true;
}

function isFolder(path: string): bool {
	return _dirExists(changetype<usize>(cells(path)), 0) != 0;
}

function makeOne(path: string): bool {
	return _mkdir(changetype<usize>(cells(path)), DIR_MODE, 0, changetype<usize>(cells("GAMECONFIG"))) == 0;
}

/** `mkdirSync` as a promise, rejected when the folder cannot be made. */
export function mkdir(path: string, options: MakeDirectoryOptions = new MakeDirectoryOptions()): Promise<void> {
	const promise = __co_promise<void>();
	if (mkdirSync(path, options)) promise.__fulfillVoid();
	else promise.__reject(new Error(`EEXIST or ENOENT: cannot make the folder, mkdir '${path}'`));
	return promise;
}

/**
 * `readFileSync` as a promise: it rejects with an `ENOENT` error when the file
 * cannot be opened, like Node's `fs.promises.readFile`.
 *
 * ```ts
 * const text = await fs.readFile("addons/amxmodx/configs/myplugin.ini");
 * ```
 */
export function readFile(path: string): Promise<string> {
	const text = readFileSync(path);
	if (text == null) return Promise.reject<string>(missing(path, "open"));
	return Promise.resolve<string>(text);
}

/** `writeFileSync` as a promise, rejected when the file cannot be opened. */
export function writeFile(path: string, data: string): Promise<void> {
	return settled(writeFileSync(path, data), path);
}

/** `appendFileSync` as a promise, rejected when the file cannot be opened. */
export function appendFile(path: string, data: string): Promise<void> {
	return settled(appendFileSync(path, data), path);
}

/** `existsSync` as a promise. */
export function exists(path: string): Promise<boolean> {
	return Promise.resolve<boolean>(existsSync(path));
}

/** `readdirSync` as a promise, rejected when there is no such folder. */
export function readdir(path: string): Promise<string[]> {
	const names = readdirSync(path);
	if (names == null) return Promise.reject<string[]>(missing(path, "scandir"));
	return Promise.resolve<string[]>(names);
}

function settled(ok: bool, path: string): Promise<void> {
	const promise = __co_promise<void>();
	if (ok) promise.__fulfillVoid();
	else promise.__reject(missing(path, "open"));
	return promise;
}
