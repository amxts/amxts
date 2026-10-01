// Date.now(), performance.now() и Math.random(). Под i386 деление 64-битных
// чисел уходит в _alldiv из CRT, и загрузчик не находил этот символ: плагин
// с часами не загружался.
//
// Раннер передаёт своё время: amxts_test_time <мс с 1970 года>.
//
// Местное время Date - часовой пояс сервера: его сверяет get_time, strftime
// AMX Mod X.
import { get_time } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_time", run);

/** Две цифры, как у strftime: 7 - "07". */
function twoDigits(value: number) {
	return `${value}`.padStart(2, "0");
}

/** Местные части Date - те же, что пишет strftime; от UTC они отстоят на getTimezoneOffset. */
function localTime(check: Checks) {
	const date = new Date();
	const local = `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())} ${twoDigits(date.getHours())}`;
	check.expect(local, "getFullYear, getMonth, getDate, getHours - местное время сервера").toBe(get_time("%Y-%m-%d %H"));

	const offset = date.getTimezoneOffset();
	const apart = date.getHours() * 60 + date.getMinutes() - (date.getUTCHours() * 60 + date.getUTCMinutes());
	check.expect((apart + offset + 2880) % 1440, `местное минус UTC - это -getTimezoneOffset (${offset})`).toBe(0);
	check.expect(Math.abs(date.getTime() - Date.now()) < 1000.0, "new Date() - сейчас").toBe(true);
}

function run(args: string[]) {
	const check = new Checks("time");

	const runner = args.length > 0 ? parseFloat(args[0]) : 0.0;
	const now = Date.now();
	check.expect(Math.abs(now - runner) < 60000.0, `Date.now() совпадает с часами раннера (${now})`).toBe(true);

	localTime(check);

	const started = performance.now();
	let sum = 0.0;
	for (let i = 0; i < 100000; i++) sum += Math.sqrt(i);
	const elapsed = performance.now() - started;
	check.expect(started >= 0.0, "performance.now() не отрицательный").toBe(true);
	check.expect(elapsed > 0.0 && elapsed < 5000.0, `performance.now() идёт вперёд (${elapsed} мс)`).toBe(true);
	check.expect(sum > 0.0, "цикл посчитан").toBe(true);

	const first = Math.random();
	let inRange = true;
	let allSame = true;
	for (let i = 0; i < 100; i++) {
		const next = Math.random();
		if (next < 0.0 || next >= 1.0) inRange = false;
		if (next != first) allSame = false;
	}
	check.expect(inRange, "Math.random() в [0, 1)").toBe(true);
	check.expect(allSame, "Math.random() не повторяет одно число").toBe(false);
	check.done();
}
