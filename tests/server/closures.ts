// Замыкания на сервере: таймеры, событие кадра и async-стрелка, которые
// пользуются переменными вокруг себя.
import { publicFor } from "~/facade";
import { register_srvcmd } from "~/natives";
import { Checks } from "~/lib/check";

server.addServerCommand("amxts_test_closures", () => {
	run();
});

class Tally {
	count = 0;

	/** Стрелка в методе видит `this`. */
	bump(times: number) {
		for (let i = 0; i < times; i++) setTimeout(() => this.count++, 50);
	}
}

async function run() {
	const check = new Checks("closures");

	const label = "таймер";
	let fired = "";
	setTimeout(() => {
		fired = `${label} сработал`;
	}, 100);
	await sleep(300);
	check.expect(fired, "setTimeout видит константу и меняет общую переменную").toBe("таймер сработал");

	let ticks = 0;
	const handle = setInterval(() => {
		if (++ticks == 3) clearInterval(handle);
	}, 50);
	await sleep(600);
	check.expect(ticks, "setInterval останавливает себя своим дескриптором").toBe(3);

	let order = "";
	for (let i = 1; i <= 3; i++) {
		setTimeout(() => {
			order += `${i}`;
		}, i * 50);
	}
	await sleep(400);
	check.expect(order, "у каждой итерации цикла свой i").toBe("123");

	const tally = new Tally();
	tally.bump(4);
	await sleep(300);
	check.expect(tally.count, "стрелка в методе видит this").toBe(4);

	let frames = 0;
	const onFrame = () => {
		frames++;
	};
	server.addEventListener("frame", onFrame);
	await sleep(300);
	server.removeEventListener("frame", onFrame);
	const counted = frames;
	await sleep(200);
	check.expect(counted > 0, "обработчик кадра считает в переменную вокруг").toBe(true);
	check.expect(frames, "снятый обработчик больше не зовётся").toBe(counted);

	const name = "async";
	let awaited = "";
	const later = async (ms: number) => {
		await sleep(ms);
		awaited = `${name} после ${ms}`;
	};
	later(100);
	await sleep(300);
	check.expect(awaited, "async-стрелка видит переменные до и после await").toBe("async после 100");

	const value = await new Promise<string>((resolve) => {
		setTimeout(() => resolve(`${label} в промисе`), 100);
	});
	check.expect(value, "resolve из таймера, заведённого в executor").toBe("таймер в промисе");

	let raw = "";
	const pub = publicFor(() => {
		raw = `${label} через publicFor`;
	}, "srvcmd:amxts_closure_raw", 1);
	if (pub.length > 0) register_srvcmd("amxts_closure_raw", pub);
	server.command("amxts_closure_raw");
	await sleep(300);
	check.expect(raw, "замыкание, отданное хосту по имени public").toBe("таймер через publicFor");

	check.expect(evenOrOdd(7), "функции блока вызывают друг друга до объявления").toBe("odd");

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
