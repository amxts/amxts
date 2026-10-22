// A message a plugin begins and does not end: a command that throws between
// message_begin and message_end, or one that forgets the end. The module ends
// the message when the call returns - one written whole goes out, one left
// halfway by an error is dropped (a message of a fixed size padded first, as
// the engine checks it) - so the next message begins: a begin of the plugin's
// own, the screen's progress bar heard as it was written, and the game's own
// HideWeapon, whose begin would stop the server while a message is open.
// @log [amxts] message-left.aot: a message (ScreenFade) was begun and not ended - dropped
// @log [amxts] message-left.aot: a message (engine message 23) was begun and not ended - dropped
// @log [amxts] message-left.aot: a message (AmxtsLeft) was begun and not ended - ended for it
// @log message-left.aot: Error: halfway through a message
import { MSG_ALL, MSG_ONE, SVC_TEMPENTITY, TE_BEAMPOINTS } from "@amxts/core/constants";
import { get_user_msgid, message_begin, message_end, server_exec, write_byte, write_coord, write_short } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const left = new UserMessage("AmxtsLeft");

/** The bot the messages go to. */
let target = 0;
let bar = "";
let hidden: HideHud[] = [];

server.addMessageListener("progressBar", (event) => {
	if (event.player?.id == target) bar = `${event.name} ${event.seconds} ${event.startPercent}`;
});
server.addMessageListener("hideWeapon", (event) => {
	if (event.player?.id == target && hidden.length == 0) hidden = event.flags;
});

// ScreenFade is 10 bytes: two are written.
server.addServerCommand("amxts_message_left_fixed", () => {
	message_begin(MSG_ONE, get_user_msgid("ScreenFade"), [0, 0, 0], target);
	write_short(100);
	throw new Error("halfway through a message");
});

server.addServerCommand("amxts_message_left_temp", () => {
	message_begin(MSG_ALL, SVC_TEMPENTITY, [0, 0, 0], 0);
	write_byte(TE_BEAMPOINTS);
	write_coord(0);
	throw new Error("halfway through a message");
});

server.addServerCommand("amxts_message_left_whole", () => {
	message_begin(MSG_ALL, get_user_msgid("AmxtsLeft"), [0, 0, 0], 0);
	write_byte(1);
});

/** Runs a server command now, as the console would. */
function run(command: string) {
	server.command(command);
	server_exec();
}

server.addServerCommand("amxts_test_message_left", () => {
	test();
});

async function test() {
	const check = new Checks("message-left");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	target = bot.id;
	for (const command of ["amxts_message_left_fixed", "amxts_message_left_temp", "amxts_message_left_whole"]) {
		run(command);
		check.expect(message_begin(MSG_ALL, get_user_msgid("AmxtsLeft"), [0, 0, 0], 0), `a message begins after ${command}`).toBe(1);
		write_byte(2);
		message_end();
	}
	left.byte(3).sendAll();

	bot.screen.progressBar(3, { startPercent: 50 });
	check.expect(bar, "the screen's progress bar is heard as written").toBe("BarTime2 3 50");
	bot.screen.progressBar(0);

	// The game's own message: a respawn before it is sent changes the HUD back, so it is asked again.
	for (let tries = 0; tries < 3 && !hidden.includes("money"); tries++) {
		hidden = [];
		bot.hideHud = ["money"];
		for (let waits = 0; waits < 10 && hidden.length == 0; waits++) await sleep(50);
	}
	check.expect(hidden.includes("money"), "the game's HideWeapon goes out and is heard").toBe(true);
	bot.hideHud = [];
	check.done();
}
