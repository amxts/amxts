// async/await на сервере: порядок sleep, отмена через AbortController и
// ловушка в одной корутине, после которой плагин работает дальше.
//
// @log abort: Index out of range
// @log in an async function, which was dropped; the plugin runs on
import { Checks } from "~/lib/check";

let order = "";
let abortedWith = "";
let afterTrap = false;

server.addServerCommand("amxts_test_async", () => {
	run();
});

async function run() {
	const check = new Checks("async");

	await Promise.all([mark("медленный ", 300), mark("быстрый ", 100)]);
	check.expect(order, "короткий sleep просыпается первым").toBe("быстрый медленный ");

	const controller = new AbortController();
	sleep(5000, { signal: controller.signal }).catch((error) => {
		abortedWith = error.name;
	});
	controller.abort();
	await sleep(200);
	check.expect(abortedWith, "отменённый sleep отклонён").toBe("AbortError");

	crash();
	survive();
	await sleep(500);
	check.expect(afterTrap, "после ловушки другая корутина доработала").toBe(true);
	check.done();
}

async function mark(name: string, ms: number) {
	await sleep(ms);
	order += name;
}

/** Падает после await: выход за границы массива. */
async function crash() {
	await sleep(100);
	const empty: number[] = [];
	console.log(`${empty[3]}`);
}

async function survive() {
	await sleep(300);
	afterTrap = true;
}
