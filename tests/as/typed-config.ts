// Typed configs compiled with Config Core in the same plugin, as its own code
// has it: tests/typed-configs.test.ts runs this without the shared modules'
// proxy, so load() and save() reach the real module.

type Mode = "a" | "b";

interface Limits {
	rounds: number;
	modes: Mode[];
}

export function typedDefaults() {
	const settings = configs.load("owner", {
		chat: { prefix: "[T]", colors: true },
		limits: { rounds: 3, modes: ["a"] } as Limits,
		maps: ["x", "y"],
		rows: [["r", "1"], ["s"]],
	});
	settings.limits.rounds = 4;
	settings.rows[1].push("2");
	const saved = configs.save(settings);
	const rows = settings.rows.map(row => row.join(",")).join(";");
	return `${settings.chat.prefix}|${settings.chat.colors}|${settings.limits.rounds}|${settings.limits.modes.join(",")}|${settings.maps.join(",")}|${rows}|${saved}`;
}
