// The module's coroutine scheduler, in JavaScript, for running a plugin that
// awaits under bun instead of on a server.
//
// It follows runtime/src/module.cpp step by step - co_spawn, co_suspend, the
// shadow-stack park and the jobs run once the plugin's stack is empty - so a
// test of the hood (as/promise.ts) through it is a test of the same protocol
// the server runs. Every other import is a stub that answers 0, except the
// console and set_task, which this keeps and plays back on a clock of its own.
import binaryen from 'binaryen';

// Must match CO_* in runtime/src/module.cpp and as/promise.ts.
const CO_FINISHED = 0;
const CO_PARKED = 1;
const CO_TRAPPED = 2;
const CO_DROPPED = 3;

declare const WebAssembly: any;

interface Coroutine {
	id: number;
	fn: number;
	cells: Uint32Array;
	buffer: number;
	base: number;
	drop: boolean;
}

interface Task {
	at: number;
	fn: number;
	id: number;
	order: number;
}

type Kind = 'i32' | 'i64' | 'f32' | 'f64';

export class AsyncHost {
	/** Everything the plugin printed, in order. */
	log: string[] = [];
	/** Virtual milliseconds since the start. */
	now = 0;
	/** Handlers the plugin registered with `on`, by forward. */
	events = new Map<string, number[]>();
	/** Hookchain handlers the plugin registered with `hook`. */
	hooks: { id: number; fn: number; post: boolean }[] = [];

	private exports: any;
	private table: any;
	private memory: any;
	private kinds = new Map<number, Kind[]>();
	private coroutines = new Map<number, Coroutine>();
	private running: Coroutine[] = [];
	private tasks: Task[] = [];
	private depth = 0;
	private wake = false;
	private entering = false;
	private nextId = 0x60000000;
	private order = 0;
	private top = 0;

	constructor(wasm: Uint8Array) {
		this.readTable(wasm);
		const module = new WebAssembly.Module(wasm);
		const env: Record<string, (...args: any[]) => any> = {};
		for (const imported of WebAssembly.Module.imports(module)) {
			if (imported.kind === 'function') env[imported.name] = () => 0;
		}
		// A server with every library, reapi among them: the hookchains are hooked.
		env.LibraryExists = () => 1;

		const text = (pointer: number) => {
			if (!pointer) return '';
			if (!this.memory) return `<during start: ${pointer}>`;
			const length = new Uint32Array(this.memory.buffer, pointer - 4, 1)[0];
			return String.fromCharCode(...new Uint16Array(this.memory.buffer, pointer, length >> 1));
		};
		env['console.log'] = (s: number) => {
			this.log.push(text(s));
		};
		env['console.error'] = (s: number) => {
			this.log.push(`error: ${text(s)}`);
		};
		env.abort = (message: number, file: number, line: number, column: number) => {
			throw new Error(`abort: ${text(message)} at ${text(file)}:${line}:${column}`);
		};
		env.on = (name: number, fn: number) => {
			const forward = text(name);
			this.events.set(forward, [...(this.events.get(forward) ?? []), fn]);
		};
		env.task = (secondsBits: number, fn: number, id: number) => {
			const seconds = new Float32Array(new Int32Array([secondsBits]).buffer)[0];
			// The delay crossed as an f32: 0.1 s is 100.0000015 ms, rounded back here.
			this.tasks.push({ at: this.now + Math.round(seconds * 1000), fn, id, order: this.order++ });
			return 0;
		};
		env.stop_task = (id: number) => {
			const before = this.tasks.length;
			this.tasks = this.tasks.filter(task => task.id !== id);
			return before - this.tasks.length;
		};

		// A hookchain: its handlers by hook id, and what they told the game -
		// handled() is outcome(1); SetHookChainReturn goes through `call`.
		env.hook = (id: number, fn: number, post: number) => {
			this.hooks.push({ id, fn, post: post !== 0 });
			return this.hooks.length;
		};
		env.outcome = (value: number) => {
			this.log.push(`outcome ${value}`);
		};
		env.call = (native: number, args: number, mask: number, argc: number) => {
			this.log.push(`native ${native} with ${argc} argument(s)`);
			return 0;
		};

		env.co_entered = () => {
			const entering = this.entering;
			this.entering = false;
			return entering ? 1 : 0;
		};
		env.co_spawn = (fn: number, args: number, cells: number, id: number, buffer: number) => {
			const coroutine: Coroutine = {
				id,
				fn,
				buffer,
				drop: false,
				cells: new Uint32Array(this.memory.buffer.slice(args, args + cells * 4)),
				base: this.exports.__co_stack(),
			};
			this.coroutines.set(id, coroutine);
			return this.run(coroutine, false);
		};
		env.co_suspend = (drop: number) => {
			if (this.exports.asyncify_get_state() === 2) {
				this.exports.asyncify_stop_rewind();
				return;
			}
			const coroutine = this.running[this.running.length - 1];
			coroutine.drop = drop !== 0;
			this.exports.asyncify_start_unwind(coroutine.buffer);
		};
		env.co_wake = () => {
			this.wake = true;
		};
		env.co_id = () => this.nextId++;

		const instance = new WebAssembly.Instance(module, { env });
		this.exports = instance.exports;
		this.table = instance.exports.table;
		this.memory = instance.exports.memory;
		// Where the shadow stack starts, with nothing running - module.cpp's stackTop.
		this.top = this.exports.__co_stack ? this.exports.__co_stack() : 0;
		// The start function ran inside the constructor: what it queued runs now.
		this.drain();
	}

	/** Calls an export the way the module fires an event: jobs run when it returns. */
	call(name: string, ...args: number[]) {
		return this.enter(() => this.exports[name](...args));
	}

	/** Fires a forward registered with `on`, as the host plugin relays one. */
	fire(forward: string, ...args: number[]) {
		for (const fn of this.events.get(forward) ?? []) {
			this.enter(() => this.callIndirect(fn, [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0, args[3] ?? 0]));
		}
	}

	/** Runs the pre handlers of every hookchain the plugin hooked, as reapi calls them. */
	fireHooks() {
		for (const hook of this.hooks.filter(h => !h.post)) this.enter(() => this.callIndirect(hook.fn, [0, 0, 0, 0]));
	}

	/** Moves the clock on, firing every task that comes due on the way. */
	advance(ms: number) {
		const until = this.now + ms;
		for (;;) {
			const due = this.tasks
				.filter(task => task.at <= until)
				.sort((a, b) => a.at - b.at || a.order - b.order)[0];
			if (!due) break;
			this.tasks.splice(this.tasks.indexOf(due), 1);
			this.now = Math.max(this.now, due.at);
			this.enter(() => this.callIndirect(due.fn, [due.id]));
		}
		this.now = until;
	}

	/** How many coroutines are parked right now. */
	get parked() {
		return this.coroutines.size;
	}

	private enter(body: () => any) {
		this.depth++;
		let result: any;
		try {
			result = body();
		} finally {
			this.depth--;
		}
		if (this.depth === 0) this.drain();
		return result;
	}

	/** Runs the plugin's jobs once nothing of it is on the stack - module.cpp's DrainJobs. */
	private drain() {
		if (!this.wake) return;
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
		if (rewind) {
			const low = coroutine.base - this.exports.__co_saved(coroutine.id);
			new Uint8Array(this.memory.buffer, coroutine.base, outer - coroutine.base).fill(0);
			this.exports.__co_stack_set(low);
			this.exports.__co_restore(coroutine.id, low);
			this.exports.asyncify_start_rewind(coroutine.buffer);
		} else {
			this.entering = true;
		}

		this.running.push(coroutine);
		try {
			this.callIndirect(coroutine.fn, coroutine.cells, true);
		} catch (error) {
			this.running.pop();
			this.log.push(`trap: ${(error as Error).message}`);
			const state = this.exports.asyncify_get_state();
			if (state === 1) this.exports.asyncify_stop_unwind();
			if (state === 2) this.exports.asyncify_stop_rewind();
			this.exports.__co_stack_set(outer);
			this.coroutines.delete(coroutine.id);
			return CO_TRAPPED;
		}
		this.running.pop();

		if (this.exports.asyncify_get_state() !== 1) {
			// A resumed body returns to its own base, not to where the resume
			// began: it may have been started deeper down than the top level.
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

	/** call_indirect from raw cells, each one read as the parameter it is. */
	private callIndirect(fn: number, cells: ArrayLike<number>, raw = false) {
		const kinds = this.kinds.get(fn) ?? [];
		const bytes = new DataView(new Uint32Array(Array.from(cells)).buffer);
		const args: (number | bigint)[] = [];
		let at = 0;
		for (const kind of kinds) {
			if (!raw) {
				// An event's cells are values, converted by the parameter's type as Fire does.
				const value = at / 4 < cells.length ? cells[at / 4] | 0 : 0;
				args.push(kind === 'i64' ? BigInt(value) : value);
				at += 4;
				continue;
			}
			if (kind === 'i32') args.push(bytes.getInt32(at, true));
			if (kind === 'f32') args.push(bytes.getFloat32(at, true));
			if (kind === 'i64') args.push(bytes.getBigInt64(at, true));
			if (kind === 'f64') args.push(bytes.getFloat64(at, true));
			at += kind === 'i64' || kind === 'f64' ? 8 : 4;
		}
		return this.table.get(fn)(...args);
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
				segment.data.forEach((name, at) => {
					const info = binaryen.getFunctionInfo(module.getFunction(name));
					this.kinds.set(offset + at, binaryen.expandType(info.params).map(kindOf));
				});
			}
		} finally {
			module.dispose();
		}
	}
}
