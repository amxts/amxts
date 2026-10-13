// The module's jobs, for zlib and fs: work that would hold the game up -
// compressing, inflating, a file's bytes - done by the module on a worker
// thread of its own (__jobStart), or at once for a synchronous call
// (__jobRun). A started job comes back on a later server frame, where
// __jobDone finishes it. A plugin that starts no job pays nothing: the
// worker starts with the first one.

// @ts-ignore: decorator
@external("env", "job_start") declare function _start(op: i32, path: string, data: usize, length: i32, size: i32, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "job_run")   declare function _run(op: i32, path: string, data: usize, length: i32, size: i32): i32;
// @ts-ignore: decorator
@external("env", "job_size")  declare function _size(id: i32): i32;
// @ts-ignore: decorator
@external("env", "job_read")  declare function _read(id: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "job_crc")   declare function _crc(id: i32): u32;
// @ts-ignore: decorator
@external("env", "job_error") declare function _error(id: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "job_close") declare function _close(id: i32): void;

// What a job does, numbered as the module's JobOp.
export const JOB_COPY: i32 = 0;
export const JOB_DEFLATE: i32 = 1;
export const JOB_INFLATE: i32 = 2;
export const JOB_GZIP: i32 = 3;
export const JOB_GUNZIP: i32 = 4;
export const JOB_DEFLATE_RAW: i32 = 5;
export const JOB_INFLATE_RAW: i32 = 6;
export const JOB_READ: i32 = 7;
export const JOB_WRITE: i32 = 8;
export const JOB_APPEND: i32 = 9;

/** What a job ended with: its bytes - `null` when it failed - their CRC-32, and why it failed. */
export class __JobResult {
	data: Uint8Array | null = null;
	crc: u32 = 0;
	error: string = "";
}

/** A started job's own end: called once, on the frame it comes back. */
export class __Job {
	finish(result: __JobResult): void {}
}

// @ts-ignore: decorator
@lazy const __jobs = new Map<i32, __Job>();

/** Starts a job on the worker; `job` is finished on the frame it ends, or at once when it cannot start. */
export function __jobStart(op: i32, path: string, data: usize, length: i32, size: i32, job: __Job): void {
	const id = _start(op, path, data, length, size, __jobDone.index);
	if (id == 0) {
		const result = new __JobResult();
		result.error = "the job did not start";
		job.finish(result);
		return;
	}
	__jobs.set(id, job);
}

/** Does a job at once, on the game thread. */
export function __jobRun(op: i32, path: string, data: usize, length: i32, size: i32): __JobResult {
	const id = _run(op, path, data, length, size);
	if (id != 0) return outcome(id);
	const result = new __JobResult();
	result.error = "the job could not be made";
	return result;
}

/** The module calls this on the frame a job has ended. */
function __jobDone(id: i32): void {
	if (!__jobs.has(id)) {
		_close(id);
		return;
	}
	const job = __jobs.get(id);
	__jobs.delete(id);
	job.finish(outcome(id));
}

/** Reads an ended job's outcome and lets it go. */
function outcome(id: i32): __JobResult {
	const result = new __JobResult();
	const size = _size(id);
	if (size >= 0) {
		const data = new Uint8Array(size);
		if (size > 0) _read(id, data.dataStart, size);
		result.data = data;
		result.crc = _crc(id);
	}
	else {
		const length = _error(id, 0, 0);
		const text = new ArrayBuffer(length);
		if (length > 0) _error(id, changetype<usize>(text), length);
		result.error = String.UTF8.decode(text);
	}
	_close(id);
	return result;
}
