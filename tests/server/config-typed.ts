// config-core's typed config on a real server: configs.load reads YAML, JSON
// and INI into an object under WAMR - the code the build generates goes
// through the shared module's proxy - tells the console about an error in the
// file and writes the object back. Files are in the test server's configs folder.
// @log amxts-typed-a.yaml:5:3: "time" is text ("soon"), not a number - the default stays
// @log amxts-typed-a.yaml:2:3: unknown key "prefx" in "chat" - did you mean "prefix"?
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_config_typed", run);

type Mode = "normal" | "dm";

interface Settings {
	chat: { prefix: string; rules: string[] };
	round: { time: number; mode: Mode };
	motd?: string;
}

// Cyrillic on purpose: the rules are UTF-8 in every format.
const YAML_TEXT = "chat:\n  prefx: x\n  rules: [Будь вежлив]\nround:\n  time: soon\n  mode: dm\n";
const JSON_TEXT = "{\n  // settings\n  \"chat\": { \"prefix\": \"[J]\" },\n  \"round\": { \"time\": 4 },\n}\n";
const INI_TEXT = "; settings\n[chat]\nPREFIX = [I]\nrules = \"Будь вежлив\" \"Без читов\"\n[round]\ntime = 3.5\n";

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
	check.expect(yaml.chat.prefix, "YAML: what the file lacks is the default").toBe("[HNS]");
	// Cyrillic on purpose: the rules are UTF-8 in every format.
	check.expect(yaml.chat.rules.join("|"), "YAML: a list, Cyrillic").toBe("Будь вежлив");
	check.expect(yaml.round.time, "YAML: not a number - the default").toBe(2.5);
	check.expect(yaml.round.mode, "YAML: a name from the union").toBe("dm");
	check.expect(yaml.motd === undefined, "YAML: an optional field is not set").toBe(true);

	const json = read("amxts-typed-b");
	check.expect(`${json.chat.prefix} ${json.round.time}`, "JSON with a comment").toBe("[J] 4");

	const ini = read("amxts-typed-c");
	// Cyrillic on purpose: the rules are UTF-8 in every format.
	check.expect(`${ini.chat.prefix} ${ini.chat.rules.join("|")} ${ini.round.time}`, "INI: [chat] prefix is chat.prefix, a key in any case").toBe("[I] Будь вежлив|Без читов 3.5");

	ini.round.time = 5;
	check.expect(configs.save(ini), "INI saved").toBe(true);
	const text = (fs.readFileSync(`${server.configsDir}/amxts-typed-c.ini`) ?? "").replaceAll("\r\n", "\n");
	check.expect(text.startsWith("; settings\n[chat]\nPREFIX = [I]"), "the comment and the key's case stayed").toBe(true);
	check.expect(read("amxts-typed-c").round.time, "a written number reads back").toBe(5);

	yaml.round.time = 3;
	check.expect(configs.save(yaml), "YAML saved").toBe(true);
	check.expect(read("amxts-typed-a").round.time, "YAML: what was written reads back").toBe(3);
	check.done();
}
