// The module's jobs (runtime/src/jobs.h) on the fake server: zlib and a
// file's bytes, done with node:zlib and the server's files. A job started
// with job_start is done at once and handed back on the next frame - in
// responses(), as a fetch's response is - and job_run's at once.
import type { FakeServer, PluginInstance } from './server';
import { crc32, deflateRawSync, deflateSync, gunzipSync, gzipSync, inflateRawSync, inflateSync } from 'node:zlib';
import { gamePath } from './server';

// The module's JobOp, in its order.
const COPY = 0;
const INFLATE_RAW = 6;
const READ = 7;
const WRITE = 8;
const APPEND = 9;
const WORK: ((data: Uint8Array) => Uint8Array)[] = [
	data => data,
	data => deflateSync(data),
	data => inflateSync(data),
	data => gzipSync(data),
	data => gunzipSync(data),
	data => deflateRawSync(data),
	data => inflateRawSync(data),
];
// What an inflate of an unknown size may give, as the module's JOB_MAX_OUTPUT.
const MAX_OUTPUT = 64 * 1024 * 1024;
// The module's NetFrame and JobsFrame call back with this shape.
const SHAPE_NARROW = 0;

interface Job {
	plugin: PluginInstance;
	fn: number;
	output: Uint8Array | null;
	crc: number;
	error: string;
}

export class FakeJobs {
	private readonly jobs = new Map<number, Job>();
	private readonly ended: number[] = [];
	private nextId = 1;

	constructor(private readonly server: FakeServer) {}

	/** Whether a started job waits for its frame. */
	get busy(): boolean {
		return this.ended.length > 0;
	}

	start(plugin: PluginInstance, op: number, path: string, data: Uint8Array, size: number, fn: number): number {
		const id = this.run(plugin, op, path, data, size);
		this.jobs.get(id)!.fn = fn;
		this.ended.push(id);
		return id;
	}

	run(plugin: PluginInstance, op: number, path: string, data: Uint8Array, size: number): number {
		const job: Job = { plugin, fn: 0, output: null, crc: 0, error: '' };
		try {
			job.output = this.work(op, path, data);
			if (size >= 0 && job.output !== null && job.output.length !== size) job.output = null;
			if (size < 0 && job.output !== null && job.output.length > MAX_OUTPUT) throw new Error('the inflated data is larger than 64 MB');
		} catch (error) {
			job.output = null;
			job.error = (error as Error).message;
		}
		if (job.output !== null && (op === COPY || op === INFLATE_RAW)) job.crc = crc32(job.output);
		const id = this.nextId++;
		this.jobs.set(id, job);
		return id;
	}

	private work(op: number, path: string, data: Uint8Array): Uint8Array | null {
		if (op < READ) return new Uint8Array(WORK[op]!(data));

		const file = gamePath(path);
		if (file === null) return null;
		if (op === READ) return this.server.files.get(file)?.slice() ?? null;
		if (op !== WRITE && op !== APPEND) return null;
		if (!this.server.folderExists(file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '')) return null;
		const before = op === APPEND ? this.server.files.get(file) ?? new Uint8Array(0) : new Uint8Array(0);
		const written = new Uint8Array(before.length + data.length);
		written.set(before);
		written.set(data, before.length);
		this.server.files.set(file, written);
		return new Uint8Array(0);
	}

	private of(plugin: PluginInstance, id: number): Job | undefined {
		const job = this.jobs.get(id);
		return job?.plugin === plugin && !this.ended.includes(id) ? job : undefined;
	}

	size(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id)?.output?.length ?? -1;
	}

	read(plugin: PluginInstance, id: number, out: number, max: number): number {
		const output = this.of(plugin, id)?.output;
		if (!output) return 0;
		if (out && max > 0) plugin.memory.setRaw(out, output.subarray(0, max));
		return output.length;
	}

	crc(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id)?.crc ?? 0;
	}

	error(plugin: PluginInstance, id: number, out: number, max: number): number {
		const job = this.of(plugin, id);
		if (!job) return 0;
		const text = new TextEncoder().encode(job.error);
		if (out && max > 0) plugin.memory.setRaw(out, text.subarray(0, max));
		return text.length;
	}

	close(plugin: PluginInstance, id: number): void {
		if (this.jobs.get(id)?.plugin === plugin) this.jobs.delete(id);
	}

	/** One frame: every started job goes to its callback, unless its plugin let it go or is gone. */
	frame(): void {
		for (const id of this.ended.splice(0)) {
			const job = this.jobs.get(id);
			if (!job || job.plugin.unloaded) {
				this.jobs.delete(id);
				continue;
			}
			this.server.call({ plugin: job.plugin, fn: job.fn, shape: SHAPE_NARROW }, [id], 0);
		}
	}
}
