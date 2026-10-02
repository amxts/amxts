// Menu on a real server: menu_create with the plugin's handler, a title and
// items built for the player on every show, a grey item through the item's
// callback, a show over the previous menu and closing. A bot cannot press a
// menu key - AMX Mod X takes menuselect only from the client's own command -
// so choosing an item is checked by the tests on the fake server.
import { menu_cancel } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

interface ShopData {
	category: string;
}

let chosen = "";

const shop = new Menu<ShopData>("!yShop");
shop.addItem({
	title: "Armor",
	onSelect: ({ player, data }) => {
		chosen = `${data.category} for ${player.name}`;
	},
});
shop.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	enabled: ({ player }) => player.health < 100,
	onSelect: ({ player }) => {
		chosen = `heal for ${player.name}`;
	},
});

server.addServerCommand("amxts_test_quick_menu", () => {
	const check = new Checks("quick-menu");
	const bot = server.players.find(player => player.isBot && player.isConnected && player.isAlive);
	check.expect(bot != null, "the server has a live bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	bot.health = 100;
	shop.show(bot, { category: "armor" });
	// Over it: AMX Mod X closes the previous menu, and its handler destroys it.
	shop.show(bot, { category: "heal" });
	check.expect(menu_cancel(bot.id), "the bot has a menu open, and it closes").toBe(1);
	check.expect(chosen, "closing chose nothing").toBe("");
	check.done();
});
