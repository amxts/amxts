// A player's userinfo sent again, on a real server: resend() on a bot of the
// suite's own leaves his name and model as they are - he is not renamed, and
// the chat is told of no change of name; with ReHLDS the game reads his
// userinfo anew (userInfoChange) and finds his own name there. A bot is sent
// no userinfo, so the sendUserInfo listener that shows another name is only
// added here, as the plugin loads, the server sending with the hook in
// place; what a client is shown takes a real one, and so do the checks of
// what a later listener reads, of clear() and of a leaver's empty userinfo,
// which pass unasked with bots alone. On plain HLDS the module
// hooks the engine's SV_FullClientUpdate itself, and the game reads nothing
// again.
import { __hooksOriginal } from "@amxts/core";
import { Checks } from "@amxts/core/check";

const NAME = "amxts info bot";
const SHOWN = "amxts shown";

let bot: Player | null = null;
/** His slot, which a userinfo sent after he left still names. */
let botId = 0;
/** What the game said of the bot since the suite cleared it: "read <name>", "renamed <text>". */
const heard: string[] = [];

game.addEventListener("userInfoChange", (event) => {
	if (event.player == bot) heard.push(`read ${event.player.name}`);
});

server.addMessageListener("chat", (event) => {
	if (event.text.includes("Name_Change")) heard.push(`renamed ${event.params.join(" ")}`);
});

// Added as the plugin loads, before the server's first map: a plugin's
// listener usually is, and on plain HLDS the engine's function has to be
// found then, with no map's players to tell its clients by yet.
const heardAtLoad = server.versions.reHlds != null || __hooksOriginal("write_full_client_update");
/** What the server sent of the bot since the suite cleared it: his name in each userinfo, before a listener wrote it. */
const sent: string[] = [];
let cleared = false;
game.addEventListener("sendUserInfo", (event) => {
	if (event.player.id != botId) return;
	sent.push(event.info.get("name"));

	if (cleared) {
		event.info.clear();
		return;
	}

	event.info.set("name", SHOWN);
});
// A listener after it reads what the first left.
const after: string[] = [];
game.addEventListener("sendUserInfo", (event) => {
	if (event.player.id == botId) after.push(`${event.info.get("name")}|${event.info.get("model")}`);
});

server.addServerCommand("amxts_test_user_info", run);

async function run() {
	const check = new Checks("user-info");
	const player = await addBot(NAME);
	if (player == null) {
		check.expect(false, "a bot joins").toBe(true);
		check.done();
		return;
	}
	// It enters the game a moment later.
	await sleep(300);
	bot = player;
	botId = player.id;
	const model = player.info.get("model");
	heard.length = 0;

	check.expect(heardAtLoad, "the server hears sendUserInfo from a listener added as the plugin loads").toBe(true);
	player.info.resend();
	await sleep(200);
	check.expect(player.name, "resend(): his name kept").toBe(NAME);
	check.expect(player.info.get("name"), "resend(): his userinfo's name kept").toBe(NAME);
	check.expect(player.info.get("model"), "resend(): his model kept").toBe(model);
	check.expect(heard.filter(line => line.startsWith("renamed")).join(" | "), "resend(): no change of name in the chat").toBe("");
	const read = server.versions.reHlds != null ? `read ${NAME}` : "";
	check.expect(heard.filter(line => line.startsWith("read")).join(" | "), "resend(): the game reads his userinfo again with ReHLDS, with his own name").toBe(read);

	// A bot is sent nothing, so with bots alone the engine writes for no
	// client: what follows is checked only when it wrote at all.
	const heardSend = after.length > 0;
	check.expect(!heardSend || after.every(line => line.startsWith(`${SHOWN}|`)), "a later listener reads the name the first wrote").toBe(true);

	// clear(): the next listener finds nothing in it, as in a leaver's.
	cleared = true;
	sent.length = 0;
	after.length = 0;
	player.info.resend();
	await sleep(200);
	check.expect(after.join(" "), "clear(): a later listener reads an empty userinfo").toBe(after.map(() => "|").join(" "));
	check.expect(after.length > 0, "clear(): the userinfo was sent").toBe(heardSend);
	check.expect(player.info.get("name"), "clear(): his own userinfo kept").toBe(NAME);
	cleared = false;

	// A player who leaves: the engine sends each client an empty userinfo of his slot.
	sent.length = 0;
	bot = null;
	player.kick();
	await sleep(300);
	check.expect(sent.join("|"), "a leaver's userinfo is empty").toBe(sent.map(() => "").join("|"));
	botId = 0;
	check.done();
}

/** A bot of the suite's: YaPB's quota fills the server and gives a slot up a moment after one is taken. */
async function addBot(name: string) {
	let made = server.addBot(name);
	for (let waited = 0; made == null && waited < 3000; waited += 100) {
		await sleep(100);
		made = server.addBot(name);
	}
	return made;
}
