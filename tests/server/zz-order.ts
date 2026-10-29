// A module's owner listed after the plugins that call it still loads before
// them. The suite moves menu-core.aot and config-core.aot to the end of
// plugins.ini, which alone reloads nothing, and runs amxts_reload: the menu
// menu-reload-target makes at its top level is there, made once. Then it puts
// the list back. A reload starts every plugin over, so this file runs late.
import * as fs from "@amxts/core/fs";
import { Checks } from "@amxts/core/check";

const LIST = "addons/amxts/test/plugins.ini";
/** The list as it was, for the load after the reload to put back. */
const BEFORE = "addons/amxts/test/plugins.ini.before";
const MODULES = ["menu-core.aot", "config-core.aot"];
/** What the watcher takes to see the list settled and act on it, with room to spare. */
const SETTLED = 1500;

const menuLoads = new Cvar("amxts_test_menu_reload_loads", "0");
/** menu-reload-target's starts before the reload, for the load after it to compare. */
const left = new Cvar("amxts_test_order_left", "");

server.addServerCommand("amxts_test_order", order);

async function order() {
	const check = new Checks("order");
	const text = fs.readFileSync(LIST);
	check.expect(text != null, "the plugin list is read").toBe(true);
	if (text == null) {
		check.done();
		return;
	}
	fs.writeFileSync(BEFORE, text);
	const lines = text.split("\n").filter(line => line.length > 0);
	const loads = menuLoads.number;

	fs.writeFileSync(LIST, `${[...lines.filter(line => !MODULES.includes(line)), ...MODULES].join("\n")}\n`);
	await sleep(SETTLED);
	check.expect(menuLoads.number, "lines that only moved reload nothing").toBe(loads);

	left.value = `${menuLoads.number}`;
	server.command("amxts_reload");
}

server.addEventListener("init", () => {
	if (left.value.length > 0) setTimeout(afterReload, 1000);
});

async function afterReload() {
	const check = new Checks("order");
	const loads = parseInt(left.value);
	left.value = "";
	check.expect(menus.find("TEST_RELOAD_HELLO") != null, "a menu made at the top level of a plugin listed before menu-core is there").toBe(true);
	check.expect(menuLoads.number - loads, "and that plugin started once").toBe(1);

	const before = fs.readFileSync(BEFORE);
	if (before != null) fs.writeFileSync(LIST, before);
	await sleep(SETTLED);
	check.expect(menuLoads.number - loads, "putting the lines back reloads nothing").toBe(1);
	check.done();
}
