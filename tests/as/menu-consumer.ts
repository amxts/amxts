// A TS plugin uses a menu through the mc_* natives and publicFor, as a Pawn plugin does -
// the placeholder writes its answer with setArgText, the action reads the name with argText.
import { argText, publicFor, setArgText } from "@amxts/core";
import { mc_add_menu_item, mc_create_menu, mc_register_action, mc_register_placeholder } from "@amxts/core/natives";

let chosen = "";

server.addEventListener("cfg", () => {
	mc_create_menu("TS_MENU", "TS menu");
	mc_add_menu_item("TS_MENU", "Value:", "%ts_value%", "", "TS_ACTION");
	mc_register_placeholder("ts_value", publicFor(tsValue, "ts:value"));
	mc_register_action("TS_ACTION", publicFor(tsAction, "ts:action"));
});

function tsValue(id: number, target: number, value: number, len: number) {
	setArgText(2, "forty-two", len);
}

function tsAction() {
	chosen = argText(1);
}

export function ts_chosen() {
	return chosen;
}
