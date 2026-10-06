// Menu on a real server, its keys pressed by a bot - a bot's menuselect
// comes through the engine as a player's does: an item chosen with the data
// show was given, a grey item that is no key, pages, Exit, and a show over
// the last one. Beside a Pawn plugin's menus (quick-menu-pawn.sma) each key
// goes to the menu on the screen: a Pawn menu over a Menu takes it - an
// old-style handler that lets the key pass on included - a Menu over a Pawn
// menu takes it and closes the Pawn one, whose handler hears MENU_EXIT, and
// the game's own menu over a Menu takes it.
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

interface ShopData {
	category: string;
}

let chosen = "";
const pawn = new Cvar("amxts_test_quick_menu_pawn", "");

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

const maps = new Menu("Maps");
for (let i = 1; i <= 9; i++) {
	maps.addItem({
		title: `map ${i}`,
		onSelect: () => {
			chosen = `map ${i}`;
		},
	});
}

/** Runs a server command now, as the console would. */
function run(command: string) {
	server.command(command);
	server_exec();
}

/** The bot presses a key of the menu on its screen. */
function press(bot: Player, key: number) {
	bot.command(`menuselect ${key}`);
}

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
	press(bot, 2);
	check.expect(chosen, "a grey item is no key").toBe("");
	press(bot, 1);
	check.expect(chosen, "an item runs with the data show was given").toBe(`armor for ${bot.name}`);
	chosen = "";
	press(bot, 1);
	check.expect(chosen, "the menu closed after the choice").toBe("");

	maps.show(bot);
	press(bot, 9);
	press(bot, 2);
	check.expect(chosen, "More turns the page").toBe("map 9");
	maps.show(bot);
	press(bot, 10);
	press(bot, 1);
	check.expect(chosen, "Exit closes the menu and chooses nothing").toBe("map 9");

	shop.show(bot, { category: "heal" });
	maps.show(bot);
	press(bot, 1);
	check.expect(chosen, "a menu shown over another takes its keys").toBe("map 1");

	chosen = "";
	pawn.value = "";
	shop.show(bot, { category: "armor" });
	run(`amxts_quick_menu_pawn_old ${bot.id}`);
	press(bot, 1);
	check.expect(pawn.value, "an old-style Pawn menu over a Menu gets the key").toBe("old 0");
	check.expect(chosen, "the Menu under it does not, though the Pawn handler let the key pass").toBe("");

	run(`amxts_quick_menu_pawn_new ${bot.id}`);
	shop.show(bot, { category: "armor" });
	check.expect(pawn.value, "a Menu over a Pawn menu closes it: its handler hears MENU_EXIT").toBe("new -3");
	press(bot, 1);
	check.expect(chosen, "the Menu over it gets the key").toBe(`armor for ${bot.name}`);
	check.expect(pawn.value, "the Pawn menu does not").toBe("new -3");

	chosen = "";
	run(`amxts_quick_menu_pawn_old ${bot.id}`);
	shop.show(bot, { category: "armor" });
	press(bot, 1);
	check.expect(chosen, "a Menu over an old-style Pawn menu gets the key").toBe(`armor for ${bot.name}`);
	check.expect(pawn.value, "the Pawn menu does not").toBe("new -3");

	chosen = "";
	shop.show(bot, { category: "armor" });
	run(`amxts_quick_menu_pawn_new ${bot.id}`);
	press(bot, 1);
	check.expect(pawn.value, "a Pawn menu over a Menu gets the key").toBe("new 0");
	check.expect(chosen, "the Menu under it does not").toBe("");

	shop.show(bot, { category: "armor" });
	bot.command("radio1");
	press(bot, 1);
	check.expect(chosen, "the game's own menu over a Menu takes the key").toBe("");
	check.done();
});
