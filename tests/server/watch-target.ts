// The plugin the watch suite writes over: its starts and its "end", each
// counted in a cvar the suite reads. It calls no module, and holds no suite
// of its own.
const starts = new Cvar("amxts_test_watch_starts", "0");
const ends = new Cvar("amxts_test_watch_ends", "0");

server.addEventListener("init", () => starts.number += 1);
server.addEventListener("end", () => ends.number += 1);
