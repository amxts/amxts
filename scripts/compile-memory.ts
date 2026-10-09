// The on-server compiler's memory, for CI on Linux:
//
//   bun scripts/compile-memory.ts <the kit's folder> <plugin.ts>... [--limit <MB>]
//
// Each plugin is compiled with the kit's amxts-compile as the module compiles
// it on a server - its two stages one after the other, with the environment
// the module gives the compiler (COMPILER_ENV in runtime/src/module.cpp, read
// from there) - in a copy of the kit's plugins folder, beside the core's
// as/lib. Each stage's peak - its processes' resident memory together, read
// from /proc every few milliseconds - is printed, and over --limit fails the
// run: a game server's container is killed at its memory limit.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import process from 'node:process';

const STAGES = ['--stage-wasm', '--stage-aot'];

const args = process.argv.slice(2);
const limitAt = args.indexOf('--limit');
const limit = limitAt >= 0 ? Number(args.splice(limitAt, 2)[1]) : Infinity;
const [kit, ...plugins] = args;

const compiler = join(kit, 'addons/amxts/tools/amxts-compile');
if (!existsSync(compiler) || plugins.length === 0) {
	process.stderr.write('usage: bun scripts/compile-memory.ts <the kit folder> <plugin.ts>... [--limit <MB>]\n');
	process.exit(2);
}

const env = { ...process.env, ...Object.fromEntries(compilerEnv().map(entry => entry.split('='))) };
const folder = mkdtempSync(join(tmpdir(), 'amxts-compile-memory-'));
cpSync(join(kit, 'addons/amxts/plugins'), folder, { recursive: true });
cpSync('as/lib', join(folder, 'lib'), { recursive: true });

let failed = false;
for (const plugin of plugins) {
	const source = join(folder, basename(plugin));
	cpSync(plugin, source);
	for (const stage of STAGES) {
		const { code, peak, seconds } = await measure([stage, source, source.replace(/\.ts$/, '.aot')]);
		const over = peak > limit;
		failed ||= over || code !== 0;
		console.log(`${basename(plugin).padEnd(16)} ${stage.padEnd(13)} ${String(peak).padStart(5)} MB  ${seconds.toFixed(1)} s${code !== 0 ? `  exited with ${code}` : ''}${over ? `  over ${limit} MB` : ''}`);
	}
}
process.exit(failed ? 1 : 0);

/** COMPILER_ENV of the module's source: `NAME=value`, each. */
function compilerEnv(): string[] {
	const source = readFileSync('runtime/src/module.cpp', 'utf8');
	const list = /COMPILER_ENV\[\] = \{([^}]*)\}/.exec(source);
	if (!list) throw new Error('runtime/src/module.cpp has no COMPILER_ENV');
	return [...list[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
}

/** amxts-compile with `stage`: how it exited, its processes' peak in MB together, and how long it took. */
async function measure(stage: string[]): Promise<{ code: number | null; peak: number; seconds: number }> {
	const started = performance.now();
	const child = spawn(compiler, stage, { env, stdio: ['ignore', 'inherit', 'inherit'] });
	const done = new Promise<number | null>(resolve => child.on('exit', resolve));
	let peak = 0;
	while (child.exitCode === null && child.signalCode === null) {
		peak = Math.max(peak, treeRss(child.pid!));
		await new Promise(resolve => setTimeout(resolve, 5));
	}
	return { code: await done, peak: Math.round(peak / 1024), seconds: (performance.now() - started) / 1000 };
}

/** The resident memory of `pid` and every process under it, in KB. */
function treeRss(pid: number): number {
	const parents = new Map<number, number>();
	for (const name of readdirSync('/proc')) {
		if (!/^\d+$/.test(name)) continue;
		const stat = read(`/proc/${name}/stat`);
		// The command, in parentheses, may hold spaces: the fields after it are fixed.
		if (stat) parents.set(Number(name), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
	}
	const tree = new Set([pid]);
	for (let grew = true; grew;) {
		grew = false;
		for (const [child, parent] of parents) {
			if (tree.has(parent) && !tree.has(child)) {
				tree.add(child);
				grew = true;
			}
		}
	}
	let total = 0;
	for (const each of tree) total += Number(/VmRSS:\s+(\d+)/.exec(read(`/proc/${each}/status`) ?? '')?.[1] ?? 0);
	return total;
}

/** A file of /proc, or null for a process that is gone. */
function read(file: string): string | null {
	try {
		return readFileSync(file, 'utf8');
	} catch {
		return null;
	}
}
