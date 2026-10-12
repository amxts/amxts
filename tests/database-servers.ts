// The MySQL and MariaDB servers the database suite (tests/server/database.ts)
// is checked against: containers of their official images, started by the
// runner for the run and removed after - amxts-test-mysql and
// amxts-test-mariadb, on ports Docker picks. MySQL signs its user in with
// caching_sha2_password and MariaDB with mysql_native_password, so the two
// cover both; each makes certificates of its own at its first start, so both
// speak TLS. Nothing goes to the internet but the images' download.
import { spawnSync } from 'node:child_process';

/** The account and database the suite uses on both. */
export const USER = 'amxts';
export const PASSWORD = 'secret';
export const DATABASE = 'amxts';
const ROOT_PASSWORD = 'root-secret';

interface Image {
	name: string;
	image: string;
	/** The client inside the image, which tells when the server takes connections. */
	client: string;
	env: string[];
}

const IMAGES: Image[] = [
	{
		name: 'amxts-test-mysql',
		image: 'mysql:8.4',
		client: 'mysql',
		env: [`MYSQL_ROOT_PASSWORD=${ROOT_PASSWORD}`, `MYSQL_DATABASE=${DATABASE}`, `MYSQL_USER=${USER}`, `MYSQL_PASSWORD=${PASSWORD}`],
	},
	{
		name: 'amxts-test-mariadb',
		image: 'mariadb:11.4',
		client: 'mariadb',
		env: [`MARIADB_ROOT_PASSWORD=${ROOT_PASSWORD}`, `MARIADB_DATABASE=${DATABASE}`, `MARIADB_USER=${USER}`, `MARIADB_PASSWORD=${PASSWORD}`],
	},
];

const READY_TIMEOUT = 180_000;

function docker(...args: string[]): { ok: boolean; out: string } {
	const run = spawnSync('docker', args, { encoding: 'utf8' });
	return { ok: run.status === 0, out: `${run.stdout ?? ''}${run.stderr ?? ''}`.trim() };
}

/** Whether Docker answers on this machine: without it the suite is skipped there. */
export function dockerRunning(): boolean {
	return docker('info', '--format', '{{.ServerVersion}}').ok;
}

export interface TestDatabases {
	/** `mysql://amxts:secret@<host>:<port>/amxts` of each, without options. */
	mysql: string;
	mariadb: string;
	stop: () => void;
}

/**
 * Starts both servers, listening on `listen` (the loopback, or every
 * interface for a server in a container), and gives their addresses with
 * `announce` as the host a plugin reaches them by. Waits until each takes
 * connections - over TCP, as the root user, so the suite's user still signs
 * in for the first time, the full way.
 */
export async function startTestDatabases(listen: string, announce: string): Promise<TestDatabases> {
	const ports: number[] = [];
	for (const image of IMAGES) {
		docker('rm', '-f', image.name);
		const started = docker('run', '-d', '--name', image.name, '-p', `${listen}::3306`, ...image.env.flatMap(e => ['-e', e]), image.image);
		if (!started.ok) throw new Error(`could not start ${image.image}: ${started.out}`);
		const port = docker('port', image.name, '3306/tcp').out.split('\n')[0]?.split(':').pop();
		ports.push(Number(port));
	}
	const stop = () => {
		for (const image of IMAGES) docker('rm', '-f', image.name);
	};

	const deadline = Date.now() + READY_TIMEOUT;
	for (const image of IMAGES) {
		for (;;) {
			const ping = docker('exec', image.name, image.client, '-h127.0.0.1', '-uroot', `-p${ROOT_PASSWORD}`, '-e', 'SELECT 1');
			if (ping.ok) break;
			if (Date.now() > deadline) {
				stop();
				throw new Error(`${image.image} did not start: ${docker('logs', '--tail', '20', image.name).out}`);
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}

	const url = (port: number) => `mysql://${USER}:${PASSWORD}@${announce}:${port}/${DATABASE}`;
	return { mysql: url(ports[0]), mariadb: url(ports[1]), stop };
}
