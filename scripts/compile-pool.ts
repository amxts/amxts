// Several plugins compiled at once. asc is not reentrant and a compile holds
// about a gigabyte at its peak, so each runs in a process of its own
// (scripts/compile-worker.ts), as many at once as the CPUs and the memory
// budget allow: AMXTS_BUILD_MEMORY megabytes for all of them (3072), or
// AMXTS_BUILD_JOBS compiles. A single plugin, or room for one, is compiled in
// this process. Either way a plugin compiles to the same bytes.
import type { Plugin } from './compile';
import type { NativesBeside, PluginNative } from './plugin-natives';
import { spawn } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setNativesBeside } from './plugin-natives';

const MB = 1024 * 1024;

/** A compile's peak, asc's and wamrc's together: measured at about a gigabyte, with room. */
export const COMPILE_MEMORY = 1280 * MB;

/** What the compiles of a build may hold together, unless AMXTS_BUILD_MEMORY says otherwise. */
export const BUILD_MEMORY = 3072 * MB;

const WORKER = join(dirname(fileURLToPath(import.meta.url)), 'compile-worker.ts');

/** How many compiles run at once: AMXTS_BUILD_JOBS, else as many as the memory budget holds, at most one per CPU. */
export function compileSlots(env: Record<string, string | undefined> = process.env, cpus = availableParallelism()): number {
	const jobs = Number(env.AMXTS_BUILD_JOBS);
	if (Number.isInteger(jobs) && jobs > 0) return jobs;
	const budget = Number(env.AMXTS_BUILD_MEMORY) > 0 ? Number(env.AMXTS_BUILD_MEMORY) * MB : BUILD_MEMORY;
	return Math.max(1, Math.min(cpus, Math.floor(budget / COMPILE_MEMORY)));
}

/**
 * `run` on every item, at most `slots` at a time, each given the slot it runs
 * in (0, 1, ...) and its index: the items start in order, and the results come
 * back in it.
 */
export async function inSlots<T, R>(items: T[], slots: number, run: (item: T, slot: number, index: number) => Promise<R>): Promise<R[]> {
	const results: R[] = Array.from({ length: items.length });
	let next = 0;
	const slot = async (number: number) => {
		while (next < items.length) {
			const index = next++;
			results[index] = await run(items[index], number, index);
		}
	};
	await Promise.all(Array.from({ length: Math.min(slots, items.length) }, (_, number) => slot(number)));
	return results;
}

/** One plugin compiled: what went wrong, or null, and its natives. */
export interface Compiled {
	problem: string | null;
	natives: PluginNative[];
}

/** What a worker is sent: the plugin, and the plugin cache it compiles through (scripts/plugin-cache.ts). */
export interface WorkerJob {
	plugin: Plugin;
	/** The project, whose cache it is; null for none. */
	dir: string | null;
	/** The includes the build writes itself. */
	includes: string[];
}

export type WorkerResult = Compiled & { beside: NativesBeside };

/** A worker process: one job at a time, until it is closed. */
function worker() {
	const child = spawn(process.execPath, [WORKER], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
	let waiting: { resolve: (result: WorkerResult) => void; reject: (error: Error) => void } | null = null;
	const answer = () => {
		const now = waiting;
		waiting = null;
		return now;
	};
	child.on('message', (result: WorkerResult) => answer()?.resolve(result));
	child.on('exit', code => answer()?.reject(new Error(`a compile process stopped (exit ${code})`)));
	return {
		compile: (job: WorkerJob) => new Promise<WorkerResult>((resolve, reject) => {
			waiting = { resolve, reject };
			child.send(job);
		}),
		close: () => child.connected && child.disconnect(),
	};
}

export interface CompileAll {
	/** The project and the includes its builds write: the plugin cache's (null: none). */
	dir: string | null;
	includes: string[];
	/** The compile in this process: the build's plugin cache. */
	here: (plugin: Plugin, natives: PluginNative[]) => Promise<string | null>;
	started: (index: number) => void;
	finished: (index: number, compiled: Compiled) => void;
}

/**
 * The plugins compiled, several at once when there is room - in this process
 * when there is room for one. After a failure no other compile starts: those
 * that did not are null.
 */
export async function compileAll(plugins: Plugin[], options: CompileAll): Promise<(Compiled | null)[]> {
	const slots = Math.min(plugins.length, compileSlots());
	const workers = slots > 1 ? Array.from({ length: slots }, worker) : [];
	let failed = false;
	const compile = async (plugin: Plugin, slot: number): Promise<Compiled> => {
		if (workers.length === 0) {
			const natives: PluginNative[] = [];
			return { problem: await options.here(plugin, natives), natives };
		}
		const { beside, ...compiled } = await workers[slot].compile({ plugin, dir: options.dir, includes: options.includes });
		setNativesBeside(compiled.natives, beside);
		return compiled;
	};
	try {
		return await inSlots(plugins, slots, async (plugin, slot, index) => {
			if (failed) return null;
			options.started(index);
			const compiled = await compile(plugin, slot);
			failed ||= compiled.problem !== null;
			options.finished(index, compiled);
			return compiled;
		});
	} finally {
		for (const each of workers) each.close();
	}
}
