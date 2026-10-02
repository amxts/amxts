// A touch filtered by classes before WebAssembly: the listener hears only
// the pair of classes it asked for, toucher and touched in their places.
// The touch is real: a flying entity passes through a trigger, and the engine itself
// calls Touch(trigger, flyer) - fake_touch goes past the engine module.
import { Checks } from "@amxts/core/check";

const heard: string[] = [];

game.addEventListener("touch", onTouch, { toucher: "amxts_toucher", touched: "amxts_touched" });
game.addEventListener("touch", onReverse, { toucher: "amxts_touched", touched: "amxts_toucher" });

function onTouch(event: TouchEvent) {
	heard.push(`${event.toucher.classname} -> ${event.touched.classname}`);
}

function onReverse() {
	heard.push("reverse");
}

server.addServerCommand("amxts_test_touch", run);

async function run() {
	const check = new Checks("touch");

	const spot = Entity.find({ classname: "info_player_start" }) ?? Entity.find({ classname: "info_player_deathmatch" });
	const trigger = Entity.create("info_target");
	const mover = Entity.create("info_target");
	check.expect(spot != null && trigger != null && mover != null, "a spawn point and two entities").toBe(true);
	if (spot == null || trigger == null || mover == null) {
		check.done();
		return;
	}

	const here = spot.origin.add([0.0, 0.0, 64.0]);

	trigger.classname = "amxts_touched";
	trigger.solid = "trigger";
	trigger.setSize([-32.0, -32.0, -32.0], [32.0, 32.0, 32.0]);
	trigger.origin = here;

	mover.classname = "amxts_toucher";
	mover.solid = "box";
	mover.moveType = "fly";
	mover.setSize([-4.0, -4.0, -4.0], [4.0, 4.0, 4.0]);
	mover.origin = here;
	mover.velocity = [0.0, 0.0, 4.0];

	await sleep(300);

	check.expect(heard.includes("amxts_toucher -> amxts_touched"), `the touch of the class pair arrived, the sides in place (${heard.join("; ")})`).toBe(true);
	check.expect(heard.includes("reverse"), "the trigger does not enter the flyer: no reverse pair").toBe(false);

	trigger.remove();
	mover.remove();
	check.done();
}
