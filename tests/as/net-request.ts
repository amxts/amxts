// The kit's request, as a module over FTP, FTPS or SFTP writes it. Each
// command takes a server's address (tests/ftp-servers.ts) and the account,
// and logs what came back; tests/net-request.test.ts reads the lines.
import * as fs from "@amxts/core/fs";
import { request, RequestOptions, RequestResult } from "@amxts/core/kit";

interface Login {
	url: string;
	user: string;
	password: string;
}

interface WithFile {
	url: string;
	user: string;
	password: string;
	file: string;
}

interface WithQuote {
	url: string;
	user: string;
	password: string;
	commands: string;
}

interface WithKey {
	url: string;
	user: string;
	keyFile: string;
	hostKey: string;
	passphrase: string;
}

/** One line of what a request ended with: the status, the kind of error in brackets, the reply code, the text. */
function report(what: string, result: RequestResult): void {
	console.log(`${what} ${result.status} [${result.errorKind}] ${result.replyCode} ${result.text().trim().split("\r\n").join("|").split("\n").join("|")}`);
}

/** The account's options, for a command to add to. */
function login(user: string, password: string): RequestOptions {
	return { user, password };
}

server.addServerCommand<Login>("net_put <url> <user> <password>", async (target) => {
	const options = login(target.user, target.password);
	options.upload = true;
	options.createDirs = true;
	options.body = "Привет, FTP";
	report("put", await request(target.url, options));
});

server.addServerCommand<Login>("net_get <url> <user> <password>", async (target) => {
	report("get", await request(target.url, login(target.user, target.password)));
});

server.addServerCommand<Login>("net_names <url> <user> <password>", async (target) => {
	const options = login(target.user, target.password);
	options.list = true;
	report("names", await request(target.url, options));
});

server.addServerCommand<WithFile>("net_push <url> <user> <password> <file>", async (target) => {
	report("push", await request(target.url, { user: target.user, password: target.password, upload: true, createDirs: true, file: target.file }));
});

server.addServerCommand<WithFile>("net_pull <url> <user> <password> <file>", async (target) => {
	report("pull", await request(target.url, { user: target.user, password: target.password, file: target.file }));
});

server.addServerCommand<WithQuote>("net_quote <url> <user> <password> <commands>", async (target) => {
	report("quote", await request(target.url, { user: target.user, password: target.password, method: "HEAD", quote: target.commands.split("|") }));
});

server.addServerCommand<WithFile>("net_tls <url> <user> <password> <file>", async (target) => {
	const ca = fs.readFileSync(target.file) ?? "";
	report("trusted", await request(target.url, { user: target.user, password: target.password, ca, list: true }));
	report("untrusted", await request(target.url, { user: target.user, password: target.password, list: true }));
});

server.addServerCommand<WithKey>("net_key <url> <user> <keyFile> <hostKey> <passphrase>", async (target) => {
	const options: RequestOptions = { user: target.user, keyFile: target.keyFile, keyPassphrase: target.passphrase, hostKey: target.hostKey, list: true };
	report("key", await request(target.url, options));
});

server.addServerCommand<Login>("net_timeout <url> <user> <password>", async (target) => {
	const options = login(target.user, target.password);
	options.timeout = 300;
	report("timeout", await request(target.url, options));
});

server.addServerCommand<Login>("net_abort <url> <user> <password>", async (target) => {
	const controller = new AbortController();
	const options = login(target.user, target.password);
	options.signal = controller.signal;
	const pending = request(target.url, options);
	controller.abort();
	report("abort", await pending);
});

server.addServerCommand<Login>("net_outside <url> <user> <password>", async (target) => {
	const result = await request(target.url, { user: target.user, password: target.password, file: "../server.cfg" });
	console.log(`outside [${result.errorKind}] ${result.errorText}`);
});
