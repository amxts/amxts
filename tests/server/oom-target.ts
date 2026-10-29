// The plugin the out-of-memory suite breaks: asked to, it wants more memory
// than a plugin's memory can hold, and traps as the allocator traps when its
// memory cannot grow. An interval and a server command count in cvars the
// suite reads. It holds no suite of its own, and the suite loads it.
// @unlisted
const ticks = new Cvar("amxts_test_oom_ticks", "0");
const pings = new Cvar("amxts_test_oom_pings", "0");

setInterval(() => ticks.number += 1, 100);
server.addServerCommand("amxts_oom_ping", () => pings.number += 1);

server.addServerCommand("amxts_oom_break", () => {
	if (memory.grow(65536) < 0) unreachable();
});

server.addServerCommand("amxts_oom_fail", () => {
	throw new Error("a failure of a broken plugin");
});
