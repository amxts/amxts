// async/await на сервере: порядок sleep, отмена через AbortController,
// ошибка в async-функции, которую ловит try вокруг await, и ловушка в одной
// корутине, после которой плагин работает дальше.
//
// @log unreachable
// @log in an async function, which was dropped; the plugin runs on
import { Checks } from "@amxts/core/check";

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

	let caught = "";
	try {
		await outOfRange();
	} catch (error) {
		caught = error.name;
	}
	check.expect(caught, "ошибка в async-функции отклоняет её промис").toBe("RangeError");

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

/** Бросает после await: выход за границы массива. */
async function outOfRange() {
	await sleep(50);
	const empty: number[] = [];
	console.log(`${empty[3]}`);
}

/** Падает после await: ловушка, а не ошибка. */
async function crash() {
	await sleep(100);
	unreachable();
}

async function survive() {
	await sleep(300);
	afterTrap = true;
}
