// The web server fetch and useFetch are tested against: HTTP and HTTPS (a
// certificate of its own, tests/server/fixtures/https-cert.pem) on ports of
// this machine, started by the test that needs it - tests/fetch.test.ts on
// the fake server, `bun run test:server` for the network suite
// (tests/server/fetch.ts). Nothing goes to the internet. The paths:
//
//   json         200, a JSON object
//   text         200, UTF-8 text
//   echo         the request as JSON: method, body, content type, x-custom, accept, the query
//   headers      200 with x-reply and two set-cookie headers
//   redirect     302 to /json
//   slow         answers after five seconds
//   missing      404 with a JSON error
//   flaky?key=   503 the first two times a key is asked for, then 200
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: any;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'server', 'fixtures');

/** The certificate the HTTPS side presents, as PEM: what a client trusts with `tls: { ca }`. */
export const TEST_CA = readFileSync(join(FIXTURES, 'https-cert.pem'), 'utf8');

export interface TestHttp {
	/** `http://<host>:<port>`, without a slash at the end. */
	http: string;
	/** `https://<host>:<port>`. */
	https: string;
	stop: () => void;
}

const json = (value: unknown, init: ResponseInit = {}) => Response.json(value, init);

function handler() {
	const flaky = new Map<string, number>();

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		switch (url.pathname) {
			case '/json':
				return json({ name: 'amxts', players: [1, 2, 3], online: true });
			case '/text':
				return new Response('Привет, мир', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
			case '/echo':
				return json({
					method: request.method,
					body: await request.text(),
					contentType: request.headers.get('content-type') ?? '',
					custom: request.headers.get('x-custom') ?? '',
					accept: request.headers.get('accept') ?? '',
					query: url.search,
				});
			case '/headers': {
				const headers = new Headers({ 'x-reply': 'yes' });
				headers.append('set-cookie', 'a=1');
				headers.append('set-cookie', 'b=2');
				return new Response('ok', { headers });
			}
			case '/redirect':
				return new Response(null, { status: 302, headers: { location: '/json' } });
			case '/slow':
				await Bun.sleep(5000);
				return new Response('late');
			case '/missing':
				return json({ error: 'no such thing' }, { status: 404, statusText: 'Not Found' });
			case '/flaky': {
				const key = url.searchParams.get('key') ?? '';
				const seen = (flaky.get(key) ?? 0) + 1;
				flaky.set(key, seen);
				return seen <= 2 ? new Response('busy', { status: 503, statusText: 'Service Unavailable' }) : json({ name: 'flaky', players: [], online: true });
			}
			default:
				return new Response('not here', { status: 404 });
		}
	};
}

/**
 * Starts both sides on free ports of `hostname` (127.0.0.1; 0.0.0.0 for a
 * server in a container); `host` is how a client names this machine.
 */
export function startTestHttp(hostname = '127.0.0.1', host = '127.0.0.1'): TestHttp {
	const fetch = handler();
	const http = Bun.serve({ hostname, port: 0, fetch });
	const https = Bun.serve({
		hostname,
		port: 0,
		fetch,
		tls: { cert: TEST_CA, key: readFileSync(join(FIXTURES, 'https-key.pem'), 'utf8') },
	});
	return {
		http: `http://${host}:${http.port}`,
		https: `https://${host}:${https.port}`,
		stop: () => {
			http.stop(true);
			https.stop(true);
		},
	};
}
