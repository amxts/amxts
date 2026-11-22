// A TS plugin builds a menu through `@amxts/menu-core` itself - without the mc_* natives:
// a menu is an object with methods, and an item's text, condition and choice are
// functions right at the item and the menu. Names (addAction) stay for menu.ini and Pawn.

let healed = 0;
let lastChoice = "";

menus.addAction("PICK", ({ player, name }) => {
	lastChoice = `${player.name}:${name}`;
});

const shop = menus.create("SHOP", { title: ({ player }) => `Shop for ${player.name}` });
shop.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	enabled: ({ player }) => player.health < 100,
	message: ({ player }) => `healthy: ${player.health}`,
	onSelect: ({ player }) => heal(player),
});
shop.addItem({ title: "Wounded only", visible: wounded });
shop.addItem({ title: "Choose", action: "PICK" });
shop.addItem({ title: "Leave", action: "CLOSE_MENU", spaceBefore: 1 });

// A function written apart names the context by the module's type: the
// global MenuContext is the context of the core's own Menu.
function wounded({ player }: menus.MenuContext) {
	return player.health < 100;
}

function heal(player: Player) {
	player.health = 100;
	healed++;
}

/** Opens the shop for a player. */
export function menu_api_open(id: number) {
	const player = new Player(id);
	return shop.show(player);
}

export function menu_api_healed() {
	return healed;
}

export function menu_api_choice() {
	return lastChoice;
}
