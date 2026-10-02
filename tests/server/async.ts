// async/await on the server: the order of sleeps, cancelling through
// AbortController, an error in an async function caught by a try around
// await, and a trap in one coroutine after which the plugin keeps working.
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

	await Promise.all([mark("slow ", 300), mark("fast ", 100)]);
	check.expect(order, "a short sleep wakes first").toBe("fast slow ");

	const controller = new AbortController();
	sleep(5000, { signal: controller.signal }).catch((error) => {
		abortedWith = error.name;
	});
	controller.abort();
	await sleep(200);
	check.expect(abortedWith, "a cancelled sleep is rejected").toBe("AbortError");

	let caught = "";
	try {
		await outOfRange();
	} catch (error) {
		caught = error.name;
	}
	check.expect(caught, "an error in an async function rejects its promise").toBe("RangeError");

	crash();
	survive();
	await sleep(500);
	check.expect(afterTrap, "after a trap another coroutine finished").toBe(true);
	check.done();
}

async function mark(name: string, ms: number) {
	await sleep(ms);
	order += name;
}

/** Throws after await: an index out of the array's bounds. */
async function outOfRange() {
	await sleep(50);
	const empty: number[] = [];
	console.log(`${empty[3]}`);
}

/** Fails after await: a trap, not an error. */
async function crash() {
	await sleep(100);
	unreachable();
}

async function survive() {
	await sleep(300);
	afterTrap = true;
}
