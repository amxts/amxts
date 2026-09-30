// A fixture for tests/date.test.ts: Date's local time, the server's.

server.addCommand("date_local", local);
server.addCommand("date_now", now);
server.addCommand("date_text", text);

/** The local parts of a moment, given in milliseconds since 1970. */
function local(player: Player, args: string[]) {
	const date = new Date(parseFloat(args[0]));
	const parts = [date.getFullYear(), date.getMonth(), date.getDate(), date.getDay(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds(), date.getTimezoneOffset()];
	print(player, parts.join(" "), "console");
}

/** `new Date()` is now. */
function now(player: Player) {
	const date = new Date();
	print(player, `${date.getTime() == Date.now()}`, "console");
}

/** A moment as text: local, and as `en-US`, `en-GB`, `de`, `fr` and `ru` write it. */
function text(player: Player, args: string[]) {
	const date = new Date(parseFloat(args[0]));
	const lines = [date.toString(), date.toDateString(), date.toTimeString(), date.toLocaleString(), date.toLocaleDateString(), date.toLocaleTimeString()];
	for (const locale of ["en-GB", "de-DE", "fr-FR", "ru-RU"]) lines.push(date.toLocaleString(locale));
	print(player, lines.join("|"), "console");
}
