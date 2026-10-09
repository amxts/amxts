// A published package.json: its links to the other packages as versions, and
// a module's own range for the core when it runs on more than one line.
// @ts-ignore - bun:test types not available during type checking
import { expect, test } from 'bun:test';
import { publishedManifest } from '../scripts/publish';

function versions(core: string) {
	return {
		own: new Map([['@amxts/core', '0.3.0'], ['@amxts/config-core', '0.1.3']]),
		out: new Map([['@amxts/core', core], ['@amxts/config-core', '0.1.3'], ['@amxts/menu-core', '0.3.0']]),
	};
}

function module(amxts: object = {}) {
	return {
		name: '@amxts/menu-core',
		version: '0.3.0',
		peerDependencies: { '@amxts/core': 'file:../../amxts', '@amxts/config-core': 'file:../config-core' },
		amxts: { module: 'src/index.ts', ...amxts },
	};
}

test('a link is the linked package\'s version', () => {
	expect(publishedManifest(module(), versions('0.3.0')).peerDependencies).toEqual({ '@amxts/core': '^0.3.0', '@amxts/config-core': '^0.1.3' });
});

test('a module names the lines of the core it runs on', () => {
	const published = publishedManifest(module({ core: '^0.2.0||^0.3.0' }), versions('0.3.0'));
	expect(published.peerDependencies['@amxts/core']).toBe('^0.2.0 || ^0.3.0');
	expect(published.peerDependencies['@amxts/config-core']).toBe('^0.1.3');
});

test('a module\'s range must take the core it goes out with', () => {
	expect(() => publishedManifest(module({ core: '^0.2.0' }), versions('0.3.0'))).toThrow('does not take the core\'s 0.3.0');
	expect(() => publishedManifest(module({ core: '>=0.2.0' }), versions('0.3.0'))).toThrow('not carets joined by ||');
});
