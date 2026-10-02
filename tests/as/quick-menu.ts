// Menus of AMX Mod X's own as objects: an item is its title, when it is shown
// and can be chosen, and what choosing it does; each gets the player, the
// menu and the data the menu was shown with. Pages, Back, More and Exit are
// AMX Mod X's. The test shows them through the natives below and presses the
// keys (tests/menu.test.ts).
interface ShopData {
	category: string;
}

let chosen = "";

const shop = new Menu<ShopData>(({ data }) => `!yShop: ${data.category}`, { numberColor: "!y" });
shop.addItem({
	title: "Armor",
	onSelect: ({ player, data }) => {
		chosen = `${player.name}: armor from ${data.category}`;
	},
});
shop.addItem({
	title: ({ player }) => `Heal !d(${player.health} HP)`,
	enabled: ({ player }) => player.health < 100,
	onSelect: ({ player, menu, data }) => {
		player.health = 100;
		chosen = `${player.name}: healed`;
		menu.show(player, data);
	},
});
shop.addItem({
	title: "Admin item",
	visible: ({ player }) => player.name == "Admin",
	onSelect: ({ player }) => {
		chosen = `${player.name}: admin`;
	},
});
shop.addItem({
	title: "Closed",
	enabled: false,
	onSelect: () => {
		chosen = "closed";
	},
});

const maps = new Menu("Maps", { backText: "Back", nextText: "Next", exitText: "Close" });
for (let i = 1; i <= 9; i++) {
	maps.addItem({
		title: `map ${i}`,
		onSelect: ({ player }) => {
			chosen = `${player.name}: map ${i}`;
		},
	});
}

const vote = new Menu("Vote", { perPage: 0, exit: false });
for (const answer of ["yes", "no"]) {
	vote.addItem({
		title: answer,
		onSelect: ({ player }) => {
			chosen = `${player.name}: ${answer}`;
		},
	});
}

// A menu shown without data: its title is a function, with no type argument.
const greet = new Menu(({ player }) => `Hello, ${player.name}`);
greet.addItem({
	title: "Wave",
	onSelect: ({ player }) => {
		chosen = `${player.name}: wave`;
	},
});

export function quick_shop(id: number, category: string) {
	shop.show(new Player(id), { category });
}

export function quick_show(id: number, name: string) {
	if (name == "maps") maps.show(new Player(id));
	else if (name == "greet") greet.show(new Player(id));
	else vote.show(new Player(id));
}

export function quick_chosen() {
	return chosen;
}
