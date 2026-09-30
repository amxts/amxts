// A fixture for tests/player-fields.test.ts: object fields on Player - the
// inline `semiclip` of player-state.ts, and one typed with an interface of
// this file - and Player[] fields, read and written as a TS plugin writes them.
import "./player-state";

export interface Badge {
	title: string;
	level: number;
	shown: boolean;
	color: "red" | "blue";
	fans: Player[];
}

declare module "~/facade" {
	interface Player {
		badge: Badge;
		friends: Player[];
	}
}

server.addCommand("sc_on", (player) => {
	player.semiclip.enabled = true;
});

server.addCommand("sc_default", (player) => {
	player.semiclip.enabled = "default";
});

/** The whole object at once: off, and through everyone else. */
server.addCommand("sc_all", (player) => {
	player.semiclip = { enabled: false, passesThrough: othersThan(player) };
});

server.addCommand("sc_push", (player) => {
	const others = othersThan(player);
	if (others.length > 0) player.semiclip.passesThrough.push(others[0]);
});

server.addCommand("sc_read", (player) => {
	const semiclip = player.semiclip;
	const enabled = semiclip.enabled;
	const through = semiclip.passesThrough.map(other => other.id);
	const others = othersThan(player);
	const knows = others.length > 0 && semiclip.passesThrough.includes(others[0]);
	const off = enabled == false;
	const on = enabled == true;
	const byDefault = enabled == "default";
	print(player, `off=${off} on=${on} default=${byDefault} through=${through.join(",")} includes=${knows}`, "console");
});

server.addCommand("badge_write", (player) => {
	const badge: Badge = { title: "Охотник", level: 2, shown: true, color: "blue", fans: [] };
	player.badge = badge;
	player.badge.level = player.badge.level + 0.5;
	const others = othersThan(player);
	if (others.length == 0) return;
	player.badge.fans.push(others[0]);
	player.friends = [others[0], player];
});

server.addCommand("badge_read", (player) => {
	const badge = player.badge;
	const fans = badge.fans.map(fan => fan.id);
	const friends = player.friends.map(friend => friend.id);
	print(player, `title=${badge.title} level=${badge.level} shown=${badge.shown} color=${badge.color} fans=${fans.join(",")} friends=${friends.join(",")}`, "console");
});

function othersThan(player: Player) {
	const others: Player[] = [];
	for (const one of Player.all()) {
		if (one.id != player.id) others.push(one);
	}
	return others;
}
