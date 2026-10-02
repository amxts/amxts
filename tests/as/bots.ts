// A fixture for tests/bots.test.ts: a bot added, moved and kicked, and the
// natives whose `...` tail takes any kind of argument.
import { dllfunc, engfunc, global_get } from "@amxts/core/natives";
import {
	DLLFunc_ClientConnect,
	EngFunc_CreateFakeClient,
	EngFunc_PrecacheModel,
	EngFunc_Time,
	EngFunc_TraceLine,
	EngFunc_VecToAngles,
	glb_frametime,
	IGNORE_MONSTERS,
} from "@amxts/core/constants";

let bot: Player | null = null;

server.addEventListener("putinserver", ({ player }) => console.log(`putinserver ${player.name} bot ${player.isBot}`));
server.addEventListener("disconnected", ({ player }) => console.log(`disconnected ${player.name}`));

server.addServerCommand("bot_add <name>", ({ name }) => {
	bot = server.addBot(name);
	console.log(bot == null ? "no slot" : `added ${bot.name} as ${bot.id}`);
});

server.addServerCommand("bot_move", () => {
	bot?.move({ forward: 250, buttons: ["Jump", "Duck"], angles: [0, 90, 0] });
	bot?.move({ forward: 100, angles: new Vector(0, 0, 0), msec: 50 });
});

server.addServerCommand("bot_kick", () => bot?.kick());

server.addCommand("human_move", ({ player }) => {
	try {
		player.move({ forward: 250 });
	} catch (error) {
		console.log(`refused: ${(error as Error).message}`);
	}
});

server.addServerCommand("tail_natives", () => {
	console.log(`fake client ${engfunc(EngFunc_CreateFakeClient, "Tail")}`);
	console.log(`model ${engfunc(EngFunc_PrecacheModel, "models/x.mdl")}`);
	engfunc(EngFunc_TraceLine, [1, 2, 3], new Vector(4, 5, 6.5), IGNORE_MONSTERS, 7);

	const angles = [0, 0, 0];
	engfunc(EngFunc_VecToAngles, [1, 0, 0], angles);
	console.log(`angles ${angles[1]}`);
	console.log(`time ${engfunc(EngFunc_Time)}`);

	const reason = new Ref("");
	const accepted = dllfunc(DLLFunc_ClientConnect, 1, "Rejected one", "127.0.0.1", reason);
	console.log(`connect ${accepted} "${reason.value}"`);

	const frame = new Ref(0);
	global_get(glb_frametime, frame);
	console.log(`frame ${frame.value}`);
});
