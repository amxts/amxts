// config-core through its cfg_* natives, as any plugin calls them: on
// fixtures/amxts-test.ini in the test server's configs folder. Writes go there
// too - nothing lands in the server's addons/amxmodx/configs.
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

	check.expect(server.configsDir.startsWith("addons/amxts/test/"), `configs in the test's folder (${server.configsDir})`).toBe(true);

	// The folder is one for the whole server, and a plugin beside may have set it
	// to its own: the suite names its own, as any plugin whose files lie elsewhere.
	cfg_set_base_dir("");
	const file = cfg_load_file("amxts-test");
	check.expect(file >= 0, "the file is loaded").toBe(true);

	const main = cfg_get_section(file, "MAIN");
	check.expect(main >= 0, "the MAIN section is there").toBe(true);

	check.expect(cfg_get_value(main, "NAME"), "a string").toBe("amxts");
	check.expect(cfg_get_int(main, "ROUNDS"), "an integer").toBe(12);
	check.expect(cfg_get_float(main, "SPEED"), "a fraction").toBeCloseTo(1.5);
	check.expect(cfg_get_bool(main, "ENABLED"), "bool").toBe(true);
	check.expect(cfg_get_value(main, "TEAMS", 1), "the line's second value").toBe("T");
	// Cyrillic on purpose: a value is UTF-8 and survives a save.
	check.expect(cfg_get_value(main, "GREETING"), "кириллица").toBe("Привет");
	check.expect(cfg_has_key(main, "MAPS"), "the block is there").toBe(true);
	check.expect(cfg_get_array_size(main, "MAPS"), "lines in the block").toBe(2);
	check.expect(cfg_has_key(main, "MISSING"), "no such key").toBe(false);

	cfg_set_int(main, "ROUNDS", 13);
	check.expect(cfg_save_config(file, "amxts-test-saved"), "saved under a new name").toBe(true);
	check.expect(fs.existsSync(`${server.configsDir}/amxts-test-saved.ini`), "the file is written to the test's folder").toBe(true);

	const saved = cfg_get_section(cfg_load_file("amxts-test-saved"), "MAIN");
	check.expect(cfg_get_int(saved, "ROUNDS"), "what was written reads back").toBe(13);
	// Cyrillic on purpose: a value is UTF-8 and survives a save.
	check.expect(cfg_get_value(saved, "GREETING"), "кириллица пережила запись").toBe("Привет");
	check.done();
}
