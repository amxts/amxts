// A tour of the plugin API: each part as a plugin writes it.
//
// The /tour command in chat shows the player, an entity, a weapon and flags on you.
// The rest - events, hookchains, a forward with a subscription, storage, timers - works by itself,
// when players join, fight and fall.

plugin({
	name: "API Showcase",
	version: "1.0.0",
	author: "amxts",
	description: "Every part of the plugin API in one file",
});

/** A hint for a player - just a record, so an interface and a literal. */
interface Tip {
	text: string;
	seconds: number;
}

const tips: Tip[] = [
	{ text: "Say /tour to see what this plugin can do", seconds: 30 },
	{ text: "Fall damage here is halved", seconds: 60 },
];

/** How many times each player joined - survives a map change. */
const visits = new Storage("showcase_visits");

/** Other plugins, in Pawn and in TypeScript, hear about every greeting. */
const greeted = new Forward<string, number>("showcase_on_greeted");

// Anyone may listen to the forward, the plugin itself included.
greeted.subscribe((name, count) => console.log(`${name} came back for visit ${count}`));

server.addEventListener("putinserver", (event) => {
	const player = event.player;
	if (player.isBot) return;

	const before = visits.get(player.authid);
	const count = before != null ? parseInt(before) + 1 : 1;
	visits.set(player.authid, count.toString());

	print(player, `Welcome to ${server.map}, ${player.name}! Visit #${count}.`);
	greeted.emit(player.name, count);
});

server.addEventListener("disconnected", (event) => {
	console.log(`${event.player.name} left${event.dropped ? ` (${event.reason})` : ""}`);
});

game.addEventListener("takeDamage", onTakeDamage);
game.addEventListener("fallDamage", onFallDamage, true);
game.addEventListener("canPlayerHearPlayer", onHear);

/** A glowing player is protected: the damage is blocked, nothing needs answering. */
function onTakeDamage(event: TakeDamageEvent) {
	if (event.player.renderFx == "glowShell") event.preventDefault();
}

/** The answer is what the listener returned: half the damage the game counted. */
function onFallDamage(event: FallDamageEvent) {
	return event.result / 2;
}

/** Only players of one team hear each other. */
function onHear(event: CanPlayerHearPlayerEvent) {
	return event.listener.team == event.sender.team;
}

let tipIndex = 0;
setInterval(showTip, 45000);

function showTip() {
	const tip = tips[tipIndex % tips.length];
	tipIndex++;

	for (const player of server.players.filter(one => !one.isBot)) print(player, tip.text);
}

server.addCommand("/tour", ({ player }) => tour(player), { description: "Walk through the plugin API" });

function tour(player: Player) {
	if (!player.isAlive) {
		print(player, "Come back alive - the tour happens to you.");
		return;
	}

	showPlayer(player);
	showEntity(player);
	showWeapon(player);
	showFlags(player);
	showServer(player);
}

/** A player: their data, team and actions on them. */
function showPlayer(player: Player) {
	print(player, `${player.name}: ${player.health} HP, ${player.armor} armor, team ${player.team}`);

	player.give("weapon_flashbang");
	player.setAmmo("weapon_flashbang", 2);
	player.switchWeapon("weapon_knife");

	const living = server.players.filter(player => player.isAlive && !player.isBot);
	print(player, `${living.length} living people, ${server.players.filter(player => player.team === "CT").length} counter-terrorists`);

	if (player.access.includes("Cvar")) print(player, "You may change the server's settings.");
}

/** An entity's fields with their types. */
function showEntity(player: Player) {
	const lowGravity = 0.5;
	player.gravity = lowGravity;

	// A glow for five seconds - and onTakeDamage leaves the glowing player alone.
	player.renderFx = "glowShell";
	player.renderColor = [0.0, 160.0, 255.0];
	player.renderAmount = 20.0;
	setTimeout(() => stopGlow(player), 5000);

	const where = player.origin;
	print(player, `Gravity ${player.gravity}, standing at ${Math.round(where[0])} ${Math.round(where[1])}`);
}

function stopGlow(player: Player) {
	player.renderFx = "none";
	player.renderMode = "normal";
	player.gravity = 1.0;
}

/** The weapon in hand and everything the player carries. */
function showWeapon(player: Player) {
	const weapon = player.activeItem;
	if (weapon == null) return;

	print(player, `In hand: ${weapon.kind}, carrying ${player.items.length} items`);
	if (weapon.kind != "knife") weapon.clip = 1;
}

/** Flags are arrays of names. */
function showFlags(player: Player) {
	player.hideHud.push("Money");
	setTimeout(() => showMoney(player), 3000);

	const onGround = player.flags.includes("OnGround");
	print(player, onGround ? "Your money is hidden for three seconds." : "Land first - you are in the air.");
}

function showMoney(player: Player) {
	player.hideHud = player.hideHud.filter(part => part != "Money");
}

/** The server itself. */
function showServer(player: Player) {
	print(player, `${server.map}, ${server.maxPlayers} slots, reapi ${hasModule("reapi") ? "loaded" : "missing"}`);
	print({ id: player.id, variant: "center" }, "Tour complete!");

	// A timer cancelled before it fires.
	const never = setTimeout(neverRuns, 60000);
	clearTimeout(never);
}

function neverRuns() {
	server.command("echo this never runs");
}
