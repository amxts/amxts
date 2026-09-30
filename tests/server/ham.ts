// Game events Ham Sandwich delivers on a real server, and an entity's
// actions: a think heard on its class, a bot's jump - an action whose reapi
// chain hears it - and his knife drawn again, heard on the knife's class and
// blocked by the listener's answer.
import { Checks } from "~/lib/check";

const thought: number[] = [];
let jumps = 0;
let deploys = 0;

game.addEventListener("think", onThink, { classname: "info_target" });
game.addEventListener("jump", countJump);
game.addEventListener("deploy", onDeploy, { classname: "weapon_knife" });

function countJump() {
	jumps++;
}

function onThink(event: ThinkEvent) {
	thought.push(event.entity.id);
}

function onDeploy() {
	deploys++;
	return false;
}

server.addServerCommand("amxts_test_ham", run);

function run() {
	const check = new Checks("ham");

	const box = Entity.create("info_target");
	check.expect(box != null, "an info_target made").toBe(true);

	if (box != null) {
		box.think();
		check.expect(thought.join(","), "its think is heard on its class").toBe(`${box.id}`);
		box.think({ hooks: false });
		check.expect(thought.length, "{ hooks: false } runs the game's function alone").toBe(1);
		box.remove();
	}

	const bot = Player.all({ bots: true, alive: true }).find(one => one.isConnected);
	check.expect(bot != null, "a living bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	// Bots jump and draw weapons on their own: what counts is one more.
	const jumped = jumps;
	bot.jump();
	check.expect(jumps - jumped, "the bot's jump runs reapi's chain").toBe(1);

	const knife = bot.items.find(item => item.classname == "weapon_knife");
	check.expect(knife != null, "the bot has a knife").toBe(true);
	const drawn = deploys;
	if (knife != null) check.expect(`${knife.deploy()} ${deploys - drawn}`, "drawing it is heard on its class, and the answer is the game's").toBe("false 1");

	check.done();
}
