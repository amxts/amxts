/**
 * `amxts typecheck` says what TypeScript allows and the build does not: an
 * event name that is not a string literal in the call.
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import ts from 'typescript';
// @ts-ignore - plain JavaScript
import { unwrittenNames } from '../src/typecheck.mjs';

const PLUGIN = `
interface EventMap { statusText: { text: string }; statusValue: { value: number } }
declare function listen<K extends keyof EventMap>(name: K, listener: (event: EventMap[K]) => void): void;
declare function say(text: string): void;

listen("statusText", (event) => say(event.text));
for (const name of ["statusText", "statusValue"] as const) listen(name, () => say("x"));
const one = "statusValue";
listen(one, () => say("y"));
say(one);
`;

test('an event name that is not a string literal in the call is reported; a literal and other parameters are not', () => {
	const options = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2022, noLib: true };
	const host = ts.createCompilerHost(options);
	const read = host.getSourceFile;
	host.getSourceFile = (name, version) => name === 'plugin.ts' ? ts.createSourceFile(name, PLUGIN, version, true) : read(name, version);
	const program = ts.createProgram(['plugin.ts'], options, host);

	expect(unwrittenNames(program).map((argument: ts.Expression) => argument.getText())).toEqual(['name', 'one']);
});
