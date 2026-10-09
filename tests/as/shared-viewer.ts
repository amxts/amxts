// The second plugin: shows the menu shared-shop made, does not let Carol open
// it, reads the menu's fields and a config section another plugin created in
// memory - all through the same module names as the owner.

server.addEventListener("init", () => {
	menus.addEventListener("show", (event) => {
		if (event.player.name == "Carol") event.preventDefault();
	});
});

export function shared_show(id: number) {
	const player = new Player(id);
	return menus.show(player, "SHARED_SHOP");
}

/** Another plugin's menu: its kind and name. */
export function shared_menu() {
	const menu = menus.find("SHARED_SHOP");
	if (menu == null) return "no menu";
	return `${menu.kind}|${menu.name}`;
}

/** An item in someone else's menu: the menu's method runs in the engine's instance, and choosing the item calls this plugin's function. */
export function shared_add(text: string) {
	const menu = menus.find("SHARED_SHOP");
	if (menu == null) return false;
	menu.addItem({
		title: ({ player }) => `${text} for ${player.name}`,
		visible: ({ player }) => player.name != "Bob",
		onSelect: ({ player }) => {
			picked = `${text} ${player.name}`;
		},
	});
	return true;
}

/** Opens the menu by the menu's own method. */
export function shared_open(id: number) {
	const player = new Player(id);
	const menu = menus.find("SHARED_SHOP");
	return menu != null && menu.show(player);
}

let picked = "";

export function shared_picked() {
	return picked;
}

/** Changes the title: the write to the field goes to the engine's instance. */
export function shared_retitle(title: string) {
	const menu = menus.find("SHARED_SHOP");
	if (menu != null) menu.title = title;
}

/** The config shared-shop wrote, and a file from the shared configs folder: shared-shop set the folder. */
export function shared_config() {
	const made = configs.read("made").getString("MADE.KEY", "none");
	const disk = configs.read("on-disk").getString("DISK.NAME", "none");
	return `${made}|${disk}`;
}

function actedBy(player: Player) {
	picked = `by ${player.name}`;
}

/** Actions and placeholders by name, several at once: functions of the player or of the context, called back from the owner. */
export function shared_named() {
	menus.addActions({
		VIEWER_ACT: (player) => {
			picked = `act ${player.name}`;
		},
		VIEWER_BY: actedBy,
	});
	menus.addPlaceholders({ who: player => player.name, menu: ({ menu }) => menu.name });
	const menu = menus.find("SHARED_SHOP");
	if (menu == null) return false;
	menu.addItem({ title: "Act", placeholder: "%who% %menu%", action: "VIEWER_ACT" });
	menu.addItem({ title: "By", action: "VIEWER_BY" });
	return true;
}
