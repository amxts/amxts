// Квар, созданный на верхнем уровне файла. create_cvar во время
// plugin_natives ронял сервер при загрузке плагина: то, что этот плагин
// вообще загрузился и отвечает на команду, - уже половина проверки.
import { Cvar, server } from "~/facade";
import { Checks } from "~/lib/check";

const answer = new Cvar("amxts_test_answer", "42");
const freeze = new Cvar("mp_freezetime");
let heard = "";

answer.addEventListener("change", (event) => {
	heard = event.value;
});

server.addServerCommand("amxts_test_cvar", run);

function run() {
	const check = new Checks("cvar");

	check.expect(answer.exists, "квар с верхнего уровня создан").toBe(true);
	check.expect(answer.value, "значение по умолчанию").toBe("42");
	check.expect(answer.number, "как число").toBe(42);

	answer.number = 7;
	check.expect(answer.value, "целое пишется без дробной части").toBe("7");
	check.expect(heard, "слушатель change услышал запись").toBe("7");

	answer.value = "0";
	check.expect(answer.boolean, "0 - выключено").toBe(false);

	check.expect(freeze.exists, "чужой квар находится по имени").toBe(true);
	check.done();
}
