// A fixture for tests/screen.test.ts: player.screen, one command a message.

server.addCommand("scr_fade", ({ player }) => fade(player));
server.addCommand("scr_black", ({ player }) => black(player));
server.addCommand("scr_shake", ({ player }) => shake(player));
server.addCommand("scr_icon", ({ player }) => icon(player));
server.addCommand("scr_hud", ({ player }) => hud(player));
server.addCommand("scr_bar", ({ player }) => bar(player));

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
	player.screen.hideHud(["money", "timer"]);
	player.screen.crosshair(false);
	player.screen.flashlight(false);
}

function bar(player: Player) {
	player.screen.progressBar(4.6);
	player.screen.progressBar(0);
	player.screen.progressBar(6, { startPercent: 50 });
	player.screen.progressBar(6, { startPercent: 0 });
}
