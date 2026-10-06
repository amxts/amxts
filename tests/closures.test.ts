import { loadPlugin } from '@amxts/core/test-utils';
/**
 * Closures on the fake server: listeners, commands and timers that use the
 * variables around them (tests/as/closures.ts).
 */
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

test('a timer set by a listener greets the player the listener was given', async () => {
	const server = await loadPlugin('tests/as/closures.ts');
	const alice = server.join('Alice');
	server.advance(1000);
	const bob = server.join('Bob');

	server.advance(1000);
	expect(alice.chat).toBe('Welcome, Alice!');
	expect(bob.chat).toBe('');

	server.advance(1000);
	expect(bob.chat).toBe('Welcome, Bob!');
});

test('an interval counts down a variable it shares, and stops itself through its own handle', async () => {
	const server = await loadPlugin('tests/as/closures.ts');
	const alice = server.join('Alice');
	server.advance(2000);
	alice.clearMessages();

	alice.say('/count 3');
	server.advance(10_000);
	expect(alice.chat.split('\n')).toEqual(['3', '2', '1']);
});

test('closures made in a loop keep the iteration they were made in', async () => {
	const server = await loadPlugin('tests/as/closures.ts');
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	server.advance(2000);
	alice.clearMessages();
	bob.clearMessages();

	alice.say('/wave');
	server.advance(1000);
	expect(alice.chat).toBe('Alice is #1 of 2');
	expect(bob.chat).toBe('Bob is #2 of 2');
});

test('an arrow in a method uses `this`, shared by a game listener and a command', async () => {
	const server = await loadPlugin('tests/as/closures.ts');
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	server.advance(2000);
	alice.clearMessages();

	server.fireHook('takeDamage', [bob.id, alice.id, alice.id, 10.0, 0]);
	const blocked = server.fireHook('takeDamage', [bob.id, alice.id, alice.id, 80.0, 0]);
	expect(blocked.prevented).toBe(true);

	alice.say('/hits');
	expect(alice.chat).toBe('2 hits');
});

test('cmd, cmdWide, hook, publicFor and nativeFn take closures', async () => {
	const server = await loadPlugin('tests/as/closures-raw.ts');
	const alice = server.join('Alice');
	const bob = server.join('Bob');
	alice.clearMessages();

	alice.command('amxts_narrow');
	alice.command('amxts_wide');
	expect(alice.chat.split('\n')).toEqual(['raw inside narrow 1', 'inside wide 2 0']);

	server.fireHook('takeDamage', [bob.id, alice.id, alice.id, 10.0, 0]);
	expect(server.log).toContain(`inside hook ${bob.id}`);

	server.touch(alice, bob);
	// register_touch calls (touched, toucher).
	expect(server.log).toContain(`inside touch ${bob.id} ${alice.id}`);

	server.callNative('closures_heard');
	expect(server.log).toContain('inside native 2');
});

test('a function value with fewer parameters goes where a longer type is expected, and is removed as itself', async () => {
	const server = await loadPlugin('tests/as/closures-raw.ts');
	server.advance(200);
	expect(server.native('ticks_now')).toBe(1);

	server.join('Alice');
	expect(server.native('joins_now')).toBe(1);
	server.native('stop_counting');
	server.join('Bob');
	expect(server.native('joins_now')).toBe(1);
});

test('top-level loops, hoisted functions, recursion by name, super and shadowing, as in JavaScript', async () => {
	const server = await loadPlugin('tests/as/closures-raw.ts');
	expect(server.native('loop_sums')).toBe('10,20,30');
	expect(server.native('hoisted')).toBe('even');
	expect(server.native('factorial', 5)).toBe(120);
	expect(server.native('super_in_arrow')).toBe('base+derived');
	expect(server.native('shadowed')).toBe(2);
});

test('a plugin clearing its own timer does not stop another plugin\'s', async () => {
	const server = await loadPlugin(['tests/as/timer-clearer.ts', 'tests/as/timer-keeper.ts']);
	server.native('clear_own');
	server.advance(2000);

	expect(server.log).toContain('the keeper\'s timer fired');
	expect(server.log).not.toContain('the clearer\'s timer fired');
});

test('the handle of a timer that has fired does not stop the next timer in its slot', async () => {
	const server = await loadPlugin(['tests/as/timer-clearer.ts', 'tests/as/timer-keeper.ts']);
	server.native('arm_first');
	server.advance(10);
	server.native('clear_fired');
	server.advance(2000);

	expect(server.log).toContain('the first timer fired');
	expect(server.log).toContain('the slot\'s next timer fired');
});
