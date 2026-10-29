// A plugin of many frame listeners, most frames about a millisecond and one
// held past amxts_slow_ms every few seconds, with another event of its own
// slow more often: every line after the first names the slowest listener of
// the call it reports, with its own time, though the lines back off and most
// slow calls go unsaid - the other event's slow calls in between included.
// @log [amxts] slow-kz.aot: the listeners of server_frame held the frame
// @log [amxts] slow-kz.aot: the listeners of plugin_log held the frame
// @log (amxts_slow_ms 15)
import { get_localinfo } from "@amxts/core/natives";
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const MARK = "amxts slow-kz";
const slowMs = new Cvar("amxts_slow_ms");
let started = false;
let frameAt = 0;

server.addServerCommand("amxts_test_slow_kz", slowKz);

/** Holds the frame for `ms` milliseconds. */
function busy(ms: number) {
	const until = performance.now() + ms;
	while (performance.now() < until) continue;
}

// Ten listeners, given as function values that take no event, as a wrapper
// gives them: each a tenth of a millisecond, the seventh 20 ms once in 3 s.
const held: () => void = holdFrame;
for (let i = 0; i < 10; i++) {
	const keepBusy: () => void = () => {
		if (started) busy(0.1);
	};
	server.addEventListener("frame", i == 6 ? held : keepBusy);
}

function holdFrame() {
	if (!started) return;
	busy(0.1);
	if (performance.now() < frameAt) return;
	frameAt = performance.now() + 3000;
	busy(20);
}

// Two listeners of the game's log, the second 20 ms on a bot's line marked,
// said once a second.
server.addEventListener("log", () => {});
server.addEventListener("log", holdLog);

function holdLog(event: PluginLogEvent) {
	if (started && event.text.includes(MARK)) busy(20);
}

/** The lines of AMX Mod X's logs about this plugin's walks of `event`. */
function lines(event: string): string[] {
	const dir = get_localinfo("amxx_logs");
	const line = `slow-kz.aot: the listeners of ${event} held the frame`;
	const all: string[] = [];
	for (const file of fs.readdirSync(dir) ?? []) {
		if (!file.endsWith(".log")) continue;
		all.push(...(fs.readFileSync(`${dir}/${file}`) ?? "").split("\n").filter(each => each.includes(line)));
	}
	return all;
}

function slowKz() {
	const check = new Checks("slow-kz");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);
	const frames = lines("server_frame").length;
	const logs = lines("plugin_log").length;
	// Past the noise of a busy machine's frames.
	slowMs.number = 15;
	started = true;
	const marking = setInterval(() => bot?.command(`say "${MARK}"`), 1000);
	// Said at once, then 10 s later.
	setTimeout(() => {
		started = false;
		clearInterval(marking);
		slowMs.number = 5;
		named(check, lines("server_frame").slice(frames), "holdFrame (7 of 10), 20.");
		named(check, lines("plugin_log").slice(logs), "holdLog (2 of 2), 20.");
		check.done();
	}, 25000);
}

/** Every line but the first names `slowest`. */
function named(check: Checks, said: string[], slowest: string) {
	check.expect(said.length >= 2, `${said.length} lines of ${slowest}`).toBe(true);
	for (let i = 1; i < said.length; i++) {
		check.expect(said[i].includes(`; the slowest, ${slowest}`), `line ${i + 1} names the slowest: ${said[i]}`).toBe(true);
	}
}
