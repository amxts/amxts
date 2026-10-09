// A shot's event, heard and changed: a bot's AK-47 fires, each shot a played
// event. The listener stops one, and plays the next to nobody, which the
// module plays again to the chosen players with their groups set for that
// call alone: the bot's group is its own again right after.
import { Ham_Weapon_PrimaryAttack, m_Weapon_iClip } from "@amxts/core/constants";
import { ExecuteHamB, set_member } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** What the listener does with the shots it hears, in turn. */
const asked = ["stop", "nobody", "leave"];
const heard: string[] = [];

function onShot(event: PfnPlaybackeventEvent) {
	const what = asked[heard.length % asked.length];
	heard.push(`${event.entity} ${what}`);
	if (what == "stop") event.preventDefault();
	if (what == "nobody") event.recipients = [];
}

server.addServerCommand("amxts_test_playback", run);

async function run() {
	const check = new Checks("playback");
	const bot = server.addBot("amxts shooter");
	if (bot == null) {
		check.expect(false, "a bot to shoot").toBe(true);
		check.done();
		return;
	}

	bot.joinTeam("CT");
	bot.respawn();
	await sleep(300);
	bot.give("weapon_ak47");
	const gun = bot.items.find(item => item.classname == "weapon_ak47")?.id ?? 0;
	check.expect(gun > 0, "the bot has the gun").toBe(true);

	// Only while it shoots: the other suites' shots are not this listener's.
	bot.groupInfo = 4;
	server.addEventListener("playbackEvent", onShot);
	for (let i = 0; i < asked.length; i++) {
		set_member(gun, m_Weapon_iClip, 30);
		ExecuteHamB(Ham_Weapon_PrimaryAttack, gun);
	}
	server.removeEventListener("playbackEvent", onShot);

	check.expect(heard.join(", "), "each shot is heard, stopped or played to some players").toBe(asked.map(what => `${bot.id} ${what}`).join(", "));
	check.expect(bot.groupInfo, "the bot's group is its own again after an event played to some players").toBe(4);
	bot.groupInfo = 0;
	bot.kick();
	check.done();
}
