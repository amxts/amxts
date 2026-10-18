// Errors point at the TypeScript. In a dev build (`amxts dev`, --quick here)
// an Error's stack, an error nobody catches and a WebAssembly trap name each
// call with its file and line; a full build keeps no frames, and an error
// says its message and, thrown or aborted, its place. A build inlines small
// functions into their callers: a frame keeps the line of the inlined code
// and takes the name of the function it went into, so the checks read the
// file and the line. A listener the module enters from inside a try - of
// the plugin's own, or the one an async function's body runs in - is a call
// of its own, as a listener of dispatchEvent is: its error ends it with its
// message, and the code it was entered from goes on.
//
// @log errors.aot: Error: from a command
// @log errors.aot: TypeError: Unexpected 'null' (not assigned or failed cast)
// @log tests/server/errors.ts:33:
// @log errors.aot: RuntimeError:
// @log-dev at descend (tests/server/errors.ts:41:
import { server_exec } from "@amxts/core/natives";
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

server.addServerCommand("amxts_errors_throw", () => {
	throw new Error("from a command");
});

/** Runs the command that throws, now, as the console would. */
function runThrowing() {
	server.command("amxts_errors_throw");
	server_exec();
}

async function runThrowingInside(): Promise<string> {
	runThrowing();
	return "went on";
}

interface ErrorsArgs {
	build?: string;
}

server.addServerCommand<ErrorsArgs>("amxts_test_errors [build]", ({ build }) => {
	const check = new Checks("errors");
	const dev = build == "dev";

	const lines = makeError().stack.split("\n");
	check.expect(lines[0], "the first line of the stack is the error itself").toBe("Error: made here");
	if (dev) {
		check.expect(place(lines[1]), "then the call that made it").toBe("tests/server/errors.ts:25");
		check.expect(lines.length > 2, "and the calls below it").toBe(true);
	} else {
		check.expect(lines.length, "a full build keeps no frames").toBe(1);
	}

	let caught = "";
	try {
		rethrow();
	} catch (error) {
		const stack = error.stack.split("\n");
		caught = dev ? `${stack[0]}|${place(stack[1])}` : stack[0];
	}
	check.expect(caught, "a caught error is the one thrown").toBe(dev ? "RangeError: thrown here|tests/server/errors.ts:29" : "RangeError: thrown here");

	let reached = "";
	try {
		runThrowing();
		reached = "went on";
	} catch (error) {
		reached = `caught ${error.message}`;
	}
	check.expect(reached, "a listener's error, entered from a try, is not the try's").toBe("went on");
	runThrowingInside()
		.then((value) => {
			check.expect(value, "nor an async function's it is entered from").toBe("went on");
		})
		.catch((error: Error) => {
			check.expect(error.message, "nor an async function's it is entered from").toBe("went on");
		})
		.finally(() => check.done());

	// After done: each call ends in an error, and the console shows its stack.
	setTimeout(() => onSelect(), 100);
	setTimeout(() => descend(0), 100);
});
