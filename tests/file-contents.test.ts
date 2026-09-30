import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// What `amxts dev` rebuilds for (scripts/file-contents.ts): a source file
// whose contents changed - not a save that changed nothing, a file written
// again as it was, or a new time on it - and not what the build writes.
// @ts-ignore - bun:test types not available during type checking
import { afterAll, expect, test } from 'bun:test';
import { FileContents, sourceIn, sourcesIn } from '../scripts/file-contents';

const dir = join(tmpdir(), 'amxts-file-contents');
rmSync(dir, { recursive: true, force: true });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(file: string, text: string) {
	mkdirSync(join(dir, file, '..'), { recursive: true });
	writeFileSync(join(dir, file), text);
}

test('a file counts as changed when what it holds did', () => {
	write('plugins/hello.ts', 'hello');
	write('plugins/lib/util.ts', 'util');
	const contents = new FileContents(sourcesIn(join(dir, 'plugins')));
	const hello = join(dir, 'plugins/hello.ts');
	const util = join(dir, 'plugins/lib/util.ts');

	// Saved as it was, and touched: nothing to build.
	write('plugins/hello.ts', 'hello');
	utimesSync(util, new Date(), new Date(Date.now() + 5000));
	expect(contents.changed([hello, util, hello])).toEqual([]);

	write('plugins/hello.ts', 'hello, world');
	expect(contents.changed([hello, util])).toEqual([hello]);
	// Seen now: the same event again is not a change.
	expect(contents.changed([hello])).toEqual([]);

	// A new file is a change, and so is one gone; a file that came and went between two events is not.
	write('plugins/new.ts', 'new');
	rmSync(util);
	expect(contents.changed([join(dir, 'plugins/new.ts'), util, join(dir, 'plugins/tmp.ts')])).toEqual([join(dir, 'plugins/new.ts'), util]);
});

test('what the build reads, not what it writes', () => {
	const project = join(dir, 'project');
	const written = [join(project, 'dist'), join(project, '.amxts')];
	expect(sourceIn(project, 'plugins/hello.ts', written)).toBe(join(project, 'plugins/hello.ts'));
	expect(sourceIn(project, 'dist/hello.aot', written)).toBeNull();
	expect(sourceIn(project, 'dist/generated.ts', written)).toBeNull();
	expect(sourceIn(project, '.amxts/imports.d.ts', written)).toBeNull();
	expect(sourceIn(project, 'plugins/types.d.ts', written)).toBeNull();
	expect(sourceIn(project, 'lib/node_modules/x/index.ts', written)).toBeNull();

	write('project/plugins/hello.ts', '');
	write('project/dist/generated.ts', '');
	write('project/node_modules/x/index.ts', '');
	expect(sourcesIn(project, written)).toEqual([join(project, 'plugins/hello.ts')]);
});
