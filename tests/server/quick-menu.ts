// Menu на настоящем сервере: menu_create с обработчиком плагина, заголовок и
// пункты, собранные для игрока при каждом показе, серый пункт через колбэк
// пункта, показ поверх прошлого меню и закрытие. Нажать клавишу меню бот не
// может - menuselect AMX Mod X принимает только из команды самого клиента, -
// так что выбор пункта проверяют тесты на поддельном сервере.
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
	check.expect(bot != null, "на сервере есть живой бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	bot.health = 100;
	shop.show(bot, { category: "armor" });
	// Поверх: AMX Mod X закрывает прошлое меню, и его обработчик его уничтожает.
	shop.show(bot, { category: "heal" });
	check.expect(menu_cancel(bot.id), "у бота открыто меню, и оно закрывается").toBe(1);
	check.expect(chosen, "закрытие ничего не выбрало").toBe("");
	check.done();
});
