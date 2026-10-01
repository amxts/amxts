// Кириллица доходит до консоли сервера как UTF-8, а не вопросами. Что
// напечатано, плагин сам не видит - строки ниже раннер ищет в логе как есть.
//
// @log Привет, мир (console.log)
// @log Привет, мир (server_print)
import { contain, server_print, strlen } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

const text = new Cvar("amxts_test_text", "");

server.addServerCommand("amxts_test_utf8", run);

function run() {
	const check = new Checks("utf8");

	console.log("Привет, мир (console.log)");
	server_print("Привет, мир (server_print)");

	check.expect("Привет".length, "длина строки в символах").toBe(6);

	text.value = "Ёлка и щука";
	check.expect(text.value, "строка прошла через квар и вернулась").toBe("Ёлка и щука");

	// Натив получает текст целиком, а не первые 511 байт.
	check.expect(strlen("я".repeat(1500)), "3000 байт кириллицы доходят до натива").toBe(3000);
	check.expect(contain(`${"x".repeat(5000)}иголка`, "иголка"), "иголка после 5000 байт найдена").toBe(5000);
	check.done();
}
