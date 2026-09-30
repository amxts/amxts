// The Promise globals as the editor reads them, and what it knows of
// Promise.all, allSettled, race and any.
//
// as/promise.ts is where the classes are; the compiler makes them global
// through `@global`. The editor treats every file with an import or an export
// as a module - a project's plugin without an import line too - so here they
// are made global for it: `Promise`, `AbortController`, `AbortSignal`,
// `Event`, and what the hood's other files call.
//
// The four statics are TypeScript's own lib signatures, which type a list
// written in place as a tuple - `Promise.all([fetch(url), sleep(1000)])` is a
// `Promise<[Response, void]>`. AssemblyScript has no tuple types and no
// mapped types to declare these with, so as/promise.ts leaves the four out of
// its Promise class and the compiler lowers each call to a hidden function
// there (Resolver.lowerPromiseCall in the compiler patch). A namespace of the
// same name merges them into the class, as statics.
//
// Only the editor reads this file.
import * as impl from "./promise";

declare global {
	/** The value a promise gives, or the value itself. */
	type __PromiseValue<T> = T extends impl.Promise<infer U> ? U : T;

	/** The value `await` gives of a promise or of a plain value - TypeScript's own name for it, which `await 5` and `for await` look up. */
	type Awaited<T> = __PromiseValue<T>;

	/** The statics that take a list of promises: `all`, `allSettled`, `race` and `any`. */
	// oxlint-disable-next-line no-redeclare -- merged into the class below, as statics
	namespace Promise {
		/**
		 * Waits for every promise and gives their values in order; rejects with the
		 * first rejection. Promises of different types give a tuple:
		 *
		 * ```ts
		 * const [response, count] = await Promise.all([fetch(url), countAsync()]);
		 * ```
		 */
		function all<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: __PromiseValue<T[P]> }>;

		/**
		 * Waits for every promise to settle, either way, and tells how each did:
		 * `status` is `"fulfilled"` with `value`, or `"rejected"` with `reason`.
		 */
		function allSettled<T extends readonly unknown[] | []>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<__PromiseValue<T[P]>> }>;

		/**
		 * Settles like the first promise to settle. Promises of different types
		 * need a common base class; a Promise<void> among them makes the value
		 * nullable.
		 */
		function race<T extends readonly unknown[] | []>(values: T): Promise<__PromiseValue<T[number]>>;

		/**
		 * Gives the first value to arrive; once all promises are rejected, rejects
		 * with an AggregateError whose `errors` hold every reason.
		 */
		function any<T extends readonly unknown[] | []>(values: T): Promise<__PromiseValue<T[number]>>;
	}

	// The class the namespace above merges its statics into.
	class Promise<T> extends impl.Promise<T> {}
	export import PromiseLike = impl.PromiseLike;
	export import PromiseBase = impl.PromiseBase;
	export import PromiseSettledResult = impl.PromiseSettledResult;
	export import AggregateError = impl.AggregateError;
	export import Event = impl.Event;
	export import AbortSignal = impl.AbortSignal;
	export import AbortController = impl.AbortController;

	// The hood's: what the facade and the libraries beside it call.
	export import __AbortWatch = impl.__AbortWatch;
	export import __AbortGuard = impl.__AbortGuard;
	export import __co_promise = impl.__co_promise;
	export import __co_resolve = impl.__co_resolve;
	export import __co_reject = impl.__co_reject;
	export import __co_bindEnv = impl.__co_bindEnv;
	export import __co_sleep = impl.__co_sleep;
	export import __co_player_signal = impl.__co_player_signal;
	/** @hidden The player whose command or event is being handled. */
	let __co_ambient_player: i32;
}
