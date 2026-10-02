// A fixture for tests/entity-enums.test.ts: fields that hold an engine enum
// read and written as names, and the masks read as lists of names.

server.addCommand("enum_write", ({ player }) => write(player));
server.addCommand("enum_read", ({ player }) => read(player));
server.addCommand("enum_unknown", ({ player }) => writeUnknown(player));
server.addCommand("enum_masks", ({ player }) => masks(player));

function write(player: Player) {
	player.renderMode = "additive";
	player.renderFx = "glowShell";
	player.moveType = "noclip";
	player.solid = "trigger";
	player.takeDamage = "aim";
	player.deadFlag = "respawnable";
	player.waterType = "lava";
	player.kevlar = "vestHelmet";
	player.observerMode = "inEye";
	player.observerLastMode = "chaseFree";
	player.bloodColor = "none";
	player.openMenu = "buyRifle";
	player.modelName = "gign";
	player.ignoreGlobalChat = "all";
}

function read(player: Player) {
	console.log(`read ${player.renderMode} ${player.renderFx} ${player.moveType} ${player.solid} ${player.takeDamage} ${player.deadFlag}`);
	console.log(`read ${player.waterType} ${player.waterLevel} ${player.kevlar} ${player.observerMode} ${player.observerLastMode} ${player.bloodColor} ${player.openMenu} ${player.modelName} ${player.ignoreGlobalChat}`);
}

function writeUnknown(player: Player) {
	player.renderMode = "unknown";
	player.takeDamage = "unknown";
}

function masks(player: Player) {
	console.log(`weapons ${player.weapons.join(",")}`);
	player.weapons = ["knife", "usp"];
	player.physicsFlags = ["OnLadder", "Ducking"];
	player.physicsFlags.push("Using");
	console.log(`physics ${player.physicsFlags.join(",")}`);
}
