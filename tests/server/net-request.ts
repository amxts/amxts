// The kit's request on a real server: the module's network client over FTP
// and SFTP - curl and libssh2 on the worker thread - against the runner's
// servers (tests/ftp-servers.ts): text up and down, the names of a folder, a
// file of the game folder streamed both ways, the kinds of error with their
// reply codes, an SSH key with its passphrase and the host key checked. The
// runner gives the addresses and the host key, and puts the key into the
// configs folder: amxts_test_net_request <ftp> <sftp> <hostKey>. Without
// them (a project with no such servers) nothing is checked.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";
import { request, RequestResult } from "@amxts/core/kit";

interface NetArgs {
	ftp?: string;
	sftp?: string;
	hostKey?: string;
}

server.addServerCommand<NetArgs>("amxts_test_net_request [ftp] [sftp] [hostKey]", ({ ftp, sftp, hostKey }) => {
	run(ftp ?? "", sftp ?? "", hostKey ?? "");
});

/** What a request ended with, as one line: the status, the kind of error, the reply code. */
function outcome(result: RequestResult): string {
	return `${result.status} [${result.errorKind}] ${result.replyCode}`;
}

async function run(ftp: string, sftp: string, hostKey: string) {
	const check = new Checks("net-request");
	if (ftp == "" || sftp == "") {
		check.done();
		return;
	}
	const user = "amxts";
	const password = "secret";
	const dir = server.configsDir;

	const put = await request(`${ftp}/srv/hello.txt`, { user, password, upload: true, createDirs: true, body: "Привет, FTP" });
	check.expect(outcome(put), "FTP: text up, its folder made").toBe("226 [] 226");
	const got = await request(`${ftp}/srv/hello.txt`, { user, password });
	check.expect(`${outcome(got)} ${got.text()}`, "FTP: text down").toBe("226 [] 226 Привет, FTP");
	const names = await request(`${ftp}/srv/`, { user, password, list: true });
	check.expect(names.text().trim(), "FTP: a folder's names").toBe("hello.txt");

	const big = "строка карты ".repeat(20000);
	fs.writeFileSync(`${dir}/net-up.txt`, big);
	const pushed = await request(`${ftp}/srv/big.txt`, { user, password, upload: true, file: `${dir}/net-up.txt` });
	check.expect(outcome(pushed), "FTP: a file of the game folder up").toBe("226 [] 226");
	const pulled = await request(`${ftp}/srv/big.txt`, { user, password, file: `${dir}/net-down.txt` });
	check.expect(`${outcome(pulled)} ${pulled.body.byteLength} ${fs.readFileSync(`${dir}/net-down.txt`) == big}`, "FTP: and down into another, past the plugin").toBe("226 [] 226 0 true");

	const lost = await request(`${ftp}/nowhere/x.txt`, { user, password, file: `${dir}/net-down.txt` });
	check.expect(`${outcome(lost)} ${fs.readFileSync(`${dir}/net-down.txt`) == big}`, "FTP: a folder that is not there; the older file stays").toBe("-1 [denied] 550 true");
	check.expect(outcome(await request(`${ftp}/srv/hello.txt`, { user, password: "wrong" })), "FTP: a refused login").toBe("-1 [login] 530");
	const outside = await request(`${ftp}/srv/hello.txt`, { user, password, file: "../server.cfg" });
	check.expect(`${outcome(outside)} ${outside.errorText}`, "a file outside the game folder").toBe("-1 [other] 0 file ../server.cfg is not a path inside the game folder");

	const sent = await request(`${sftp}/srv/hello.txt`, { user, password, upload: true, createDirs: true, body: "Привет, SFTP" });
	check.expect(outcome(sent), "SFTP: text up, its folder made").toBe("0 [] 0");
	const keyFile = `${dir}/net-request-key.pem`;
	const keyed = await request(`${sftp}/srv/`, { user, keyFile, keyPassphrase: "key secret", hostKey, list: true });
	check.expect(`${outcome(keyed)} ${keyed.text().trim()}`, "SFTP: a key with its passphrase, the host key checked").toBe("0 [] 0 hello.txt");
	check.expect(outcome(await request(`${sftp}/srv/hello.txt`, { user, keyFile, keyPassphrase: "key secret", hostKey: "AAAA" })), "SFTP: another host key").toBe("-1 [tls] 0");
	check.expect(outcome(await request(`${sftp}/nope.txt`, { user, password })), "SFTP: no such file, status 2").toBe("-1 [notFound] 2");
	// A user of its own, so curl opens a connection: one it reuses can answer within the millisecond.
	check.expect(outcome(await request(`${sftp}/srv/`, { user: "slow", password, timeout: 1 })), "a timeout").toBe("-1 [timeout] 0");

	const controller = new AbortController();
	const aborted = request(`${sftp}/srv/`, { user, password, signal: controller.signal });
	controller.abort();
	check.expect((await aborted).errorKind, "an abort").toBe("aborted");

	check.done();
}
