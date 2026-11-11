// A plugin that throws, call after call, goes on as it was: an error ends
// its call and leaves nothing behind - neither a listener's the module
// enters each frame, nor one entered from inside the plugin's own call.
// Each error is deep in calls that keep strings, as a real one is.
//
// @log throws.aot: RangeError: Index out of range
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

// Enough errors, each this deep, to use up a plugin's stack many times over
// if an error left its calls' room taken.
const THROWS = 200;
const DEPTH = 64;

const items: string[] = [];

function pick(at: number, path: string): string {
	return path + items[at];
}

function descend(depth: number, path: string): string {
	return depth == 0 ? pick(depth, path) : descend(depth - 1, `${path}.`) + path;
}

server.addServerCommand("amxts_throws_once", () => {
	descend(DEPTH, "command");
});

/** What still works: a string as written, one made, an array filled. */
function works(check: Checks, after: string) {
	check.expect("a string as written", `${after}: a string reads as written`).toBe("a string as written");
	const made: string[] = [];
	for (let i = 0; i < 100; i++) made.push(`item ${i}`);
	check.expect(made.join(",").length, `${after}: strings and arrays are made`).toBe(789);
}

server.addServerCommand("amxts_test_throws", () => {
	const check = new Checks("throws");

	for (let i = 0; i < THROWS; i++) {
		server.command("amxts_throws_once");
		server_exec();
	}
	works(check, "after errors in calls it made");

	let thrown = 0;
	const onFrame = () => {
		if (thrown == THROWS) {
			server.removeEventListener("frame", onFrame);
			works(check, "after errors in a listener");
			check.done();
			return;
		}
		thrown++;
		descend(DEPTH, "frame");
	};
	server.addEventListener("frame", onFrame);
});
