// How the amxts command runs one of these scripts with Bun:
//
//   bun scripts/run.ts build-wasm.ts --deploy
//
// The script sees its own arguments, as if it were started by itself, and
// whatever it throws - a config it cannot read, a module that is not
// installed - is printed as the error it is, without Bun's stack (that is
// for --debug, which sets AMXTS_DEBUG).
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { report } from './ui';

const [script, ...args] = process.argv.slice(2);
process.argv = [process.argv[0], join(dirname(fileURLToPath(import.meta.url)), script), ...args];

function fail(error: unknown) {
	report(error);
	process.exit(1);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

try {
	await import(`./${script}`);
} catch (error) {
	fail(error);
}
