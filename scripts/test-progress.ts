// Where a test run is, as it goes: a line per test file or suite as it ends,
// a failure as soon as it is seen, and the state in dist/<name>-progress.txt -
// `cat` it to watch a run in the background or one whose output goes to a log.
// Each item's time is kept in node_modules/.cache/amxts/<name>-times.json:
// the next run starts the longest first and estimates what is left from them,
// and the run ends with its slowest items.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export interface Progress {
	/** The items, longest first by the last run: an order to run them in when any will do. */
	longestFirst: () => string[];
	/** What the run does now, before or between the items: building, starting the server. */
	phase: (text: string) => void;
	start: (item: string) => void;
	/** A failure, printed now. */
	fail: (line: string) => void;
	/** The item's line; `ok` false prints FAIL. */
	end: (item: string, ok: boolean, summary: string) => void;
	/** The slowest items, and their times kept for the next run. */
	finish: () => void;
	failures: string[];
}

/** The progress of a run of `items`, `jobs` at once. */
export function testProgress(name: string, items: string[], jobs = 1): Progress {
	const total = items.length;
	const timesFile = `node_modules/.cache/amxts/${name}-times.json`;
	const progressFile = `dist/${name}-progress.txt`;
	const before: Record<string, number> = existsSync(timesFile) ? JSON.parse(readFileSync(timesFile, 'utf8')) : {};
	const known = Object.values(before).sort((a, b) => a - b);
	const guess = known[known.length >> 1] ?? 10;
	const expected = (item: string) => before[item] ?? guess;

	const begun = Date.now();
	const running = new Map<string, number>();
	const times: Record<string, number> = {};
	const failures: string[] = [];
	let waiting = [...items];
	let phase = '';

	/** What is left, from the last run's times: the items not started and the rest of the running ones, over the jobs. */
	const left = () => {
		const now = Date.now();
		const rest = [...running].reduce((sum, [item, since]) => sum + Math.max(0, expected(item) - (now - since) / 1000), 0);
		return (waiting.reduce((sum, item) => sum + expected(item), 0) + rest) / Math.max(1, Math.min(jobs, waiting.length + running.size)) * 1000;
	};
	const done = () => Object.keys(times).length;
	const write = () => {
		mkdirSync(dirname(progressFile), { recursive: true });
		writeFileSync(progressFile, `${[
			`started ${new Date(begun).toLocaleString()}, ${clock(Date.now() - begun)} ago${jobs > 1 ? `, ${jobs} at once` : ''}`,
			`done ${done()} of ${total}, ~${clock(left())} left`,
			`failures ${failures.length}${failures.map(line => `\n  ${line}`).join('')}`,
			`running ${[...running].map(([item, since]) => `${item} (${clock(Date.now() - since)})`).join(', ') || phase || '-'}`,
		].join('\n')}\n`);
	};

	return {
		failures,
		longestFirst() {
			return [...items].sort((a, b) => expected(b) - expected(a));
		},
		phase(text) {
			phase = text;
			write();
		},
		start(item) {
			waiting = waiting.filter(each => each !== item);
			phase = '';
			running.set(item, Date.now());
			write();
		},
		fail(line) {
			failures.push(line);
			console.log(`FAIL ${line}`);
			write();
		},
		end(item, ok, summary) {
			times[item] = Math.round((Date.now() - running.get(item)!) / 100) / 10;
			running.delete(item);
			const width = String(total).length;
			console.log(`[${String(done()).padStart(width)}/${total} ${clock(Date.now() - begun)}, ~${clock(left())} left] ${ok ? 'ok  ' : 'FAIL'} ${item}  ${summary}  ${times[item]}s`);
			write();
		},
		finish() {
			const slowest = Object.entries(times).sort(([, a], [, b]) => b - a).slice(0, 8);
			console.log(`\nslowest: ${slowest.map(([item, seconds]) => `${item} ${seconds}s`).join(', ')}`);
			mkdirSync(dirname(timesFile), { recursive: true });
			writeFileSync(timesFile, JSON.stringify({ ...before, ...times }, null, '\t'));
		},
	};
}
