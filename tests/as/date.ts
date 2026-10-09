// A fixture for tests/date.test.ts: Date's local time, the server's.

server.addCommand<MomentArgs>("date_local <ms>", ({ player, ms }) => local(player, ms));
server.addCommand("date_now", ({ player }) => now(player));
server.addCommand<MomentArgs>("date_text <ms>", ({ player, ms }) => text(player, ms));

/** A moment, in milliseconds since 1970. */
interface MomentArgs {
	ms: number;
}

/** The local parts of a moment, given in milliseconds since 1970. */
function local(player: Player, ms: number) {
	const date = new Date(ms);
	const parts = [date.getFullYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(), date.getTimezoneOffset()];
	player.print(parts.join(" "), "console");
}

/** `new Date()` is now. */
function now(player: Player) {
	const date = new Date();
	player.print(`${date.getTime() == Date.now()}`, "console");
}

/** A moment as text: local, and as `en-US`, `en-GB`, `de`, `fr` and `ru` write it. */
function text(player: Player, ms: number) {
	const date = new Date(ms);
	const lines = [date.toString(), date.toDateString(), date.toTimeString(), date.toLocaleString(), date.toLocaleDateString(), date.toLocaleTimeString()];
	for (const locale of ["en-GB", "de-DE", "fr-FR", "ru-RU"]) lines.push(date.toLocaleString(locale));
	player.print(lines.join("|"), "console");
}
