import { loadPlugin } from '@amxts/core/test-utils';
// A hook whose last listener is taken off is switched off - reapi's chain,
// Ham Sandwich's hook of a class, a stock hook of plain HLDS - and so is a
// server event's forward, a message's and a touch's public: what nobody
// listens to does not reach the plugin. The next listener switches it back
// on, and is called once. tests/as/listeners-off.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/listeners-off.ts';

/** How many lines of the log are `line`. */
function count(log: string, line: string) {
	return log.split('\n').filter(one => one === line).length;
}

test('the last listener taken off switches its hook off, the next one on', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const box = server.createEntity('info_target');
	const plugin = server.plugins[0];
	const relays = () => (server.events.get('client_putinserver') ?? []).some(handler => handler.plugin === plugin);
	const fireAll = () => {
		server.fireHook('resetMaxSpeed', [alice.id]);
		server.fireHam('think', box);
		server.join('Bob');
		server.sendMessage('DeathMsg', [alice.id, 0, 0, 'knife']);
		server.touch(alice, box);
	};

	server.serverCommand('listeners_on');
	expect(server.hooked('resetMaxSpeed')).toBe(true);
	expect(server.hooked('think', { classname: 'info_target' })).toBe(true);
	expect(relays()).toBe(true);

	server.serverCommand('listeners_off');
	expect(server.hooked('resetMaxSpeed')).toBe(false);
	expect(server.hooked('think', { classname: 'info_target' })).toBe(false);
	expect(relays()).toBe(false);
	expect([...server.messageHooks.values()].flat().every(slot => slot.off)).toBe(true);
	expect(server.touches.every(touch => touch.slot.off)).toBe(true);
	fireAll();
	expect(server.log).not.toMatch(/^(reset|think|join|death|touch)$/m);

	server.serverCommand('listeners_on');
	expect(server.hooked('resetMaxSpeed')).toBe(true);
	expect(server.hooked('think', { classname: 'info_target' })).toBe(true);
	fireAll();
	for (const heard of ['reset', 'think', 'join', 'death', 'touch']) expect([heard, count(server.log, heard)]).toEqual([heard, 1]);
});

test('on plain HLDS a stock hook\'s backend is switched off with its event\'s last listener', async () => {
	const server = await loadPlugin(PLUGIN, { modules: ['cstrike', 'fun', 'hamsandwich', 'engine', 'fakemeta', 'nvault'] });

	server.serverCommand('listeners_on');
	server.serverCommand('listeners_off');
	expect(server.logEvents.every(logEvent => logEvent.slot.off)).toBe(true);
	server.gameLog('World triggered "Round_Start"');
	expect(server.log).not.toContain('round start');

	server.serverCommand('listeners_on');
	server.gameLog('World triggered "Round_Start"');
	expect(count(server.log, 'round start')).toBe(1);
});
