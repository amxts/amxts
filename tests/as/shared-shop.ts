// One of two plugins that write a plain import of the modules: the menu and
// config made here live in the engine's single instance on the server,
// and the second plugin (shared-viewer) sees them as its own: the menu is the same one,
// the config is in the same folder.

let chosen = "";

server.addEventListener("init", () => {
	menus.addAction("GREET", ({ player, name }) => {
		chosen = `${name} ${player.name}`;
	});
	menus.addPlaceholder("hp", ({ player }) => `${player.health}`);

	const shop = menus.create("SHARED_SHOP", { title: "Shop" });
	shop.addItem({ title: "Hello (%hp%)", enabled: [{ when: ({ player }) => player.name == "Alice" }], action: "GREET" });
	shop.addItem({ title: "Knife", onSelect: ({ player }) => takeKnife(player) });

	configs.setBaseDir("shared");
	const made = configs.read("made");
	made.set("MADE.KEY", "value");
	made.save();
});

function takeKnife(player: Player) {
	chosen = `knife ${player.name}`;
}

export function shared_chosen() {
	return chosen;
}
