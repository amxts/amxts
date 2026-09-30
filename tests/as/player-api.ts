// A fixture for tests/player-api.test.ts: what a player has and does, one
// command each.

server.addCommand("pl_ammo", ammo);
server.addCommand("pl_lang", language);
server.addCommand("pl_voice", voice);
server.addCommand("pl_join", join);
server.addCommand("pl_sound", sound);
server.addCommand("pl_cvar", askCvar);
server.addCommand("pl_cvar_left", askUntilLeft);
server.addCommand("pl_observe", observe);
server.addCommand("pl_copy_weapons", copyWeapons);

const MODES: ObserverMode[] = ["none", "chaseFree", "inEye"];

function ammo(player: Player) {
	player.give("weapon_flashbang");
	player.setAmmo("weapon_flashbang", 2);
	print(player, `${player.getAmmo("weapon_flashbang")} ${player.getAmmo("weapon_hegrenade")}`, "console");
}

function language(player: Player) {
	print(player, player.language, "console");
}

function voice(player: Player, args: string[]) {
	player.muted = args.includes("muted");
	player.heardByEveryone = args.includes("heard");
	player.hearsEveryone = args.includes("hears");
	print(player, `${player.muted} ${player.heardByEveryone} ${player.hearsEveryone}`, "console");
}

function join(player: Player, args: string[]) {
	const joined = player.joinTeam(args[0] == "CT" ? "CT" : args[0] == "TERRORIST" ? "TERRORIST" : "UNASSIGNED");
	print(player, `${joined} ${player.team}`, "console");
}

function sound(player: Player) {
	player.playSound("vox/one.wav");
}

function observe(player: Player, args: string[]) {
	player.observerMode = MODES.find(mode => mode == args[0]) ?? "none";
	print(player, `${player.observerMode} ${player.observerLastMode} ${player.iuser2}`, "console");
}

/** Gives the other player every weapon this one carries, each with the rounds in its clip. */
function copyWeapons(player: Player) {
	const other = Player.all().find(one => one.id != player.id);
	if (other == null) return;

	for (const item of player.items) {
		other.give(item.classname);
		const given = other.items.find(weapon => weapon.kind == item.kind);
		if (given) given.clip = item.clip;
	}
	print(player, other.items.map(weapon => `${weapon.classname} ${weapon.clip}`).join(", "), "console");
}

async function askCvar(player: Player, args: string[]) {
	const value = await player.queryCvar(args[0]);
	print(player, `${args[0]} = ${value ?? "none"}`, "console");
}

async function askUntilLeft(player: Player) {
	const answer = player.queryCvar("fps_max");
	answer.catch(reason => console.log(`fps_max: ${reason.name}`));
}
