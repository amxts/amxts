// config-core через его нативы cfg_*, как их зовёт любой плагин: на
// fixtures/amxts-test.ini в папке конфигов тестового сервера. Запись идёт туда
// же - в addons/amxmodx/configs сервера ничего не попадает.
import * as fs from "@amxts/core/fs";
import {
	cfg_get_array_size,
	cfg_get_bool,
	cfg_get_float,
	cfg_get_int,
	cfg_get_section,
	cfg_get_value,
	cfg_has_key,
	cfg_load_file,
	cfg_save_config,
	cfg_set_base_dir,
	cfg_set_int,
} from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_config_core", run);

function run() {
	const check = new Checks("config-core");

	check.expect(server.configsDir.startsWith("addons/amxts/test/"), `конфиги в папке теста (${server.configsDir})`).toBe(true);

	// Папка одна на весь сервер, и плагин рядом мог выставить её в свою:
	// набор называет свою, как любой плагин, чьи файлы лежат не там.
	cfg_set_base_dir("");
	const file = cfg_load_file("amxts-test");
	check.expect(file >= 0, "файл загружен").toBe(true);

	const main = cfg_get_section(file, "MAIN");
	check.expect(main >= 0, "секция MAIN есть").toBe(true);

	check.expect(cfg_get_value(main, "NAME"), "строка").toBe("amxts");
	check.expect(cfg_get_int(main, "ROUNDS"), "целое").toBe(12);
	check.expect(cfg_get_float(main, "SPEED"), "дробное").toBeCloseTo(1.5);
	check.expect(cfg_get_bool(main, "ENABLED"), "bool").toBe(true);
	check.expect(cfg_get_value(main, "TEAMS", 1), "второе значение строки").toBe("T");
	check.expect(cfg_get_value(main, "GREETING"), "кириллица").toBe("Привет");
	check.expect(cfg_has_key(main, "MAPS"), "блок есть").toBe(true);
	check.expect(cfg_get_array_size(main, "MAPS"), "строк в блоке").toBe(2);
	check.expect(cfg_has_key(main, "MISSING"), "нет такого ключа").toBe(false);

	cfg_set_int(main, "ROUNDS", 13);
	check.expect(cfg_save_config(file, "amxts-test-saved"), "сохранён под новым именем").toBe(true);
	check.expect(fs.existsSync(`${server.configsDir}/amxts-test-saved.ini`), "файл записан в папку теста").toBe(true);

	const saved = cfg_get_section(cfg_load_file("amxts-test-saved"), "MAIN");
	check.expect(cfg_get_int(saved, "ROUNDS"), "записанное читается обратно").toBe(13);
	check.expect(cfg_get_value(saved, "GREETING"), "кириллица пережила запись").toBe("Привет");
	check.done();
}
