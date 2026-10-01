// One part of the test suite, for CI's jobs that run side by side:
//
//   bun run test:part <part> <parts>     e.g. bun run test:part 2 3
//
// The test files, sorted, are dealt out in turn: every <parts>-th one from
// the <part>-th.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import process from 'node:process';

const [part, parts] = process.argv.slice(2).map(Number);
if (!(part >= 1 && part <= parts)) throw new Error('bun run test:part <part> <parts>, the part from 1');
const files = readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().filter((_, i) => i % parts === part - 1);
process.exit(spawnSync(process.execPath, ['test', '--smol', ...files.map(name => `tests/${name}`)], { stdio: 'inherit' }).status ?? 1);
