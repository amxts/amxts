// The game's temporary effects heard with what made them. A bot faces a
// wall and sprays: his spray can's think sends the decal a tenth of a second
// later as a broadcast (a bot has no logo of his own, so the game's), and
// the listener hears it with the can, owned by the bot, and sends it to him
// alone - the module's trace counts one copy, his, and none for the other
// bots on the server, whom a broadcast would reach. Sparks sent while his
// move command runs are his own; his knife swung at the wall sends nothing:
// the game leaves a knife's mark to the clients.
// @log [amxts] TRACE message SVC_TEMPENTITY sent changed to 1 player "amxts sprayer"
import { EngFunc_RunPlayerMove, Ham_Weapon_PrimaryAttack, MSG_BROADCAST, SVC_TEMPENTITY, TE_DECAL, TE_DECALHIGH, TE_SPARKS, TE_WORLDDECAL, TE_WORLDDECALHIGH } from "@amxts/core/constants";
import { emessage_begin_f, emessage_end, engfunc, ewrite_byte, ewrite_coord_f, ExecuteHamB } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const DECALS = [TE_DECAL, TE_DECALHIGH, TE_WORLDDECAL, TE_WORLDDECALHIGH];
// The impulse that sprays.
const SPRAY = 201;

/** The bot whose effects are heard, and what made each of them: a decal's maker, sparks' maker. */
let sprayer: Player | null = null;
const heard: string[] = [];
/** Whether his next move command sends sparks. */
let sparkle = false;

function onTempEntity(event: TempEntityMessage) {
	const source = event.source;
	const player = sprayer;
	if (player == null || source == null) return;
	if (event.type == TE_SPARKS && source.id == player.id) heard.push(`sparks by ${source.classname}`);
	if (!DECALS.includes(<i32>event.type) || source.owner != player.id) return;
	// The game makes a spray can without a classname.
	heard.push(source.id == player.id ? "decal by him" : "decal by an entity of his");
	event.recipients = [player];
}

function onCommand(event: ClientCmdStartEvent) {
	const player = sprayer;
	if (!sparkle || player == null || event.player.id != player.id) return;
	sparkle = false;
	const at = player.origin;
	emessage_begin_f(MSG_BROADCAST, SVC_TEMPENTITY);
	ewrite_byte(TE_SPARKS);
	for (let axis = 0; axis < 3; axis++) ewrite_coord_f(at[axis]);
	emessage_end();
}

/**
 * The bot alive, moved up to the nearest wall around him and facing it,
 * his weapon out: the view angles he faces it with, or `null` with no wall.
 * The other bots play rounds, and a new one respawns him where it will.
 */
async function faceWall(bot: Player): Promise<number[] | null> {
	if (!bot.isAlive) {
		bot.respawn();
		await sleep(300);
	}
	bot.takeDamage = "no";
	let yaw = 0;
	let distance = Infinity;
	for (let turn = 0; turn < 360; turn += 45) {
		const way = new Vector(Math.cos(turn * Math.PI / 180), Math.sin(turn * Math.PI / 180), 0);
		const hit = trace.line(bot.eyes, bot.eyes.add(way.scale(1024)), { ignore: bot });
		const far = hit.end.distanceTo(bot.eyes);
		if (hit.hit && hit.entity != null && hit.entity!.id == 0 && Math.abs(hit.normal.z) < 0.3 && far < distance) {
			yaw = turn;
			distance = far;
		}
	}
	if (distance >= 1024) return null;
	const way = new Vector(Math.cos(yaw * Math.PI / 180), Math.sin(yaw * Math.PI / 180), 0);
	bot.origin = bot.origin.add(way.scale(distance - 20));
	const angles = [0, yaw, 0];
	// A bot just spawned keeps the angles he was given over his commands' own (fixangle).
	bot.viewAngle = angles;
	bot.angles = angles;
	// His first move takes his weapon out; an impulse waits until it is ready.
	engfunc(EngFunc_RunPlayerMove, bot.id, angles, 0, 0, 0, 0, 0, 10);
	bot.nextAttack = 0;
	return angles;
}

server.addServerCommand("amxts_test_temp_entity", run);

async function run() {
	const check = new Checks("temp-entity");
	const others = server.players.filter(player => player.isBot && player.isConnected).length;
	const bot = server.addBot("amxts sprayer");
	if (bot == null) {
		check.expect(false, "a bot to spray").toBe(true);
		check.done();
		return;
	}
	check.expect(others > 0, "other bots, whom a broadcast reaches").toBe(true);
	// He enters the game a moment later, and a team before that is not his.
	await sleep(300);
	bot.joinTeam("CT");
	bot.respawn();
	await sleep(300);

	sprayer = bot;
	server.command("amxts_trace");
	server.addMessageListener("tempEntity", onTempEntity);
	server.addEventListener("cmdStart", onCommand);

	let angles = await faceWall(bot);
	check.expect(angles != null, "a wall near the bot").toBe(true);
	if (!bot.items.some(item => item.classname == "weapon_knife")) bot.give("weapon_knife");
	const knife = bot.items.find(item => item.classname == "weapon_knife");
	if (knife != null) ExecuteHamB(Ham_Weapon_PrimaryAttack, knife.id);
	await sleep(500);
	check.expect(heard.join(", "), "a knife swung at a wall sends nothing").toBe("");

	sparkle = true;
	bot.move();
	check.expect(heard.join(", "), "sparks sent in his move command are his").toBe("sparks by player");

	heard.length = 0;
	angles = await faceWall(bot);
	if (angles != null) engfunc(EngFunc_RunPlayerMove, bot.id, angles, 0, 0, 0, 0, SPRAY, 10);
	await sleep(500);
	check.expect(heard.join(", "), "the spray is heard, made by his spray can").toBe("decal by an entity of his");

	server.removeEventListener("cmdStart", onCommand);
	server.removeMessageListener("tempEntity", onTempEntity);
	server.command("amxts_trace");
	sprayer = null;
	bot.kick();
	check.done();
}
