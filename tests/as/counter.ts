// A fixture for tests/fake-server.test.ts: a console command, a server
// command, a cvar with a change listener, an exported native, a search in a
// sphere, and one native the fake server does not answer.
import { nativeFn, ret } from "~/facade";
import { get_user_time } from "~/natives";

const step = new Cvar("counter_step", "1");
let total = 0;

step.addEventListener("change", event => console.log(`step ${event.oldValue} -> ${event.value}`));

server.addCommand("counter_add", add, { description: "Adds the step to the counter" });
server.addCommand("counter_time", playedTime);
server.addCommand("counter_near", countNear);
server.addServerCommand("counter_reset", reset);

nativeFn("counter_total", reportTotal);

function add(player: Player, args: string[]) {
	const times = args.length > 0 ? parseInt(args[0]) : 1;
	total += step.number * times;
	print(player, `Counter: ${total}`, "console");
}

function reset(args: string[]) {
	total = args.length > 0 ? parseInt(args[0]) : 0;
	console.log(`reset to ${total}`);
}

function countNear(player: Player) {
	const near = Entity.findAll({ classname: "info_target", near: player.origin, radius: 100 });
	print(player, `near: ${near.length}`, "console");
}

function playedTime(player: Player) {
	print(player, `played ${get_user_time(player.id)} s`, "console");
}

function reportTotal() {
	ret(total);
}
