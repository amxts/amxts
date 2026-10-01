// Дерево config-core на настоящем сервере: YAML, JSON и INI читаются
// разборщиками модуля под WAMR, значения идут через прокси общего модуля, файл
// пишется обратно в своём формате. Файлы - в папке конфигов тестового сервера.
// @log amxts-tree-bad.yaml:2:4: anchors and aliases (& and *) are not supported - write the value out
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_config_tree", run);

const YAML_TEXT = "# настройки\nchat:\n  prefix: \"[HNS]\"\n  rules:\n    - Будь вежлив\n    - Без читов\nround:\n  time: 2.5\nhud: { enabled: true }\nnote: |\n  две\n  строки\n";
const JSON_TEXT = "{\n  // настройки\n  \"chat\": { \"prefix\": \"[HNS]\", \"rules\": [\"Будь вежлив\", \"Без читов\"], },\n  \"round\": { \"time\": 2.5 },\n  \"hud\": { \"enabled\": true },\n}\n";
const INI_TEXT = "[chat]\nprefix = [HNS]\nrules = \"Будь вежлив\" \"Без читов\"\n[round]\ntime = 2.5\n[hud]\nenabled = 1\n";

function run() {
	const check = new Checks("config-tree");
	check.expect(server.configsDir.startsWith("addons/amxts/test/"), `конфиги в папке теста (${server.configsDir})`).toBe(true);

	// Папка одна на весь сервер, и плагин рядом мог выставить её в свою.
	configs.setBaseDir("");
	fs.writeFileSync(`${server.configsDir}/amxts-tree-a.yaml`, YAML_TEXT);
	fs.writeFileSync(`${server.configsDir}/amxts-tree-b.jsonc`, JSON_TEXT);
	fs.writeFileSync(`${server.configsDir}/amxts-tree-c.ini`, INI_TEXT);

	for (const name of ["amxts-tree-a", "amxts-tree-b", "amxts-tree-c"]) {
		const settings = configs.read(name);
		check.expect(settings.getString("chat.prefix"), `${name}: текст`).toBe("[HNS]");
		check.expect(settings.getStrings("chat.rules").join("|"), `${name}: список, кириллица`).toBe("Будь вежлив|Без читов");
		check.expect(settings.getNumber("round.time"), `${name}: число`).toBe(2.5);
		check.expect(settings.getBoolean("hud.enabled"), `${name}: логическое`).toBe(true);
		check.expect(settings.getString("missing", "нет"), `${name}: запасное значение`).toBe("нет");
	}

	const yaml = configs.read("amxts-tree-a");
	check.expect(yaml.getString("note"), "блок |").toBe("две\nстроки\n");
	check.expect(yaml.get("round.time")?.line ?? 0, "строка значения").toBe(8);

	yaml.setNumber("round.time", 3);
	yaml.set("chat.prefix", "[Новый]");
	check.expect(yaml.save(), "YAML сохранён").toBe(true);
	const saved = configs.read("amxts-tree-a.yaml");
	check.expect(saved.getNumber("round.time"), "записанное число читается обратно").toBe(3);
	check.expect(saved.getString("chat.prefix"), "кириллица пережила запись").toBe("[Новый]");
	check.expect((fs.readFileSync(`${server.configsDir}/amxts-tree-a.yaml`) ?? "").startsWith("# настройки"), "комментарий остался").toBe(true);

	fs.writeFileSync(`${server.configsDir}/amxts-tree-bad.yaml`, "a: 1\nb: &x 2\n");
	check.expect(configs.read("amxts-tree-bad").keys().length, "файл с ошибкой читается пустым").toBe(0);
	check.done();
}
