// fetch and useFetch on a real server: the module's network client - libcurl
// on a worker thread, the promise settled on a frame - against the runner's
// web server (tests/http-server.ts), over HTTP and HTTPS with a certificate of
// its own. The runner gives both addresses: amxts_test_fetch <http> <https>.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

interface FetchArgs {
	http: string;
	https: string;
}

interface Status {
	name: string;
	players: number[];
	online: boolean;
}

interface Echo {
	method: string;
	body: string;
	contentType: string;
	custom: string;
	accept: string;
	query: string;
}

interface Report {
	map: string;
	round: number;
}

server.addServerCommand<FetchArgs>("amxts_test_fetch <http> <https>", ({ http, https }) => {
	run(http, https);
});

async function errorName(request: Promise<Response>) {
	try {
		await request;
		return "none";
	} catch (error) {
		return error.name;
	}
}

async function run(http: string, https: string) {
	const check = new Checks("fetch");

	const response = await fetch(`${http}/json`);
	const status = await response.json<Status>();
	check.expect(`${response.status} ${response.ok} ${status.name} ${status.players.length}`, "a JSON GET").toBe("200 true amxts 3");

	const text = await fetch(new URL("/text", http));
	check.expect(await text.text(), "UTF-8 text, a URL as the input").toBe("Привет, мир");

	const posted = await fetch(`${http}/echo?from=plugin`, {
		method: "POST",
		body: "{\"kills\":3}",
		headers: { "Content-Type": "application/json", "X-Custom": "abc" },
	});
	const echo = await posted.json<Echo>();
	check.expect(`${echo.method} ${echo.body} ${echo.contentType} ${echo.custom} ${echo.query}`, "a POST: body, headers and query").toBe("POST {\"kills\":3} application/json abc ?from=plugin");

	const headers = await fetch(`${http}/headers`);
	check.expect(`${headers.headers.get("X-Reply")} ${headers.headers.getSetCookie().join(",")}`, "response headers").toBe("yes a=1,b=2");

	const followed = await fetch(`${http}/redirect`);
	check.expect(`${followed.status} ${followed.redirected} ${followed.url.endsWith("/json")}`, "a redirect followed").toBe("200 true true");
	const manual = await fetch(`${http}/redirect`, { redirect: "manual" });
	check.expect(`${manual.status} ${manual.headers.get("location")}`, "a redirect given as it is").toBe("302 /json");
	check.expect(await errorName(fetch(`${http}/redirect`, { redirect: "error" })), "a redirect as an error").toBe("TypeError");

	const controller = new AbortController();
	const aborted = fetch(`${http}/slow`, { signal: controller.signal });
	controller.abort();
	check.expect(await errorName(aborted), "an abort").toBe("AbortError");
	check.expect(await errorName(fetch(`${http}/slow`, { signal: AbortSignal.timeout(300) })), "AbortSignal.timeout").toBe("TimeoutError");

	const ca = fs.readFileSync(`${server.configsDir}/https-cert.pem`) ?? "";
	const secure = await fetch(`${https}/json`, { tls: { ca } });
	check.expect(`${secure.status} ${(await secure.json<Status>()).name}`, "HTTPS with a certificate of its own, given as tls.ca").toBe("200 amxts");
	check.expect(await errorName(fetch(`${https}/json`)), "HTTPS with a certificate nobody vouches for").toBe("TypeError");

	const found = await useFetch<Status>(`${http}/json`);
	check.expect(`${found.status} ${found.error === null} ${found.data?.name}`, "useFetch: JSON into an interface").toBe("200 true amxts");

	const missing = await useFetch<Status>(`${http}/missing`);
	const error = missing.error;
	const body = error instanceof FetchError ? error.body : "";
	check.expect(`${missing.status} ${missing.data === null} ${error?.name} ${error?.message} ${body}`, "useFetch: a 404 is an error").toBe("404 true FetchError 404 Not Found {\"error\":\"no such thing\"}");

	const report: Report = { map: "de_dust2", round: 3 };
	const sent = await useFetch<Echo, Report>(`${http}/echo`, { method: "POST", body: report, query: { page: "2" } });
	check.expect(`${sent.data?.body} ${sent.data?.contentType} ${sent.data?.query}`, "useFetch: an object body as JSON, the query").toBe("{\"map\":\"de_dust2\",\"round\":3} application/json ?page=2");

	const retried = await useFetch<Status>(`${http}/flaky`, { query: { key: "server" }, retry: 2, retryDelay: 100 });
	check.expect(`${retried.data?.name} ${retried.error === null}`, "useFetch: a 503 tried again").toBe("flaky true");

	const late = await useFetch<Status>(`${http}/slow`, { timeout: 300 });
	check.expect(`${late.status} ${late.error?.name}`, "useFetch: a timeout").toBe("0 TimeoutError");

	const offline = await useFetch<Status>("http://127.0.0.1:1/");
	check.expect(`${offline.status} ${offline.error?.name}`, "useFetch: no connection").toBe("0 TypeError");

	check.done();
}
