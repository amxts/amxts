// A menu made in code as a project's plugin makes it: at load time, from a
// plugin that does not own menu-core, its title and items given as text and as
// functions of the menu's context. Shown to a bot: the functions are called
// back with the context and their text comes back, and `visible` is asked. A
// bot cannot press a menu key - AMX Mod X routes menuselect only from the
// client's own command, not from amxclient_cmd - so choosing an item is
// checked by the tests on the fake server.
import { Checks } from "@amxts/core/check";

const hello = menus.create("TEST_CODE_HELLO", { title: ({ player }) => `Hello, ${player.name}` });
hello.addItem({ title: "Wave", onSelect: ({ player }) => wave(player) });
hello.addItem({
	title: ({ player }) => `Heal (${player.health} HP)`,
	visible: ({ player }) => player.health < 100,
	onSelect: ({ player }) => heal(player),
});

function wave(player: Player) {
	print(0, `${player.name} waves`);
}

function heal(player: Player) {
	player.health = 100;
}

server.addServerCommand("amxts_test_menu_code", () => {
	const check = new Checks("menu-code");
	const bot = server.players.find(player => player.isBot && player.isConnected && player.isAlive);
	check.expect(bot != null, "the server has a live bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	bot.health = 67;
	check.expect(hello.show(bot), "show opens the menu").toBe(true);
	const text = menus.shownText(bot);
	check.expect(text.includes(`Hello, ${bot.name}`), "the title a function gives").toBe(true);
	check.expect(text.includes("Wave"), "an item's text given as a string").toBe(true);
	check.expect(text.includes("Heal (67 HP)"), "an item's text a function gives, shown while visible says yes").toBe(true);

	bot.health = 100;
	hello.show(bot);
	check.expect(menus.shownText(bot).includes("Heal"), "visible says no at 100 HP").toBe(false);
	hello.close();
	check.done();
});
