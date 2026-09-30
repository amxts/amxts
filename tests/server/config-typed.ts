// Типизированный конфиг config-core на настоящем сервере: configs.load читает
// YAML, JSON и INI в объект под WAMR - сгенерированный сборкой код идёт через
// прокси общего модуля, - говорит в консоль об ошибке в файле и пишет объект
// обратно. Файлы - в папке конфигов тестового сервера.
// @log amxts-typed-a.yaml:5:3: "time" is text ("скоро"), not a number - the default stays
// @log amxts-typed-a.yaml:2:3: unknown key "prefx" in "chat" - did you mean "prefix"?
import * as fs from "~/fs";
import { Checks } from "~/lib/check";

server.addServerCommand("amxts_test_config_typed", run);

type Mode = "normal" | "dm";

interface Settings {
	chat: { prefix: string; rules: string[] };
	round: { time: number; mode: Mode };
	motd?: string;
}

const YAML_TEXT = "chat:\n  prefx: x\n  rules: [Будь вежлив]\nround:\n  time: скоро\n  mode: dm\n";
const JSON_TEXT = "{\n  // настройки\n  \"chat\": { \"prefix\": \"[J]\" },\n  \"round\": { \"time\": 4 },\n}\n";
const INI_TEXT = "; настройки\n[chat]\nPREFIX = [I]\nrules = \"Будь вежлив\" \"Без читов\"\n[round]\ntime = 3.5\n";

function read(name: string) {
	return configs.load<Settings>(name, {
		chat: { prefix: "[HNS]", rules: [] },
		round: { time: 2.5, mode: "normal" },
	});
}

function run() {
	const check = new Checks("config-typed");
	configs.setBaseDir("");
	fs.writeFileSync(`${server.configsDir}/amxts-typed-a.yaml`, YAML_TEXT);
	fs.writeFileSync(`${server.configsDir}/amxts-typed-b.json`, JSON_TEXT);
	fs.writeFileSync(`${server.configsDir}/amxts-typed-c.ini`, INI_TEXT);

	const yaml = read("amxts-typed-a");
	check.expect(yaml.chat.prefix, "YAML: чего нет в файле, то по умолчанию").toBe("[HNS]");
	check.expect(yaml.chat.rules.join("|"), "YAML: список, кириллица").toBe("Будь вежлив");
	check.expect(yaml.round.time, "YAML: не число - по умолчанию").toBe(2.5);
	check.expect(yaml.round.mode, "YAML: имя из юниона").toBe("dm");
	check.expect(yaml.motd === undefined, "YAML: необязательное поле не задано").toBe(true);

	const json = read("amxts-typed-b");
	check.expect(`${json.chat.prefix} ${json.round.time}`, "JSON с комментарием").toBe("[J] 4");

	const ini = read("amxts-typed-c");
	check.expect(`${ini.chat.prefix} ${ini.chat.rules.join("|")} ${ini.round.time}`, "INI: [chat] prefix - это chat.prefix, ключ в любом регистре").toBe("[I] Будь вежлив|Без читов 3.5");

	ini.round.time = 5;
	check.expect(configs.save(ini), "INI сохранён").toBe(true);
	const text = (fs.readFileSync(`${server.configsDir}/amxts-typed-c.ini`) ?? "").replaceAll("\r\n", "\n");
	check.expect(text.startsWith("; настройки\n[chat]\nPREFIX = [I]"), "комментарий и регистр ключа остались").toBe(true);
	check.expect(read("amxts-typed-c").round.time, "записанное число читается обратно").toBe(5);

	yaml.round.time = 3;
	check.expect(configs.save(yaml), "YAML сохранён").toBe(true);
	check.expect(read("amxts-typed-a").round.time, "YAML: записанное читается обратно").toBe(3);
	check.done();
}
