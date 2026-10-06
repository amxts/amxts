// A plugin's memory on a long run: the garbage a busy plugin makes every
// frame and in long loops is collected as it goes, so the memory the plugin
// takes settles and stays there, and what a parked async function holds
// survives every collection meanwhile.
import { Checks } from "@amxts/core/check";

/** The rounds of garbage before the memory is read, and after it. */
const SETTLE = 4;
const SOAK = 40;

server.addServerCommand("amxts_test_memory", () => {
	run();
});

let litter = 0;

/** What a busy plugin leaves behind: vectors, text, its words, a list, an object. */
function makeGarbage(count: number) {
	for (let i = 0; i < count; i++) {
		const where = new Vector(i, i * 2, i * 3);
		const text = `player ${i} at ${where.x} ${where.add(where).y}`;
		const words = text.split(" ");
		const seen = new Map<string, number>();
		seen.set(words[0], i);
		litter += words.length + seen.size + [where.z, i].length;
	}
}

/** Holds a vector, text and a list through a sleep in which collections run. */
async function holdThrough(ms: number) {
	const kept = new Vector(1, 2, 3);
	const label = `kept ${40 + 2}`;
	const list = [new Vector(4, 5, 6), new Vector(7, 8, 9)];
	await sleep(ms);
	return `${kept.y} ${label} ${list[1].z}`;
}

/** Garbage every frame while the memory is read. */
function onFrame() {
	makeGarbage(100);
}

async function run() {
	const check = new Checks("memory");
	const held = holdThrough(1500);

	server.addEventListener("frame", onFrame);
	for (let round = 0; round < SETTLE; round++) makeGarbage(5000);
	await sleep(500);
	const settled = memory.size();

	// Several times the memory itself in garbage, in one call and over frames.
	for (let round = 0; round < SOAK; round++) makeGarbage(5000);
	await sleep(1000);
	server.removeEventListener("frame", onFrame);
	const after = memory.size();

	check.expect(litter > 0, "the garbage was made").toBe(true);
	check.expect(after, `the memory stays where it settled (${settled} pages)`).toBe(settled);
	check.expect(await held, "a parked async function keeps what it holds").toBe("2 kept 42 9");
	check.done();
}
