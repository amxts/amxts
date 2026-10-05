// A number made a 32-bit integer under WAMR AOT, as JavaScript's ToInt32 and
// ToUint32 make it: truncated toward zero, wrapped modulo 2^32, NaN and the
// infinities 0. On i386 a number within 32 bits takes one path in the machine
// code and a wider one another, so both sides of every edge are here. The
// numbers are read from an array as the plugin runs: written in place, the
// compiler would work the answers out itself and test nothing that runs.
import { Checks } from "@amxts/core/check";

interface Case {
	value: number;
	int32: number;
	uint32: number;
}

const CASES: Case[] = [
	{ value: 0, int32: 0, uint32: 0 },
	{ value: 1.9, int32: 1, uint32: 1 },
	{ value: -1.9, int32: -1, uint32: 4294967295 },
	{ value: 2147483647.9, int32: 2147483647, uint32: 2147483647 },
	{ value: 2147483648, int32: -2147483648, uint32: 2147483648 },
	{ value: -2147483648.9, int32: -2147483648, uint32: 2147483648 },
	{ value: -2147483649, int32: 2147483647, uint32: 2147483647 },
	{ value: 4294967301, int32: 5, uint32: 5 },
	{ value: -4294967301, int32: -5, uint32: 4294967291 },
	{ value: 1e18, int32: -1486618624, uint32: 2808348672 },
	{ value: NaN, int32: 0, uint32: 0 },
	{ value: -Infinity, int32: 0, uint32: 0 },
];

server.addServerCommand("amxts_test_numbers", run);

function run() {
	const check = new Checks("numbers");

	for (const each of CASES) {
		check.expect(each.value | 0, `${each.value} | 0`).toBe(each.int32);
		check.expect(each.value >>> 0, `${each.value} >>> 0`).toBe(each.uint32);
	}

	check.done();
}
