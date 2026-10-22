// The unit tests: every tests/*.test.ts on Vitest, several files at once.
//
//   npm test                  every file
//   npm test showcase timers  the files whose names hold these words
//   npm test -- --changed     the files that what changed since origin/next reaches
//   npm test -- --part 2/3    every third file from the second: CI's parts
//   npm test -- --jobs 3      three at once (AMXTS_TEST_JOBS; half the CPUs by default)
//
// A line per file as it ends, a failure as soon as Vitest reports it, the
// slowest files at the end; dist/test-progress.txt says where the run is
// (scripts/test-progress.ts). vitest.config.ts is the rest: a single file
// runs with `npx vitest run tests/<name>.test.ts` too.
import type { Reporter, TestModule, TestSpecification } from 'vitest/node';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { availableParallelism, constants, setPriority } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { BaseSequencer, createVitest } from 'vitest/node';
import { clock, testProgress } from './test-progress';

const args = process.argv.slice(2);
function option(name: string): string | undefined {
	const at = args.indexOf(name);
	return at < 0 ? undefined : args.splice(at, 2)[1];
}
const part = option('--part');
const jobs = Math.max(1, Number(option('--jobs') ?? process.env.AMXTS_TEST_JOBS) || Math.floor(availableParallelism() / 2));
const changed = args.includes('--changed') && args.splice(args.indexOf('--changed'), 1).length > 0;

let files = readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort().map(name => `tests/${name}`);
if (part) {
	const [k, n] = part.split('/').map(Number);
	if (!(k >= 1 && k <= n)) throw new Error('npm test -- --part <part>/<parts>, the part from 1');
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
const order = progress.longestFirst();
const itemOf = (path: string) => relative('tests', path).slice(0, -'.test.ts'.length).replaceAll('\\', '/');
let pass = 0;
let skip = 0;
const failed: string[] = [];
const begun = Date.now();

/** A line per file and a failure at once, through testProgress. */
const reporter: Reporter = {
	onTestModuleQueued: module => progress.start(itemOf(module.moduleId)),
	onTestCaseResult(test) {
		if (test.result().state === 'failed') progress.fail(`tests/${itemOf(test.module.moduleId)}.test.ts > ${test.fullName}`);
	},
	onTestModuleEnd(module: TestModule) {
		const item = itemOf(module.moduleId);
		const states = [...module.children.allTests()].map(test => test.result().state);
		const count = (state: string) => states.filter(each => each === state).length;
		pass += count('passed');
		skip += count('skipped');
		const errors = [...module.errors(), ...[...module.children.allTests()].flatMap(test => test.result().errors ?? [])];
		const ok = module.ok() && !errors.length;
		if (!ok) {
			failed.push(item);
			if (!count('failed')) progress.fail(`tests/${item}.test.ts > ${module.errors()[0]?.message ?? 'did not run'}`);
		}
		const summary = [[count('passed'), 'pass'], [count('skipped'), 'skip'], [count('failed'), 'fail']].filter(([n]) => n).map(([n, word]) => `${n} ${word}`).join(', ');
		progress.end(item, ok, summary);
		for (const error of errors) console.log(`${error.message}\n${error.diff ?? ''}\n${error.stack ?? ''}`.trimEnd().replace(/^/gm, '    '));
	},
};

/** The files longest first, by the last run's times: the slowest is not left for the end. */
class LongestFirst extends BaseSequencer {
	override async sort(specifications: TestSpecification[]) {
		return specifications.sort((a, b) => order.indexOf(itemOf(a.moduleId)) - order.indexOf(itemOf(b.moduleId)));
	}
}

// Below the machine's other work, and the files' processes with it, which
// inherit it: the machine stays responsive while the files run.
setPriority(0, constants.priority.PRIORITY_BELOW_NORMAL);
console.log(`${files.length} test files, ${parallel} at once`);
const vitest = await createVitest('test', {
	watch: false,
	maxWorkers: parallel,
	reporters: [reporter],
	sequence: { sequencer: LongestFirst },
});
await vitest.start(files.map(file => resolve(file)));
await vitest.close();

progress.finish();
const skipped = skip ? `, ${skip} skipped` : '';
console.log(failed.length
	? `FAIL: ${failed.length} of ${files.length} files failed, ${pass} tests passed${skipped} (${clock(Date.now() - begun)})\n${progress.failures.map(line => `  ${line}`).join('\n')}`
	: `${pass} tests passed${skipped} in ${files.length} files (${clock(Date.now() - begun)})`);
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
