// Natives the Pawn plugin natives.sma calls: strings, Float, arrays and
// buffers for the result. This plugin has no checks of its own - the Pawn side
// makes them, on what it got.
import { nativeFn, ret } from "@amxts/core";

/** Sum of two whole numbers. */
export function xt_sum(a: number, b: number) {
	return a + b;
}

/** A greeting for a name, into out[]. */
export function xt_greet(name: string) {
	// Cyrillic on purpose: natives.sma checks that UTF-8 reaches Pawn whole.
	return `Привет, ${name}!`;
}

/** Half of a float. */
export function xt_half(value: Float): Float {
	return value / 2;
}

/** Sum of an array of cells. */
export function xt_total(values: number[]) {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

/** Every value times factor, into out[]. */
export function xt_scaled(values: Float[], factor: Float): Float[] {
	const scaled: number[] = [];
	for (const value of values) scaled.push(value * factor);
	return scaled;
}

/** The value of a known key, or false. */
export function xt_find(key: string) {
	return key == "map" ? "c21_kitty" : null;
}

/** Whether n is even. */
export function xt_is_even(n: number) {
	return n % 2 == 0;
}

/** x, or 5 when left out. */
export function xt_default(x = 5) {
	return x;
}

/** The length of a string in letters: UTF-8 has to arrive whole. */
export function xt_length(text: string) {
	return text.length;
}

// Two hundred natives beyond these: together the plugins export more than the
// module once had room for (128).
for (let index = 0; index < 200; index++) exportMany(index);

function exportMany(index: number) {
	nativeFn(`xt_many_${index}`, () => ret(index));
}

// A forward with an argument of every kind - more than three, which was once the limit.
const many = new Forward<number, string, number, Float, boolean, number[], Vector, string>("xt_on_many");
let heard = "";

many.subscribe((id, word, count, speed, flag, list, at, long) => {
	heard = `${id} ${word} ${count} ${speed} ${flag} ${list.join(",")} ${at.join(",")} ${long.length}`;
});

/** Emits xt_on_many with an argument of every kind; what its TypeScript subscriber heard, into out[]. */
export function xt_emit_many() {
	// Cyrillic on purpose: natives.sma checks that UTF-8 reaches Pawn whole.
	many.emit(7, "раз два", 42, 2.5, true, [1, 2, 3], new Vector(1.5, 2.5, 3.5), "x".repeat(2000));
	return heard;
}

// A forward a Pawn plugin makes: natives.sma raises it with an argument of
// each kind it passes, an array through PrepareArray among them.
const fromPawn = new Forward<number, string, Float, number[]>("xt_from_pawn");
let heardFromPawn = "";

fromPawn.subscribe((id, word, speed, list) => {
	heardFromPawn = `${id} ${word} ${speed} ${list.join(",")}`;
});

/** What the subscriber of natives.sma's forward xt_from_pawn heard, into out[]. */
export function xt_heard_from_pawn() {
	return heardFromPawn;
}
