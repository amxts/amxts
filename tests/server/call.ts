// A buffer longer than what crosses to Pawn at once is copied that far, and
// the native is told that far: told the length the plugin asked for, it wrote
// past its copy on the host plugin's heap. A negative length - "the whole
// item" to ArrayGetArray, "no end" to formatex - has nothing to copy, and
// handed address 0 the native wrote into the host plugin's own data there.
// That holds for a native with a `...` tail, which goes through the
// dispatcher (amxts_call), and for one with a fixed arity. A buffer whose
// length the declaration does not give is copied up to 128 cells, and at the
// end of the plugin's memory only as far as the memory goes.
import { Call, CellBuffer } from "@amxts/core";
import { ArrayCreate, ArrayDestroy, ArrayGetArray, ArrayPushArray, NATIVE_formatex, get_players } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_call", run);

// The host plugin's first cell holds the empty string Pawn reads for an
// omitted text argument. A format given as the number 0 is that cell, so
// this is the length of what the cell holds - 0 while nothing wrote there.
function hostNullLength(): number {
	return new Call(NATIVE_formatex).buffer(new CellBuffer(16), 15).num(0).run();
}

function run() {
	const check = new Checks("call");

	const half = "x".repeat(10000);
	const written = new Call(NATIVE_formatex).buffer(new CellBuffer(20001), 20000).str("%s%s").str(half).str(half).run();
	check.expect(written, "formatex into 20000 cells is told the 16384 that cross").toBe(16384);

	const list = ArrayCreate(20000);
	const row = new CellBuffer(20000);
	ArrayPushArray(list, row.address, 20000);
	check.expect(ArrayGetArray(list, 0, row.address, 20000), "ArrayGetArray into 20000 cells is told the 16384 that cross").toBe(16384);
	ArrayDestroy(list);

	const letters = ArrayCreate(1);
	const letter = new CellBuffer(1);
	letter[0] = 65;
	ArrayPushArray(letters, letter.address, 1);
	check.expect(ArrayPushArray(letters, letter.address, 0), "ArrayPushArray of 0 cells still adds an item").toBe(1);
	check.expect(ArrayGetArray(letters, 0, letter.address, -1), "ArrayGetArray told -1 is not called").toBe(0);
	check.expect(hostNullLength(), "ArrayGetArray told -1 leaves the host's data alone").toBe(0);
	ArrayDestroy(letters);

	check.expect(new Call(NATIVE_formatex).buffer(letter, -1).str("B").run(), "formatex told -1 is not called").toBe(0);
	check.expect(hostNullLength(), "formatex told -1 leaves the host's data alone").toBe(0);

	// The 33 cells server.players passes get_players, in a page of its own at
	// the end of the plugin's memory, which the allocator never takes.
	const page = memory.grow(1);
	const ids = (page + 1) * 65536 - 33 * 4;
	const count = new CellBuffer(1);
	const none = new CellBuffer(1);
	get_players(ids, count.address, none.address, none.address);
	check.expect(count.get(0), "get_players fills a buffer at the end of the plugin's memory").toBe(server.players.length);

	check.done();
}
