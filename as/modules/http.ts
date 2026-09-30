// fetch() over the easy_http module.
//
// An extension, not the core: easy_http is a third-party AMX Mod X module
// (github.com/Next21Team/AmxxEasyHttp), so a plugin imports this file itself -
// `import { fetch } from "~/modules/http"` - and a server without the module
// gets one clear line in the log instead of a missing-native error.
//
//   const response = await fetch("https://example.com/");
//   if (response.ok) console.log(response.text);
//
//   fetch("https://example.com/")
//     .then((response) => console.log(`${response.status}: ${response.text}`))
//     .catch((error) => console.log(error.message));
//
// A real Promise (as/promise.ts): awaited in an async function, or given
// .then and .catch. `signal` cancels the request, as the Fetch standard's does.
import { CellBuffer, WideHandler } from "~/facade";
import {
	LibraryExists, ezhttp_cancel_request, ezhttp_create_options, ezhttp_delete, ezhttp_get,
	ezhttp_get_downloaded_bytes, ezhttp_get_error_code, ezhttp_get_error_message, ezhttp_get_http_code,
	ezhttp_option_set_body, ezhttp_option_set_header, ezhttp_patch, ezhttp_post, ezhttp_put
} from "~/natives";
import { LibType_Library } from "~/constants";

/** A request's options besides its URL. Every field is optional. */
export class RequestInit {
	/** The request's method, one of `"GET"` (the default), `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`. */
	method?: string = "GET";
	/** The text sent with the request, such as JSON for a POST; empty by default. */
	body?: string = "";
	/** The request's headers, as pairs: `[["Content-Type", "application/json"]]`. */
	headers?: string[][] = [];
	/**
	 * A signal that cancels the request; the promise then rejects with an
	 * Error named `"AbortError"`. In an async command handler or player event,
	 * the player leaving cancels the request too.
	 */
	signal?: AbortSignal | null = null;
}

/** The server's response to a request. */
export class Response {
	constructor(
		/** The response's HTTP status: `200`, `404`, ... */
		public status: number,
		/** The response's body, as text. */
		public text: string
	) {}

	/** `true` for a 2xx status. */
	get ok() {
		return this.status >= 200 && this.status < 300;
	}
}

/**
 * Sends a request. The promise is fulfilled with the response on a later
 * frame, and rejected when there is none - no connection, a bad URL, a
 * timeout, no `easy_http`, or an abort. An HTTP error such as `404` is a
 * response, as in fetch: check `response.ok`.
 *
 * Pawn: `ezhttp_get`, `ezhttp_post` (easy_http)
 */
export function fetch(url: string, init: RequestInit = {}): Promise<Response> {
	const promise = __co_promise<Response>();

	if (LibraryExists("easy_http", LibType_Library) == 0) {
		console.error(`fetch(${url}): the easy_http module is not loaded - add it to modules.ini`);
		__co_reject(promise, new Error("easy_http is not loaded"));
		return promise;
	}

	const request = new Request(promise);
	const guard = new __AbortGuard(request, init.signal as AbortSignal | null);
	request.guard = guard;
	const aborted = guard.aborted;
	if (aborted) {
		guard.release();
		__co_reject(promise, aborted);
		return promise;
	}

	let options = 0;
	// An optional field reads as `T | undefined`, though a field the literal
	// leaves out holds its default: `||` makes the type plain.
	const body = init.body || "";
	const headers = init.headers || [];

	if (body.length > 0 || headers.length > 0) {
		options = ezhttp_create_options();
		if (body.length > 0) ezhttp_option_set_body(options, body);
		for (const pair of headers) ezhttp_option_set_header(options, pair[0], pair[1]);
	}

	const callback = completeName();
	if (callback.length == 0) {
		guard.release();
		__co_reject(promise, new Error("no callback slot left"));
		return promise;
	}

	const method = init.method || "GET";
	let id = 0;

	if (method == "GET") id = ezhttp_get(url, callback, options);
	else if (method == "POST") id = ezhttp_post(url, callback, options);
	else if (method == "PUT") id = ezhttp_put(url, callback, options);
	else if (method == "PATCH") id = ezhttp_patch(url, callback, options);
	else if (method == "DELETE") id = ezhttp_delete(url, callback, options);
	else {
		guard.release();
		__co_reject(promise, new Error(`easy_http has no ${method}`));
		return promise;
	}

	request.id = id;
	pending.set(id, request);
	return promise;
}

/** A request under way, and what cancels it when a signal aborts. */
class Request extends __AbortWatch {
	id = 0;
	guard: __AbortGuard | null = null;

	constructor(public promise: Promise<Response>) {
		super();
	}

	run(reason: Error): void {
		if (!pending.has(this.id)) return;
		pending.delete(this.id);
		ezhttp_cancel_request(this.id);
		this.settled();
		__co_reject(this.promise, reason);
	}

	settled(): void {
		const guard = this.guard;
		if (guard) guard.release();
	}
}

const pending = new Map<number, Request>();

// Must match SLOT_REUSED in runtime/src/module.cpp, and SHAPE_WIDE the facade's.
const REUSED = 0x10000;
const SHAPE_WIDE = 1;

// @ts-ignore: decorator
@external("env", "ezhttp_get_data") declare function _getData(request: i32, buffer: i32, length: i32): i32;
// @ts-ignore: decorator
@external("env", "slot") declare function _slot(fn: i32, shape: i32, key: string, fallback: i32): i32;

/**
 * The host public that calls onComplete. Not publicFor: that one answers ""
 * after a hot reload so a registration is not made twice, and every request
 * names its callback afresh, so the name is needed every time.
 */
function completeName() {
	const handler: WideHandler = onComplete;
	const slot = _slot(handler.index, SHAPE_WIDE, "ezhttp:complete", 0);
	if (slot < 0) return "";
	return `__amxts_cb${slot & (REUSED - 1)}`;
}

// easy_http calls on_complete(request_id) once, on the frame the answer came in.
function onComplete(id: number, b: number, c: number, d: number) {
	if (!pending.has(id)) return;
	const request = pending.get(id);
	pending.delete(id);
	request.settled();

	if (ezhttp_get_error_code(id) != 0) {
		__co_reject(request.promise, new Error(ezhttp_get_error_message(id)));
		return;
	}

	// The whole body, however long: the generated ezhttp_get_data stops at 255.
	const size = ezhttp_get_downloaded_bytes(id) + 1;
	const cells = new CellBuffer(size);
	_getData(<i32>id, <i32>cells.address, <i32>size - 1);
	__co_resolve(request.promise, new Response(ezhttp_get_http_code(id), cells.text()));
}
