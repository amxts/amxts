// A fixture for tests/player-api.test.ts: what a player has and does, one
// command each.

server.addCommand("pl_ammo", ({ player }) => ammo(player));
server.addCommand("pl_lang", ({ player }) => language(player));
server.addCommand("pl_voice [routes]", ({ player, routes }) => voice(player, (routes ?? "").split(" ")));
server.addCommand<JoinArgs>("pl_join <team>", ({ player, team }) => join(player, team));
server.addCommand("pl_sound", ({ player }) => sound(player));
server.addCommand("pl_cvar <name>", ({ player, name }) => askCvar(player, name));
server.addCommand("pl_cvar_left", ({ player }) => askUntilLeft(player));
server.addCommand("pl_observe <mode>", ({ player, mode }) => observe(player, mode));
server.addCommand("pl_hud", ({ player }) => equip(player));

interface JoinArgs {
	team: "CT" | "TERRORIST" | "UNASSIGNED";
}
server.addCommand("pl_copy_weapons", ({ player }) => copyWeapons(player));

const MODES: ObserverMode[] = ["none", "chaseFree", "inEye"];

function ammo(player: Player) {
	player.give("weapon_flashbang");
	player.setAmmo("weapon_flashbang", 2);
	print(player, `${player.getAmmo("weapon_flashbang")} ${player.getAmmo("weapon_hegrenade")}`, "console");
}

function language(player: Player) {
	print(player, player.language, "console");
}

function voice(player: Player, routes: string[]) {
	player.muted = routes.includes("muted");
	player.heardByEveryone = routes.includes("heard");
	player.hearsEveryone = routes.includes("hears");
	print(player, `${player.muted} ${player.heardByEveryone} ${player.hearsEveryone}`, "console");
}

function join(player: Player, team: Team) {
	const joined = player.joinTeam(team);
	print(player, `${joined} ${player.team}`, "console");
}

function sound(player: Player) {
	player.playSound("vox/one.wav");
}

function observe(player: Player, name: string) {
	player.observerMode = MODES.find(mode => mode == name) ?? "none";
	print(player, `${player.observerMode} ${player.observerLastMode} ${player.iuser2}`, "console");
}

/** Gives the other player every weapon this one carries, each with the rounds in its clip. */
function copyWeapons(player: Player) {
	const other = server.players.find(one => one.id != player.id);
	if (other == null) return;

	for (const item of player.items) {
		other.give(item.classname);
		const given = other.items.find(weapon => weapon.kind == item.kind);
		if (given) given.clip = item.clip;
	}
	print(player, other.items.map(weapon => `${weapon.classname} ${weapon.clip}`).join(", "), "console");
}

async function askCvar(player: Player, name: string) {
	const value = await player.queryCvar(name);
	print(player, `${name} = ${value ?? "none"}`, "console");
}

async function askUntilLeft(player: Player) {
	const answer = player.queryCvar("fps_max");
	answer.catch(reason => console.log(`fps_max: ${reason.name}`));
}

function equip(player: Player) {
	player.money += 500;
	player.kevlar = "vestHelmet";
	player.flashlightBattery = 40;
	player.hasNightVision = true;
	player.nightVisionOn = true;
	player.hasDefuser = true;
	player.hasDefuser = false;
}
