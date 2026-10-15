// A weapon's viewBody and the clientData event on a real server: a bot of
// its own switches to a knife whose defaultDeploy listener gives it a
// viewBody, and every animation of the knife the game sends him - the draw,
// one the plugin plays - carries that body (client-data-pawn.sma hears
// SVC_WEAPONANIM); the rifle's draw carries its own, and viewBody 0
// gives the knife its body back. A bot is sent no client data - the engine
// sends it to a real client only - so the clientData listener is only added
// and taken off here, the server running frames with the hooks in place.
import { Checks } from "@amxts/core/check";

const NAME = "amxts view bot";
// Knife's draw animation, as the game numbers it.
const KNIFE_DRAW = 3;

let watched = 0;
let finish = 0;
/** The animations the watched bot was sent since the suite cleared them: "anim/body". */
const sent: string[] = [];
let frames = 0;

/** client-data-pawn.sma's handler of SVC_WEAPONANIM: an animation sent to `player`, drawn with `body`. */
export function client_data_pawn(player: number, anim: number, body: number) {
	if (player == watched) sent.push(`${anim}/${body}`);
}

game.addEventListener("defaultDeploy", (event) => {
	if (event.weapon.classname != "weapon_knife" || event.weapon.player?.id != watched) return;
	event.weapon.viewBody = finish;
});

function countFrame() {
	frames++;
}

server.addServerCommand("amxts_test_client_data", run);

async function run() {
	const check = new Checks("client-data");
	const bot = server.addBot(NAME);
	check.expect(bot != null, "addBot gives a player").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	bot.joinTeam("CT");
	bot.respawn();
	await sleep(300);
	bot.give("weapon_knife");
	bot.give("weapon_ak47");
	bot.switchWeapon("weapon_ak47");
	check.expect(bot.activeItem?.classname ?? "", "the rifle in his hands first").toBe("weapon_ak47");
	watched = bot.id;
	finish = 2;

	sent.length = 0;
	check.expect(bot.switchWeapon("weapon_knife"), "switchWeapon(\"weapon_knife\")").toBe(true);
	const knife = bot.activeItem;
	check.expect(knife?.viewBody ?? -1, "the listener's viewBody on the knife").toBe(2);
	check.expect(knife?.body ?? -1, "the knife's body with it").toBe(2);
	check.expect(sent.join(" "), "the draw is sent with the body").toBe(`${KNIFE_DRAW}/2`);

	sent.length = 0;
	knife?.sendWeaponAnim(1, true);
	check.expect(sent.join(" "), "an animation the plugin plays, with the body").toBe("1/2");

	sent.length = 0;
	bot.switchWeapon("weapon_ak47");
	check.expect(sent.length > 0 && sent.every(anim => anim.endsWith("/0")), `the rifle's draw with its own body: ${sent.join(" ")}`).toBe(true);

	const rifle = bot.activeItem;
	if (rifle != null) rifle.viewBody = 4;
	check.expect(`${rifle?.viewBody ?? -1} ${rifle?.body ?? -1}`, "viewBody set by hand, and the body with it").toBe("4 4");
	if (rifle != null) rifle.viewBody = 0;

	if (knife != null) knife.viewBody = 0;
	check.expect(knife?.viewBody ?? -1, "viewBody 0").toBe(0);
	check.expect(knife?.body ?? -1, "the knife's body back to 0").toBe(0);

	game.addEventListener("clientData", countFrame);
	await sleep(300);
	game.removeEventListener("clientData", countFrame);
	check.expect(frames, "a bot is sent no client data").toBe(0);

	watched = 0;
	bot.kick();
	check.done();
}
