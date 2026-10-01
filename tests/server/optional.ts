// Optional properties and the temporal dead zone under WAMR AOT: a number's
// undefined (a NaN of its own) survives the i386 build, an optional boolean
// keeps whether it was given, `?.` and destructuring work, and a variable read
// before its declaration aborts only the call that read it.
// @log [amxts] abort: x is not initialized
// @log optional.aot: Exception: aborted
import { Checks } from "@amxts/core/check";

interface Options {
	time?: number;
	force?: boolean;
	label?: string;
	onDone?: (value: number) => void;
}

server.addServerCommand("amxts_test_optional", () => {
	run();
});

function describe({ time = -1, force = false, label = "none" }: Options = {}) {
	return `${time} ${force} ${label}`;
}

function readTooEarly() {
	const value = read();
	const x = 5;
	function read() {
		return x;
	}
	return value;
}

async function run() {
	const check = new Checks("optional");

	const empty: Options = {};
	const time = empty.time;
	check.expect(time === undefined, "a number left out is undefined").toBe(true);
	check.expect(`${time}`, "and prints as undefined").toBe("undefined");
	check.expect(time ?? 7, "?? gives it the default").toBe(7);
	check.expect(empty.force === false, "a boolean left out is not false").toBe(false);
	check.expect(empty.force ?? true, "?? gives a boolean left out its default").toBe(true);

	const given: Options = { time: 0, force: false };
	check.expect(given.time ?? 7, "a number given as 0 is 0").toBe(0);
	check.expect(given.force ?? true, "a boolean given as false is false").toBe(false);

	check.expect(describe(), "destructuring takes the defaults").toBe("-1 false none");
	check.expect(describe({ time: 3, force: true }), "and the fields given").toBe("3 true none");

	let finished = 0;
	const withCallback: Options = { onDone: (value) => {
		finished = value;
	} };
	withCallback.onDone?.(5);
	empty.onDone?.(9);
	check.expect(finished, "?. calls only a function that is there").toBe(5);

	let after = false;
	setTimeout(() => {
		readTooEarly();
		after = true;
	}, 10);
	setTimeout(() => {
		after = true;
	}, 50);
	await sleep(300);
	check.expect(after, "the plugin goes on after the call that read too early").toBe(true);

	check.done();
}
