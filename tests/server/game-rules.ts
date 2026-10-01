// Правила игры - поля game, сгенерированные как у сущности: число, дробь,
// булево, текст и победитель раунда именем. Счёт команды уходит в таблицу
// сразу: TeamScore слышен как событие "message:TeamScore". Записанное
// сверяется с reapi, а без него - с fakemeta, чьи смещения - оригинальной
// игры, не ReGameDLL. Члены ReGameDLL без reapi читаются из того, что у
// сервера есть: gameDesc - описание игры, timeLimit - из mp_timelimit.
import { m_iNumCTWins, m_iNumTerroristWins } from "@amxts/core/constants";
import { get_cvar_float, get_gamerules_int, get_member_game, set_cvar_float } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_game_rules", () => {
	run();
});

/** Разосланный счёт: "CT 7;TERRORIST 2;". */
let scores = "";

server.addEventListener("message:TeamScore", (event) => {
	scores += `${event.args.text(0)} ${event.args.number(1)};`;
});

async function run() {
	const check = new Checks("game-rules");

	const wins = game.numCtWins;
	const terroristWins = game.numTerroristWins;
	scores = "";
	game.numCtWins = wins + 7;
	check.expect(rulesMember(m_iNumCTWins, "m_iNumCTWins"), "numCtWins записан в m_iNumCTWins").toBe(wins + 7);
	check.expect(game.numCtWins, "numCtWins прочитан обратно").toBe(wins + 7);
	check.expect(rulesMember(m_iNumTerroristWins, "m_iNumTerroristWins"), "счёт террористов не тронут").toBe(terroristWins);
	check.expect(scores, "таблица получила счёт сразу").toBe(`CT ${wins + 7};TERRORIST ${terroristWins};`);
	game.numCtWins = wins;

	check.expect(game.gameDesc.length > 0, `gameDesc - текст (${game.gameDesc})`).toBe(true);
	check.expect(game.roundTimeSecs > 0, `roundTimeSecs - секунды раунда (${game.roundTimeSecs})`).toBe(true);
	check.expect(game.roundStartTime <= game.time, "roundStartTime - момент в прошлом").toBe(true);
	check.expect(["none", "CT", "TERRORIST", "draw"].includes(game.roundWinner), `roundWinner - имя (${game.roundWinner})`).toBe(true);
	check.expect(game.levelInitialized, "levelInitialized - булево, карта осмотрена").toBe(true);

	// Конец карты по mp_timelimit: ReGameDLL пересчитывает его кадром позже, без reapi он из квара.
	const limit = get_cvar_float("mp_timelimit");
	set_cvar_float("mp_timelimit", 60);
	await sleep(200);
	check.expect(game.timeLimit - game.gameStartTime, "timeLimit - через mp_timelimit минут от начала игры").toBeCloseTo(3600);
	if (!hasModule("reapi")) {
		game.timeLimit = game.gameStartTime + 1200;
		check.expect(get_cvar_float("mp_timelimit"), "timeLimit записан в mp_timelimit").toBeCloseTo(20);
	}
	set_cvar_float("mp_timelimit", limit);

	check.done();
}

/** Член правил игры, прочитанный мимо game: нативом reapi, а без него - fakemeta. */
function rulesMember(member: number, name: string) {
	return hasModule("reapi") ? get_member_game(member) : get_gamerules_int("CHalfLifeMultiplay", name);
}
