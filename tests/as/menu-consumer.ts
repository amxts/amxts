// TS-плагин пользуется меню через нативы mc_* и publicFor, как Pawn-плагин -
// плейсхолдер пишет ответ setArgText, действие читает имя argText.
import { argText, publicFor, setArgText } from "@amxts/core";
import { mc_add_menu_item, mc_create_menu, mc_register_action, mc_register_placeholder } from "@amxts/core/natives";

let chosen = "";

server.addEventListener("cfg", () => {
	mc_create_menu("TS_MENU", "Меню TS");
	mc_add_menu_item("TS_MENU", "Значение:", "%ts_value%", "", "TS_ACTION");
	mc_register_placeholder("ts_value", publicFor(tsValue, "ts:value"));
	mc_register_action("TS_ACTION", publicFor(tsAction, "ts:action"));
});

function tsValue(id: number, target: number, value: number, len: number) {
	setArgText(2, "сорок два", len);
}

function tsAction() {
	chosen = argText(1);
}

export function ts_chosen() {
	return chosen;
}
