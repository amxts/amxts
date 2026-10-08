// The probes of tests/whole-numbers.test.ts: plain TypeScript, compiled by
// the test as a plugin is and imported by it as JavaScript.
/** Euclid's remainders: whole numbers below 700 all the way. */
export function divisors(): number {
	let total = 0;
	for (let a = 1; a < 300; a++) {
		for (let b = 1; b < 300; b++) {
			let x = a;
			let y = b;
			while (y !== 0) {
				const rest = x % y;
				x = y;
				y = rest;
			}
			total += x;
		}
	}
	return total;
}

/** Trial division, bounded by d * d <= n. */
export function primes(): number {
	let count = 0;
	for (let n = 2; n < 5000; n++) {
		let prime = true;
		for (let d = 2; d * d <= n; d++) {
			if (n % d === 0) {
				prime = false;
				break;
			}
		}
		if (prime) count++;
	}
	return count;
}

/** A product within i32, then a remainder by a constant. */
export function powers(): number {
	let total = 0;
	for (let base = 1; base < 500; base++) {
		let value = 1;
		for (let i = 0; i < 500; i++) value = value * base % 10007;
		total += value;
	}
	return total;
}

/** 2^31 - 1, then one more: past i32, still exact. */
export function pastI32(): number {
	let x = 2147483647;
	for (let i = 0; i < 3; i++) x = x + 1;
	return x;
}

/** A counter that crosses 2^31. */
export function counterPastI32(): number {
	let sum = 0;
	for (let i = 2147483640; i < 2147483660; i++) sum += i;
	return sum;
}

/** A remainder of a negative number: -1, and -0 where it divides. */
export function negativeRemainder(): number {
	let last = 0;
	for (let i = -7; i < 0; i++) last = i % 7;
	return last;
}

export function negativeRemainderSum(): number {
	let sum = 0;
	for (let i = -20; i < 20; i++) sum += i % 3;
	return sum;
}

/** -0 from a negation and from a product with 0. */
export function negativeZero(): number {
	let z = 0;
	for (let i = 0; i < 2; i++) z = -z;
	return z;
}

export function negativeZeroProduct(): number {
	let z = 1;
	for (let i = -1; i < 0; i++) z = 0 * i;
	return z;
}

/** NaN from 0 / 0. */
export function notANumber(): number {
	let n = 0;
	for (let i = 0; i < 2; i++) n = n / n;
	return n;
}

/** >>> 0 of -1 is 2^32 - 1. */
export function unsigned(): number {
	let x = 0;
	for (let i = -1; i < 0; i++) x = i >>> 0;
	return x;
}

/** A division of whole numbers is not whole: 7 / 2 is 3.5. */
export function halves(): number {
	let sum = 0;
	for (let i = 0; i < 10; i++) sum += i / 2;
	return sum;
}

export function sevenHalves(): number {
	let x = 7;
	for (let i = 0; i < 1; i++) x = x / 2;
	return x;
}

/** Whole numbers from bitwise operations, floor and an index. */
export function bits(): number {
	const list = [5, 3, 9, 1];
	let total = 0;
	for (let i = 0; i < list.length; i++) {
		total += (list[i] & 6) | (i << 2);
		total += Math.floor(i / 2);
	}
	return total;
}

/** A whole number from a fraction: 0.5 steps are not whole. */
export function fractions(): number {
	let x = 0;
	for (let i = 0; i < 5; i++) x += 0.5;
	return x;
}

/** A counter going down past -2^31. */
export function downPastI32(): number {
	let last = 0;
	for (let i = -2147483640; i > -2147483660; i--) last = i;
	return last;
}

/** A sum of many whole numbers past 2^31. */
export function bigSum(): number {
	let total = 0;
	for (let i = 0; i < 100000; i++) total += 40000;
	return total;
}
