// Звуки и прекэш: server.precache в событии "precache" отдаёт индексы, а
// звук от сущности, звук одному игроку и полоса прогресса уходят без ошибок -
// что слышит клиент, отсюда не проверить.
import { Checks } from "~/lib/check";

const indices: number[] = [];

server.addEventListener("precache", () => {
	for (const path of ["items/gunpickup2.wav", "models/w_c4.mdl", "sprites/laserbeam.spr"]) indices.push(server.precache(path).index);
});

server.addServerCommand("amxts_test_sound", run);

function run() {
	const check = new Checks("sound");

	check.expect(indices.length, "прекэш прошёл в событии precache").toBe(3);
	check.expect(indices.every(index => index > 0), `у каждого файла есть индекс (${indices.join(", ")})`).toBe(true);

	const bot = Player.all({ bots: true }).find(one => one.isConnected);
	check.expect(bot != null, "на сервере есть бот").toBe(true);

	if (bot != null) {
		bot.emitSound("items/gunpickup2.wav", { channel: "item", volume: 0.5, pitch: 120 });
		bot.playSound("items/gunpickup2.wav");
		bot.screen.progressBar(3);
		bot.screen.progressBar(0);
		check.expect(bot.isConnected, "звуки и полоса ушли, бот на месте").toBe(true);
	}

	check.done();
}
