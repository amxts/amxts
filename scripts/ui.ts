// How the build scripts talk, as the amxts command does: colors when the
// terminal has them, one line per step, and an error as one line with a hint
// under it. The stack of an error is printed only with --debug (the command
// passes it on as AMXTS_DEBUG=1).
import process from 'node:process';

/** Whether the output takes colors: a terminal, and NO_COLOR not set; FORCE_COLOR wins. */
function colorful(stream = process.stdout): boolean {
	if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0') return true;
	if (process.env.NO_COLOR !== undefined || process.env.TERM === 'dumb') return false;
	return Boolean(stream.isTTY);
}

const enabled = colorful();

function paint(open: number, close: number) {
	return (text: unknown) => (enabled ? `\x1B[${open}m${text}\x1B[${close}m` : String(text));
}

export const c = {
	bold: paint(1, 22),
	dim: paint(2, 22),
	red: paint(31, 39),
	green: paint(32, 39),
	yellow: paint(33, 39),
	blue: paint(34, 39),
	magenta: paint(35, 39),
	cyan: paint(36, 39),
	gray: paint(90, 39),
};

export const debug = () => process.argv.includes('--debug') || process.env.AMXTS_DEBUG === '1';

export const log = {
	info: (text: string) => console.log(`${c.cyan('i')} ${text}`),
	success: (text: string) => console.log(`${c.green('✔')} ${text}`),
	warn: (text: string) => console.log(`${c.yellow('▲')} ${text}`),
	step: (text: string) => console.log(`${c.cyan('◇')} ${text}`),
	error: (text: string) => process.stderr.write(`${c.red('✖')} ${text}\n`),
	hint: (text: string) => process.stderr.write(`${String(text).split('\n').map(line => `  ${c.dim(line)}`).join('\n')}\n`),
};

/** Seconds since `started` (a `performance.now()`), as a report shows them: `3.1s`. */
export function since(started: number): string {
	return `${((performance.now() - started) / 1000).toFixed(1)}s`;
}

/**
 * A step that takes a while, said as it starts - `◇ compiling hello` - and
 * ended with the line that says it is done, or with none when an error says
 * it instead. In a terminal the step's line is rewritten by its end; in a log
 * (CI, a pipe) the start is a line of its own.
 */
export function progress(text: string) {
	const live = Boolean(process.stdout.isTTY) && !process.env.CI;
	process.stdout.write(`${c.cyan('◇')} ${text}${live ? '' : '\n'}`);
	return {
		end(done?: string) {
			if (live) process.stdout.write('\r\x1B[2K');
			if (done) log.success(done);
		},
	};
}

/**
 * An error, printed as the user should see it: its first line, then the rest
 * of it - or its `hint`, what to do about it; the stack only with --debug.
 */
export function report(error: unknown): void {
	const hint = error instanceof Error && 'hint' in error && typeof error.hint === 'string' ? error.hint : undefined;
	const [first, ...rest] = (error instanceof Error ? error.message : String(error)).trim().split('\n');
	log.error(first);
	if (rest.length) process.stderr.write(`${rest.map(line => `  ${line}`).join('\n')}\n`);
	if (hint) log.hint(hint);
	else if (!debug()) log.hint('Run it again with --debug to see where it happened.');
	if (debug() && error instanceof Error && error.stack) process.stderr.write(`${c.gray(error.stack)}\n`);
}
