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

	server.command(`kick #${get_user_userid(slot)}`);
	const next = await nextBot();
	check.expect(changes.slice(before).join(", "), "the bot leaving is not a change").toBe("");
	check.expect(next != null, "another bot came").toBe(true);
	if (next != null) check.expect(next.id, "it is in the same slot").toBe(slot);

	const after = new Player(slot);
	check.expect(after.ghost, "ghost in the slot is the default").toBe(false);
	check.expect(after.testTag, "the string in the slot is empty").toBe("");
	check.done();
}

/** A bot that came after the previous one left: YaPB adds it itself, otherwise yb add. */
async function nextBot() {
	await sleep(1000);
	for (let waited = 0; waited < 12000; waited += 500) {
		const found = server.players.find(player => player.isBot && player.isConnected);
		if (found != null) return found;
		if (waited == 2000) server.command("yb add");
		await sleep(500);
	}
	return null;
}
