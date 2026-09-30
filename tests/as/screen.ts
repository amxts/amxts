// A fixture for tests/screen.test.ts: player.screen, one command a message.

server.addCommand("scr_fade", fade);
server.addCommand("scr_black", black);
server.addCommand("scr_shake", shake);
server.addCommand("scr_icon", icon);
server.addCommand("scr_hud", hud);
server.addCommand("scr_bar", bar);

function fade(player: Player) {
	player.screen.fade({ color: [200, 0, 0, 100], duration: 0.5 });
}

function black(player: Player) {
	player.screen.fade({ color: [0, 0, 0, 255], duration: 1 / 16, hold: 1.0, direction: "out", stay: true, modulate: true });
}

function shake(player: Player) {
	player.screen.shake({ amplitude: 8, duration: 1, frequency: 5 });
}

function icon(player: Player) {
	player.screen.statusIcon("dmg_cold", "flash", [0, 200, 255]);
	player.screen.statusIcon("dmg_cold", "hide");
}

function hud(player: Player) {
	player.screen.roundTime(90);
	player.screen.hideHud(["Money", "Timer"]);
	player.screen.crosshair(false);
	player.screen.flashlight(false);
}

function bar(player: Player) {
	player.screen.progressBar(4.6);
	player.screen.progressBar(0);
}
