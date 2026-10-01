// The module's network client (runtime/src/network.h) on the fake server:
// the net_* externals as/fetch.ts declares, answered with Bun's own fetch.
// A request goes out when the plugin sends it; what comes back waits until
// the test lets the server's frames run (`await server.responses()`), and is
// handed to the plugin's callback then, as the module hands it over on a
// frame - never inside the call that sent it.
import type { FakeServer, PluginInstance } from './server';

// What net_text reads: NET_TEXT_* in runtime/src/network.h.
const TEXT_ERROR = 0;
const TEXT_STATUS = 1;
const TEXT_URL = 2;
const TEXT_HEADERS = 3;

const SHAPE_NARROW = 0;

interface Outcome {
	/** The HTTP status; -1 when there was no response. */
	status: number;
	statusText: string;
	/** The last response's header lines, `name: value` each. */
	headers: string;
	url: string;
	redirects: number;
	body: Uint8Array;
	error: string;
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
	/** The callback's index in the plugin's table. */
	fn: number;
	state: 'setting' | 'sent' | 'ended';
	cancelled: boolean;
	controller: AbortController;
	/** Settled when the response is in. */
	done: Promise<void> | null;
	outcome: Outcome | null;
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
			case 'method':
				request.method = value;
				break;
			case 'header': {
				const colon = value.indexOf(':');
				request.headers.push([value.slice(0, colon).trim(), value.slice(colon + 1).trim()]);
				break;
			}
			case 'follow':
				request.follow = value !== '0' && value !== 'false' && value !== '';
				break;
			case 'proxy':
				request.proxy = value;
				break;
			case 'ca':
				request.ca = value;
				break;
			default:
				return 0;
		}
		return 1;
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

	private async run(request: FakeRequest): Promise<Outcome> {
		try {
			const response = await fetch(request.url, {
				method: request.method,
				headers: request.headers,
				body: request.body,
				redirect: request.follow ? 'follow' : 'manual',
				signal: request.controller.signal,
				...(request.proxy ? { proxy: request.proxy } : {}),
				...(request.ca ? { tls: { ca: request.ca } } : {}),
			} as RequestInit);
			const lines = [...response.headers].filter(([name]) => name !== 'set-cookie').map(([name, value]) => `${name}: ${value}`);
			for (const cookie of response.headers.getSetCookie()) lines.push(`set-cookie: ${cookie}`);
			return {
				status: response.status,
				statusText: response.statusText,
				headers: lines.join('\n'),
				url: response.url,
				redirects: response.redirected ? 1 : 0,
				body: new Uint8Array(await response.arrayBuffer()),
				error: '',
			};
		} catch (error) {
			return { status: -1, statusText: '', headers: '', url: '', redirects: 0, body: new Uint8Array(), error: (error as Error).message };
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

	redirects(plugin: PluginInstance, id: number): number {
		return this.of(plugin, id, 'ended')?.outcome?.redirects ?? 0;
	}

	text(plugin: PluginInstance, id: number, what: number, out: number, max: number): number {
		const outcome = this.of(plugin, id, 'ended')?.outcome;
		if (!outcome) return 0;
		const text = what === TEXT_ERROR ? outcome.error : what === TEXT_STATUS ? outcome.statusText : what === TEXT_URL ? outcome.url : what === TEXT_HEADERS ? outcome.headers : '';
		return plugin.memory.setUtf8(out, max, text);
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
