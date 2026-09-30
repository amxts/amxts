// Promise, async/await and AbortSignal: the hood under them.
//
// The compiler reads the classes through `@global`, so `Promise`,
// `AbortController`, `AbortSignal` and `Event` are the globals they are in
// JavaScript; the facade imports the file for it, and nothing else needs to.
// The editor reads them through as/promise.types.d.ts, which makes what this
// file exports global - an `async function` is typed with this very Promise.
//
// How an async function runs (the compiler half is Compiler.compileAsyncPrologue
// in runtime/deps/assemblyscript/src/compiler.ts, the host half is the
// coroutine code in runtime/src/module.cpp):
//
// - A call to it makes its Promise and asks the host (co_spawn) to call it
//   again through the table: that second call is the body, a coroutine of its
//   own. The body runs at once, up to its first `await`.
// - `await p` (__await) parks the coroutine: the host unwinds it with
//   Asyncify back to co_spawn, keeps its shadow stack here (__co_park), and
//   the caller goes on with a pending Promise - a call without `await` does
//   not wait, as in JavaScript.
// - When p settles, its reactions become jobs (microtasks). The host runs
//   them (__co_next) once the plugin has nothing of its own on the stack, and
//   a coroutine waiting on p is rewound from there.
//
// There are no exceptions in AssemblyScript: a rejection - or a `throw` in an
// async function, which the compiler makes one (__co_throw) - travels to whoever
// awaits it, which gives up its own coroutine with the same reason, and ends
// in `.catch` or as one "Unhandled promise rejection" line.

// ---------------------------------------------------------------- host

// @ts-ignore: decorator
@external("env", "co_entered") declare function __co_host_entered(): i32;
// @ts-ignore: decorator
@external("env", "co_spawn") declare function __co_host_spawn(fn: i32, args: usize, cells: i32, id: i32, buffer: usize): i32;
// @ts-ignore: decorator
@external("env", "co_suspend") declare function __co_host_suspend(drop: i32): void;
// @ts-ignore: decorator
@external("env", "co_wake") declare function __co_host_wake(): void;
// @ts-ignore: decorator
@external("env", "co_id") declare function __co_host_id(): i32;
// @ts-ignore: decorator
@external("env", "task") declare function __co_host_task(secondsBits: i32, fn: i32, id: i32, repeat: i32): i32;
// @ts-ignore: decorator
@external("env", "stop_task") declare function __co_host_stop_task(id: i32): i32;
// @ts-ignore: decorator
@external("env", "on") declare function __co_host_on(event: string, fn: i32, shape: i32): void;

// What co_spawn and a resume end with. Must match CO_* in runtime/src/module.cpp.
const __CO_FINISHED: i32 = 0;
const __CO_PARKED: i32 = 1;
const __CO_TRAPPED: i32 = 2;
const __CO_DROPPED: i32 = 3;

/**
 * Bytes Asyncify may use to keep one parked coroutine: the locals of the
 * async function and of __await. A deep async function needs a few hundred;
 * running out is reported by the host rather than trapping silently.
 */
const __CO_BUFFER: i32 = 4096;

// ---------------------------------------------------------------- jobs

/** A microtask: a reaction to a settled promise, or a coroutine to resume. */
class __Job {
	/** The coroutine to resume, when this is one; the host resumes it. */
	coroutine: i32 = 0;
	/** Which wait of that coroutine this resumes - a stale one is skipped. */
	wait: i32 = 0;

	run(): void {}
}

// @ts-ignore: decorator
@lazy const __jobs: (__Job | null)[] = [];
// @ts-ignore: decorator
@lazy let __jobHead: i32 = 0;
// @ts-ignore: decorator
@lazy let __woken = false;
// @ts-ignore: decorator
@lazy const __unhandled: PromiseBase[] = [];

function __co_queue(job: __Job): void {
	__jobs.push(job);
	__co_wake_up();
}

/** Tells the host there is work for when the plugin's stack is empty. */
function __co_wake_up(): void {
	if (__woken) return;
	__woken = true;
	__co_host_wake();
}

// ---------------------------------------------------------------- promises

const __PENDING: i32 = 0;
const __FULFILLED: i32 = 1;
const __REJECTED: i32 = 2;

// Its state, and its value as raw storage - a reference, or the bits of a
// number - so the host and the compiler can settle one without knowing T.
/** The base of every Promise, whatever its value's type; a plugin uses Promise<T>. */
// @ts-ignore: decorator
@global export class PromiseBase {
	/** @hidden */ __state: i32 = 0;
	/** @hidden settled with a value, not with nothing - an async listener's answer. */
	__hasValue: bool = false;
	/** @hidden */ __ref: Object | null = null;
	/** @hidden */ __bits: u64 = 0;
	/** @hidden */ __reason: Error | null = null;
	/** @hidden something reacts to a rejection: then, catch, await. */
	__handled: bool = false;
	/** @hidden */ __reactions: __Job[] | null = null;

	/** @hidden Settles with a reference - like the promise it is given, as in JavaScript, when it is one. */
	__resolveRef(ref: Object | null): void {
		if (ref instanceof PromiseBase) {
			(ref as PromiseBase).__react(new __AdoptJob(ref as PromiseBase, this));
			return;
		}
		this.__fulfillRaw(ref, 0, true);
	}

	/** @hidden */
	__fulfillRaw(ref: Object | null, bits: u64, hasValue: bool): void {
		if (this.__state != __PENDING) return;
		this.__state = __FULFILLED;
		this.__ref = ref;
		this.__bits = bits;
		this.__hasValue = hasValue;
		this.__flush();
	}

	/** @hidden settled with nothing: `return;`, resolve(). */
	__fulfillVoid(): void {
		this.__fulfillRaw(null, 0, false);
	}

	/** @hidden */
	__reject(reason: Error): void {
		if (this.__state != __PENDING) return;
		this.__state = __REJECTED;
		this.__reason = reason;
		// Nobody to hear it yet: reported when the jobs run out, unless a
		// handler is attached before then.
		if (!this.__handled) {
			__unhandled.push(this);
			__co_wake_up();
		}
		this.__flush();
	}

	/** @hidden the same state as `other`, which has settled. */
	__settleLike(other: PromiseBase): void {
		if (other.__state == __REJECTED) {
			this.__reject(other.__reason as Error);
			return;
		}

		// A race of an integer and a number is a number: the integer's bits,
		// read as one.
		const bits = this.__isFloat() && !other.__isFloat() ? reinterpret<u64>(<f64><i64>other.__bits) : other.__bits;
		this.__fulfillRaw(other.__ref, bits, other.__hasValue);
	}

	/** @hidden whether its value is stored as a float's bits. */
	__isFloat(): bool {
		return false;
	}

	/** @hidden runs `job` once this settles - now, as a microtask, if it has. */
	__react(job: __Job): void {
		this.__handled = true;
		if (this.__state != __PENDING) {
			__co_queue(job);
			return;
		}
		let reactions = this.__reactions;
		if (!reactions) this.__reactions = reactions = [];
		reactions.push(job);
	}

	private __flush(): void {
		const reactions = this.__reactions;
		if (!reactions) return;
		this.__reactions = null;
		for (let i = 0; i < reactions.length; i++) __co_queue(reactions[i]);
	}
}

// Only the editor reads it (TypeScript asks for the global); the compiler
// awaits a Promise and nothing else.
/** Anything with a `then`: the type `await` takes in the editor. In a plugin, `await` a Promise. */
export interface PromiseLike<T> {
	/** Calls `onFulfilled` with the value once there is one. */
	then(onFulfilled: (value: T) => void): void;
}

/** A value that is not there yet: the result of a request, a timer, an async function. */
// @ts-ignore: decorator
@global export class Promise<T> extends PromiseBase {
	/**
	 * Wraps a callback API: `executor` runs at once and is handed the two
	 * functions that settle this promise, which the callbacks it sets up may
	 * call later.
	 *
	 * ```ts
	 * const later = new Promise<string>((resolve) => {
	 *   setTimeout(() => resolve("done"), 1000);
	 * });
	 * ```
	 */
	constructor(executor: (resolve: (value?: T) => void, reject: (reason: Error) => void) => void) {
		super();
		executor(__co_resolver<T>(this), __co_rejecter(this));
	}

	/**
	 * Calls `onFulfilled` with the value once there is one; the promise it
	 * returns settles with what that returns. A rejection passes through to
	 * it untouched, or to `onRejected` when there is one.
	 */
	then<U = void>(onFulfilled: (value: T) => U, onRejected: ((reason: Error) => U) | null = null): Promise<U> {
		const next = __co_promise<U>();
		this.__react(new __ThenJob<T, U>(this, next, onFulfilled, onRejected));
		return next;
	}

	/**
	 * Calls `onRejected` with the reason if this is rejected. What it returns
	 * is the value instead: `readFile(path).catch(() => "")` - or nothing, when
	 * it only logs.
	 */
	catch<R = void>(onRejected: (reason: Error) => R): Promise<T> {
		const next = __co_promise<T>();
		this.__react(new __CatchJob<T, R>(this, next, onRejected));
		return next;
	}

	/** Calls `onFinally` once this settles, either way, and passes the outcome on. */
	finally(onFinally: () => void): Promise<T> {
		const next = __co_promise<T>();
		this.__react(new __FinallyJob<T>(this, next, onFinally));
		return next;
	}

	/** A promise already fulfilled with `value`. */
	static resolve<T>(value: T): Promise<T> {
		const promise = __co_promise<T>();
		promise.__resolveWith(value);
		return promise;
	}

	/** A promise already rejected with `reason`. */
	static reject<T = void>(reason: Error): Promise<T> {
		const promise = __co_promise<T>();
		promise.__reject(reason);
		return promise;
	}

	/** @hidden */
	__isFloat(): bool {
		return isFloat<T>();
	}

	/** @hidden the value, once fulfilled. */
	__value(): T {
		if (isReference<T>()) return changetype<T>(this.__ref);
		else if (isFloat<T>()) return <T>reinterpret<f64>(this.__bits);
		else return <T><i64>this.__bits;
	}

	/** @hidden */
	__resolveWith(value: T): void {
		if (isReference<T>()) {
			this.__resolveRef(changetype<Object | null>(changetype<usize>(value)));
		} else if (isFloat<T>()) {
			this.__fulfillRaw(null, reinterpret<u64>(<f64>value), true);
		} else {
			this.__fulfillRaw(null, <u64><i64>value, true);
		}
	}
}

/** @hidden a pending Promise<T>, made without an executor. */
// @ts-ignore: decorator
@global export function __co_promise<T>(): Promise<T> {
	// @ts-ignore: the runtime's allocator, which the editor's typings leave out
	return changetype<Promise<T>>(__new(offsetof<Promise<T>>(), idof<Promise<T>>()));
}

/** @hidden fulfils `promise` from outside: what fetch and sleep settle with. */
// @ts-ignore: decorator
@global export function __co_resolve<T>(promise: Promise<T>, value: T): void {
	promise.__resolveWith(value);
}

/** @hidden */
// @ts-ignore: decorator
@global export function __co_reject(promise: PromiseBase, reason: Error): void {
	promise.__reject(reason);
}

class __ThenJob<T, U> extends __Job {
	constructor(
		public source: Promise<T>,
		public target: Promise<U>,
		public onFulfilled: (value: T) => U,
		public onRejected: ((reason: Error) => U) | null
	) {
		super();
	}

	run(): void {
		const source = this.source;
		const target = this.target;
		if (source.__state == __FULFILLED) {
			const fn = this.onFulfilled;
			if (isVoid<U>()) {
				fn(source.__value());
				target.__fulfillVoid();
			} else {
				target.__resolveWith(fn(source.__value()));
			}
			return;
		}
		const reason = source.__reason as Error;
		const fn = this.onRejected;
		if (!fn) {
			target.__reject(reason);
			return;
		}
		if (isVoid<U>()) {
			fn(reason);
			target.__fulfillVoid();
		} else {
			target.__resolveWith(fn(reason));
		}
	}
}

class __CatchJob<T, R> extends __Job {
	constructor(public source: Promise<T>, public target: Promise<T>, public onRejected: (reason: Error) => R) {
		super();
	}

	run(): void {
		const source = this.source;
		if (source.__state == __FULFILLED) {
			this.target.__settleLike(source);
			return;
		}
		const fn = this.onRejected;
		if (isVoid<R>()) {
			fn(source.__reason as Error);
			this.target.__fulfillVoid();
			return;
		}
		// `.catch((error) => fallback)`: the handler's answer is the value, as
		// in JavaScript. It used to be dropped, and an awaited
		// `readFile(path).catch(() => "")` came back as an empty pointer.
		this.target.__resolveWith(changetype<T>(fn(source.__reason as Error)));
	}
}

class __FinallyJob<T> extends __Job {
	constructor(public source: Promise<T>, public target: Promise<T>, public onFinally: () => void) {
		super();
	}

	run(): void {
		const fn = this.onFinally;
		fn();
		this.target.__settleLike(this.source);
	}
}

class __AdoptJob extends __Job {
	constructor(public source: PromiseBase, public target: PromiseBase) {
		super();
	}

	run(): void {
		this.target.__settleLike(this.source);
	}
}

// Promise.all, allSettled, race and any. They are not members of Promise:
// the editor reads them from promise.types.d.ts, typed with TypeScript's
// tuples, and the compiler lowers a call to one of the functions here
// instead (Resolver.lowerPromiseCall) - a list, or a literal of one type, to
// __co_all and the rest; a literal of different types to __co_allN, whose
// value is a __TupleN.

class __AllState<T> {
	results: T[];
	remaining: i32;

	constructor(public target: Promise<T[]>, count: i32) {
		this.results = new Array<T>(count);
		this.remaining = count;
	}
}

class __AllJob<T> extends __Job {
	constructor(public state: __AllState<T>, public source: Promise<T>, public index: i32) {
		super();
	}

	run(): void {
		const state = this.state;
		const source = this.source;
		if (source.__state == __REJECTED) {
			state.target.__reject(source.__reason as Error);
			return;
		}
		state.results[this.index] = source.__value();
		if (--state.remaining == 0) state.target.__resolveWith(state.results);
	}
}

/** @hidden Promise.all: every value, in order, once all are; rejected with the first rejection. */
// @ts-ignore: decorator
@global function __co_all<T>(values: Promise<T>[]): Promise<T[]> {
	const promise = __co_promise<T[]>();
	const state = new __AllState<T>(promise, values.length);
	if (values.length == 0) promise.__resolveWith(state.results);
	for (let i = 0; i < values.length; i++) values[i].__react(new __AllJob<T>(state, values[i], i));
	return promise;
}

/** A promise's outcome, as Promise.allSettled gives it for each. */
// @ts-ignore: decorator
@global export class PromiseSettledResult<T> {
	/** @hidden made by allSettled, field by field: the constructor never runs. */
	constructor(
		/** The promise's outcome, either `"fulfilled"` or `"rejected"`. */
		public status: "fulfilled" | "rejected",
		/** The promise's value, when fulfilled. */
		public value: T,
		/** The rejection's reason, when rejected. */
		public reason: Error
	) {}
}

/**
 * @hidden an object of class T with every field zero, its constructor not
 * run: a result or a tuple whose fields are filled in one by one.
 */
function __co_blank<T>(): T {
	// @ts-ignore: the runtime's allocator, which the editor's typings leave out
	return changetype<T>(__new(offsetof<T>(), idof<T>()));
}

class __SettleJob<T> extends __Job {
	constructor(public source: Promise<T>, public target: Promise<PromiseSettledResult<T>>) {
		super();
	}

	run(): void {
		const source = this.source;
		const result = __co_blank<PromiseSettledResult<T>>();
		if (source.__state == __REJECTED) {
			result.status = "rejected";
			result.reason = source.__reason as Error;
		} else {
			result.status = "fulfilled";
			result.value = source.__value();
		}
		this.target.__resolveWith(result);
	}
}

/** @hidden a promise always fulfilled, with how `promise` settled. */
// @ts-ignore: decorator
@global function __co_settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
	const settled = __co_promise<PromiseSettledResult<T>>();
	promise.__react(new __SettleJob<T>(promise, settled));
	return settled;
}

/** @hidden Promise.allSettled: how each settled, in order, once all have. */
// @ts-ignore: decorator
@global function __co_allSettled<T>(values: Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
	const settled: Promise<PromiseSettledResult<T>>[] = [];
	for (let i = 0; i < values.length; i++) settled.push(__co_settle<T>(values[i]));
	return __co_all<PromiseSettledResult<T>>(settled);
}

/**
 * @hidden Promise.race: settles like the first of `values` to settle. The
 * value is copied as it is stored, so T may be a base class of theirs, or
 * nullable where one of them is a Promise<void>.
 */
// @ts-ignore: decorator
@global function __co_race<T>(values: PromiseBase[]): Promise<T> {
	const promise = __co_promise<T>();
	for (let i = 0; i < values.length; i++) values[i].__react(new __AdoptJob(values[i], promise));
	return promise;
}

/** @hidden Promise.race of a list. */
// @ts-ignore: decorator
@global function __co_raceList<T>(values: Promise<T>[]): Promise<T> {
	return __co_race<T>(changetype<PromiseBase[]>(values));
}

/** The error Promise.any rejects with when every promise is rejected; their reasons are in `errors`. */
// @ts-ignore: decorator
@global export class AggregateError extends Error {
	constructor(
		/** The reason each promise was rejected, in the order the promises were given. */
		public errors: Error[],
		message: string = ""
	) {
		super(message);
		this.name = "AggregateError";
	}
}

class __AnyState {
	remaining: i32;
	errors: Error[];

	constructor(public target: PromiseBase, count: i32) {
		this.remaining = count;
		this.errors = new Array<Error>(count);
	}
}

class __AnyJob extends __Job {
	constructor(public state: __AnyState, public source: PromiseBase, public index: i32) {
		super();
	}

	run(): void {
		const state = this.state;
		const source = this.source;
		if (source.__state == __FULFILLED) {
			state.target.__settleLike(source);
			return;
		}
		state.errors[this.index] = source.__reason as Error;
		if (--state.remaining == 0) state.target.__reject(new AggregateError(state.errors, "All promises were rejected"));
	}
}

/** @hidden Promise.any: the first value; an AggregateError once every promise is rejected. */
// @ts-ignore: decorator
@global function __co_any<T>(values: PromiseBase[]): Promise<T> {
	const promise = __co_promise<T>();
	const state = new __AnyState(promise, values.length);
	if (values.length == 0) promise.__reject(new AggregateError([], "All promises were rejected"));
	for (let i = 0; i < values.length; i++) values[i].__react(new __AnyJob(state, values[i], i));
	return promise;
}

/** @hidden Promise.any of a list. */
// @ts-ignore: decorator
@global function __co_anyList<T>(values: Promise<T>[]): Promise<T> {
	return __co_any<T>(changetype<PromiseBase[]>(values));
}

/** @hidden a tuple Promise.all fills in, one settled promise at a time. */
// @ts-ignore: decorator
@global class __Tuple {
	__set(index: i32, source: PromiseBase): void {}
}

class __TupleState {
	constructor(public target: PromiseBase, public tuple: __Tuple, public remaining: i32) {}
}

class __TupleJob extends __Job {
	constructor(public state: __TupleState, public source: PromiseBase, public index: i32) {
		super();
	}

	run(): void {
		const state = this.state;
		const source = this.source;
		if (source.__state == __REJECTED) {
			state.target.__reject(source.__reason as Error);
			return;
		}
		state.tuple.__set(this.index, source);
		if (--state.remaining == 0) state.target.__fulfillRaw(state.tuple, 0, true);
	}
}

function __co_allOf(target: PromiseBase, tuple: __Tuple, sources: PromiseBase[]): void {
	const state = new __TupleState(target, tuple, sources.length);
	for (let i = 0; i < sources.length; i++) sources[i].__react(new __TupleJob(state, sources[i], i));
}

/** @hidden what Promise.all of 2 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple2<A, B> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B) {
		super();
	}

	get length(): i32 {
		return 2;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else this._1 = changetype<Promise<B>>(source).__value();
	}
}

/** @hidden what Promise.all of 3 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple3<A, B, C> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B, public _2: C) {
		super();
	}

	get length(): i32 {
		return 3;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else if (index == 1) this._1 = changetype<Promise<B>>(source).__value();
		else this._2 = changetype<Promise<C>>(source).__value();
	}
}

/** @hidden what Promise.all of 4 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple4<A, B, C, D> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B, public _2: C, public _3: D) {
		super();
	}

	get length(): i32 {
		return 4;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else if (index == 1) this._1 = changetype<Promise<B>>(source).__value();
		else if (index == 2) this._2 = changetype<Promise<C>>(source).__value();
		else this._3 = changetype<Promise<D>>(source).__value();
	}
}

/** @hidden what Promise.all of 5 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple5<A, B, C, D, E> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B, public _2: C, public _3: D, public _4: E) {
		super();
	}

	get length(): i32 {
		return 5;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else if (index == 1) this._1 = changetype<Promise<B>>(source).__value();
		else if (index == 2) this._2 = changetype<Promise<C>>(source).__value();
		else if (index == 3) this._3 = changetype<Promise<D>>(source).__value();
		else this._4 = changetype<Promise<E>>(source).__value();
	}
}

/** @hidden what Promise.all of 6 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple6<A, B, C, D, E, F> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B, public _2: C, public _3: D, public _4: E, public _5: F) {
		super();
	}

	get length(): i32 {
		return 6;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else if (index == 1) this._1 = changetype<Promise<B>>(source).__value();
		else if (index == 2) this._2 = changetype<Promise<C>>(source).__value();
		else if (index == 3) this._3 = changetype<Promise<D>>(source).__value();
		else if (index == 4) this._4 = changetype<Promise<E>>(source).__value();
		else this._5 = changetype<Promise<F>>(source).__value();
	}
}

/** @hidden what Promise.all of 7 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple7<A, B, C, D, E, F, G> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B, public _2: C, public _3: D, public _4: E, public _5: F, public _6: G) {
		super();
	}

	get length(): i32 {
		return 7;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else if (index == 1) this._1 = changetype<Promise<B>>(source).__value();
		else if (index == 2) this._2 = changetype<Promise<C>>(source).__value();
		else if (index == 3) this._3 = changetype<Promise<D>>(source).__value();
		else if (index == 4) this._4 = changetype<Promise<E>>(source).__value();
		else if (index == 5) this._5 = changetype<Promise<F>>(source).__value();
		else this._6 = changetype<Promise<G>>(source).__value();
	}
}

/** @hidden what Promise.all of 8 promises of different types gives. */
// @ts-ignore: decorator
@global class __Tuple8<A, B, C, D, E, F, G, H> extends __Tuple {
	/** @hidden filled in by __set: the constructor never runs. */
	constructor(public _0: A, public _1: B, public _2: C, public _3: D, public _4: E, public _5: F, public _6: G, public _7: H) {
		super();
	}

	get length(): i32 {
		return 8;
	}

	__set(index: i32, source: PromiseBase): void {
		if (index == 0) this._0 = changetype<Promise<A>>(source).__value();
		else if (index == 1) this._1 = changetype<Promise<B>>(source).__value();
		else if (index == 2) this._2 = changetype<Promise<C>>(source).__value();
		else if (index == 3) this._3 = changetype<Promise<D>>(source).__value();
		else if (index == 4) this._4 = changetype<Promise<E>>(source).__value();
		else if (index == 5) this._5 = changetype<Promise<F>>(source).__value();
		else if (index == 6) this._6 = changetype<Promise<G>>(source).__value();
		else this._7 = changetype<Promise<H>>(source).__value();
	}
}

/** @hidden Promise.all of 2 promises of different types. */
// @ts-ignore: decorator
@global function __co_all2<A, B>(a: Promise<A>, b: Promise<B>): Promise<__Tuple2<A, B>> {
	const promise = __co_promise<__Tuple2<A, B>>();
	__co_allOf(promise, __co_blank<__Tuple2<A, B>>(), [a, b]);
	return promise;
}

/** @hidden Promise.allSettled of 2 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled2<A, B>(a: Promise<A>, b: Promise<B>): Promise<__Tuple2<PromiseSettledResult<A>, PromiseSettledResult<B>>> {
	return __co_all2<PromiseSettledResult<A>, PromiseSettledResult<B>>(__co_settle<A>(a), __co_settle<B>(b));
}

/** @hidden Promise.all of 3 promises of different types. */
// @ts-ignore: decorator
@global function __co_all3<A, B, C>(a: Promise<A>, b: Promise<B>, c: Promise<C>): Promise<__Tuple3<A, B, C>> {
	const promise = __co_promise<__Tuple3<A, B, C>>();
	__co_allOf(promise, __co_blank<__Tuple3<A, B, C>>(), [a, b, c]);
	return promise;
}

/** @hidden Promise.allSettled of 3 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled3<A, B, C>(a: Promise<A>, b: Promise<B>, c: Promise<C>): Promise<__Tuple3<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>>> {
	return __co_all3<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>>(__co_settle<A>(a), __co_settle<B>(b), __co_settle<C>(c));
}

/** @hidden Promise.all of 4 promises of different types. */
// @ts-ignore: decorator
@global function __co_all4<A, B, C, D>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>): Promise<__Tuple4<A, B, C, D>> {
	const promise = __co_promise<__Tuple4<A, B, C, D>>();
	__co_allOf(promise, __co_blank<__Tuple4<A, B, C, D>>(), [a, b, c, d]);
	return promise;
}

/** @hidden Promise.allSettled of 4 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled4<A, B, C, D>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>): Promise<__Tuple4<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>>> {
	return __co_all4<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>>(__co_settle<A>(a), __co_settle<B>(b), __co_settle<C>(c), __co_settle<D>(d));
}

/** @hidden Promise.all of 5 promises of different types. */
// @ts-ignore: decorator
@global function __co_all5<A, B, C, D, E>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>): Promise<__Tuple5<A, B, C, D, E>> {
	const promise = __co_promise<__Tuple5<A, B, C, D, E>>();
	__co_allOf(promise, __co_blank<__Tuple5<A, B, C, D, E>>(), [a, b, c, d, e]);
	return promise;
}

/** @hidden Promise.allSettled of 5 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled5<A, B, C, D, E>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>): Promise<__Tuple5<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>>> {
	return __co_all5<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>>(__co_settle<A>(a), __co_settle<B>(b), __co_settle<C>(c), __co_settle<D>(d), __co_settle<E>(e));
}

/** @hidden Promise.all of 6 promises of different types. */
// @ts-ignore: decorator
@global function __co_all6<A, B, C, D, E, F>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>, f: Promise<F>): Promise<__Tuple6<A, B, C, D, E, F>> {
	const promise = __co_promise<__Tuple6<A, B, C, D, E, F>>();
	__co_allOf(promise, __co_blank<__Tuple6<A, B, C, D, E, F>>(), [a, b, c, d, e, f]);
	return promise;
}

/** @hidden Promise.allSettled of 6 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled6<A, B, C, D, E, F>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>, f: Promise<F>): Promise<__Tuple6<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>, PromiseSettledResult<F>>> {
	return __co_all6<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>, PromiseSettledResult<F>>(__co_settle<A>(a), __co_settle<B>(b), __co_settle<C>(c), __co_settle<D>(d), __co_settle<E>(e), __co_settle<F>(f));
}

/** @hidden Promise.all of 7 promises of different types. */
// @ts-ignore: decorator
@global function __co_all7<A, B, C, D, E, F, G>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>, f: Promise<F>, g: Promise<G>): Promise<__Tuple7<A, B, C, D, E, F, G>> {
	const promise = __co_promise<__Tuple7<A, B, C, D, E, F, G>>();
	__co_allOf(promise, __co_blank<__Tuple7<A, B, C, D, E, F, G>>(), [a, b, c, d, e, f, g]);
	return promise;
}

/** @hidden Promise.allSettled of 7 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled7<A, B, C, D, E, F, G>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>, f: Promise<F>, g: Promise<G>): Promise<__Tuple7<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>, PromiseSettledResult<F>, PromiseSettledResult<G>>> {
	return __co_all7<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>, PromiseSettledResult<F>, PromiseSettledResult<G>>(__co_settle<A>(a), __co_settle<B>(b), __co_settle<C>(c), __co_settle<D>(d), __co_settle<E>(e), __co_settle<F>(f), __co_settle<G>(g));
}

/** @hidden Promise.all of 8 promises of different types. */
// @ts-ignore: decorator
@global function __co_all8<A, B, C, D, E, F, G, H>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>, f: Promise<F>, g: Promise<G>, h: Promise<H>): Promise<__Tuple8<A, B, C, D, E, F, G, H>> {
	const promise = __co_promise<__Tuple8<A, B, C, D, E, F, G, H>>();
	__co_allOf(promise, __co_blank<__Tuple8<A, B, C, D, E, F, G, H>>(), [a, b, c, d, e, f, g, h]);
	return promise;
}

/** @hidden Promise.allSettled of 8 promises of different types. */
// @ts-ignore: decorator
@global function __co_allSettled8<A, B, C, D, E, F, G, H>(a: Promise<A>, b: Promise<B>, c: Promise<C>, d: Promise<D>, e: Promise<E>, f: Promise<F>, g: Promise<G>, h: Promise<H>): Promise<__Tuple8<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>, PromiseSettledResult<F>, PromiseSettledResult<G>, PromiseSettledResult<H>>> {
	return __co_all8<PromiseSettledResult<A>, PromiseSettledResult<B>, PromiseSettledResult<C>, PromiseSettledResult<D>, PromiseSettledResult<E>, PromiseSettledResult<F>, PromiseSettledResult<G>, PromiseSettledResult<H>>(__co_settle<A>(a), __co_settle<B>(b), __co_settle<C>(c), __co_settle<D>(d), __co_settle<E>(e), __co_settle<F>(f), __co_settle<G>(g), __co_settle<H>(h));
}

// ---------------------------------------------------------------- resolve and reject

// The functions `new Promise(executor)` hands out. Each is a copy of one of
// these with the promise in its `_env`, which the compiler puts in __env - the
// global of its library that closures read theirs from - on every indirect
// call (Compiler.makeCallIndirect).

function __co_envPromise(): PromiseBase {
	// @ts-ignore: the compiler library's, unknown to the editor
	return changetype<PromiseBase>(__env);
}

function __co_resolveI32(value: i32 = 0): void {
	__co_envPromise().__fulfillRaw(null, <u64><i64>value, true);
}

function __co_resolveRef(value: usize = 0): void {
	__co_envPromise().__resolveRef(changetype<Object | null>(value));
}

function __co_resolveI64(value: i64 = 0): void {
	__co_envPromise().__fulfillRaw(null, <u64>value, true);
}

function __co_resolveF32(value: f32 = 0): void {
	__co_envPromise().__fulfillRaw(null, reinterpret<u64>(<f64>value), true);
}

function __co_resolveF64(value: f64 = 0): void {
	__co_envPromise().__fulfillRaw(null, reinterpret<u64>(value), true);
}

function __co_rejectBound(reason: Error): void {
	__co_envPromise().__reject(reason);
}

/**
 * @hidden A function object like `fn`, with `env` in its `_env`; the
 * collector follows `_env`. The function reads it back from __env.
 */
// @ts-ignore: decorator
@global export function __co_bindEnv(fn: usize, env: Object): usize {
	// The copy is of the original's own class - its header's rtId, 8 bytes
	// before it - since a Function class nothing else instantiates is not in
	// the runtime's type table, and the collector stops at an unknown id.
	// @ts-ignore: the runtime's allocator, which the editor's typings leave out
	const copy: usize = __new(offsetof<(value?: i32) => void>(), load<u32>(fn - 8));
	store<u32>(copy, load<u32>(fn));
	store<usize>(copy, changetype<usize>(env), sizeof<u32>());
	// @ts-ignore: the collector's write barrier, likewise
	__link(copy, changetype<usize>(env), false);
	return copy;
}

function __co_resolver<T>(promise: Promise<T>): (value?: T) => void {
	let fn: usize;
	if (isReference<T>()) fn = changetype<usize>(__co_resolveRef);
	else if (isFloat<T>() && sizeof<T>() == 8) fn = changetype<usize>(__co_resolveF64);
	else if (isFloat<T>()) fn = changetype<usize>(__co_resolveF32);
	else if (sizeof<T>() == 8) fn = changetype<usize>(__co_resolveI64);
	else fn = changetype<usize>(__co_resolveI32);
	return changetype<(value?: T) => void>(__co_bindEnv(fn, promise));
}

function __co_rejecter(promise: PromiseBase): (reason: Error) => void {
	return changetype<(reason: Error) => void>(__co_bindEnv(changetype<usize>(__co_rejectBound), promise));
}

// ---------------------------------------------------------------- coroutines

class __Coroutine {
	/** Managed arguments of the call, which only its locals hold otherwise. */
	roots: Object[] = [];
	/** Its shadow stack while parked, where the collector sees it. */
	stack: StaticArray<Object | null> | null = null;
	/** Asyncify's buffer: where the host unwinds its locals to. */
	buffer: usize = 0;
	/** The player whose handler started it: its awaits end when they leave. */
	player: i32 = 0;
	/** The abort signal it runs under, once asked for. */
	signal: AbortSignal | null = null;
	/** Parked, waiting for a job to resume it. */
	parked: bool = false;
	/** Counts its waits, so a resume meant for an earlier one is dropped. */
	wait: i32 = 0;
	/** Why it is to give up at the next resume: its signal aborted. */
	abortReason: Error | null = null;
	watch: __CoroutineAbort | null = null;
	watched: AbortSignal | null = null;

	constructor(public id: i32, public promise: PromiseBase) {}
}

// @ts-ignore: decorator
@lazy const __coroutines = new Map<i32, __Coroutine>();
// @ts-ignore: decorator
@lazy const __running: __Coroutine[] = [];
// @ts-ignore: decorator
@lazy let __nextCoroutine: i32 = 1;
// @ts-ignore: decorator
@lazy const __spawnArgs = new StaticArray<u32>(64);
// @ts-ignore: decorator
@lazy const __keep: Object[] = [];

/**
 * @hidden The player whose command or event is being handled, set by the
 * facade around the handler: a coroutine started there runs under that
 * player's signal.
 */
// @ts-ignore: decorator
@global let __co_ambient_player: i32 = 0;

function __co_current(): __Coroutine {
	if (__running.length == 0) {
		console.error("await outside an async function");
		unreachable();
	}
	return __running[__running.length - 1];
}

/** @hidden whether the host is calling an async function as its coroutine right now. */
// @ts-ignore: decorator
@global function __co_entered(): bool {
	return __co_host_entered() != 0;
}

/** @hidden where an async function writes its arguments for the host. */
// @ts-ignore: decorator
@global function __co_args(): usize {
	return changetype<usize>(__spawnArgs);
}

/** @hidden a managed argument, held while the call lasts. */
// @ts-ignore: decorator
@global function __co_keep(value: usize): void {
	if (value != 0) __keep.push(changetype<Object>(value));
}

/** @hidden runs an async function's body as a coroutine - see the top of this file. */
// @ts-ignore: decorator
@global function __co_spawn(fn: i32, cells: i32, promise: PromiseBase): void {
	const co = new __Coroutine(__nextCoroutine++, promise);
	for (let i = 0; i < __keep.length; i++) co.roots.push(__keep[i]);
	__keep.length = 0;

	// A player's command or event runs it under that player's signal; started
	// from another coroutine otherwise, it runs under the same one.
	if (__co_ambient_player > 0) {
		co.player = __co_ambient_player;
	} else if (__running.length > 0) {
		const parent = __running[__running.length - 1];
		co.player = parent.player;
		co.signal = parent.signal;
	}

	const buffer = heap.alloc(<usize>__CO_BUFFER);
	store<usize>(buffer, buffer + 2 * sizeof<usize>());
	store<usize>(buffer + sizeof<usize>(), buffer + <usize>__CO_BUFFER);
	co.buffer = buffer;
	__coroutines.set(co.id, co);

	__running.push(co);
	const outcome = __co_host_spawn(fn, changetype<usize>(__spawnArgs), cells, co.id, buffer);
	__running.pop();
	__co_after(co, outcome);
}

/** What a call into a coroutine came back with. */
function __co_after(co: __Coroutine, outcome: i32): void {
	if (outcome == __CO_PARKED) return;
	if (outcome == __CO_TRAPPED) {
		// The host has said why, with the plugin's name. Whoever awaits it
		// hears it as a rejection, which is not reported a second time.
		co.promise.__reject(__co_abortError("the async function crashed"));
	}
	__co_finish(co);
}

function __co_finish(co: __Coroutine): void {
	if (!__coroutines.has(co.id)) return;
	__coroutines.delete(co.id);
	__co_unwatch(co);
	co.roots.length = 0;
	co.stack = null;
	if (co.buffer != 0) heap.free(co.buffer);
	co.buffer = 0;
}

function __co_settled(co: __Coroutine): usize {
	__co_finish(co);
	return changetype<usize>(co.promise);
}

/** @hidden `return;` in an async function. */
// @ts-ignore: decorator
@global function __co_return_void(): usize {
	const co = __co_current();
	co.promise.__fulfillVoid();
	return __co_settled(co);
}

/** @hidden `return value` in an async function, by how the value is carried. */
// @ts-ignore: decorator
@global function __co_return_i32(value: i32): usize {
	const co = __co_current();
	co.promise.__fulfillRaw(null, <u64><i64>value, true);
	return __co_settled(co);
}

// @ts-ignore: decorator
@global function __co_return_i64(value: i64): usize {
	const co = __co_current();
	co.promise.__fulfillRaw(null, <u64>value, true);
	return __co_settled(co);
}

// @ts-ignore: decorator
@global function __co_return_f64(value: f64): usize {
	const co = __co_current();
	co.promise.__fulfillRaw(null, reinterpret<u64>(value), true);
	return __co_settled(co);
}

// @ts-ignore: decorator
@global function __co_return_ref(value: usize): usize {
	const co = __co_current();
	co.promise.__resolveRef(changetype<Object | null>(value));
	return __co_settled(co);
}

/** @hidden `throw error` in an async function: its Promise rejects with the error. */
// @ts-ignore: decorator
@global function __co_throw(reason: Error): usize {
	const co = __co_current();
	co.promise.__reject(reason);
	return __co_settled(co);
}

class __ResumeJob extends __Job {
	constructor(id: i32, wait: i32) {
		super();
		this.coroutine = id;
		this.wait = wait;
	}
}

/** @hidden `await promise`: parks the coroutine until it settles, then gives back its value. */
// @ts-ignore: decorator
@global function __await<T>(promise: Promise<T>): T {
	__co_wait(promise);
	return promise.__value();
}

function __co_wait(promise: PromiseBase): void {
	const co = __co_current();
	const wait = ++co.wait;

	// As in JavaScript, even a settled promise is awaited: the rest of the
	// function runs as a job, after what is already queued.
	promise.__react(new __ResumeJob(co.id, wait));

	const signal = __co_signal(co);
	if (signal) {
		if (signal.aborted) {
			co.abortReason = signal.reason;
		} else {
			const watch = new __CoroutineAbort(co.id);
			co.watch = watch;
			co.watched = signal;
			signal.__watch(watch);
		}
	}

	co.parked = true;
	__co_host_suspend(0);

	// Resumed.
	__co_unwatch(co);
	const reason = co.abortReason;
	if (reason) __co_giveUp(co, reason);
	if (promise.__state == __REJECTED) __co_giveUp(co, promise.__reason as Error);
}

/** The awaited promise was rejected, or the signal aborted: the coroutine rejects with it and ends here. */
function __co_giveUp(co: __Coroutine, reason: Error): void {
	co.promise.__reject(reason);
	__co_host_suspend(1);
	unreachable();
}

function __co_unwatch(co: __Coroutine): void {
	const watch = co.watch;
	const signal = co.watched;
	co.watch = null;
	co.watched = null;
	if (watch && signal) signal.__unwatch(watch);
}

/** The signal a coroutine runs under: its player's, while that player is on the server. */
function __co_signal(co: __Coroutine): AbortSignal | null {
	let signal = co.signal;
	if (!signal && co.player > 0) co.signal = signal = __co_player_signal(co.player);
	return signal;
}

/** @hidden the signal the running coroutine is under, for fetch and sleep. */
// @ts-ignore: decorator
@global function __co_context(): AbortSignal | null {
	if (__running.length == 0) return null;
	return __co_signal(__running[__running.length - 1]);
}

/** @hidden the next job to run, run here, or the coroutine the host is to resume; 0 when none are left. */
// @ts-ignore: decorator
@global function __co_next_job(): i32 {
	while (__jobHead < __jobs.length) {
		const job = __jobs[__jobHead] as __Job;
		__jobs[__jobHead] = null;
		__jobHead++;

		const id = job.coroutine;
		if (id == 0) {
			job.run();
			continue;
		}
		if (!__coroutines.has(id)) continue;
		const co = __coroutines.get(id);
		if (!co.parked || co.wait != job.wait) continue;
		co.parked = false;
		__running.push(co);
		return id;
	}
	__jobs.length = 0;
	__jobHead = 0;
	__woken = false;
	__co_reportUnhandled();
	return 0;
}

/** @hidden a resume has come back from the host. */
// @ts-ignore: decorator
@global function __co_resumed(outcome: i32): void {
	const co = __running.pop();
	__co_after(co, outcome);
}

function __co_reportUnhandled(): void {
	for (let i = 0; i < __unhandled.length; i++) {
		const promise = __unhandled[i];
		if (promise.__handled) continue;
		const reason = promise.__reason as Error;
		// An abort is expected - a player left, a request was cancelled.
		if (reason.name == "AbortError" || reason.name == "TimeoutError") continue;
		console.error(`Unhandled promise rejection: ${reason.message}`);
	}
	__unhandled.length = 0;
}

// The shadow stack of a parked coroutine. AssemblyScript keeps the managed
// locals of every frame in linear memory below __stack_pointer, where the
// collector scans them; a parked coroutine's frames would be overwritten by
// whatever runs next, so they are copied here, into memory the collector
// traces, and copied back to the same addresses when it resumes.

/** @hidden */
// @ts-ignore: decorator
@global function __co_sp(): usize {
	return __stack_pointer;
}

/** @hidden */
// @ts-ignore: decorator
@global function __co_set_sp(sp: usize): void {
	__stack_pointer = sp;
}

/** @hidden */
// @ts-ignore: decorator
@global function __co_park(id: i32, lo: usize, hi: usize): void {
	if (!__coroutines.has(id)) return;
	const saved = new StaticArray<Object | null>(<i32>((hi - lo) / sizeof<usize>()));
	memory.copy(changetype<usize>(saved), lo, hi - lo);
	__coroutines.get(id).stack = saved;
}

/** @hidden bytes of shadow stack a parked coroutine holds. */
// @ts-ignore: decorator
@global function __co_parked(id: i32): usize {
	if (!__coroutines.has(id)) return 0;
	const saved = __coroutines.get(id).stack;
	return saved ? <usize>saved.length * sizeof<usize>() : 0;
}

/** @hidden */
// @ts-ignore: decorator
@global function __co_unpark(id: i32, lo: usize): void {
	if (!__coroutines.has(id)) return;
	const co = __coroutines.get(id);
	const saved = co.stack;
	if (!saved) return;
	memory.copy(lo, changetype<usize>(saved), <usize>saved.length * sizeof<usize>());
	co.stack = null;
}

// ---------------------------------------------------------------- abort

/** The event an abort listener gets. */
// @ts-ignore: decorator
@global export class Event {
	constructor(
		/** The event's type; the only one here is `"abort"`. */
		public type: string
	) {}
}

/** @hidden something the hood does when a signal aborts. */
// @ts-ignore: decorator
@global export class __AbortWatch {
	run(reason: Error): void {}
}

/** A signal to give something up: a request, a timer, everything a player started. */
// @ts-ignore: decorator
@global export class AbortSignal {
	private __aborted: bool = false;
	private __reason: Error | null = null;
	private __listeners: ((event: Event) => void)[] = [];
	private __watches: __AbortWatch[] = [];

	/** `true` once the signal has aborted. */
	get aborted(): bool {
		return this.__aborted;
	}

	/** The abort's reason: an Error named `"AbortError"` unless `abort()` was given one. */
	get reason(): Error | null {
		return this.__reason;
	}

	/** Calls `listener` when the signal aborts. */
	addEventListener(type: "abort", listener: (event: Event) => void): void {
		this.__listeners.push(listener);
	}

	/** Takes back a `listener` given to `addEventListener`: it is not called any more. */
	removeEventListener(type: "abort", listener: (event: Event) => void): void {
		const at = this.__listeners.indexOf(listener);
		if (at >= 0) this.__listeners.splice(at, 1);
	}

	/** A signal that aborts by itself after `ms`, with an Error named `"TimeoutError"`. */
	static timeout(ms: number): AbortSignal {
		const signal = new AbortSignal();
		const id = __co_host_id();
		__timeouts.set(id, signal);
		__co_host_task(reinterpret<i32>(<f32>(ms / 1000.0)), __co_timeoutFired.index, id, 0);
		return signal;
	}

	/** A signal that has aborted already. */
	static abort(reason: Error | null = null): AbortSignal {
		const signal = new AbortSignal();
		signal.__abort(reason ? reason : __co_abortError("This operation was aborted"));
		return signal;
	}

	/** A signal that aborts when any of `signals` does. */
	static any(signals: AbortSignal[]): AbortSignal {
		const signal = new AbortSignal();
		for (let i = 0; i < signals.length; i++) {
			const one = signals[i];
			if (one.aborted) {
				signal.__abort(one.reason as Error);
				break;
			}
			one.__watch(new __AnyAbort(signal));
		}
		return signal;
	}

	/** @hidden */
	__abort(reason: Error): void {
		if (this.__aborted) return;
		this.__aborted = true;
		this.__reason = reason;
		const watches = this.__watches;
		this.__watches = [];
		for (let i = 0; i < watches.length; i++) watches[i].run(reason);
		const listeners = this.__listeners.slice(0);
		const event = new Event("abort");
		for (let i = 0; i < listeners.length; i++) listeners[i](event);
	}

	/** @hidden */
	__watch(watch: __AbortWatch): void {
		this.__watches.push(watch);
	}

	/** @hidden */
	__unwatch(watch: __AbortWatch): void {
		const at = this.__watches.indexOf(watch);
		if (at >= 0) this.__watches.splice(at, 1);
	}
}

/** A controller that aborts its `signal` on demand: `controller.abort()`. */
// @ts-ignore: decorator
@global export class AbortController {
	/** The controller's signal: hand it to fetch, sleep or anything else that takes one. */
	readonly signal: AbortSignal = new AbortSignal();

	/** Aborts the signal, with `reason` or an Error named `"AbortError"`. */
	abort(reason: Error | null = null): void {
		this.signal.__abort(reason ? reason : __co_abortError("This operation was aborted"));
	}
}

/** @hidden an Error named as an abort: expected, never reported as unhandled. */
// @ts-ignore: decorator
@global function __co_abortError(message: string): Error {
	const error = new Error(message);
	error.name = "AbortError";
	return error;
}

class __AnyAbort extends __AbortWatch {
	constructor(public signal: AbortSignal) {
		super();
	}

	run(reason: Error): void {
		this.signal.__abort(reason);
	}
}

class __CoroutineAbort extends __AbortWatch {
	constructor(public id: i32) {
		super();
	}

	run(reason: Error): void {
		if (!__coroutines.has(this.id)) return;
		const co = __coroutines.get(this.id);
		if (!co.parked) return;
		co.abortReason = reason;
		__co_queue(new __ResumeJob(co.id, co.wait));
	}
}

// @ts-ignore: decorator
@lazy const __timeouts = new Map<i32, AbortSignal>();

function __co_timeoutFired(id: i32): void {
	if (!__timeouts.has(id)) return;
	const signal = __timeouts.get(id);
	__timeouts.delete(id);
	const error = new Error("The operation was aborted due to timeout");
	error.name = "TimeoutError";
	signal.__abort(error);
}

/**
 * @hidden watches up to two signals for an operation - the one it was given
 * and the one its coroutine runs under - and lets go of both when it ends.
 */
// @ts-ignore: decorator
@global export class __AbortGuard {
	private signals: AbortSignal[] = [];

	constructor(public watch: __AbortWatch, given: AbortSignal | null) {
		this.add(given);
		const context = __co_context();
		if (context != given) this.add(context);
	}

	private add(signal: AbortSignal | null): void {
		if (!signal) return;
		this.signals.push(signal);
		signal.__watch(this.watch);
	}

	/** The reason if a signal has aborted already. */
	get aborted(): Error | null {
		for (let i = 0; i < this.signals.length; i++) {
			if (this.signals[i].aborted) return this.signals[i].reason;
		}
		return null;
	}

	release(): void {
		for (let i = 0; i < this.signals.length; i++) this.signals[i].__unwatch(this.watch);
		this.signals.length = 0;
	}
}

// ---------------------------------------------------------------- sleep

class __Sleep extends __AbortWatch {
	guard: __AbortGuard | null = null;

	constructor(public promise: Promise<void>, public id: i32) {
		super();
	}

	run(reason: Error): void {
		if (!__sleeps.has(this.id)) return;
		__sleeps.delete(this.id);
		__co_host_stop_task(this.id);
		(this.guard as __AbortGuard).release();
		this.promise.__reject(reason);
	}
}

// @ts-ignore: decorator
@lazy const __sleeps = new Map<i32, __Sleep>();

/** @hidden the facade's sleep(): fulfilled after `ms`, rejected if a signal aborts first. */
// @ts-ignore: decorator
@global export function __co_sleep(ms: f64, signal: AbortSignal | null): Promise<void> {
	const promise = __co_promise<void>();
	const id = __co_host_id();
	const sleep = new __Sleep(promise, id);
	const guard = new __AbortGuard(sleep, signal);
	sleep.guard = guard;

	const already = guard.aborted;
	if (already) {
		guard.release();
		promise.__reject(already);
		return promise;
	}

	__sleeps.set(id, sleep);
	__co_host_task(reinterpret<i32>(<f32>(ms / 1000.0)), __co_sleepFired.index, id, 0);
	return promise;
}

function __co_sleepFired(id: i32): void {
	if (!__sleeps.has(id)) return;
	const sleep = __sleeps.get(id);
	__sleeps.delete(id);
	(sleep.guard as __AbortGuard).release();
	sleep.promise.__fulfillVoid();
}

// ---------------------------------------------------------------- players

// One controller per player slot, made when first asked for and aborted when
// the player leaves; the next player in the slot gets a fresh one.
// @ts-ignore: decorator
@lazy const __playerControllers: (AbortController | null)[] = [];
// @ts-ignore: decorator
@lazy let __playersWatched = false;

/** @hidden player.signal. */
// @ts-ignore: decorator
@global export function __co_player_signal(id: i32): AbortSignal {
	if (!__playersWatched) {
		__playersWatched = true;
		// The stock forward, through the host like every event: shape 1 is
		// the wide handler, (id, drop, message, unused).
		__co_host_on("client_disconnected", __co_playerLeft.index, 1);
	}
	while (__playerControllers.length <= id) __playerControllers.push(null);
	let controller = __playerControllers[id];
	if (!controller) __playerControllers[id] = controller = new AbortController();
	return controller.signal;
}

function __co_playerLeft(id: i32, drop: i32, message: i32, unused: i32): void {
	if (id < 0 || id >= __playerControllers.length) return;
	const controller = __playerControllers[id];
	if (!controller) return;
	__playerControllers[id] = null;
	controller.signal.__abort(__co_abortError("The player left"));
}
