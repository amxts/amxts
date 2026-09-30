// Тестовый плагин tests/project.test.ts: меню-модуль по имени пакета, как его
// импортирует плагин проекта.
import { Player } from "~/facade";
import * as menus from "@amxts/menu-core";

const menu = menus.create("BY_NAME", { title: "По имени пакета" });
menu.addItem("Закрыть", { action: "CLOSE_MENU" });

export function by_name_show(player: Player) {
	return menu.show(player);
}
