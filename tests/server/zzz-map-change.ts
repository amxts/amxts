// A map change mid-game: AMX Mod X keeps the module loaded, and every plugin
// starts over on the new map. The command notes the clock and the starts
// counted, and changes to the same map the way the game does, which the old
// map's changeLevel and end hear; the version that comes back checks that it
// started once, that its interval fires once a period, that the clock went
// on - the module was not loaded again - that an entity's fields are the new
// map's, and that the new map's own events came once each, in order: the
// configs' last 6.1 seconds and a tick after the map started. A map change
// starts every plugin of the test server over, so this file is named to run
// after zz-reload.
import { engine_changelevel } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** The old map's clock and starts, for the plugin on the new map to look for. */
const left = new Cvar("amxts_test_map_left", "");
const starts = new Cvar("amxts_test_map_starts", "0");
/** What the old map heard as it ended: `"changeLevel c21_kitty, end"`. */
const ended = new Cvar("amxts_test_map_ended", "");

let ticks = 0;
setInterval(() => ticks++, 400);

/** This map's events, in order; when init came, and the game's seconds from it to configsExecuted. */
const heard: string[] = [];
let started = 0;
let initAt = 0;
let configsAfter = 0;

server.addEventListener("precache", () => heard.push("precache"));
server.addEventListener("pluginsLoaded", () => heard.push("pluginsLoaded"));
server.addEventListener("configsQueued", () => heard.push("configsQueued"));
server.addEventListener("configsExecuted", () => {
	heard.push("configsExecuted");
	configsAfter = game.time - initAt;
});
server.addEventListener("changeLevel", ({ map }) => {
	if (left.value.length > 0) ended.value = `changeLevel ${map}`;
});
server.addEventListener("end", () => {
	if (left.value.length > 0) ended.value = `${ended.value}, end`;
});

server.addServerCommand("amxts_test_map_change", () => {
	left.value = `${performance.now()} ${starts.number}`;
	ended.value = "";
	engine_changelevel(server.map);
});

server.addEventListener("init", () => {
	heard.push("init");
	started = performance.now();
	initAt = game.time;
	starts.number += 1;
	if (left.value.length > 0) setTimeout(check, 1000);
});

async function check() {
	const check = new Checks("map-change");
	const [clock, startsBefore] = left.value.split(" ");
	left.value = "";

	check.expect(ended.value, "the old map heard changeLevel, then end").toBe(`changeLevel ${server.map}, end`);
	check.expect(starts.number - parseInt(startsBefore), "the plugin starts once on the new map").toBe(1);
	check.expect(ticks >= 1 && ticks <= 3, `the new interval fires once a period (${ticks} in 1 s at 0.4 s)`).toBe(true);
	check.expect(performance.now() > parseFloat(clock), "the clock goes on: the module stayed loaded").toBe(true);

	const box = Entity.create("info_target");
	check.expect(box != null, "an entity is created on the new map").toBe(true);
	if (box != null) {
		box.origin = [64.0, -32.0, 16.0];
		check.expect(box.origin.x, "its fields read back on the new map").toBeCloseTo(64.0);
		box.remove();
	}

	while (heard.length < 5 && performance.now() - started < 9000) await sleep(100);
	await sleep(500);
	check.expect(heard.join(", "), "the map's events, once each").toBe("precache, init, pluginsLoaded, configsQueued, configsExecuted");
	check.expect(configsAfter >= 6.1 && configsAfter < 6.5, `configsExecuted on the tick after the one at 6.1 s (${Math.round(configsAfter * 100) / 100} s of the game's after init)`).toBe(true);
	check.done();
}
