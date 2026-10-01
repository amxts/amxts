// The module's network client (runtime/src/network.h) on the fake server:
// the net_* externals as/fetch.ts declares. HTTP and HTTPS are answered with
// Bun's own fetch; FTP and FTPS with basic-ftp, SFTP with ssh2-sftp-client,
// loaded the first time a test asks for one - so a module's test can start
// an FTP or SFTP server in its own process (ftp-srv, ssh2) and reach it the
// way the module's natives reach a real one: the same options, the same
// kinds of error, the same reply codes, a `file` read from or written to the
// fake game folder.
//
// A request goes out when the plugin sends it; what comes back waits until
// the test lets the server's frames run (`await server.responses()`), and is
// handed to the plugin's callback then, as the module hands it over on a
// frame - never inside the call that sent it.
import type { FakeServer, PluginInstance } from './server';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { normalizePath } from './server';

// What net_text reads: NET_TEXT_* in runtime/src/network.h.
const TEXT_ERROR = 0;
const TEXT_STATUS = 1;
const TEXT_URL = 2;
const TEXT_HEADERS = 3;
const TEXT_KIND = 4;

const SHAPE_NARROW = 0;

/** What kind of failure ended a request, as the module names it (NetErrorKind); `''` for none. */
type Kind = '' | 'login' | 'denied' | 'notFound' | 'refused' | 'timeout' | 'tls' | 'aborted' | 'other';

interface Outcome {
	/** The HTTP status, FTP's last reply, 0 for SFTP; -1 when there was no response. */
	status: number;
	statusText: string;
	/** The last response's header lines, `name: value` each. */
	headers: string;
	url: string;
	redirects: number;
	body: Uint8Array;
	error: string;
	kind: Kind;
	/** The protocol's last reply code, a failed request's too. */
	reply: number;
}

/** A request a plugin holds, as the module keeps one. */
interface FakeRequest {
	plugin: PluginInstance;
	url: string;
	method: string;
	headers: [string, string][];
	body: Uint8Array | null;
	follow: boolean;
	proxy: string;
	ca: string;
	user: string;
	password: string;
	/** A file of the game folder, as the server's files hold it. */
	keyFile: string;
	keyPassphrase: string;
	hostKey: string;
	/** FTP's TLS: '', 'try', 'control' or 'all'. */
	ssl: string;
	upload: boolean;
	list: boolean;
	createDirs: boolean;
	quote: string[];
	postquote: string[];
	timeout: number;
	/** A file of the game folder the answer goes into, or an upload comes from. */
	file: string;
	/** The callback's index in the plugin's table. */
	fn: number;
	state: 'setting' | 'sent' | 'ended';
	cancelled: boolean;
	controller: AbortController;
	/** Settled when the response is in. */
	done: Promise<void> | null;
	outcome: Outcome | null;
}

/** A failure on the way: its kind, its words and the reply code that said it. */
class Failure extends Error {
	constructor(readonly kind: Kind, message: string, readonly reply = 0) {
		super(message);
	}
}

/**
 * A path of the game folder as the module takes one - or null when it would
 * leave the folder: absolute, a drive, or a `..` among its parts.
 */
function gamePath(path: string): string | null {
	if (!path || /^[/\\]/.test(path) || path.includes(':') || path.split(/[/\\]/).includes('..')) return null;
	return normalizePath(path);
}

function flag(value: string): boolean {
	return value !== '0' && value !== 'false' && value !== '';
}

/** A client library a test of FTP or SFTP needs, or an error saying how to get it. */
async function need<T>(name: string): Promise<T> {
	try {
		return await import(name) as T;
	} catch {
		throw new Failure('other', `the fake server reaches FTP and SFTP servers through ${name}: npm install -D ${name}`);
	}
}

/** The kind of an error of Bun's fetch, of a socket or of TLS. */
function kindOf(error: unknown): Kind {
	const text = `${(error as { code?: string }).code ?? ''} ${(error as Error).name} ${(error as Error).message}`;
	if (/Timeout/i.test(text)) return 'timeout';
	if (/refused|ENOTFOUND|EAI_AGAIN|resolve|Unable to connect|ConnectionClosed|ECONNRESET/i.test(text)) return 'refused';
	if (/CERT|TLS|SSL|self[- ]signed/i.test(text)) return 'tls';
	return 'other';
}

/** The answer of a request that ended well. */
function answer(status: number, body = new Uint8Array(), more: Partial<Outcome> = {}): Outcome {
	return { status, statusText: '', headers: '', url: '', redirects: 0, body, error: '', kind: '', reply: status, ...more };
}

export class FakeNetwork {
	/** Every request plugins hold, by id. */
	readonly requests = new Map<number, FakeRequest>();
	/** What came back, in order, for the next frame. */
	private readonly ended: number[] = [];
	private nextId = 1;

	constructor(private readonly server: FakeServer) {}

	/** The plugin's request in one of `states`; undefined for another plugin's. */
	private of(plugin: PluginInstance, id: number, ...states: FakeRequest['state'][]): FakeRequest | undefined {
		const request = this.requests.get(id);
		return request && request.plugin === plugin && states.includes(request.state) ? request : undefined;
	}

	open(plugin: PluginInstance, url: string): number {
		const id = this.nextId++;
		this.requests.set(id, {
			plugin,
			url,
			method: 'GET',
			headers: [],
			body: null,
			follow: true,
			proxy: '',
			ca: '',
			user: '',
			password: '',
			keyFile: '',
			keyPassphrase: '',
			hostKey: '',
			ssl: '',
			upload: false,
			list: false,
			createDirs: false,
			quote: [],
			postquote: [],
			timeout: 0,
			file: '',
			fn: 0,
			state: 'setting',
			cancelled: false,
			controller: new AbortController(),
			done: null,
			outcome: null,
		});
		return id;
	}

	option(plugin: PluginInstance, id: number, name: string, value: string): number {
		const request = this.of(plugin, id, 'setting');
		if (!request) return 0;
		switch (name) {
			case 'header': {
				const colon = value.indexOf(':');
				request.headers.push([value.slice(0, colon).trim(), value.slice(colon + 1).trim()]);
				return 1;
			}
			case 'follow':
			case 'upload':
			case 'list':
			case 'createDirs':
				request[name] = flag(value);
				return 1;
			case 'method':
			case 'proxy':
			case 'ca':
			case 'user':
			case 'password':
			case 'keyPassphrase':
			case 'hostKey':
				request[name] = value;
				return 1;
			case 'ssl':
				request.ssl = ['try', 'control', 'all'].includes(value) ? value : value !== 'none' && flag(value) ? 'all' : '';
				return 1;
			case 'quote':
			case 'postquote':
				request[name].push(value);
				return 1;
			case 'timeout':
				request.timeout = Number.parseInt(value, 10) || 0;
				return 1;
			case 'keyFile':
			case 'file': {
				const path = gamePath(value);
				if (path === null) return 0;
				request[name] = path;
				return 1;
			}
			default:
				return 0;
		}
	}

	body(plugin: PluginInstance, id: number, bytes: Uint8Array): void {
		const request = this.of(plugin, id, 'setting');
		if (request) request.body = bytes;
	}

	send(plugin: PluginInstance, id: number, fn: number): number {
		const request = this.of(plugin, id, 'setting');
		if (!request) return 0;
		request.fn = fn;
		request.state = 'sent';
		request.done = this.run(request).then((outcome) => {
			request.outcome = outcome;
			this.ended.push(id);
		});
		return 1;
	}

	/** Runs a request by its URL's scheme, with its timeout; a download with `file` lands in the game folder. */
	private async run(request: FakeRequest): Promise<Outcome> {
		let timedOut = false;
		const timer = request.timeout > 0
			? setTimeout(() => {
					timedOut = true;
					request.controller.abort();
				}, request.timeout)
			: null;
		try {
			const scheme = new URL(request.url).protocol;
			const outcome = scheme === 'ftp:' || scheme === 'ftps:' ? await this.ftp(request) : scheme === 'sftp:' ? await this.sftp(request) : await this.http(request);
			if (request.file && !request.upload) {
				if (outcome.status < 400) this.server.files.set(request.file, outcome.body);
				outcome.body = new Uint8Array();
			}
			return outcome;
		} catch (error) {
			const failure = error instanceof Failure ? error : null;
			const kind: Kind = timedOut ? 'timeout' : failure?.kind ?? kindOf(error);
			return { ...answer(-1), error: (error as Error).message, kind, reply: failure?.reply ?? 0 };
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	/** What an upload sends: its file of the game folder, or its body. */
	private uploaded(request: FakeRequest): Uint8Array {
		if (!request.file) return request.body ?? new Uint8Array();
		const bytes = this.server.files.get(request.file);
		if (!bytes) throw new Failure('other', `cannot read ${request.file}`);
		return bytes;
	}

	private async http(request: FakeRequest): Promise<Outcome> {
		const response = await fetch(request.url, {
			method: request.upload ? 'PUT' : request.method,
			headers: request.headers,
			body: request.upload ? this.uploaded(request) : request.body,
			redirect: request.follow ? 'follow' : 'manual',
			signal: request.controller.signal,
			...(request.proxy ? { proxy: request.proxy } : {}),
			...(request.ca ? { tls: { ca: request.ca } } : {}),
		} as RequestInit);
		const lines = [...response.headers].filter(([name]) => name !== 'set-cookie').map(([name, value]) => `${name}: ${value}`);
		for (const cookie of response.headers.getSetCookie()) lines.push(`set-cookie: ${cookie}`);
		return answer(response.status, new Uint8Array(await response.arrayBuffer()), {
			statusText: response.statusText,
			headers: lines.join('\n'),
			url: response.url,
			redirects: response.redirected ? 1 : 0,
		});
	}

	/**
	 * FTP and FTPS as curl speaks them: log in, the quote commands, into the
	 * path's folder (making it, for an upload with createDirs), then the
	 * transfer - a listing for a path that ends in `/`.
	 */
	private async ftp(request: FakeRequest): Promise<Outcome> {
		const { Client, FTPError } = await need<any>('basic-ftp');
		const url = new URL(request.url);
		const implicit = url.protocol === 'ftps:';
		const client = new Client();
		request.controller.signal.addEventListener('abort', () => client.close());
		let stage: 'login' | 'quote' | 'folder' | 'transfer' = 'login';
		let last = 0;
		const step = async (response: Promise<{ code: number }>) => {
			last = (await response).code;
		};
		try {
			const access = (secure: boolean | 'implicit') => client.access({
				host: url.hostname,
				port: Number(url.port) || (implicit ? 990 : 21),
				user: request.user || decodeURIComponent(url.username) || 'anonymous',
				password: request.password || decodeURIComponent(url.password),
				secure,
				secureOptions: request.ca ? { ca: request.ca } : undefined,
			});
			try {
				await step(access(implicit ? 'implicit' : request.ssl !== ''));
			} catch (error) {
				// "try": TLS when the server has it, else as it is.
				if (request.ssl !== 'try' || (error as { code?: number }).code === 530) throw error;
				client.close();
				await step(access(false));
			}

			stage = 'quote';
			for (const command of request.quote) await step(client.send(command));

			// The path is the login folder's: ftp://host/dir/file is dir/file.
			const path = decodeURIComponent(url.pathname).slice(1);
			const slash = path.lastIndexOf('/');
			const dir = path.slice(0, slash + 1);
			const name = path.slice(slash + 1);
			stage = 'folder';
			if (dir && request.upload && request.createDirs) await client.ensureDir(dir);
			else if (dir) await step(client.cd(dir));

			stage = 'transfer';
			let body = new Uint8Array();
			if (request.method === 'HEAD') {
				// Nothing is transferred: the commands alone.
			} else if (request.upload) {
				await step(client.uploadFrom(Readable.from([Buffer.from(this.uploaded(request))]), name));
			} else if (!name) {
				client.availableListCommands = [request.list ? 'NLST' : 'LIST'];
				client.parseList = (raw: string) => [raw] as never;
				const [raw] = await client.list() as unknown as string[];
				body = new TextEncoder().encode(raw);
				last = 226;
			} else {
				const chunks: Buffer[] = [];
				await step(client.downloadTo(new Writable({ write(chunk, _, done) {
					chunks.push(chunk);
					done();
				} }), name));
				body = new Uint8Array(Buffer.concat(chunks));
			}
			for (const command of request.postquote) await step(client.send(command));
			return answer(last, body);
		} catch (error) {
			if (!(error instanceof FTPError)) throw error;
			// As curl's codes have it: a refused login, a folder it cannot
			// enter, a file the server does not have.
			const { code, message } = error as { code: number; message: string };
			const kind: Kind = code === 530 ? 'login' : stage === 'folder' ? 'denied' : stage === 'transfer' && !request.upload && code === 550 ? 'notFound' : 'other';
			throw new Failure(kind, message, code);
		} finally {
			client.close();
		}
	}

	/**
	 * SFTP as curl speaks it: log in (a password, or a key of the game
	 * folder), the host key checked against its SHA-256, the quote commands,
	 * then the transfer - a listing for a path that ends in `/`.
	 */
	private async sftp(request: FakeRequest): Promise<Outcome> {
		const { default: Sftp } = await need<{ default: new () => any }>('ssh2-sftp-client');
		const url = new URL(request.url);
		const sftp = new Sftp();
		request.controller.signal.addEventListener('abort', () => sftp.end().catch(() => {}));
		const hostKey = request.hostKey.replace(/=+$/, '');
		let hostRefused = false;
		let stage: 'login' | 'quote' | 'transfer' = 'login';
		try {
			const key = request.keyFile ? this.server.files.get(request.keyFile) : undefined;
			if (request.keyFile && !key) throw new Failure('login', `cannot read ${request.keyFile}`);
			await sftp.connect({
				host: url.hostname,
				port: Number(url.port) || 22,
				username: request.user || decodeURIComponent(url.username),
				password: request.password || decodeURIComponent(url.password) || undefined,
				privateKey: key ? Buffer.from(key) : undefined,
				passphrase: request.keyPassphrase || undefined,
				hostVerifier: hostKey
					? (presented: Buffer) => {
							hostRefused = createHash('sha256').update(presented).digest('base64').replace(/=+$/, '') !== hostKey;
							return !hostRefused;
						}
					: undefined,
				readyTimeout: 30_000,
			});

			stage = 'quote';
			for (const command of request.quote) await this.sftpCommand(sftp, command);

			// sftp://host/path is /path; /~/path is the login folder's.
			const path = decodeURIComponent(url.pathname).replace(/^\/~\//, '');
			stage = 'transfer';
			let body = new Uint8Array();
			if (request.method === 'HEAD') {
				// Nothing is transferred: the commands alone.
			} else if (request.upload) {
				if (request.createDirs && path.includes('/')) await sftp.mkdir(path.slice(0, path.lastIndexOf('/')) || '/', true);
				await sftp.put(Buffer.from(this.uploaded(request)), path);
			} else if (path.endsWith('/') || !path) {
				const entries: { name: string; longname: string }[] = await sftp.list(path || '.');
				body = new TextEncoder().encode(entries.map(entry => `${request.list ? entry.name : entry.longname}\n`).join(''));
			} else {
				body = new Uint8Array(await sftp.get(path));
			}
			for (const command of request.postquote) await this.sftpCommand(sftp, command);
			return answer(0, body);
		} catch (error) {
			if (error instanceof Failure) throw error;
			const message = (error as Error).message;
			if (hostRefused) throw new Failure('tls', `the host key is not ${request.hostKey}`);
			if (stage === 'login' && /authentication|auth|passphrase|privateKey/i.test(message)) throw new Failure('login', message);
			// SFTP's status, as the server sent it: 2 no such file, 3 permission denied.
			const status = typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 0;
			const kind: Kind = status === 2 || status === 10 ? 'notFound' : status === 3 || status === 12 ? 'denied' : stage === 'login' ? kindOf(error) : 'other';
			throw new Failure(kind, message, status);
		} finally {
			await sftp.end().catch(() => {});
		}
	}

	/** One of curl's SFTP quote commands. */
	private async sftpCommand(sftp: any, command: string): Promise<void> {
		const [name, ...args] = command.trim().split(/\s+/);
		switch (name) {
			case 'rename':
				return sftp.rename(args[0], args[1]);
			case 'rm':
				return sftp.delete(args[0]);
			case 'mkdir':
				return sftp.mkdir(args[0]);
			case 'rmdir':
				return sftp.rmdir(args[0]);
			case 'chmod':
				return sftp.chmod(args[1], Number.parseInt(args[0], 8));
			default:
				throw new Failure('other', `the fake server's SFTP has no quote command ${name}`);
		}
	}

	/** Takes a request back: one under way is aborted and never heard of again. */
	cancel(plugin: PluginInstance, id: number): void {
		const request = this.of(plugin, id, 'setting', 'sent', 'ended');
		if (!request) return;
		request.cancelled = true;
		request.controller.abort();
		this.requests.delete(id);
	}

	status(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id, 'ended')?.outcome?.status ?? -1;
	}

	reply(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id, 'ended')?.outcome?.reply ?? 0;
	}

	redirects(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id, 'ended')?.outcome?.redirects ?? 0;
	}

	text(plugin: PluginInstance, id: number, what: number, out: number, max: number): number {
		const outcome = this.of(plugin, id, 'ended')?.outcome;
		if (!outcome) return 0;
		const texts: Record<number, string> = {
			[TEXT_ERROR]: outcome.error,
			[TEXT_STATUS]: outcome.statusText,
			[TEXT_URL]: outcome.url,
			[TEXT_HEADERS]: outcome.headers,
			[TEXT_KIND]: outcome.kind,
		};
		return plugin.memory.setUtf8(out, max, texts[what] ?? '');
	}

	size(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id, 'ended')?.outcome?.body.length ?? 0;
	}

	read(plugin: PluginInstance, id: number, out: number, max: number): number {
		const body = this.of(plugin, id, 'ended')?.outcome?.body;
		if (!body) return 0;
		if (out && max > 0) plugin.memory.setRaw(out, body.subarray(0, max));
		return body.length;
	}

	/** Whether a request is still out. */
	get busy(): boolean {
		return [...this.requests.values()].some(request => request.state === 'sent' && request.outcome === null);
	}

	/**
	 * Waits for the requests that are out, and hands each response to its
	 * plugin - until none is out: a callback may send another.
	 */
	async settle(): Promise<void> {
		for (;;) {
			const out = [...this.requests.values()].filter(request => request.state === 'sent' && request.done);
			await Promise.all(out.map(request => request.done));
			this.frame();
			if (!this.busy) return;
		}
	}

	/** One frame: every request that has come back goes to its callback. */
	frame(): void {
		for (const id of this.ended.splice(0)) {
			const request = this.requests.get(id);
			if (!request || request.cancelled || request.plugin.unloaded) {
				this.requests.delete(id);
				continue;
			}
			request.state = 'ended';
			this.server.call({ plugin: request.plugin, fn: request.fn, shape: SHAPE_NARROW }, [id], 0);
		}
	}
}
