// Compression, the way Node's zlib does it:
//
//   import * as zlib from "@amxts/core/zlib";
//
//   const packed = zlib.gzipSync(recording);
//   const back = await zlib.gunzip(packed);
//
// Three formats, each both ways: gzip (a .gz file), deflate (zlib's own
// wrapper, Node's "deflate") and deflateRaw (no wrapper, what a zip holds).
// The work is the module's zlib: a synchronous call does it at once, a
// promise one on the module's worker thread, settling on a later frame.

// Promise, for the promise versions, whether or not the plugin imports the facade.
import "./promise";
import {
	__Job,
	__JobResult,
	__jobRun,
	__jobStart,
	JOB_DEFLATE,
	JOB_DEFLATE_RAW,
	JOB_GUNZIP,
	JOB_GZIP,
	JOB_INFLATE,
	JOB_INFLATE_RAW,
} from "./jobs";

/** Bytes to work on: a `Uint8Array` as it is, an `ArrayBuffer`'s, or text as UTF-8. */
function bytesOf<T>(data: T): Uint8Array {
	if (isString<T>()) return Uint8Array.wrap(String.UTF8.encode(changetype<string>(data)));
	if (idof<T>() == idof<Uint8Array>()) return changetype<Uint8Array>(data);
	if (idof<T>() == idof<ArrayBuffer>()) return Uint8Array.wrap(changetype<ArrayBuffer>(data));
	ERROR("zlib takes text, a Uint8Array or an ArrayBuffer");
	return new Uint8Array(0);
}

function run<T>(op: i32, data: T): Uint8Array {
	const bytes = bytesOf<T>(data);
	const result = __jobRun(op, "", bytes.dataStart, bytes.length, -1);
	const out = result.data;
	if (out == null) throw new Error(result.error);
	return out;
}

class ZlibJob extends __Job {
	constructor(public promise: Promise<Uint8Array>) {
		super();
	}

	finish(result: __JobResult): void {
		const data = result.data;
		if (data) __co_resolve<Uint8Array>(this.promise, data);
		else __co_reject(this.promise, new Error(result.error));
	}
}

function start<T>(op: i32, data: T): Promise<Uint8Array> {
	const bytes = bytesOf<T>(data);
	const promise = __co_promise<Uint8Array>();
	__jobStart(op, "", bytes.dataStart, bytes.length, -1, new ZlibJob(promise));
	return promise;
}

/**
 * Compresses into the gzip format, a `.gz` file's.
 *
 * ```ts
 * fs.writeFileSync("addons/amxmodx/data/run.rec.gz", zlib.gzipSync(recording));
 * ```
 */
export function gzipSync<T extends string | Uint8Array | ArrayBuffer>(data: T): Uint8Array {
	return run<T>(JOB_GZIP, data);
}

/** Inflates gzip data; throws an `Error` when it is not whole gzip data, or comes to more than 64 MB. */
export function gunzipSync<T extends Uint8Array | ArrayBuffer>(data: T): Uint8Array {
	return run<T>(JOB_GUNZIP, data);
}

/** Compresses into the zlib format: deflate data with zlib's header and checksum. */
export function deflateSync<T extends string | Uint8Array | ArrayBuffer>(data: T): Uint8Array {
	return run<T>(JOB_DEFLATE, data);
}

/** Inflates zlib data; throws an `Error` when it is not whole zlib data, or comes to more than 64 MB. */
export function inflateSync<T extends Uint8Array | ArrayBuffer>(data: T): Uint8Array {
	return run<T>(JOB_INFLATE, data);
}

/** Compresses into raw deflate data, with no header around it, as a zip archive holds a file. */
export function deflateRawSync<T extends string | Uint8Array | ArrayBuffer>(data: T): Uint8Array {
	return run<T>(JOB_DEFLATE_RAW, data);
}

/** Inflates raw deflate data; throws an `Error` when it is not whole deflate data, or comes to more than 64 MB. */
export function inflateRawSync<T extends Uint8Array | ArrayBuffer>(data: T): Uint8Array {
	return run<T>(JOB_INFLATE_RAW, data);
}

/**
 * `gzipSync` without holding the server: the work is done on the module's
 * worker thread, and the promise settles on a later frame.
 *
 * ```ts
 * await fs.writeFile("addons/amxmodx/data/run.rec.gz", await zlib.gzip(recording));
 * ```
 */
export function gzip<T extends string | Uint8Array | ArrayBuffer>(data: T): Promise<Uint8Array> {
	return start<T>(JOB_GZIP, data);
}

/** `gunzipSync` on the module's worker thread; rejects with an `Error` when the data is not whole gzip data. */
export function gunzip<T extends Uint8Array | ArrayBuffer>(data: T): Promise<Uint8Array> {
	return start<T>(JOB_GUNZIP, data);
}

/** `deflateSync` on the module's worker thread. */
export function deflate<T extends string | Uint8Array | ArrayBuffer>(data: T): Promise<Uint8Array> {
	return start<T>(JOB_DEFLATE, data);
}

/** `inflateSync` on the module's worker thread; rejects with an `Error` when the data is not whole zlib data. */
export function inflate<T extends Uint8Array | ArrayBuffer>(data: T): Promise<Uint8Array> {
	return start<T>(JOB_INFLATE, data);
}

/** `deflateRawSync` on the module's worker thread. */
export function deflateRaw<T extends string | Uint8Array | ArrayBuffer>(data: T): Promise<Uint8Array> {
	return start<T>(JOB_DEFLATE_RAW, data);
}

/** `inflateRawSync` on the module's worker thread; rejects with an `Error` when the data is not whole deflate data. */
export function inflateRaw<T extends Uint8Array | ArrayBuffer>(data: T): Promise<Uint8Array> {
	return start<T>(JOB_INFLATE_RAW, data);
}
