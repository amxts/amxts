// A fixture for tests/keep.test.ts: what a run keeps for the next one -
// a count, bytes, text and an object - read back as it starts.

interface Run {
	player: string;
	time: number;
}

const starts = (server.kept<number>("starts") ?? 0) + 1;
const frames = server.kept<Uint8Array>("frames");
const note = server.kept<string>("note");
const run = server.kept<Run>("run");

server.addEventListener("init", () => console.log(`init sees ${server.kept<number>("starts") ?? 0}`));
console.log(`start ${starts}: ${frames == null ? "no frames" : frames.join(",")}, ${note ?? "no note"}, ${run == null ? "no run" : `${run.player} ${run.time}`}`);

server.addEventListener("end", () => {
	server.keep("starts", starts);
	server.keep("frames", new Uint8Array(3).fill(starts));
	server.keep("note", `hello ${starts}`);
	server.keep<Run>("run", { player: "Alice", time: 3.95 });
});

server.addServerCommand("keep_late", () => {
	console.log(`later: ${server.kept<number>("starts") ?? 0}`);
});
