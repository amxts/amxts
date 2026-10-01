// fetch, URL and useFetch: HTTP the browser's way, over the module's network
// client - libcurl on a worker thread of the module, so a request never holds
// the game up. The module hands each ended request back on a server frame
// (runtime/src/network.h), where __fetchDone settles its promise.
//
//   const { data, error } = await useFetch<Weather>("https://example.com/weather", { query: { city } });
//   const response = await fetch("https://example.com/", { method: "POST", body: "hi" });
//
// The facade exports all of it, so a plugin uses these names without an
// import, as globals.
//
// AssemblyScript has no unions of classes, so where the browser takes one of
// several kinds the hood picks by the type at compile time (`fetch(input)`:
// a string, a URL or a Request) or takes the one an author writes most
// (`headers` as an object of names and values, a body as text).

import "./promise";

// @ts-ignore: decorator
@external("env", "net_open") declare function _open(url: string): i32;
// @ts-ignore: decorator
@external("env", "net_option") declare function _option(id: i32, name: string, value: string): i32;
// @ts-ignore: decorator
@external("env", "net_body") declare function _body(id: i32, data: usize, length: i32): void;
// @ts-ignore: decorator
@external("env", "net_send") declare function _send(id: i32, fn: i32): i32;
// @ts-ignore: decorator
@external("env", "net_cancel") declare function _cancel(id: i32): void;
// @ts-ignore: decorator
@external("env", "net_close") declare function _close(id: i32): void;
// @ts-ignore: decorator
@external("env", "net_status") declare function _status(id: i32): i32;
// @ts-ignore: decorator
@external("env", "net_redirects") declare function _redirects(id: i32): i32;
// @ts-ignore: decorator
@external("env", "net_text") declare function _text(id: i32, what: i32, out: usize, max: i32): i32;
// @ts-ignore: decorator
@external("env", "net_size") declare function _size(id: i32): i32;
// @ts-ignore: decorator
@external("env", "net_read") declare function _read(id: i32, out: usize, max: i32): i32;

// What net_text reads. Must match NET_TEXT_* in runtime/src/network.h.
const TEXT_ERROR: i32 = 0;
const TEXT_STATUS: i32 = 1;
const TEXT_URL: i32 = 2;
const TEXT_HEADERS: i32 = 3;

// ---------------------------------------------------------------- URL

/** The schemes whose URLs have a host and a path of segments, with their default ports. */
function defaultPort(scheme: string): string {
	if (scheme == "http:" || scheme == "ws:") return "80";
	if (scheme == "https:" || scheme == "wss:") return "443";
	if (scheme == "ftp:") return "21";
	return "";
}

function isSpecial(scheme: string): bool {
	return scheme == "http:" || scheme == "https:" || scheme == "ws:" || scheme == "wss:" || scheme == "ftp:" || scheme == "file:";
}

function isAlpha(c: i32): bool {
	return (c >= 0x61 && c <= 0x7A) || (c >= 0x41 && c <= 0x5A);
}

function isDigit(c: i32): bool {
	return c >= 0x30 && c <= 0x39;
}

const HEX = "0123456789ABCDEF";

/**
 * Percent-encodes the bytes of `text` that `keep` does not let through as
 * they are; a `%` already followed by two hex digits stays.
 */
function encodeSet(text: string, keep: (c: i32) => bool): string {
	const bytes = Uint8Array.wrap(String.UTF8.encode(text));
	let out = "";
	for (let i: i32 = 0; i < bytes.length; i++) {
		const c = <i32>bytes[i];
		if (c < 0x80 && keep(c)) out += String.fromCharCode(c);
		else out += "%" + HEX.charAt(c >> 4) + HEX.charAt(c & 15);
	}
	return out;
}

// What a path, a query and a fragment keep: the URL standard's encode sets.
function keepPath(c: i32): bool {
	return c > 0x20 && c != 0x22 && c != 0x23 && c != 0x3C && c != 0x3E && c != 0x3F && c != 0x60 && c != 0x7B && c != 0x7D && c < 0x7F;
}

function keepQuery(c: i32): bool {
	return c > 0x20 && c != 0x22 && c != 0x23 && c != 0x3C && c != 0x3E && c < 0x7F;
}

function keepFragment(c: i32): bool {
	return c > 0x20 && c != 0x22 && c != 0x3C && c != 0x3E && c != 0x60 && c < 0x7F;
}

function keepUserinfo(c: i32): bool {
	return keepPath(c) && c != 0x2F && c != 0x3A && c != 0x3B && c != 0x3D && c != 0x40 && c != 0x5B && c != 0x5C && c != 0x5D && c != 0x5E && c != 0x7C;
}

// application/x-www-form-urlencoded: letters, digits and *-._ as they are.
function keepForm(c: i32): bool {
	return isAlpha(c) || isDigit(c) || c == 0x2A || c == 0x2D || c == 0x2E || c == 0x5F;
}

function hexValue(c: i32): i32 {
	if (isDigit(c)) return c - 0x30;
	if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
	if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
	return -1;
}

/** Text with its `%XX` turned back into bytes - and `+` into a space, in a form. A stray `%` stays. */
function decodeText(text: string, form: bool): string {
	const bytes = Uint8Array.wrap(String.UTF8.encode(text));
	const out = new Uint8Array(bytes.length);
	let n: i32 = 0;
	for (let i: i32 = 0; i < bytes.length; i++) {
		const c = <i32>bytes[i];
		if (c == 0x25 && i + 2 < bytes.length && hexValue(bytes[i + 1]) >= 0 && hexValue(bytes[i + 2]) >= 0) {
			out[n++] = <u8>(hexValue(bytes[i + 1]) * 16 + hexValue(bytes[i + 2]));
			i += 2;
		}
		else out[n++] = form && c == 0x2B ? 0x20 : <u8>c;
	}
	return String.UTF8.decodeUnsafe(out.dataStart, <usize>n);
}

/** `/a/./b/../c` as `/a/c`: the dots of a special URL's path resolved. */
function normalizePath(path: string): string {
	const segments = path.split("/");
	const out: string[] = [];
	for (let i: i32 = 1; i < segments.length; i++) {
		const segment = segments[i];
		const last = i == segments.length - 1;
		if (segment == "..") {
			if (out.length > 0) out.pop();
			if (last) out.push("");
		}
		else if (segment == ".") {
			if (last) out.push("");
		}
		else out.push(segment);
	}
	return "/" + out.join("/");
}

/** A URL's parts, as URL keeps them. */
class __UrlParts {
	protocol: string = "";
	username: string = "";
	password: string = "";
	hostname: string = "";
	port: string = "";
	pathname: string = "";
	search: string = "";
	hash: string = "";
}

/** The scheme at the start of `input` with its colon (`"https:"`), or `""` when there is none. */
function schemeOf(input: string): string {
	const colon = input.indexOf(":");
	if (colon <= 0 || !isAlpha(input.charCodeAt(0))) return "";
	for (let i: i32 = 1; i < colon; i++) {
		const c = input.charCodeAt(i);
		if (!isAlpha(c) && !isDigit(c) && c != 0x2B && c != 0x2D && c != 0x2E) return "";
	}
	return input.substring(0, colon + 1).toLowerCase();
}

/** An absolute URL taken apart, or null when it is not one. */
function parseAbsolute(input: string): __UrlParts | null {
	const scheme = schemeOf(input);
	if (scheme.length == 0) return null;
	const parts = new __UrlParts();
	parts.protocol = scheme;
	let rest = input.substring(scheme.length);

	let hashAt = rest.indexOf("#");
	if (hashAt >= 0) {
		parts.hash = "#" + encodeSet(rest.substring(hashAt + 1), keepFragment);
		rest = rest.substring(0, hashAt);
	}
	if (parts.hash == "#") parts.hash = "";

	const special = isSpecial(scheme);
	if (special) rest = rest.replaceAll("\\", "/");

	const queryAt = rest.indexOf("?");
	if (queryAt >= 0) {
		parts.search = "?" + encodeSet(rest.substring(queryAt + 1), keepQuery);
		rest = rest.substring(0, queryAt);
	}
	if (parts.search == "?") parts.search = "";

	if (!rest.startsWith("//")) {
		// mailto:, data: and their kind: a path and nothing more.
		if (special) return null;
		parts.pathname = encodeSet(rest, keepQuery);
		return parts;
	}

	rest = rest.substring(2);
	let slash = rest.indexOf("/");
	if (slash < 0) slash = rest.length;
	let authority = rest.substring(0, slash);
	const path = rest.substring(slash);

	const at = authority.lastIndexOf("@");
	if (at >= 0) {
		const userinfo = authority.substring(0, at);
		authority = authority.substring(at + 1);
		const colon = userinfo.indexOf(":");
		parts.username = encodeSet(colon >= 0 ? userinfo.substring(0, colon) : userinfo, keepUserinfo);
		parts.password = colon >= 0 ? encodeSet(userinfo.substring(colon + 1), keepUserinfo) : "";
	}

	let host = authority;
	let port = "";
	const close = authority.lastIndexOf("]");
	const colon = authority.lastIndexOf(":");
	if (colon > close) {
		host = authority.substring(0, colon);
		port = authority.substring(colon + 1);
	}
	for (let i: i32 = 0; i < port.length; i++) {
		if (!isDigit(port.charCodeAt(i))) return null;
	}
	if (port.length > 0) {
		const value = <i32>parseInt(port);
		if (value > 65535) return null;
		port = value.toString();
	}
	if (port == defaultPort(scheme)) port = "";

	host = decodeText(host, false).toLowerCase();
	for (let i: i32 = 0; i < host.length; i++) {
		const c = host.charCodeAt(i);
		if (c <= 0x20 || c == 0x23 || c == 0x25 || c == 0x2F || c == 0x3C || c == 0x3E || c == 0x3F || c == 0x40 || c == 0x5C || c == 0x5E || c == 0x7C) return null;
	}
	if (special && scheme != "file:" && host.length == 0) return null;
	parts.hostname = host;
	parts.port = port;

	const encoded = encodeSet(path, keepPath);
	parts.pathname = special ? normalizePath(encoded.length > 0 ? encoded : "/") : encoded;
	return parts;
}

/** `input` resolved against `base`, as an absolute URL's text. */
function resolveAgainst(input: string, base: URL): string {
	if (input.startsWith("//")) return base.protocol + input;
	if (input.startsWith("/")) return base.protocol + "//" + base.__authority() + input;
	if (input.startsWith("?")) return base.protocol + "//" + base.__authority() + base.pathname + input;
	if (input.startsWith("#")) return base.protocol + "//" + base.__authority() + base.pathname + base.search + input;
	if (input.length == 0) return base.protocol + "//" + base.__authority() + base.pathname + base.search;
	const path = base.pathname;
	return base.protocol + "//" + base.__authority() + path.substring(0, path.lastIndexOf("/") + 1) + input;
}

function parseUrl(input: string, base: string | null): __UrlParts | null {
	const text = input.trim();
	if (schemeOf(text).length > 0 || base === null) return parseAbsolute(text);
	const parsedBase = parseAbsolute((base as string).trim());
	if (!parsedBase) return null;
	return parseAbsolute(resolveAgainst(text, URL.__of(parsedBase as __UrlParts)));
}

/**
 * A web address taken apart: its protocol, host, path and query.
 *
 * ```ts
 * const url = new URL("https://example.com/api/stats?id=7");
 * url.searchParams.set("map", server.map);
 * const response = await fetch(url);
 * ```
 */
export class URL {
	private __parts: __UrlParts;
	private __params: URLSearchParams | null = null;

	/** Parses `url`, relative to `base` when it is given; throws a TypeError when it is not a URL. */
	constructor(url: string, base: string | null = null) {
		this.__parts = new __UrlParts();
		const parts = parseUrl(url, base);
		if (!parts) throw new TypeError(`Invalid URL: ${url}`);
		this.__parts = parts;
	}

	/** `true` when `url`, relative to `base` when given, is a URL `new URL` would take. */
	static canParse(url: string, base: string | null = null): bool {
		return parseUrl(url, base) !== null;
	}

	/** The URL, or `null` when `url` is not one - `new URL` without the throw. */
	static parse(url: string, base: string | null = null): URL | null {
		const parts = parseUrl(url, base);
		return parts ? URL.__of(parts) : null;
	}

	/** @hidden */
	static __of(parts: __UrlParts): URL {
		const url = new URL("about:blank");
		url.__parts = parts;
		return url;
	}

	/** The whole URL as text, e.g. `"https://example.com/api?id=7"`. */
	get href(): string {
		const parts = this.__parts;
		const host = isSpecial(parts.protocol) || parts.hostname.length > 0 ? "//" + this.__authority() : "";
		return parts.protocol + host + parts.pathname + parts.search + parts.hash;
	}

	set href(value: string) {
		const parts = parseUrl(value, null);
		if (!parts) throw new TypeError(`Invalid URL: ${value}`);
		this.__parts = parts;
		this.__syncParams();
	}

	/** The scheme with its colon, e.g. `"https:"`. */
	get protocol(): string {
		return this.__parts.protocol;
	}

	/** The user name before the host, e.g. `"admin"` in `ftp://admin:secret@example.com`; `""` when there is none. */
	get username(): string {
		return this.__parts.username;
	}

	/** The password before the host; `""` when there is none. */
	get password(): string {
		return this.__parts.password;
	}

	/** The host with its port when the URL names one, e.g. `"example.com:8080"`. */
	get host(): string {
		const parts = this.__parts;
		return parts.port.length > 0 ? parts.hostname + ":" + parts.port : parts.hostname;
	}

	/** The host without the port, e.g. `"example.com"`. */
	get hostname(): string {
		return this.__parts.hostname;
	}

	/** The port as text, e.g. `"8080"`; `""` for the protocol's default one. */
	get port(): string {
		return this.__parts.port;
	}

	/** The path, e.g. `"/api/stats"`. */
	get pathname(): string {
		return this.__parts.pathname;
	}

	set pathname(value: string) {
		const path = encodeSet(value.startsWith("/") ? value : "/" + value, keepPath);
		this.__parts.pathname = isSpecial(this.__parts.protocol) ? normalizePath(path) : path;
	}

	/** The query with its `?`, e.g. `"?id=7"`; `""` when there is none. */
	get search(): string {
		return this.__parts.search;
	}

	set search(value: string) {
		const query = value.startsWith("?") ? value.substring(1) : value;
		this.__parts.search = query.length > 0 ? "?" + encodeSet(query, keepQuery) : "";
		this.__syncParams();
	}

	/** The fragment with its `#`, e.g. `"#top"`; `""` when there is none. */
	get hash(): string {
		return this.__parts.hash;
	}

	set hash(value: string) {
		const fragment = value.startsWith("#") ? value.substring(1) : value;
		this.__parts.hash = fragment.length > 0 ? "#" + encodeSet(fragment, keepFragment) : "";
	}

	/** The scheme, host and port, e.g. `"https://example.com"`; `"null"` for a URL without a host. */
	get origin(): string {
		const parts = this.__parts;
		return isSpecial(parts.protocol) && parts.protocol != "file:" ? parts.protocol + "//" + this.host : "null";
	}

	/** The query as names and values; a change to them changes the URL. */
	get searchParams(): URLSearchParams {
		let params = this.__params;
		if (!params) {
			params = new URLSearchParams();
			params.__read(this.__parts.search);
			params.__url = this;
			this.__params = params;
		}
		return params;
	}

	/** The whole URL as text, as `href`. */
	toString(): string {
		return this.href;
	}

	/** The whole URL as text: what `JSON.stringify` writes for it. */
	toJSON(): string {
		return this.href;
	}

	/** @hidden the user, password and host, as they stand between `//` and the path. */
	__authority(): string {
		const parts = this.__parts;
		const user = parts.username.length > 0 || parts.password.length > 0
			? parts.username + (parts.password.length > 0 ? ":" + parts.password : "") + "@"
			: "";
		return user + this.host;
	}

	/** @hidden the query, written back by its URLSearchParams. */
	__setQuery(query: string): void {
		this.__parts.search = query.length > 0 ? "?" + query : "";
	}

	private __syncParams(): void {
		const params = this.__params;
		if (params) params.__read(this.__parts.search);
	}
}

/**
 * A query's names and values, such as `id=7&map=de_dust2`.
 *
 * ```ts
 * const query = new URLSearchParams({ id: "7", map: server.map });
 * const response = await fetch(`https://example.com/api?${query}`);
 * ```
 */
export class URLSearchParams {
	private __names: string[] = [];
	private __values: string[] = [];
	/** @hidden the URL whose query this is. */
	__url: URL | null = null;

	/** The names and values of `init`, in its order. */
	constructor(init: Record<string, string> = {}) {
		const names = Object.keys(init);
		for (let i: i32 = 0; i < names.length; i++) {
			this.__names.push(names[i]);
			this.__values.push(init[names[i]] as string);
		}
	}

	/** The number of name and value pairs, a name given twice counted twice. */
	get size(): number {
		return this.__names.length;
	}

	/** Adds a pair; a name already there keeps its value too. */
	append(name: string, value: string): void {
		this.__names.push(name);
		this.__values.push(value);
		this.__update();
	}

	/** Removes every pair of `name`. */
	delete(name: string): void {
		for (let i: i32 = this.__names.length - 1; i >= 0; i--) {
			if (this.__names[i] == name) {
				this.__names.splice(i, 1);
				this.__values.splice(i, 1);
			}
		}
		this.__update();
	}

	/** The first value of `name`, or `null` when there is none. */
	get(name: string): string | null {
		const at = this.__names.indexOf(name);
		return at >= 0 ? this.__values[at] : null;
	}

	/** Every value of `name`, in order. */
	getAll(name: string): string[] {
		const values: string[] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) {
			if (this.__names[i] == name) values.push(this.__values[i]);
		}
		return values;
	}

	/** `true` when there is a pair of `name`. */
	has(name: string): bool {
		return this.__names.includes(name);
	}

	/** Sets `name` to `value`: the first pair takes it, the other pairs of the name go. */
	set(name: string, value: string): void {
		const at = this.__names.indexOf(name);
		if (at < 0) {
			this.append(name, value);
			return;
		}
		this.__values[at] = value;
		for (let i: i32 = this.__names.length - 1; i > at; i--) {
			if (this.__names[i] == name) {
				this.__names.splice(i, 1);
				this.__values.splice(i, 1);
			}
		}
		this.__update();
	}

	/** Orders the pairs by name; pairs of one name keep their order. */
	sort(): void {
		const order: i32[] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) order.push(i);
		const names = this.__names;
		order.sort((a: i32, b: i32): i32 => (names[a] < names[b] ? -1 : names[a] > names[b] ? 1 : a - b));
		this.__names = order.map<string>((i: i32): string => names[i]);
		const values = this.__values;
		this.__values = order.map<string>((i: i32): string => values[i]);
		this.__update();
	}

	/** Calls `callback` with each value and its name, in order. */
	forEach(callback: (value: string, name: string) => void): void {
		for (let i: i32 = 0; i < this.__names.length; i++) callback(this.__values[i], this.__names[i]);
	}

	/** Every name, in order; a name given twice is there twice. */
	keys(): string[] {
		return this.__names.slice(0);
	}

	/** Every value, in order. */
	values(): string[] {
		return this.__values.slice(0);
	}

	/** Every pair as `[name, value]`, in order. */
	entries(): string[][] {
		const pairs: string[][] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) pairs.push([this.__names[i], this.__values[i]]);
		return pairs;
	}

	/** The query as text, without the `?`: `id=7&map=de_dust2`. */
	toString(): string {
		const pairs: string[] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) {
			pairs.push(encodeForm(this.__names[i]) + "=" + encodeForm(this.__values[i]));
		}
		return pairs.join("&");
	}

	/** @hidden takes the pairs of a query, `?` or not. */
	__read(query: string): void {
		this.__names = [];
		this.__values = [];
		const text = query.startsWith("?") ? query.substring(1) : query;
		if (text.length == 0) return;
		const pairs = text.split("&");
		for (let i: i32 = 0; i < pairs.length; i++) {
			const pair = pairs[i];
			if (pair.length == 0) continue;
			const equals = pair.indexOf("=");
			this.__names.push(decodeText(equals >= 0 ? pair.substring(0, equals) : pair, true));
			this.__values.push(equals >= 0 ? decodeText(pair.substring(equals + 1), true) : "");
		}
	}

	private __update(): void {
		const url = this.__url;
		if (url) url.__setQuery(this.toString());
	}
}

function encodeForm(text: string): string {
	return encodeSet(text, keepForm).replaceAll("%20", "+");
}

// ---------------------------------------------------------------- Headers

/**
 * A request's or a response's HTTP headers. Names are matched without
 * regard to case.
 *
 * ```ts
 * const type = response.headers.get("content-type");
 * ```
 */
export class Headers {
	private __names: string[] = [];
	private __values: string[] = [];

	/** The headers of `init`: an object of names and values. */
	constructor(init: Record<string, string> = {}) {
		const names = Object.keys(init);
		for (let i: i32 = 0; i < names.length; i++) this.append(names[i], init[names[i]] as string);
	}

	/** Adds a value to `name`; one already there stays, and `get` joins them. */
	append(name: string, value: string): void {
		this.__names.push(name.toLowerCase());
		this.__values.push(value.trim());
	}

	/** Removes `name` and all its values. */
	delete(name: string): void {
		const key = name.toLowerCase();
		for (let i: i32 = this.__names.length - 1; i >= 0; i--) {
			if (this.__names[i] == key) {
				this.__names.splice(i, 1);
				this.__values.splice(i, 1);
			}
		}
	}

	/** The value of `name` - its values joined with `", "` when it has several - or `null` when there is none. */
	get(name: string): string | null {
		const key = name.toLowerCase();
		const values: string[] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) {
			if (this.__names[i] == key) values.push(this.__values[i]);
		}
		return values.length > 0 ? values.join(", ") : null;
	}

	/** Every `Set-Cookie` header of a response, each its own text. */
	getSetCookie(): string[] {
		const cookies: string[] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) {
			if (this.__names[i] == "set-cookie") cookies.push(this.__values[i]);
		}
		return cookies;
	}

	/** `true` when there is a header of `name`. */
	has(name: string): bool {
		return this.__names.includes(name.toLowerCase());
	}

	/** Sets `name` to `value`, in place of every value it had. */
	set(name: string, value: string): void {
		this.delete(name);
		this.append(name, value);
	}

	/** Calls `callback` with each header's value and its name in lower case, ordered by name. */
	forEach(callback: (value: string, name: string) => void): void {
		const pairs = this.entries();
		for (let i: i32 = 0; i < pairs.length; i++) callback(pairs[i][1], pairs[i][0]);
	}

	/** Every header's name in lower case, ordered by name. */
	keys(): string[] {
		return this.entries().map<string>((pair: string[]): string => pair[0]);
	}

	/** Every header's value, ordered by name. */
	values(): string[] {
		return this.entries().map<string>((pair: string[]): string => pair[1]);
	}

	/** Every header as `[name, value]`, ordered by name; the values of a name joined, but each `set-cookie` on its own. */
	entries(): string[][] {
		const names: string[] = [];
		for (let i: i32 = 0; i < this.__names.length; i++) {
			if (!names.includes(this.__names[i])) names.push(this.__names[i]);
		}
		names.sort();
		const pairs: string[][] = [];
		for (let i: i32 = 0; i < names.length; i++) {
			if (names[i] == "set-cookie") {
				const cookies = this.getSetCookie();
				for (let c: i32 = 0; c < cookies.length; c++) pairs.push(["set-cookie", cookies[c]]);
			}
			else pairs.push([names[i], this.get(names[i]) as string]);
		}
		return pairs;
	}

	/** @hidden a copy. */
	__copy(): Headers {
		const copy = new Headers();
		copy.__names = this.__names.slice(0);
		copy.__values = this.__values.slice(0);
		return copy;
	}

	/** @hidden the header lines of a response, `name: value` each. */
	static __parse(lines: string): Headers {
		const headers = new Headers();
		const each = lines.split("\n");
		for (let i: i32 = 0; i < each.length; i++) {
			const line = each[i];
			const colon = line.indexOf(":");
			if (colon > 0) headers.append(line.substring(0, colon).trim(), line.substring(colon + 1));
		}
		return headers;
	}
}

// ---------------------------------------------------------------- Request and Response

/** The check of a server's certificate, for HTTPS. */
export interface TlsOptions {
	/**
	 * The certificate authorities a server's certificate must come from, as
	 * PEM text - for a server with a certificate of its own making. Left out,
	 * the authorities a browser trusts.
	 */
	ca?: string;
}

/** A request's options: `fetch`'s second argument. Every field is optional. */
export interface RequestInit {
	/** The request's method, e.g. `"POST"`; `"GET"` by default. */
	method?: string;
	/** The request's headers, as an object of names and values: `{ Authorization: "Bearer abc" }`. */
	headers?: Record<string, string>;
	/** The text sent with the request, such as JSON. A GET or HEAD request has none. */
	body?: string;
	/**
	 * The request's answer to a redirect: one of `"follow"` (the default) - on
	 * to its address, `"manual"` - the redirect itself as the response, `"error"` - a rejection.
	 */
	redirect?: "follow" | "manual" | "error";
	/** A signal that cancels the request; the promise then rejects with the signal's reason. */
	signal?: AbortSignal | null;
	/** A proxy the request goes through, e.g. `"http://proxy.example.com:3128"`. */
	proxy?: string;
	/** The check of the server's certificate, for HTTPS. */
	tls?: TlsOptions;
}

/**
 * A request: its address, method, headers and body - what `fetch` sends.
 *
 * ```ts
 * const request = new Request("https://example.com/api", { method: "POST", body: "hi" });
 * const response = await fetch(request);
 * ```
 */
export class Request {
	private __url: string;
	private __method: string;
	private __headers: Headers;
	private __body: string | null;
	private __redirect: string;
	private __signal: AbortSignal;
	private __proxy: string;
	private __ca: string;

	/** A request to `url` with the options of `init`. */
	constructor(url: string, init: RequestInit = {}) {
		this.__url = url;
		this.__method = methodName(init.method ?? "GET");
		this.__headers = new Headers(init.headers ?? {});
		const body = init.body;
		this.__body = body !== undefined ? body : null;
		this.__redirect = init.redirect ?? "follow";
		const signal = init.signal;
		this.__signal = signal ? signal : new AbortSignal();
		this.__proxy = init.proxy ?? "";
		const tls = init.tls;
		this.__ca = tls ? tls.ca ?? "" : "";
	}

	/** The address the request goes to. */
	get url(): string {
		return this.__url;
	}

	/** The request's method, e.g. `"GET"`. */
	get method(): string {
		return this.__method;
	}

	/** The request's headers. */
	get headers(): Headers {
		return this.__headers;
	}

	/** The request's answer to a redirect: one of `"follow"`, `"manual"` or `"error"`. */
	get redirect(): string {
		return this.__redirect;
	}

	/** The signal that cancels the request. */
	get signal(): AbortSignal {
		return this.__signal;
	}

	/** A copy of the request, to send again. */
	clone(): Request {
		return this.__with({});
	}

	/** @hidden the request with what `init` gives in place of its own. */
	__with(init: RequestInit): Request {
		const copy = new Request(this.__url);
		copy.__method = init.method !== undefined ? methodName(init.method as string) : this.__method;
		copy.__headers = init.headers !== undefined ? new Headers(init.headers as Record<string, string>) : this.__headers.__copy();
		copy.__body = init.body !== undefined ? init.body as string : this.__body;
		copy.__redirect = init.redirect ?? this.__redirect;
		const signal = init.signal;
		copy.__signal = signal ? signal : this.__signal;
		copy.__proxy = init.proxy ?? this.__proxy;
		const tls = init.tls;
		copy.__ca = tls ? tls.ca ?? "" : this.__ca;
		return copy;
	}

	/** @hidden */
	__bodyText(): string | null {
		return this.__body;
	}

	/** @hidden */
	__proxyUrl(): string {
		return this.__proxy;
	}

	/** @hidden */
	__authorities(): string {
		return this.__ca;
	}
}

/** The standard methods in capitals, as fetch writes them; any other as given. */
function methodName(method: string): string {
	const upper = method.toUpperCase();
	return upper == "DELETE" || upper == "GET" || upper == "HEAD" || upper == "OPTIONS" || upper == "POST" || upper == "PUT" || upper == "PATCH" ? upper : method;
}

/** A response's options: `new Response`'s second argument. */
export interface ResponseInit {
	/** The response's status; `200` by default. */
	status?: number;
	/** The words after the status, e.g. `"Not Found"`; `""` by default. */
	statusText?: string;
	/** The response's headers, as an object of names and values. */
	headers?: Record<string, string>;
}

/**
 * The server's answer to a request: its status, headers and body.
 *
 * ```ts
 * const response = await fetch("https://example.com/api/stats");
 * if (!response.ok) return console.log(`HTTP ${response.status}`);
 * const stats = await response.json<Stats>();
 * ```
 */
export class Response {
	private __status: number;
	private __statusText: string;
	private __headers: Headers;
	private __body: ArrayBuffer;
	private __url: string = "";
	private __redirected: bool = false;
	private __used: bool = false;

	/** A response whose body is `body`, with the status and headers of `init` - for a test, say. */
	constructor(body: string | null = null, init: ResponseInit = {}) {
		this.__status = init.status ?? 200;
		this.__statusText = init.statusText ?? "";
		this.__headers = new Headers(init.headers ?? {});
		this.__body = body !== null ? String.UTF8.encode(body as string) : new ArrayBuffer(0);
		if (body !== null && !this.__headers.has("content-type")) this.__headers.set("content-type", "text/plain;charset=UTF-8");
	}

	/** The response's HTTP status, e.g. `200` or `404`. */
	get status(): number {
		return this.__status;
	}

	/** The words after the status, e.g. `"Not Found"`; `""` when the server sent none. */
	get statusText(): string {
		return this.__statusText;
	}

	/** `true` for a status from `200` to `299`. */
	get ok(): bool {
		return this.__status >= 200 && this.__status <= 299;
	}

	/** The response's headers. */
	get headers(): Headers {
		return this.__headers;
	}

	/** The address the response came from, after any redirects. */
	get url(): string {
		return this.__url;
	}

	/** `true` when the request was redirected on the way. */
	get redirected(): bool {
		return this.__redirected;
	}

	/** `true` once the body has been read: it can be read once. */
	get bodyUsed(): bool {
		return this.__used;
	}

	/** The body as text, decoded as UTF-8. */
	text(): Promise<string> {
		const promise = __co_promise<string>();
		const used = this.__take();
		if (used) __co_reject(promise, used);
		else __co_resolve(promise, String.UTF8.decode(this.__body));
		return promise;
	}

	/**
	 * The body read as JSON into `T`, an interface of the fields the JSON
	 * has; rejects with a SyntaxError when it is not JSON.
	 *
	 * ```ts
	 * interface Stats {
	 *   kills: number;
	 * }
	 * const stats = await response.json<Stats>();
	 * ```
	 */
	json<T>(): Promise<T> {
		const promise = __co_promise<T>();
		const used = this.__take();
		if (used) {
			__co_reject(promise, used);
			return promise;
		}
		try {
			__co_resolve<T>(promise, JSON.parse<T>(String.UTF8.decode(this.__body)));
		}
		catch (error) {
			__co_reject(promise, error as Error);
		}
		return promise;
	}

	/** The body as bytes. */
	arrayBuffer(): Promise<ArrayBuffer> {
		const promise = __co_promise<ArrayBuffer>();
		const used = this.__take();
		if (used) __co_reject(promise, used);
		else __co_resolve(promise, this.__body);
		return promise;
	}

	/** A copy of the response, whose body can be read apart from this one's. */
	clone(): Response {
		const copy = new Response();
		copy.__status = this.__status;
		copy.__statusText = this.__statusText;
		copy.__headers = this.__headers.__copy();
		copy.__body = this.__body.slice(0);
		copy.__url = this.__url;
		copy.__redirected = this.__redirected;
		copy.__used = this.__used;
		return copy;
	}

	/** @hidden what the network client handed back. */
	static __received(status: number, statusText: string, headers: Headers, body: ArrayBuffer, url: string, redirected: bool): Response {
		const response = new Response();
		response.__status = status;
		response.__statusText = statusText;
		response.__headers = headers;
		response.__body = body;
		response.__url = url;
		response.__redirected = redirected;
		return response;
	}

	/** The error of a second read, or null the first time. */
	private __take(): Error | null {
		if (this.__used) return new TypeError("Body is unusable: Body has already been read");
		this.__used = true;
		return null;
	}
}

// ---------------------------------------------------------------- fetch

/** A request under way: its promise, and what cancels it when a signal aborts. */
class __FetchTask extends __AbortWatch {
	id: i32 = 0;
	guard: __AbortGuard | null = null;

	constructor(public promise: Promise<Response>, public redirect: string) {
		super();
	}

	run(reason: Error): void {
		if (!__fetches.has(this.id)) return;
		__fetches.delete(this.id);
		_cancel(this.id);
		this.release();
		__co_reject(this.promise, reason);
	}

	release(): void {
		const guard = this.guard;
		if (guard) guard.release();
	}
}

// @ts-ignore: decorator
@lazy const __fetches = new Map<i32, __FetchTask>();

/**
 * Sends a request and gives its response, as the browser's `fetch` does.
 *
 * ```ts
 * const response = await fetch("https://example.com/api/stats");
 * const stats = await response.json<Stats>();
 * ```
 *
 * The promise is fulfilled once the response's headers and body have come,
 * on a later server frame: the game does not wait for it. A status such as
 * `404` is a response too - check `response.ok`. The promise rejects with a
 * TypeError when there is no response (no connection, a bad address) and
 * with the signal's reason when `init.signal` aborts. In an async command
 * handler or a player's event, the player leaving aborts it too.
 */
export function fetch(input: string, init?: RequestInit): Promise<Response>;
/** Sends a request to a URL made with `new URL`. */
export function fetch(input: URL, init?: RequestInit): Promise<Response>;
/** Sends a request made with `new Request`; what `init` gives takes the place of the request's own. */
export function fetch(input: Request, init?: RequestInit): Promise<Response>;
export function fetch<I>(input: I, init: RequestInit = {}): Promise<Response> {
	if (isString<I>()) return send(new Request(changetype<string>(input), init));
	if (idof<I>() == idof<URL>()) return send(new Request(changetype<URL>(input).href, init));
	return send(changetype<Request>(input).__with(init));
}

function rejected(reason: Error): Promise<Response> {
	const promise = __co_promise<Response>();
	__co_reject(promise, reason);
	return promise;
}

function send(request: Request): Promise<Response> {
	const url = URL.parse(request.url);
	if (!url) return rejected(new TypeError(`Failed to parse URL from ${request.url}`));
	if (url.protocol != "http:" && url.protocol != "https:") return rejected(new TypeError(`fetch failed: ${url.protocol} is not http: or https:`));
	const method = request.method;
	const body = request.__bodyText();
	if (body !== null && (method == "GET" || method == "HEAD")) return rejected(new TypeError("Request with GET/HEAD method cannot have body."));

	const promise = __co_promise<Response>();
	const task = new __FetchTask(promise, request.redirect);
	const guard = new __AbortGuard(task, request.signal);
	task.guard = guard;
	const aborted = guard.aborted;
	if (aborted) {
		guard.release();
		__co_reject(promise, aborted);
		return promise;
	}

	const id = _open(url.href);
	task.id = id;
	_option(id, "method", method);
	const headers = request.headers.entries();
	for (let i: i32 = 0; i < headers.length; i++) _option(id, "header", `${headers[i][0]}: ${headers[i][1]}`);
	if (body !== null) {
		if (!request.headers.has("content-type")) _option(id, "header", "content-type: text/plain;charset=UTF-8");
		const bytes = String.UTF8.encode(body as string);
		_body(id, changetype<usize>(bytes), bytes.byteLength);
	}
	_option(id, "follow", request.redirect == "follow" ? "1" : "0");
	const proxy = request.__proxyUrl();
	if (proxy.length > 0) _option(id, "proxy", proxy);
	const ca = request.__authorities();
	if (ca.length > 0) _option(id, "ca", ca);

	if (_send(id, __fetchDone.index) == 0) {
		_close(id);
		guard.release();
		__co_reject(promise, new TypeError("fetch failed: the server's network client did not start"));
		return promise;
	}
	__fetches.set(id, task);
	return promise;
}

/** A text of an ended request: its error, status words, address or headers. */
function netText(id: i32, what: i32): string {
	const length = _text(id, what, 0, 0);
	if (length <= 0) return "";
	const bytes = new ArrayBuffer(length);
	_text(id, what, changetype<usize>(bytes), length);
	return String.UTF8.decode(bytes);
}

/** The module calls this on the frame a request has ended. */
function __fetchDone(id: i32): void {
	if (!__fetches.has(id)) {
		_close(id);
		return;
	}
	const task = __fetches.get(id);
	__fetches.delete(id);
	task.release();

	const status = _status(id);
	if (status < 0) {
		const message = netText(id, TEXT_ERROR);
		_close(id);
		__co_reject(task.promise, new TypeError(`fetch failed: ${message}`));
		return;
	}

	const headers = Headers.__parse(netText(id, TEXT_HEADERS));
	if (task.redirect == "error" && status >= 300 && status <= 399 && headers.has("location")) {
		_close(id);
		__co_reject(task.promise, new TypeError("fetch failed: unexpected redirect"));
		return;
	}

	const size = _size(id);
	const body = new ArrayBuffer(size);
	if (size > 0) _read(id, changetype<usize>(body), size);
	const response = Response.__received(status, netText(id, TEXT_STATUS), headers, body, netText(id, TEXT_URL), _redirects(id) > 0);
	_close(id);
	__co_resolve(task.promise, response);
}

// ---------------------------------------------------------------- useFetch

/** `useFetch`'s options. Every field is optional. */
export interface UseFetchOptions<B = string> {
	/** The request's method, e.g. `"POST"`; `"GET"` by default. */
	method?: string;
	/** Names and values added to the URL's query: `{ page: "2" }` adds `?page=2`. */
	query?: Record<string, string>;
	/** The request's headers, as an object of names and values. */
	headers?: Record<string, string>;
	/**
	 * The request's body: text as it is, or an object of the type given second
	 * (`useFetch<Answer, Report>`) as JSON.
	 */
	body?: B;
	/** The number of further tries when a request fails on the way or the server answers `5xx`, `408` or `429`; `0` by default. */
	retry?: number;
	/** Milliseconds between two tries; `500` by default. */
	retryDelay?: number;
	/** Milliseconds a try may take before it is given up with a TimeoutError; no limit by default. */
	timeout?: number;
	/** A signal that cancels the request. */
	signal?: AbortSignal | null;
	/** A proxy the request goes through, e.g. `"http://proxy.example.com:3128"`. */
	proxy?: string;
	/** The check of the server's certificate, for HTTPS. */
	tls?: TlsOptions;
}

/** The answer of `useFetch`: the data or the error, and the status. */
export interface FetchResult<T> {
	/** The response's JSON read into `T`; `null` when there was an error or no body. */
	data: T | null;
	/** Why there is no data: a FetchError for a status that is not `2xx`, a TypeError for no response, the signal's reason for an abort, a SyntaxError for a body that is not JSON. */
	error: Error | null;
	/** The response's HTTP status; `0` when there was no response. */
	status: number;
}

/** A response whose status is not `2xx`, as `useFetch` reports it. */
export class FetchError extends Error {
	/** A response's error, e.g. `404 Not Found`. */
	constructor(
		/** The response's HTTP status, e.g. `404`. */
		public status: number,
		/** The words after the status, e.g. `"Not Found"`. */
		public statusText: string,
		/** The response's body as text: often what the server says went wrong. */
		public body: string
	) {
		super(`${status} ${statusText}`.trim());
		this.name = "FetchError";
	}
}

// The statuses worth a second try: the server was busy or failed for a moment.
function retryable(status: number): bool {
	return status == 408 || status == 409 || status == 425 || status == 429 || status == 500 || status == 502 || status == 503 || status == 504;
}

/** `url` with `query` added to its query. */
function withQuery(url: string, query: Record<string, string> | undefined): string {
	if (query === undefined || Object.keys(query as Record<string, string>).length == 0) return url;
	const text = new URLSearchParams(query as Record<string, string>).toString();
	const hash = url.indexOf("#");
	const head = hash >= 0 ? url.substring(0, hash) : url;
	const tail = hash >= 0 ? url.substring(hash) : "";
	return head + (head.includes("?") ? "&" : "?") + text + tail;
}

/**
 * Sends a request and reads its JSON into `T`, an interface of the fields
 * the JSON has. It never throws: what went wrong is `error`.
 *
 * ```ts
 * interface Weather {
 *   temperature: number;
 * }
 *
 * const { data, error } = await useFetch<Weather>("https://example.com/weather", { query: { city: "Paris" } });
 * if (error) return console.error(error.message);
 * print(player, `${data!.temperature} °C`);
 * ```
 *
 * A body that is an object goes as JSON: `useFetch<Answer, Report>(url, { method: "POST", body: report })`.
 */
export async function useFetch<T, B = string>(url: string, options: UseFetchOptions<B> = {}): Promise<FetchResult<T>> {
	const target = withQuery(url, options.query);
	const headers: Record<string, string> = {};
	const given = options.headers;
	if (given !== undefined) {
		const names = Object.keys(given as Record<string, string>);
		for (let i: i32 = 0; i < names.length; i++) headers[names[i]] = (given as Record<string, string>)[names[i]];
	}
	const lower = Object.keys(headers).map<string>((name: string): string => name.toLowerCase());
	if (!lower.includes("accept")) headers["accept"] = isString<T>() ? "*/*" : "application/json";

	let body: string | null = null;
	const value = options.body;
	if (value !== undefined) {
		if (isString<B>()) body = changetype<string>(value);
		else {
			body = JSON.stringify(value);
			if (!lower.includes("content-type")) headers["content-type"] = "application/json";
		}
	}

	const tries = <i32>(options.retry ?? 0) + 1;
	const delay = options.retryDelay ?? 500;
	const signal = options.signal ?? null;
	let error: Error | null = null;
	let status: number = 0;

	for (let attempt: i32 = 0; attempt < tries; attempt++) {
		if (attempt > 0) {
			try {
				await __co_sleep(delay, signal);
			}
			catch (aborted) {
				return { data: null, error: aborted as Error, status: 0 };
			}
		}

		const timeout = options.timeout;
		const limit = timeout !== undefined ? AbortSignal.timeout(timeout as number) : null;
		const both = limit && signal ? AbortSignal.any([limit, signal as AbortSignal]) : limit ? limit : signal;
		let text = "";
		try {
			const init: RequestInit = { method: options.method ?? "GET", headers, signal: both, proxy: options.proxy ?? "", tls: options.tls };
			if (body !== null) init.body = body as string;
			const response = await fetch(target, init);
			status = response.status;
			text = await response.text();
			if (!response.ok) {
				error = new FetchError(response.status, response.statusText, text);
				if (retryable(response.status)) continue;
				return { data: null, error, status };
			}
		}
		catch (failed) {
			error = failed as Error;
			status = 0;
			// An abort is the author's: no second try.
			if (error.name == "AbortError" || (signal && (signal as AbortSignal).aborted)) return { data: null, error, status };
			continue;
		}

		if (isString<T>()) return { data: changetype<T>(text), error: null, status };
		if (text.length == 0) return { data: null, error: null, status };
		try {
			return { data: JSON.parse<T>(text), error: null, status };
		}
		catch (invalid) {
			return { data: null, error: invalid as Error, status };
		}
	}
	return { data: null, error, status };
}
