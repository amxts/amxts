// The Docker server a project runs on (docker/server, the amxts-server image):
// which running containers mount the project, and their console.
//
// `amxts dev --docker` builds into dist/, which such a container reads where
// it is - its module reloads a plugin whose .aot changed - so nothing is
// deployed. What is left is showing the developer the server's answer, and
// that is the container's console: its amxts lines, as they come.
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import { c } from './ui';

/** Where the image takes a project from. */
const PROJECT_MOUNT = '/project';

/** The lines of the console worth showing beside a build: amxts', and errors. */
const WORTH_SHOWING = /\[amxts\]|run time error|fatal error/i;

/** A path as a mount's source is compared: absolute, one slash, one case on Windows. */
function samePath(path: string): string {
	const absolute = resolve(path).replace(/\\/g, '/').replace(/\/$/, '');
	return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

/**
 * The running containers that mount this folder as /project, by name. Null
 * when docker does not answer.
 */
export function projectContainers(projectDir: string): string[] | null {
	const running = spawnSync('docker', ['ps', '-q'], { encoding: 'utf-8' });
	if (running.error || running.status !== 0) return null;

	const ids = running.stdout.split(/\s+/).filter(Boolean);
	if (ids.length === 0) return [];

	const format = `{{.Name}}\t{{range .Mounts}}{{if eq .Destination "${PROJECT_MOUNT}"}}{{.Source}}{{end}}{{end}}`;
	const inspected = spawnSync('docker', ['inspect', '-f', format, ...ids], { encoding: 'utf-8' });
	if (inspected.error || inspected.status !== 0) return null;

	const wanted = samePath(projectDir);
	return inspected.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
		const [name, source] = line.split('\t');
		return source && samePath(source) === wanted ? [name.replace(/^\//, '')] : [];
	});
}

/**
 * Prints the amxts lines of each container's console from now on, for as
 * long as this process runs. With more than one, each line says whose.
 */
export function followConsoles(names: string[]): void {
	const since = new Date().toISOString();
	for (const name of names) {
		const logs = spawn('docker', ['logs', '-f', '--since', since, name], { stdio: ['ignore', 'pipe', 'pipe'] });
		let rest = '';
		const take = (chunk: Buffer) => {
			const lines = (rest + chunk.toString('utf-8')).split(/\r?\n/);
			rest = lines.pop() ?? '';
			for (const line of lines) {
				if (!WORTH_SHOWING.test(line)) continue;
				console.log(`  ${c.dim(names.length > 1 ? `${name} |` : '|')} ${line}`);
			}
		};
		logs.stdout.on('data', take);
		logs.stderr.on('data', take);
		process.on('exit', () => logs.kill());
	}
}

/** The command that starts the server for this project. */
export function runCommand(projectDir: string): string {
	return `docker run --rm -it -p 27015:27015/udp -v "${resolve(projectDir)}:${PROJECT_MOUNT}" amxts-server`;
}
