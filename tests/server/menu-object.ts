// A menu as an object from a TS plugin that does not own menu-core: the menu's
// methods run in the menu-core plugin, and the item's and menu's functions (text,
// title, visible) are called back here - on a real server, through WAMR.
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_menu_object", () => {
	const check = new Checks("menu-object");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const shop = menus.create("TEST_OBJECT_SHOP", { title: player => `Shop for ${player.name}` });
	shop.addItem(player => `Health ${player.health}`, { visible: player => player.isConnected });
	shop.addItem("Hidden", { visible: () => false });
	check.expect(menus.find("TEST_OBJECT_SHOP") == shop, "find returns the same object").toBe(true);

	check.expect(shop.show(bot), "show opens the menu").toBe(true);
	const text = menus.shownText(bot);
	check.expect(text.includes(`Health ${bot.health}`), "the item's text is a function called back").toBe(true);
	check.expect(text.includes(`Shop for ${bot.name}`), "the title is a function called back").toBe(true);
	check.expect(text.includes("Hidden"), "visible removed the item").toBe(false);

	shop.close();
	check.expect(menus.activeMenu(bot) == null, "close closed the menu").toBe(true);
	check.done();
});
