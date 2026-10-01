// Нативы, которые зовёт Pawn-плагин natives.sma: строки, Float, массивы и
// буферы для результата. Своих проверок у этого плагина нет - их делает
// Pawn-сторона, на том, что получила.
import { nativeFn, ret } from "@amxts/core";

/** Sum of two whole numbers. */
export function xt_sum(a: number, b: number) {
	return a + b;
}

/** A greeting for a name, into out[]. */
export function xt_greet(name: string) {
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

// Двести нативов сверх этих: вместе плагины экспортируют больше, чем у модуля
// когда-то было для них мест (128).
for (let index = 0; index < 200; index++) exportMany(index);

function exportMany(index: number) {
	nativeFn(`xt_many_${index}`, () => ret(index));
}

// Форвард с аргументом каждого вида - больше трёх, что когда-то было пределом.
const many = new Forward<number, string, number, Float, boolean, number[], Vector, string>("xt_on_many");
let heard = "";

many.subscribe((id, word, count, speed, flag, list, at, long) => {
	heard = `${id} ${word} ${count} ${speed} ${flag} ${list.join(",")} ${at.join(",")} ${long.length}`;
});

/** Emits xt_on_many with an argument of every kind; what its TypeScript subscriber heard, into out[]. */
export function xt_emit_many() {
	many.emit(7, "раз два", 42, 2.5, true, [1, 2, 3], new Vector(1.5, 2.5, 3.5), "x".repeat(2000));
	return heard;
}
