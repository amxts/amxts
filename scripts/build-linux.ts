// Builds the Linux module and wamrc in Docker, on any machine that has it:
//
//   bun run build:linux        runtime/build/linux/amxts_amxx_i386.so and wamrc
//
// The toolchain is the amxts-build image (docker/build/Dockerfile): an old
// Ubuntu for an old glibc, gcc -m32 for the module, a prebuilt LLVM 18 for
// wamrc. The repository goes in read-only; the checkouts and build folders
// live in the Docker volume amxts-linux-work, so a second run only rebuilds
// what changed. What it builds is docker/build/build.sh.
//
// The module carries the generated natives.h and embedded.h, so this comes
// after `bun run generate`, like the Windows build.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(CORE, 'runtime/build/linux');
const IMAGE = process.env.AMXTS_BUILD_IMAGE ?? 'amxts-build';
const VOLUME = process.env.AMXTS_BUILD_VOLUME ?? 'amxts-linux-work';

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

function docker(args: string[]): void {
	const result = spawnSync('docker', args, { stdio: 'inherit' });
	if (result.error) fail(`docker did not start: ${result.error.message} - is Docker installed and running?`);
	if (result.status !== 0) fail(`docker ${args[0]} failed (exit ${result.status})`);
}

for (const file of ['runtime/src/natives.h', 'runtime/src/embedded.h']) {
	if (!existsSync(join(CORE, file))) fail(`${file} is missing - run bun run generate first`);
}

mkdirSync(OUT, { recursive: true });

// Cached after the first time: a rebuild only when the Dockerfile changed.
// --load puts it where `docker run` finds it also when the builder is a
// container of its own (CI's, set up by docker/setup-buildx-action).
docker(['build', '--load', '--quiet', '-t', IMAGE, join(CORE, 'docker/build')]);

docker([
	'run',
	'--rm',
	'-v',
	`${CORE}:/src:ro`,
	'-v',
	`${VOLUME}:/work`,
	'-v',
	`${OUT}:/out`,
	'-e',
	`JOBS=${process.env.JOBS ?? '2'}`,
	IMAGE,
	'sh',
	'/src/docker/build/build.sh',
]);

console.log(`✅ ${OUT}`);
