// The unit tests: every tests/*.test.ts in a `bun test` of its own, several
// at once.
//
//   bun run test                  every file
//   bun run test showcase timers  the files whose names hold these words
//   bun run test --changed        the files that what changed since origin/next reaches
//   bun run test --part 2/3       every third file from the second: CI's parts
//   bun run test --jobs 3         three at once (AMXTS_TEST_JOBS; one fewer than the CPUs by default)
//
// A line per file as it ends, a failure as soon as bun reports it, the
// slowest files at the end; dist/test-progress.txt says where the run is
// (scripts/test-progress.ts).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { clock, testProgress } from './test-progress';

const args = process.argv.slice(2);
function option(name: string): string | undefined {
	const at = args.indexOf(name);
	return at < 0 ? undefined : args.splice(at, 2)[1];
}
const part = option('--part');
const jobs = Math.max(1, Number(option('--jobs') ?? process.env.AMXTS_TEST_JOBS) || availableParallelism() - 1);
const changed = args.includes('--changed') && args.splice(args.indexOf('--changed'), 1).length > 0;

let files = readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`);
if (part) {
	const [k, n] = part.split('/').map(Number);
	if (!(k >= 1 && k <= n)) throw new Error('bun run test --part <part>/<parts>, the part from 1');
	files = files.filter((_, i) => i % n === k - 1);
}
if (args.length) files = files.filter(file => args.some(word => file.includes(word)));
if (changed) files = reachedByChanges(files);
if (!files.length) {
	console.log('no test files to run');
	process.exit(0);
}

const parallel = Math.min(jobs, files.length);
const progress = testProgress('test', files.map(file => file.slice('tests/'.length, -'.test.ts'.length)), parallel);
const queue = progress.longestFirst();
const failed: string[] = [];
let pass = 0;
const begun = Date.now();

function runFile(item: string): Promise<void> {
	const file = `tests/${item}.test.ts`;
	progress.start(item);
	return new Promise((finish) => {
		const child = spawn(process.execPath, ['test', '--smol', file], { stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		let partial = '';
		const take = (chunk: Buffer) => {
			output += chunk;
			const lines = (partial + chunk).split('\n');
			partial = lines.pop()!;
			// bun prints a failed test's error, then `(fail) <name>`.
			for (const line of lines.filter(line => line.startsWith('(fail)'))) progress.fail(`${file} > ${line.slice(6).trim()}`);
		};
		child.stdout.on('data', take);
		child.stderr.on('data', take);
		child.on('close', (code) => {
			const count = (word: string) => Number(new RegExp(`^\\s*(\\d+) ${word}$`, 'm').exec(output)?.[1] ?? 0);
			pass += count('pass');
			if (code !== 0) {
				failed.push(file);
				if (!count('fail')) progress.fail(`${file} > exit ${code}`);
			}
			progress.end(item, code === 0, `${count('pass')} pass${count('fail') ? `, ${count('fail')} fail` : ''}`);
			if (code !== 0) console.log(output.trimEnd().replace(/^/gm, '    '));
			finish();
		});
	});
}

console.log(`${files.length} test files, ${parallel} at once`);
await Promise.all(Array.from({ length: parallel }, async () => {
	for (let item = queue.shift(); item; item = queue.shift()) await runFile(item);
}));

progress.finish();
console.log(failed.length
	? `FAIL: ${failed.length} of ${files.length} files failed, ${pass} tests passed (${clock(Date.now() - begun)})\n${progress.failures.map(line => `  ${line}`).join('\n')}`
	: `${pass} tests passed in ${files.length} files (${clock(Date.now() - begun)})`);
process.exit(failed.length ? 1 : 0);

/**
 * The test files a change since origin/next reaches - committed, staged,
 * in the working tree or new: the file itself, what it imports, the plugins
 * it names (tests/as/...) with their imports, and for a file that compiles
 * a plugin, the hood the plugin is compiled with (as/, runtime/patches/).
 */
function reachedByChanges(tests: string[]): string[] {
	const git = (...command: string[]) => spawnSync('git', command, { encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
	const base = git('merge-base', 'HEAD', 'origin/next')[0] ?? 'HEAD';
	const touched = new Set([...git('diff', '--name-only', base), ...git('ls-files', '--others', '--exclude-standard')].map(file => resolve(file)));
	const hood = [...touched].some(file => /^(?:as|runtime[\\/]patches)[\\/]/.test(relative('.', file)));
	const compiler = resolve('src/testing/compile.ts');
	console.log(`${touched.size} file(s) changed since ${base.slice(0, 10)}`);
	return tests.filter((test) => {
		const text = readFileSync(test, 'utf8');
		const named = [...text.matchAll(/tests\/as\/[\w./-]+\.ts/g)].map(([path]) => path);
		const reached = importClosure([test, ...named]);
		return [...reached].some(file => touched.has(file)) || (hood && reached.has(compiler));
	});
}

/** `entries` and every file they import, relatively or as `@amxts/core/...`, read off their import lines. */
function importClosure(entries: string[]): Set<string> {
	const exports: Record<string, string> = JSON.parse(readFileSync('package.json', 'utf8')).exports;
	const files = new Set<string>();
	const visit = (file: string) => {
		const path = [file, `${file}.ts`, join(file, 'index.ts')].find(each => existsSync(each) && statSync(each).isFile());
		if (!path || files.has(resolve(path))) return;
		files.add(resolve(path));
		if (!/\.[cm]?[jt]s$/.test(path)) return;
		for (const [, spec] of readFileSync(path, 'utf8').matchAll(/(?:from|import)\s*\(?['"]([^'"]+)['"]/g)) {
			if (spec.startsWith('.')) {
				visit(resolve(dirname(path), spec));
			} else if (spec.startsWith('@amxts/core')) {
				const sub = `.${spec.slice('@amxts/core'.length)}`;
				visit(resolve(exports[sub] ?? sub));
			}
		}
	};
	entries.forEach(entry => visit(resolve(entry)));
	return files;
}
