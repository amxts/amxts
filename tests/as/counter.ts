// A fixture for tests/fake-server.test.ts: the map's start, a console
// command, a server command, a cvar with a change listener, an exported
// native, a search in a sphere, and one native the fake server does not
// answer.
import { nativeFn, ret } from "@amxts/core";
import { get_user_time } from "@amxts/core/natives";

const step = new Cvar("counter_step", "1");
let total = 0;

step.addEventListener("change", event => console.log(`step ${event.oldValue} -> ${event.value}`));
server.addEventListener("pluginsLoaded", () => console.log("plugins loaded"));
server.addEventListener("configsExecuted", () => console.log(`configs executed, step ${step.number}`));

server.addCommand<AddArgs>("counter_add [times]", ({ player, times }) => add(player, times ?? 1), { description: "Adds the step to the counter" });
server.addCommand("counter_time", ({ player }) => playedTime(player));
server.addCommand("counter_near", ({ player }) => countNear(player));
server.addServerCommand<ResetArgs>("counter_reset [to]", ({ to }) => reset(to ?? 0));

nativeFn("counter_total", reportTotal);

interface AddArgs {
	times?: number;
}

interface ResetArgs {
	to?: number;
}

function add(player: Player, times: number) {
	total += step.number * times;
	print(player, `Counter: ${total}`, "console");
}

function reset(to: number) {
	total = to;
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
