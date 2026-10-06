// A Linux server's container that stopped on its own: how it stopped, and the
// backtrace of the core dump hlds left - for test:server --linux and
// test:release, whose servers have exited once or twice with nothing in the
// console.
//
// The container starts with core dumps on and a folder of the runner's
// mounted at /cores (coreDumpArgs). Where the kernel writes a core is its
// core_pattern, one for the whole Docker host: `/cores/core.%e.%p` puts it
// into that folder - CI sets it, and on Docker Desktop
//
//   docker run --rm --privileged debian:bookworm-slim sh -c 'echo /cores/core.%e.%p > /proc/sys/kernel/core_pattern'
//
// does, until Docker restarts. With another pattern there is no core, and the
// report says what the pattern is.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function docker(argv: string[]) {
	return spawnSync('docker', argv, { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024 });
}

/** What `docker create`/`docker run` is given for hlds to leave a core dump in `dir`. */
export function coreDumpArgs(dir: string): string[] {
	mkdirSync(dir, { recursive: true });
	// The server image's hlds runs as a user of its own.
	chmodSync(dir, 0o777);
	return ['--ulimit', 'core=-1', '-v', `${dir}:/cores`];
}

/**
 * How the stopped `container` went - its exit code, the signal, out of
 * memory - and, for each core dump in `dir`, every thread's backtrace: gdb
 * reads it in a container of the stopped one's own files (`docker commit`),
 * installed there when the image has none. The backtrace is also written to
 * `dir`/backtrace.txt.
 */
export function crashReport(container: string, dir: string): string[] {
	const [code, oom, from] = (docker(['container', 'inspect', '-f', '{{.State.ExitCode}} {{.State.OOMKilled}} {{.Config.Image}}', container]).stdout ?? '').trim().split(' ');
	const signal = Number(code) > 128 ? ` (signal ${Number(code) - 128})` : '';
	const lines = [`the container exited with code ${code}${signal}${oom === 'true' ? ', out of memory' : ''}`];
	const cores = existsSync(dir) ? readdirSync(dir).filter(file => file.startsWith('core')) : [];
	if (cores.length === 0) {
		const pattern = (docker(['run', '--rm', '--entrypoint', 'cat', from, '/proc/sys/kernel/core_pattern']).stdout ?? '').trim();
		lines.push(`no core dump: the Docker host's core_pattern is "${pattern || '?'}", /cores/core.%e.%p puts one in ${dir}`);
		return lines;
	}

	const image = `${container}-crash`;
	const committed = docker(['commit', container, image]);
	if (committed.status !== 0) return [...lines, `docker commit failed: ${committed.stderr.trim()}`];
	const script = [
		'command -v gdb > /dev/null || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends gdb; } > /dev/null 2>&1',
		'for core in /cores/core*; do echo "== $core"; gdb -batch -q -ex bt -ex "thread apply all bt" -ex "info sharedlibrary" /hlds/hlds_linux "$core" 2>&1; done',
		// Written by the server's user, read by the runner's.
		'chmod a+r /cores/*',
	].join('\n');
	const gdb = docker(['run', '--rm', '--user', 'root', '--entrypoint', 'sh', '-v', `${dir}:/cores`, image, '-c', script]);
	docker(['rmi', image]);
	const backtrace = `${gdb.stdout ?? ''}${gdb.stderr ?? ''}`.trim();
	writeFileSync(join(dir, 'backtrace.txt'), `${backtrace}\n`);
	return [...lines, `core dumps: ${cores.join(', ')}`, ...backtrace.split('\n')];
}
