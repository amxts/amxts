// A plugin's own message on a real server: made at the top level, it is
// registered as the server starts, through Metamod, so AMX Mod X knows it by
// its name - get_user_msgid finds it, message_begin takes its id, and a Pawn
// plugin's register_message (user-message-pawn.sma) hears it, each value as
// it was written. A bot's client gets nothing - the engine drops a message to
// a bot - so what is checked is what the hooks hear. A message longer than
// the engine sends is not sent. And a plugin's mistake does not stop the
// server: writes after a message_begin that failed, a write or an end with no
// message begun, a begin with no player to send to.
// @log UserMessage "AmxtsTooLongName": a message's name is 1 to 11 characters
// @log UserMessage "AmxtsJump": 198 bytes, more than the 192 a message carries; not sent
// @log message_end with no message begun
// @log Run time error 10 (plugin "amxts_natives.amxx") (native "message_begin")
// @log Run time error 10 (plugin "amxts_natives.amxx") (native "emessage_begin")
// @log Run time error 10 (plugin "amxts_natives.amxx") (native "message_end")
import { MSG_ALL, MSG_ONE } from "@amxts/core/constants";
import { emessage_begin, ewrite_byte, emessage_end, get_user_msgid, message_begin, message_end, server_exec, write_byte, write_string } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const jump = new UserMessage("AmxtsJump");

/** What the Pawn plugin's hook heard last: the count of arguments, then each. */
let heard = "";
let hooks = 0;

server.addServerCommand("amxts_user_message_heard <line>", ({ line }) => {
	heard = line;
	hooks++;
});

server.addServerCommand("amxts_test_user_message", () => {
	run();
});

/** Runs the commands the Pawn plugin left in the buffer: what it heard. */
function hear() {
	server_exec();
}

function run() {
	const check = new Checks("user-message");
	const bot = server.players.find(player => player.isBot && player.isConnected);
	check.expect(bot != null, "a bot is on the server").toBe(true);

	if (bot == null) {
		check.done();
		return;
	}

	const id = get_user_msgid("AmxtsJump");
	check.expect(id > 63, `AMX Mod X knows the message by its name (${id})`).toBe(true);
	// Made once the server is up, a message is registered at once.
	const tooLong = new UserMessage("AmxtsTooLongName");
	check.expect(get_user_msgid("AmxtsTooLongName"), "a name too long is not registered").toBe(0);
	tooLong.byte(1).sendAll();
	server.command("amxts_user_message_hook");
	server_exec();

	jump.byte(7).char(-5).short(300).long(100000).angle(90).coord(12.5).text("héllo").entity(bot).sendAll();
	hear();
	check.expect(heard, "a Pawn plugin's hook hears it to everyone, each value as written").toBe(`8 7 -5 300 100000 90 100 héllo ${bot.id}`);

	jump.byte(1).text("one").send(bot);
	hear();
	check.expect(heard, "and to one player").toBe("2 1 one");

	const before = hooks;
	jump.text("x".repeat(197)).send(bot);
	hear();
	check.expect(hooks, "a message longer than the engine sends is not sent").toBe(before);

	jump.byte(2).sendAll();
	hear();
	check.expect(heard, "what was written before it is not left for the next").toBe("1 2");

	// The plugin's own natives take the id: AMX Mod X's message_begin knows it now.
	check.expect(message_begin(MSG_ONE, id, [0, 0, 0], bot.id), "message_begin takes the message's id").toBe(1);
	write_byte(3);
	message_end();

	// A begin that fails: its writes and its end do not reach the engine.
	check.expect(message_begin(MSG_ALL, 250, [0, 0, 0], 0), "message_begin of an id no message has fails").toBe(0);
	write_byte(1);
	write_string("lost");
	message_end();
	check.expect(emessage_begin(MSG_ONE, id, [0, 0, 0], 0), "emessage_begin to no player fails").toBe(0);
	ewrite_byte(1);
	emessage_end();
	write_byte(1);
	message_end();
	jump.byte(4).sendAll();
	hear();
	check.expect(heard, "the server goes on, and the next message is sent").toBe("1 4");
	check.done();
}
