// A menu made at a plugin's top level, as a project's plugin makes it, in a
// plugin the tests unload and load again: menu-core drops what it gave, and
// the new load makes the menu once more, its items once.
let waves = 0;

const hello = menus.create("SHARED_HELLO", { title: ({ player }) => `Hello, ${player.name}` });
hello.addItem({ title: "Wave", onSelect: () => waves += 1 });
hello.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	visible: ({ player }) => player.health < 100,
	onSelect: ({ player }) => heal(player),
});

function heal(player: Player) {
	player.health = 100;
}

export function shared_hello_show(id: number) {
	const player = new Player(id);
	return hello.show(player);
}

/** How many times this load of the plugin was waved at. */
export function shared_hello_waves() {
	return waves;
}
