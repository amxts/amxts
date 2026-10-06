// The module's coroutine scheduler, for a plugin that awaits on the fake
// server: co_spawn, co_suspend, the shadow-stack park and the jobs run once
// the plugin's stack is empty, as runtime/src/module.cpp runs them (and
// tests/async-host.ts, which checks the protocol on its own).
//
// A plugin with no async function imports none of this and never gets here.
// @ts-ignore - its types are beside it, under a path tsconfig does not map
import binaryen from '../../runtime/deps/assemblyscript/node_modules/binaryen/index.js';

// Must match CO_* in runtime/src/module.cpp and as/promise.ts.
const CO_FINISHED = 0;
const CO_PARKED = 1;
const CO_TRAPPED = 2;
const CO_DROPPED = 3;

type Kind = 'i32' | 'i64' | 'f32' | 'f64';

interface Coroutine {
	id: number;
	fn: number;
	cells: Uint32Array;
	buffer: number;
	base: number;
	drop: boolean;
}

export class Coroutines {
	/** What a trap inside a coroutine said: it drops that one coroutine, as on the server. */
	readonly traps: string[] = [];

	private exports: any = null;
	private kinds = new Map<number, Kind[]>();
	private coroutines = new Map<number, Coroutine>();
	private running: Coroutine[] = [];
	private wake = false;
	private entering = false;
	private top = 0;
	/** How deep the server is inside this plugin: jobs run when it is out. */
	depth = 0;

	constructor(wasm: Uint8Array) {
		this.readTable(wasm);
	}

	/** The imports the scheduler answers. */
	imports(): Record<string, (...args: any[]) => any> {
		return {
			co_entered: () => {
				const entering = this.entering;
				this.entering = false;
				return entering ? 1 : 0;
			},
			co_spawn: (fn: number, args: number, cells: number, id: number, buffer: number) => {
				const coroutine: Coroutine = {
					id,
					fn,
					buffer,
					drop: false,
					cells: new Uint32Array(this.exports.memory.buffer.slice(args, args + cells * 4)),
					base: this.exports.__co_stack(),
				};
				this.coroutines.set(id, coroutine);
				return this.run(coroutine, false);
			},
			co_suspend: (drop: number) => {
				if (this.exports.asyncify_get_state() === 2) {
					this.exports.asyncify_stop_rewind();
					return;
				}
				const coroutine = this.running[this.running.length - 1];
				coroutine.drop = drop !== 0;
				this.exports.asyncify_start_unwind(coroutine.buffer);
			},
			co_wake: () => { this.wake = true; },
		};
	}

	/** Once the instance is there: where the shadow stack starts with nothing running. */
	attach(exports: any): void {
		this.exports = exports;
		this.top = exports.__co_stack ? exports.__co_stack() : 0;
	}

	/** Whether a job is waiting to run. */
	get waiting(): boolean {
		return this.wake;
	}

	/** Runs the plugin's jobs once nothing of it is on the stack - module.cpp's DrainJobs. */
	drain(): void {
		if (!this.wake || !this.exports?.__co_next) return;
		this.wake = false;
		if (this.top) this.exports.__co_stack_set(this.top);
		for (;;) {
			const id = this.exports.__co_next();
			if (id === 0) break;
			const coroutine = this.coroutines.get(id);
			const outcome = coroutine ? this.run(coroutine, true) : CO_FINISHED;
			this.exports.__co_done(outcome);
		}
	}

	/** One call into a coroutine, first or resumed - module.cpp's RunCoroutine. */
	private run(coroutine: Coroutine, rewind: boolean): number {
		const outer = this.exports.__co_stack();
		const memory = this.exports.memory;
		if (rewind) {
			const low = coroutine.base - this.exports.__co_saved(coroutine.id);
			new Uint8Array(memory.buffer, coroutine.base, outer - coroutine.base).fill(0);
			this.exports.__co_stack_set(low);
			this.exports.__co_restore(coroutine.id, low);
			this.exports.asyncify_start_rewind(coroutine.buffer);
		} else {
			this.entering = true;
		}

		this.running.push(coroutine);
		try {
			this.callRaw(coroutine.fn, coroutine.cells);
		} catch (error) {
			this.running.pop();
			this.traps.push((error as Error).message);
			const state = this.exports.asyncify_get_state();
			if (state === 1) this.exports.asyncify_stop_unwind();
			if (state === 2) this.exports.asyncify_stop_rewind();
			this.exports.__co_stack_set(outer);
			this.coroutines.delete(coroutine.id);
			return CO_TRAPPED;
		}
		this.running.pop();

		if (this.exports.asyncify_get_state() !== 1) {
			this.exports.__co_stack_set(outer);
			this.coroutines.delete(coroutine.id);
			return CO_FINISHED;
		}
		this.exports.asyncify_stop_unwind();
		if (coroutine.drop) {
			this.exports.__co_stack_set(outer);
			this.coroutines.delete(coroutine.id);
			return CO_DROPPED;
		}
		this.exports.__co_save(coroutine.id, this.exports.__co_stack(), coroutine.base);
		this.exports.__co_stack_set(outer);
		return CO_PARKED;
	}

	/** call_indirect with the cells co_spawn copied, each read as the parameter it is. */
	private callRaw(fn: number, cells: Uint32Array) {
		const bytes = new DataView(new Uint32Array(Array.from(cells)).buffer);
		const args: (number | bigint)[] = [];
		let at = 0;
		for (const kind of this.kinds.get(fn) ?? []) {
			if (kind === 'i32') args.push(bytes.getInt32(at, true));
			if (kind === 'f32') args.push(bytes.getFloat32(at, true));
			if (kind === 'i64') args.push(bytes.getBigInt64(at, true));
			if (kind === 'f64') args.push(bytes.getFloat64(at, true));
			at += kind === 'i64' || kind === 'f64' ? 8 : 4;
		}
		return this.exports.table.get(fn)(...args);
	}

	/** The parameter types of every function in the table, by index. */
	private readTable(wasm: Uint8Array) {
		const module = binaryen.readBinary(wasm);
		try {
			const kindOf = (type: number): Kind =>
				type === binaryen.i64 ? 'i64' : type === binaryen.f32 ? 'f32' : type === binaryen.f64 ? 'f64' : 'i32';
			for (let i = 0; i < module.getNumElementSegments(); i++) {
				const segment = binaryen.getElementSegmentInfo(module.getElementSegmentByIndex(i));
				const offset = (binaryen.getExpressionInfo(segment.offset as any) as any).value as number;
				segment.data.forEach((name: string, at: number) => {
					const info = binaryen.getFunctionInfo(module.getFunction(name));
					this.kinds.set(offset + at, binaryen.expandType(info.params).map(kindOf));
				});
			}
		} finally {
			module.dispose();
		}
	}
}
