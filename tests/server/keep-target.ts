// The plugin the keep suite reloads: each start counts one more than the
// count its last run kept, and says in cvars what it was given. With
// amxts_test_keep_skip set it neither reads nor keeps anything. It holds no
// suite of its own.
const given = new Cvar("amxts_test_keep_given", "0");
const frames = new Cvar("amxts_test_keep_frames", "");
const skip = new Cvar("amxts_test_keep_skip", "0");

// Read in "init", which is still the start: the cvars are made as the plugin starts.
let skipped = false;
let starts = 0;

server.addEventListener("init", () => {
	skipped = skip.number != 0;
	if (!skipped) {
		starts = (server.kept<number>("starts") ?? 0) + 1;
		frames.value = (server.kept<Uint8Array>("frames") ?? new Uint8Array(0)).join(",");
	}
	given.number = starts;
});

server.addEventListener("end", () => {
	if (skipped) return;
	server.keep("starts", starts);
	server.keep("frames", new Uint8Array(3).fill(starts));
});

server.addServerCommand("amxts_keep_late", () => {
	given.number = server.kept<number>("starts") ?? -1;
});
