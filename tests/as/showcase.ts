// Экскурсия по API плагинов: каждая часть в том виде, в каком её пишет плагин.
//
// Команда /tour в чате показывает на вас игрока, сущность, оружие и флаги.
// Остальное - события, хукчейны, форвард с подпиской, хранилище, таймеры - работает само,
// когда игроки заходят, дерутся и падают.

plugin({
	name: "API Showcase",
	version: "1.0.0",
	author: "amxts",
	description: "Every part of the plugin API in one file",
});

/** Подсказка игроку - просто запись, поэтому interface и литерал. */
interface Tip {
	text: string;
	seconds: number;
}

const tips: Tip[] = [
	{ text: "Say /tour to see what this plugin can do", seconds: 30 },
	{ text: "Fall damage here is halved", seconds: 60 },
];

/** Сколько раз каждый игрок заходил - переживает смену карты. */
const visits = new Storage("showcase_visits");

/** Про каждое приветствие узнают другие плагины, на Pawn и на TypeScript. */
const greeted = new Forward<string, number>("showcase_on_greeted");

// Слушать форвард может кто угодно, в том числе сам плагин.
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
game.addEventListener("flPlayerFallDamage", onFallDamage, true);
game.addEventListener("canPlayerHearPlayer", onHear);

/** Светящийся игрок под защитой: урон блокируется, отвечать ничего не нужно. */
function onTakeDamage(event: TakeDamageEvent) {
	if (event.player.renderFx == "glowShell") event.preventDefault();
}

/** Ответ - это то, что вернул обработчик: половина урона, который посчитала игра. */
function onFallDamage(event: FlPlayerFallDamageEvent) {
	return event.result / 2;
}

/** Слышат друг друга только игроки одной команды. */
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

/** Игрок: его данные, команда и действия над ним. */
function showPlayer(player: Player) {
	print(player, `${player.name}: ${player.health} HP, ${player.armor} armor, team ${player.team}`);

	player.give("weapon_flashbang");
	player.setAmmo("weapon_flashbang", 2);
	player.switchWeapon("weapon_knife");

	const living = server.players.filter(player => player.isAlive && !player.isBot);
	print(player, `${living.length} living people, ${server.players.filter(player => player.team === "CT").length} counter-terrorists`);

	if (player.access.includes("Cvar")) print(player, "You may change the server's settings.");
}

/** Поля сущности с их типами. */
function showEntity(player: Player) {
	const lowGravity = 0.5;
	player.gravity = lowGravity;

	// Свечение на пять секунд - и onTakeDamage не трогает светящегося игрока.
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

/** Оружие в руках и всё, что игрок несёт. */
function showWeapon(player: Player) {
	const weapon = player.activeItem;
	if (weapon == null) return;

	print(player, `In hand: ${weapon.kind}, carrying ${player.items.length} items`);
	if (weapon.kind != "knife") weapon.clip = 1;
}

/** Флаги - массивы имён. */
function showFlags(player: Player) {
	player.hideHud.push("Money");
	setTimeout(() => showMoney(player), 3000);

	const onGround = player.flags.includes("OnGround");
	print(player, onGround ? "Your money is hidden for three seconds." : "Land first - you are in the air.");
}

function showMoney(player: Player) {
	player.hideHud = player.hideHud.filter(part => part != "Money");
}

/** Сам сервер. */
function showServer(player: Player) {
	print(player, `${server.map}, ${server.maxPlayers} slots, reapi ${hasModule("reapi") ? "loaded" : "missing"}`);
	print({ id: player.id, variant: "center" }, "Tour complete!");

	// Таймер, который отменяют до того, как он сработает.
	const never = setTimeout(neverRuns, 60000);
	clearTimeout(never);
}

function neverRuns() {
	server.command("echo this never runs");
}
