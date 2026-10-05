import { loadPlugin } from '@amxts/core/test-utils';
// A dispatch walks its listeners as the DOM does: one removed while it runs
// is not called, one added is not called this time - for every kind of event
// the facade dispatches, and for a dispatch inside another. An event hands out
// one Player a player. tests/as/dispatch.ts.
// @ts-ignore - bun:test types not available during type checking
import { beforeAll, describe, expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

type Server = Awaited<ReturnType<typeof loadPlugin>>;

let server: Server;

beforeAll(async () => {
	server = await loadPlugin('tests/as/dispatch.ts');
	server.join('Alice');
});

/** What the plugin logs while `run` runs, its lines starting with `prefix`. */
function heard(prefix: string, run: () => void) {
	const before = server.log.length;
	run();
	return server.log.slice(before).split('\n').filter(line => line.startsWith(prefix));
}

const KINDS = [
	{ name: 'a game event', on: 'reset_on', off: 'reset_off', prefix: 'reset', fire: () => server.fireHook('resetMaxSpeed', [1]) },
	{ name: 'a server event', on: 'impulse_on', off: 'impulse_off', prefix: 'impulse', fire: () => server.fire('client_impulse', 1, 100) },
];

for (const { name, on, off, prefix, fire } of KINDS) {
	describe(name, () => {
		const twice = (mode: string) => {
			server.serverCommand(`dispatch_mode ${mode}`);
			server.serverCommand(on);
			const runs = [heard(prefix, fire), heard(prefix, fire)];
			server.serverCommand(off);
			return runs;
		};

		test('a listener that removes itself is called this time, not the next', () => {
			expect(twice('self')).toEqual([[`${prefix} a`, `${prefix} b`, `${prefix} c`], [`${prefix} b`, `${prefix} c`]]);
		});

		test('a listener removed by the one before it is not called', () => {
			expect(twice('next')).toEqual([[`${prefix} a`, `${prefix} c`], [`${prefix} a`, `${prefix} c`]]);
		});

		test('a listener removed by a later one has been called, and is not the next time', () => {
			expect(twice('earlier')).toEqual([[`${prefix} a`, `${prefix} b`, `${prefix} c`], [`${prefix} b`, `${prefix} c`]]);
		});

		test('a listener added during a dispatch waits for the next', () => {
			expect(twice('add')).toEqual([[`${prefix} a`, `${prefix} b`, `${prefix} c`], [`${prefix} a`, `${prefix} b`, `${prefix} c`, `${prefix} d`]]);
		});
	});
}

describe('a listener that removes itself and the next', () => {
	test('of a message', () => {
		const fire = () => server.sendMessage('DeathMsg', [1, 0, 0, 'knife']);
		expect([heard('death', fire), heard('death', fire)]).toEqual([['death a', 'death c'], ['death c']]);
	});

	test('of a touch', () => {
		const box = server.createEntity('info_target');
		const fire = () => server.touch(server.player(1)!, box);
		expect([heard('touch', fire), heard('touch', fire)]).toEqual([['touch a', 'touch c'], ['touch c']]);
	});

	test('of a cvar\'s change', () => {
		expect([heard('knob', () => server.setCvar('dispatch_knob', 1)), heard('knob', () => server.setCvar('dispatch_knob', 2))])
			.toEqual([['knob a', 'knob c'], ['knob c']]);
	});
});

test('a dispatch inside another: what the inner one removes, the outer one skips', () => {
	const first = heard('nested', () => server.serverCommand('nested_emit'));
	expect(first).toEqual(['nested a 0', 'nested a 1', 'nested b 1', 'nested b 0']);
	expect(heard('nested', () => server.serverCommand('nested_emit'))).toEqual(['nested a 0', 'nested a 1', 'nested b 1', 'nested b 0']);
});

test('an event hands out one Player a player, and a new one to the next in his slot', () => {
	const bob = server.join('Bob');
	server.serverCommand('players_on');
	server.fire('client_impulse', bob.id, 100);
	expect(heard('same', () => server.fire('client_impulse', bob.id, 100))).toEqual(['same player: true, same id: true']);

	bob.disconnect();
	const carol = server.join('Carol');
	expect(carol.id).toBe(bob.id);
	expect(heard('same', () => server.fire('client_impulse', carol.id, 100))).toEqual(['same player: false, same id: true']);
});
