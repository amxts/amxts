// A menu as an object from a TS plugin that does not own menu-core: the menu's
// methods run in the menu-core plugin, and the item's and menu's functions (text,
// title, visible) are called back here with the menu's context - on a real
// server, through WAMR.
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_menu_object", () => {
	const check = new Checks("menu-object");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const shop = menus.create("TEST_OBJECT_SHOP", { title: ({ player }) => `Shop for ${player.name}` });
	shop.addItem({ title: ({ player }) => `Health ${player.health}`, visible: ({ player }) => player.isConnected });
	shop.addItem({ title: "Hidden", visible: () => false });
	check.expect(menus.find("TEST_OBJECT_SHOP") == shop, "find returns the same object").toBe(true);

	check.expect(shop.show(bot), "show opens the menu").toBe(true);
	const text = menus.shownText(bot);
	check.expect(text.includes(`Health ${bot.health}`), "the item's text is a function called back").toBe(true);
	check.expect(text.includes(`Shop for ${bot.name}`), "the title is a function called back").toBe(true);
	check.expect(text.includes("Hidden"), "visible removed the item").toBe(false);

	shop.close();
	check.expect(menus.activeMenu(bot) == null, "close closed the menu").toBe(true);

	const about = menus.create("TEST_OBJECT_ABOUT", { title: ({ target }) => `About ${target.name}` });
	about.addItem({ title: ({ row }) => `Row ${row}` });
	check.expect(about.show(bot, { target: bot }), "show takes the player the menu is about").toBe(true);
	check.expect(menus.shownText(bot).includes(`About ${bot.name}`), "target is the player show was given").toBe(true);
	check.expect(menus.shownText(bot).includes(`Row ${bot.id}`), "row is the target's id in an items menu").toBe(true);

	const list = menus.create("LIST_TEST_OBJECT", { title: "Players" });
	list.addItem({ title: ({ target, row }) => `${target.name} #${row}` });
	check.expect(list.show(bot), "a list menu opens").toBe(true);
	check.expect(menus.shownText(bot).includes(`${bot.name} #${bot.id}`), "a row's target is its player, and row its id").toBe(true);
	list.close();
	check.done();
});
