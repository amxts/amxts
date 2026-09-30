// Один из двух плагинов, которые пишут обычный импорт модулей: меню и
// конфиг, заведённые здесь, - в единственном экземпляре движка на сервере,
// и второй плагин (shared-viewer) видит их как свои: меню - то же самое,
// конфиг - в той же папке.

let chosen = "";

server.addEventListener("init", () => {
	menus.addAction("GREET", (player, target, name) => {
		chosen = `${name} ${player.name}`;
	});
	menus.addPlaceholder("hp", player => `${player.health}`);

	const shop = menus.create("SHARED_SHOP", { title: "Лавка" });
	shop.addItem("Привет (%hp%)", { enabled: [{ when: player => player.name == "Alice" }], action: "GREET" });
	shop.addItem("Нож", { onSelect: takeKnife });

	configs.setBaseDir("shared");
	const made = configs.read("made");
	made.set("MADE.KEY", "значение");
	made.save();
});

function takeKnife(player: Player) {
	chosen = `нож ${player.name}`;
}

export function shared_chosen() {
	return chosen;
}
