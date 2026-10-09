// perf's figures against its own past on the same CPU, for CI:
//
//   bun scripts/perf-history.ts <test:server's output> <history.json> <the CPU's name>
//
// perf's limits are ratios to Pawn with room for every runner, and a measure
// can grow severalfold inside its room - or past it on one CPU only, and pass
// again when the job is run again on another. So each Linux job keeps, per
// CPU, the measures of its last passing runs (CI's cache), and a measure more
// than three times its median there, and slower by more than a few
// nanoseconds, fails the job: on the same CPU that is the code, not the
// runner, until a bisect says otherwise. A run that fails is not kept, so a
// regression does not become the median; a slowdown taken on purpose starts
// a new history (the cache's key in ci.yml).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

// How much slower than its median a measure may be: times the ratio, and
// nanoseconds of plugin time - a measure of a few nanoseconds moves by more
// than three times from machine to machine of one CPU model.
const TIMES = 3;
const NANOSECONDS = 20;
// The runs kept per CPU, and how many it takes to have a median.
const KEPT = 10;
const ENOUGH = 3;

/** A measure of one run: its ratio to Pawn's and the plugin's time, in nanoseconds. */
interface Measure {
	ratio: number;
	ns: number;
}
interface History {
	cpu: string;
	runs: Record<string, Measure>[];
}

const [log, file, cpu] = process.argv.slice(2);
if (!log || !file || !cpu) {
	process.stderr.write('usage: bun scripts/perf-history.ts <test:server output> <history.json> <cpu>\n');
	process.exit(2);
}

// [perf] ok   health read: 0.92 times Pawn's (TypeScript 5, Pawn 5.5), at most 2: true
const LINE = /\[perf\] (?:ok {3}|FAIL )(.+?): ([\d.]+) times Pawn's \(TypeScript ([\d.]+),/;
const run: Record<string, Measure> = {};
for (const line of readFileSync(log, 'utf-8').split('\n')) {
	const match = LINE.exec(line);
	if (match) run[match[1]!] ??= { ratio: Number(match[2]), ns: Number(match[3]) };
}
if (Object.keys(run).length === 0) {
	console.log('perf did not run: nothing to compare');
	process.exit(0);
}

const history: History = existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : { cpu, runs: [] };

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const slower: string[] = [];
for (const [name, now] of Object.entries(run)) {
	const past = history.runs.map(one => one[name]).filter(one => one !== undefined);
	if (past.length < ENOUGH) continue;
	const ratio = median(past.map(one => one.ratio));
	const ns = median(past.map(one => one.ns));
	if (now.ratio > TIMES * ratio && now.ns > ns + NANOSECONDS) {
		slower.push(`${name}: ${now.ratio} times Pawn's (TypeScript ${now.ns} ns), ${(now.ratio / ratio).toFixed(1)} times its median of ${ratio} (${ns} ns) over the last ${past.length} runs`);
	}
}

if (slower.length > 0) {
	console.log(`FAIL perf on ${cpu} is slower than its own past on this CPU:`);
	for (const line of slower) console.log(`  ${line}`);
	console.log('The same CPU model ran it faster before: bisect it on this CPU, a passing rerun on another proves nothing.');
	process.exit(1);
}

history.runs = [...history.runs, run].slice(-KEPT);
writeFileSync(file, JSON.stringify({ cpu, runs: history.runs }));
console.log(`perf on ${cpu}: within ${TIMES} times its median over the last ${history.runs.length - 1} runs`);
