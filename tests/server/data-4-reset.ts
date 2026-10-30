// Player fields on the server, step 4: the bot is kicked, another comes into its
// slot - and the fields are default again. Pawn (data-3-pawn) wrote the testTag string.
// From the very start this plugin listens to playerChange: it hears what
// another TS plugin (data-1-write) and Pawn (data-3-pawn) wrote, and does not hear the bot leave.
import { get_user_userid } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";
import "../as/player-state";

declare module "@amxts/core" {
	interface Player {
		/** The string the Pawn suite data-3-pawn writes. */
		testTag: string;
	}
}

/** What this plugin heard, in order. */
const heard: string[] = [];
/** Every change of any field: the slot and the field. */
const changes: string[] = [];

server.addEventListener("playerChange", event => heard.push(`ghost ${event.previous} -> ${event.value}`), { field: "ghost" });
server.addEventListener("playerChange", event => heard.push(`enabled ${event.previous} -> ${event.value}`), { field: "glow.enabled" });
server.addEventListener("playerChange", event => heard.push(`testTag "${event.previous}" -> "${event.value}"`), { field: "testTag" });
server.addEventListener("playerChange", event => changes.push(`${event.player.id}:${event.field}`));

server.addServerCommand("amxts_test_data_reset", () => {
	run();
});

async function run() {
	const check = new Checks("data-reset");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "the server has a bot").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const slot = bot.id;
	check.expect(bot.ghost, "ghost before leaving").toBe(true);
	// Cyrillic on purpose: the string data-3-pawn wrote.
	check.expect(bot.testTag, "the string from Pawn").toBe("Привет");
	check.expect(heard.join("; "), "heard from TS and from Pawn").toBe(
		"ghost false -> true; enabled default -> true; enabled true -> false; enabled false -> default; testTag \"\" -> \"Привет\"",
	);
	const onBot = changes.filter(change => change.startsWith(`${slot}:`)).map(change => change.slice(change.indexOf(":") + 1));
	check.expect(onBot.join(", "), "everything data-1 and data-3 wrote to the bot").toBe(
		"ghost, glow.enabled, glow.seenBy, glow.enabled, glow.enabled, testSpeed, testTag",
	);
	const before = changes.length;

	const userid = get_user_userid(slot);
	server.command(`kick #${userid}`);
	const added = await botIn(slot, userid);
	check.expect(changes.slice(before).join(", "), "the bot leaving is not a change").toBe("");
	const after = new Player(slot);
	check.expect(after.isConnected && get_user_userid(slot) != userid, "another bot came into the slot").toBe(true);
	check.expect(after.ghost, "ghost in the slot is the default").toBe(false);
	check.expect(after.testTag, "the string in the slot is empty").toBe("");
	for (const bot of added) server.command(`kick #${get_user_userid(bot.id)}`);
	check.done();
}

/**
 * Bots added until another player than `userid` is in `slot`: a new client
 * takes the lowest free slot, and YaPB's own bots may take one below it
 * first. The bots this added, to kick after.
 */
async function botIn(slot: number, userid: number) {
	const added: Player[] = [];
	for (let waited = 0; waited < 12000; waited += 500) {
		await sleep(500);
		if (new Player(slot).isConnected) {
			if (get_user_userid(slot) != userid) break;
			continue;
		}
		const bot = server.addBot(`amxts data-reset ${added.length + 1}`);
		if (bot != null) added.push(bot);
	}
	return added;
}
