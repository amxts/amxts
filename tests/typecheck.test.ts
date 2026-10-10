/**
 * `amxts typecheck` says what TypeScript allows and the build does not: an
 * event name that is not a string literal in the call, an empty array whose
 * type is not written.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import ts from 'typescript';
// @ts-ignore - plain JavaScript
import { buildProblems } from '../src/typecheck.mjs';

const PLUGIN = `
interface EventMap { statusText: { text: string }; statusValue: { value: number } }
declare function listen<K extends keyof EventMap>(name: K, listener: (event: EventMap[K]) => void): void;
declare function say(text: string): void;

listen("statusText", (event) => say(event.text));
for (const name of ["statusText", "statusValue"] as const) listen(name, () => say("x"));
const one = "statusValue";
listen(one, () => say("y"));
say(one);

const rows = [];
const typed: string[] = [];
const full = ["a"];
`;

test('an event name that is not a string literal in the call and an untyped empty array are reported; the rest is not', () => {
	const options = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, noLib: true };
	const host = ts.createCompilerHost(options);
	const read = host.getSourceFile;
	host.getSourceFile = (name, version) => name === 'plugin.ts' ? ts.createSourceFile(name, PLUGIN, version, true) : read(name, version);
	const program = ts.createProgram(['plugin.ts'], options, host);

	expect(buildProblems(program).map(({ node, message }: { node: ts.Node; message: string }) => `${node.getText()}: ${message}`)).toEqual([
		'name: \'name\' has to be written out as a string literal - the build picks the event by the name in the call; write a call for each name.',
		'one: \'one\' has to be written out as a string literal - the build picks the event by the name in the call; write a call for each name.',
		'rows = []: the build does not read an empty array\'s element type off its later use - write it: const rows: Row[] = []',
	]);
});

const FILES: Record<string, string> = {
	'facade.ts': [
		'export declare function env(name: string): string;',
		'export declare function env(name: string, defaultValue: string): string;',
		'export declare function env(name: string, defaultValue: number): number;',
		'export declare function env(name: string, defaultValue: boolean): boolean;',
		'',
	].join('\n'),
	'settings.ts': [
		'import { env } from "./facade";',
		'const name = "A";',
		'const limit = 5;',
		'env("A"); env("B", 100); env("C", -1); env("D", false); env("E", "text");',
		'env(name);',
		'env("F", limit);',
		'',
	].join('\n'),
};

test('env() with a name or a default that is not written out is reported', () => {
	const options = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, noLib: true };
	const host = ts.createCompilerHost(options);
	const read = host.getSourceFile;
	const own = (name: string) => FILES[name.replace(/^.*[\\/]/, '')];
	host.getSourceFile = (name, version) => own(name) !== undefined ? ts.createSourceFile(name, own(name), version, true) : read(name, version);
	host.fileExists = name => own(name) !== undefined || ts.sys.fileExists(name);
	const program = ts.createProgram(['settings.ts'], options, host);

	expect(buildProblems(program).map(({ node }: { node: ts.Node }) => node.getText())).toEqual(['env(name)', 'env("F", limit)']);
});
