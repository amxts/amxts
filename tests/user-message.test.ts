import { loadPlugin } from '@amxts/core/test-utils';
// A UserMessage on the fake server: registered by its name, so a Pawn
// plugin's get_user_msgid finds it, and each send is one user message
// whose args are the values in the order written.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

test('a message of its own: its values in order, to one player and to everyone', async () => {
	const server = await loadPlugin('tests/as/user-message.ts');
	const alice = server.join('Alice');
	alice.command('um_one');
	alice.command('um_all');

	expect(server.userMessages).toEqual([
		{ name: 'KzJump', player: alice.id, args: [7, -5, 300, 100000, 'hi', alice.id] },
		{ name: 'KzJump', player: 0, args: [90, 12.5] },
	]);
});

test('a message too large, or of a name too long, is not sent', async () => {
	const server = await loadPlugin('tests/as/user-message.ts');
	const alice = server.join('Alice');
	alice.command('um_big');
	alice.command('um_long_name');
	alice.command('um_one');

	expect(server.userMessages.map(message => message.args.length)).toEqual([6]);
});
