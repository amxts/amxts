// Date.now(), performance.now() and Math.random(). Under i386 a 64-bit division
// goes to _alldiv from the CRT, and the loader did not find that symbol: a plugin
// with a clock did not load.
//
// The runner passes its time: amxts_test_time <ms since 1970>.
//
// Date's local time is in the server's time zone: get_time, AMX Mod X's strftime,
// checks it.
import { get_time } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

interface TimeArgs {
	now?: number;
}

server.addServerCommand<TimeArgs>("amxts_test_time [now]", ({ now }) => run(now ?? 0));

/** Two digits, as strftime writes them: 7 is "07". */
function twoDigits(value: number) {
	return `${value}`.padStart(2, "0");
}

/** Date's local parts are the ones strftime writes; they are getTimezoneOffset away from UTC. */
function localTime(check: Checks) {
	const date = new Date();
	const local = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${twoDigits(date.getHours())}`;
	check.expect(local, "getFullYear, getMonth, getDate, getHours are the server's local time").toBe(get_time("%Y-%m-%d %H"));

	const offset = date.getTimezoneOffset();
	const apart = date.getHours() * 60 + date.getMinutes() - (date.getUTCHours() * 60 + date.getUTCMinutes());
	check.expect((apart + offset + 2880) % 1440, `local minus UTC is -getTimezoneOffset (${offset})`).toBe(0);
	check.expect(Math.abs(date.getTime() - Date.now()) < 1000.0, "new Date() is now").toBe(true);
}

function run(runner: number) {
	const check = new Checks("time");

	const now = Date.now();
	check.expect(Math.abs(now - runner) < 60000.0, `Date.now() matches the runner's clock (${now})`).toBe(true);

	localTime(check);

	const started = performance.now();
	let sum = 0.0;
	for (let i = 0; i < 100000; i++) sum += Math.sqrt(i);
	const elapsed = performance.now() - started;
	check.expect(started >= 0.0, "performance.now() is not negative").toBe(true);
	check.expect(elapsed > 0.0 && elapsed < 5000.0, `performance.now() goes forward (${elapsed} ms)`).toBe(true);
	check.expect(sum > 0.0, "the loop is counted").toBe(true);

	const first = Math.random();
	let inRange = true;
	let allSame = true;
	for (let i = 0; i < 100; i++) {
		const next = Math.random();
		if (next < 0.0 || next >= 1.0) inRange = false;
		if (next != first) allSame = false;
	}
	check.expect(inRange, "Math.random() is in [0, 1)").toBe(true);
	check.expect(allSame, "Math.random() does not repeat one number").toBe(false);
	check.done();
}
