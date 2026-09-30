// A menu and a chat line from a dictionary: lang.translate gives the
// dictionary's colour codes as tags, so the menu shows them in colour and
// chat reads the same line.

lang.load("myplugin");

const modes = menus.create("MODES", { title: player => lang.translate(player, "MYPLUGIN_TITLE") });
modes.addItem(player => `DM ${lang.translate(player, "MYPLUGIN_ON")}`);

/** Opens the menu for the player. */
export function menu_lang_open(id: number) {
	const player = new Player(id);
	return modes.show(player);
}

/** Tells the player a line with its arguments filled. */
export function menu_lang_tell(id: number) {
	const player = new Player(id);
	print(player, lang.translate(player, "MYPLUGIN_SCORED", [player.name, "3"]));
}
