import type { FakeServer } from '@amxts/core/test-utils';
import type { TestHttp } from './http-server';
import { loadPlugin } from '@amxts/core/test-utils';
// fetch, useFetch, URL and Headers (as/fetch.ts) on the fake server, which
// answers the module's network client with Bun's own fetch: tests/as/fetch.ts
// against the web server of tests/http-server.ts on this machine.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { startTestHttp, TEST_CA } from './http-server';

setDefaultTimeout(120_000);

let web: TestHttp;
let server: FakeServer;

beforeAll(async () => {
	web = startTestHttp();
	server = await loadPlugin('tests/as/fetch.ts', { files: { 'ca.pem': TEST_CA } });
});

afterAll(() => web.stop());

/** Runs a command and lets its requests come back; the lines it logged. */
async function run(command: string): Promise<string[]> {
	const from = server.logLines.length;
	server.serverCommand(command);
	await server.responses();
	return server.logLines.slice(from);
}

describe('fetch', () => {
	test('a JSON GET: the status, ok and the body read into an interface', async () => {
		expect(await run(`fetch_json ${web.http}`)).toEqual(['json 200 true amxts 3 true']);
	});

	test('a URL as the input; text in UTF-8; the body is read once', async () => {
		// Cyrillic on purpose: the body is UTF-8.
		expect(await run(`fetch_text ${web.http}`)).toEqual(['text text/plain; charset=utf-8 Привет, мир true']);
	});

	test('a POST: the method in capitals, the body, the headers and the query reach the server', async () => {
		expect(await run(`fetch_post ${web.http}`)).toEqual(['post POST {"kills":3} application/json abc ?from=plugin']);
	});

	test('a Request, with init over it; text gets a text content type', async () => {
		expect(await run(`fetch_request ${web.http}`)).toEqual(['request PUT PUT plain text/plain;charset=UTF-8 given']);
	});

	test('response headers by any case; set-cookie each on its own', async () => {
		expect(await run(`fetch_headers ${web.http}`)).toEqual(['headers yes false a=1,b=2']);
	});

	test('a redirect is followed, given as it is, or an error', async () => {
		expect(await run(`fetch_redirect ${web.http}`)).toEqual(['follow 200 true true', 'manual 302 /json', 'error TypeError']);
	});

	test('an abort rejects with AbortError at once', async () => {
		expect(await run(`fetch_abort ${web.http}`)).toEqual(['abort AbortError']);
	});

	test('AbortSignal.timeout rejects with TimeoutError when its time comes', async () => {
		const from = server.logLines.length;
		server.serverCommand(`fetch_timeout ${web.http}`);
		server.advance(200);
		await server.responses();
		expect(server.logLines.slice(from)).toEqual(['timeout TimeoutError']);
	});

	test('HTTPS with a certificate of its own: trusted through tls.ca, refused without', async () => {
		expect(await run(`fetch_https ${web.https} ca.pem`)).toEqual(['https 200 amxts', 'untrusted TypeError']);
	});
});

describe('useFetch', () => {
	test('JSON into the interface, no error', async () => {
		expect(await run(`use_json ${web.http}`)).toEqual(['use 200 true amxts 1+2+3']);
	});

	test('a 404 is an error with its status and body, not data', async () => {
		expect(await run(`use_missing ${web.http}`)).toEqual(['missing 404 true FetchError 404 Not Found {"error":"no such thing"}']);
	});

	test('an object body goes as JSON; the query is added; JSON is asked for', async () => {
		expect(await run(`use_post ${web.http}`)).toEqual([
			'use post POST {"map":"de_dust2","round":3} application/json application/json ?page=2&q=a+b',
		]);
	});

	test('a 503 is tried again after retryDelay', async () => {
		const from = server.logLines.length;
		server.serverCommand(`use_retry ${web.http}`);
		for (let i = 0; i < 2; i++) {
			await server.responses();
			server.advance(100);
		}
		await server.responses();
		expect(server.logLines.slice(from)).toEqual(['retry flaky true']);
	});

	test('a timeout and no connection are errors with status 0', async () => {
		const from = server.logLines.length;
		server.serverCommand(`use_timeout ${web.http}`);
		server.advance(200);
		await server.responses();
		expect(server.logLines.slice(from)).toEqual(['use timeout 0 TimeoutError']);
		expect(await run('use_offline http://127.0.0.1:1')).toEqual(['offline 0 TypeError']);
	});
});

describe('URL', () => {
	test('parts, the query as params, relative URLs, URLSearchParams', async () => {
		expect(await run('url_parts')).toEqual([
			'url https://user:pw@example.com/a/c%20d?x=1&y=two%20words#top',
			'parts https: user example.com true /a/c%20d ?x=1&y=two%20words #top https://example.com',
			'params ?x=1&y=2&z=a%26b 1 1',
			'relative http://example.com:8080/v1/api?id=7 8080',
			'can false true true',
			'query city=S%C3%A3o+Paulo&page=1 2',
			'invalid TypeError',
		]);
	});
});
