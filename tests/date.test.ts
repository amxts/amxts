import { loadPlugin } from '@amxts/core/test-utils';
// Date's local getters on the fake server: tests/as/date.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/date.ts';

/** What the plugin reads of a moment in a time zone: year, month, date, day, hours, minutes, seconds, ms, offset. */
async function localParts(moment: string, timeZone?: string) {
	const server = await loadPlugin(PLUGIN, { timeZone });
	const alice = server.join('Alice');
	alice.command(`date_local ${Date.parse(moment)}`);
	return alice.console;
}

test('the local getters are the server time zone\'s, summer time and half hours included', async () => {
	// +05:30; a year back across midnight at -05:00; +02:00 in the summer.
	expect(await localParts('2026-03-29T00:30:00.250Z', 'Asia/Kolkata')).toBe('2026 2 29 0 6 0 0 250 -330');
	expect(await localParts('2026-01-01T03:00:00.000Z', 'America/New_York')).toBe('2025 11 31 3 22 0 0 0 300');
	expect(await localParts('2026-07-01T12:00:59.000Z', 'Europe/Berlin')).toBe('2026 6 1 3 14 0 59 0 -120');
});

test('without a time zone the local time is this machine\'s, as JavaScript\'s Date reads it', async () => {
	const moment = Date.parse('2026-09-29T21:45:10.500Z');
	const date = new Date(moment);
	const expected = [date.getFullYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(), date.getTimezoneOffset()];

	expect(await localParts('2026-09-29T21:45:10.500Z')).toBe(expected.join(' '));
});

test('a date as text: local, and as a language writes it, as JavaScript writes them', async () => {
	const moment = Date.parse('2026-07-01T09:05:03.000Z');
	const server = await loadPlugin(PLUGIN, { timeZone: 'Europe/Berlin' });
	const alice = server.join('Alice');
	alice.command(`date_text ${moment}`);

	// JavaScript's own, in the same zone; the zone's name in brackets is not written
	const date = new Date(moment);
	const zone = { timeZone: 'Europe/Berlin' };
	const expected = [
		'Wed Jul 01 2026 11:05:03 GMT+0200',
		'Wed Jul 01 2026',
		'11:05:03 GMT+0200',
		date.toLocaleString('en-US', zone),
		date.toLocaleDateString('en-US', zone),
		date.toLocaleTimeString('en-US', zone),
		...['en-GB', 'de-DE', 'fr-FR', 'ru-RU'].map(locale => date.toLocaleString(locale, zone)),
	];
	expect(alice.console.split('|')).toEqual(expected.map(line => line.replace(/\u202f/g, ' ')));
});

test('new Date() is now', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('date_now');

	expect(alice.console).toBe('true');
});
