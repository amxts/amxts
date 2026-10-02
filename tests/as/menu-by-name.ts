// The test plugin of tests/project.test.ts: a menu module by its package name, as a
// project's plugin imports it.
import { Player } from "@amxts/core";
import * as menus from "@amxts/menu-core";

const menu = menus.create("BY_NAME", { title: "By package name" });
menu.addItem("Close", { action: "CLOSE_MENU" });

export function by_name_show(player: Player) {
	return menu.show(player);
}
