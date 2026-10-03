// amxts_reload of a plugin that made a menu at its top level: menu-core drops
// what the old load gave it, so the new load makes the menu once - its items
// once - and the menu's functions are the new load's. After amxts_unload the
// menu is gone and nothing calls the plugin; amxts_load brings it back.
// @log [amxts] reloading menu-reload-target.aot
// @log [amxts] unloaded menu-reload-target.aot
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const loads = new Cvar("amxts_test_menu_reload_loads", "0");
const calls = new Cvar("amxts_test_menu_reload_calls", "0");

/** Runs a server command now, as the console would. */
function run(command: string) {
	server.command(command);
	server_exec();
}

/** How many times `part` is in `text`. */
function count(text: string, part: string) {
	return text.split(part).length - 1;
}

server.addServerCommand("amxts_test_menu_reload", () => {
	const check = new Checks("menu-reload");
	const bot = server.players.find(player => player.isBot && player.isConnected && player.isAlive);
	check.expect(bot != null, "the server has a live bot").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	bot.health = 81;
	const before = loads.number;
	run("amxts_reload menu-reload-target");
	check.expect(loads.number - before, "amxts_reload starts the plugin once").toBe(1);

	check.expect(menus.show(bot, "TEST_RELOAD_HELLO"), "the menu opens after the reload").toBe(true);
	const text = menus.shownText(bot);
	check.expect(count(text, "Wave"), "an item given as text is there once").toBe(1);
	check.expect(count(text, "Heal (81 HP)"), "an item a function names is there once").toBe(1);
	check.expect(text.includes(`(load ${loads.number})`), `the title is the new load's function (${text.split("\n")[0]})`).toBe(true);
	menus.close(bot);

	run("amxts_unload menu-reload-target");
	check.expect(menus.find("TEST_RELOAD_HELLO") == null, "after amxts_unload the menu is gone").toBe(true);
	const called = calls.number;
	check.expect(menus.show(bot, "TEST_RELOAD_HELLO"), "it does not open").toBe(false);
	check.expect(calls.number, "nothing calls the unloaded plugin").toBe(called);

	run("amxts_load menu-reload-target");
	check.expect(menus.find("TEST_RELOAD_HELLO") != null, "amxts_load makes the menu again").toBe(true);
	bot.health = 100;
	check.done();
});
