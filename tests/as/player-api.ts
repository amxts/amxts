// A fixture for tests/player-api.test.ts: what a player has and does, one
// command each.

server.addCommand("pl_ammo", ({ player }) => ammo(player));
server.addCommand("pl_slots", ({ player }) => slots(player));
server.addCommand("pl_info", ({ player }) => info(player));
const everyone = new HudLine();
server.addCommand("pl_screen", ({ player }) => {
	everyone.showAll("for all");
	player.screen.hint("Plant the bomb");
	player.showMotd("x".repeat(200), "Rules");
});
server.addCommand("pl_country", ({ player }) => print(player, `${player.country ?? "none"} ${player.countryCode ?? "none"}`, "console"));
server.addCommand("pl_lang", ({ player }) => language(player));
server.addCommand("pl_auth", ({ player }) => print(player, `${player.authType} ${player.protocol} ${player.authKey}`, "console"));
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

function slots(player: Player) {
	player.give("weapon_ak47");
	player.give("weapon_deagle");
	player.give("weapon_hegrenade");
	player.setAmmo("weapon_ak47", 90);
	const removed = player.removeItems("primary");
	const dropped = player.dropItem("weapon_deagle");
	const none = player.dropItem("weapon_awp");
	const left = player.items.map<string>(item => item.classname).join(",");
	print(player, `${removed} ${dropped != null ? dropped.classname : "none"} ${none == null} ${left}`, "console");
}

function info(player: Player) {
	const hand = player.info.get("cl_righthand");
	player.info.set("_vgui_menus", "0");
	player.silentSteps = true;
	print(player, `${hand} ${player.info.get("_vgui_menus")} ${player.userId > 0} ${player.isHltv} ${player.silentSteps} ${player.connectedSeconds}`, "console");
}

server.addCommand("pl_breaking", ({ player }) => {
	print(0, "nobody");
	const name: string = "weapon_ak74";
	print(player, `${player.give(name)} ${player.give(name)} ${player.give("weapon_ak47")}`, "console");
	player.removeAllItems({ suit: true });
});

const ticker = new HudLine();
server.addCommand("pl_hud_line", ({ player }) => {
	ticker.show(player, "5", { color: [255, 50, 50], hold: 1.1, channel: 3 });
	player.showHud("big", { large: true, y: 0.2 });
	ticker.clearAll();
});
