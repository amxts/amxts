// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { listIncludes, parseOrder, resolveTransitive } from '../scripts/includes';

test('sees includes from both directories', () => {
	const names = listIncludes();

	expect(names).toContain('amxmodx'); // amxmodx/base/include
	expect(names).toContain('reapi'); // includes/
});

test('follows #include directives from the listed files', () => {
	const resolved = resolveTransitive(['reapi']);

	expect(resolved).toContain('reapi');
	expect(resolved).toContain('reapi_gamedll');
	expect(resolved).toContain('reapi_engine');
});

test('does not drag in includes nobody asked for', () => {
	const resolved = resolveTransitive(['fun']);

	expect(resolved).not.toContain('sqlite');
	expect(resolved).not.toContain('geoip');
	expect(resolved).not.toContain('sockets');
});

test('terminates on an include cycle and returns each name once', () => {
	const resolved = resolveTransitive(['amxmodx']);

	expect(new Set(resolved).size).toBe(resolved.length);
});

test('a deny-marked include resolves but is excluded from the pull set', () => {
	const { includes, denied } = parseOrder('reapi\n-reapi_vtc\n-reapi_reunion\n');

	expect(includes).toEqual(['reapi']);
	expect(denied.has('reapi_vtc')).toBe(true);
	expect(denied.has('reapi_reunion')).toBe(true);

	// reapi.inc unconditionally #includes both, so amxxpc needs them on disk —
	// they still show up in the transitive walk...
	const resolved = resolveTransitive(includes);
	expect(resolved).toContain('reapi_vtc');
	expect(resolved).toContain('reapi_reunion');

	// ...but a native pull built by filtering the walk against `denied` drops them.
	const pulled = resolved.filter(name => !denied.has(name));
	expect(pulled).not.toContain('reapi_vtc');
	expect(pulled).not.toContain('reapi_reunion');
});
