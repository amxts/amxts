// Errors point at the TypeScript: an Error's stack, an error nobody catches
// and a WebAssembly trap, each call with its file and line. A full build
// inlines small functions into their callers: a frame keeps the line of the
// inlined code and takes the name of the function it went into, so the
// checks read the file and the line.
//
// @log errors.aot: TypeError: Unexpected 'null' (not assigned or failed cast)
// @log (tests/server/errors.ts:26:
// @log errors.aot: RuntimeError: wasm operand stack overflow
// @log at descend (tests/server/errors.ts:34:
import { Checks } from "@amxts/core/check";

class Item {
	price = 0;
}

function makeError(): Error {
	return new Error("made here");
}

function rethrow(): void {
	throw new RangeError("thrown here");
}

function price(item: Item | null): number {
	return item!.price;
}

function onSelect(): number {
	return price(null);
}

function descend(depth: number): number {
	return depth + descend(depth + 1);
}

/** "    at name (file:line:column)" - its file and line. */
function place(line: string): string {
	return line.slice(line.lastIndexOf("(") + 1, line.lastIndexOf(":"));
}

server.addServerCommand("amxts_test_errors", () => {
	const check = new Checks("errors");

	const lines = makeError().stack.split("\n");
	check.expect(lines[0], "the first line of the stack is the error itself").toBe("Error: made here");
	check.expect(place(lines[1]), "then the call that made it").toBe("tests/server/errors.ts:18");
	check.expect(lines.length > 2, "and the calls below it").toBe(true);

	let caught = "";
	try {
		rethrow();
	} catch (error) {
		const stack = error.stack.split("\n");
		caught = `${stack[0]}|${place(stack[1])}`;
	}
	check.expect(caught, "a caught error keeps where it was thrown").toBe("RangeError: thrown here|tests/server/errors.ts:22");
	check.done();

	// After done: each call ends in an error, and the console shows its stack.
	setTimeout(() => onSelect(), 100);
	setTimeout(() => descend(0), 100);
});
