// Commands with typed arguments: the usage names them, an interface types
// them, and the build reads each word as its type says - a number, a player
// by #userid or a part of his name, one of some words, the rest of the line
// (tests/commands.test.ts).
interface KickArgs {
	target: Player;
	reason?: string;
}

interface GiveArgs {
	amount: number;
	what?: "armor" | "health";
}

interface ResetArgs {
	what?: "scores" | "all";
}

interface Login {
	url: string;
	user: string;
}

let heard = "";

server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
	heard = `${player.name} kicks ${target.name}: ${reason ?? "-"}`;
}, { access: "kick", description: "Kick a player" });

server.addCommand<GiveArgs>("give <amount> [what]", ({ player, amount, what }) => {
	heard = `${player.name} gives ${amount} ${what ?? "health"}`;
});

server.addCommand("/me <text>", ({ player, text }) => {
	heard = `${player.name} ${text}`;
});

server.addCommand("/hp", ({ player }) => {
	heard = `${player.name} has ${player.health} HP`;
});

server.addCommand("say rules", ({ player }) => {
	heard = `${player.name} reads the rules`;
});

server.addServerCommand<ResetArgs>("cmd_reset [what]", ({ what }) => {
	heard = `reset ${what ?? "all"}`;
});

/** Written apart: a command's arguments go where their interface is expected. */
function logIn(login: Login) {
	heard = `${login.user} at ${login.url}`;
}

server.addServerCommand<Login>("cmd_login <url> <user>", login => logIn(login));

server.addCommand("/help", ({ player }) => {
	for (const command of server.commands) {
		if (command.access == null || player.access.includes(command.access)) player.print([command.usage, ...command.aliases].join(" "));
	}
});

// After a server command and /help: each command's own usage and access, whatever came before it.
server.addCommand("kick_all", ({ player }) => {
	heard = `${player.name} kicks everyone`;
}, { access: "kick" });

interface TeamArgs {
	team: "t" | "ct";
}

// Declared by name at the top level, as most handlers are: the build's code calls them directly.
function ping() {
	heard = "pong";
}

function chooseTeam({ team }: TeamArgs) {
	heard = `joins ${team}`;
}

server.addCommand("ping", ping);
server.addCommand("/ping", ping);
server.addCommand<TeamArgs>("team <team>", chooseTeam, { access: "kick" });

// Several names, one command; a handler of the player - by its name, or in place.
function checkpoint(player: Player) {
	heard = `${player.name} saves a checkpoint`;
}

server.addCommand(["/cp", "cp"], checkpoint, { description: "Save a checkpoint" });
server.addCommand(["/tp", "tp", "teleport"], (player) => {
	heard = `${player.name} teleports`;
});
const goes = "goes";
server.addCommand("/go", (player) => {
	heard = `${player.name} ${goes}`;
});

// A chat command heard in one chat only.
server.addCommand("/all", ({ player }) => {
	heard = `${player.name} to all`;
}, { chat: "say" });
server.addCommand("/mates", (player) => {
	heard = `${player.name} to the team`;
}, { chat: "team" });

// Any console command, with its name, words and text.
server.addEventListener("command", (event) => {
	if (event.command == "say_team" && event.args[0] == "/where") heard = `${event.player.name} asks where: ${event.args.slice(1).join(",")} | ${event.text}`;
	if (event.command == "buyequip") heard = `${event.player.name} buyequip ${event.args.join(",")} | ${event.text}`;
});

// A bot's command, as one it sent.
server.addServerCommand("cmd_bot_hp", () => {
	server.players.find(player => player.isBot)?.command("say /hp");
});

export function cmd_heard() {
	const said = heard;
	heard = "";
	return said;
}
