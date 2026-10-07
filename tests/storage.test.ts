import { loadPlugin } from '@amxts/core/test-utils';
// Storage on the fake server: tests/as/storage.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/storage.ts';

test('a Storage of objects keeps them as JSON; get gives undefined for a key not there', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice', { steamId: 'STEAM_0:0:1' });

	alice.command('storage_write');
	alice.command('storage_write');
	alice.command('storage_read');

	expect(alice.console).toBe('a,b 2 true rookie 2');
	expect(JSON.parse(server.storage('storage_profiles').get('STEAM_0:0:1')!)).toEqual({ kills: 2, title: 'rookie' });
});

test('prune removes what was set before the moment; delete tells whether the key was there', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	alice.command('storage_write');
	server.advance(120_000);
	server.storage('storage_names').set('kept', 'set by the test');

	alice.command('storage_prune');

	expect(alice.console).toBe('2 false false');
	expect([...server.storage('storage_names').keys()]).toEqual(['kept']);
});

test('a name that is no file name is refused, said in the console', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('storage_bad');

	expect(server.log).toContain('new Storage("bad/name"): a storage\'s name is a file\'s name');
	expect(server.storage('bad/name').size).toBe(0);
});
