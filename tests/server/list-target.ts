// @unlisted
// The plugin the list suite adds to the test server's plugins.ini and takes
// out again: its starts and its "end", each counted in a cvar the suite
// reads. It holds no suite of its own.
const starts = new Cvar("amxts_test_list_starts", "0");
const ends = new Cvar("amxts_test_list_ends", "0");

server.addEventListener("init", () => starts.number += 1);
server.addEventListener("end", () => ends.number += 1);
