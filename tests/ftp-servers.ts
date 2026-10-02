// The FTP and SFTP servers the network client's FTP side is tested against,
// started in the test's own process on this machine: an FTP server (ftp-srv)
// over a temporary folder - or an FTPS one, TLS from the first byte with the
// certificate of tests/server/fixtures (Bun cannot turn a server's socket
// into TLS halfway, which AUTH TLS asks) - and an SFTP server (ssh2) over
// another, which takes a password or a public key. Nothing goes to the
// internet.
import type { AddressInfo } from 'node:net';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import FtpSrv from 'ftp-srv';
// @ts-ignore - ssh2 ships without types; the server below uses it loosely
import ssh2 from 'ssh2';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'server', 'fixtures');

/** The one account both servers take. */
export const USER = 'amxts';
export const PASSWORD = 'secret';

/** The certificate the FTPS server presents, as PEM: what a client trusts with `ca`. */
export const TEST_CA = readFileSync(join(FIXTURES, 'https-cert.pem'), 'utf8');

export interface TestServer {
	/** `ftp://127.0.0.1:<port>`, `ftps://...` or `sftp://...`, without a slash at the end. */
	url: string;
	/** The folder on disk the server serves. */
	root: string;
	stop: () => Promise<void>;
}

export interface TestSftp extends TestServer {
	/** The host key's SHA-256 fingerprint in base64, as `ssh-keygen -lf` prints it. */
	hostKey: string;
	/** A private key the server takes, as PEM, encrypted with `KEY_PASSPHRASE`. */
	privateKey: string;
}

export const KEY_PASSPHRASE = 'key secret';

/** A port no one listens on now, on `hostname`. */
async function freePort(hostname = '127.0.0.1'): Promise<number> {
	const server = createServer();
	await new Promise<void>(resolve => server.listen(0, hostname, resolve));
	const { port } = server.address() as AddressInfo;
	await new Promise(resolve => server.close(resolve));
	return port;
}

const quiet: any = { child: () => quiet, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

/**
 * An FTP server over a temporary folder, USER / PASSWORD - FTPS with `tls`.
 * It listens on `hostname`, and its URL names it `host`: what a client in a
 * container calls this machine. Its passive connections take the control
 * connection's host, as curl does by default, so no address is announced.
 */
export async function startTestFtp(tls = false, hostname = '127.0.0.1', host = '127.0.0.1'): Promise<TestServer> {
	const root = mkdtempSync(join(tmpdir(), 'amxts-ftp-'));
	const port = await freePort();
	const scheme = tls ? 'ftps' : 'ftp';
	const server = new FtpSrv({
		url: `${scheme}://${hostname}:${port}`,
		pasv_url: '127.0.0.1',
		log: quiet,
		tls: { key: readFileSync(join(FIXTURES, 'https-key.pem')), cert: readFileSync(join(FIXTURES, 'https-cert.pem')) },
	});
	// Each passive connection on a port the system hands out. A range of ports
	// may hold ones Windows reserves (Hyper-V, Docker Desktop): ftp-srv
	// answers EPSV there with no reply code, and curl waits for one forever.
	Object.assign(server, { getNextPasvPort: () => freePort(hostname) });
	server.on('login', ({ username, password }: { username: string; password: string }, resolve: (options: object) => void, reject: (error: Error) => void) => {
		if (username === USER && password === PASSWORD) resolve({ root });
		else reject(new Error('Login incorrect'));
	});
	await server.listen();
	return {
		url: `${scheme}://${host}:${port}`,
		root,
		stop: async () => {
			await server.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

// ---------------------------------------------------------------- SFTP

const { Server, utils } = ssh2 as any;
const { OPEN_MODE, STATUS_CODE } = utils.sftp;

/** An SFTP server over a temporary folder: USER with PASSWORD or the key it hands out; `hostname` and `host` as for FTP. */
export async function startTestSftp(hostname = '127.0.0.1', host = '127.0.0.1'): Promise<TestSftp> {
	const root = mkdtempSync(join(tmpdir(), 'amxts-sftp-'));
	const hostPair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
	const user = generateKeyPairSync('rsa', {
		modulusLength: 2048,
		privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-128-cbc', passphrase: KEY_PASSPHRASE },
		publicKeyEncoding: { type: 'spki', format: 'pem' },
	});
	const allowed = utils.parseKey(user.privateKey, KEY_PASSPHRASE);
	const hostKey = createHash('sha256').update(utils.parseKey(hostPair.privateKey).getPublicSSH()).digest('base64').replace(/=+$/, '');

	const server = new Server({ hostKeys: [hostPair.privateKey] }, (client: any) => {
		client.on('authentication', (context: any) => {
			if (context.username === USER && context.method === 'password' && context.password === PASSWORD) return context.accept();
			if (context.username === USER && context.method === 'publickey' && Buffer.compare(context.key.data, allowed.getPublicSSH()) === 0) {
				if (!context.signature || allowed.verify(context.blob, context.signature, context.hashAlgo)) return context.accept();
			}
			context.reject(['password', 'publickey']);
		});
		client.on('ready', () => client.on('session', (accept: () => any) => accept().on('sftp', (open: () => any) => serve(open(), root))));
		client.on('error', () => {});
	});
	await new Promise<void>(resolve => server.listen(0, hostname, resolve));
	const { port } = server.address() as AddressInfo;
	return {
		url: `sftp://${host}:${port}`,
		root,
		hostKey,
		privateKey: user.privateKey,
		stop: async () => {
			// Not waiting for close(): it waits for every client, and a client
			// such as curl keeps an idle connection open.
			server.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}

/** SFTP's status for a failed call on disk. */
function statusOf(error: unknown): number {
	const code = (error as NodeJS.ErrnoException).code;
	return code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : code === 'EACCES' || code === 'EPERM' ? STATUS_CODE.PERMISSION_DENIED : STATUS_CODE.FAILURE;
}

function attrsOf(path: string) {
	const stats = statSync(path);
	return { mode: stats.mode, uid: 0, gid: 0, size: stats.size, atime: Math.floor(stats.atimeMs / 1000), mtime: Math.floor(stats.mtimeMs / 1000) };
}

function longname(name: string, attrs: ReturnType<typeof attrsOf>): string {
	const kind = (attrs.mode & 0o170000) === 0o040000 ? 'd' : '-';
	return `${kind}rw-r--r--    1 amxts    amxts    ${String(attrs.size).padStart(8)} Jan  1 00:00 ${name}`;
}

/** The SFTP calls curl and ssh2-sftp-client make, over `root` - its `/`. */
function serve(sftp: any, root: string) {
	const handles = new Map<number, { fd: number } | { entries: string[]; dir: string }>();
	let next = 1;
	const real = (path: string) => join(root, posix.normalize(`/${path}`));
	const handle = (value: { fd: number } | { entries: string[]; dir: string }) => {
		const id = next++;
		handles.set(id, value);
		const buffer = Buffer.alloc(4);
		buffer.writeUInt32BE(id);
		return buffer;
	};
	const held = (buffer: Buffer) => handles.get(buffer.readUInt32BE(0));
	const run = (id: number, work: () => void) => {
		try {
			work();
		} catch (error) {
			sftp.status(id, statusOf(error));
		}
	};

	sftp.on('REALPATH', (id: number, path: string) => sftp.name(id, [{ filename: posix.normalize(`/${path}`), longname: '', attrs: {} }]));
	sftp.on('OPEN', (id: number, path: string, flags: number) => run(id, () => {
		const mode = flags & OPEN_MODE.WRITE ? (flags & OPEN_MODE.APPEND ? 'a' : 'w') : 'r';
		sftp.handle(id, handle({ fd: openSync(real(path), mode) }));
	}));
	sftp.on('READ', (id: number, buffer: Buffer, offset: number, length: number) => run(id, () => {
		const file = held(buffer) as { fd: number };
		const data = Buffer.alloc(length);
		const read = readSync(file.fd, data, 0, length, offset);
		if (read === 0) sftp.status(id, STATUS_CODE.EOF);
		else sftp.data(id, data.subarray(0, read));
	}));
	sftp.on('WRITE', (id: number, buffer: Buffer, offset: number, data: Buffer) => run(id, () => {
		writeSync((held(buffer) as { fd: number }).fd, data, 0, data.length, offset);
		sftp.status(id, STATUS_CODE.OK);
	}));
	sftp.on('CLOSE', (id: number, buffer: Buffer) => run(id, () => {
		const value = held(buffer);
		if (value && 'fd' in value) closeSync(value.fd);
		handles.delete(buffer.readUInt32BE(0));
		sftp.status(id, STATUS_CODE.OK);
	}));
	sftp.on('FSTAT', (id: number, buffer: Buffer) => run(id, () => {
		const stats = fstatSync((held(buffer) as { fd: number }).fd);
		sftp.attrs(id, { mode: stats.mode, uid: 0, gid: 0, size: stats.size, atime: 0, mtime: 0 });
	}));
	for (const event of ['STAT', 'LSTAT']) sftp.on(event, (id: number, path: string) => run(id, () => sftp.attrs(id, attrsOf(real(path)))));
	sftp.on('OPENDIR', (id: number, path: string) => run(id, () => sftp.handle(id, handle({ entries: readdirSync(real(path)), dir: real(path) }))));
	sftp.on('READDIR', (id: number, buffer: Buffer) => run(id, () => {
		const value = held(buffer) as { entries: string[]; dir: string };
		if (value.entries.length === 0) return sftp.status(id, STATUS_CODE.EOF);
		const names = value.entries.splice(0).map((filename) => {
			const attrs = attrsOf(join(value.dir, filename));
			return { filename, longname: longname(filename, attrs), attrs };
		});
		sftp.name(id, names);
	}));
	const done = (work: (id: number, ...args: any[]) => void) => (id: number, ...args: any[]) => run(id, () => {
		work(id, ...args);
		sftp.status(id, STATUS_CODE.OK);
	});
	sftp.on('MKDIR', done((_, path: string) => mkdirSync(real(path))));
	sftp.on('RMDIR', done((_, path: string) => rmdirSync(real(path))));
	sftp.on('REMOVE', done((_, path: string) => unlinkSync(real(path))));
	sftp.on('RENAME', done((_, from: string, to: string) => renameSync(real(from), real(to))));
	sftp.on('SETSTAT', done(() => {}));
	sftp.on('FSETSTAT', done(() => {}));
}
