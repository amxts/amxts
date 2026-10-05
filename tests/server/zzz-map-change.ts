// A map change mid-game: AMX Mod X keeps the module loaded, and every plugin
// starts over on the new map. The command notes this map's timer, the clock
// and the starts counted, and changes to the same map; the version that comes
// back checks that it started once, that the old timer's task is gone, that
// the clock went on - the module was not loaded again - and that an entity's
// fields are the new map's. A map change starts every plugin of the test
// server over, so this file is named to run after zz-reload.
import { task_exists } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** The old map's timer, clock and starts, for the plugin on the new map to look for. */
const left = new Cvar("amxts_test_map_left", "");
const starts = new Cvar("amxts_test_map_starts", "0");

let ticks = 0;
const interval = setInterval(() => ticks++, 400);

server.addServerCommand("amxts_test_map_change", () => {
	left.value = `${interval} ${performance.now()} ${starts.number}`;
	server.command(`changelevel ${server.map}`);
});

server.addEventListener("init", () => {
	starts.number += 1;
	if (left.value.length > 0) setTimeout(check, 1000);
});

function check() {
	const check = new Checks("map-change");
	const [oldInterval, clock, startsBefore] = left.value.split(" ");
	left.value = "";

	check.expect(starts.number - parseInt(startsBefore), "the plugin starts once on the new map").toBe(1);
	check.expect(task_exists(parseInt(oldInterval), 1), "the old map's interval is gone").toBe(0);
	check.expect(ticks >= 1 && ticks <= 3, `the new interval fires once a period (${ticks} in 1 s at 0.4 s)`).toBe(true);
	check.expect(performance.now() > parseFloat(clock), "the clock goes on: the module stayed loaded").toBe(true);

	const box = Entity.create("info_target");
	check.expect(box != null, "an entity is created on the new map").toBe(true);
	if (box != null) {
		box.origin = [64.0, -32.0, 16.0];
		check.expect(box.origin.x, "its fields read back on the new map").toBeCloseTo(64.0);
		box.remove();
	}
	check.done();
}
