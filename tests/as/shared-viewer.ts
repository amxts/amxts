// Второй плагин: показывает меню, которое завёл shared-shop, не даёт открыть
// его Кэрол, читает поля меню и секцию конфига, созданную в памяти другим
// плагином, - всё через тот же импорт, что и у владельца.
import * as menus from "~/modules/menu-core";
import * as configs from "~/modules/config-core";

server.addEventListener("init", () => {
	menus.addEventListener("show", (event) => {
		if (event.player.name == "Carol") event.preventDefault();
	});
});

export function shared_show(id: number) {
	const player = new Player(id);
	return menus.show(player, "SHARED_SHOP");
}

/** Вид и имя меню другого плагина. */
export function shared_menu() {
	const menu = menus.find("SHARED_SHOP");
	if (menu == null) return "нет меню";
	return `${menu.kind}|${menu.name}`;
}

/** Пункт в чужое меню: метод меню выполняется в экземпляре движка, а выбор пункта зовёт функцию этого плагина. */
export function shared_add(text: string) {
	const menu = menus.find("SHARED_SHOP");
	if (menu == null) return false;
	menu.addItem(player => `${text} для ${player.name}`, {
		visible: player => player.name != "Bob",
		onSelect: (player) => {
			picked = `${text} ${player.name}`;
		},
	});
	return true;
}

/** Открывает меню методом самого меню. */
export function shared_open(id: number) {
	const player = new Player(id);
	const menu = menus.find("SHARED_SHOP");
	return menu != null && menu.show(player);
}

let picked = "";

export function shared_picked() {
	return picked;
}

/** Меняет заголовок: запись в поле уходит в экземпляр движка. */
export function shared_retitle(title: string) {
	const menu = menus.find("SHARED_SHOP");
	if (menu != null) menu.title = title;
}

/** Конфиг, который записал shared-shop, и файл из общей папки конфигов: папку задал shared-shop. */
export function shared_config() {
	const made = configs.read("made").getString("MADE.KEY", "нет");
	const disk = configs.read("on-disk").getString("DISK.NAME", "нет");
	return `${made}|${disk}`;
}
