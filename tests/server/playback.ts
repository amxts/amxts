// A shot's event, heard and changed: a bot's knife swings, each a played
// event. The listener stops one, and plays the next to nobody, which the
// module plays again to the chosen players with their groups set for that
// call alone: the bot's group is its own again right after.
import { Ham_Weapon_PrimaryAttack } from "@amxts/core/constants";
import { ExecuteHamB } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** What the listener does with the swings it hears, in turn. */
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
	const bot = server.addBot("amxts swinger");
	if (bot == null) {
		check.expect(false, "a bot to swing").toBe(true);
		check.done();
		return;
	}

	bot.joinTeam("CT");
	bot.respawn();
	await sleep(300);
	const knife = bot.items.find(item => item.classname == "weapon_knife");
	check.expect(knife != null, "the bot has a knife").toBe(true);

	// Only while it swings: the other suites' shots are not this listener's.
	bot.groupInfo = 4;
	server.addEventListener("playbackEvent", onShot);
	for (let i = 0; i < asked.length; i++) ExecuteHamB(Ham_Weapon_PrimaryAttack, knife?.id ?? 0);
	server.removeEventListener("playbackEvent", onShot);

	check.expect(heard.join(", "), "each swing is heard, stopped or played to some players").toBe(asked.map(what => `${bot.id} ${what}`).join(", "));
	check.expect(bot.groupInfo, "the bot's group is its own again after an event played to some players").toBe(4);
	bot.groupInfo = 0;
	bot.kick();
	check.done();
}
