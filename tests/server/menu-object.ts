// Меню как объект из TS-плагина, который menu-core не владеет: методы меню
// выполняются в плагине menu-core, а функции пункта и меню (текст, заголовок,
// visible) вызываются обратно сюда - на настоящем сервере, через WAMR.
import { Checks } from "~/lib/check";

server.addServerCommand("amxts_test_menu_object", () => {
	const check = new Checks("menu-object");
	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const shop = menus.create("TEST_OBJECT_SHOP", { title: player => `Лавка для ${player.name}` });
	shop.addItem(player => `Здоровье ${player.health}`, { visible: player => player.isConnected });
	shop.addItem("Скрытый", { visible: () => false });
	check.expect(menus.find("TEST_OBJECT_SHOP") == shop, "find отдаёт тот же объект").toBe(true);

	check.expect(shop.show(bot), "show открывает меню").toBe(true);
	const text = menus.shownText(bot);
	check.expect(text.includes(`Здоровье ${bot.health}`), "текст пункта - функция, вызванная обратно").toBe(true);
	check.expect(text.includes(`Лавка для ${bot.name}`), "заголовок - функция, вызванная обратно").toBe(true);
	check.expect(text.includes("Скрытый"), "visible убрал пункт").toBe(false);

	shop.close();
	check.expect(menus.activeMenu(bot) == null, "close закрыл меню").toBe(true);
	check.done();
});
