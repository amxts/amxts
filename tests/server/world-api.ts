// What the module does beside the players, on the game itself: a Storage on
// disk and the one it takes from AMX Mod X's nvault, traces through the map,
// the server's game, versions, maps and light, the plugins it runs, a
// message sent by its fields, a camera. world-pawn.sma is the Pawn side.
import { Checks } from "@amxts/core/check";
import * as fs from "@amxts/core/fs";

interface Mark {
	count: number;
	who: string;
}

const NAME = "amxts world bot";

server.addServerCommand("amxts_test_world_api", run);

async function run() {
	const check = new Checks("world-api");

	// A Storage of objects, on disk within a second.
	const marks = new Storage<Mark>("amxts_world");
	marks.set("a", { count: 3, who: "amxts" });
	const mark = marks.get("a");
	check.expect(mark != null && mark.count == 3 && mark.who == "amxts", "a Storage keeps an object").toBe(true);
	check.expect(marks.get("none") === undefined, "get of a key not there is undefined").toBe(true);
	await sleep(1500);
	const file = fs.readFileSync(`${server.dataDir}/amxts/storage/amxts_world.json`) ?? "";
	check.expect(file.includes("\"a\"") && file.includes("count"), "the storage's JSON file is written").toBe(true);
	check.expect(new Storage("amxts_world_import").get("key") ?? "none", "a new name takes nvault's file of that name").toBe("from pawn");

	// The server.
	check.expect(server.game, "server.game").toBe("cstrike");
	check.expect(server.versions.amxts.length > 0 && server.versions.amxModX.length > 0, "server.versions").toBe(true);
	check.expect(server.mapExists(server.map), "mapExists of the map it runs").toBe(true);
	check.expect(server.mapExists("amxts_no_such_map"), "mapExists of no map").toBe(false);
	check.expect(server.changeLevel("amxts_no_such_map"), "changeLevel to no map stays").toBe(false);
	server.lightStyle = "b";
	check.expect(server.lightStyle, "lightStyle").toBe("b");
	server.lightStyle = "m";

	// The plugins: this one, and the Pawn side with its public.
	const own = server.plugins.find(plugin => plugin.language == "typescript" && plugin.file.startsWith("world-api"));
	check.expect(own != null && own.running, "server.plugins has this plugin, running").toBe(true);
	const pawn = server.plugins.find(plugin => plugin.language == "pawn" && plugin.name == "amxts test: world");
	check.expect(pawn != null && pawn.running && pawn.version == "1.0", "server.plugins has the Pawn plugin").toBe(true);
	if (pawn != null) check.expect(pawn.call("world_sum", 2, 3), "call a Pawn plugin's public").toBe(5);

	const bot = server.addBot(NAME);
	check.expect(bot != null, "addBot gives a player").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}
	bot.joinTeam("CT");
	bot.respawn();
	await sleep(300);

	// Traces from where the bot stands: the floor under him, the air above the map.
	const eyes = bot.eyes;
	check.expect(eyes.z > bot.origin.z, "eyes are above the origin").toBe(true);
	const down = trace.line(eyes, eyes.add([0, 0, -4096]), { ignore: bot });
	check.expect(down.hit && down.entity != null && down.entity!.id == 0, "a line down hits the world").toBe(true);
	check.expect(down.normal.z > 0.5, "the floor faces up").toBe(true);
	check.expect(trace.hull(bot.origin, bot.origin, "human", { ignore: bot }).startSolid, "a standing hull where he stands is free").toBe(false);
	check.expect(pointContents(eyes), "pointContents at his eyes").toBe("empty");
	check.expect(pointContents(down.end.add([0, 0, -16])), "pointContents under the floor").toBe("solid");
	check.expect(bot.aim.point.distanceTo(eyes) > 0, "aim reaches a point").toBe(true);

	// A message by its fields, heard on its way.
	let heard = "";
	const onTeam = (event: TeamInfoMessage) => {
		if (event.target != null && event.target!.id == bot.id) heard = event.team;
	};
	server.addMessageListener("team", onTeam);
	server.send("team", { target: bot, team: "SPECTATOR" });
	server.removeMessageListener("team", onTeam);
	check.expect(heard, "server.send is heard by a listener").toBe("SPECTATOR");

	// A camera, and his own eyes again.
	const camera = Entity.create("info_target");
	if (camera != null) {
		bot.view = camera;
		check.expect(bot.view != null && bot.view!.id == camera.id, "view through a camera").toBe(true);
		bot.view = null;
		check.expect(bot.view == null, "view back to his own eyes").toBe(true);
		camera.remove();
	}

	check.expect(bot.give("weapon_nothing"), "give of a name the game has not").toBe(false);

	server.command(`kick "${NAME}"`);
	check.done();
}
