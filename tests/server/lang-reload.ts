// A plugin's dictionary written after the plugin's own upload is read again
// as soon as it lands, not at the next map: lang-target loads it at its top
// level, its .aot is written again, and only then does the new dictionary
// arrive - an upload that sends the plugin first.
// @log amxts_test_lang.txt changed on disk - read again
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const DICTIONARY = "addons/amxts/test/amxts_test_lang.txt";
const TARGET = "addons/amxts/test/plugins/lang-target.aot";
/** What the watcher takes to see a file settled and act on it, with room to spare. */
const SETTLED = 1500;

server.addServerCommand("amxts_test_lang_reload", langReload);

async function langReload() {
	const check = new Checks("lang-reload");
	fs.writeFileSync(DICTIONARY, "[en]\nTEST_LANG_WORD = one\n");
	server.command("amxts_load lang-target");
	await sleep(SETTLED);
	check.expect(lang.translate(null, "TEST_LANG_WORD"), "the plugin loads its dictionary").toBe("one");

	const target = fs.readBytesSync(TARGET);
	check.expect(target != null, "the plugin's file is read").toBe(true);
	if (target != null) fs.writeFileSync(TARGET, target);
	await sleep(SETTLED);
	fs.writeFileSync(DICTIONARY, "[en]\nTEST_LANG_WORD = two, after the plugin\n");
	await sleep(SETTLED);
	check.expect(lang.translate(null, "TEST_LANG_WORD"), "a dictionary written after its plugin's upload is read again").toBe("two, after the plugin");

	server.command("amxts_unload lang-target");
	check.done();
}
