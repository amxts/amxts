// A fixture for tests/listeners-off.test.ts: listeners added on one server
// command and taken off on another - a reapi chain, a Ham Sandwich hook of a
// class, a server event, a message, a touch and, on plain HLDS, a stock
// hook's backend.

function onReset() {
	console.log("reset");
}

function onThink() {
	console.log("think");
}

function onJoin() {
	console.log("join");
}

function onDeath() {
	console.log("death");
}

function onTouch() {
	console.log("touch");
}

function onRoundStart() {
	console.log("round start");
}

server.addServerCommand("listeners_on", () => {
	game.addEventListener("resetMaxSpeed", onReset);
	game.addEventListener("think", onThink, { classname: "info_target" });
	server.addEventListener("putInServer", onJoin);
	server.addMessageListener("death", onDeath);
	game.addEventListener("touch", onTouch, { toucher: "player" });
	game.addEventListener("roundStart", onRoundStart);
});

server.addServerCommand("listeners_off", () => {
	game.removeEventListener("resetMaxSpeed", onReset);
	game.removeEventListener("think", onThink, { classname: "info_target" });
	server.removeEventListener("putInServer", onJoin);
	server.removeMessageListener("death", onDeath);
	game.removeEventListener("touch", onTouch, { toucher: "player" });
	game.removeEventListener("roundStart", onRoundStart);
});
