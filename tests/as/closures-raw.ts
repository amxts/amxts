// The test plugin of tests/closures.test.ts: closures where the facade hands a
// function to the host by number (cmd, cmdWide, hook, publicFor, nativeFn),
// a function value with fewer parameters, hoisting of function declarations,
// `super` in an arrow, recursion by name and closures at the file's top level.
import { cmd, cmdWide, handled, hook, nativeFn, publicFor } from "@amxts/core";
import { register_touch } from "@amxts/core/natives";

const prefix = "raw";

function install(label: string) {
	let heard = 0;
	cmd("amxts_narrow", (id) => {
		heard++;
		print(id, `${prefix} ${label} narrow ${heard}`);
	});
	cmdWide("amxts_wide", (id, level) => {
		heard++;
		print(id, `${label} wide ${heard} ${level}`);
		handled();
	});
	hook("take_damage", victim => console.log(`${label} hook ${victim}`));
	const onTouch = publicFor((touched, toucher) => console.log(`${label} touch ${touched} ${toucher}`), "touch:closures");
	if (onTouch.length > 0) register_touch("player", "player", onTouch);
	nativeFn("closures_heard", () => console.log(`${label} native ${heard}`));
}

install("inside");

// A function value with fewer parameters than the listener type.
let joins = 0;
// A function in a variable is what this checks, not a style.
// oxlint-disable-next-line antfu/top-level-function
const onJoin = () => {
	joins++;
};
server.addEventListener("putInServer", onJoin);

export function stop_counting() {
	server.removeEventListener("putInServer", onJoin);
}

export function joins_now() {
	return joins;
}

// A timer whose handler takes nothing, passed by name.
let ticks = 0;
function tick() {
	ticks++;
}
setTimeout(tick, 100);

export function ticks_now() {
	return ticks;
}

// Top-level loop with a closure over its `let`.
const sums: (() => number)[] = [];
for (let i = 1; i <= 3; i++) sums.push(() => i * 10);

export function loop_sums() {
	return sums.map(sum => sum()).join(",");
}

// Hoisted functions, calling each other, above their declarations.
export function hoisted() {
	const answer = isEven(10) ? "even" : "odd";
	function isEven(n: number): boolean {
		return n == 0 ? true : isOdd(n - 1);
	}
	function isOdd(n: number): boolean {
		return n == 0 ? false : isEven(n - 1);
	}
	return answer;
}

// A named function expression calling itself.
export function factorial(n: number) {
	const fact = function f(k: number): number {
		return k <= 1 ? 1 : k * f(k - 1);
	};
	return fact(n);
}

class Base {
	greet() {
		return "base";
	}
}

class Derived extends Base {
	greet() {
		const call = () => `${super.greet()}+derived`;
		return call();
	}
}

export function super_in_arrow() {
	return new Derived().greet();
}

export function shadowed() {
	let x = 1;
	const read = () => {
		{
			let x = 5;
			x++;
			console.log(`inner x ${x}`);
		}
		return x;
	};
	x = 2;
	return read();
}
