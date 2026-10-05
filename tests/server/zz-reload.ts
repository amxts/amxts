// amxts_reload takes back what the plugin's old version registered. The
// command notes the starts counted and reloads the plugins; the version that
// comes back checks that its own interval fires once a period and its server
// command answers once.
// As every plugin starts over, the two that reload-first loads from its top
// level start once each. A reload starts every plugin of the test server
// over, so this file is named to run last.
import { server_exec } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

/** The starts counted, for the version after the reload to look for. */
const left = new Cvar("amxts_test_reload_left", "");
/** The starts of the plugins reload-first loads. */
const second = new Cvar("amxts_test_reload_second", "0");
const hand = new Cvar("amxts_test_reload_hand", "0");

let ticks = 0;
setInterval(() => ticks++, 400);

let pings = 0;
server.addServerCommand("amxts_ping_reload", () => pings++);

server.addServerCommand("amxts_test_reload", () => {
	left.value = `${second.number} ${hand.number}`;
	server.command("amxts_reload");
});

server.addEventListener("init", () => {
	if (left.value.length > 0) setTimeout(check, 1000);
});

function check() {
	const check = new Checks("reload");
	const [secondBefore, handBefore] = left.value.split(" ").map(value => parseInt(value));
	left.value = "";

	check.expect(ticks >= 1 && ticks <= 3, `the new interval fires once a period (${ticks} in 1 s at 0.4 s)`).toBe(true);
	check.expect(second.number - secondBefore, "a listed plugin another loads from its top level before the list comes to it starts once").toBe(1);
	check.expect(hand.number - handBefore, "an unlisted plugin another loads from its top level starts once").toBe(1);

	server.command("amxts_ping_reload");
	server_exec();
	check.expect(pings, "the server command answers once").toBe(1);
	check.done();
}
