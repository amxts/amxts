// plugins.ini written while the server runs: a line added loads its plugin,
// a line that only moved does nothing, and a line removed unloads its plugin.
// list-target is the plugin of that line.
// @log changed: loading list-target.aot
// @log changed: unloading list-target.aot
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const LIST = "addons/amxts/test/plugins.ini";
/** What the watcher takes to see the list settled, load the plugin and start it, with room to spare. */
const SETTLED = 1500;

const starts = new Cvar("amxts_test_list_starts", "0");
const ends = new Cvar("amxts_test_list_ends", "0");
const menuLoads = new Cvar("amxts_test_menu_reload_loads", "0");

server.addServerCommand("amxts_test_list", list);

function running() {
	return server.plugins.find(plugin => plugin.file == "list-target.aot")?.running ?? false;
}

async function list() {
	const check = new Checks("list");
	const text = fs.readFileSync(LIST);
	check.expect(text != null, "the plugin list is read").toBe(true);
	if (text == null) {
		check.done();
		return;
	}
	const lines = text.split("\n").filter(line => line.length > 0);
	const loads = menuLoads.number;

	fs.writeFileSync(LIST, `${[...lines, "list-target.aot"].join("\n")}\n`);
	await sleep(SETTLED);
	check.expect(running(), "a line added loads its plugin").toBe(true);
	check.expect(starts.number, "which starts once").toBe(1);

	fs.writeFileSync(LIST, `${["list-target.aot", ...lines].join("\n")}\n`);
	await sleep(SETTLED);
	check.expect(starts.number + ends.number, "a line that moved does nothing").toBe(1);
	check.expect(menuLoads.number, "and the other plugins run on").toBe(loads);

	fs.writeFileSync(LIST, text);
	await sleep(SETTLED);
	check.expect(running(), "a line removed unloads its plugin").toBe(false);
	check.expect(ends.number, "which hears its end once").toBe(1);
	check.done();
}
