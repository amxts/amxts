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
import { __textFrom, __textInto, __textRoom } from "./natives";

// @ts-ignore: decorator
@external("env", "fopen")        declare function _fopen(name: string, mode: string, valve: i32, pathId: usize): i32;
// @ts-ignore: decorator
@external("env", "fclose")       declare function _fclose(file: i32): i32;
// @ts-ignore: decorator
@external("env", "fread_blocks") declare function _freadBlocks(file: i32, data: usize, blocks: i32, mode: i32): i32;
// @ts-ignore: decorator
@external("env", "fputs")        declare function _fputs(file: i32, text: string, nullTerm: i32): i32;
// @ts-ignore: decorator
@external("env", "file_exists")  declare function _fileExists(name: string, valve: i32): i32;
// @ts-ignore: decorator
@external("env", "dir_exists")   declare function _dirExists(name: string, valve: i32): i32;
// @ts-ignore: decorator
@external("env", "open_dir")     declare function _openDir(dir: string, first: usize, length: i32, type: usize, valve: i32, pathId: usize): i32;
// @ts-ignore: decorator
@external("env", "next_file")    declare function _nextFile(handle: i32, name: usize, length: i32, type: usize): i32;
// @ts-ignore: decorator
@external("env", "close_dir")    declare function _closeDir(handle: i32): i32;
// @ts-ignore: decorator
@external("env", "mkdir")        declare function _mkdir(name: string, mode: i32, valve: i32, pathId: string): i32;
// @ts-ignore: decorator
@external("env", "delete_file")  declare function _deleteFile(name: string, valve: i32, pathId: string): i32;
// @ts-ignore: decorator
@external("env", "rename_file")  declare function _renameFile(from: string, to: string, relative: i32): i32;
// @ts-ignore: decorator
@external("env", "rmdir")        declare function _rmdir(name: string): i32;
// @ts-ignore: decorator
@external("env", "file_size")    declare function _fileSize(name: string, flag: i32, valve: i32, pathId: string): i32;
// @ts-ignore: decorator
@external("env", "GetFileTime")  declare function _fileTime(name: string, flag: i32): i32;

// fread_blocks' mode for one byte per cell.
const BLOCK_CHAR: i32 = 1;
// What one fread_blocks call reads: the module's thunk copies exactly this
// many cells of an array whose size it cannot know.
const READ_CELLS: i32 = 128;
// What one fputs call writes: AMX Mod X reads 16383 bytes of a string, and a
// UTF-16 unit is three bytes at most.
const WRITE_UNITS: i32 = 4096;
// A name from open_dir / next_file, which the module writes as UTF-8 bytes.
const NAME_BYTES: i32 = 256;
// mkdir's FPERM_DIR_DEFAULT: rwxrwxr-x, where the system has permissions.
const DIR_MODE: i32 = 0o775;
// rename_file's flag for names relative to the game folder, as every other path here is.
const GAME_RELATIVE: i32 = 1;
// GetFileTime's FileTime_LastChange.
const LAST_CHANGE: i32 = 2;

function open(path: string, mode: string): i32 {
	return _fopen(path, mode, 0, 0);
}

function write(path: string, data: string, mode: string): bool {
	const file = open(path, mode);
	if (file == 0) return false;

	for (let at: i32 = 0; at < data.length;) {
		let end = min(at + WRITE_UNITS, data.length);
		// A surrogate pair is one letter: it goes in one piece.
		if (end < data.length && (data.charCodeAt(end - 1) & 0xFC00) == 0xD800) end--;
		_fputs(file, data.substring(at, end), 0);
		at = end;
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
	return _fileExists(path, 0) != 0 || _dirExists(path, 0) != 0;
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
	const name = __textRoom(NAME_BYTES);
	const type = new StaticArray<i32>(1);
	const handle = _openDir(path, <usize>__textInto(name), NAME_BYTES - 1, changetype<usize>(type), 0, 0);
	if (handle == 0) return null;

	const names: string[] = [];
	for (;;) {
		const entry = __textFrom(name);
		if (entry != "." && entry != "..") names.push(entry);
		if (_nextFile(handle, <usize>__textInto(name), NAME_BYTES - 1, changetype<usize>(type)) == 0) break;
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
	return _dirExists(path, 0) != 0;
}

function makeOne(path: string): bool {
	return _mkdir(path, DIR_MODE, 0, "GAMECONFIG") == 0;
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
	return done(writeFileSync(path, data), path, "open");
}

/** `appendFileSync` as a promise, rejected when the file cannot be opened. */
export function appendFile(path: string, data: string): Promise<void> {
	return done(appendFileSync(path, data), path, "open");
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

/**
 * Deletes a file; `false` when there is none or it cannot be deleted.
 *
 * Pawn: `delete_file`, `unlink`
 */
export function unlinkSync(path: string): boolean {
	return _deleteFile(path, 0, "GAMECONFIG") != 0;
}

/**
 * Moves or renames a file: `fs.renameSync("addons/amxmodx/data/top.txt",
 * "addons/amxmodx/data/top.old")`; `false` when it cannot.
 *
 * Pawn: `rename_file`
 */
export function renameSync(from: string, to: string): boolean {
	return _renameFile(from, to, GAME_RELATIVE) != 0;
}

/**
 * Deletes an empty folder; `false` when there is none, it holds something or
 * it cannot be deleted.
 *
 * Pawn: `rmdir`
 */
export function rmdirSync(path: string): boolean {
	return _rmdir(path) != 0;
}

/** A file's or a folder's facts from `statSync`, as Node's `fs.Stats`. */
export class Stats {
	constructor(
		/** The size in bytes; `0` for a folder. */
		readonly size: number,
		/** The moment it last changed. */
		readonly mtime: Date,
		private readonly folder: bool,
	) {}

	/** Whether it is a file. */
	isFile(): boolean {
		return !this.folder;
	}

	/** Whether it is a folder. */
	isDirectory(): boolean {
		return this.folder;
	}
}

/**
 * A file's or a folder's size and the moment it last changed; `null` when
 * there is none: `fs.statSync("addons/amxmodx/logs/error.log")?.size`.
 *
 * Pawn: `file_size`, `GetFileTime`
 */
export function statSync(path: string): Stats | null {
	const folder = _dirExists(path, 0) != 0;
	if (!folder && _fileExists(path, 0) == 0) return null;
	const size = folder ? 0 : _fileSize(path, 0, 0, "*");
	return new Stats(size, new Date(<i64>_fileTime(path, LAST_CHANGE) * 1000), folder);
}

/** `unlinkSync` as a promise, rejected when the file cannot be deleted. */
export function unlink(path: string): Promise<void> {
	return done(unlinkSync(path), path, "unlink");
}

/** `renameSync` as a promise, rejected when the file cannot be moved. */
export function rename(from: string, to: string): Promise<void> {
	return done(renameSync(from, to), from, "rename");
}

/** `rmdirSync` as a promise, rejected when the folder cannot be deleted. */
export function rmdir(path: string): Promise<void> {
	return done(rmdirSync(path), path, "rmdir");
}

/** `statSync` as a promise, rejected when there is no such file or folder. */
export function stat(path: string): Promise<Stats> {
	const stats = statSync(path);
	if (stats == null) return Promise.reject<Stats>(missing(path, "stat"));
	return Promise.resolve<Stats>(stats);
}

function done(ok: bool, path: string, call: string): Promise<void> {
	const promise = __co_promise<void>();
	if (ok) promise.__fulfillVoid();
	else promise.__reject(missing(path, call));
	return promise;
}
