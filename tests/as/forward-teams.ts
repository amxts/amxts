// A fixture for tests/forward.test.ts: a forward whose Pawn declaration has
// a TeamName (forward-teams.inc beside it: myplugin_on_player_joined_team(id,
// TeamName:iTeam)), emitted with a Team and heard back as one.

plugin({ name: "forward-teams", version: "1.0.0", author: "amxts", include: "forward-teams.inc" });

const joined = new Forward<Player, Team>("myplugin_on_player_joined_team");
let heard = "";

joined.subscribe(onJoined);
server.addCommand("fw_join", join);

function onJoined(player: Player, team: Team) {
	heard = team;
}

function join(player: Player) {
	joined.emit(player, "CT");
	print(player, `heard ${heard}`, "console");
}
