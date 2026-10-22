import { loadPlugin } from '@amxts/core/test-utils';
// Storage on the fake server: tests/as/storage.ts.
import { expect, test } from 'vitest';

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

test('a record kept before an optional field was added reads without it; one that still does not read names the storage, key and field', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	server.storage('storage_visits').set('old', '{"count":3}');
	server.storage('storage_visits').set('bad', '{"count":"three"}');

	alice.command('storage_old');

	expect(alice.console).toBe('3 none | Storage "storage_visits", key "bad": JSON: count is text, a number was expected');
	expect(server.storage('storage_visits').get('bad')).toBe('{"count":"three"}');
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

test('a value as long as the room or longer comes back whole', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const lengths = [1022, 1023, 1024, 1025, 1034, 3000];
	for (const length of lengths) server.storage('storage_names').set(String(length), 'x'.repeat(length));

	alice.command('storage_lengths');

	expect(alice.console).toBe(lengths.map(length => `${length}:${length}`).join(' '));
});

test('a name that is no file name is refused, said in the console', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('storage_bad');

	expect(server.log).toContain('new Storage("bad/name"): a storage\'s name is a file\'s name');
	expect(server.storage('bad/name').size).toBe(0);
});
