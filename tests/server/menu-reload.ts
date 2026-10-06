// amxts_reload of a plugin that made a menu at its top level: menu-core drops
// what the old load gave it, so the new load makes the menu once - its items
// once - and the menu's functions are the new load's. A bot looking at the
// menu keeps it open through the reload, drawn again from the new load on the
// next frame. After amxts_unload the menu is gone, closed for the bot on the
// next frame, and nothing calls the plugin; amxts_load brings it back. A Menu
// of the core's the plugin shows goes with its load: its key, pressed after
// amxts_reload, calls nothing.
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
	check.expect(menus.show(bot, "TEST_RELOAD_HELLO"), "the menu opens before the reload").toBe(true);
	const before = loads.number;
	run("amxts_reload menu-reload-target");
	check.expect(loads.number - before, "amxts_reload starts the plugin once").toBe(1);
	setTimeout(() => reloaded(check, bot), 200);
});

/** The frames after the reload: the bot's menu is the new load's. */
function reloaded(check: Checks, bot: Player) {
	check.expect(menus.activeMenu(bot) != null, "the menu stays open through the reload").toBe(true);
	const text = menus.shownText(bot);
	check.expect(count(text, "Wave"), "an item given as text is there once").toBe(1);
	check.expect(count(text, "Heal (81 HP)"), "an item a function names is there once").toBe(1);
	check.expect(text.includes(`(load ${loads.number})`), `it is drawn again by the new load's function (${text.split("\n")[0]})`).toBe(true);

	run("amxts_unload menu-reload-target");
	check.expect(menus.find("TEST_RELOAD_HELLO") == null, "after amxts_unload the menu is gone").toBe(true);
	setTimeout(() => unloaded(check, bot), 200);
}

/** The frames after the unload: the bot's menu closed, and nothing calls the plugin. */
function unloaded(check: Checks, bot: Player) {
	check.expect(menus.shownText(bot), "the bot's menu closes").toBe("");
	const called = calls.number;
	check.expect(menus.show(bot, "TEST_RELOAD_HELLO"), "it does not open").toBe(false);
	check.expect(calls.number, "nothing calls the unloaded plugin").toBe(called);

	run("amxts_load menu-reload-target");
	check.expect(menus.find("TEST_RELOAD_HELLO") != null, "amxts_load makes the menu again").toBe(true);
	bot.health = 100;

	// A Menu of the core's that the plugin left open closes with its load:
	// its key reaches neither load, and the new load's own menu answers.
	run(`amxts_menu_reload_quick ${bot.id}`);
	run("amxts_reload menu-reload-target");
	const before = calls.number;
	bot.command("menuselect 1");
	check.expect(calls.number, "a Menu the last load left open answers nothing").toBe(before);
	run(`amxts_menu_reload_quick ${bot.id}`);
	bot.command("menuselect 1");
	check.expect(calls.number, "the new load's Menu answers").toBe(before + 1);
	check.done();
}
