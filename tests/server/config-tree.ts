// config-core's tree on a real server: YAML, JSON and INI are read by the
// module's parsers under WAMR, values go through the shared module's proxy, a
// file is written back in its own format. Files are in the test server's configs folder.
// @log amxts-tree-bad.yaml:2:4: anchors and aliases (& and *) are not supported - write the value out
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_config_tree", run);

// Cyrillic on purpose: the rules are UTF-8 in every format.
const YAML_TEXT = "# settings\nchat:\n  prefix: \"[HNS]\"\n  rules:\n    - Будь вежлив\n    - Без читов\nround:\n  time: 2.5\nhud: { enabled: true }\nnote: |\n  two\n  lines\n";
const JSON_TEXT = "{\n  // settings\n  \"chat\": { \"prefix\": \"[HNS]\", \"rules\": [\"Будь вежлив\", \"Без читов\"], },\n  \"round\": { \"time\": 2.5 },\n  \"hud\": { \"enabled\": true },\n}\n";
const INI_TEXT = "[chat]\nprefix = [HNS]\nrules = \"Будь вежлив\" \"Без читов\"\n[round]\ntime = 2.5\n[hud]\nenabled = 1\n";

function run() {
	const check = new Checks("config-tree");
	check.expect(server.configsDir.startsWith("addons/amxts/test/"), `configs in the test's folder (${server.configsDir})`).toBe(true);

	// The folder is one for the whole server, and a plugin beside may have set it to its own.
	configs.setBaseDir("");
	fs.writeFileSync(`${server.configsDir}/amxts-tree-a.yaml`, YAML_TEXT);
	fs.writeFileSync(`${server.configsDir}/amxts-tree-b.jsonc`, JSON_TEXT);
	fs.writeFileSync(`${server.configsDir}/amxts-tree-c.ini`, INI_TEXT);

	for (const name of ["amxts-tree-a", "amxts-tree-b", "amxts-tree-c"]) {
		const settings = configs.read(name);
		check.expect(settings.getString("chat.prefix"), `${name}: text`).toBe("[HNS]");
		// Cyrillic on purpose: the rules are UTF-8 in every format.
		check.expect(settings.getStrings("chat.rules").join("|"), `${name}: a list, Cyrillic`).toBe("Будь вежлив|Без читов");
		check.expect(settings.getNumber("round.time"), `${name}: a number`).toBe(2.5);
		check.expect(settings.getBoolean("hud.enabled"), `${name}: a boolean`).toBe(true);
		check.expect(settings.getString("missing", "none"), `${name}: the fallback`).toBe("none");
	}

	const yaml = configs.read("amxts-tree-a");
	check.expect(yaml.getString("note"), "a | block").toBe("two\nlines\n");
	check.expect(yaml.get("round.time")?.line ?? 0, "the value's line").toBe(8);

	yaml.setNumber("round.time", 3);
	// Cyrillic on purpose: a value is UTF-8 and survives a save.
	yaml.set("chat.prefix", "[Новый]");
	check.expect(yaml.save(), "YAML saved").toBe(true);
	const saved = configs.read("amxts-tree-a.yaml");
	check.expect(saved.getNumber("round.time"), "a written number reads back").toBe(3);
	check.expect(saved.getString("chat.prefix"), "Cyrillic survived the write").toBe("[Новый]");
	check.expect((fs.readFileSync(`${server.configsDir}/amxts-tree-a.yaml`) ?? "").startsWith("# settings"), "the comment stayed").toBe(true);

	fs.writeFileSync(`${server.configsDir}/amxts-tree-bad.yaml`, "a: 1\nb: &x 2\n");
	check.expect(configs.read("amxts-tree-bad").keys().length, "a file with an error reads empty").toBe(0);
	check.done();
}
