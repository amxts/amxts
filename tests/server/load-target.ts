// The plugin the load suite starts with amxts_load: it lies in plugins/ and
// the plugin list does not name it. It counts its starts in a cvar the suite
// reads, and holds no suite of its own.
// @unlisted
const starts = new Cvar("amxts_test_load_starts", "0");

server.addEventListener("init", () => starts.number += 1);
