// bun run server:image: the Linux server kit, then the server image from it
// (docker/server), under the name `amxts dev --docker` gives a project of this
// core - ghcr.io/amxts/server:<version>, which CI publishes for a release. A
// local build of that name is the one `docker run` takes. Run `bun run
// build:linux` first: the kit needs the Linux module and wamrc.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { SERVER_IMAGE } from './docker-server';

for (const [file, args] of [
	[process.execPath, ['scripts/pack-server.ts', '--os', 'linux']],
	['docker', ['build', '--load', '-t', SERVER_IMAGE, '--build-context', 'kit=dist-server/linux', 'docker/server']],
] as const) {
	const result = spawnSync(file, args, { stdio: 'inherit' });
	if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`\n✅ ${SERVER_IMAGE}`);
