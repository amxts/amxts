// fetch, useFetch and URL, as a plugin writes them. Each command takes the
// address of the test's web server (tests/http-server.ts) and logs what came
// back; tests/fetch.test.ts reads the lines.
import * as fs from "@amxts/core/fs";

interface BaseArgs {
	base: string;
}

interface CaArgs {
	base: string;
	ca: string;
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

server.addServerCommand<BaseArgs>("fetch_json <base>", async ({ base }) => {
	const response = await fetch(`${base}/json`);
	const status = await response.json<Status>();
	console.log(`json ${response.status} ${response.ok} ${status.name} ${status.players.length} ${status.online}`);
});

server.addServerCommand<BaseArgs>("fetch_text <base>", async ({ base }) => {
	const response = await fetch(new URL("/text", base));
	console.log(`text ${response.headers.get("content-type")} ${await response.text()} ${response.bodyUsed}`);
});

server.addServerCommand<BaseArgs>("fetch_post <base>", async ({ base }) => {
	const response = await fetch(`${base}/echo?from=plugin`, {
		method: "post",
		body: "{\"kills\":3}",
		headers: { "Content-Type": "application/json", "X-Custom": "abc" },
	});
	const echo = await response.json<Echo>();
	console.log(`post ${echo.method} ${echo.body} ${echo.contentType} ${echo.custom} ${echo.query}`);
});

server.addServerCommand<BaseArgs>("fetch_request <base>", async ({ base }) => {
	const request = new Request(`${base}/echo`, { method: "PUT", body: "plain" });
	const response = await fetch(request, { headers: { "x-custom": "given" } });
	const echo = await response.json<Echo>();
	console.log(`request ${request.method} ${echo.method} ${echo.body} ${echo.contentType} ${echo.custom}`);
});

server.addServerCommand<BaseArgs>("fetch_headers <base>", async ({ base }) => {
	const response = await fetch(`${base}/headers`);
	const cookies = response.headers.getSetCookie();
	console.log(`headers ${response.headers.get("X-Reply")} ${response.headers.has("x-missing")} ${cookies.join(",")}`);
});

server.addServerCommand<BaseArgs>("fetch_redirect <base>", async ({ base }) => {
	const followed = await fetch(`${base}/redirect`);
	console.log(`follow ${followed.status} ${followed.redirected} ${followed.url.endsWith("/json")}`);

	const manual = await fetch(`${base}/redirect`, { redirect: "manual" });
	console.log(`manual ${manual.status} ${manual.headers.get("location")}`);

	try {
		await fetch(`${base}/redirect`, { redirect: "error" });
	} catch (error) {
		console.log(`error ${error.name}`);
	}
});

server.addServerCommand<BaseArgs>("fetch_abort <base>", async ({ base }) => {
	const controller = new AbortController();
	const pending = fetch(`${base}/slow`, { signal: controller.signal });
	controller.abort();
	try {
		await pending;
	} catch (error) {
		console.log(`abort ${error.name}`);
	}
});

server.addServerCommand<BaseArgs>("fetch_timeout <base>", async ({ base }) => {
	try {
		await fetch(`${base}/slow`, { signal: AbortSignal.timeout(100) });
	} catch (error) {
		console.log(`timeout ${error.name}`);
	}
});

server.addServerCommand<CaArgs>("fetch_https <base> <ca>", async ({ base, ca }) => {
	const authority = fs.readFileSync(ca) ?? "";
	const response = await fetch(`${base}/json`, { tls: { ca: authority } });
	console.log(`https ${response.status} ${(await response.json<Status>()).name}`);

	try {
		await fetch(`${base}/json`);
	} catch (error) {
		console.log(`untrusted ${error.name}`);
	}
});

server.addServerCommand<BaseArgs>("use_json <base>", async ({ base }) => {
	const { data, error, status } = await useFetch<Status>(`${base}/json`);
	console.log(`use ${status} ${error === null} ${data?.name} ${data?.players.join("+")}`);
});

server.addServerCommand<BaseArgs>("use_missing <base>", async ({ base }) => {
	const { data, error, status } = await useFetch<Status>(`${base}/missing`);
	if (error instanceof FetchError) console.log(`missing ${status} ${data === null} ${error.name} ${error.message} ${error.body}`);
});

server.addServerCommand<BaseArgs>("use_post <base>", async ({ base }) => {
	const report: Report = { map: "de_dust2", round: 3 };
	const { data } = await useFetch<Echo, Report>(`${base}/echo`, { method: "POST", body: report, query: { page: "2", q: "a b" } });
	console.log(`use post ${data?.method} ${data?.body} ${data?.contentType} ${data?.accept} ${data?.query}`);
});

server.addServerCommand<BaseArgs>("use_retry <base>", async ({ base }) => {
	const { data, error } = await useFetch<Status>(`${base}/flaky`, { query: { key: "retry" }, retry: 2, retryDelay: 100 });
	console.log(`retry ${data?.name} ${error === null}`);
});

server.addServerCommand<BaseArgs>("use_timeout <base>", async ({ base }) => {
	const { error, status } = await useFetch<Status>(`${base}/slow`, { timeout: 100 });
	console.log(`use timeout ${status} ${error?.name}`);
});

server.addServerCommand<BaseArgs>("use_offline <base>", async ({ base }) => {
	const { error, status } = await useFetch<Status>(base);
	console.log(`offline ${status} ${error?.name}`);
});

server.addServerCommand("url_parts", () => {
	const url = new URL("HTTPS://user:pw@Example.COM:443/a/./b/../c d?x=1&y=two words#top");
	console.log(`url ${url.href}`);
	console.log(`parts ${url.protocol} ${url.username} ${url.host} ${url.port === ""} ${url.pathname} ${url.search} ${url.hash} ${url.origin}`);

	url.searchParams.set("y", "2");
	url.searchParams.append("z", "a&b");
	console.log(`params ${url.search} ${url.searchParams.get("x")} ${url.searchParams.getAll("z").length}`);

	const relative = new URL("../api?id=7", "http://example.com:8080/v1/users/");
	console.log(`relative ${relative.href} ${relative.port}`);
	console.log(`can ${URL.canParse("nope")} ${URL.canParse("/x", "https://example.com")} ${URL.parse("::") === null}`);

	const query = new URLSearchParams({ city: "São Paulo", page: "1" });
	query.sort();
	console.log(`query ${query} ${query.size}`);

	try {
		const invalid = new URL("not a url");
		console.log(`parsed ${invalid.href}`);
	} catch (error) {
		console.log(`invalid ${error.name}`);
	}
});
