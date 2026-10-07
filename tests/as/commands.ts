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
		if (command.access == null || player.access.includes(command.access)) print(player, command.usage);
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

// A bot's command, as one it sent.
server.addServerCommand("cmd_bot_hp", () => {
	server.players.find(player => player.isBot)?.command("say /hp");
});

export function cmd_heard() {
	const said = heard;
	heard = "";
	return said;
}
