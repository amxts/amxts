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

let heard = "";

server.addCommand<KickArgs>("/kick <target> [reason]", ({ player, target, reason }) => {
	heard = `${player.name} kicks ${target.name}: ${reason ?? "-"}`;
}, { access: "Kick", description: "Kick a player" });

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

server.addCommand("/help", ({ player }) => {
	for (const command of server.commands) {
		if (command.access == null || player.access.includes(command.access)) print(player, command.usage);
	}
});

export function cmd_heard() {
	const said = heard;
	heard = "";
	return said;
}
