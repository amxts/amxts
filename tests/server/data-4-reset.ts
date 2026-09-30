// Поля Player на сервере, шаг 4: бота выгоняют, в его слот приходит другой -
// и поля снова по умолчанию. Строку testTag написал Pawn (data-3-pawn).
// С самого начала этот плагин слушает playerchange: он слышит, что записал
// другой TS-плагин (data-1-write) и Pawn (data-3-pawn), и не слышит выход бота.
import { get_user_userid } from "~/natives";
import { Checks } from "~/lib/check";
import "../as/player-state";

declare module "~/facade" {
	interface Player {
		/** Строка, которую пишет Pawn-набор data-3-pawn. */
		testTag: string;
	}
}

/** Что этот плагин услышал, по порядку. */
const heard: string[] = [];
/** Каждое изменение любого поля: слот и поле. */
const changes: string[] = [];

server.addEventListener("playerchange", event => heard.push(`ghost ${event.previous} -> ${event.value}`), { field: "ghost" });
server.addEventListener("playerchange", event => heard.push(`enabled ${event.previous} -> ${event.value}`), { field: "glow.enabled" });
server.addEventListener("playerchange", event => heard.push(`testTag "${event.previous}" -> "${event.value}"`), { field: "testTag" });
server.addEventListener("playerchange", event => changes.push(`${event.player.id}:${event.field}`));

server.addServerCommand("amxts_test_data_reset", () => {
	run();
});

async function run() {
	const check = new Checks("data-reset");
	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);
	if (bot == null) {
		check.done();
		return;
	}

	const slot = bot.id;
	check.expect(bot.ghost, "ghost до выхода").toBe(true);
	check.expect(bot.testTag, "строка из Pawn").toBe("Привет");
	check.expect(heard.join("; "), "услышано из TS и из Pawn").toBe(
		"ghost false -> true; enabled default -> true; enabled true -> false; enabled false -> default; testTag \"\" -> \"Привет\"",
	);
	const onBot = changes.filter(change => change.startsWith(`${slot}:`)).map(change => change.slice(change.indexOf(":") + 1));
	check.expect(onBot.join(", "), "всё, что записали боту data-1 и data-3").toBe(
		"ghost, glow.enabled, glow.seenBy, glow.enabled, glow.enabled, testSpeed, testTag",
	);
	const before = changes.length;

	server.command(`kick #${get_user_userid(slot)}`);
	const next = await nextBot();
	check.expect(changes.slice(before).join(", "), "выход бота - не изменение").toBe("");
	check.expect(next != null, "пришёл другой бот").toBe(true);
	if (next != null) check.expect(next.id, "он в том же слоте").toBe(slot);

	const after = new Player(slot);
	check.expect(after.ghost, "ghost в слоте - по умолчанию").toBe(false);
	check.expect(after.testTag, "строка в слоте - пустая").toBe("");
	check.done();
}

/** Бот, пришедший после выхода прежнего: YaPB добавляет его сам, иначе - yb add. */
async function nextBot() {
	await sleep(1000);
	for (let waited = 0; waited < 12000; waited += 500) {
		const found = Player.all({ bots: true }).find(one => one.isConnected);
		if (found != null) return found;
		if (waited == 2000) server.command("yb add");
		await sleep(500);
	}
	return null;
}
