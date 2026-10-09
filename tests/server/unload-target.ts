// The plugin the unload suite stops and starts again: an interval, a server
// command and its "end", each counting in a cvar the suite reads. It holds no
// suite of its own.
const ticks = new Cvar("amxts_test_unload_ticks", "0");
const pings = new Cvar("amxts_test_unload_pings", "0");
const ends = new Cvar("amxts_test_unload_ends", "0");

setInterval(() => ticks.number += 1, 200);
server.addServerCommand("amxts_ping_unload", () => pings.number += 1);
server.addEventListener("end", () => ends.number += 1);
