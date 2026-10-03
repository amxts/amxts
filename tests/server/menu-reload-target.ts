// The plugin the menu-reload suite reloads and unloads: a menu made at its
// top level, as a project's plugin makes it. Its title names the load that
// made it, and every call of its functions is counted in a cvar the suite
// reads. It holds no suite of its own.
const loads = new Cvar("amxts_test_menu_reload_loads", "0");
const calls = new Cvar("amxts_test_menu_reload_calls", "0");

let load = 0;

server.addEventListener("init", () => {
	loads.number += 1;
	load = loads.number;
});

const hello = menus.create("TEST_RELOAD_HELLO", { title: ({ player }) => title(player) });
hello.addItem({ title: "Wave", onSelect: ({ player }) => wave(player) });
hello.addItem({
	title: ({ player }) => healTitle(player),
	visible: ({ player }) => player.health < 100,
	onSelect: ({ player }) => heal(player),
});

function title(player: Player) {
	calls.number += 1;
	return `Hello, ${player.name} (load ${load})`;
}

function healTitle(player: Player) {
	calls.number += 1;
	return `Heal (${player.health} HP)`;
}

function wave(player: Player) {
	calls.number += 1;
	print(0, `${player.name} waves`);
}

function heal(player: Player) {
	calls.number += 1;
	player.health = 100;
}
