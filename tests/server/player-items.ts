// What a player carries and what the server knows of him, on the game itself:
// a bot of its own joins, gets weapons, loses a slot, drops a pistol; its
// userinfo, user id, connect time and silent steps. Every one is done by the
// module - ReGameDLL's functions there, the original game's elsewhere.
import { __countryOf } from "@amxts/core";
import { Checks } from "@amxts/core/check";

const NAME = "amxts items bot";

server.addServerCommand("amxts_test_player_items", run);

async function run() {
	const check = new Checks("player-items");
	const bot = server.addBot(NAME);
	check.expect(bot != null, "addBot gives a player").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	check.expect(bot.joinTeam("TERRORIST"), "joinTeam(\"TERRORIST\")").toBe(true);
	bot.respawn();
	await sleep(300);
	check.expect(bot.isAlive, "alive after respawn").toBe(true);

	check.expect(bot.give("weapon_ak47"), "give(\"weapon_ak47\")").toBe(true);
	check.expect(bot.give("weapon_deagle"), "give(\"weapon_deagle\")").toBe(true);
	check.expect(bot.give("weapon_hegrenade"), "give(\"weapon_hegrenade\")").toBe(true);
	bot.setAmmo("weapon_ak47", 60);
	check.expect(bot.getAmmo("weapon_ak47"), "setAmmo, getAmmo").toBe(60);
	check.expect(bot.switchWeapon("weapon_deagle"), "switchWeapon(\"weapon_deagle\")").toBe(true);
	check.expect(bot.activeItem?.classname ?? "", "the deagle in his hands").toBe("weapon_deagle");

	check.expect(bot.removeItems("primary"), "removeItems(\"primary\")").toBe(true);
	check.expect(bot.items.some(item => item.classname == "weapon_ak47"), "the rifle is gone").toBe(false);
	check.expect(bot.getAmmo("weapon_ak47"), "its ammo is gone with it").toBe(0);
	check.expect(bot.removeItems("grenades"), "removeItems(\"grenades\")").toBe(true);
	check.expect(bot.items.some(item => item.classname == "weapon_hegrenade"), "the grenade is gone").toBe(false);

	const dropped = bot.dropItem("weapon_deagle");
	check.expect(dropped != null, "dropItem(\"weapon_deagle\") gives the weapon").toBe(true);
	check.expect(bot.items.some(item => item.classname == "weapon_deagle"), "the deagle left him").toBe(false);
	check.expect(bot.dropItem("weapon_awp") == null, "dropItem of a weapon he has not is null").toBe(true);

	bot.removeAllItems();
	check.expect(bot.items.length, "removeAllItems").toBe(0);

	bot.info.set("amxts_key", "value");
	check.expect(bot.info.get("amxts_key"), "info.set, info.get").toBe("value");
	check.expect(bot.userId > 0, "userId").toBe(true);
	check.expect(bot.isHltv, "a bot is no HLTV").toBe(false);
	check.expect(bot.connectedSeconds >= 0, "connectedSeconds").toBe(true);
	bot.silentSteps = true;
	check.expect(bot.silentSteps, "silentSteps").toBe(true);
	check.expect(bot.timeStepSound >= 400, "his next step is put off").toBe(true);

	check.expect(bot.country == null, "a bot's address has no country").toBe(true);
	check.expect(__countryOf("8.8.8.8", true) ?? "none", "the GeoIP database: 8.8.8.8's code").toBe("US");
	check.expect(__countryOf("8.8.8.8", false) ?? "none", "the GeoIP database: 8.8.8.8's name").toBe("United States");

	const health = bot.health;
	bot.slap(5);
	check.expect(bot.health, "slap(5) takes 5 health").toBe(health - 5);

	bot.kick();
	await sleep(200);
	check.done();
}
