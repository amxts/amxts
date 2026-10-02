// Closures on the server: timers, the frame event and an async arrow that
// use the variables around them.
import { publicFor } from "@amxts/core";
import { register_srvcmd } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_closures", () => {
	run();
});

class Tally {
	count = 0;

	/** An arrow in a method sees `this`. */
	bump(times: number) {
		for (let i = 0; i < times; i++) setTimeout(() => this.count++, 50);
	}
}

async function run() {
	const check = new Checks("closures");

	const label = "timer";
	let fired = "";
	setTimeout(() => {
		fired = `${label} fired`;
	}, 100);
	await sleep(300);
	check.expect(fired, "setTimeout sees a constant and changes a shared variable").toBe("timer fired");

	let ticks = 0;
	const handle = setInterval(() => {
		if (++ticks == 3) clearInterval(handle);
	}, 50);
	await sleep(600);
	check.expect(ticks, "setInterval stops itself by its handle").toBe(3);

	let order = "";
	for (let i = 1; i <= 3; i++) {
		setTimeout(() => {
			order += `${i}`;
		}, i * 50);
	}
	await sleep(400);
	check.expect(order, "each loop iteration has its own i").toBe("123");

	const tally = new Tally();
	tally.bump(4);
	await sleep(300);
	check.expect(tally.count, "an arrow in a method sees this").toBe(4);

	let frames = 0;
	const onFrame = () => {
		frames++;
	};
	server.addEventListener("frame", onFrame);
	await sleep(300);
	server.removeEventListener("frame", onFrame);
	const counted = frames;
	await sleep(200);
	check.expect(counted > 0, "a frame listener counts into a variable around it").toBe(true);
	check.expect(frames, "a removed listener is not called again").toBe(counted);

	const name = "async";
	let awaited = "";
	const later = async (ms: number) => {
		await sleep(ms);
		awaited = `${name} after ${ms}`;
	};
	later(100);
	await sleep(300);
	check.expect(awaited, "an async arrow sees variables before and after await").toBe("async after 100");

	const value = await new Promise<string>((resolve) => {
		setTimeout(() => resolve(`${label} in a promise`), 100);
	});
	check.expect(value, "resolve from a timer set in the executor").toBe("timer in a promise");

	let raw = "";
	const pub = publicFor(() => {
		raw = `${label} through publicFor`;
	}, "srvcmd:amxts_closure_raw", 1);
	if (pub.length > 0) register_srvcmd("amxts_closure_raw", pub);
	server.command("amxts_closure_raw");
	await sleep(300);
	check.expect(raw, "a closure handed to the host by a public's name").toBe("timer through publicFor");

	check.expect(evenOrOdd(7), "a block's functions call each other before their declaration").toBe("odd");

	check.done();
}

function evenOrOdd(n: number) {
	return isEven(n) ? "even" : "odd";
	function isEven(k: number): boolean {
		return k == 0 ? true : isOdd(k - 1);
	}
	function isOdd(k: number): boolean {
		return k == 0 ? false : isEven(k - 1);
	}
}
