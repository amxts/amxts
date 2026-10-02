import type { FakeServer } from '@amxts/core/test-utils';
import type { TestServer, TestSftp } from './ftp-servers';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { loadPlugin } from '@amxts/core/test-utils';
// The kit's request (as/fetch.ts) over FTP, FTPS and SFTP on the fake
// server, which reaches the in-process servers of tests/ftp-servers.ts with
// basic-ftp and ssh2-sftp-client: tests/as/net-request.ts writes, reads,
// lists, renames and streams files of the game folder, and gets the kinds of
// error and the reply codes the module's network client gives.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { KEY_PASSPHRASE, PASSWORD, startTestFtp, startTestSftp, TEST_CA, USER } from './ftp-servers';

setDefaultTimeout(120_000);

let ftp: TestServer;
let ftps: TestServer;
let sftp: TestSftp;
let server: FakeServer;

/** Where the test puts the SFTP key, in the game folder. */
const KEY_FILE = 'addons/amxmodx/data/id_rsa';

/** Bytes no text decoder keeps as they are: a file the request must stream untouched. */
const BINARY = new Uint8Array(70_000).map((_, i) => (i * 7 + 3) % 256);

beforeAll(async () => {
	[ftp, ftps, sftp] = await Promise.all([startTestFtp(), startTestFtp(true), startTestSftp()]);
	server = await loadPlugin('tests/as/net-request.ts', { files: { 'ca.pem': TEST_CA, [KEY_FILE]: sftp.privateKey } });
	server.files.set('maps/test.bsp', BINARY);
});

afterAll(async () => {
	await Promise.all([ftp?.stop(), ftps?.stop(), sftp?.stop()]);
});

/** Runs a command and lets its requests come back; the lines it logged. */
async function run(command: string): Promise<string[]> {
	const from = server.logLines.length;
	server.serverCommand(command);
	await server.responses();
	return server.logLines.slice(from);
}

describe('FTP', () => {
	const account = `${USER} ${PASSWORD}`;

	test('an upload of text makes its folders; a download and the names read it back', async () => {
		expect(await run(`net_put ${ftp.url}/up/hello.txt ${account}`)).toEqual(['put 226 [] 226 ']);
		// Cyrillic on purpose: the text is UTF-8 both ways.
		expect(readFileSync(join(ftp.root, 'up/hello.txt'), 'utf8')).toBe('Привет, FTP');
		expect(await run(`net_get ${ftp.url}/up/hello.txt ${account}`)).toEqual(['get 226 [] 226 Привет, FTP']);
		expect(await run(`net_names ${ftp.url}/up/ ${account}`)).toEqual(['names 226 [] 226 hello.txt']);
	});

	test('a file of the game folder goes up and comes down byte for byte, past the plugin', async () => {
		expect(await run(`net_push ${ftp.url}/maps/test.bsp ${account} maps/test.bsp`)).toEqual(['push 226 [] 226 ']);
		expect(new Uint8Array(readFileSync(join(ftp.root, 'maps/test.bsp')))).toEqual(BINARY);
		expect(await run(`net_pull ${ftp.url}/maps/test.bsp ${account} maps/copy.bsp`)).toEqual(['pull 226 [] 226 ']);
		expect(server.files.get('maps/copy.bsp')).toEqual(BINARY);
	});

	test('quote commands alone, with HEAD: a rename', async () => {
		await run(`net_put ${ftp.url}/quote/a.txt ${account}`);
		expect(await run(`net_quote ${ftp.url}/ ${account} RNFR quote/a.txt|RNTO quote/b.txt`)).toEqual(['quote 250 [] 250 ']);
		expect(existsSync(join(ftp.root, 'quote/b.txt'))).toBe(true);
	});

	test('a refused login, a folder that is not there: their kinds and reply codes', async () => {
		expect(await run(`net_get ${ftp.url}/up/hello.txt ${USER} wrong`)).toEqual(['get -1 [login] 530 ']);
		expect(await run(`net_get ${ftp.url}/nowhere/x.txt ${account}`)).toEqual(['get -1 [denied] 550 ']);
	});

	test('FTPS with a certificate of its own: trusted through ca, refused without', async () => {
		mkdirSync(join(ftps.root, 'tls'));
		writeFileSync(join(ftps.root, 'tls/x.txt'), 'x');
		expect(await run(`net_tls ${ftps.url}/tls/ ${account} ca.pem`)).toEqual(['trusted 226 [] 226 x.txt', 'untrusted -1 [tls] 0 ']);
	});

	test('a timeout, an abort and a file outside the game folder', async () => {
		const silent = createServer(() => {});
		await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
		const port = (silent.address() as { port: number }).port;
		try {
			expect(await run(`net_timeout ftp://127.0.0.1:${port}/ ${account}`)).toEqual(['timeout -1 [timeout] 0 ']);
		} finally {
			silent.close();
		}
		expect(await run(`net_abort ${ftp.url}/up/hello.txt ${account}`)).toEqual(['abort -1 [aborted] 0 ']);
		expect(await run(`net_outside ${ftp.url}/up/hello.txt ${account}`)).toEqual(['outside [other] file ../server.cfg is not a path inside the game folder']);
	});
});

describe('SFTP', () => {
	const account = `${USER} ${PASSWORD}`;

	test('an upload of text makes its folders; a download and the names read it back', async () => {
		expect(await run(`net_put ${sftp.url}/up/hello.txt ${account}`)).toEqual(['put 0 [] 0 ']);
		// Cyrillic on purpose: the text is UTF-8 both ways.
		expect(readFileSync(join(sftp.root, 'up/hello.txt'), 'utf8')).toBe('Привет, FTP');
		expect(await run(`net_get ${sftp.url}/up/hello.txt ${account}`)).toEqual(['get 0 [] 0 Привет, FTP']);
		expect(await run(`net_names ${sftp.url}/up/ ${account}`)).toEqual(['names 0 [] 0 hello.txt']);
	});

	test('a file of the game folder goes up and comes down byte for byte', async () => {
		expect(await run(`net_push ${sftp.url}/maps/test.bsp ${account} maps/test.bsp`)).toEqual(['push 0 [] 0 ']);
		expect(new Uint8Array(readFileSync(join(sftp.root, 'maps/test.bsp')))).toEqual(BINARY);
		expect(await run(`net_pull ${sftp.url}/maps/test.bsp ${account} maps/sftp.bsp`)).toEqual(['pull 0 [] 0 ']);
		expect(server.files.get('maps/sftp.bsp')).toEqual(BINARY);
	});

	test('quote commands: a rename', async () => {
		await run(`net_put ${sftp.url}/quote/a.txt ${account}`);
		expect(await run(`net_quote ${sftp.url}/ ${account} rename /quote/a.txt /quote/b.txt`)).toEqual(['quote 0 [] 0 ']);
		expect(existsSync(join(sftp.root, 'quote/b.txt'))).toBe(true);
	});

	test('no such file is SFTP\'s status 2; a refused login', async () => {
		expect(await run(`net_get ${sftp.url}/nope.txt ${account}`)).toEqual(['get -1 [notFound] 2 ']);
		expect(await run(`net_get ${sftp.url}/up/hello.txt ${USER} wrong`)).toEqual(['get -1 [login] 0 ']);
	});

	test('a key with its passphrase, the host key checked: the right one taken, another refused', async () => {
		await run(`net_put ${sftp.url}/keyed/x.txt ${account}`);
		expect(await run(`net_key ${sftp.url}/keyed/ ${USER} ${KEY_FILE} ${sftp.hostKey} ${KEY_PASSPHRASE}`)).toEqual(['key 0 [] 0 x.txt']);
		const other = `${sftp.hostKey.slice(0, -4)}AAAA`;
		expect(await run(`net_key ${sftp.url}/keyed/ ${USER} ${KEY_FILE} ${other} ${KEY_PASSPHRASE}`)).toEqual(['key -1 [tls] 0 ']);
	});
});
