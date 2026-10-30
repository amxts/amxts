// Killing a player on any server: a bot of the suite's own, which joins as a
// plugin's bot does, is killed by kill() - a suicide, a frag taken, and with
// keepFrags none - then by killed() from the world, which hands the game no
// inflictor. Each is a death the game sees: the killed event, the death
// notice. On Valve's game the kill command turns such a bot down, and its
// death notice read the missing inflictor and crashed the server.
import { Checks } from "@amxts/core/check";

const NAME = "amxts kill";

/** The suite's bot: the frame sends it a command, as a client sends, or the game never runs it. */
let bot: Player | null = null;
/** Who died, as the game says: "killed 3 0", "death 3". */
const heard: string[] = [];

// YaPB's bots play the round: nothing may hurt this one but the suite.
server.addEventListener("frame", () => {
	if (bot == null) return;
	if (bot.isAlive) bot.takeDamage = "no";
	bot.move({ msec: 10 });
});

game.addEventListener("killed", (event) => {
	if (event.player.id == bot?.id) heard.push(`killed ${event.player.id} ${event.attacker.id}`);
});

server.addMessageListener("death", (event) => {
	if (event.victim != null && event.victim.id == bot?.id) heard.push(`death ${event.victim.id}`);
});

server.addServerCommand("amxts_test_kill", run);

async function run() {
	const check = new Checks("kill");
	const player = await addBot(NAME);
	if (player == null) {
		check.expect(false, "a bot joins").toBe(true);
		check.done();
		return;
	}
	// It enters the game a moment later, and a team before that is not its.
	await sleep(300);
	player.joinTeam("CT");
	bot = player;
	const id = player.id;

	check.expect(await alive(player), "alive").toBe(true);
	let frags = player.frags;
	let from = heard.length;
	// The game's stage of his joining: on Valve's game its kill command needs him joined.
	const joining = player.joiningState;
	player.kill();
	check.expect(player.isAlive, `kill() kills him (joining: ${joining})`).toBe(false);
	check.expect(player.frags, "kill(): a suicide, a frag taken").toBe(frags - 1);
	await sleep(100);
	check.expect(heard.slice(from).join(" | "), "kill(): the killed event and the death notice").toBe(`killed ${id} ${id} | death ${id}`);

	from = heard.length;
	player.kill();
	await sleep(100);
	check.expect(heard.length, "kill() of a dead player does nothing").toBe(from);

	check.expect(await alive(player), "alive again").toBe(true);
	frags = player.frags;
	player.kill({ keepFrags: true });
	check.expect(player.isAlive, "kill({ keepFrags: true }) kills him").toBe(false);
	check.expect(player.frags, "kill({ keepFrags: true }): his frags kept").toBe(frags);

	check.expect(await alive(player), "alive once more").toBe(true);
	frags = player.frags;
	from = heard.length;
	player.killed(new Entity(0), 0);
	check.expect(player.isAlive, "killed() by the world, with no inflictor: dead, and the server up").toBe(false);
	check.expect(player.frags, "killed() by the world: his frags kept").toBe(frags);
	await sleep(100);
	check.expect(heard.slice(from).join(" | "), "killed(): the killed event and the death notice").toBe(`killed ${id} 0 | death ${id}`);

	bot = null;
	player.kick();
	check.done();
}

/** Whether `player` is alive, respawned if he is not: a respawn comes about on the bot's own next commands. */
async function alive(player: Player) {
	for (let waited = 0; waited < 3000 && !player.isAlive; waited += 500) {
		player.respawn();
		await sleep(500);
	}
	return player.isAlive;
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
