// TS-плагин строит меню через `@amxts/menu-core` сам - без нативов mc_*:
// меню - объект с методами, а текст, условие и выбор пункта - функции прямо у
// пункта и меню. Имена (addAction) остаются для menu.ini и Pawn.

let healed = 0;
let lastChoice = "";

menus.addAction("PICK", (player, target, name) => {
	lastChoice = `${player.name}:${name}`;
});

const shop = menus.create("SHOP", { title: player => `Магазин для ${player.name}` });
shop.addItem(player => `Лечение (${player.health} HP)`, {
	enabled: player => player.health < 100,
	message: player => `здоров: ${player.health}`,
	onSelect: heal,
});
shop.addItem("Только раненым", { visible: player => player.health < 100 });
shop.addItem("Выбор", { action: "PICK" });
shop.addItem("Выход", { action: "CLOSE_MENU", spaceBefore: 1 });

function heal(player: Player) {
	player.health = 100;
	healed++;
}

/** Открывает магазин игроку. */
export function menu_api_open(id: number) {
	const player = new Player(id);
	return shop.show(player);
}

export function menu_api_healed() {
	return healed;
}

export function menu_api_choice() {
	return lastChoice;
}
