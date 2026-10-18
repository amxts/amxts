// A weapon's viewBody and the clientData event on a real server: a bot of
// its own switches to a knife whose deploy listener gives it a
// viewBody, and every animation of the knife the game sends him - the draw,
// one the plugin plays - carries that body (client-data-pawn.sma hears
// SVC_WEAPONANIM); the rifle's draw carries its own, and a plain knife
// (viewBody 0) draws with body 0. 0 is a body: writing it holds the weapon
// the same way, and the getter reads it. A bot is sent no client data - the
// engine sends it to a real client only - so the hold and the release of a
// viewBody as the weapon leaves the hands only show with a real client;
// here the clientData listener is only added and taken off, the server
// running frames with the hooks in place. The same for a visibility listener
// that moves the point a player sees from: a bot is sent no entities.
import { Checks } from "@amxts/core/check";

const NAME = "amxts view bot";
// Knife's draw animation, as the game numbers it.
const KNIFE_DRAW = 3;

let watched = 0;
let finish = 0;
/** The animations the watched bot was sent since the suite cleared them: "anim/body". */
const sent: string[] = [];
/** The knives the watched bot drew since the suite cleared them. */
const deployed: string[] = [];
let frames = 0;

/** client-data-pawn.sma's handler of SVC_WEAPONANIM: an animation sent to `player`, drawn with `body`. */
export function client_data_pawn(player: number, anim: number, body: number) {
	if (player == watched) sent.push(`${anim}/${body}`);
}

// Ham Sandwich's deploy, before the game draws the knife: on plain HLDS too,
// which has no defaultDeploy.
game.addEventListener("deploy", (event) => {
	if (event.weapon.player?.id != watched) return;
	deployed.push(event.weapon.classname);
	event.weapon.viewBody = finish;
}, { classname: "weapon_knife" });

function countFrame() {
	frames++;
}

function lookFromAbove(event: VisibilityEvent) {
	frames++;
	event.origin = event.origin.add([0, 0, 1000]);
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
	const before = bot.activeItem?.classname ?? "";
	const switched = bot.switchWeapon("weapon_knife");
	const knife = bot.activeItem;
	check.expect(`${switched} ${before} -> ${knife?.classname ?? ""}, deployed ${deployed.join(" ")}, sent ${sent.join(" ")}`, "the switch to the knife")
		.toBe(`true weapon_ak47 -> weapon_knife, deployed weapon_knife, sent ${KNIFE_DRAW}/2`);
	check.expect(knife?.viewBody ?? -1, "the listener's viewBody on the knife").toBe(2);
	check.expect(knife?.body ?? -1, "the knife's body with it").toBe(2);
	check.expect(sent.join(" "), "the draw is sent with the body").toBe(`${KNIFE_DRAW}/2`);
	// The draw is sent again on a client's next client data, which a bot is not sent.
	await sleep(200);
	check.expect(sent.join(" "), "a bot, which predicts nothing, gets the draw once").toBe(`${KNIFE_DRAW}/2`);

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
	check.expect(rifle?.viewBody ?? -1, "viewBody 0 is a body, read back").toBe(0);

	// A plain knife: the deploy listener gives it viewBody 0, which holds it the
	// same way; its draw carries body 0.
	finish = 0;
	sent.length = 0;
	bot.switchWeapon("weapon_knife");
	const plain = bot.activeItem;
	check.expect(plain?.viewBody ?? -1, "viewBody 0 set on the plain knife").toBe(0);
	check.expect(plain?.body ?? -1, "the plain knife's body is 0").toBe(0);
	check.expect(sent.join(" "), "the plain knife's draw with body 0").toBe(`${KNIFE_DRAW}/0`);

	game.addEventListener("clientData", countFrame);
	await sleep(300);
	game.removeEventListener("clientData", countFrame);
	check.expect(frames, "a bot is sent no client data").toBe(0);
	game.addEventListener("visibility", lookFromAbove);
	await sleep(300);
	game.removeEventListener("visibility", lookFromAbove);
	check.expect(frames, "nor entities, so no visibility").toBe(0);

	watched = 0;
	bot.kick();
	check.done();
}
